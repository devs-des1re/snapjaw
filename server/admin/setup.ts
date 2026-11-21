import { countUsers, createAdmin } from "../../db/queries/users";
import { recordAudit } from "../../db/queries/audit";
import { randomToken, safeEqual } from "../../lib/crypto";
import { hashPassword, passwordProblem } from "../../lib/passwords";
import { logger } from "../../lib/logger";
import { env } from "../../lib/env";
import { isEmail } from "../../lib/address";

const store = globalThis as typeof globalThis & { __snapjawSetupToken?: string };

export async function announceSetupToken(): Promise<void> {
  if ((await countUsers()) > 0) return;
  store.__snapjawSetupToken ??= randomToken(18);
  logger.warn(`No admin exists yet. Open ${env().publicUrl}/setup and use this setup token: ${store.__snapjawSetupToken}`);
  logger.warn("Or run: snapjaw admin create --email you@example.com");
}

export type SetupInput = { token: string; email: string; name: string; password: string };

export async function completeSetup(input: SetupInput, info: { ip: string | null; userAgent: string | null }) {
  if ((await countUsers()) > 0) return { ok: false as const, status: 409, error: "Setup is already complete." };
  const expected = store.__snapjawSetupToken;
  if (!expected || !safeEqual(input.token.trim(), expected)) return { ok: false as const, status: 403, error: "The setup token does not match the one in the logs." };
  if (!isEmail(input.email)) return { ok: false as const, status: 422, error: "Enter a valid email address." };
  const problem = passwordProblem(input.password);
  if (problem) return { ok: false as const, status: 422, error: problem };
  const id = await createAdmin({ email: input.email, name: input.name, role: "owner", passwordHash: await hashPassword(input.password) });
  store.__snapjawSetupToken = undefined;
  await recordAudit({ id, email: input.email, ...info }, "admin.setup", input.email, { role: "owner" });
  return { ok: true as const, id };
}

export function setupTokenForTests(value?: string) {
  store.__snapjawSetupToken = value;
}
