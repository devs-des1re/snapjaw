import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { closeDatabase, prepareDatabase, useDatabase } from "../db";
import { resetEnv } from "../lib/env";
import type { Actor } from "../server/http/guard";

export async function freshDatabase() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "snapjaw-test-"));
  process.env.SNAPJAW_DATA_DIR = dir;
  process.env.SNAPJAW_SECRET_KEY ??= randomBytes(32).toString("base64");
  process.env.SNAPJAW_MIGRATIONS_DIR = path.resolve("drizzle");
  resetEnv();
  await closeDatabase();
  useDatabase(`file:${path.join(dir, "test.db")}`);
  await prepareDatabase(path.resolve("drizzle"));
  return dir;
}

export function actor(overrides: Partial<Actor> = {}): Actor {
  return { id: "usr_test", email: "test@snapjaw.test", role: "owner", ip: "127.0.0.1", userAgent: "vitest", ...overrides };
}
