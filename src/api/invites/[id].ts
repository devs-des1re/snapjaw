import { requireRole } from "../../../server/http/guard";
import { revokeAdminInvite } from "../../../server/admin/admins";
import { respond } from "../../../server/http/respond";

export async function DELETE(request: Request, context: { params: { id: string } }) {
  const actor = await requireRole(request, "admin");
  if (actor instanceof Response) return actor;
  return respond(await revokeAdminInvite(actor, context.params.id));
}
