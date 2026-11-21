import { and, desc, eq, gte, like, lt, or, type SQL } from "drizzle-orm";
import { db } from "../index";
import { auditLog } from "../schema";

export type AuditActor = { id?: string | null; email?: string | null; ip?: string | null; userAgent?: string | null };

export async function recordAudit(actor: AuditActor, action: string, target?: string | null, detail?: Record<string, unknown>) {
  await db.insert(auditLog).values({
    actorId: actor.id ?? null,
    actorEmail: actor.email ?? null,
    action,
    target: target ?? null,
    detail: detail ?? null,
    ip: actor.ip ?? null,
    userAgent: actor.userAgent?.slice(0, 300) ?? null,
  });
}

export async function listAudit(filter: { q?: string; action?: string; before?: number; since?: Date; limit?: number }) {
  const conditions: SQL[] = [];
  if (filter.action) conditions.push(eq(auditLog.action, filter.action));
  if (filter.before) conditions.push(lt(auditLog.id, filter.before));
  if (filter.since) conditions.push(gte(auditLog.createdAt, filter.since));
  if (filter.q) {
    const pattern = `%${filter.q}%`;
    const match = or(like(auditLog.actorEmail, pattern), like(auditLog.target, pattern), like(auditLog.action, pattern));
    if (match) conditions.push(match);
  }
  return db
    .select()
    .from(auditLog)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(auditLog.id))
    .limit(Math.min(filter.limit ?? 50, 200));
}

export async function pruneAudit(before: Date) {
  await db.delete(auditLog).where(lt(auditLog.createdAt, before));
}
