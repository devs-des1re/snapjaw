import { ok } from "../_http";
import { requireRole } from "../../../server/http/guard";
import { removeSuppression } from "../../../db/queries/suppressions";
import { recordAudit } from "../../../db/queries/audit";

export async function DELETE(request: Request, context: { params: { email: string } }) {
  const actor = await requireRole(request, "admin");
  if (actor instanceof Response) return actor;
  const email = decodeURIComponent(context.params.email).toLowerCase();
  await removeSuppression(email);
  await recordAudit(actor, "suppression.remove", email);
  return ok({});
}
