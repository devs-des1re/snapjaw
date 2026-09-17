import { describe, expect, it } from "vitest";

import { shareUrlFor } from "./share-url";

const ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

function request(headers: Record<string, string> = {}): Request {
  return new Request("http://internal-web:3000/api/file", { method: "POST", headers });
}

describe("shareUrlFor", () => {
  it("prefers the configured app url", () => {
    expect(shareUrlFor(request(), ID, "https://snapjaw.dev")).toBe(
      `https://snapjaw.dev/file/${ID}`,
    );
  });

  it("strips trailing slashes from the configured url", () => {
    expect(shareUrlFor(request(), ID, "https://snapjaw.dev///")).toBe(
      `https://snapjaw.dev/file/${ID}`,
    );
  });

  it("ignores a blank configured url", () => {
    expect(shareUrlFor(request({ "x-forwarded-host": "snapjaw.dev" }), ID, "   ")).toBe(
      `https://snapjaw.dev/file/${ID}`,
    );
  });

  it("uses the forwarded host and proto when no app url is set", () => {
    const url = shareUrlFor(
      request({ "x-forwarded-host": "snapjaw.dev", "x-forwarded-proto": "https" }),
      ID,
      undefined,
    );
    expect(url).toBe(`https://snapjaw.dev/file/${ID}`);
  });

  it("assumes https when only the forwarded host is present", () => {
    expect(shareUrlFor(request({ "x-forwarded-host": "snapjaw.dev" }), ID, undefined)).toBe(
      `https://snapjaw.dev/file/${ID}`,
    );
  });

  it("falls back to the request origin in development", () => {
    expect(shareUrlFor(request(), ID, undefined)).toBe(`http://internal-web:3000/file/${ID}`);
  });

  it("lets the configured url win over forwarded headers", () => {
    const url = shareUrlFor(request({ "x-forwarded-host": "wrong.example" }), ID, "https://a.dev");
    expect(url).toBe(`https://a.dev/file/${ID}`);
  });
});
