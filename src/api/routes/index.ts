import { ok } from "../_http";
import { requireRole } from "../../../server/http/guard";
import { listRoutesWithDestinations } from "../../../db/queries/destinations";
import { upsertRoute } from "../../../server/inbound/config";
import { readJson } from "../../../server/http/request";
import { badRequest, respond } from "../../../server/http/respond";

export async function GET(request: Request) {
  const actor = await requireRole(request, "viewer");
  if (actor instanceof Response) return actor;
  return ok(await listRoutesWithDestinations());
}

export async function POST(request: Request) {
  const actor = await requireRole(request, "admin");
  if (actor instanceof Response) return actor;
  const body = await readJson(request);
  if (!body) return badRequest();
  return respond(await upsertRoute(actor, null, body), 201);
}
