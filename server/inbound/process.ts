import MailComposer from "nodemailer/lib/mail-composer/index.js";
import { createInboundStub, deleteBlob, getBlob, getMessage, putBlob, setMessageStatus, updateMessage } from "../../db/queries/messages";
import { createDeliveries } from "../../db/queries/deliveries";
import { listRoutesWithDestinations } from "../../db/queries/destinations";
import { allDomainNames } from "../../db/queries/domains";
import { getNumberSetting, getSetting } from "../../db/queries/settings";
import { domainOf } from "../../lib/address";
import { logger } from "../../lib/logger";
import { consume } from "../quota/guard";
import { getReceivedEmail, listReceivedAttachments, type ReceivedEmail } from "../resend/api";
import { downloadUrl, explainResendError, ResendError } from "../resend/client";
import { registerHandler, wake, type JobResult } from "../queue/queue";
import { onReceived, type ResendEvent } from "../webhooks/resend";
import { matchRoute } from "./match";

export async function recordReceived(input: { resendId: string; from: string; to: string[]; subject: string | null; messageId: string | null; source: string }) {
  const id = await createInboundStub({
    direction: "inbound",
    resendId: input.resendId,
    messageId: input.messageId,
    fromAddress: input.from.toLowerCase(),
    toAddresses: input.to.map((address) => address.toLowerCase()),
    subject: input.subject,
    size: 0,
    recipients: 1,
    status: "received",
    source: input.source,
    event: `Received by Resend, noticed via ${input.source}`,
  });
  if (id) {
    await consume("received", 1);
    wake();
  }
  return id;
}

function stampHeaders(raw: Buffer, headers: Record<string, string>): Buffer {
  const lines = Object.entries(headers)
    .filter(([, value]) => value)
    .map(([name, value]) => `${name}: ${value.replace(/[\r\n]+/g, " ")}\r\n`)
    .join("");
  return Buffer.concat([Buffer.from(lines, "utf8"), raw]);
}

function hasHeader(raw: Buffer, name: string): boolean {
  const end = raw.indexOf("\r\n\r\n") > -1 ? raw.indexOf("\r\n\r\n") : raw.indexOf("\n\n");
  const head = raw.subarray(0, end > -1 ? end : Math.min(raw.length, 65536)).toString("utf8");
  return new RegExp(`^${name}:`, "im").test(head);
}

async function rebuildMime(email: ReceivedEmail, maxBytes: number): Promise<Buffer> {
  const attachments = email.attachments?.length ? (await listReceivedAttachments(email.id)).data : [];
  const files = [];
  for (const attachment of attachments) {
    files.push({
      filename: attachment.filename,
      content: await downloadUrl(attachment.download_url, maxBytes),
      contentType: attachment.content_type,
      cid: attachment.content_id ?? undefined,
      contentDisposition: (attachment.content_disposition === "inline" ? "inline" : "attachment") as "inline" | "attachment",
    });
  }
  const headers = email.headers ?? {};
  const composer = new MailComposer({
    from: headers.from ?? email.from,
    to: email.to,
    cc: email.cc ?? undefined,
    replyTo: email.reply_to ?? undefined,
    subject: email.subject ?? "",
    messageId: email.message_id ?? undefined,
    date: email.created_at ? new Date(email.created_at) : undefined,
    html: email.html ?? undefined,
    text: email.text ?? undefined,
    attachments: files,
    headers: {
      ...(headers["in-reply-to"] ? { "In-Reply-To": headers["in-reply-to"] } : {}),
      ...(headers.references ? { References: headers.references } : {}),
      "X-Snapjaw-Rebuilt": "true",
    },
  });
  return composer.compile().build();
}

export async function processInbound(messageId: string): Promise<JobResult> {
  const message = await getMessage(messageId);
  if (!message?.resendId) return { status: "done" };
  const existing = await getBlob(messageId);
  if (!existing) {
    const maxBytes = await getNumberSetting("limits.maxMessageBytes");
    let email: ReceivedEmail;
    try {
      email = await getReceivedEmail(message.resendId);
    } catch (error) {
      const explained = explainResendError(error);
      if (error instanceof ResendError && !error.retryable) return { status: "dead", error: `${explained.message} ${explained.fix}` };
      return { status: "retry", error: explained.message };
    }
    let raw: Buffer;
    try {
      raw = email.raw?.download_url ? await downloadUrl(email.raw.download_url, maxBytes) : await rebuildMime(email, maxBytes);
    } catch (error) {
      const explained = explainResendError(error);
      if (error instanceof ResendError && error.code === "too_large") return { status: "dead", error: `${explained.message} ${explained.fix}` };
      return { status: "retry", error: explained.message };
    }
    const instanceId = await getSetting("instance.id");
    const looped = (email.headers?.["x-snapjaw-relay"] ?? "").split(/[\s,]+/).includes(instanceId);
    const stamped = stampHeaders(raw, {
      "X-Snapjaw-Relay": instanceId,
      "X-Snapjaw-Id": message.resendId,
      ...(hasHeader(raw, "message-id") ? {} : { "Message-ID": `<${message.resendId}@snapjaw.invalid>` }),
    });
    const ownDomains = await allDomainNames();
    const candidates = [...new Set([...(email.received_for ?? []), ...email.to, ...(email.cc ?? []), ...(email.bcc ?? [])].map((address) => address.toLowerCase()))];
    const recipients = candidates.filter((address) => ownDomains.includes(domainOf(address)));
    await putBlob(messageId, stamped.toString("base64"), {
      kind: "inbound",
      messageId: email.message_id ?? `<${message.resendId}@snapjaw.invalid>`,
      date: email.created_at,
      looped,
      autoSubmitted: (email.headers?.["auto-submitted"] ?? "no").toLowerCase() !== "no",
      authentication: email.authentication ?? null,
    });
    await updateMessage(messageId, {
      size: stamped.length,
      subject: email.subject ?? message.subject,
      messageId: email.message_id ?? message.messageId,
      fromAddress: (email.from ?? message.fromAddress).toLowerCase(),
      toAddresses: recipients.length ? recipients : candidates,
    });
    const routes = await listRoutesWithDestinations();
    const targets: { destinationId: string; recipient: string }[] = [];
    const unmatched: string[] = [];
    for (const recipient of recipients) {
      const route = matchRoute(recipient, routes);
      if (!route) unmatched.push(recipient);
      else for (const destinationId of route.destinationIds) if (!targets.some((t) => t.destinationId === destinationId)) targets.push({ destinationId, recipient });
    }
    if (!targets.length) {
      await deleteBlob(messageId);
      await setMessageStatus(messageId, "rejected", `No route matches ${(unmatched.length ? unmatched : candidates).join(", ")}. Resend still keeps the message.`);
      return { status: "done" };
    }
    await createDeliveries(messageId, targets);
    await setMessageStatus(messageId, "queued", `Fetched ${stamped.length} bytes. Delivering to ${targets.length} destination(s).${unmatched.length ? ` No route for ${unmatched.join(", ")}.` : ""}`);
    wake();
    return { status: "done" };
  }
  return { status: "done" };
}

export function registerInbound() {
  registerHandler("inbound", (job) => processInbound(job.ref));
  onReceived(async (event: ResendEvent) => {
    const data = event.data;
    if (!data.email_id) return;
    const id = await recordReceived({
      resendId: data.email_id,
      from: data.from ?? "",
      to: [...(data.to ?? []), ...(data.received_for ?? [])],
      subject: data.subject ?? null,
      messageId: data.message_id ?? null,
      source: "webhook",
    });
    if (id) logger.info(`Inbound ${data.email_id} recorded as ${id}`);
  });
}
