import { and, desc, eq, gt, lt } from "drizzle-orm";
import { db } from "../index";
import { sessionMeta, sessions } from "../schema";
import { randomToken } from "../../lib/crypto";

export async function recordSessionMeta(input: { sessionToken: string; userId: string; userAgent: string | null; ip: string | null }) {
  await db
    .insert(sessionMeta)
    .values({ ...input, publicId: randomToken(12), userAgent: input.userAgent?.slice(0, 300) ?? null })
    .onConflictDoNothing();
}

export async function listSessions(userId: string) {
  return db
    .select({
      publicId: sessionMeta.publicId,
      userAgent: sessionMeta.userAgent,
      ip: sessionMeta.ip,
      createdAt: sessionMeta.createdAt,
      expires: sessions.expires,
      sessionToken: sessions.sessionToken,
    })
    .from(sessions)
    .innerJoin(sessionMeta, eq(sessionMeta.sessionToken, sessions.sessionToken))
    .where(and(eq(sessions.userId, userId), gt(sessions.expires, new Date())))
    .orderBy(desc(sessionMeta.createdAt));
}

export async function revokeSession(userId: string, publicId: string): Promise<boolean> {
  const row = await db.query.sessionMeta.findFirst({ where: and(eq(sessionMeta.publicId, publicId), eq(sessionMeta.userId, userId)) });
  if (!row) return false;
  await db.delete(sessions).where(eq(sessions.sessionToken, row.sessionToken));
  return true;
}

export async function revokeAllSessions(userId: string, exceptToken?: string) {
  const all = await db.select({ token: sessions.sessionToken }).from(sessions).where(eq(sessions.userId, userId));
  for (const { token } of all) {
    if (token !== exceptToken) await db.delete(sessions).where(eq(sessions.sessionToken, token));
  }
}

export async function pruneExpiredSessions() {
  await db.delete(sessions).where(lt(sessions.expires, new Date()));
}
