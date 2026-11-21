import { lt } from "drizzle-orm";
import { db } from "../../db";
import { oauthStates, webhookEvents } from "../../db/schema";
import { pruneAudit } from "../../db/queries/audit";
import { pruneMessages } from "../../db/queries/messages";
import { pruneExpiredSessions } from "../../db/queries/sessions";
import { getNumberSetting } from "../../db/queries/settings";
import { logger } from "../../lib/logger";
import { refreshPendingDomains } from "../domains/service";

const store = globalThis as typeof globalThis & { __snapjawMaintenance?: ReturnType<typeof setInterval> };

export async function runMaintenance() {
  const days = await getNumberSetting("retention.days");
  const cutoff = new Date(Date.now() - days * 86400_000);
  await pruneMessages(cutoff);
  await pruneAudit(new Date(Date.now() - Math.max(days, 365) * 86400_000));
  await pruneExpiredSessions();
  await db.delete(webhookEvents).where(lt(webhookEvents.receivedAt, new Date(Date.now() - 7 * 86400_000)));
  await db.delete(oauthStates).where(lt(oauthStates.expiresAt, new Date()));
}

export function startMaintenance() {
  if (store.__snapjawMaintenance) return;
  const tick = async () => {
    try {
      await refreshPendingDomains();
    } catch (error) {
      logger.warn(`Domain refresh failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    try {
      await runMaintenance();
    } catch (error) {
      logger.warn(`Maintenance failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  setTimeout(() => void tick(), 15_000).unref?.();
  store.__snapjawMaintenance = setInterval(() => void tick(), 10 * 60_000);
  store.__snapjawMaintenance.unref?.();
}
