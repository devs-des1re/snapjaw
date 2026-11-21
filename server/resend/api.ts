import { resendRequest } from "./client";
import type { DnsRecord } from "../../db/schema";

export type SendAttachment = { filename?: string; content: string; content_type?: string; content_id?: string };

export type SendEmailPayload = {
  from: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  reply_to?: string[];
  subject: string;
  html?: string;
  text?: string;
  headers?: Record<string, string>;
  attachments?: SendAttachment[];
  tags?: { name: string; value: string }[];
};

export function sendEmail(payload: SendEmailPayload, idempotencyKey: string) {
  return resendRequest<{ id: string }>("/emails", { method: "POST", body: payload, idempotencyKey });
}

export type ResendDomain = {
  id: string;
  name: string;
  status: string;
  region?: string;
  created_at?: string;
  capabilities?: { sending?: string; receiving?: string };
  records?: DnsRecord[];
};

export function createDomain(name: string, receiving: boolean, region?: string) {
  return resendRequest<ResendDomain>("/domains", {
    method: "POST",
    body: { name, ...(region ? { region } : {}), capabilities: { sending: "enabled", receiving: receiving ? "enabled" : "disabled" } },
  });
}

export function getDomain(id: string) {
  return resendRequest<ResendDomain>(`/domains/${encodeURIComponent(id)}`);
}

export function verifyDomain(id: string) {
  return resendRequest<{ object: string; id: string }>(`/domains/${encodeURIComponent(id)}/verify`, { method: "POST" });
}

export function listDomains() {
  return resendRequest<{ data: ResendDomain[] }>("/domains");
}

export function updateDomain(id: string, body: Record<string, unknown>) {
  return resendRequest<{ id: string }>(`/domains/${encodeURIComponent(id)}`, { method: "PATCH", body });
}

export function deleteDomain(id: string) {
  return resendRequest<{ id: string }>(`/domains/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export type ReceivedEmailSummary = {
  id: string;
  to: string[];
  from: string;
  created_at: string;
  subject: string | null;
  cc?: string[] | null;
  bcc?: string[] | null;
  reply_to?: string[] | null;
  message_id?: string | null;
  attachments?: { id: string; filename: string; content_type: string; content_id?: string | null; content_disposition?: string; size?: number }[];
};

export type ReceivedEmail = ReceivedEmailSummary & {
  html?: string | null;
  text?: string | null;
  headers?: Record<string, string> | null;
  received_for?: string[] | null;
  authentication?: { spf?: string; dkim?: string; dmarc?: string } | null;
  raw?: { download_url: string; expires_at: string } | null;
};

export function getReceivedEmail(id: string) {
  return resendRequest<ReceivedEmail>(`/emails/receiving/${encodeURIComponent(id)}?html_format=cid`);
}

export function listReceivedEmails(params: { limit?: number; after?: string; start_date?: string }) {
  const query = new URLSearchParams();
  if (params.limit) query.set("limit", String(params.limit));
  if (params.after) query.set("after", params.after);
  if (params.start_date) query.set("start_date", params.start_date);
  return resendRequest<{ object: string; has_more: boolean; data: ReceivedEmailSummary[] }>(`/emails/receiving?${query}`);
}

export type ReceivedAttachment = { id: string; filename: string; size: number; content_type: string; content_disposition?: string; content_id?: string | null; download_url: string; expires_at: string };

export function listReceivedAttachments(emailId: string) {
  return resendRequest<{ data: ReceivedAttachment[] }>(`/emails/receiving/${encodeURIComponent(emailId)}/attachments?limit=100`);
}

export type ResendWebhook = { id: string; endpoint: string; events: string[]; signing_secret?: string; status?: string };

export function createWebhook(endpoint: string, events: string[]) {
  return resendRequest<ResendWebhook>("/webhooks", { method: "POST", body: { endpoint, events } });
}

export function listWebhooks() {
  return resendRequest<{ data: ResendWebhook[] }>("/webhooks");
}
