import { Webhook } from "svix";
import { eq } from "drizzle-orm";
import { db } from "../../db";
import { webhookEvents } from "../../db/schema";
import { getSetting } from "../../db/queries/settings";
import { addEvent, getMessageByResendId, setMessageStatus } from "../../db/queries/messages";
import { addSuppression } from "../../db/queries/suppressions";
import { logger } from "../../lib/logger";

export type ResendEvent = {
  type: string;
  created_at: string;
  data: {
    email_id?: string;
    from?: string;
    to?: string[];
    cc?: string[];
    bcc?: string[];
    subject?: string;
    message_id?: string;
    received_for?: string[];
    attachments?: unknown[];
    bounce?: { type?: string; subType?: string; message?: string; diagnosticCode?: string[] };
    failed?: { reason?: string };
    [key: string]: unknown;
  };
};

export type WebhookOutcome = { status: number; message: string };

type InboundHandler = (event: ResendEvent) => Promise<void>;

const store = globalThis as typeof globalThis & { __snapjawInboundHandler?: InboundHandler };

export function onReceived(handler: InboundHandler) {
  store.__snapjawInboundHandler = handler;
}

export async function verifyWebhook(body: string, headers: Headers): Promise<ResendEvent | WebhookOutcome> {
  const secret = await getSetting("resend.webhookSecret");
  if (!secret) return { status: 503, message: "Webhook secret not configured." };
  const id = headers.get("svix-id");
  const timestamp = headers.get("svix-timestamp");
  const signature = headers.get("svix-signature");
  if (!id || !timestamp || !signature) return { status: 400, message: "Missing signature headers." };
  try {
    new Webhook(secret).verify(body, { "svix-id": id, "svix-timestamp": timestamp, "svix-signature": signature });
  } catch {
    return { status: 401, message: "Invalid signature." };
  }
  try {
    const event = JSON.parse(body) as ResendEvent;
    if (!event || typeof event.type !== "string" || typeof event.data !== "object") return { status: 400, message: "Unexpected payload." };
    return event;
  } catch {
    return { status: 400, message: "The body is not JSON." };
  }
}

export async function claimDelivery(svixId: string, type: string): Promise<boolean> {
  const inserted = await db.insert(webhookEvents).values({ svixId, type }).onConflictDoNothing().returning({ svixId: webhookEvents.svixId });
  return inserted.length > 0;
}

const statusFor: Record<string, string> = {
  "email.sent": "sent",
  "email.delivered": "delivered",
  "email.delivery_delayed": "delivery_delayed",
  "email.bounced": "bounced",
  "email.complained": "complained",
  "email.failed": "failed",
  "email.suppressed": "suppressed",
};

function bounceDetail(event: ResendEvent): string {
  const bounce = event.data.bounce;
  if (!bounce) return "The recipient's server rejected the message.";
  const kind = bounce.type === "Permanent" ? "Permanent bounce" : bounce.type === "Temporary" ? "Temporary bounce" : "Bounce";
  const code = bounce.diagnosticCode?.[0] ? ` (${bounce.diagnosticCode[0]})` : "";
  return `${kind}${bounce.subType ? `, ${bounce.subType}` : ""}: ${bounce.message ?? "no reason given"}${code}`;
}

export async function handleEvent(event: ResendEvent): Promise<void> {
  if (event.type === "email.received") {
    if (!store.__snapjawInboundHandler) throw new Error("Inbound handling is not ready.");
    await store.__snapjawInboundHandler(event);
    return;
  }
  const status = statusFor[event.type];
  if (!status || !event.data.email_id) return;
  const message = await getMessageByResendId(event.data.email_id);
  const recipients = event.data.to ?? [];
  if (event.type === "email.bounced") {
    const detail = bounceDetail(event);
    if (event.data.bounce?.type !== "Temporary" && recipients.length === 1) await addSuppression(recipients[0]!, "bounce", detail, event.data.email_id);
    if (message) await setMessageStatus(message.id, "bounced", detail);
    return;
  }
  if (event.type === "email.complained") {
    for (const address of recipients.length === 1 ? recipients : []) await addSuppression(address, "complaint", "The recipient marked the message as spam.", event.data.email_id);
    if (message) await setMessageStatus(message.id, "complained", "The recipient marked the message as spam.");
    return;
  }
  if (!message) return;
  if (event.type === "email.sent") {
    await addEvent(message.id, "sent", "Resend handed the message to the recipient's server.");
    return;
  }
  if (event.type === "email.failed") {
    const reason = typeof event.data.failed?.reason === "string" ? event.data.failed.reason : "Resend could not send the message.";
    await setMessageStatus(message.id, "failed", reason);
    return;
  }
  if (event.type === "email.suppressed") {
    await setMessageStatus(message.id, "suppressed", "Resend skipped the message because the recipient is on its suppression list.");
    return;
  }
  if (event.type === "email.delivery_delayed") {
    await addEvent(message.id, "delivery_delayed", "The recipient's server deferred the message. Resend keeps retrying for up to 14 hours.");
    if (message.status !== "delivered") await setMessageStatus(message.id, "delivery_delayed", null);
    return;
  }
  await setMessageStatus(message.id, status, null);
}

export async function processWebhook(body: string, headers: Headers): Promise<WebhookOutcome> {
  const verified = await verifyWebhook(body, headers);
  if (!("type" in verified)) return verified;
  const event = verified as ResendEvent;
  const svixId = headers.get("svix-id")!;
  if (!(await claimDelivery(svixId, event.type))) return { status: 200, message: "Already processed." };
  try {
    await handleEvent(event);
  } catch (error) {
    await db.delete(webhookEvents).where(eq(webhookEvents.svixId, svixId));
    logger.error(`Webhook ${event.type} failed: ${error instanceof Error ? error.message : String(error)}`);
    return { status: 500, message: "Processing failed. Resend will retry." };
  }
  return { status: 200, message: "ok" };
}
