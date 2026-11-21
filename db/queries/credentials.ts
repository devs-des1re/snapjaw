import { and, desc, eq, gte, isNull, sql } from "drizzle-orm";
import { db } from "../index";
import { apiKeys, messages, smtpCredentials } from "../schema";

export async function listSmtpCredentials() {
  return db
    .select({
      id: smtpCredentials.id,
      name: smtpCredentials.name,
      username: smtpCredentials.username,
      allowedSenders: smtpCredentials.allowedSenders,
      ratePerHour: smtpCredentials.ratePerHour,
      lastUsedAt: smtpCredentials.lastUsedAt,
      revokedAt: smtpCredentials.revokedAt,
      createdAt: smtpCredentials.createdAt,
    })
    .from(smtpCredentials)
    .orderBy(desc(smtpCredentials.createdAt));
}

export async function findSmtpCredential(username: string) {
  return db.query.smtpCredentials.findFirst({ where: and(eq(smtpCredentials.username, username), isNull(smtpCredentials.revokedAt)) });
}

export async function getSmtpCredential(id: string) {
  return db.query.smtpCredentials.findFirst({ where: eq(smtpCredentials.id, id) });
}

export async function insertSmtpCredential(values: typeof smtpCredentials.$inferInsert) {
  await db.insert(smtpCredentials).values(values);
}

export async function updateSmtpCredential(id: string, values: Partial<typeof smtpCredentials.$inferInsert>) {
  await db.update(smtpCredentials).set(values).where(eq(smtpCredentials.id, id));
}

export async function touchSmtpCredential(id: string) {
  await db.update(smtpCredentials).set({ lastUsedAt: new Date() }).where(eq(smtpCredentials.id, id));
}

export async function listApiKeys() {
  return db
    .select({
      id: apiKeys.id,
      name: apiKeys.name,
      prefix: apiKeys.prefix,
      allowedSenders: apiKeys.allowedSenders,
      ratePerHour: apiKeys.ratePerHour,
      lastUsedAt: apiKeys.lastUsedAt,
      revokedAt: apiKeys.revokedAt,
      createdAt: apiKeys.createdAt,
    })
    .from(apiKeys)
    .orderBy(desc(apiKeys.createdAt));
}

export async function findApiKeyByPrefix(prefix: string) {
  return db.query.apiKeys.findFirst({ where: and(eq(apiKeys.prefix, prefix), isNull(apiKeys.revokedAt)) });
}

export async function getApiKey(id: string) {
  return db.query.apiKeys.findFirst({ where: eq(apiKeys.id, id) });
}

export async function insertApiKey(values: typeof apiKeys.$inferInsert) {
  await db.insert(apiKeys).values(values);
}

export async function updateApiKey(id: string, values: Partial<typeof apiKeys.$inferInsert>) {
  await db.update(apiKeys).set(values).where(eq(apiKeys.id, id));
}

export async function recipientsInLastHour(credentialId: string): Promise<number> {
  const since = new Date(Date.now() - 60 * 60 * 1000);
  const [row] = await db
    .select({ n: sql<number>`coalesce(sum(${messages.recipients}), 0)` })
    .from(messages)
    .where(and(eq(messages.credentialId, credentialId), gte(messages.createdAt, since)));
  return Number(row?.n ?? 0);
}
