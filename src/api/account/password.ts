import { requireRole } from "../../../server/http/guard";
import { changeOwnPassword } from "../../../server/admin/admins";
import { readJson } from "../../../server/http/request";
import { badRequest, respond } from "../../../server/http/respond";
import { currentToken } from "../sessions/index";

export async function POST(request: Request) {
  const actor = await requireRole(request, "viewer", { allowWithout2fa: true });
  if (actor instanceof Response) return actor;
  const body = await readJson(request);
  if (!body) return badRequest();
  return respond(await changeOwnPassword(actor, body, currentToken(request)));
}
