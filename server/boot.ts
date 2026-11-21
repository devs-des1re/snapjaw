import { prepareDatabase } from "../db";
import { getSetting, setSetting } from "../db/queries/settings";
import { masterKey, randomToken } from "../lib/crypto";
import { logger } from "../lib/logger";
import { announceSetupToken } from "./admin/setup";

const store = globalThis as typeof globalThis & { __snapjawBooted?: Promise<void> };

async function ensureInstanceId() {
  if (!(await getSetting("instance.id"))) await setSetting("instance.id", randomToken(9));
}

export function boot(): Promise<void> {
  store.__snapjawBooted ??= (async () => {
    masterKey();
    await prepareDatabase();
    await ensureInstanceId();
    await announceSetupToken();
    logger.info("Snapjaw started");
  })();
  return store.__snapjawBooted;
}
