import { ok } from "../_http";
import { requireRole } from "../../../server/http/guard";
import { readSettings, updateSettings, webhookUrl } from "../../../server/settings/service";
import { readJson } from "../../../server/http/request";
import { badRequest, respond } from "../../../server/http/respond";
import { env } from "../../../lib/env";

export async function GET(request: Request) {
  const actor = await requireRole(request, "viewer");
  if (actor instanceof Response) return actor;
  const config = env();
  return ok({ settings: await readSettings(), webhookUrl: webhookUrl(), publicUrl: config.publicUrl, smtpHostname: config.smtpHostname });
}

export async function PATCH(request: Request) {
  const actor = await requireRole(request, "admin");
  if (actor instanceof Response) return actor;
  const body = await readJson(request);
  if (!body) return badRequest();
  return respond(await updateSettings(actor, body));
}
