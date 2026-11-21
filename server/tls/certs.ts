import fs from "node:fs";
import path from "node:path";
import tls from "node:tls";
import { X509Certificate } from "node:crypto";
import { generate } from "selfsigned";
import { env } from "../../lib/env";
import { logger } from "../../lib/logger";

export type CertSource = "file" | "acme" | "self-signed";

type CertState = {
  key: string;
  cert: string;
  context: tls.SecureContext;
  source: CertSource;
  loadedAt: number;
  mtime: number;
};

const store = globalThis as typeof globalThis & { __snapjawCert?: CertState; __snapjawCertWatch?: ReturnType<typeof setInterval> };

function tlsDir() {
  const dir = path.join(env().dataDir, "tls");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function acmePaths() {
  const dir = tlsDir();
  return { key: path.join(dir, "acme.key"), cert: path.join(dir, "acme.crt"), account: path.join(dir, "acme-account.key") };
}

function fileMtime(file: string): number {
  try {
    return fs.statSync(file).mtimeMs;
  } catch {
    return 0;
  }
}

async function selfSigned(hostname: string): Promise<{ key: string; cert: string }> {
  const dir = tlsDir();
  const keyFile = path.join(dir, "self-signed.key");
  const certFile = path.join(dir, "self-signed.crt");
  if (fs.existsSync(keyFile) && fs.existsSync(certFile)) {
    const cert = fs.readFileSync(certFile, "utf8");
    const parsed = new X509Certificate(cert);
    if (new Date(parsed.validTo).getTime() > Date.now() + 7 * 86400000 && parsed.subject.includes(hostname)) {
      return { key: fs.readFileSync(keyFile, "utf8"), cert };
    }
  }
  const pems = await generate([{ name: "commonName", value: hostname }], {
    keySize: 2048,
    algorithm: "sha256",
    extensions: [{ name: "subjectAltName", altNames: [{ type: 2, value: hostname }] }],
  } as never);
  fs.writeFileSync(keyFile, pems.private, { mode: 0o600 });
  fs.writeFileSync(certFile, pems.cert);
  return { key: pems.private, cert: pems.cert };
}

async function readCurrent(): Promise<Omit<CertState, "context" | "loadedAt">> {
  const config = env();
  if (config.tlsCertFile && config.tlsKeyFile && fs.existsSync(config.tlsCertFile) && fs.existsSync(config.tlsKeyFile)) {
    return {
      key: fs.readFileSync(config.tlsKeyFile, "utf8"),
      cert: fs.readFileSync(config.tlsCertFile, "utf8"),
      source: "file",
      mtime: fileMtime(config.tlsCertFile),
    };
  }
  const acme = acmePaths();
  if (fs.existsSync(acme.cert) && fs.existsSync(acme.key)) {
    return { key: fs.readFileSync(acme.key, "utf8"), cert: fs.readFileSync(acme.cert, "utf8"), source: "acme", mtime: fileMtime(acme.cert) };
  }
  if (config.tlsCertFile || config.tlsKeyFile) logger.warn("SNAPJAW_TLS_CERT or SNAPJAW_TLS_KEY points at a missing file. Using a self-signed certificate.");
  const pair = await selfSigned(config.smtpHostname);
  return { ...pair, source: "self-signed", mtime: 0 };
}

export async function loadCertificate(): Promise<CertState> {
  const current = await readCurrent();
  const state: CertState = { ...current, context: tls.createSecureContext({ key: current.key, cert: current.cert }), loadedAt: Date.now() };
  store.__snapjawCert = state;
  if (state.source === "self-signed") {
    logger.warn(`SMTP is using a self-signed certificate for ${env().smtpHostname}. Gmail and most clients will refuse it. Set SNAPJAW_TLS_CERT and SNAPJAW_TLS_KEY, or SNAPJAW_ACME_EMAIL.`);
  }
  return state;
}

export async function certificate(): Promise<CertState> {
  return store.__snapjawCert ?? loadCertificate();
}

export function watchCertificate() {
  if (store.__snapjawCertWatch) return;
  store.__snapjawCertWatch = setInterval(async () => {
    const state = store.__snapjawCert;
    if (!state) return;
    const config = env();
    const file = state.source === "file" ? config.tlsCertFile : acmePaths().cert;
    const mtime = fileMtime(file);
    const swapped = state.source === "self-signed" && (fs.existsSync(acmePaths().cert) || (config.tlsCertFile && fs.existsSync(config.tlsCertFile)));
    if ((mtime && mtime !== state.mtime) || swapped) {
      try {
        await loadCertificate();
        logger.info("Reloaded the TLS certificate");
      } catch (error) {
        logger.error(`Could not reload the TLS certificate: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }, 60_000);
  store.__snapjawCertWatch.unref?.();
}

export function sniCallback(_servername: string, callback: (error: Error | null, context?: tls.SecureContext) => void) {
  const state = store.__snapjawCert;
  if (!state) callback(new Error("No certificate loaded"));
  else callback(null, state.context);
}

export async function certificateInfo() {
  const state = await certificate();
  const parsed = new X509Certificate(state.cert);
  return {
    source: state.source,
    subject: parsed.subject.replace(/\n/g, ", "),
    issuer: parsed.issuer.replace(/\n/g, ", "),
    validTo: new Date(parsed.validTo).toISOString(),
    names: parsed.subjectAltName ?? "",
    matchesHost: parsed.checkHost(env().smtpHostname) !== undefined,
    daysLeft: Math.floor((new Date(parsed.validTo).getTime() - Date.now()) / 86400000),
  };
}
