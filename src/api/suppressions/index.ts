import { fail, ok } from "../_http";
import { requireRole } from "../../../server/http/guard";
import { addSuppression, listSuppressions } from "../../../db/queries/suppressions";
import { recordAudit } from "../../../db/queries/audit";
import { readJson } from "../../../server/http/request";
import { badRequest } from "../../../server/http/respond";
import { isEmail } from "../../../lib/address";

export async function GET(request: Request) {
  const actor = await requireRole(request, "viewer");
  if (actor instanceof Response) return actor;
  const q = new URL(request.url).searchParams.get("q")?.slice(0, 200) || undefined;
  return ok(await listSuppressions(q));
}

export async function POST(request: Request) {
  const actor = await requireRole(request, "admin");
  if (actor instanceof Response) return actor;
  const body = await readJson<{ email?: unknown; detail?: unknown }>(request);
  if (!body) return badRequest();
  if (!isEmail(body.email)) return fail("Enter a valid email address.", 422);
  await addSuppression(body.email, "manual", typeof body.detail === "string" ? body.detail.slice(0, 300) : null, actor.email);
  await recordAudit(actor, "suppression.add", body.email.toLowerCase());
  return ok({}, 201);
}
