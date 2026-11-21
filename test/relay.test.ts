import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import nodemailer from "nodemailer";
import { Webhook } from "svix";
import { actor, freshDatabase } from "./helpers";
import { startFakeResend, type FakeResend } from "./fake-resend";
import { setSetting } from "../db/queries/settings";
import { insertDomain } from "../db/queries/domains";
import { getMessage, getMessageByResendId, getBlob } from "../db/queries/messages";
import { deliveriesFor } from "../db/queries/deliveries";
import { listSuppressions } from "../db/queries/suppressions";
import { createSmtpCredential } from "../server/credentials/service";
import { createDestination, upsertRoute } from "../server/inbound/config";
import { registerHandlers } from "../server/boot";
import { drainOnce, recoverLeases } from "../server/queue/queue";
import { startSmtp, stopSmtp } from "../server/smtp/server";
import { loadCertificate } from "../server/tls/certs";
import { processWebhook } from "../server/webhooks/resend";
import { reconcileOnce } from "../server/inbound/reconcile";
import { deliverJob } from "../server/inbound/deliver";
import { forwardViaResend } from "../server/destinations/forward";
import { parseMime } from "../server/outbound/mime";
import { resetEnv } from "../lib/env";
import { db } from "../db";
import { deliveries, jobs } from "../db/schema";
import { eq } from "drizzle-orm";

let fake: FakeResend;
let username = "";
let password = "";
const secret = `whsec_${randomBytes(24).toString("base64")}`;
const port = 30000 + Math.floor(Math.random() * 20000);

function signed(payload: unknown, id = `msg_${randomBytes(6).toString("hex")}`) {
  const body = JSON.stringify(payload);
  const timestamp = new Date();
  const signature = new Webhook(secret).sign(id, timestamp, body);
  const headers = new Headers({ "svix-id": id, "svix-timestamp": String(Math.floor(timestamp.getTime() / 1000)), "svix-signature": signature });
  return { body, headers };
}

function transport(overrides: Record<string, unknown> = {}) {
  return nodemailer.createTransport({
    host: "127.0.0.1",
    port,
    secure: false,
    requireTLS: true,
    tls: { rejectUnauthorized: false },
    auth: { user: username, pass: password },
    ...overrides,
  } as never);
}

beforeAll(async () => {
  fake = await startFakeResend();
  process.env.SNAPJAW_RESEND_BASE_URL = fake.url;
  process.env.SNAPJAW_SMTP_PORT = String(port);
  process.env.SNAPJAW_SMTPS_PORT = String(port + 1);
  process.env.SNAPJAW_SMTP_HOSTNAME = "localhost";
  resetEnv();
  await freshDatabase();
  await setSetting("resend.apiKey", "re_test_key");
  await setSetting("resend.webhookSecret", secret);
  await setSetting("instance.id", "testinstance");
  await setSetting("resend.rateLimit", "1000");
  await insertDomain({ id: "dom_1", resendId: "dom_r1", name: "example.com", status: "verified", receiving: true, records: [] });
  const created = await createSmtpCredential(actor(), { name: "Gmail", allowedSenders: ["@example.com"], ratePerHour: 50 });
  if (!created.ok) throw new Error(created.error);
  username = created.data.username;
  password = created.data.password;
  registerHandlers();
  await loadCertificate();
  await startSmtp();
});

afterAll(async () => {
  await stopSmtp();
  await fake.close();
});

