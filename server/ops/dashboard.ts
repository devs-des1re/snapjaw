import { listDomainRows } from "../../db/queries/domains";
import { recentFailures, statusCounts } from "../../db/queries/messages";
import { getSetting } from "../../db/queries/settings";
import { usageHistory } from "../../db/queries/usage";
import { db } from "../../db";
import { destinations } from "../../db/schema";
import { env } from "../../lib/env";
import { queueDepth } from "../queue/queue";
import { quotaStatus } from "../quota/guard";
import { certificateInfo } from "../tls/certs";

export async function dashboard() {
  const since = new Date(Date.now() - 24 * 3600_000);
  const [quota, depth, failures, counts, domainRows, destinationRows, history, apiKey, webhookSecret, cert] = await Promise.all([
    quotaStatus(),
    queueDepth(),
    recentFailures(8),
    statusCounts(since),
    listDomainRows(),
    db.select({ id: destinations.id, name: destinations.name, type: destinations.type, health: destinations.health, lastError: destinations.lastError, lastCheckedAt: destinations.lastCheckedAt }).from(destinations),
    usageHistory(30),
    getSetting("resend.apiKey"),
    getSetting("resend.webhookSecret"),
    certificateInfo().catch(() => null),
  ]);
  const config = env();
  return {
    quota,
    queue: depth,
    failures: failures.map((m) => ({ id: m.id, direction: m.direction, fromAddress: m.fromAddress, toAddresses: m.toAddresses, subject: m.subject, status: m.status, error: m.error, updatedAt: m.updatedAt })),
    last24h: counts,
    domains: domainRows.map((d) => ({ id: d.id, name: d.name, status: d.status, receiving: d.receiving, checkedAt: d.checkedAt })),
    destinations: destinationRows,
    history,
    setup: {
      resendKey: Boolean(apiKey),
      webhook: Boolean(webhookSecret),
      domain: domainRows.some((d) => d.status === "verified"),
      certificate: cert ? cert.source !== "self-signed" : false,
    },
    smtp: { hostname: config.smtpHostname, certificate: cert },
  };
}
