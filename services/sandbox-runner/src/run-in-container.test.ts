import { describe, expect, it } from "vitest";

import { parseHelperLine, type HelperEvent } from "./run-in-container.js";

function frameLine(seq: number, data = "AAAA"): string {
  return JSON.stringify({ type: "frame", seq, atMs: seq * 100, format: "jpeg", data });
}

function resultLine(extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ type: "result", ok: true, stdout: "hi\n", exitCode: 0, ...extra });
}

describe("parseHelperLine", () => {
  it("parses a frame event", () => {
    const event = parseHelperLine(frameLine(3));
    expect(event).toMatchObject({ type: "frame", seq: 3, atMs: 300, format: "jpeg", data: "AAAA" });
  });

  it("parses a result event", () => {
    const event = parseHelperLine(resultLine());
    expect(event).toMatchObject({ type: "result", ok: true, stdout: "hi\n", exitCode: 0 });
  });

  it("preserves a base64 image payload", () => {
    const image = Buffer.from("fake png").toString("base64");
    const event = parseHelperLine(resultLine({ image })) as { image?: string };
    expect(event.image).toBe(image);
  });

  it("ignores surrounding whitespace", () => {
    expect(parseHelperLine(`  ${frameLine(1)}  `)).toMatchObject({ type: "frame" });
  });

  it.each([
    ["", "an empty line"],
    ["   ", "whitespace only"],
    ["not json", "unparsable text"],
    ['"a string"', "a json string"],
    ["null", "json null"],
    ["[1,2,3]", "a json array"],
    [JSON.stringify({ type: "unknown" }), "an unknown event type"],
    [JSON.stringify({ noType: true }), "an object with no type"],
  ])("returns null for %j (%s)", (line) => {
    expect(parseHelperLine(line)).toBeNull();
  });

  it("returns a discriminated union the caller can switch on", () => {
    const events: HelperEvent[] = [
      parseHelperLine(frameLine(1))!,
      parseHelperLine(resultLine())!,
    ].filter(Boolean);

    const kinds = events.map((event) => event.type);
    expect(kinds).toEqual(["frame", "result"]);
  });
});
