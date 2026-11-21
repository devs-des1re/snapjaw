import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist/**", ".krate/**", "node_modules/**", "data/**", "drizzle/**", "public/**", "src/krate-env.d.ts", "src/krate-content.d.ts"] },
  ...tseslint.configs.recommended,
  {
    files: ["**/*.ts", "**/*.tsx"],
    rules: {
      "no-console": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "error",
    },
  },
  {
    files: ["lib/logger.ts"],
    rules: { "no-console": "off", "@typescript-eslint/no-unused-expressions": "off" },
  },
);
