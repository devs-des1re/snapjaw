import { simpleParser, type AddressObject, type EmailAddress, type ParsedMail } from "mailparser";
import type { SendAttachment, SendEmailPayload } from "../resend/api";

export const relayHeader = "x-snapjaw-relay";

const passHeaders = new Set([
  "message-id",
  "in-reply-to",
  "references",
  "list-unsubscribe",
  "list-unsubscribe-post",
  "list-id",
  "auto-submitted",
  "precedence",
  "importance",
  "priority",
  "x-priority",
  "x-entity-ref-id",
  "thread-topic",
  "thread-index",
]);

export function parseMime(raw: Buffer): Promise<ParsedMail> {
  return simpleParser(raw, { skipHtmlToText: false, skipTextToHtml: true, skipImageLinks: true, maxHtmlLengthToParse: 10 * 1024 * 1024 });
}

function flatten(value: AddressObject | AddressObject[] | undefined): EmailAddress[] {
  if (!value) return [];
  const list = Array.isArray(value) ? value : [value];
  const out: EmailAddress[] = [];
  const walk = (entries: EmailAddress[]) => {
    for (const entry of entries) {
      if (entry.group) walk(entry.group);
      else if (entry.address) out.push(entry);
    }
  };
  for (const item of list) walk(item.value);
  return out;
}

export function addressList(value: AddressObject | AddressObject[] | undefined): string[] {
  return flatten(value).map((entry) => entry.address!.toLowerCase());
}

function quoteName(name: string): string {
  return /^[\w .'-]+$/.test(name) ? name : `"${name.replace(/(["\\])/g, "\\$1")}"`;
}

export function formatted(value: AddressObject | AddressObject[] | undefined): string[] {
  return flatten(value).map((entry) => (entry.name ? `${quoteName(entry.name)} <${entry.address}>` : entry.address!));
}

function headerText(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map((item) => headerText(item)).filter(Boolean).join(" ");
  if (value instanceof Date) return value.toUTCString();
  if (typeof value === "object" && "text" in value && typeof (value as { text: unknown }).text === "string") return (value as { text: string }).text;
  if (typeof value === "object" && "value" in value) return headerText((value as { value: unknown }).value);
  return String(value);
}

export function headerValue(parsed: ParsedMail, name: string): string | null {
  const line = parsed.headerLines.find((entry) => entry.key === name.toLowerCase());
  if (line) {
    const index = line.line.indexOf(":");
    return line.line.slice(index + 1).replace(/\r?\n[ \t]+/g, " ").trim();
  }
  return headerText(parsed.headers.get(name.toLowerCase()));
}

export type Envelope = { from: string; to: string[] };

export function buildPayload(parsed: ParsedMail, envelope: Envelope, instanceId: string): SendEmailPayload {
  const from = formatted(parsed.from)[0];
  if (!from) throw new Error("The message has no From address.");
  const to = formatted(parsed.to);
  const cc = formatted(parsed.cc);
  const visible = new Set([...addressList(parsed.to), ...addressList(parsed.cc)]);
  const bcc = envelope.to.filter((address) => !visible.has(address.toLowerCase()));
  const headers: Record<string, string> = {};
  for (const line of parsed.headerLines) {
    if (!passHeaders.has(line.key) && !(line.key.startsWith("x-") && line.key !== relayHeader && !line.key.startsWith("x-snapjaw"))) continue;
    const value = headerValue(parsed, line.key);
    if (value) headers[canonical(line.key)] = value;
  }
  headers["X-Snapjaw-Relay"] = instanceId;
  const attachments: SendAttachment[] = parsed.attachments.map((attachment) => {
    const item: SendAttachment = {
      filename: attachment.filename ?? undefined,
      content: attachment.content.toString("base64"),
      content_type: attachment.contentType,
    };
    if (attachment.contentId && (attachment.related || attachment.contentDisposition === "inline")) item.content_id = attachment.contentId.replace(/^<|>$/g, "");
    return item;
  });
  const payload: SendEmailPayload = {
    from,
    to: to.length ? to : [from],
    subject: parsed.subject ?? "",
    headers,
  };
  if (cc.length) payload.cc = cc;
  if (bcc.length) payload.bcc = bcc;
  const replyTo = formatted(parsed.replyTo);
  if (replyTo.length) payload.reply_to = replyTo;
  if (typeof parsed.html === "string" && parsed.html) payload.html = parsed.html;
  if (parsed.text) payload.text = parsed.text;
  if (!payload.html && !payload.text) payload.text = "";
  if (attachments.length) payload.attachments = attachments;
  return payload;
}

function canonical(name: string): string {
  if (name === "message-id") return "Message-ID";
  return name.replace(/(^|-)([a-z])/g, (_match, dash: string, letter: string) => dash + letter.toUpperCase());
}
