import { randomUUID } from "node:crypto";

import type { RunnerConfig } from "./config.js";
import { transportTimeoutMs } from "./config.js";
import {
  DockerError,
  dockerImageExists,
  dockerIsRunning,
  dockerRemove,
  dockerRunDetached,
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

export class PoolManager {
  private readonly members = new Map<string, PoolMember>();
  private readonly waiters: Waiter[] = [];
  private healthTimer: NodeJS.Timeout | null = null;
  private healthRunning = false;
  private replenishing = false;
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
      "snapjaw.role=sandbox",
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

    const deadline = Date.now() + SPAWN_READY_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (await containerAnswers(name)) return member;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }

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
          this.members.set(member.id, member);
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

      await this.replenish();
    } catch (error) {
      this.logger("error", "sandbox health check failed", { error: describeError(error) });
    } finally {
      this.healthRunning = false;
    }
  }
}
