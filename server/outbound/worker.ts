import { deleteBlob, getBlob, getMessage, setMessageStatus, updateMessage } from "../../db/queries/messages";
import { getSetting } from "../../db/queries/settings";
import { consume, evaluate, quotaStatus } from "../quota/guard";
import { ResendError, explainResendError } from "../resend/client";
import { sendEmail, type SendEmailPayload } from "../resend/api";
import { registerHandler, onDeadJob, type JobResult } from "../queue/queue";
import { nextReset } from "./accept";
import { buildPayload, parseMime } from "./mime";
import { logger } from "../../lib/logger";

type BlobMeta = { kind: "mime" | "json"; envelopeFrom?: string; envelopeTo?: string[] };

async function payloadFor(messageId: string): Promise<SendEmailPayload | null> {
  const blob = await getBlob(messageId);
  if (!blob) return null;
  const meta = (blob.meta ?? { kind: "mime" }) as BlobMeta;
  if (meta.kind === "json") return JSON.parse(blob.data) as SendEmailPayload;
  const parsed = await parseMime(Buffer.from(blob.data, "base64"));
  return buildPayload(parsed, { from: meta.envelopeFrom ?? "", to: meta.envelopeTo ?? [] }, await getSetting("instance.id"));
}

export async function sendJob(messageId: string): Promise<JobResult> {
  const message = await getMessage(messageId);
  if (!message) return { status: "done" };
  if (message.resendId) {
    await deleteBlob(messageId);
    return { status: "done" };
  }
  const payload = await payloadFor(messageId);
  if (!payload) return { status: "done" };

  const units = message.recipients;
  const status = await quotaStatus();
  const decision = evaluate(status, units);
  if (!decision.allowed) {
    const until = nextReset(decision.reason.includes("monthly") ? "month" : "day");
    if (message.status !== "held") await setMessageStatus(messageId, "held", `${decision.reason} Held until ${until.toISOString()}.`);
    return { status: "retry", error: decision.reason, delayMs: until.getTime() - Date.now(), countAttempt: false };
  }

  try {
    const result = await sendEmail(payload, `snapjaw-${messageId}`);
    await updateMessage(messageId, { resendId: result.id });
    await setMessageStatus(messageId, "sent", `Accepted by Resend as ${result.id}`);
    await consume("sent", units);
    await deleteBlob(messageId);
    return { status: "done" };
  } catch (error) {
    const explained = explainResendError(error);
    if (error instanceof ResendError && error.quota) {
      const until = nextReset(error.code === "monthly_quota_exceeded" ? "month" : "day");
      await setMessageStatus(messageId, "held", `${explained.message} Held until ${until.toISOString()}.`);
      return { status: "retry", error: explained.message, delayMs: until.getTime() - Date.now(), countAttempt: false };
    }
    if (error instanceof ResendError && !error.retryable) {
      return { status: "dead", error: `${explained.message} ${explained.fix}` };
    }
    const delayMs = error instanceof ResendError && error.retryAfterSeconds ? error.retryAfterSeconds * 1000 : undefined;
    await setMessageStatus(messageId, "queued", `Send attempt failed, will retry: ${explained.message}`);
    return { status: "retry", error: explained.message, delayMs };
  }
}

export function registerOutbound() {
  registerHandler("send", (job) => sendJob(job.ref));
  onDeadJob(async (kind, ref, error) => {
    if (kind !== "send") return;
    await setMessageStatus(ref, "failed", error);
    logger.warn(`Outbound message ${ref} failed for good: ${error}`);
  });
}
