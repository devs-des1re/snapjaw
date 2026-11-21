import { eq } from "drizzle-orm";
import { db } from "../index";
import { settings } from "../schema";
import { decrypt, encrypt } from "../../lib/crypto";

export const settingDefinitions = {
  "resend.apiKey": { secret: true, fallback: "" },
  "resend.webhookSecret": { secret: true, fallback: "" },
  "quota.daily": { secret: false, fallback: "100" },
  "quota.monthly": { secret: false, fallback: "3000" },
  "quota.mode": { secret: false, fallback: "hold" },
  "quota.alertPercent": { secret: false, fallback: "80" },
  "resend.rateLimit": { secret: false, fallback: "10" },
  "retention.days": { secret: false, fallback: "30" },
  "limits.maxMessageBytes": { secret: false, fallback: String(25 * 1024 * 1024) },
  "limits.maxAttachments": { secret: false, fallback: "30" },
  "security.require2fa": { secret: false, fallback: "false" },
  "alerts.email": { secret: false, fallback: "" },
  "alerts.failureThreshold": { secret: false, fallback: "5" },
  "alerts.from": { secret: false, fallback: "" },
  "inbound.reconcileMinutes": { secret: false, fallback: "5" },
  "google.clientId": { secret: false, fallback: "" },
  "google.clientSecret": { secret: true, fallback: "" },
  "instance.id": { secret: false, fallback: "" },
} as const;

export type SettingKey = keyof typeof settingDefinitions;

export async function getSetting(key: SettingKey): Promise<string> {
  const row = await db.query.settings.findFirst({ where: eq(settings.key, key) });
  if (!row) return settingDefinitions[key].fallback;
  return row.encrypted ? decrypt(row.value) : row.value;
}

export async function getNumberSetting(key: SettingKey): Promise<number> {
  const value = Number(await getSetting(key));
  return Number.isFinite(value) ? value : Number(settingDefinitions[key].fallback);
}

export async function getBooleanSetting(key: SettingKey): Promise<boolean> {
  return (await getSetting(key)) === "true";
}

export async function setSetting(key: SettingKey, value: string): Promise<void> {
  const secret = settingDefinitions[key].secret;
  const stored = secret && value !== "" ? encrypt(value) : value;
  await db
    .insert(settings)
    .values({ key, value: stored, encrypted: secret && value !== "", updatedAt: new Date() })
    .onConflictDoUpdate({ target: settings.key, set: { value: stored, encrypted: secret && value !== "", updatedAt: new Date() } });
}

export async function listSettings(): Promise<Record<string, { value: string; secret: boolean; set: boolean }>> {
  const rows = await db.select().from(settings);
  const byKey = new Map(rows.map((row) => [row.key, row]));
  const out: Record<string, { value: string; secret: boolean; set: boolean }> = {};
  for (const [key, definition] of Object.entries(settingDefinitions)) {
    const row = byKey.get(key);
    if (definition.secret) {
      out[key] = { value: "", secret: true, set: Boolean(row && row.value !== "") };
    } else {
      out[key] = { value: row ? row.value : definition.fallback, secret: false, set: Boolean(row) };
    }
  }
  return out;
}
