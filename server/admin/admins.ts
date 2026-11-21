import { recordAudit } from "../../db/queries/audit";
import { createInvite, findOpenInvite, markInviteAccepted, revokeInvite } from "../../db/queries/invites";
import {
  countActiveOwners,
  createAdmin,
  deleteUser,
  findUserByEmail,
  findUserById,
  isRole,
  setDisabled,
  setPasswordHash,
  updateRole,
  type Role,
} from "../../db/queries/users";
import { revokeAllSessions } from "../../db/queries/sessions";
import { isEmail } from "../../lib/address";
import { hashPassword, passwordProblem, verifyPassword } from "../../lib/passwords";
import { env } from "../../lib/env";
import { roleAtLeast, type Actor } from "../http/guard";

export type Result<T = Record<string, unknown>> = { ok: true; data: T } | { ok: false; status: number; error: string };

const err = (status: number, error: string): Result<never> => ({ ok: false, status, error });

function canManage(actor: Actor, targetRole: Role): boolean {
  if (actor.role === "owner") return true;
  return actor.role === "admin" && targetRole !== "owner";
}

export async function createAdminDirect(actor: Actor, input: Record<string, unknown>): Promise<Result<{ id: string }>> {
  if (!roleAtLeast(actor.role, "admin")) return err(403, "Your role does not allow this.");
  if (!isEmail(input.email)) return err(422, "Enter a valid email address.");
  if (!isRole(input.role)) return err(422, "Pick a role.");
  if (!canManage(actor, input.role)) return err(403, "Only an owner can create another owner.");
  const password = typeof input.password === "string" ? input.password : "";
  const problem = passwordProblem(password);
  if (problem) return err(422, problem);
  if (await findUserByEmail(input.email)) return err(409, "An admin with that email already exists.");
  const id = await createAdmin({ email: input.email, name: typeof input.name === "string" ? input.name : "", role: input.role, passwordHash: await hashPassword(password), invitedBy: actor.id });
  await recordAudit(actor, "admin.create", input.email, { role: input.role, id });
  return { ok: true, data: { id } };
}

export async function inviteAdmin(actor: Actor, input: Record<string, unknown>): Promise<Result<{ id: string; url: string; expiresAt: Date }>> {
  if (!roleAtLeast(actor.role, "admin")) return err(403, "Your role does not allow this.");
  if (!isEmail(input.email)) return err(422, "Enter a valid email address.");
  if (!isRole(input.role)) return err(422, "Pick a role.");
  if (!canManage(actor, input.role)) return err(403, "Only an owner can invite another owner.");
  if (await findUserByEmail(input.email)) return err(409, "An admin with that email already exists.");
  const invite = await createInvite({ email: input.email, role: input.role, createdBy: actor.id });
  await recordAudit(actor, "admin.invite", input.email, { role: input.role, id: invite.id });
  return { ok: true, data: { id: invite.id, url: `${env().publicUrl}/invite?token=${invite.token}`, expiresAt: invite.expiresAt } };
}

export async function revokeAdminInvite(actor: Actor, id: string): Promise<Result> {
  if (!roleAtLeast(actor.role, "admin")) return err(403, "Your role does not allow this.");
  await revokeInvite(id);
  await recordAudit(actor, "admin.invite_revoke", id);
  return { ok: true, data: {} };
}

export async function acceptInvite(input: Record<string, unknown>, info: { ip: string | null; userAgent: string | null }): Promise<Result<{ id: string }>> {
  if (typeof input.token !== "string") return err(422, "The invite link is incomplete.");
  const invite = await findOpenInvite(input.token);
  if (!invite) return err(404, "This invite has expired or was already used.");
  const password = typeof input.password === "string" ? input.password : "";
  const problem = passwordProblem(password);
  if (problem) return err(422, problem);
  if (await findUserByEmail(invite.email)) return err(409, "An admin with that email already exists.");
  const id = await createAdmin({ email: invite.email, name: typeof input.name === "string" ? input.name : "", role: invite.role, passwordHash: await hashPassword(password), invitedBy: invite.createdBy });
  await markInviteAccepted(invite.id);
  await recordAudit({ id, email: invite.email, ...info }, "admin.invite_accept", invite.email, { role: invite.role, invite: invite.id });
  return { ok: true, data: { id } };
}

export async function changeAdmin(actor: Actor, targetId: string, input: Record<string, unknown>): Promise<Result> {
  if (!roleAtLeast(actor.role, "admin")) return err(403, "Your role does not allow this.");
  const target = await findUserById(targetId);
  if (!target) return err(404, "No such admin.");
  const currentRole = isRole(target.user.role) ? target.user.role : "viewer";
  if (!canManage(actor, currentRole)) return err(403, "Only an owner can change an owner.");
  if (targetId === actor.id) return err(422, "You cannot change your own role or status.");

  if (input.role !== undefined) {
    if (!isRole(input.role)) return err(422, "Pick a role.");
    if (!canManage(actor, input.role)) return err(403, "Only an owner can grant the owner role.");
    if (currentRole === "owner" && input.role !== "owner" && (await countActiveOwners()) <= 1) return err(422, "At least one owner must remain.");
    await updateRole(targetId, input.role);
    await recordAudit(actor, "admin.role_change", target.user.email, { from: currentRole, to: input.role });
  }
  if (input.disabled !== undefined) {
    const disabled = input.disabled === true;
    if (disabled && currentRole === "owner" && (await countActiveOwners()) <= 1) return err(422, "At least one owner must remain.");
    await setDisabled(targetId, disabled);
    await recordAudit(actor, disabled ? "admin.disable" : "admin.enable", target.user.email);
  }
  return { ok: true, data: {} };
}

export async function removeAdmin(actor: Actor, targetId: string): Promise<Result> {
  if (!roleAtLeast(actor.role, "admin")) return err(403, "Your role does not allow this.");
  if (targetId === actor.id) return err(422, "You cannot remove yourself.");
  const target = await findUserById(targetId);
  if (!target) return err(404, "No such admin.");
  const role = isRole(target.user.role) ? target.user.role : "viewer";
  if (!canManage(actor, role)) return err(403, "Only an owner can remove an owner.");
  if (role === "owner" && !target.profile?.disabledAt && (await countActiveOwners()) <= 1) return err(422, "At least one owner must remain.");
  await deleteUser(targetId);
  await recordAudit(actor, "admin.remove", target.user.email, { role });
  return { ok: true, data: {} };
}

export async function changeOwnPassword(actor: Actor, input: Record<string, unknown>, keepSession?: string): Promise<Result> {
  const target = await findUserById(actor.id);
  if (!target) return err(404, "No such admin.");
  if (typeof input.current !== "string" || !(await verifyPassword(input.current, target.profile?.passwordHash))) return err(422, "The current password is wrong.");
  const next = typeof input.next === "string" ? input.next : "";
  const problem = passwordProblem(next);
  if (problem) return err(422, problem);
  await setPasswordHash(actor.id, await hashPassword(next));
  await revokeAllSessions(actor.id, keepSession);
  await recordAudit(actor, "auth.password_change", actor.email);
  return { ok: true, data: {} };
}
