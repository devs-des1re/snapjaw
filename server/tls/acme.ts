import fs from "node:fs";
import { X509Certificate } from "node:crypto";
import acme from "acme-client";
import { env } from "../../lib/env";
import { logger } from "../../lib/logger";
import { acmePaths, loadCertificate } from "./certs";

type AcmeState = { challenges: Map<string, string>; timer?: ReturnType<typeof setTimeout>; running?: boolean; lastError?: string };

const store = globalThis as typeof globalThis & { __snapjawAcme?: AcmeState };

function state(): AcmeState {
  store.__snapjawAcme ??= { challenges: new Map() };
  return store.__snapjawAcme;
}

export function acmeChallenge(token: string): string | undefined {
  return state().challenges.get(token);
}

function daysLeft(file: string): number {
  if (!fs.existsSync(file)) return -1;
  const cert = new X509Certificate(fs.readFileSync(file));
  return (new Date(cert.validTo).getTime() - Date.now()) / 86400_000;
}

export async function obtainCertificate(): Promise<void> {
  const config = env();
  const current = state();
  if (current.running) return;
  current.running = true;
  try {
    const paths = acmePaths();
    if (!fs.existsSync(paths.account)) fs.writeFileSync(paths.account, await acme.crypto.createPrivateKey(), { mode: 0o600 });
    const client = new acme.Client({
      directoryUrl: config.acmeStaging ? acme.directory.letsencrypt.staging : acme.directory.letsencrypt.production,
      accountKey: fs.readFileSync(paths.account),
    });
    const [key, csr] = await acme.crypto.createCsr({ commonName: config.smtpHostname, altNames: [config.smtpHostname] });
    const cert = await client.auto({
      csr,
      email: config.acmeEmail,
      termsOfServiceAgreed: true,
      challengePriority: ["http-01"],
      challengeCreateFn: async (_authz, challenge, keyAuthorization) => {
        current.challenges.set(challenge.token, keyAuthorization);
      },
      challengeRemoveFn: async (_authz, challenge) => {
        current.challenges.delete(challenge.token);
      },
    });
    fs.writeFileSync(paths.key, key, { mode: 0o600 });
    fs.writeFileSync(paths.cert, cert);
    current.lastError = undefined;
    logger.info(`Obtained a Let's Encrypt certificate for ${config.smtpHostname}`);
    await loadCertificate();
  } catch (error) {
    current.lastError = error instanceof Error ? error.message : String(error);
    logger.error(`ACME certificate request failed: ${current.lastError}. Port 80 must reach Snapjaw for ${config.smtpHostname}.`);
  } finally {
    current.running = false;
  }
}

export function startAcme() {
  const config = env();
  if (!config.acmeEmail || (config.tlsCertFile && config.tlsKeyFile)) return;
  const current = state();
  if (current.timer) return;
  const tick = async () => {
    if (daysLeft(acmePaths().cert) < 30) await obtainCertificate();
    current.timer = setTimeout(() => void tick(), 12 * 3600_000);
    current.timer.unref?.();
  };
  current.timer = setTimeout(() => void tick(), 10_000);
  current.timer.unref?.();
}

export function acmeStatus() {
  return { enabled: Boolean(env().acmeEmail), lastError: state().lastError ?? null };
}
