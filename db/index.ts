import fs from "node:fs";
import { createClient, type Client } from "@libsql/client";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { env } from "../lib/env";
import { logger } from "../lib/logger";
import * as schema from "./schema";

export type Database = LibSQLDatabase<typeof schema>;

type Holder = { client: Client; db: Database; ready?: Promise<void> };

const store = globalThis as typeof globalThis & { __snapjawDb?: Holder };

function open(url?: string): Holder {
  const config = env();
  if (!url) fs.mkdirSync(config.dataDir, { recursive: true });
  const client = createClient({ url: url ?? `file:${config.databaseFile}` });
  return { client, db: drizzle(client, { schema }) };
}

function holder(): Holder {
  store.__snapjawDb ??= open();
  return store.__snapjawDb;
}

export const db: Database = new Proxy({} as Database, {
  get(_target, prop) {
    const real = holder().db as unknown as Record<string | symbol, unknown>;
    const value = real[prop];
    return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(real) : value;
  },
});

export function rawClient(): Client {
  return holder().client;
}

export function useDatabase(url: string) {
  store.__snapjawDb = open(url);
  return store.__snapjawDb;
}

export async function closeDatabase() {
  store.__snapjawDb?.client.close();
  store.__snapjawDb = undefined;
}

export function prepareDatabase(migrationsFolder = env().migrationsDir): Promise<void> {
  const current = holder();
  current.ready ??= (async () => {
    await current.client.execute("PRAGMA journal_mode = WAL");
    await current.client.execute("PRAGMA busy_timeout = 5000");
    await current.client.execute("PRAGMA foreign_keys = ON");
    await migrate(current.db, { migrationsFolder });
    logger.info("Database ready");
  })();
  return current.ready;
}

export { schema };
