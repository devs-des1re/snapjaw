import { existsSync } from "node:fs";

import { defineConfig } from "drizzle-kit";

// drizzle-kit does not read Next's `.env.local`, so load it here without adding a dependency.
const loadEnvFile = (process as unknown as { loadEnvFile?: (path: string) => void }).loadEnvFile;
if (loadEnvFile) {
  for (const file of [".env.local", ".env"]) {
    if (!existsSync(file)) continue;
    try {
      loadEnvFile(file);
    } catch {
      // Ignore an unreadable env file; a real problem will surface below.
    }
  }
}

export default defineConfig({
  schema: "./lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  strict: true,
  verbose: true,
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
});
