import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const checkRunRateLimit = vi.fn();
const clientIdentifier = vi.fn();

vi.mock("@/lib/ratelimit", () => ({
  checkRunRateLimit: (...args: unknown[]) => checkRunRateLimit(...args),
  clientIdentifier: (...args: unknown[]) => clientIdentifier(...args),
}));

const { POST } = await import("./route");

const ALLOWED = {
  allowed: true,
  limit: 10,
  remaining: 9,
  retryAfterSeconds: 0,
  enforced: true,
};

const VALID_BODY = { files: { "main.py": "print(1)" }, entryFile: "main.py" };

function request(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost:3000/api/run/stream", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };

beforeEach(() => {
  checkRunRateLimit.mockReset().mockResolvedValue(ALLOWED);
  clientIdentifier.mockReset().mockReturnValue("203.0.113.7");
  process.env.SANDBOX_RUNNER_URL = "http://runner:4000";
  delete process.env.SANDBOX_RUNNER_TOKEN;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  process.env = { ...originalEnv };
});

describe("POST /api/run/stream — rate limiting", () => {
  it("rejects with 429 and a Retry-After when the limit is hit", async () => {
    checkRunRateLimit.mockResolvedValue({
      allowed: false,
      limit: 10,
      remaining: 0,
      retryAfterSeconds: 42,
      enforced: true,
    });

    const response = await POST(request(VALID_BODY));

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("42");
    const body = await response.json();
    expect(body.error.code).toBe("RATE_LIMITED");
  });

  it("does not call the provider when the limiter allows the run", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(
        new Response("", { status: 200, headers: { "content-type": "application/x-ndjson" } }),
      );

    await POST(request(VALID_BODY));

    expect(checkRunRateLimit).toHaveBeenCalledWith("203.0.113.7");
  });
});

describe("POST /api/run/stream — configuration", () => {
  it("returns 503 when the runner is not configured", async () => {
    delete process.env.SANDBOX_RUNNER_URL;

    const response = await POST(request(VALID_BODY));

    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.error.code).toBe("SERVICE_UNAVAILABLE");
  });
});

describe("POST /api/run/stream — validation", () => {
  it.each([
    [{ files: {}, entryFile: "main.py" }, "an empty project"],
    [{ files: { "a.py": "" }, entryFile: "b.py" }, "an entry file not in the project"],
    [{ files: { "../../etc/passwd": "x" }, entryFile: "../../etc/passwd" }, "a traversal name"],
    [{ files: { "main.py": "x" } }, "a missing entry file"],
    ["not json", "a malformed body"],
  ])("rejects %j (%s) before contacting the runner", async (body, _description) => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy;

    const response = await POST(request(body));

    expect(response.status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
    const payload = await response.json();
    expect(payload.error.code).toMatch(/VALIDATION_ERROR|BAD_REQUEST/);
  });

  it("rejects a body that declares an oversized content length", async () => {
    const response = await POST(
      request(VALID_BODY, { "content-length": String(50 * 1024 * 1024) }),
    );

    expect(response.status).toBe(413);
    const body = await response.json();
    expect(body.error.code).toBe("PAYLOAD_TOO_LARGE");
  });
});

describe("POST /api/run/stream — relaying the runner", () => {
  it("pipes the runner's stream through with streaming headers", async () => {
    const payload = '{"type":"frame","seq":1,"format":"jpeg","data":"AAAA"}\n';
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(payload, {
        status: 200,
        headers: { "content-type": "application/x-ndjson" },
      }),
    );

    const response = await POST(request(VALID_BODY));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("ndjson");
    expect(response.headers.get("x-accel-buffering")).toBe("no");
    expect(await response.text()).toBe(payload);
  });

  it("forwards the shared secret when one is configured", async () => {
    process.env.SANDBOX_RUNNER_TOKEN = "s3cret";
    const fetchSpy = vi.fn().mockResolvedValue(new Response("", { status: 200 }));
    globalThis.fetch = fetchSpy;

    await POST(request(VALID_BODY));

    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer s3cret");
  });

  it("maps a busy runner to 503", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "every sandbox is busy, try again shortly" }), {
        status: 503,
      }),
    );

    const response = await POST(request(VALID_BODY));

    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.error.message).toContain("busy");
  });

  it("maps a runner failure to 502", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ error: "unreadable response" }), { status: 502 }),
      );

    const response = await POST(request(VALID_BODY));

    expect(response.status).toBe(502);
  });

  it("returns 503 when the runner cannot be reached", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));

    const response = await POST(request(VALID_BODY));

    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.error.code).toBe("SERVICE_UNAVAILABLE");
  });
});
