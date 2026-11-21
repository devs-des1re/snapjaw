import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { db } from "../index";
import { invites } from "../schema";
import { newId, randomToken, sha256 } from "../../lib/crypto";
import type { Role } from "./users";

const inviteLifetimeMs = 7 * 24 * 60 * 60 * 1000;

export async function createInvite(input: { email: string; role: Role; createdBy: string }) {
  const token = randomToken(24);
  const id = newId("inv");
  const expiresAt = new Date(Date.now() + inviteLifetimeMs);
  await db.insert(invites).values({
    id,
    email: input.email.trim().toLowerCase(),
    role: input.role,
    tokenHash: sha256(token),
    createdBy: input.createdBy,
    expiresAt,
  });
  return { id, token, expiresAt };
}

export async function findOpenInvite(token: string) {
  return db.query.invites.findFirst({
    where: and(eq(invites.tokenHash, sha256(token)), isNull(invites.acceptedAt), isNull(invites.revokedAt), gt(invites.expiresAt, new Date())),
  });
}

export async function markInviteAccepted(id: string) {
  await db.update(invites).set({ acceptedAt: new Date() }).where(eq(invites.id, id));
}

export async function revokeInvite(id: string) {
  await db.update(invites).set({ revokedAt: new Date() }).where(eq(invites.id, id));
}

export async function listOpenInvites() {
  return db
    .select({ id: invites.id, email: invites.email, role: invites.role, createdBy: invites.createdBy, expiresAt: invites.expiresAt, createdAt: invites.createdAt })
    .from(invites)
    .where(and(isNull(invites.acceptedAt), isNull(invites.revokedAt), gt(invites.expiresAt, new Date())))
    .orderBy(desc(invites.createdAt));
}
