import { and, asc, desc, eq, gte, inArray, like, lt, lte, or, sql, type SQL } from "drizzle-orm";
import { db } from "../index";
import { blobs, deliveries, jobs, messageEvents, messages } from "../schema";
import { newId } from "../../lib/crypto";

export type MessageInsert = {
  direction: "outbound" | "inbound";
  resendId?: string | null;
  messageId?: string | null;
  fromAddress: string;
  toAddresses: string[];
  subject?: string | null;
  size: number;
  recipients: number;
  status: string;
  source?: string | null;
  credentialId?: string | null;
};

export async function createQueuedMessage(input: MessageInsert & { blob: string; blobMeta: Record<string, unknown>; jobKind: "send" | "inbound"; runAt?: Date; event?: string }) {
  const id = newId("msg");
  await db.transaction(async (tx) => {
    await tx.insert(messages).values({
      id,
      direction: input.direction,
      resendId: input.resendId ?? null,
      messageId: input.messageId ?? null,
      fromAddress: input.fromAddress,
      toAddresses: input.toAddresses,
      subject: input.subject ?? null,
      size: input.size,
      recipients: input.recipients,
      status: input.status,
      source: input.source ?? null,
      credentialId: input.credentialId ?? null,
    });
    await tx.insert(blobs).values({ messageId: id, data: input.blob, meta: input.blobMeta });
    await tx.insert(messageEvents).values({ messageId: id, status: input.status, detail: input.event ?? null });
    await tx.insert(jobs).values({ id: newId("job"), kind: input.jobKind, ref: id, runAt: input.runAt ?? new Date() });
  });
  return id;
}

export async function createInboundStub(input: MessageInsert & { event?: string }) {
  const id = newId("msg");
  const inserted = await db
    .insert(messages)
    .values({
      id,
      direction: "inbound",
      resendId: input.resendId ?? null,
      messageId: input.messageId ?? null,
      fromAddress: input.fromAddress,
      toAddresses: input.toAddresses,
      subject: input.subject ?? null,
      size: input.size,
      recipients: input.recipients,
      status: input.status,
      source: input.source ?? null,
    })
    .onConflictDoNothing({ target: messages.resendId })
    .returning({ id: messages.id });
  if (!inserted.length) return null;
  await db.insert(messageEvents).values({ messageId: id, status: input.status, detail: input.event ?? null });
  await db.insert(jobs).values({ id: newId("job"), kind: "inbound", ref: id }).onConflictDoNothing();
  return id;
}

export async function getMessage(id: string) {
  return db.query.messages.findFirst({ where: eq(messages.id, id) });
}

export async function getMessageByResendId(resendId: string) {
  return db.query.messages.findFirst({ where: eq(messages.resendId, resendId) });
}

export async function knownResendIds(ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const rows = await db.select({ resendId: messages.resendId }).from(messages).where(inArray(messages.resendId, ids));
  return new Set(rows.map((row) => row.resendId).filter((value): value is string => Boolean(value)));
}

export async function setMessageStatus(id: string, status: string, detail?: string | null, extra: Partial<typeof messages.$inferInsert> = {}) {
  await db
    .update(messages)
    .set({ status, error: status === "failed" || status === "bounced" || status === "complained" || status === "rejected" ? (detail ?? null) : null, updatedAt: new Date(), ...extra })
    .where(eq(messages.id, id));
  await db.insert(messageEvents).values({ messageId: id, status, detail: detail ?? null });
}

export async function addEvent(id: string, status: string, detail?: string | null) {
  await db.insert(messageEvents).values({ messageId: id, status, detail: detail ?? null });
}

export async function updateMessage(id: string, values: Partial<typeof messages.$inferInsert>) {
  await db.update(messages).set({ ...values, updatedAt: new Date() }).where(eq(messages.id, id));
}

export async function getBlob(messageId: string) {
  return db.query.blobs.findFirst({ where: eq(blobs.messageId, messageId) });
}

export async function putBlob(messageId: string, data: string, meta: Record<string, unknown>) {
  await db.insert(blobs).values({ messageId, data, meta }).onConflictDoUpdate({ target: blobs.messageId, set: { data, meta } });
}

export async function deleteBlob(messageId: string) {
  await db.delete(blobs).where(eq(blobs.messageId, messageId));
}

export async function pendingOutboundUnits(): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`coalesce(sum(${messages.recipients}), 0)` })
    .from(messages)
    .where(and(eq(messages.direction, "outbound"), inArray(messages.status, ["accepted", "queued", "held"])));
  return Number(row?.n ?? 0);
}

export type MessageFilter = { direction?: string; status?: string; q?: string; from?: Date; to?: Date; before?: string; limit?: number };

export async function listMessages(filter: MessageFilter) {
  const conditions: SQL[] = [];
  if (filter.direction === "inbound" || filter.direction === "outbound") conditions.push(eq(messages.direction, filter.direction));
  if (filter.status) conditions.push(eq(messages.status, filter.status));
  if (filter.from) conditions.push(gte(messages.createdAt, filter.from));
  if (filter.to) conditions.push(lte(messages.createdAt, filter.to));
  if (filter.q) {
    const pattern = `%${filter.q.toLowerCase()}%`;
    const match = or(
      like(sql`lower(${messages.fromAddress})`, pattern),
      like(sql`lower(${messages.toAddresses})`, pattern),
      like(sql`lower(${messages.subject})`, pattern),
      like(messages.resendId, pattern),
      like(messages.id, pattern),
    );
    if (match) conditions.push(match);
  }
  if (filter.before) {
    const cursor = await getMessage(filter.before);
    if (cursor) conditions.push(lt(messages.createdAt, cursor.createdAt));
  }
  return db
    .select()
    .from(messages)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(messages.createdAt))
    .limit(Math.min(filter.limit ?? 50, 200));
}

export async function messageDetail(id: string) {
  const message = await getMessage(id);
  if (!message) return null;
  const [events, deliveryRows, jobRows] = await Promise.all([
    db.select().from(messageEvents).where(eq(messageEvents.messageId, id)).orderBy(asc(messageEvents.id)),
    db.select().from(deliveries).where(eq(deliveries.messageId, id)),
    db.select().from(jobs).where(eq(jobs.ref, id)),
  ]);
  return { message, events, deliveries: deliveryRows, jobs: jobRows };
}

export async function recentFailures(limit = 10) {
  return db
    .select()
    .from(messages)
    .where(inArray(messages.status, ["failed", "bounced", "complained", "rejected"]))
    .orderBy(desc(messages.updatedAt))
    .limit(limit);
}

export async function pruneMessages(before: Date) {
  await db.delete(messages).where(and(lt(messages.createdAt, before), sql`not exists (select 1 from ${blobs} where ${blobs.messageId} = ${messages.id})`));
}

export async function statusCounts(since: Date) {
  return db
    .select({ direction: messages.direction, status: messages.status, n: sql<number>`count(*)` })
    .from(messages)
    .where(gte(messages.createdAt, since))
    .groupBy(messages.direction, messages.status);
}
