import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { actor, freshDatabase } from "./helpers";
import { startFakeResend, type FakeResend } from "./fake-resend";
import { setSetting } from "../db/queries/settings";
import { insertDomain } from "../db/queries/domains";
import { authenticateApiKey, createApiKey } from "../server/credentials/service";
import { sendFromJson } from "../server/compat/emails";
import { registerHandlers } from "../server/boot";
import { drainOnce } from "../server/queue/queue";
import { resetEnv } from "../lib/env";
import { POST } from "../src/api/emails/index";

let fake: FakeResend;
let key = "";

beforeAll(async () => {
  fake = await startFakeResend();
  process.env.SNAPJAW_RESEND_BASE_URL = fake.url;
  resetEnv();
  await freshDatabase();
  await setSetting("resend.apiKey", "re_test_key");
  await setSetting("instance.id", "inst");
  await setSetting("resend.rateLimit", "1000");
  await insertDomain({ id: "dom_1", resendId: "r1", name: "example.com", status: "verified", records: [] });
  const created = await createApiKey(actor(), { name: "App", allowedSenders: ["billing@example.com"], ratePerHour: 0 });
  if (!created.ok) throw new Error(created.error);
  key = created.data.key;
  registerHandlers();
});

afterAll(async () => {
  await fake.close();
});

function request(body: unknown, headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

describe("Resend-compatible API", () => {
  it("authenticates keys and rejects wrong ones", async () => {
    expect(await authenticateApiKey(`Bearer ${key}`)).not.toBeNull();
    expect(await authenticateApiKey(`Bearer ${key}x`)).toBeNull();
    expect(await authenticateApiKey("Bearer re_123")).toBeNull();
    const response = await POST(request({ from: "billing@example.com", to: "a@b.com", subject: "x", text: "y" }, { authorization: "Bearer nope" }));
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ name: "missing_api_key" });
  });

  it("accepts a Resend-shaped request and returns a bare id", async () => {
    const response = await POST(request({ from: "Billing <billing@example.com>", to: ["a@other.com"], cc: "c@other.com", subject: "Invoice", html: "<p>Hi</p>", attachments: [{ filename: "a.txt", content: Buffer.from("hello").toString("base64") }] }));
    expect(response.status).toBe(200);
    const json = (await response.json()) as { id: string };
    expect(json.id).toMatch(/^msg_/);
    await drainOnce();
    const sent = fake.sent.at(-1)!.body as Record<string, unknown>;
    expect(sent.to).toEqual(["a@other.com"]);
    expect(sent.cc).toEqual(["c@other.com"]);
    expect((sent.attachments as { filename: string }[])[0]!.filename).toBe("a.txt");
  });

  it("enforces allowed senders", async () => {
    const response = await POST(request({ from: "ceo@example.com", to: "a@other.com", subject: "x", text: "y" }));
    expect(response.status).toBe(403);
  });

  it("honours Idempotency-Key", async () => {
    const sender = { id: "key-test", kind: "api" as const, allowedSenders: ["billing@example.com"], ratePerHour: 0 };
    const body = { from: "billing@example.com", to: "z@other.com", subject: "Once", text: "y" };
    const first = await sendFromJson(sender, body, "k1");
    const second = await sendFromJson(sender, body, "k1");
    expect(first.ok && second.ok && "id" in first && "id" in second && first.id === second.id).toBe(true);
    const conflict = await sendFromJson(sender, { ...body, subject: "Different" }, "k1");
    expect(conflict.ok).toBe(false);
  });

  it("rejects unsupported fields clearly", async () => {
    const response = await POST(request({ from: "billing@example.com", to: "a@other.com", subject: "x", text: "y", scheduled_at: "in 1 hour" }));
    expect(response.status).toBe(422);
  });
});
