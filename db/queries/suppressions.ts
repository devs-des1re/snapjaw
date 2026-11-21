import { desc, eq, inArray, like } from "drizzle-orm";
import { db } from "../index";
import { suppressions } from "../schema";

export async function listSuppressions(q?: string) {
  return db
    .select()
    .from(suppressions)
    .where(q ? like(suppressions.email, `%${q.toLowerCase()}%`) : undefined)
    .orderBy(desc(suppressions.createdAt))
    .limit(500);
}

export async function addSuppression(email: string, reason: "bounce" | "complaint" | "manual", detail?: string | null, source?: string | null) {
  await db
    .insert(suppressions)
    .values({ email: email.trim().toLowerCase(), reason, detail: detail ?? null, source: source ?? null })
    .onConflictDoUpdate({ target: suppressions.email, set: { reason, detail: detail ?? null, source: source ?? null, createdAt: new Date() } });
}

export async function removeSuppression(email: string) {
  await db.delete(suppressions).where(eq(suppressions.email, email.trim().toLowerCase()));
}

export async function suppressedAmong(addresses: string[]): Promise<Set<string>> {
  const normalized = [...new Set(addresses.map((a) => a.trim().toLowerCase()))];
  if (!normalized.length) return new Set();
  const rows = await db.select({ email: suppressions.email }).from(suppressions).where(inArray(suppressions.email, normalized));
  return new Set(rows.map((row) => row.email));
}
