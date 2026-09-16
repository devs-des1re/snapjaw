import { existsSync } from "node:fs";

import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { describeError, log } from "./logger.js";
import { PoolManager } from "./pool-manager.js";

/**
 * Pick up a local .env when one is present so `npm run dev` works without
 * exporting variables by hand. Deployments pass env vars directly.
 */
function loadLocalEnv(): void {
  const load = (process as unknown as { loadEnvFile?: (path: string) => void }).loadEnvFile;
  if (!load) return;

  for (const file of [".env.local", ".env"]) {
    if (!existsSync(file)) continue;
    try {
      load(file);
    } catch {
      // A malformed env file surfaces as a config error below.
    }
  }
}

async function main(): Promise<void> {
  loadLocalEnv();

  const config = loadConfig();
  const pool = new PoolManager(config);

  log("info", "starting sandbox runner", {
    image: config.image,
    poolSize: config.poolSize,
    runTimeoutMs: config.runTimeoutMs,
    memoryLimit: config.memoryLimit,
    cpuLimit: config.cpuLimit,
    authRequired: config.token !== null,
  });

  await pool.start();

  const server = createApp(config, pool).listen(config.port, () => {
    log("info", "sandbox runner listening", { port: config.port });
  });

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;

    log("info", "shutting down sandbox runner", { signal });
    server.close();
    await pool.stop();
    process.exit(0);
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((error: unknown) => {
  log("error", "sandbox runner failed to start", { error: describeError(error) });
  process.exit(1);
});
