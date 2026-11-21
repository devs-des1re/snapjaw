import { requireRole } from "../../../../server/http/guard";
import { revokeKey, updateKey } from "../../../../server/credentials/service";
import { readJson } from "../../../../server/http/request";
import { badRequest, respond } from "../../../../server/http/respond";

export async function PATCH(request: Request, context: { params: { id: string } }) {
  const actor = await requireRole(request, "admin");
  if (actor instanceof Response) return actor;
  const body = await readJson(request);
  if (!body) return badRequest();
  return respond(await updateKey(actor, context.params.id, body));
}

export async function DELETE(request: Request, context: { params: { id: string } }) {
  const actor = await requireRole(request, "admin");
  if (actor instanceof Response) return actor;
  return respond(await revokeKey(actor, context.params.id));
}
