import client from "@prometheus-io/client";
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { destinations, domains, messages } from "../../db/schema";
import { queueDepth } from "../queue/queue";
import { quotaStatus } from "../quota/guard";

type MetricsState = { registry: client.Registry };

const store = globalThis as typeof globalThis & { __snapjawMetrics?: MetricsState };

function build(): MetricsState {
  const registry = new client.Registry();
  client.collectDefaultMetrics({ register: registry, prefix: "snapjaw_process_" });

  new client.Gauge({
    name: "snapjaw_queue_jobs",
    help: "Jobs in the durable queue by kind and state",
    labelNames: ["kind", "state"],
    registers: [registry],
    async collect() {
      this.reset();
      for (const row of await queueDepth()) this.set({ kind: row.kind, state: row.state }, Number(row.n));
    },
  });

  new client.Gauge({
    name: "snapjaw_quota_used",
    help: "Resend quota units used in the current period",
    labelNames: ["period"],
    registers: [registry],
    async collect() {
      const status = await quotaStatus();
      this.set({ period: "day" }, status.day);
      this.set({ period: "month" }, status.month);
    },
  });

  new client.Gauge({
    name: "snapjaw_quota_limit",
    help: "Configured Resend quota limit, 0 means none",
    labelNames: ["period"],
    registers: [registry],
    async collect() {
      const status = await quotaStatus();
      this.set({ period: "day" }, status.dailyLimit);
      this.set({ period: "month" }, status.monthlyLimit);
    },
  });

  new client.Gauge({
    name: "snapjaw_messages_24h",
    help: "Messages created in the last 24 hours by direction and status",
    labelNames: ["direction", "status"],
    registers: [registry],
    async collect() {
      this.reset();
      const since = Date.now() - 24 * 3600_000;
      const rows = await db
        .select({ direction: messages.direction, status: messages.status, n: sql<number>`count(*)` })
        .from(messages)
        .where(sql`${messages.createdAt} >= ${since}`)
        .groupBy(messages.direction, messages.status);
      for (const row of rows) this.set({ direction: row.direction, status: row.status }, Number(row.n));
    },
  });

  new client.Gauge({
    name: "snapjaw_destination_healthy",
    help: "1 when the destination's last delivery or test succeeded",
    labelNames: ["destination", "type"],
    registers: [registry],
    async collect() {
      this.reset();
      const rows = await db.select({ name: destinations.name, type: destinations.type, health: destinations.health }).from(destinations);
      for (const row of rows) this.set({ destination: row.name, type: row.type }, row.health === "failing" ? 0 : 1);
    },
  });

  new client.Gauge({
    name: "snapjaw_domain_verified",
    help: "1 when Resend reports the domain as verified",
    labelNames: ["domain"],
    registers: [registry],
    async collect() {
      this.reset();
      const rows = await db.select({ name: domains.name, status: domains.status }).from(domains);
      for (const row of rows) this.set({ domain: row.name }, row.status === "verified" ? 1 : 0);
    },
  });

  return { registry };
}

export async function renderMetrics(): Promise<{ body: string; contentType: string }> {
  store.__snapjawMetrics ??= build();
  const registry = store.__snapjawMetrics.registry;
  return { body: await registry.metrics(), contentType: registry.contentType };
}
