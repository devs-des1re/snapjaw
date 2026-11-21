import { ok } from "../../_http";
import { requireRole } from "../../../../server/http/guard";
import { listApiKeys } from "../../../../db/queries/credentials";
import { createApiKey } from "../../../../server/credentials/service";
import { readJson } from "../../../../server/http/request";
import { badRequest, respond } from "../../../../server/http/respond";

export async function GET(request: Request) {
  const actor = await requireRole(request, "viewer");
  if (actor instanceof Response) return actor;
  return ok(await listApiKeys());
}

export async function POST(request: Request) {
  const actor = await requireRole(request, "admin");
  if (actor instanceof Response) return actor;
  const body = await readJson(request);
  if (!body) return badRequest();
  return respond(await createApiKey(actor, body), 201);
}
