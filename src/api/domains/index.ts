import { ok } from "../_http";
import { requireRole } from "../../../server/http/guard";
import { listDomainRows } from "../../../db/queries/domains";
import { addDomain } from "../../../server/domains/service";
import { readJson } from "../../../server/http/request";
import { badRequest, respond } from "../../../server/http/respond";

export async function GET(request: Request) {
  const actor = await requireRole(request, "viewer");
  if (actor instanceof Response) return actor;
  return ok(await listDomainRows());
}

export async function POST(request: Request) {
  const actor = await requireRole(request, "admin");
  if (actor instanceof Response) return actor;
  const body = await readJson(request);
  if (!body) return badRequest();
  return respond(await addDomain(actor, body), 201);
}
