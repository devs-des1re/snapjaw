import type { ParsedMail } from "mailparser";
import type { ForwardConfig } from "../../db/queries/destinations";
import { formatted } from "../outbound/mime";
import { sendEmail, type SendEmailPayload } from "../resend/api";

function displayName(parsed: ParsedMail): string {
  const first = parsed.from?.value[0];
  const name = first?.name || first?.address || "Unknown sender";
  return name.replace(/["\\<>]/g, "").slice(0, 60);
}

export function forwardPayload(parsed: ParsedMail, config: ForwardConfig, instanceId: string): SendEmailPayload {
  const originalFrom = formatted(parsed.from);
  const payload: SendEmailPayload = {
    from: `"${displayName(parsed)} via Snapjaw" <${config.from}>`,
    to: [config.address],
    subject: parsed.subject ?? "",
    reply_to: formatted(parsed.replyTo).length ? formatted(parsed.replyTo) : originalFrom,
    headers: {
      "X-Snapjaw-Relay": instanceId,
      "X-Original-From": originalFrom[0] ?? "",
      ...(parsed.messageId ? { "X-Original-Message-ID": parsed.messageId } : {}),
      ...(parsed.inReplyTo ? { "In-Reply-To": parsed.inReplyTo } : {}),
      ...(parsed.references ? { References: Array.isArray(parsed.references) ? parsed.references.join(" ") : parsed.references } : {}),
    },
  };
  if (typeof parsed.html === "string" && parsed.html) payload.html = parsed.html;
  if (parsed.text) payload.text = parsed.text;
  if (!payload.html && !payload.text) payload.text = "";
  if (parsed.attachments.length) {
    payload.attachments = parsed.attachments.map((attachment) => ({
      filename: attachment.filename ?? undefined,
      content: attachment.content.toString("base64"),
      content_type: attachment.contentType,
      ...(attachment.contentId && attachment.related ? { content_id: attachment.contentId.replace(/^<|>$/g, "") } : {}),
    }));
  }
  return payload;
}

export async function forwardViaResend(parsed: ParsedMail, config: ForwardConfig, instanceId: string, idempotencyKey: string) {
  return sendEmail(forwardPayload(parsed, config, instanceId), idempotencyKey);
}
