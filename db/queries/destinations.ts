import { asc, eq, inArray } from "drizzle-orm";
import { db } from "../index";
import { destinations, routeDestinations, routes } from "../schema";
import { decrypt, encrypt } from "../../lib/crypto";

export type ImapConfig = { host: string; port: number; secure: boolean; username: string; password: string; mailbox: string };
export type GmailConfig = { email: string; refreshToken: string; labelIds: string[]; connectedAt?: string };
export type ForwardConfig = { address: string; from: string };
export type DestinationConfig = ImapConfig | GmailConfig | ForwardConfig;
export type DestinationType = "gmail" | "imap" | "forward";

export type Destination = Omit<typeof destinations.$inferSelect, "config"> & { config: DestinationConfig };

function open(row: typeof destinations.$inferSelect): Destination {
  return { ...row, config: JSON.parse(decrypt(row.config)) as DestinationConfig };
}

export async function listDestinationRows() {
  const rows = await db.select().from(destinations).orderBy(asc(destinations.name));
  return rows.map(open);
}

export async function getDestination(id: string): Promise<Destination | null> {
  const row = await db.query.destinations.findFirst({ where: eq(destinations.id, id) });
  return row ? open(row) : null;
}

export async function insertDestination(values: { id: string; name: string; type: DestinationType; config: DestinationConfig }) {
  await db.insert(destinations).values({ ...values, config: encrypt(JSON.stringify(values.config)) });
}

export async function updateDestination(id: string, values: { name?: string; config?: DestinationConfig }) {
  const set: Partial<typeof destinations.$inferInsert> = {};
  if (values.name) set.name = values.name;
  if (values.config) set.config = encrypt(JSON.stringify(values.config));
  await db.update(destinations).set(set).where(eq(destinations.id, id));
}

export async function setDestinationHealth(id: string, health: "ok" | "failing" | "unknown", lastError: string | null) {
  await db.update(destinations).set({ health, lastError, lastCheckedAt: new Date() }).where(eq(destinations.id, id));
}

export async function deleteDestination(id: string) {
  await db.delete(destinations).where(eq(destinations.id, id));
}

export async function listRoutesWithDestinations() {
  const routeRows = await db.select().from(routes).orderBy(asc(routes.domain), asc(routes.pattern));
  const links = routeRows.length ? await db.select().from(routeDestinations).where(inArray(routeDestinations.routeId, routeRows.map((r) => r.id))) : [];
  return routeRows.map((route) => ({ ...route, destinationIds: links.filter((link) => link.routeId === route.id).map((link) => link.destinationId) }));
}

export async function getRoute(id: string) {
  const route = await db.query.routes.findFirst({ where: eq(routes.id, id) });
  if (!route) return null;
  const links = await db.select().from(routeDestinations).where(eq(routeDestinations.routeId, id));
  return { ...route, destinationIds: links.map((link) => link.destinationId) };
}

export async function saveRoute(values: typeof routes.$inferInsert, destinationIds: string[]) {
  await db.transaction(async (tx) => {
    await tx.insert(routes).values(values).onConflictDoUpdate({ target: routes.id, set: { kind: values.kind, pattern: values.pattern, domain: values.domain, enabled: values.enabled, note: values.note } });
    await tx.delete(routeDestinations).where(eq(routeDestinations.routeId, values.id));
    for (const destinationId of destinationIds) await tx.insert(routeDestinations).values({ routeId: values.id, destinationId });
  });
}

export async function deleteRoute(id: string) {
  await db.delete(routes).where(eq(routes.id, id));
}

export async function routesUsingDestination(destinationId: string) {
  const links = await db.select().from(routeDestinations).where(eq(routeDestinations.destinationId, destinationId));
  return links.map((link) => link.routeId);
}
