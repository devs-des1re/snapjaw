import fs from "node:fs";
import { countActiveOwners } from "../../db/queries/users";
import { getSetting } from "../../db/queries/settings";
import { env } from "../../lib/env";

export type Check = { name: string; status: "ok" | "warn" | "fail"; detail: string; fix?: string };

export type DoctorExtension = () => Promise<Check[]>;

const store = globalThis as typeof globalThis & { __snapjawDoctorChecks?: DoctorExtension[] };

export function registerDoctorCheck(check: DoctorExtension) {
  store.__snapjawDoctorChecks ??= [];
  store.__snapjawDoctorChecks.push(check);
}

async function baseChecks(): Promise<Check[]> {
  const config = env();
  const checks: Check[] = [];
  checks.push({ name: "Database", status: "ok", detail: config.databaseFile });
  checks.push(
    config.secretKey
      ? { name: "Secret key", status: "ok", detail: "SNAPJAW_SECRET_KEY is set" }
      : fs.existsSync(`${config.dataDir}/secret.key`)
        ? { name: "Secret key", status: "warn", detail: "Using the generated key in the data folder", fix: "Copy data/secret.key into SNAPJAW_SECRET_KEY and back it up." }
        : { name: "Secret key", status: "fail", detail: "No key found", fix: "Set SNAPJAW_SECRET_KEY to 32 random bytes, base64 encoded." },
  );
  const owners = await countActiveOwners();
  checks.push(owners > 0 ? { name: "Owners", status: "ok", detail: `${owners} active owner(s)` } : { name: "Owners", status: "fail", detail: "No active owner", fix: "Run snapjaw admin create --email you@example.com" });
  checks.push(
    (await getSetting("resend.apiKey"))
      ? { name: "Resend API key", status: "ok", detail: "Stored" }
      : { name: "Resend API key", status: "fail", detail: "Not set", fix: "Add it under Settings in the admin UI." },
  );
  return checks;
}

export async function runDoctor(): Promise<Check[]> {
  const checks = await baseChecks();
  for (const extension of store.__snapjawDoctorChecks ?? []) {
    try {
      checks.push(...(await extension()));
    } catch (error) {
      checks.push({ name: "Check failed", status: "fail", detail: error instanceof Error ? error.message : String(error) });
    }
  }
  return checks;
}
