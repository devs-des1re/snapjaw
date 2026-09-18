import { describe, expect, it } from "vitest";

import { parseTracebackFrames } from "./traceback";

describe("parseTracebackFrames", () => {
  it("pulls file and line out of a Python traceback", () => {
    const stderr = [
      "Traceback (most recent call last):",
      '  File "/tmp/snapjaw-work/abc123/main.py", line 7, in <module>',
      "    main()",
      '  File "/tmp/snapjaw-work/abc123/helper.py", line 3, in main',
      "    raise ValueError('boom')",
      "ValueError: boom",
    ].join("\n");

    expect(parseTracebackFrames(stderr)).toEqual([
      { file: "main.py", line: 7 },
      { file: "helper.py", line: 3 },
    ]);
  });

  it("returns nothing when there is no traceback", () => {
    expect(parseTracebackFrames("hello\n")).toEqual([]);
  });

  it("uses only the base name of a Windows-style path", () => {
    const stderr = '  File "C:\\\\work\\\\proj\\\\main.py", line 2, in <module>';
    expect(parseTracebackFrames(stderr)).toEqual([{ file: "main.py", line: 2 }]);
  });
});
