import { ok } from "./_http";
import { requireRole } from "../../server/http/guard";
import { findUserById } from "../../db/queries/users";

export async function GET(request: Request) {
  const actor = await requireRole(request, "viewer", { allowWithout2fa: true });
  if (actor instanceof Response) return actor;
  const found = await findUserById(actor.id);
  return ok({
    id: actor.id,
    email: actor.email,
    name: found?.user.name ?? null,
    role: actor.role,
    twoFactorEnabled: Boolean(found?.user.twoFactorEnabled),
    lastLoginAt: found?.profile?.lastLoginAt ?? null,
  });
}
