import fs from "node:fs";
import path from "node:path";
import { closeDatabase, prepareDatabase, rawClient } from "../db";
import { env } from "../lib/env";
import type { Write } from "./index";

export async function backupCommand(file: string, out: Write): Promise<number> {
  const target = path.resolve(file);
  if (fs.existsSync(target)) {
    out(`${target} already exists. Pick a new file name.`);
    return 1;
  }
  await prepareDatabase();
  await rawClient().execute({ sql: "VACUUM INTO ?", args: [target] });
  await closeDatabase();
  out(`Backup written to ${target}.`);
  out("It holds settings, encrypted secrets and metadata. Keep SNAPJAW_SECRET_KEY with it, or the secrets cannot be read after a restore.");
  return 0;
}

export async function restoreCommand(file: string, out: Write): Promise<number> {
  const source = path.resolve(file);
  if (!fs.existsSync(source)) {
    out(`${source} does not exist.`);
    return 1;
  }
  const config = env();
  fs.mkdirSync(config.dataDir, { recursive: true });
  for (const suffix of ["", "-wal", "-shm"]) {
    const current = `${config.databaseFile}${suffix}`;
    if (fs.existsSync(current)) fs.renameSync(current, `${current}.before-restore`);
  }
  fs.copyFileSync(source, config.databaseFile);
  await prepareDatabase();
  await closeDatabase();
  out(`Restored ${source} into ${config.databaseFile}.`);
  out("The previous database was kept with a .before-restore suffix. Start Snapjaw again to use the restored data.");
  return 0;
}
