import { requireRole } from "../../../../server/http/guard";
import { removeRoute, upsertRoute } from "../../../../server/inbound/config";
import { readJson } from "../../../../server/http/request";
import { badRequest, respond } from "../../../../server/http/respond";

export async function PUT(request: Request, context: { params: { id: string } }) {
  const actor = await requireRole(request, "admin");
  if (actor instanceof Response) return actor;
  const body = await readJson(request);
  if (!body) return badRequest();
  return respond(await upsertRoute(actor, context.params.id, body));
}

export async function DELETE(request: Request, context: { params: { id: string } }) {
  const actor = await requireRole(request, "admin");
  if (actor instanceof Response) return actor;
  return respond(await removeRoute(actor, context.params.id));
}
