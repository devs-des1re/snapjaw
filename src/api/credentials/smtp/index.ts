import { ok } from "../../_http";
import { requireRole } from "../../../../server/http/guard";
import { listSmtpCredentials } from "../../../../db/queries/credentials";
import { createSmtpCredential } from "../../../../server/credentials/service";
import { readJson } from "../../../../server/http/request";
import { badRequest, respond } from "../../../../server/http/respond";
import { env } from "../../../../lib/env";

export async function GET(request: Request) {
  const actor = await requireRole(request, "viewer");
  if (actor instanceof Response) return actor;
  return ok({ credentials: await listSmtpCredentials(), server: { hostname: env().smtpHostname, submissionPort: 587, smtpsPort: 465 } });
}

export async function POST(request: Request) {
  const actor = await requireRole(request, "admin");
  if (actor instanceof Response) return actor;
  const body = await readJson(request);
  if (!body) return badRequest();
  return respond(await createSmtpCredential(actor, body), 201);
}
