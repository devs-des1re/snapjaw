import { ok } from "../_http";
import { requireRole } from "../../../server/http/guard";
import { readSettings, updateSettings, webhookUrl } from "../../../server/settings/service";
import { readJson } from "../../../server/http/request";
import { badRequest, respond } from "../../../server/http/respond";
import { env } from "../../../lib/env";
import { certificateInfo } from "../../../server/tls/certs";
import { acmeStatus } from "../../../server/tls/acme";
import { reconcilerState } from "../../../server/inbound/reconcile";
import { oauthRedirectUri } from "../../../server/destinations/gmail";

export async function GET(request: Request) {
  const actor = await requireRole(request, "viewer");
  if (actor instanceof Response) return actor;
  const config = env();
  return ok({
    settings: await readSettings(),
    webhookUrl: webhookUrl(),
    publicUrl: config.publicUrl,
    smtpHostname: config.smtpHostname,
    googleRedirectUri: oauthRedirectUri(),
    tls: await certificateInfo().catch(() => null),
    acme: acmeStatus(),
    reconciler: reconcilerState(),
    role: actor.role,
  });
}

export async function PATCH(request: Request) {
  const actor = await requireRole(request, "admin");
  if (actor instanceof Response) return actor;
  const body = await readJson(request);
  if (!body) return badRequest();
  return respond(await updateSettings(actor, body));
}
