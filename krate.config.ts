import { defineConfig } from "@krate/core";

export default defineConfig({
  outDir: "dist",
  pagesDir: "src/pages",
  publicDir: "public",
  minify: true,
  sourcemap: false,
  devServer: { port: 3000, open: false },
  viewTransitions: "off",
  csp: { enabled: true },
  serverExternalPackages: ["@node-rs/argon2", "@libsql/client", "libsql", "googleapis", "imapflow", "smtp-server", "mailparser", "nodemailer", "svix", "acme-client", "qrcode"],
  ssr: {
    apiRuntime: "node",
    middlewareRuntime: "node",
    nodeWorkers: 1,
  },
});
