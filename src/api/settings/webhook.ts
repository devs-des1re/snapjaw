import { requireRole } from "../../../server/http/guard";
import { registerWebhook } from "../../../server/settings/service";
import { respond } from "../../../server/http/respond";

export async function POST(request: Request) {
  const actor = await requireRole(request, "admin");
  if (actor instanceof Response) return actor;
  return respond(await registerWebhook(actor));
}
