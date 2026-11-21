import { requireRole } from "../../../server/http/guard";
import { testResend } from "../../../server/settings/service";
import { readJson } from "../../../server/http/request";
import { respond } from "../../../server/http/respond";

export async function POST(request: Request) {
  const actor = await requireRole(request, "admin");
  if (actor instanceof Response) return actor;
  const body = await readJson<{ apiKey?: unknown }>(request);
  const apiKey = typeof body?.apiKey === "string" && body.apiKey.trim() ? body.apiKey.trim() : undefined;
  return respond(await testResend(apiKey));
}
