import { describe, expect, it } from "vitest";

import { readApiError, readSharedUrl } from "./client";

describe("readApiError", () => {
  it("reads the message from an error envelope", () => {
    expect(
      readApiError({ error: { code: "NOT_FOUND", message: "That shared file does not exist." } }),
    ).toBe("That shared file does not exist.");
  });

  it("appends validation details", () => {
    expect(
      readApiError({
        error: {
          code: "VALIDATION_ERROR",
          message: "Those files could not be shared.",
          details: ["files: Share at least one file."],
        },
      }),
    ).toBe("Those files could not be shared. files: Share at least one file.");
  });

  it.each([
    [null, "null"],
    ["a string", "a string"],
    [{}, "an empty object"],
    [{ error: null }, "a null error"],
    [{ error: { code: "X" } }, "an error without a message"],
    [{ error: { message: 42 } }, "a non-string message"],
  ])("returns null for %j (%s)", (payload, _description) => {
    expect(readApiError(payload)).toBeNull();
  });

  it("ignores an empty details array", () => {
    expect(readApiError({ error: { message: "nope", details: [] } })).toBe("nope");
  });
});

describe("readSharedUrl", () => {
  it("reads the url from a create response", () => {
    expect(readSharedUrl({ id: "abc", url: "http://localhost:3000/file/abc" })).toBe(
      "http://localhost:3000/file/abc",
    );
  });

  it.each([
    [null, "null"],
    [{}, "a missing url"],
    [{ url: 42 }, "a non-string url"],
    [{ url: "" }, "an empty url"],
  ])("returns null for %j (%s)", (payload, _description) => {
    expect(readSharedUrl(payload)).toBeNull();
  });
});
