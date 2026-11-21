import fs from "node:fs";
import net from "node:net";
import tls from "node:tls";
import { promises as dns } from "node:dns";
import { countActiveOwners } from "../../db/queries/users";
import { getSetting } from "../../db/queries/settings";
import { listDomainRows } from "../../db/queries/domains";
import { listDestinationRows, type ForwardConfig, type GmailConfig, type ImapConfig } from "../../db/queries/destinations";
import type { DnsRecord } from "../../db/schema";
import { env } from "../../lib/env";
import { queueDepth } from "../queue/queue";
import { testResend } from "../settings/service";
import { certificateInfo } from "../tls/certs";
import { testImap } from "../destinations/imap";
import { testGmail } from "../destinations/gmail";

export type Check = { name: string; status: "ok" | "warn" | "fail"; detail: string; fix?: string };

const ok = (name: string, detail: string): Check => ({ name, status: "ok", detail });
const warn = (name: string, detail: string, fix: string): Check => ({ name, status: "warn", detail, fix });
const bad = (name: string, detail: string, fix: string): Check => ({ name, status: "fail", detail, fix });

function fqdn(record: DnsRecord, domain: string): string {
  const name = record.name.replace(/\.$/, "");
  if (!name || name === "@" || name === domain) return domain;
  return name.endsWith(`.${domain}`) ? name : `${name}.${domain}`;
}

function normalize(value: string): string {
  return value.replace(/^"|"$/g, "").replace(/"\s*"/g, "").replace(/\.$/, "").trim().toLowerCase();
}

export async function checkRecord(record: DnsRecord, domain: string): Promise<Check> {
  const host = fqdn(record, domain);
  const label = `DNS ${record.type} ${host}`;
  const expected = normalize(record.value);
  const fix = `Create a ${record.type} record named ${record.name} with value ${record.value}${record.priority !== undefined ? ` and priority ${record.priority}` : ""}.`;
  try {
    if (record.type === "MX") {
      const found = await dns.resolveMx(host);
      const match = found.find((mx) => normalize(mx.exchange) === expected);
      if (!match) return bad(label, `Expected ${record.value}, found ${found.map((mx) => mx.exchange).join(", ") || "none"}`, fix);
      const lowest = Math.min(...found.map((mx) => mx.priority));
      if (match.priority > lowest) return bad(label, `Present, but another MX record has a lower priority value (${lowest}), so Resend never receives the mail.`, "Remove the other MX records or use a subdomain for receiving.");
      return ok(label, "Present with the lowest priority");
    }
    if (record.type === "TXT") {
      const found = (await dns.resolveTxt(host)).map((parts) => normalize(parts.join("")));
      return found.includes(expected) ? ok(label, "Present") : bad(label, `Expected value not found (${found.length} TXT record(s) published)`, fix);
    }
    if (record.type === "CNAME") {
      const found = (await dns.resolveCname(host)).map(normalize);
      return found.includes(expected) ? ok(label, "Present") : bad(label, `Expected ${record.value}, found ${found.join(", ") || "none"}`, fix);
    }
    return warn(label, `Snapjaw cannot check ${record.type} records`, "Check it in the Resend dashboard.");
  } catch (error) {
    const code = (error as { code?: string }).code ?? "";
    return bad(label, code === "ENOTFOUND" || code === "ENODATA" ? "Not published" : `Lookup failed: ${code || String(error)}`, fix);
  }
}

function smtpBanner(port: number, secure: boolean): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = secure ? tls.connect({ host: "127.0.0.1", port, timeout: 4000, rejectUnauthorized: false, servername: env().smtpHostname }) : net.connect({ host: "127.0.0.1", port, timeout: 4000 });
    socket.once("data", (data) => {
      resolve(data.toString().trim());
      socket.end();
    });
    socket.once("timeout", () => {
      socket.destroy();
      reject(new Error("timed out"));
    });
    socket.once("error", reject);
  });
}

async function baseChecks(): Promise<Check[]> {
  const config = env();
  const checks: Check[] = [ok("Database", config.databaseFile)];
  checks.push(
    config.secretKey
      ? ok("Secret key", "SNAPJAW_SECRET_KEY is set")
      : fs.existsSync(`${config.dataDir}/secret.key`)
        ? warn("Secret key", "Using the generated key in the data folder", "Copy data/secret.key into SNAPJAW_SECRET_KEY and back it up.")
        : bad("Secret key", "No key found", "Set SNAPJAW_SECRET_KEY to 32 random bytes, base64 encoded."),
  );
  const owners = await countActiveOwners();
  checks.push(owners > 0 ? ok("Owners", `${owners} active owner(s)`) : bad("Owners", "No active owner", "Run snapjaw admin create --email you@example.com"));
  checks.push(config.publicUrl.startsWith("https://") ? ok("Public URL", config.publicUrl) : warn("Public URL", `${config.publicUrl} is not https`, "Set SNAPJAW_PUBLIC_URL to the https address Resend and Google can reach."));
  return checks;
}

