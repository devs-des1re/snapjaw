import { fail, ok } from "../../_http";
import { requireRole } from "../../../../server/http/guard";
import { messageDetail } from "../../../../db/queries/messages";
import { explainStatus } from "../../../../server/ops/explain";

export async function GET(request: Request, context: { params: { id: string } }) {
  const actor = await requireRole(request, "viewer");
  if (actor instanceof Response) return actor;
  const detail = await messageDetail(context.params.id);
  if (!detail) return fail("No such message.", 404);
  return ok({ ...detail, help: explainStatus(detail.message.status, detail.message.error) });
}
