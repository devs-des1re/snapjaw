import { createQueuedMessage, pendingOutboundUnits } from "../../db/queries/messages";
import { recipientsInLastHour } from "../../db/queries/credentials";
import { verifiedDomainNames } from "../../db/queries/domains";
import { suppressedAmong } from "../../db/queries/suppressions";
import { getNumberSetting, getSetting } from "../../db/queries/settings";
import { domainOf, senderAllowed } from "../../lib/address";
import { evaluate, quotaStatus } from "../quota/guard";
import { wake } from "../queue/queue";
import { addressList, headerValue, parseMime, relayHeader } from "./mime";

export type Sender = { id: string; kind: "smtp" | "api"; allowedSenders: string[]; ratePerHour: number };

export type Rejection = { ok: false; smtpCode: number; enhanced: string; message: string; httpStatus: number };

export type Accepted = { ok: true; id: string; held: boolean };

export function reject(smtpCode: number, enhanced: string, message: string, httpStatus: number): Rejection {
  return { ok: false, smtpCode, enhanced, message, httpStatus };
}

export function nextReset(reason: "day" | "month", now = new Date()): Date {
  if (reason === "day") return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 1));
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 1));
}

export async function checkSender(sender: Sender, address: string): Promise<Rejection | null> {
  if (!senderAllowed(address, sender.allowedSenders)) {
    return reject(550, "5.7.1", `This credential may not send as ${address}. Add it to the allowed senders in Snapjaw.`, 403);
  }
  const verified = await verifiedDomainNames();
  if (!verified.includes(domainOf(address))) {
    return reject(550, "5.7.1", `The domain ${domainOf(address)} is not verified in Snapjaw. Add it under Domains and finish DNS setup.`, 403);
  }
  return null;
}

export async function checkRecipient(address: string): Promise<Rejection | null> {
  const suppressed = await suppressedAmong([address]);
  if (suppressed.size) return reject(550, "5.1.1", `${address} is on the suppression list after a bounce or complaint.`, 422);
  return null;
}

export async function acceptMime(input: { raw: Buffer; envelopeFrom: string; envelopeTo: string[]; sender: Sender; source: string }): Promise<Accepted | Rejection> {
  const maxBytes = await getNumberSetting("limits.maxMessageBytes");
  if (input.raw.length > maxBytes) return reject(552, "5.3.4", `The message is larger than the ${maxBytes} byte limit.`, 413);
  const parsed = await parseMime(input.raw);
  const instanceId = await getSetting("instance.id");
  const relay = headerValue(parsed, relayHeader);
  if (relay && relay.split(/[\s,]+/).includes(instanceId)) return reject(554, "5.4.6", "Mail loop detected: this message already passed through this Snapjaw.", 508);

  const fromAddresses = addressList(parsed.from);
  if (fromAddresses.length !== 1) return reject(550, "5.6.0", "The From header must hold exactly one address.", 422);
  const headerFrom = fromAddresses[0]!;
  const headerProblem = await checkSender(input.sender, headerFrom);
  if (headerProblem) return headerProblem;
  if (input.envelopeFrom && input.envelopeFrom.toLowerCase() !== headerFrom) {
    const envelopeProblem = await checkSender(input.sender, input.envelopeFrom);
    if (envelopeProblem) return envelopeProblem;
  }

  const recipients = [...new Set(input.envelopeTo.map((address) => address.toLowerCase()))];
  if (!recipients.length) return reject(554, "5.5.1", "The message has no recipients.", 422);
  if (recipients.length > 50) return reject(452, "4.5.3", "Too many recipients. Resend accepts at most 50 per message.", 422);
  const suppressed = await suppressedAmong(recipients);
  if (suppressed.size) return reject(550, "5.1.1", `These recipients are suppressed after a bounce or complaint: ${[...suppressed].join(", ")}.`, 422);

  const maxAttachments = await getNumberSetting("limits.maxAttachments");
  if (parsed.attachments.length > maxAttachments) return reject(552, "5.3.4", `The message has ${parsed.attachments.length} attachments. The limit is ${maxAttachments}.`, 413);

  const units = recipients.length + (addressList(parsed.to).length ? 0 : 1);
  const lastHour = await recipientsInLastHour(input.sender.id);
  if (input.sender.ratePerHour > 0 && lastHour + recipients.length > input.sender.ratePerHour) {
    return reject(451, "4.7.1", `This credential is over its limit of ${input.sender.ratePerHour} recipients per hour. Try again later.`, 429);
  }

  const status = await quotaStatus();
  const pending = await pendingOutboundUnits();
  const decision = evaluate({ ...status, day: status.day + pending, month: status.month + pending }, units);
  let held = false;
  let runAt: Date | undefined;
  if (!decision.allowed) {
    if (decision.mode === "reject") return reject(550, "5.7.0", `${decision.reason} The message was not accepted.`, 429);
    held = true;
    runAt = nextReset(decision.reason.includes("monthly") ? "month" : "day");
  }

  const id = await createQueuedMessage({
    direction: "outbound",
    messageId: parsed.messageId ?? null,
    fromAddress: headerFrom,
    toAddresses: recipients,
    subject: parsed.subject ?? null,
    size: input.raw.length,
    recipients: units,
    status: held ? "held" : "queued",
    source: input.source,
    credentialId: input.sender.id,
    blob: input.raw.toString("base64"),
    blobMeta: { kind: "mime", envelopeFrom: input.envelopeFrom, envelopeTo: recipients },
    jobKind: "send",
    runAt,
    event: held ? `Accepted and held until ${runAt!.toISOString()}: ${decision.allowed ? "" : decision.reason}` : `Accepted over ${input.source}`,
  });
  wake();
  return { ok: true, id, held };
}
