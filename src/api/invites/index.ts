import { requireRole } from "../../../server/http/guard";
import { inviteAdmin } from "../../../server/admin/admins";
import { readJson } from "../../../server/http/request";
import { badRequest, respond } from "../../../server/http/respond";

export async function POST(request: Request) {
  const actor = await requireRole(request, "admin");
  if (actor instanceof Response) return actor;
  const body = await readJson(request);
  if (!body) return badRequest();
  return respond(await inviteAdmin(actor, body), 201);
}
