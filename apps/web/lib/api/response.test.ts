import { describe, expect, it } from "vitest";

import { APP_VERSION } from "@/lib/version";

import { jsonError, jsonOk, type ApiErrorBody, type ApiErrorCode } from "./response";

describe("jsonOk", () => {
  it("returns the payload with a timestamp and version", async () => {
    const response = jsonOk({ status: "ok" });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.status).toBe("ok");
    expect(body.version).toBe(APP_VERSION);
    expect(Number.isNaN(Date.parse(body.timestamp))).toBe(false);
  });

  it("honours an explicit status code", () => {
    expect(jsonOk({ id: "x" }, 201).status).toBe(201);
  });

  it("returns JSON content type", () => {
    expect(jsonOk({ a: 1 }).headers.get("content-type")).toContain("application/json");
  });
});

describe("jsonError", () => {
  it("uses one consistent error shape", async () => {
    const response = jsonError("NOT_FOUND", "That shared file does not exist.");

    const body = (await response.json()) as ApiErrorBody;
    expect(Object.keys(body).sort()).toEqual(["error", "timestamp", "version"]);
    expect(Object.keys(body.error).sort()).toEqual(["code", "message"]);
    expect(body.error.code).toBe("NOT_FOUND");
    expect(body.error.message).toBe("That shared file does not exist.");
    expect(body.version).toBe(APP_VERSION);
  });

  it.each([
    ["BAD_REQUEST", 400],
    ["VALIDATION_ERROR", 400],
    ["NOT_FOUND", 404],
    ["PAYLOAD_TOO_LARGE", 413],
    ["INTERNAL_ERROR", 500],
  ] satisfies [ApiErrorCode, number][])("maps %s to HTTP %i", async (code, status) => {
    expect(jsonError(code, "message").status).toBe(status);
  });

  it("omits details when there are none", async () => {
    const body = (await jsonError("NOT_FOUND", "gone").json()) as ApiErrorBody;
    expect(body.error).not.toHaveProperty("details");
  });

  it("omits details when given an empty list", async () => {
    const body = (await jsonError("NOT_FOUND", "gone", []).json()) as ApiErrorBody;
    expect(body.error).not.toHaveProperty("details");
  });

  it("includes details when given", async () => {
    const body = (await jsonError("VALIDATION_ERROR", "bad", [
      "files: Share at least one file.",
    ]).json()) as ApiErrorBody;
    expect(body.error.details).toEqual(["files: Share at least one file."]);
  });

  it("allows overriding the status code", () => {
    expect(jsonError("BAD_REQUEST", "nope", undefined, 418).status).toBe(418);
  });
});
