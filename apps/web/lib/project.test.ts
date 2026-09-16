import { describe, expect, it } from "vitest";

import {
  checkFileName,
  clampFontSize,
  DEFAULT_FONT_SIZE,
  MAX_FONT_SIZE,
  MIN_FONT_SIZE,
  nextUntitledName,
  normalizeFileName,
  removeFile,
  renameFile,
  resolveActiveFile,
  uniqueFileName,
  updateFileContent,
  type ProjectFile,
} from "./project";

const project: ProjectFile[] = [
  { name: "main.py", content: "print('hi')" },
  { name: "helper.py", content: "" },
];

describe("normalizeFileName", () => {
  it("adds the Python extension to a bare name", () => {
    expect(normalizeFileName("hello")).toBe("hello.py");
  });

  it("keeps an existing extension", () => {
    expect(normalizeFileName("data.csv")).toBe("data.csv");
  });

  it("strips directory components so an import cannot escape the project", () => {
    expect(normalizeFileName("../../etc/passwd")).toBe("passwd.py");
    expect(normalizeFileName("nested/dir/helper.py")).toBe("helper.py");
    expect(normalizeFileName("C:\\Users\\me\\main.py")).toBe("main.py");
  });

  it("turns whitespace into dashes and drops unsafe characters", () => {
    expect(normalizeFileName("my cool file")).toBe("my-cool-file.py");
    expect(normalizeFileName("a<b>c.py")).toBe("abc.py");
  });

  it("returns an empty string when nothing usable remains", () => {
    expect(normalizeFileName("   ")).toBe("");
    expect(normalizeFileName("///")).toBe("");
  });
});

describe("uniqueFileName", () => {
  it("leaves a free name alone", () => {
    expect(uniqueFileName("main.py", ["other.py"])).toBe("main.py");
  });

  it("counts up until the name is free", () => {
    expect(uniqueFileName("main.py", ["main.py"])).toBe("main-2.py");
    expect(uniqueFileName("main.py", ["main.py", "main-2.py"])).toBe("main-3.py");
  });

  it("compares case-insensitively", () => {
    expect(uniqueFileName("Main.py", ["main.py"])).toBe("Main-2.py");
  });

  it("handles names without an extension", () => {
    expect(uniqueFileName("notes", ["notes"])).toBe("notes-2");
  });
});

describe("nextUntitledName", () => {
  it("starts at untitled.py", () => {
    expect(nextUntitledName([])).toBe("untitled.py");
  });

  it("avoids the names already in the project", () => {
    expect(nextUntitledName(["untitled.py"])).toBe("untitled-2.py");
  });
});

describe("checkFileName", () => {
  it("normalizes and accepts a fresh name", () => {
    expect(checkFileName("helper", ["main.py"])).toEqual({ ok: true, name: "helper.py" });
  });

  it("rejects an empty name", () => {
    expect(checkFileName("   ", ["main.py"]).ok).toBe(false);
  });

  it("rejects a name already in the project", () => {
    expect(checkFileName("main.py", ["main.py"]).ok).toBe(false);
  });

  it("rejects a name that only differs by case", () => {
    expect(checkFileName("MAIN.py", ["main.py"]).ok).toBe(false);
  });

  it("allows a file to keep its own name while being renamed", () => {
    expect(checkFileName("main.py", ["main.py"], "main.py")).toEqual({
      ok: true,
      name: "main.py",
    });
  });

  it("rejects a name longer than the limit", () => {
    expect(checkFileName("a".repeat(65), []).ok).toBe(false);
  });
});

describe("project mutations", () => {
  it("updates only the named file", () => {
    const next = updateFileContent(project, "helper.py", "x = 1");
    expect(next[1]?.content).toBe("x = 1");
    expect(next[0]?.content).toBe("print('hi')");
  });

  it("renames only the named file", () => {
    const next = renameFile(project, "helper.py", "util.py");
    expect(next.map((file) => file.name)).toEqual(["main.py", "util.py"]);
  });

  it("removes the named file", () => {
    expect(removeFile(project, "main.py").map((file) => file.name)).toEqual(["helper.py"]);
  });

  it("never mutates the input array", () => {
    updateFileContent(project, "main.py", "changed");
    renameFile(project, "main.py", "other.py");
    removeFile(project, "main.py");
    expect(project.map((file) => file.name)).toEqual(["main.py", "helper.py"]);
  });
});

describe("resolveActiveFile", () => {
  it("keeps a file that still exists", () => {
    expect(resolveActiveFile(project, "helper.py")).toBe("helper.py");
  });

  it("falls back to the first file when the active one is gone", () => {
    expect(resolveActiveFile(project, "deleted.py")).toBe("main.py");
  });

  it("returns an empty string for an empty project", () => {
    expect(resolveActiveFile([], "main.py")).toBe("");
  });
});

describe("clampFontSize", () => {
  it("clamps to the supported range", () => {
    expect(clampFontSize(2)).toBe(MIN_FONT_SIZE);
    expect(clampFontSize(999)).toBe(MAX_FONT_SIZE);
  });

  it("rounds to a whole pixel", () => {
    expect(clampFontSize(16.4)).toBe(16);
  });

  it("falls back to the default for a non-finite value", () => {
    expect(clampFontSize(Number.NaN)).toBe(DEFAULT_FONT_SIZE);
  });
});
