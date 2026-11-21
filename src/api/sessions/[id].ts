import { fail, ok } from "../_http";
import { requireRole } from "../../../server/http/guard";
import { revokeSession } from "../../../db/queries/sessions";
import { recordAudit } from "../../../db/queries/audit";

export async function DELETE(request: Request, context: { params: { id: string } }) {
  const actor = await requireRole(request, "viewer", { allowWithout2fa: true });
  if (actor instanceof Response) return actor;
  const removed = await revokeSession(actor.id, context.params.id);
  if (!removed) return fail("No such session.", 404);
  await recordAudit(actor, "auth.session_revoke", context.params.id);
  return ok({});
}
