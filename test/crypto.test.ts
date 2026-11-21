import { beforeAll, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { decrypt, encrypt, hmac, safeEqual, sha256 } from "../lib/crypto";
import { resetEnv } from "../lib/env";

beforeAll(() => {
  process.env.SNAPJAW_SECRET_KEY = randomBytes(32).toString("base64");
  resetEnv();
});

describe("secret encryption", () => {
  it("round-trips a value", () => {
    const sealed = encrypt("re_secret_value");
    expect(sealed.startsWith("v1:")).toBe(true);
    expect(sealed).not.toContain("re_secret_value");
    expect(decrypt(sealed)).toBe("re_secret_value");
  });

  it("uses a fresh nonce every time", () => {
    expect(encrypt("same")).not.toBe(encrypt("same"));
  });

  it("rejects tampered ciphertext", () => {
    const sealed = encrypt("value");
    const raw = Buffer.from(sealed.slice(3), "base64");
    raw[raw.length - 1] ^= 1;
    expect(() => decrypt(`v1:${raw.toString("base64")}`)).toThrow();
  });

  it("rejects unknown formats", () => {
    expect(() => decrypt("plain")).toThrow();
  });
});

describe("hash helpers", () => {
  it("hashes deterministically", () => {
    expect(sha256("abc")).toBe(sha256("abc"));
    expect(hmac("abc", "x")).not.toBe(hmac("abc", "y"));
  });

  it("compares in constant time and handles length differences", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
  });
});
