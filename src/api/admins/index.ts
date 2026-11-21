import { ok } from "../_http";
import { requireRole } from "../../../server/http/guard";
import { listAdmins } from "../../../db/queries/users";
import { listOpenInvites } from "../../../db/queries/invites";
import { createAdminDirect } from "../../../server/admin/admins";
import { readJson } from "../../../server/http/request";
import { badRequest, respond } from "../../../server/http/respond";

export async function GET(request: Request) {
  const actor = await requireRole(request, "viewer");
  if (actor instanceof Response) return actor;
  const [admins, invites] = await Promise.all([listAdmins(), listOpenInvites()]);
  return ok({ admins: admins.map((a) => ({ ...a, twoFactorEnabled: Boolean(a.twoFactorEnabled) })), invites });
}

export async function POST(request: Request) {
  const actor = await requireRole(request, "admin");
  if (actor instanceof Response) return actor;
  const body = await readJson(request);
  if (!body) return badRequest();
  return respond(await createAdminDirect(actor, body), 201);
}
