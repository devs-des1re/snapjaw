import { randomUUID } from "node:crypto";

import type { RunnerConfig } from "./config.js";
import { transportTimeoutMs } from "./config.js";
import {
  DockerError,
  dockerImageExists,
  dockerIsRunning,
  dockerListContainersByLabel,
  dockerRemove,
  dockerRunDetached,
  type ContainerRef,
} from "./docker.js";
import { describeError, log as defaultLogger } from "./logger.js";
import { containerAnswers, resetContainer } from "./run-in-container.js";

export type MemberState = "starting" | "idle" | "busy" | "unhealthy";

export interface PoolMember {
  id: string;
  name: string;
  state: MemberState;
  runs: number;
  createdAt: number;
  /** When the current run was handed out, used to reclaim a wedged member. */
  busySince: number | null;
}

export interface PoolSnapshot {
  size: number;
  idle: number;
  busy: number;
  unhealthy: number;
  queued: number;
  members: Array<{ id: string; name: string; state: MemberState; runs: number }>;
}

type Logger = typeof defaultLogger;

export class PoolUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PoolUnavailableError";
  }
}

interface Waiter {
  resolve: (member: PoolMember) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

const SPAWN_READY_TIMEOUT_MS = 30_000;

/** Grace period for an outgoing runner to drain before we collect its pool. */
const ORPHAN_SETTLE_MS = 4_000;

/**
 * How many health-check ticks run an orphan sweep.
 *
 * Startup alone misses containers the outgoing runner creates *after* we have
 * swept — it replenishes when it notices its pool disappear, and a hard kill
 * means it never removes the replacements. Sweeping once more a health interval
 * later collects those, by which point the outgoing runner is gone.
 *
 * Bounded on purpose: a lifelong sweep would delete containers a live peer is
 * still executing in, which surfaces as "No such container" mid-run.
 */
const SWEEP_TICKS = 2;

/** Marks containers this service owns, so stale ones can be found again. */
export const SANDBOX_LABEL = "snapjaw.role=sandbox";

/**
 * Containers left behind by a previous run of this service.
 *
 * A runner that is killed hard cannot clean up after itself — `docker compose
 * up` after a redeploy, or a crash — so without this the host accumulates
 * sandbox containers on every deploy. Scoped to the configured name prefix so
 * a second stack on the same host is left alone.
 */
export function selectOrphanedSandboxes(
  containers: readonly ContainerRef[],
  containerPrefix: string,
): ContainerRef[] {
  const prefix = `${containerPrefix}-`;
  return containers.filter((container) => container.name.startsWith(prefix));
}

export class PoolManager {
  private readonly members = new Map<string, PoolMember>();
  private readonly waiters: Waiter[] = [];
  private healthTimer: NodeJS.Timeout | null = null;
  private healthRunning = false;
  private replenishing = false;
  private sweepsRemaining = SWEEP_TICKS;
  private stopped = false;

  constructor(
    private readonly config: RunnerConfig,
    private readonly logger: Logger = defaultLogger,
  ) {}

  /** Verify the image exists and bring the full pool up. */
  async start(): Promise<void> {
    if (!(await dockerImageExists(this.config.image))) {
      throw new Error(
        `sandbox image "${this.config.image}" is not present. Build it with: npm run image:build`,
      );
    }

    await this.sweepOrphans(ORPHAN_SETTLE_MS);
    await this.replenish();

    if (this.members.size === 0) {
      throw new Error("no sandbox containers could be started");
    }

    this.healthTimer = setInterval(() => {
      void this.healthCheck();
    }, this.config.healthIntervalMs);
    this.healthTimer.unref();

    this.logger("info", "sandbox pool ready", {
      image: this.config.image,
      size: this.members.size,
      requestedSize: this.config.poolSize,
    });
  }

