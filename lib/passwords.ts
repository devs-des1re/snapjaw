import { randomBytes } from "node:crypto";
import { hash, verify } from "@node-rs/argon2";

const options = { memoryCost: 19456, timeCost: 2, parallelism: 1, outputLen: 32, algorithm: 2 as const };

let dummy: Promise<string> | undefined;

export function hashPassword(password: string): Promise<string> {
  return hash(password, options);
}

export async function verifyPassword(password: string, stored: string | null | undefined): Promise<boolean> {
  dummy ??= hashPassword(randomBytes(16).toString("hex"));
  const target = stored ?? (await dummy);
  try {
    const valid = await verify(target, password);
    return Boolean(stored) && valid;
  } catch {
    return false;
  }
}

export function passwordProblem(password: string): string | null {
  if (password.length < 12) return "Use at least 12 characters.";
  if (password.length > 256) return "Use at most 256 characters.";
  return null;
}
