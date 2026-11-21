import { createHash } from "node:crypto";
import { recordAudit } from "../../db/queries/audit";
import {
  findApiKeyByPrefix,
  getApiKey,
  getSmtpCredential,
  insertApiKey,
  insertSmtpCredential,
  updateApiKey,
  updateSmtpCredential,
} from "../../db/queries/credentials";
import { isDomain, isEmail } from "../../lib/address";
import { newId, randomToken, safeEqual } from "../../lib/crypto";
import { hashPassword } from "../../lib/passwords";
import type { Actor } from "../http/guard";

type Result<T> = { ok: true; data: T } | { ok: false; status: number; error: string };

const err = (status: number, error: string) => ({ ok: false as const, status, error });

export function parseSenders(value: unknown): string[] | null {
  const list = Array.isArray(value) ? value : typeof value === "string" ? value.split(/[\s,]+/) : [];
  const cleaned = [...new Set(list.map((item) => String(item).trim().toLowerCase()).filter(Boolean))];
  if (!cleaned.length) return null;
  for (const entry of cleaned) {
    if (entry.startsWith("@") ? !isDomain(entry.slice(1)) : !isEmail(entry)) return null;
  }
  return cleaned;
}

function parseRate(value: unknown, fallback = 100): number | null {
  if (value === undefined || value === null || value === "") return fallback;
  const rate = Number(value);
  return Number.isInteger(rate) && rate >= 0 && rate <= 100000 ? rate : null;
}

export async function createSmtpCredential(actor: Actor, input: Record<string, unknown>): Promise<Result<{ id: string; username: string; password: string }>> {
  const name = typeof input.name === "string" && input.name.trim() ? input.name.trim().slice(0, 80) : "SMTP credential";
  const senders = parseSenders(input.allowedSenders);
  if (!senders) return err(422, "List at least one allowed sender, such as hello@example.com or @example.com.");
  const rate = parseRate(input.ratePerHour);
  if (rate === null) return err(422, "The hourly limit must be a whole number from 0 to 100000. 0 means no limit.");
  const username = typeof input.username === "string" && input.username.trim() ? input.username.trim().toLowerCase() : `sj-${randomToken(6).toLowerCase().replace(/[^a-z0-9]/g, "x")}`;
  if (!/^[a-z0-9@._+-]{3,120}$/.test(username)) return err(422, "Use 3 to 120 characters for the username: letters, digits, and . _ + - @.");
  const password = randomToken(24);
  const id = newId("smtp");
  try {
    await insertSmtpCredential({ id, name, username, passwordHash: await hashPassword(password), allowedSenders: senders, ratePerHour: rate });
  } catch {
    return err(409, "That username is taken.");
  }
  await recordAudit(actor, "credential.smtp_create", username, { id, allowedSenders: senders, ratePerHour: rate });
  return { ok: true, data: { id, username, password } };
}

export async function updateSmtp(actor: Actor, id: string, input: Record<string, unknown>): Promise<Result<Record<string, never>>> {
  const current = await getSmtpCredential(id);
  if (!current) return err(404, "No such credential.");
  const changes: { allowedSenders?: string[]; ratePerHour?: number; name?: string } = {};
  if (input.allowedSenders !== undefined) {
    const senders = parseSenders(input.allowedSenders);
    if (!senders) return err(422, "List at least one allowed sender, such as hello@example.com or @example.com.");
    changes.allowedSenders = senders;
  }
  if (input.ratePerHour !== undefined) {
    const rate = parseRate(input.ratePerHour);
    if (rate === null) return err(422, "The hourly limit must be a whole number from 0 to 100000.");
    changes.ratePerHour = rate;
  }
  if (typeof input.name === "string" && input.name.trim()) changes.name = input.name.trim().slice(0, 80);
  await updateSmtpCredential(id, changes);
  await recordAudit(actor, "credential.smtp_update", current.username, changes);
  return { ok: true, data: {} };
}

export async function rotateSmtp(actor: Actor, id: string): Promise<Result<{ username: string; password: string }>> {
  const current = await getSmtpCredential(id);
  if (!current || current.revokedAt) return err(404, "No such active credential.");
  const password = randomToken(24);
  await updateSmtpCredential(id, { passwordHash: await hashPassword(password) });
  await recordAudit(actor, "credential.smtp_rotate", current.username);
  return { ok: true, data: { username: current.username, password } };
}

export async function revokeSmtp(actor: Actor, id: string): Promise<Result<Record<string, never>>> {
  const current = await getSmtpCredential(id);
  if (!current) return err(404, "No such credential.");
  await updateSmtpCredential(id, { revokedAt: new Date() });
  await recordAudit(actor, "credential.smtp_revoke", current.username);
  return { ok: true, data: {} };
}

function digest(secret: string) {
  return createHash("sha256").update(secret).digest("hex");
}

export async function createApiKey(actor: Actor, input: Record<string, unknown>): Promise<Result<{ id: string; key: string }>> {
  const name = typeof input.name === "string" && input.name.trim() ? input.name.trim().slice(0, 80) : "API key";
  const senders = parseSenders(input.allowedSenders);
  if (!senders) return err(422, "List at least one allowed sender, such as hello@example.com or @example.com.");
  const rate = parseRate(input.ratePerHour);
  if (rate === null) return err(422, "The hourly limit must be a whole number from 0 to 100000.");
  const prefix = randomToken(6).replace(/[^A-Za-z0-9]/g, "x");
  const secret = randomToken(24);
  const id = newId("key");
  await insertApiKey({ id, name, prefix, secretHash: digest(secret), allowedSenders: senders, ratePerHour: rate });
  await recordAudit(actor, "credential.api_create", name, { id, prefix, allowedSenders: senders, ratePerHour: rate });
  return { ok: true, data: { id, key: `sj_${prefix}_${secret}` } };
}

export async function updateKey(actor: Actor, id: string, input: Record<string, unknown>): Promise<Result<Record<string, never>>> {
  const current = await getApiKey(id);
  if (!current) return err(404, "No such API key.");
  const changes: { allowedSenders?: string[]; ratePerHour?: number; name?: string } = {};
  if (input.allowedSenders !== undefined) {
    const senders = parseSenders(input.allowedSenders);
    if (!senders) return err(422, "List at least one allowed sender.");
    changes.allowedSenders = senders;
  }
  if (input.ratePerHour !== undefined) {
    const rate = parseRate(input.ratePerHour);
    if (rate === null) return err(422, "The hourly limit must be a whole number from 0 to 100000.");
    changes.ratePerHour = rate;
  }
  if (typeof input.name === "string" && input.name.trim()) changes.name = input.name.trim().slice(0, 80);
  await updateApiKey(id, changes);
  await recordAudit(actor, "credential.api_update", current.name, changes);
  return { ok: true, data: {} };
}

export async function revokeKey(actor: Actor, id: string): Promise<Result<Record<string, never>>> {
  const current = await getApiKey(id);
  if (!current) return err(404, "No such API key.");
  await updateApiKey(id, { revokedAt: new Date() });
  await recordAudit(actor, "credential.api_revoke", current.name, { prefix: current.prefix });
  return { ok: true, data: {} };
}

export async function authenticateApiKey(header: string | null) {
  const match = header?.match(/^Bearer\s+sj_([A-Za-z0-9]+)_([A-Za-z0-9_-]+)$/);
  if (!match) return null;
  const key = await findApiKeyByPrefix(match[1]!);
  if (!key || !safeEqual(key.secretHash, digest(match[2]!))) return null;
  await updateApiKey(key.id, { lastUsedAt: new Date() });
  return key;
}
