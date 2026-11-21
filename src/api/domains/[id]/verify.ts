import { requireRole } from "../../../../server/http/guard";
import { recheckDomain } from "../../../../server/domains/service";
import { respond } from "../../../../server/http/respond";

export async function POST(request: Request, context: { params: { id: string } }) {
  const actor = await requireRole(request, "admin");
  if (actor instanceof Response) return actor;
  return respond(await recheckDomain(actor, context.params.id));
}
