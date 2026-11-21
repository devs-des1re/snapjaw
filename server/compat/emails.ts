import { createHash } from "node:crypto";
import MailComposer from "nodemailer/lib/mail-composer/index.js";
import { eq } from "drizzle-orm";
import { db } from "../../db";
import { idempotencyKeys } from "../../db/schema";
import { getMessage } from "../../db/queries/messages";
import { getNumberSetting } from "../../db/queries/settings";
import { extractAddress, isEmail } from "../../lib/address";
import { acceptMime, type Accepted, type Rejection, type Sender } from "../outbound/accept";

type Attachment = { content?: unknown; path?: unknown; filename?: unknown; content_type?: unknown; content_id?: unknown };

export type CompatResult = Accepted | Rejection | { ok: true; id: string; replay: true };

function list(value: unknown): string[] | null {
  if (value === undefined || value === null) return [];
  const items = Array.isArray(value) ? value : [value];
  if (!items.every((item) => typeof item === "string")) return null;
  return items as string[];
}

function invalid(message: string): Rejection {
  return { ok: false, smtpCode: 550, enhanced: "5.6.0", message, httpStatus: 422 };
}

export async function composeFromJson(body: Record<string, unknown>): Promise<{ raw: Buffer; envelope: string[]; from: string } | Rejection> {
  if (typeof body.from !== "string" || !isEmail(extractAddress(body.from))) return invalid("The from field must be an address such as Name <hello@example.com>.");
  const to = list(body.to);
  const cc = list(body.cc);
  const bcc = list(body.bcc);
  const replyTo = list(body.reply_to);
  if (!to || !cc || !bcc || !replyTo) return invalid("to, cc, bcc and reply_to must be a string or a list of strings.");
  if (!to.length) return invalid("The to field is required.");
  const all = [...to, ...cc, ...bcc].map(extractAddress);
  if (!all.every(isEmail)) return invalid("Every recipient must be a valid email address.");
  if (typeof body.subject !== "string") return invalid("The subject field is required.");
  if (body.scheduled_at !== undefined) return invalid("scheduled_at is not supported by Snapjaw. Send the message when it should go out.");
  if (body.template !== undefined || body.react !== undefined) return invalid("Templates and React rendering are not supported. Send html or text.");
  const headers = body.headers && typeof body.headers === "object" ? (body.headers as Record<string, unknown>) : {};
  const cleanHeaders: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (typeof value !== "string" || !/^[A-Za-z0-9-]+$/.test(name)) return invalid(`Header ${name} must have a string value.`);
    cleanHeaders[name] = value;
  }
  const attachments: { filename?: string; content: Buffer; contentType?: string; cid?: string }[] = [];
  const maxAttachments = await getNumberSetting("limits.maxAttachments");
  const items = Array.isArray(body.attachments) ? (body.attachments as Attachment[]) : [];
  if (items.length > maxAttachments) return invalid(`At most ${maxAttachments} attachments are allowed.`);
  for (const item of items) {
    if (item.path !== undefined) return invalid("Attachments by path are not supported. Send the file as base64 content.");
    if (typeof item.content !== "string") return invalid("Each attachment needs base64 content.");
    attachments.push({
      filename: typeof item.filename === "string" ? item.filename : undefined,
      content: Buffer.from(item.content, "base64"),
      contentType: typeof item.content_type === "string" ? item.content_type : undefined,
      cid: typeof item.content_id === "string" ? item.content_id : undefined,
    });
  }
  const composer = new MailComposer({
    from: body.from,
    to,
    cc: cc.length ? cc : undefined,
    replyTo: replyTo.length ? replyTo : undefined,
    subject: body.subject,
    html: typeof body.html === "string" ? body.html : undefined,
    text: typeof body.text === "string" ? body.text : undefined,
    headers: cleanHeaders,
    attachments,
  });
  const raw = await composer.compile().build();
  return { raw, envelope: all, from: extractAddress(body.from) };
}

export async function sendFromJson(sender: Sender, body: Record<string, unknown>, idempotencyKey: string | null): Promise<CompatResult> {
  const bodyHash = createHash("sha256").update(JSON.stringify(body)).digest("hex");
  const scopedKey = idempotencyKey ? `${sender.id}:${idempotencyKey}` : null;
  if (scopedKey) {
    if (idempotencyKey!.length > 256) return { ok: false, smtpCode: 550, enhanced: "5.5.0", message: "The Idempotency-Key header must be 1 to 256 characters.", httpStatus: 400 };
    const existing = await db.query.idempotencyKeys.findFirst({ where: eq(idempotencyKeys.key, scopedKey) });
    if (existing && Date.now() - existing.createdAt.getTime() < 24 * 3600_000) {
      if (existing.bodyHash !== bodyHash) return { ok: false, smtpCode: 550, enhanced: "5.5.0", message: "This Idempotency-Key was already used with a different request body.", httpStatus: 409 };
      return { ok: true, id: existing.messageId, replay: true };
    }
  }
  const composed = await composeFromJson(body);
  if ("ok" in composed) return composed;
  const result = await acceptMime({ raw: composed.raw, envelopeFrom: composed.from, envelopeTo: composed.envelope, sender, source: "api" });
  if (result.ok && scopedKey) {
    await db.insert(idempotencyKeys).values({ key: scopedKey, messageId: result.id, bodyHash }).onConflictDoUpdate({ target: idempotencyKeys.key, set: { messageId: result.id, bodyHash, createdAt: new Date() } });
  }
  return result;
}

export async function emailForCompat(id: string) {
  const message = await getMessage(id);
  if (!message || message.direction !== "outbound") return null;
  return {
    object: "email",
    id: message.id,
    to: message.toAddresses,
    from: message.fromAddress,
    subject: message.subject,
    created_at: message.createdAt.toISOString(),
    last_event: message.status,
  };
}
