import { getNumberSetting, getSetting } from "../../db/queries/settings";
import { knownResendIds } from "../../db/queries/messages";
import { logger } from "../../lib/logger";
import { listReceivedEmails } from "../resend/api";
import { explainResendError } from "../resend/client";
import { recordReceived } from "./process";

const store = globalThis as typeof globalThis & { __snapjawReconcile?: { timer?: ReturnType<typeof setTimeout>; lastRun?: Date; lastResult?: string } };

export async function reconcileOnce(windowHours = 72, maxPages = 10): Promise<{ checked: number; added: number }> {
  if (!(await getSetting("resend.apiKey"))) return { checked: 0, added: 0 };
  const startDate = new Date(Date.now() - windowHours * 3600_000).toISOString();
  let after: string | undefined;
  let checked = 0;
  let added = 0;
  for (let page = 0; page < maxPages; page += 1) {
    const result = await listReceivedEmails({ limit: 100, after, start_date: startDate });
    checked += result.data.length;
    const known = await knownResendIds(result.data.map((email) => email.id));
    for (const email of result.data) {
      if (known.has(email.id)) continue;
      const id = await recordReceived({
        resendId: email.id,
        from: email.from,
        to: email.to,
        subject: email.subject ?? null,
        messageId: email.message_id ?? null,
        source: "reconciler",
      });
      if (id) added += 1;
    }
    if (!result.has_more || !result.data.length) break;
    after = result.data[result.data.length - 1]!.id;
  }
  return { checked, added };
}

export function startReconciler() {
  store.__snapjawReconcile ??= {};
  const state = store.__snapjawReconcile;
  if (state.timer) return;
  const tick = async () => {
    try {
      const result = await reconcileOnce();
      state.lastRun = new Date();
      state.lastResult = `checked ${result.checked}, added ${result.added}`;
      if (result.added) logger.info(`Reconciler found ${result.added} received message(s) the webhook missed`);
    } catch (error) {
      state.lastResult = explainResendError(error).message;
      logger.warn(`Reconciler failed: ${state.lastResult}`);
    }
    const minutes = Math.max(1, await getNumberSetting("inbound.reconcileMinutes").catch(() => 5));
    state.timer = setTimeout(tick, minutes * 60_000);
    state.timer.unref?.();
  };
  state.timer = setTimeout(tick, 5_000);
  state.timer.unref?.();
}

export function reconcilerState() {
  return { lastRun: store.__snapjawReconcile?.lastRun ?? null, lastResult: store.__snapjawReconcile?.lastResult ?? null };
}
