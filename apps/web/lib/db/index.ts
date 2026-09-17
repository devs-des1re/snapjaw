import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "@/lib/db/schema";

type Database = ReturnType<typeof connect>;

const globalForDb = globalThis as unknown as { __snapjawDb?: Database };

function connect() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set. Copy apps/web/.env.example to apps/web/.env.local and fill it in.",
    );
  }

  const client = postgres(connectionString, { max: 5 });
  return drizzle(client, { schema });
}

// Lazily connected and cached on globalThis: importing must not throw, and hot reloads reuse the pool.
export function getDb(): Database {
  if (!globalForDb.__snapjawDb) {
    globalForDb.__snapjawDb = connect();
  }
  return globalForDb.__snapjawDb;
}

export { schema };
