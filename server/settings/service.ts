import { recordAudit } from "../../db/queries/audit";
import { listSettings, setSetting, settingDefinitions, type SettingKey } from "../../db/queries/settings";
import { isEmail } from "../../lib/address";
import { env } from "../../lib/env";
import type { Actor } from "../http/guard";
import { createWebhook, listDomains, listWebhooks } from "../resend/api";
import { explainResendError, resendRequest } from "../resend/client";

type Result<T> = { ok: true; data: T } | { ok: false; status: number; error: string };

const editable: SettingKey[] = [
  "resend.apiKey",
  "resend.webhookSecret",
  "quota.daily",
  "quota.monthly",
  "quota.mode",
  "quota.alertPercent",
  "resend.rateLimit",
  "retention.days",
  "limits.maxMessageBytes",
  "limits.maxAttachments",
  "security.require2fa",
  "alerts.email",
  "alerts.from",
  "alerts.failureThreshold",
  "inbound.reconcileMinutes",
  "google.clientId",
  "google.clientSecret",
];

const ownerOnly = new Set<SettingKey>(["security.require2fa"]);

function validate(key: SettingKey, value: string): string | null {
  const integer = (min: number, max: number) => (/^\d+$/.test(value) && Number(value) >= min && Number(value) <= max ? null : `Must be a whole number from ${min} to ${max}.`);
  switch (key) {
    case "quota.daily":
    case "quota.monthly":
      return integer(0, 100_000_000);
    case "quota.alertPercent":
      return integer(1, 100);
    case "resend.rateLimit":
      return integer(1, 1000);
    case "retention.days":
      return integer(1, 3650);
    case "limits.maxMessageBytes":
      return integer(1024, 40 * 1024 * 1024);
    case "limits.maxAttachments":
      return integer(0, 500);
    case "alerts.failureThreshold":
      return integer(1, 1000);
    case "inbound.reconcileMinutes":
      return integer(1, 1440);
    case "quota.mode":
      return value === "hold" || value === "reject" ? null : "Pick hold or reject.";
    case "security.require2fa":
      return value === "true" || value === "false" ? null : "Must be true or false.";
    case "alerts.email":
      return value === "" || isEmail(value) ? null : "Enter a valid email address or leave it empty.";
    case "alerts.from":
      return value === "" || isEmail(value.replace(/^.*<([^>]+)>$/, "$1")) ? null : "Enter a sender like Snapjaw <alerts@example.com>.";
    case "resend.apiKey":
      return value === "" || /^re_[A-Za-z0-9_]+$/.test(value) ? null : "Resend API keys start with re_.";
    case "resend.webhookSecret":
      return value === "" || /^whsec_[A-Za-z0-9+/=]+$/.test(value) ? null : "Webhook signing secrets start with whsec_.";
    default:
      return null;
  }
}

export async function readSettings() {
  return listSettings();
}

export async function updateSettings(actor: Actor, input: Record<string, unknown>): Promise<Result<{ changed: string[] }>> {
  const changed: string[] = [];
  for (const [key, raw] of Object.entries(input)) {
    if (!(editable as string[]).includes(key)) return { ok: false, status: 422, error: `${key} cannot be changed here.` };
    const settingKey = key as SettingKey;
    if (ownerOnly.has(settingKey) && actor.role !== "owner") return { ok: false, status: 403, error: "Only an owner can change this setting." };
    const value = typeof raw === "boolean" ? String(raw) : String(raw ?? "").trim();
    if (settingDefinitions[settingKey].secret && value === "") continue;
    const problem = validate(settingKey, value);
    if (problem) return { ok: false, status: 422, error: `${key}: ${problem}` };
  }
  for (const [key, raw] of Object.entries(input)) {
    const settingKey = key as SettingKey;
    const value = typeof raw === "boolean" ? String(raw) : String(raw ?? "").trim();
    if (settingDefinitions[settingKey].secret && value === "") continue;
    await setSetting(settingKey, value);
    changed.push(key);
  }
  const visible = Object.fromEntries(Object.entries(input).filter(([key]) => !settingDefinitions[key as SettingKey].secret));
  await recordAudit(actor, "settings.update", changed.join(", "), { values: visible, secretsChanged: changed.filter((key) => settingDefinitions[key as SettingKey].secret) });
  return { ok: true, data: { changed } };
}

export async function clearSecret(actor: Actor, key: string): Promise<Result<Record<string, never>>> {
  if (!(editable as string[]).includes(key) || !settingDefinitions[key as SettingKey].secret) return { ok: false, status: 422, error: "Not a secret setting." };
  await setSetting(key as SettingKey, "");
  await recordAudit(actor, "settings.clear_secret", key);
  return { ok: true, data: {} };
}

export async function testResend(apiKey?: string): Promise<Result<{ domains: number }>> {
  try {
    const result = apiKey ? await resendRequest<{ data: unknown[] }>("/domains", { apiKey }) : await listDomains();
    return { ok: true, data: { domains: result.data.length } };
  } catch (error) {
    const explained = explainResendError(error);
    return { ok: false, status: 422, error: `${explained.message} ${explained.fix}` };
  }
}

export const webhookEvents = [
  "email.sent",
  "email.delivered",
  "email.delivery_delayed",
  "email.bounced",
  "email.complained",
  "email.failed",
  "email.suppressed",
  "email.received",
];

export function webhookUrl() {
  return `${env().publicUrl}/api/webhooks/resend`;
}

export async function registerWebhook(actor: Actor): Promise<Result<{ id: string; endpoint: string; reused: boolean }>> {
  const endpoint = webhookUrl();
  if (!endpoint.startsWith("https://")) return { ok: false, status: 422, error: `Resend needs an https address. Set SNAPJAW_PUBLIC_URL to your public https URL first. It is ${env().publicUrl} now.` };
  try {
    const existing = (await listWebhooks()).data.find((hook) => hook.endpoint === endpoint);
    if (existing?.signing_secret) {
      await setSetting("resend.webhookSecret", existing.signing_secret);
      await recordAudit(actor, "settings.webhook_link", endpoint, { id: existing.id });
      return { ok: true, data: { id: existing.id, endpoint, reused: true } };
    }
    const created = await createWebhook(endpoint, webhookEvents);
    if (!created.signing_secret) return { ok: false, status: 502, error: "Resend created the webhook but did not return its signing secret. Copy it from the Resend dashboard into the field below." };
    await setSetting("resend.webhookSecret", created.signing_secret);
    await recordAudit(actor, "settings.webhook_create", endpoint, { id: created.id });
    return { ok: true, data: { id: created.id, endpoint, reused: false } };
  } catch (error) {
    const explained = explainResendError(error);
    return { ok: false, status: 422, error: `${explained.message} ${explained.fix}` };
  }
}
