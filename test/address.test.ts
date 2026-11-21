import { describe, expect, it } from "vitest";
import { domainOf, extractAddress, isDomain, isEmail, senderAllowed } from "../lib/address";

describe("addresses", () => {
  it("validates email addresses", () => {
    expect(isEmail("hello@example.com")).toBe(true);
    expect(isEmail("a.b+tag@sub.example.co.uk")).toBe(true);
    expect(isEmail("no-at-sign")).toBe(false);
    expect(isEmail("bad@domain")).toBe(false);
    expect(isEmail("spaces in@example.com")).toBe(false);
  });

  it("validates domains", () => {
    expect(isDomain("example.com")).toBe(true);
    expect(isDomain("mail.example.com")).toBe(true);
    expect(isDomain("-bad.com")).toBe(false);
    expect(isDomain("nodot")).toBe(false);
  });

  it("extracts the address from a display name", () => {
    expect(extractAddress("Jane Doe <Jane@Example.com>")).toBe("jane@example.com");
    expect(extractAddress("jane@example.com")).toBe("jane@example.com");
    expect(domainOf("jane@Example.COM")).toBe("example.com");
  });

  it("matches allowed senders by address and by domain", () => {
    const allowed = ["hello@example.com", "@team.example.com"];
    expect(senderAllowed("hello@example.com", allowed)).toBe(true);
    expect(senderAllowed("HELLO@example.com", allowed)).toBe(true);
    expect(senderAllowed("other@example.com", allowed)).toBe(false);
    expect(senderAllowed("anyone@team.example.com", allowed)).toBe(true);
    expect(senderAllowed("anyone@evil-team.example.com", allowed)).toBe(false);
    expect(senderAllowed("anyone@sub.team.example.com", allowed)).toBe(false);
    expect(senderAllowed("x@example.com", [])).toBe(false);
  });
});
