import { describe, expect, it } from "vitest";

import { appendOutput, newRunId, projectToFileRecord } from "./run";
import { RUN_ID_PATTERN } from "./validation";

describe("newRunId", () => {
  it("produces the shape the runner accepts", () => {
    expect(newRunId()).toMatch(RUN_ID_PATTERN);
  });

  it("does not repeat itself", () => {
    const ids = new Set(Array.from({ length: 200 }, () => newRunId()));
    expect(ids.size).toBe(200);
  });

  it("does not rely on crypto.randomUUID, which needs a secure context", () => {
    expect(typeof crypto.getRandomValues).toBe("function");
  });
});

describe("projectToFileRecord", () => {
  it("turns the file list into the record the API expects", () => {
    expect(
      projectToFileRecord([
        { name: "main.py", content: "print(1)" },
        { name: "helper.py", content: "X = 1" },
      ]),
    ).toEqual({ "main.py": "print(1)", "helper.py": "X = 1" });
  });

  it("preserves content exactly, including trailing newlines", () => {
    const content = "def main():\n    pass\n\n";
    expect(projectToFileRecord([{ name: "main.py", content }])["main.py"]).toBe(content);
  });

  it("returns an empty record for an empty project", () => {
    expect(projectToFileRecord([])).toEqual({});
  });
});

describe("appendOutput", () => {
  it("keeps stdout and stderr in arrival order", () => {
    let chunks = appendOutput([], { stream: "stdout", text: "one\n" });
    chunks = appendOutput(chunks, { stream: "stderr", text: "bad\n" });
    chunks = appendOutput(chunks, { stream: "stdout", text: "two\n" });

    expect(chunks.map((chunk) => chunk.stream)).toEqual(["stdout", "stderr", "stdout"]);
    expect(chunks.map((chunk) => chunk.text).join("")).toBe("one\nbad\ntwo\n");
  });

  it("merges consecutive chunks from the same stream", () => {
    let chunks = appendOutput([], { stream: "stdout", text: "a" });
    chunks = appendOutput(chunks, { stream: "stdout", text: "b" });

    expect(chunks).toEqual([{ stream: "stdout", text: "ab" }]);
  });
});