  /**
   * Take an idle container. The caller owns it until `release` is called.
   * Waits for one to free up rather than starting an unbounded container.
   */
  async acquire(timeoutMs = this.config.acquireTimeoutMs): Promise<PoolMember> {
    if (this.stopped) throw new PoolUnavailableError("the sandbox pool is shutting down");

    const idle = this.findIdle();
    if (idle) {
      this.handOut(idle);
      return idle;
    }

    if (timeoutMs <= 0) {
      throw new PoolUnavailableError("every sandbox is busy");
    }

    return new Promise<PoolMember>((resolve, reject) => {
      const waiter: Waiter = {
        resolve: (member) => {
          this.handOut(member);
          resolve(member);
        },
        reject,
        timer: setTimeout(() => {
          const index = this.waiters.indexOf(waiter);
          if (index !== -1) this.waiters.splice(index, 1);
          reject(new PoolUnavailableError("no sandbox became available in time"));
        }, timeoutMs),
      };
      this.waiters.push(waiter);
    });
  }

  private handOut(member: PoolMember): void {
    member.state = "busy";
    member.runs += 1;
    member.busySince = Date.now();
  }

  /**
   * Reset the container and return it to the pool. A container that cannot be
   * cleaned is destroyed and replaced rather than reused.
   */
  async release(member: PoolMember): Promise<void> {
    if (this.stopped) {
      this.members.delete(member.id);
      await dockerRemove(member.name);
      return;
    }

    const cleaned = await resetContainer(member.name, this.logger);
    const answers = cleaned && (await containerAnswers(member.name));

    if (!answers) {
      this.logger("warn", "retiring a sandbox that could not be reset", {
        container: member.name,
      });
      this.members.delete(member.id);
      await dockerRemove(member.name);
      void this.replenish();
      return;
    }

    member.state = "idle";
    member.busySince = null;
    this.dispatch();
  }

  snapshot(): PoolSnapshot {
    const members = [...this.members.values()].map((member) => ({
      id: member.id,
      name: member.name,
      state: member.state,
      runs: member.runs,
    }));

    return {
      size: members.length,
      idle: members.filter((m) => m.state === "idle").length,
      busy: members.filter((m) => m.state === "busy").length,
      unhealthy: members.filter((m) => m.state === "unhealthy").length,
      queued: this.waiters.length,
      members,
    };
  }

  async stop(): Promise<void> {
    this.stopped = true;

    if (this.healthTimer) {
      clearInterval(this.healthTimer);
      this.healthTimer = null;
    }

    for (const waiter of this.waiters.splice(0)) {
      clearTimeout(waiter.timer);
      waiter.reject(new PoolUnavailableError("the sandbox pool is shutting down"));
    }

    const names = [...this.members.values()].map((member) => member.name);
    this.members.clear();
    await Promise.all(names.map((name) => dockerRemove(name)));

    this.logger("info", "sandbox pool stopped", { containers: names.length });
  }

  private findIdle(): PoolMember | undefined {
    for (const member of this.members.values()) {
      if (member.state === "idle") return member;
    }
    return undefined;
  }

  /** Hand idle containers to whoever is waiting for one. */
  private dispatch(): void {
    while (this.waiters.length > 0) {
      const idle = this.findIdle();
      if (!idle) return;

      const waiter = this.waiters.shift();
      if (!waiter) return;

      clearTimeout(waiter.timer);
      waiter.resolve(idle);
    }
  }

  /**
   * Remove sandbox containers carrying our prefix that no live runner owns.
   *
   * Only ever called at startup, before this instance has created anything, so
   * the only containers it can see are ones a previous run left behind. It must
   * NOT run periodically: while a redeploy overlaps, a continuous sweep would
   * delete containers the outgoing runner is still executing in, which shows up
   * as "No such container" failures mid-run.
   *
   * The settle delay gives an outgoing runner time to drain and remove its own
   * pool, so we only collect what it genuinely could not clean up.
   */
  private async sweepOrphans(settleMs: number): Promise<void> {
    if (settleMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, settleMs));
    }

    const known = new Set([...this.members.values()].map((member) => member.name));
    const orphans = selectOrphanedSandboxes(
      await dockerListContainersByLabel(SANDBOX_LABEL),
      this.config.containerPrefix,
    ).filter((container) => !known.has(container.name));

