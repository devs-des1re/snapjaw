import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "../index";
import { deliveries, jobs } from "../schema";
import { newId } from "../../lib/crypto";

export async function createDeliveries(messageId: string, targets: { destinationId: string; recipient: string }[]) {
  const ids: string[] = [];
  await db.transaction(async (tx) => {
    for (const target of targets) {
      const id = newId("dlv");
      const inserted = await tx
        .insert(deliveries)
        .values({ id, messageId, destinationId: target.destinationId, recipient: target.recipient })
        .onConflictDoNothing()
        .returning({ id: deliveries.id });
      if (inserted.length) {
        ids.push(id);
        await tx.insert(jobs).values({ id: newId("job"), kind: "deliver", ref: id }).onConflictDoNothing();
      }
    }
  });
  return ids;
}

export async function getDelivery(id: string) {
  return db.query.deliveries.findFirst({ where: eq(deliveries.id, id) });
}

export async function setDeliveryState(id: string, state: "pending" | "in_flight" | "done" | "failed" | "skipped", error: string | null) {
  await db
    .update(deliveries)
    .set({ state, error, updatedAt: new Date(), ...(state === "in_flight" ? { attempts: sql`${deliveries.attempts} + 1` } : {}) })
    .where(eq(deliveries.id, id));
}

export async function deliveriesFor(messageId: string) {
  return db.select().from(deliveries).where(eq(deliveries.messageId, messageId));
}

export async function resetFailedDeliveries(messageId: string) {
  const failed = await db.select().from(deliveries).where(and(eq(deliveries.messageId, messageId), inArray(deliveries.state, ["failed"])));
  for (const delivery of failed) {
    await db.update(deliveries).set({ state: "pending", error: null, updatedAt: new Date() }).where(eq(deliveries.id, delivery.id));
    await db.update(jobs).set({ state: "queued", attempts: 0, runAt: new Date(), lastError: null, updatedAt: new Date() }).where(and(eq(jobs.kind, "deliver"), eq(jobs.ref, delivery.id)));
  }
  return failed.length;
}

export async function setDeliveryError(id: string, error: string) {
  await db.update(deliveries).set({ error, updatedAt: new Date() }).where(eq(deliveries.id, id));
}
