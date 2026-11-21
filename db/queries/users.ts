import { and, asc, count, eq, isNull, sql } from "drizzle-orm";
import { db } from "../index";
import { adminProfiles, sessions, twoFactors, users } from "../schema";
import { newId } from "../../lib/crypto";

export type Role = "owner" | "admin" | "viewer";

export const roles: Role[] = ["owner", "admin", "viewer"];

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (roles as string[]).includes(value);
}

export async function countUsers(): Promise<number> {
  const [row] = await db.select({ n: count() }).from(users);
  return row?.n ?? 0;
}

export async function countActiveOwners(): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(users)
    .leftJoin(adminProfiles, eq(adminProfiles.userId, users.id))
    .where(and(eq(users.role, "owner"), isNull(adminProfiles.disabledAt)));
  return row?.n ?? 0;
}

export async function findUserByEmail(email: string) {
  const rows = await db
    .select({ user: users, profile: adminProfiles })
    .from(users)
    .leftJoin(adminProfiles, eq(adminProfiles.userId, users.id))
    .where(eq(users.email, email.trim().toLowerCase()))
    .limit(1);
  return rows[0] ?? null;
}

export async function findUserById(id: string) {
  const rows = await db
    .select({ user: users, profile: adminProfiles })
    .from(users)
    .leftJoin(adminProfiles, eq(adminProfiles.userId, users.id))
    .where(eq(users.id, id))
    .limit(1);
  return rows[0] ?? null;
}

export async function createAdmin(input: { email: string; name: string; role: Role; passwordHash: string; invitedBy?: string | null }) {
  const id = newId("usr");
  const email = input.email.trim().toLowerCase();
  await db.transaction(async (tx) => {
    await tx.insert(users).values({ id, email, name: input.name.trim() || email, role: input.role, twoFactorEnabled: false });
    await tx.insert(adminProfiles).values({ userId: id, passwordHash: input.passwordHash, invitedBy: input.invitedBy ?? null });
  });
  return id;
}

export async function setPasswordHash(userId: string, passwordHash: string) {
  await db.update(adminProfiles).set({ passwordHash }).where(eq(adminProfiles.userId, userId));
}

export async function listAdmins() {
  return db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      role: users.role,
      twoFactorEnabled: sql<boolean>`coalesce(${twoFactors.confirmed}, 0)`,
      disabledAt: adminProfiles.disabledAt,
      lastLoginAt: adminProfiles.lastLoginAt,
      lastLoginIp: adminProfiles.lastLoginIp,
      createdAt: users.createdAt,
    })
    .from(users)
    .leftJoin(adminProfiles, eq(adminProfiles.userId, users.id))
    .leftJoin(twoFactors, eq(twoFactors.userId, users.id))
    .orderBy(asc(users.createdAt));
}

export async function updateRole(userId: string, role: Role) {
  await db.update(users).set({ role }).where(eq(users.id, userId));
}

export async function setDisabled(userId: string, disabled: boolean) {
  await db
    .insert(adminProfiles)
    .values({ userId, disabledAt: disabled ? new Date() : null })
    .onConflictDoUpdate({ target: adminProfiles.userId, set: { disabledAt: disabled ? new Date() : null } });
  if (disabled) await db.delete(sessions).where(eq(sessions.userId, userId));
}

export async function deleteUser(userId: string) {
  await db.delete(users).where(eq(users.id, userId));
}

export async function recordLogin(userId: string, ip: string | null) {
  await db
    .insert(adminProfiles)
    .values({ userId, lastLoginAt: new Date(), lastLoginIp: ip })
    .onConflictDoUpdate({ target: adminProfiles.userId, set: { lastLoginAt: new Date(), lastLoginIp: ip } });
}

export async function hasConfirmedTwoFactor(userId: string): Promise<boolean> {
  const row = await db.query.twoFactors.findFirst({ where: eq(twoFactors.userId, userId) });
  return Boolean(row?.confirmed);
}