describe("outbound over SMTP", () => {
  it("accepts authenticated mail from an allowed sender and sends it through Resend", async () => {
    const info = await transport().sendMail({
      from: "Jane <jane@example.com>",
      to: "bob@other.com",
      bcc: "secret@other.com",
      subject: "Hello",
      text: "Body text",
      messageId: "<thread-1@example.com>",
      inReplyTo: "<thread-0@other.com>",
    });
    expect(info.response).toMatch(/^250 .*Queued as msg_/);
    await drainOnce();
    expect(fake.sent).toHaveLength(1);
    const body = fake.sent[0]!.body as Record<string, unknown>;
    expect(body.from).toBe("Jane <jane@example.com>");
    expect(body.to).toEqual(["bob@other.com"]);
    expect(body.bcc).toEqual(["secret@other.com"]);
    expect((body.headers as Record<string, string>)["In-Reply-To"]).toBe("<thread-0@other.com>");
    expect(fake.sent[0]!.idempotencyKey).toMatch(/^snapjaw-msg_/);
    const id = info.response.match(/msg_[A-Za-z0-9_-]+/)![0];
    const message = await getMessage(id);
    expect(message?.status).toBe("sent");
    expect(await getBlob(id)).toBeUndefined();
  });

  it("rejects senders outside the allowed list", async () => {
    await expect(transport().sendMail({ from: "evil@other.com", to: "bob@other.com", subject: "x", text: "y" })).rejects.toThrow(/550/);
  });

  it("rejects a wrong password", async () => {
    await expect(transport({ auth: { user: username, pass: "wrong" } }).sendMail({ from: "jane@example.com", to: "bob@other.com", subject: "x", text: "y" })).rejects.toThrow(/535|Invalid login/);
  });

  it("refuses AUTH before STARTTLS", async () => {
    await expect(transport({ requireTLS: false, ignoreTLS: true }).sendMail({ from: "jane@example.com", to: "bob@other.com", subject: "x", text: "y" })).rejects.toThrow();
  });

  it("retries after a Resend outage without sending twice", async () => {
    fake.failNextSends = 1;
    const before = fake.sent.length;
    const info = await transport().sendMail({ from: "jane@example.com", to: "carl@other.com", subject: "Retry", text: "y" });
    const id = info.response.match(/msg_[A-Za-z0-9_-]+/)![0];
    await drainOnce();
    expect(fake.sent.length).toBe(before);
    await db.update(jobs).set({ runAt: new Date() }).where(eq(jobs.ref, id));
    await drainOnce();
    expect(fake.sent.length).toBe(before + 1);
    expect((await getMessage(id))?.status).toBe("sent");
  });
});

describe("Resend webhooks", () => {
  it("rejects bad signatures and replays, and records bounces as suppressions", async () => {
    const message = (await db.query.messages.findFirst({ where: (m, { eq: equals }) => equals(m.direction, "outbound") }))!;
    const payload = { type: "email.bounced", created_at: new Date().toISOString(), data: { email_id: message.resendId, to: ["bob@other.com"], bounce: { type: "Permanent", subType: "General", message: "Mailbox does not exist" } } };
    const good = signed(payload, "msg_fixed");
    const tampered = new Headers(good.headers);
    tampered.set("svix-signature", "v1,AAAA");
    expect((await processWebhook(good.body, tampered)).status).toBe(401);
    expect((await processWebhook(good.body, good.headers)).status).toBe(200);
    expect((await processWebhook(good.body, good.headers)).message).toBe("Already processed.");
    expect((await getMessage(message.id))?.status).toBe("bounced");
    expect((await listSuppressions()).map((s) => s.email)).toContain("bob@other.com");
    await expect(transport().sendMail({ from: "jane@example.com", to: "bob@other.com", subject: "x", text: "y" })).rejects.toThrow(/550/);
  });
});

