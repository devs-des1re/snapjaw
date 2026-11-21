import { ok } from "../_http";
import { requireRole } from "../../../server/http/guard";
import { createDestination, listDestinations } from "../../../server/inbound/config";
import { readJson } from "../../../server/http/request";
import { badRequest, respond } from "../../../server/http/respond";
import { oauthRedirectUri } from "../../../server/destinations/gmail";
import { getSetting } from "../../../db/queries/settings";

export async function GET(request: Request) {
  const actor = await requireRole(request, "viewer");
  if (actor instanceof Response) return actor;
  return ok({ destinations: await listDestinations(), gmail: { redirectUri: oauthRedirectUri(), configured: Boolean((await getSetting("google.clientId")) && (await getSetting("google.clientSecret"))) } });
}

export async function POST(request: Request) {
  const actor = await requireRole(request, "admin");
  if (actor instanceof Response) return actor;
  const body = await readJson(request);
  if (!body) return badRequest();
  return respond(await createDestination(actor, body), 201);
}