    if (orphans.length === 0) return;

    this.logger("warn", "sweeping sandbox containers left by a previous run", {
      count: orphans.length,
      containers: orphans.map((container) => container.name),
    });

    for (const orphan of orphans) {
      await dockerRemove(orphan.name);
    }
  }

  private async spawnMember(): Promise<PoolMember> {
    const name = `${this.config.containerPrefix}-${randomUUID().slice(0, 8)}`;

    const id = await dockerRunDetached([
      "--name",
      name,
      "--network",
      "none",
      "--memory",
      this.config.memoryLimit,
      "--memory-swap",
      this.config.memoryLimit,
      "--cpus",
      this.config.cpuLimit,
      "--pids-limit",
      String(this.config.pidsLimit),
      "--cap-drop",
      "ALL",
      "--security-opt",
      "no-new-privileges",
      "--read-only",
      "--tmpfs",
      `/tmp:rw,size=${this.config.tmpfsSize},mode=1777`,
      "--label",
      SANDBOX_LABEL,
      this.config.image,
    ]);

    const member: PoolMember = {
      id,
      name,
      state: "starting",
      runs: 0,
      createdAt: Date.now(),
      busySince: null,
    };

    // Register before waiting for readiness: until it is in the map an orphan
    // sweep would see a container it does not recognise and delete it.
    this.members.set(member.id, member);

    const deadline = Date.now() + SPAWN_READY_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (await containerAnswers(name)) return member;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }

    this.members.delete(member.id);
    await dockerRemove(name);
    throw new Error(`sandbox ${name} did not become ready within ${SPAWN_READY_TIMEOUT_MS}ms`);
  }

  private async replenish(): Promise<void> {
    if (this.stopped || this.replenishing) return;
    this.replenishing = true;

    try {
      while (!this.stopped && this.members.size < this.config.poolSize) {
        try {
          const member = await this.spawnMember();
          member.state = "idle";
          this.dispatch();
        } catch (error) {
          this.logger("error", "could not start a sandbox", {
            error: describeError(error),
            currentSize: this.members.size,
          });
          if (error instanceof DockerError) break;
          break;
        }
      }
    } finally {
      this.replenishing = false;
    }
  }

  /**
   * Periodically confirm idle containers still respond, and replace any that
   * do not.
   *
   * Busy containers are skipped — except for one that has been held far longer
   * than any run could legitimately take. That happens if a reset wedges or a
   * handler dies mid-run, and without reclaiming it the pool would shrink
   * permanently because a busy member is never health-checked.
   */
  private async healthCheck(): Promise<void> {
    if (this.healthRunning || this.stopped) return;
    this.healthRunning = true;

    const stuckAfterMs = transportTimeoutMs(this.config) + 60_000;

    try {
      for (const member of [...this.members.values()]) {
        // A container that is still coming up is not expected to answer yet.
        if (member.state === "starting") continue;

        if (member.state === "busy") {
          const heldFor = member.busySince === null ? 0 : Date.now() - member.busySince;
          if (heldFor <= stuckAfterMs) continue;

          this.logger("warn", "reclaiming a sandbox stuck on a run", {
            container: member.name,
            heldForMs: heldFor,
          });
        } else {
          const alive = await dockerIsRunning(member.name);
          if (alive && (await containerAnswers(member.name))) continue;

          this.logger("warn", "sandbox failed its health check and is being replaced", {
            container: member.name,
          });
        }

        member.state = "unhealthy";
        this.members.delete(member.id);
        await dockerRemove(member.name);
      }

      // The startup sweep already ran; a couple more ticks collect anything a
      // departing runner created afterwards, without ever fighting a live peer.
      if (this.sweepsRemaining > 0) {
        this.sweepsRemaining -= 1;
        await this.sweepOrphans(0);
      }

      await this.replenish();
    } catch (error) {
      this.logger("error", "sandbox health check failed", { error: describeError(error) });
    } finally {
      this.healthRunning = false;
    }
  }
}
