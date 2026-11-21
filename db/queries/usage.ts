import { and, eq, gte, lte, sql } from "drizzle-orm";
import { db } from "../index";
import { usage } from "../schema";

export function utcDay(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

export function monthStart(date = new Date()): string {
  return `${date.toISOString().slice(0, 7)}-01`;
}

async function ensureDay(day: string) {
  await db.insert(usage).values({ day }).onConflictDoNothing();
}

export async function addUsage(kind: "sent" | "received", amount: number, day = utcDay()) {
  await ensureDay(day);
  await db
    .update(usage)
    .set(kind === "sent" ? { sent: sql`${usage.sent} + ${amount}` } : { received: sql`${usage.received} + ${amount}` })
    .where(eq(usage.day, day));
}

export async function recordResendQuota(daily: number | null, monthly: number | null) {
  const day = utcDay();
  await ensureDay(day);
  const set: Record<string, number> = {};
  if (daily !== null) set.resendDaily = daily;
  if (monthly !== null) set.resendMonthly = monthly;
  if (Object.keys(set).length) await db.update(usage).set(set).where(eq(usage.day, day));
}

export type UsageSnapshot = { day: number; month: number; dayRow: typeof usage.$inferSelect | null };

export async function currentUsage(now = new Date()): Promise<UsageSnapshot> {
  const day = utcDay(now);
  const rows = await db.select().from(usage).where(and(gte(usage.day, monthStart(now)), lte(usage.day, day)));
  const today = rows.find((row) => row.day === day) ?? null;
  const ownMonth = rows.reduce((sum, row) => sum + row.sent + row.received, 0);
  const ownDay = today ? today.sent + today.received : 0;
  return {
    day: Math.max(ownDay, today?.resendDaily ?? 0),
    month: Math.max(ownMonth, today?.resendMonthly ?? 0),
    dayRow: today,
  };
}

export async function markAlerted(day = utcDay()) {
  await ensureDay(day);
  await db.update(usage).set({ alertedAt: new Date() }).where(eq(usage.day, day));
}

export async function usageHistory(days: number) {
  const since = utcDay(new Date(Date.now() - days * 86400000));
  return db.select().from(usage).where(gte(usage.day, since)).orderBy(usage.day);
}