describe("inbound", () => {
  let destinationId = "";

  beforeAll(async () => {
    const destination = await createDestination(actor(), { type: "forward", name: "Personal", address: "me@personal.net", from: "forwarder@example.com" });
    if (!destination.ok) throw new Error(destination.error);
    destinationId = destination.data.id;
    const route = await upsertRoute(actor(), null, { kind: "address", pattern: "hello@example.com", destinationIds: [destinationId] });
    if (!route.ok) throw new Error(route.error);
  });

  function receive(id: string, subject: string) {
    fake.received.set(id, {
      id,
      from: "sender@outside.org",
      to: ["hello@example.com"],
      subject,
      created_at: new Date().toISOString(),
      message_id: `<${id}@outside.org>`,
      raw: `From: Sender <sender@outside.org>\r\nTo: hello@example.com\r\nSubject: ${subject}\r\nMessage-ID: <${id}@outside.org>\r\n\r\nHi\r\n`,
    });
  }

  it("refuses routes that forward back into a Snapjaw domain", async () => {
    const looping = await createDestination(actor(), { type: "forward", name: "Loop", address: "other@example.com", from: "forwarder@example.com" });
    expect(looping.ok).toBe(false);
  });

  it("delivers a received message once, even when the webhook repeats", async () => {
    receive("rcv_1", "First");
    const payload = { type: "email.received", created_at: new Date().toISOString(), data: { email_id: "rcv_1", from: "sender@outside.org", to: ["hello@example.com"], subject: "First" } };
    expect((await processWebhook(signed(payload).body, signed(payload).headers)).status).toBe(200);
    const again = signed(payload);
    expect((await processWebhook(again.body, again.headers)).status).toBe(200);
    const before = fake.sent.length;
    await drainOnce();
    await drainOnce();
    const forwards = fake.sent.slice(before);
    expect(forwards).toHaveLength(1);
    expect((forwards[0]!.body as { to: string[] }).to).toEqual(["me@personal.net"]);
    expect((forwards[0]!.body as { reply_to: string[] }).reply_to).toEqual(["Sender <sender@outside.org>"]);
    const message = await getMessageByResendId("rcv_1");
    expect(message?.status).toBe("delivered");
    expect(await getBlob(message!.id)).toBeUndefined();
  });

  it("recovers from a crash in the middle of a delivery without sending twice", async () => {
    receive("rcv_2", "Second");
    const payload = { type: "email.received", created_at: new Date().toISOString(), data: { email_id: "rcv_2", from: "sender@outside.org", to: ["hello@example.com"], subject: "Second" } };
    const request = signed(payload);
    await processWebhook(request.body, request.headers);
    const message = (await getMessageByResendId("rcv_2"))!;
    const { processInbound } = await import("../server/inbound/process");
    await processInbound(message.id);
    const [delivery] = await deliveriesFor(message.id);
    const blob = (await getBlob(message.id))!;
    const before = fake.sent.length;
    await forwardViaResend(await parseMime(Buffer.from(blob.data, "base64")), { address: "me@personal.net", from: "forwarder@example.com" }, "testinstance", `snapjaw-fwd-${delivery!.id}`);
    await db.update(deliveries).set({ state: "in_flight" }).where(eq(deliveries.id, delivery!.id));
    await db.update(jobs).set({ state: "running", leaseUntil: new Date(Date.now() + 60_000) }).where(eq(jobs.ref, delivery!.id));
    expect(await recoverLeases()).toBeGreaterThan(0);
    await drainOnce();
    expect(fake.sent.length).toBe(before + 1);
    expect((await getMessage(message.id))?.status).toBe("delivered");
    expect((await deliverJob(delivery!.id)).status).toBe("done");
    expect(fake.sent.length).toBe(before + 1);
  });

  it("picks up messages the webhook missed through the reconciler", async () => {
    receive("rcv_3", "Missed");
    const first = await reconcileOnce();
    expect(first.added).toBe(1);
    const second = await reconcileOnce();
    expect(second.added).toBe(0);
    await drainOnce();
    expect((await getMessageByResendId("rcv_3"))?.status).toBe("delivered");
  });

  it("rejects mail with no matching route and keeps nothing", async () => {
    fake.received.set("rcv_4", { id: "rcv_4", from: "x@outside.org", to: ["nobody@example.com"], subject: "No route", created_at: new Date().toISOString(), message_id: "<rcv_4@outside.org>", raw: "From: x@outside.org\r\nTo: nobody@example.com\r\nSubject: No route\r\n\r\nHi\r\n" });
    await reconcileOnce();
    await drainOnce();
    const message = await getMessageByResendId("rcv_4");
    expect(message?.status).toBe("rejected");
    expect(await getBlob(message!.id)).toBeUndefined();
  });
});
