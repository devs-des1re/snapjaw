import { createCipheriv, createDecipheriv, createHash, createHmac, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { env } from "./env";
import { logger } from "./logger";

const store = globalThis as typeof globalThis & { __snapjawMasterKey?: Buffer };

function parseKey(raw: string): Buffer {
  const trimmed = raw.trim();
  const key = /^[0-9a-f]{64}$/i.test(trimmed) ? Buffer.from(trimmed, "hex") : Buffer.from(trimmed, "base64");
  if (key.length !== 32) throw new Error("SNAPJAW_SECRET_KEY must be 32 bytes, base64 or hex encoded");
  return key;
}

export function masterKey(): Buffer {
  if (store.__snapjawMasterKey) return store.__snapjawMasterKey;
  const config = env();
  if (config.secretKey) {
    store.__snapjawMasterKey = parseKey(config.secretKey);
    return store.__snapjawMasterKey;
  }
  const file = path.join(config.dataDir, "secret.key");
  if (fs.existsSync(file)) {
    store.__snapjawMasterKey = parseKey(fs.readFileSync(file, "utf8"));
    return store.__snapjawMasterKey;
  }
  fs.mkdirSync(config.dataDir, { recursive: true });
  const key = randomBytes(32);
  fs.writeFileSync(file, key.toString("base64") + "\n", { mode: 0o600 });
  logger.warn(`No SNAPJAW_SECRET_KEY set. Generated one at ${file}. Back it up: without it, stored secrets cannot be read.`);
  store.__snapjawMasterKey = key;
  return key;
}

export function deriveKey(purpose: string, length = 32): Buffer {
  return Buffer.from(hkdfSync("sha256", masterKey(), Buffer.alloc(0), `snapjaw:${purpose}`, length));
}

export function encrypt(plaintext: string): string {
  const key = deriveKey("secrets");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${Buffer.concat([iv, tag, body]).toString("base64")}`;
}

export function decrypt(payload: string): string {
  if (!payload.startsWith("v1:")) throw new Error("Unknown secret format");
  const raw = Buffer.from(payload.slice(3), "base64");
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const body = raw.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", deriveKey("secrets"), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function hmac(value: string, purpose: string): string {
  return createHmac("sha256", deriveKey(purpose)).update(value).digest("hex");
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function newId(prefix: string): string {
  return `${prefix}_${randomBytes(12).toString("base64url")}`;
}
