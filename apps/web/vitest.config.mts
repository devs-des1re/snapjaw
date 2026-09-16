import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    // Mirror the "@/*" path alias from tsconfig.json.
    alias: {
      "@": rootDir,
    },
  },
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts"],
  },
});
