import { asc, eq } from "drizzle-orm";
import { db } from "../index";
import { domains, type DnsRecord } from "../schema";

export async function listDomainRows() {
  return db.select().from(domains).orderBy(asc(domains.name));
}

export async function getDomainRow(id: string) {
  return db.query.domains.findFirst({ where: eq(domains.id, id) });
}

export async function findDomainByName(name: string) {
  return db.query.domains.findFirst({ where: eq(domains.name, name.toLowerCase()) });
}

export async function insertDomain(values: typeof domains.$inferInsert) {
  await db.insert(domains).values(values);
}

export async function updateDomainRow(id: string, values: { status?: string; records?: DnsRecord[]; checkedAt?: Date; receiving?: boolean; sending?: boolean; region?: string | null }) {
  await db.update(domains).set(values).where(eq(domains.id, id));
}

export async function deleteDomainRow(id: string) {
  await db.delete(domains).where(eq(domains.id, id));
}

export async function verifiedDomainNames(): Promise<string[]> {
  const rows = await db.select({ name: domains.name, status: domains.status }).from(domains);
  return rows.filter((row) => row.status === "verified" || row.status === "partially_verified").map((row) => row.name);
}

export async function allDomainNames(): Promise<string[]> {
  const rows = await db.select({ name: domains.name }).from(domains);
  return rows.map((row) => row.name);
}
