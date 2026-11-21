import { describe, expect, it } from "vitest";
import { buildPayload, parseMime } from "../server/outbound/mime";
import { evaluate } from "../server/quota/guard";
import { matchRoute, normalizeRoutePattern, type RouteRule } from "../server/inbound/match";
import { nextReset } from "../server/outbound/accept";
import { backoff } from "../server/queue/queue";

const raw = [
  "From: Jane Doe <jane@example.com>",
  "To: Bob <bob@other.com>",
  "Cc: carol@other.com",
  "Reply-To: replies@example.com",
  "Subject: Re: Plans",
  "Message-ID: <abc123@example.com>",
  "In-Reply-To: <prev@other.com>",
  "References: <first@other.com> <prev@other.com>",
  "X-Custom-Tag: keep-me",
  "MIME-Version: 1.0",
  'Content-Type: multipart/mixed; boundary="b1"',
  "",
  "--b1",
  "Content-Type: text/plain; charset=utf-8",
  "",
  "Hello there",
  "--b1",
  'Content-Type: application/pdf; name="file.pdf"',
  "Content-Transfer-Encoding: base64",
  'Content-Disposition: attachment; filename="file.pdf"',
  "",
  Buffer.from("%PDF-1.4 test").toString("base64"),
  "--b1--",
  "",
].join("\r\n");

describe("MIME to Resend payload", () => {
  it("keeps addresses, threading headers, attachments and turns hidden recipients into bcc", async () => {
    const parsed = await parseMime(Buffer.from(raw));
    const payload = buildPayload(parsed, { from: "jane@example.com", to: ["bob@other.com", "carol@other.com", "hidden@other.com"] }, "inst1");
    expect(payload.from).toBe("Jane Doe <jane@example.com>");
    expect(payload.to).toEqual(["Bob <bob@other.com>"]);
    expect(payload.cc).toEqual(["carol@other.com"]);
    expect(payload.bcc).toEqual(["hidden@other.com"]);
    expect(payload.reply_to).toEqual(["replies@example.com"]);
    expect(payload.subject).toBe("Re: Plans");
    expect(payload.headers?.["Message-ID"]).toBe("<abc123@example.com>");
    expect(payload.headers?.["In-Reply-To"]).toBe("<prev@other.com>");
    expect(payload.headers?.["References"]).toBe("<first@other.com> <prev@other.com>");
    expect(payload.headers?.["X-Custom-Tag"]).toBe("keep-me");
    expect(payload.headers?.["X-Snapjaw-Relay"]).toBe("inst1");
    expect(payload.text?.trim()).toBe("Hello there");
    expect(payload.attachments?.[0]?.filename).toBe("file.pdf");
    expect(Buffer.from(payload.attachments![0]!.content, "base64").toString()).toBe("%PDF-1.4 test");
  });

  it("addresses a Bcc-only message to the sender instead of exposing a Bcc", async () => {
    const parsed = await parseMime(Buffer.from("From: a@example.com\r\nSubject: x\r\n\r\nbody\r\n"));
    const payload = buildPayload(parsed, { from: "a@example.com", to: ["secret1@other.com", "secret2@other.com"] }, "i");
    expect(payload.to).toEqual(["a@example.com"]);
    expect(payload.bcc).toEqual(["secret1@other.com", "secret2@other.com"]);
  });
});

describe("quota rules", () => {
  const base = { day: 0, month: 0, dailyLimit: 100, monthlyLimit: 3000, alertPercent: 80, mode: "hold" as const };
  it("allows sends under the cap and blocks ones that would cross it", () => {
    expect(evaluate({ ...base, day: 99 }, 1).allowed).toBe(true);
    expect(evaluate({ ...base, day: 99 }, 2).allowed).toBe(false);
    expect(evaluate({ ...base, month: 3000 }, 1).allowed).toBe(false);
    expect(evaluate({ ...base, dailyLimit: 0, day: 5000 }, 1).allowed).toBe(true);
  });

  it("schedules held mail after the next reset", () => {
    const now = new Date("2026-03-10T18:30:00Z");
    expect(nextReset("day", now).toISOString()).toBe("2026-03-11T00:01:00.000Z");
    expect(nextReset("month", now).toISOString()).toBe("2026-04-01T00:01:00.000Z");
  });

  it("backs off exponentially with a cap", () => {
    expect(backoff(1)).toBeGreaterThanOrEqual(30_000);
    expect(backoff(3)).toBeGreaterThanOrEqual(120_000);
    expect(backoff(30)).toBeLessThanOrEqual(6 * 3600_000 * 1.2);
  });
});

describe("route matching", () => {
  const rules: RouteRule[] = [
    { id: "1", kind: "address", pattern: "hello@example.com", domain: "example.com", enabled: true, destinationIds: ["a"] },
    { id: "2", kind: "wildcard", pattern: "support-*@example.com", domain: "example.com", enabled: true, destinationIds: ["b"] },
    { id: "3", kind: "catchall", pattern: "*@example.com", domain: "example.com", enabled: true, destinationIds: ["c"] },
    { id: "4", kind: "address", pattern: "off@example.com", domain: "example.com", enabled: false, destinationIds: ["d"] },
  ];

  it("prefers exact, then wildcard, then catch-all", () => {
    expect(matchRoute("Hello@Example.com", rules)?.id).toBe("1");
    expect(matchRoute("support-billing@example.com", rules)?.id).toBe("2");
    expect(matchRoute("random@example.com", rules)?.id).toBe("3");
    expect(matchRoute("off@example.com", rules)?.id).toBe("3");
    expect(matchRoute("x@nowhere.com", rules)).toBeNull();
  });

  it("normalizes patterns", () => {
    expect(normalizeRoutePattern("catchall", "Example.com")).toEqual({ pattern: "*@example.com", domain: "example.com" });
    expect(normalizeRoutePattern("wildcard", "news-*@example.com")?.pattern).toBe("news-*@example.com");
    expect(normalizeRoutePattern("wildcard", "news@example.com")).toBeNull();
    expect(normalizeRoutePattern("address", "a b@example.com")).toBeNull();
  });
});
