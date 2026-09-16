import { describe, expect, it } from "vitest";

import { parseHelperOutput } from "./run-in-container.js";

const SENTINEL = "__SNAPJAW_RESULT__";

describe("parseHelperOutput", () => {
  it("parses a result that follows the sentinel", () => {
    const stdout = `\n${SENTINEL}\n{"ok":true,"stdout":"hi\\n","exitCode":0}`;
    expect(parseHelperOutput(stdout)).toMatchObject({ ok: true, stdout: "hi\n", exitCode: 0 });
  });

  it("ignores anything printed before the sentinel", () => {
    const stdout = `noise\ndocker: warning\n${SENTINEL}\n{"ok":true,"stdout":"x"}`;
    expect(parseHelperOutput(stdout)?.stdout).toBe("x");
  });

  it("uses the last sentinel when one appears in the noise", () => {
    const stdout = `${SENTINEL}not json\n${SENTINEL}\n{"ok":true,"exitCode":7}`;
    expect(parseHelperOutput(stdout)?.exitCode).toBe(7);
  });

  it.each([
    ["", "an empty string"],
    ["just some output", "no sentinel"],
    [`${SENTINEL}\n`, "a sentinel with nothing after it"],
    [`${SENTINEL}\nnot json`, "unparsable json"],
    [`${SENTINEL}\n"a string"`, "json that is not an object"],
    [`${SENTINEL}\nnull`, "json null"],
  ])("returns null for %j (%s)", (stdout) => {
    expect(parseHelperOutput(stdout)).toBeNull();
  });

  it("keeps the base64 image payload intact", () => {
    const image = Buffer.from("fake png").toString("base64");
    const stdout = `${SENTINEL}\n${JSON.stringify({ ok: true, image })}`;
    expect(parseHelperOutput(stdout)?.image).toBe(image);
  });
});