async function resendChecks(): Promise<Check[]> {
  if (!(await getSetting("resend.apiKey"))) return [bad("Resend API key", "Not set", "Add it under Settings in the admin UI.")];
  const checks: Check[] = [];
  const result = await testResend();
  checks.push(result.ok ? ok("Resend API", `Connected, ${result.data.domains} domain(s) in the account`) : bad("Resend API", result.error, "Check the key and outbound internet access."));
  checks.push((await getSetting("resend.webhookSecret")) ? ok("Resend webhook", "Signing secret stored") : bad("Resend webhook", "No signing secret", "Use Connect automatically under Settings."));
  return checks;
}

async function domainChecks(): Promise<Check[]> {
  const rows = await listDomainRows();
  if (!rows.length) return [bad("Domains", "None added", "Add a domain under Domains.")];
  const checks: Check[] = [];
  for (const row of rows) {
    checks.push(row.status === "verified" ? ok(`Domain ${row.name}`, "Verified in Resend") : warn(`Domain ${row.name}`, `Resend status: ${row.status}`, "Publish the DNS records and press Re-check."));
    for (const record of row.records) checks.push(await checkRecord(record, row.name));
  }
  return checks;
}

async function tlsChecks(): Promise<Check[]> {
  const config = env();
  const checks: Check[] = [];
  try {
    const cert = await certificateInfo();
    if (cert.source === "self-signed") checks.push(bad("TLS certificate", "Self-signed", "Set SNAPJAW_TLS_CERT and SNAPJAW_TLS_KEY, or SNAPJAW_ACME_EMAIL. Gmail refuses self-signed certificates."));
    else if (!cert.matchesHost) checks.push(bad("TLS certificate", `Does not cover ${config.smtpHostname} (${cert.names})`, "Use a certificate issued for SNAPJAW_SMTP_HOSTNAME."));
    else if (cert.daysLeft < 14) checks.push(warn("TLS certificate", `Expires in ${cert.daysLeft} days`, "Renew it. ACME renews automatically when 30 days are left."));
    else checks.push(ok("TLS certificate", `${cert.source}, valid for ${cert.daysLeft} more days`));
  } catch (error) {
    checks.push(bad("TLS certificate", error instanceof Error ? error.message : String(error), "Check the certificate files."));
  }
  for (const [label, port, secure] of [["SMTP submission", config.smtpSubmissionPort, false], ["SMTPS", config.smtpsPort, true]] as const) {
    try {
      const banner = await smtpBanner(port, secure);
      checks.push(ok(`${label} port ${port}`, banner.slice(0, 80) || "Listening"));
    } catch (error) {
      checks.push(warn(`${label} port ${port}`, `Not reachable from here: ${error instanceof Error ? error.message : String(error)}`, "Run doctor inside the Snapjaw container, and check the port mapping in docker-compose.yml."));
    }
  }
  if (config.smtpHostname !== "localhost") {
    try {
      const addresses = await dns.resolve(config.smtpHostname);
      checks.push(ok(`DNS ${config.smtpHostname}`, addresses.join(", ")));
    } catch {
      checks.push(bad(`DNS ${config.smtpHostname}`, "Does not resolve", "Create an A or AAAA record pointing at this server."));
    }
  }
  return checks;
}

async function destinationChecks(): Promise<Check[]> {
  const rows = await listDestinationRows();
  const checks: Check[] = [];
  for (const row of rows) {
    const name = `Destination ${row.name}`;
    try {
      if (row.type === "imap") checks.push(ok(name, await testImap(row.config as ImapConfig)));
      else if (row.type === "gmail") {
        if (!(row.config as GmailConfig).refreshToken) checks.push(bad(name, "Not connected", "Open Destinations and press Connect."));
        else checks.push(ok(name, await testGmail(row.config as GmailConfig)));
      } else checks.push(ok(name, `Forwards to ${(row.config as ForwardConfig).address}`));
    } catch (error) {
      checks.push(bad(name, error instanceof Error ? error.message : String(error), "Fix the destination settings, then run doctor again."));
    }
  }
  const dead = (await queueDepth()).filter((row) => row.state === "dead").reduce((sum, row) => sum + Number(row.n), 0);
  checks.push(dead ? warn("Dead-letter list", `${dead} job(s) gave up`, "Open Messages, filter by failed, and retry after fixing the cause.") : ok("Dead-letter list", "Empty"));
  return checks;
}

export async function runDoctor(): Promise<Check[]> {
  const groups = [baseChecks, resendChecks, domainChecks, tlsChecks, destinationChecks];
  const out: Check[] = [];
  for (const group of groups) {
    try {
      out.push(...(await group()));
    } catch (error) {
      out.push(bad("Check failed", error instanceof Error ? error.message : String(error), "Report this as a bug."));
    }
  }
  return out;
}
