import { fail, ok } from "../_http";
import { processWebhook } from "../../../server/webhooks/resend";

export async function POST(request: Request) {
  const length = Number(request.headers.get("content-length") ?? "0");
  if (length > 1024 * 1024) return fail("Payload too large.", 413);
  const body = await request.text();
  if (body.length > 1024 * 1024) return fail("Payload too large.", 413);
  const outcome = await processWebhook(body, request.headers);
  return outcome.status === 200 ? ok({ received: true, note: outcome.message }) : fail(outcome.message, outcome.status);
}
