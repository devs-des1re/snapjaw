import path from "node:path";

function num(name: string, fallback: number) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`${name} must be a number`);
  return value;
}

function str(name: string, fallback = "") {
  const raw = process.env[name];
  return raw === undefined || raw === "" ? fallback : raw;
}

export function loadEnv() {
  const dataDir = path.resolve(str("SNAPJAW_DATA_DIR", "data"));
  return {
    production: process.env.NODE_ENV === "production",
    dataDir,
    databaseFile: path.join(dataDir, "snapjaw.db"),
    migrationsDir: path.resolve(str("SNAPJAW_MIGRATIONS_DIR", "drizzle")),
    publicUrl: str("SNAPJAW_PUBLIC_URL", "http://localhost:3000").replace(/\/+$/, ""),
    secretKey: str("SNAPJAW_SECRET_KEY"),
    smtpHostname: str("SNAPJAW_SMTP_HOSTNAME", "localhost"),
    smtpSubmissionPort: num("SNAPJAW_SMTP_PORT", 2587),
    smtpsPort: num("SNAPJAW_SMTPS_PORT", 2465),
    smtpEnabled: str("SNAPJAW_SMTP_ENABLED", "true") !== "false",
    tlsCertFile: str("SNAPJAW_TLS_CERT"),
    tlsKeyFile: str("SNAPJAW_TLS_KEY"),
    acmeEmail: str("SNAPJAW_ACME_EMAIL"),
    acmeStaging: str("SNAPJAW_ACME_STAGING", "false") === "true",
    metricsToken: str("SNAPJAW_METRICS_TOKEN"),
    workersEnabled: str("SNAPJAW_WORKERS", "true") !== "false",
    resendBaseUrl: str("SNAPJAW_RESEND_BASE_URL", "https://api.resend.com").replace(/\/+$/, ""),
    trustProxy: str("SNAPJAW_TRUST_PROXY", "false") === "true",
  };
}

export type Env = ReturnType<typeof loadEnv>;

const store = globalThis as typeof globalThis & { __snapjawEnv?: Env };

export function env(): Env {
  store.__snapjawEnv ??= loadEnv();
  return store.__snapjawEnv;
}

export function resetEnv() {
  store.__snapjawEnv = undefined;
}
