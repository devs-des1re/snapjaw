import { fail, ok } from "../../_http";
import { requireRole } from "../../../../server/http/guard";
import { getBlob, getMessage, setMessageStatus } from "../../../../db/queries/messages";
import { retryDead } from "../../../../server/queue/queue";
import { recordAudit } from "../../../../db/queries/audit";
import { retryDeliveries } from "../../../../server/inbound/deliver";

export async function POST(request: Request, context: { params: { id: string } }) {
  const actor = await requireRole(request, "admin");
  if (actor instanceof Response) return actor;
  const message = await getMessage(context.params.id);
  if (!message) return fail("No such message.", 404);
  if (message.direction === "outbound") {
    if (!(await getBlob(message.id))) return fail("The message body is no longer stored, so it cannot be retried.", 409);
    await retryDead("send", message.id);
  } else {
    await retryDeliveries(message.id);
  }
  await setMessageStatus(message.id, "queued", "Retry requested by an admin.");
  await recordAudit(actor, "message.retry", message.id);
  return ok({});
}
