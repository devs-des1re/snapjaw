import { getSetting } from "../../db/queries/settings";
import { logger } from "../../lib/logger";
import { env } from "../../lib/env";

const store = globalThis as typeof globalThis & { __snapjawAlerts?: Map<string, number> };

const cooldownMs = 60 * 60 * 1000;

export async function notify(subject: string, text: string, key = subject): Promise<void> {
  store.__snapjawAlerts ??= new Map();
  const last = store.__snapjawAlerts.get(key) ?? 0;
  if (Date.now() - last < cooldownMs) return;
  store.__snapjawAlerts.set(key, Date.now());
  const to = await getSetting("alerts.email");
  const from = await getSetting("alerts.from");
  if (!to || !from) return;
  try {
    const { sendEmail } = await import("../resend/api");
    await sendEmail(
      {
        from,
        to: [to],
        subject: `[Snapjaw] ${subject}`,
        text: `${text}\n\nOpen ${env().publicUrl} for details.\n`,
        headers: { "Auto-Submitted": "auto-generated" },
      },
      `alert-${key}-${new Date().toISOString().slice(0, 13)}`,
    );
  } catch (error) {
    logger.warn(`Could not send the alert email: ${error instanceof Error ? error.message : String(error)}`);
  }
}
