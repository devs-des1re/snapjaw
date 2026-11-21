import { prepareDatabase } from "../db";
import { getSetting, setSetting } from "../db/queries/settings";
import { masterKey, randomToken } from "../lib/crypto";
import { env } from "../lib/env";
import { logger } from "../lib/logger";
import { announceSetupToken } from "./admin/setup";
import { registerOutbound } from "./outbound/worker";
import { registerInbound } from "./inbound/process";
import { registerDelivery } from "./inbound/deliver";
import { startReconciler } from "./inbound/reconcile";
import { recoverLeases, startQueue, stopQueue } from "./queue/queue";
import { startSmtp, stopSmtp } from "./smtp/server";
import { loadCertificate, watchCertificate } from "./tls/certs";
import { startMaintenance } from "./ops/maintenance";
import { startAcme } from "./tls/acme";

const store = globalThis as typeof globalThis & { __snapjawBooted?: Promise<void> };

async function ensureInstanceId() {
  if (!(await getSetting("instance.id"))) await setSetting("instance.id", randomToken(9));
}

function onShutdown() {
  const stop = async (signal: string) => {
    logger.info(`Received ${signal}, stopping workers`);
    stopQueue();
    await stopSmtp().catch(() => undefined);
  };
  process.once("SIGTERM", () => void stop("SIGTERM"));
  process.once("SIGINT", () => void stop("SIGINT"));
}

export function registerHandlers() {
  registerOutbound();
  registerInbound();
  registerDelivery();
}

export function boot(): Promise<void> {
  store.__snapjawBooted ??= (async () => {
    masterKey();
    await prepareDatabase();
    await ensureInstanceId();
    await announceSetupToken();
    const config = env();
    registerHandlers();
    if (config.workersEnabled) {
      const recovered = await recoverLeases();
      if (recovered) logger.info(`Recovered ${recovered} job(s) that were running when Snapjaw stopped`);
      startQueue();
      startReconciler();
      startMaintenance();
    }
    await loadCertificate();
    watchCertificate();
    startAcme();
    if (config.smtpEnabled) {
      try {
        await startSmtp();
      } catch (error) {
        logger.error(`SMTP could not start: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    onShutdown();
    logger.info("Snapjaw started");
  })();
  return store.__snapjawBooted;
}
