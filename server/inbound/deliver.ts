import { deleteBlob, getBlob, getMessage, setMessageStatus } from "../../db/queries/messages";
import { deliveriesFor, getDelivery, resetFailedDeliveries, setDeliveryError, setDeliveryState } from "../../db/queries/deliveries";
import { getDestination, setDestinationHealth, type ForwardConfig, type GmailConfig, type ImapConfig } from "../../db/queries/destinations";
import { getSetting } from "../../db/queries/settings";
import { logger } from "../../lib/logger";
import { consume, evaluate, quotaStatus } from "../quota/guard";
import { gmailHasMessage, gmailImport } from "../destinations/gmail";
import { imapAppend, imapHasMessage } from "../destinations/imap";
import { forwardViaResend } from "../destinations/forward";
import { parseMime } from "../outbound/mime";
import { nextReset } from "../outbound/accept";
import { ResendError, explainResendError } from "../resend/client";
import { onDeadJob, registerHandler, wake, type JobResult } from "../queue/queue";
import { notify } from "../ops/alerts";

type InboundMeta = { kind: "inbound"; messageId: string; date?: string; looped?: boolean; autoSubmitted?: boolean };

function permanent(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error);
  return /AUTHENTICATIONFAILED|Invalid credentials|invalid_grant|unauthorized_client|Mailbox doesn't exist|NONEXISTENT/i.test(text);
}

export async function settleMessage(messageId: string) {
  const rows = await deliveriesFor(messageId);
  if (!rows.length || rows.some((row) => row.state === "pending" || row.state === "in_flight")) return;
  const done = rows.filter((row) => row.state === "done").length;
  const failed = rows.filter((row) => row.state === "failed");
  if (!failed.length) {
    await deleteBlob(messageId);
    await setMessageStatus(messageId, "delivered", `Delivered to ${done} destination(s).`);
  } else if (done) {
    await setMessageStatus(messageId, "partial", `Delivered to ${done}, failed for ${failed.length}: ${failed.map((row) => row.error).join("; ")}`);
  } else {
    await setMessageStatus(messageId, "failed", failed.map((row) => row.error).join("; "));
  }
}

export async function deliverJob(deliveryId: string): Promise<JobResult> {
  const delivery = await getDelivery(deliveryId);
  if (!delivery || delivery.state === "done" || delivery.state === "skipped") return { status: "done" };
  const destination = await getDestination(delivery.destinationId);
  if (!destination) {
    await setDeliveryState(deliveryId, "failed", "The destination was removed.");
    await settleMessage(delivery.messageId);
    return { status: "done" };
  }
  const blob = await getBlob(delivery.messageId);
  if (!blob) {
    await setDeliveryState(deliveryId, "failed", "The message body is no longer stored.");
    await settleMessage(delivery.messageId);
    return { status: "done" };
  }
  const meta = blob.meta as InboundMeta;
  const raw = Buffer.from(blob.data, "base64");
  const wasInFlight = delivery.state === "in_flight";

  if (destination.type === "forward" && (meta.looped || meta.autoSubmitted)) {
    await setDeliveryState(deliveryId, "skipped", meta.looped ? "Not forwarded: the message already passed through Snapjaw, so forwarding could loop." : "Not forwarded: the message is an automatic reply.");
    await settleMessage(delivery.messageId);
    return { status: "done" };
  }

  if (destination.type === "forward") {
    const decision = evaluate(await quotaStatus(), 1);
    if (!decision.allowed) {
      const until = nextReset(decision.reason.includes("monthly") ? "month" : "day");
      return { status: "retry", error: decision.reason, delayMs: until.getTime() - Date.now(), countAttempt: false };
    }
  }

  await setDeliveryState(deliveryId, "in_flight", null);
  try {
    if (destination.type === "imap") {
      const config = destination.config as ImapConfig;
      if (wasInFlight && (await imapHasMessage(config, meta.messageId))) {
        logger.info(`Delivery ${deliveryId} was already in ${config.mailbox}. Skipping the append.`);
      } else {
        await imapAppend(config, raw, meta.date ? new Date(meta.date) : undefined);
      }
    } else if (destination.type === "gmail") {
      const config = destination.config as GmailConfig;
      if (!config.refreshToken) throw new Error("The Gmail destination is not connected. Open Destinations and connect it.");
      if (wasInFlight && (await gmailHasMessage(config, meta.messageId))) {
        logger.info(`Delivery ${deliveryId} was already in Gmail. Skipping the import.`);
      } else {
        await gmailImport(config, raw);
      }
    } else {
      const parsed = await parseMime(raw);
      await forwardViaResend(parsed, destination.config as ForwardConfig, await getSetting("instance.id"), `snapjaw-fwd-${deliveryId}`);
      await consume("sent", 1);
    }
    await setDeliveryState(deliveryId, "done", null);
    await setDestinationHealth(destination.id, "ok", null);
    await settleMessage(delivery.messageId);
    return { status: "done" };
  } catch (error) {
    const message = error instanceof ResendError ? `${explainResendError(error).message}` : error instanceof Error ? error.message : String(error);
    await setDeliveryError(deliveryId, message);
    await setDestinationHealth(destination.id, "failing", message);
    if (error instanceof ResendError && error.quota) {
      const until = nextReset(error.code === "monthly_quota_exceeded" ? "month" : "day");
      return { status: "retry", error: message, delayMs: until.getTime() - Date.now(), countAttempt: false };
    }
    if (permanent(error) || (error instanceof ResendError && !error.retryable)) return { status: "dead", error: message };
    return { status: "retry", error: message };
  }
}

export async function retryDeliveries(messageId: string) {
  const count = await resetFailedDeliveries(messageId);
  wake();
  return count;
}

export function registerDelivery() {
  registerHandler("deliver", (job) => deliverJob(job.ref));
  onDeadJob(async (kind, ref, error) => {
    if (kind === "deliver") {
      const delivery = await getDelivery(ref);
      if (!delivery) return;
      await setDeliveryState(ref, "failed", error);
      await settleMessage(delivery.messageId);
      const destination = await getDestination(delivery.destinationId);
      await notify(`Delivery to ${destination?.name ?? "a destination"} failed`, `Snapjaw gave up delivering a message to ${destination?.name ?? delivery.destinationId}: ${error}`, `deliver-${delivery.destinationId}`);
      return;
    }
    if (kind === "inbound") {
      const message = await getMessage(ref);
      if (message) await setMessageStatus(ref, "failed", error);
    }
  });
}
