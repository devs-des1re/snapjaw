import { requireRole } from "../../../../server/http/guard";
import { testDestination } from "../../../../server/inbound/config";
import { respond } from "../../../../server/http/respond";

export async function POST(request: Request, context: { params: { id: string } }) {
  const actor = await requireRole(request, "admin");
  if (actor instanceof Response) return actor;
  return respond(await testDestination(actor, context.params.id));
}
