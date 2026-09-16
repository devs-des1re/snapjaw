import { describe, expect, it } from "vitest";

import { projectToFileRecord } from "./run";

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
