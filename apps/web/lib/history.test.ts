import { describe, expect, it } from "vitest";

import {
  captureHistory,
  HISTORY_MAX_ENTRIES,
  HISTORY_SNAPSHOT_INTERVAL_MS,
  maybeCaptureHistory,
  type HistorySnapshot,
} from "./history";
import type { ProjectFile } from "./project";

const FILES: ProjectFile[] = [{ name: "main.py", content: "print(1)" }];

function snapshot(content: string, capturedAt = "2026-01-01T00:00:00.000Z"): HistorySnapshot {
  return { files: { "main.py": content }, entryFile: "main.py", capturedAt };
}

describe("maybeCaptureHistory", () => {
  it("captures the first change", () => {
    const result = maybeCaptureHistory([], FILES, "main.py", 1_000, null);
    expect(result?.history).toHaveLength(1);
    expect(result?.history[0]?.files).toEqual({ "main.py": "print(1)" });
  });

  it("waits out the interval between captures", () => {
    const first = maybeCaptureHistory([], FILES, "main.py", 1_000, null);
    expect(first).not.toBeNull();

    const tooSoon = maybeCaptureHistory(
      first!.history,
      [{ name: "main.py", content: "print(2)" }],
      "main.py",
      1_000 + HISTORY_SNAPSHOT_INTERVAL_MS - 1,
      first!.capturedAt,
    );
    expect(tooSoon).toBeNull();
  });

  it("captures once the interval has passed and the content changed", () => {
    const first = maybeCaptureHistory([], FILES, "main.py", 1_000, null);

    const later = maybeCaptureHistory(
      first!.history,
      [{ name: "main.py", content: "print(2)" }],
      "main.py",
      1_000 + HISTORY_SNAPSHOT_INTERVAL_MS,
      first!.capturedAt,
    );
    expect(later?.history).toHaveLength(2);
  });

  it("does not capture when only tab order changed", () => {
    const history = [
      {
        files: { "a.py": "A", "b.py": "B" },
        entryFile: "a.py",
        capturedAt: "2026-01-01T00:00:00.000Z",
      },
    ];

    const result = maybeCaptureHistory(
      history,
      [
        { name: "b.py", content: "B" },
        { name: "a.py", content: "A" },
      ],
      "a.py",
      99_999,
      null,
    );
    expect(result).toBeNull();
  });
});

describe("captureHistory", () => {
  it("captures regardless of the interval", () => {
    const result = captureHistory([snapshot("old")], FILES, "main.py", 5);
    expect(result.history).toHaveLength(2);
  });

  it("skips an identical snapshot", () => {
    const existing = [snapshot("print(1)")];
    const result = captureHistory(existing, FILES, "main.py", 5);
    expect(result.history).toHaveLength(1);
  });

  it("never grows past the entry cap", () => {
    let history: HistorySnapshot[] = [];
    for (let index = 0; index < HISTORY_MAX_ENTRIES + 10; index += 1) {
      history = captureHistory(
        history,
        [{ name: "main.py", content: `print(${index})` }],
        "main.py",
        index,
      ).history;
    }
    expect(history).toHaveLength(HISTORY_MAX_ENTRIES);
  });
});
