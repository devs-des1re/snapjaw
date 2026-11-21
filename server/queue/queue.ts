import { and, asc, count, eq, inArray, lt, lte, or, sql } from "drizzle-orm";
import { db } from "../../db";
import { jobs } from "../../db/schema";
import { newId } from "../../lib/crypto";
import { logger } from "../../lib/logger";

export type JobKind = "send" | "inbound" | "deliver" | "domain-check" | "reconcile";

export type JobContext = { id: string; ref: string; attempts: number; maxAttempts: number };

export type JobResult = { status: "done" } | { status: "retry"; error: string; delayMs?: number; countAttempt?: boolean } | { status: "dead"; error: string };

export type Handler = (job: JobContext) => Promise<JobResult>;

type QueueState = {
  handlers: Map<string, Handler>;
  running: boolean;
  timer?: ReturnType<typeof setTimeout>;
  active: number;
  wake?: () => void;
  onDead: ((kind: string, ref: string, error: string) => Promise<void>)[];
};

const store = globalThis as typeof globalThis & { __snapjawQueue?: QueueState };

function state(): QueueState {
  store.__snapjawQueue ??= { handlers: new Map(), running: false, active: 0, onDead: [] };
  return store.__snapjawQueue;
}

const leaseMs = 5 * 60 * 1000;
const concurrency = 4;

export function backoff(attempts: number): number {
  const base = Math.min(30_000 * 2 ** Math.max(0, attempts - 1), 6 * 60 * 60 * 1000);
  const jitter = base * 0.2 * Math.random();
  return Math.round(base + jitter);
}

export function registerHandler(kind: JobKind, handler: Handler) {
  state().handlers.set(kind, handler);
}

export function onDeadJob(listener: (kind: string, ref: string, error: string) => Promise<void>) {
  state().onDead.push(listener);
}

export async function enqueue(kind: JobKind, ref: string, options: { runAt?: Date; maxAttempts?: number; tx?: typeof db } = {}) {
  const runner = options.tx ?? db;
  await runner
    .insert(jobs)
    .values({ id: newId("job"), kind, ref, runAt: options.runAt ?? new Date(), maxAttempts: options.maxAttempts ?? 10 })
    .onConflictDoUpdate({
      target: [jobs.kind, jobs.ref],
      set: { state: "queued", runAt: options.runAt ?? new Date(), updatedAt: new Date() },
      setWhere: inArray(jobs.state, ["done", "dead"]),
    });
  wake();
}

export function wake() {
  state().wake?.();
}

export async function recoverLeases() {
  const result = await db
    .update(jobs)
    .set({ state: "queued", leaseUntil: null, updatedAt: new Date() })
    .where(eq(jobs.state, "running"));
  return result.rowsAffected;
}

async function claim(): Promise<(typeof jobs.$inferSelect) | null> {
  const now = new Date();
  const candidates = await db
    .select()
    .from(jobs)
    .where(or(and(eq(jobs.state, "queued"), lte(jobs.runAt, now)), and(eq(jobs.state, "running"), lt(jobs.leaseUntil, now))))
    .orderBy(asc(jobs.runAt))
    .limit(5);
  for (const job of candidates) {
    const updated = await db
      .update(jobs)
      .set({ state: "running", leaseUntil: new Date(Date.now() + leaseMs), attempts: sql`${jobs.attempts} + 1`, updatedAt: new Date() })
      .where(and(eq(jobs.id, job.id), eq(jobs.updatedAt, job.updatedAt)));
    if (updated.rowsAffected === 1) return { ...job, attempts: job.attempts + 1 };
  }
  return null;
}

async function finish(job: typeof jobs.$inferSelect, result: JobResult) {
  if (result.status === "done") {
    await db.update(jobs).set({ state: "done", leaseUntil: null, lastError: null, updatedAt: new Date() }).where(eq(jobs.id, job.id));
    return;
  }
  const exhausted = result.status === "dead" || (result.status === "retry" && result.countAttempt !== false && job.attempts >= job.maxAttempts);
  if (exhausted) {
    await db.update(jobs).set({ state: "dead", leaseUntil: null, lastError: result.error, updatedAt: new Date() }).where(eq(jobs.id, job.id));
    for (const listener of state().onDead) await listener(job.kind, job.ref, result.error).catch(() => undefined);
    return;
  }
  const delay = result.status === "retry" ? (result.delayMs ?? backoff(job.attempts)) : backoff(job.attempts);
  const attempts = result.status === "retry" && result.countAttempt === false ? job.attempts - 1 : job.attempts;
  await db
    .update(jobs)
    .set({ state: "queued", leaseUntil: null, attempts, lastError: result.error, runAt: new Date(Date.now() + delay), updatedAt: new Date() })
    .where(eq(jobs.id, job.id));
}

async function runOne(job: typeof jobs.$inferSelect) {
  const handler = state().handlers.get(job.kind);
  if (!handler) {
    await finish(job, { status: "retry", error: `No handler for ${job.kind}`, delayMs: 60_000, countAttempt: false });
    return;
  }
  let result: JobResult;
  try {
    result = await handler({ id: job.id, ref: job.ref, attempts: job.attempts, maxAttempts: job.maxAttempts });
  } catch (error) {
    result = { status: "retry", error: error instanceof Error ? error.message : String(error) };
  }
  await finish(job, result);
}

export async function drainOnce(): Promise<number> {
  let processed = 0;
  for (;;) {
    const job = await claim();
    if (!job) return processed;
    await runOne(job);
    processed += 1;
  }
}

export function startQueue() {
  const current = state();
  if (current.running) return;
  current.running = true;
  const loop = async () => {
    if (!current.running) return;
    try {
      while (current.active < concurrency) {
        const job = await claim();
        if (!job) break;
        current.active += 1;
        void runOne(job).finally(() => {
          current.active -= 1;
          wake();
        });
      }
    } catch (error) {
      logger.error("Queue loop failed", error instanceof Error ? error.message : error);
    }
    current.timer = setTimeout(loop, 1000);
  };
  current.wake = () => {
    if (current.timer) clearTimeout(current.timer);
    current.timer = setTimeout(loop, 10);
  };
  void loop();
}

export function stopQueue() {
  const current = state();
  current.running = false;
  if (current.timer) clearTimeout(current.timer);
}

export async function queueDepth() {
  const rows = await db.select({ kind: jobs.kind, state: jobs.state, n: count() }).from(jobs).where(inArray(jobs.state, ["queued", "running", "dead"])).groupBy(jobs.kind, jobs.state);
  return rows;
}

export async function retryDead(kind: string, ref: string) {
  await db.update(jobs).set({ state: "queued", attempts: 0, runAt: new Date(), lastError: null, updatedAt: new Date() }).where(and(eq(jobs.kind, kind), eq(jobs.ref, ref), eq(jobs.state, "dead")));
  wake();
}
