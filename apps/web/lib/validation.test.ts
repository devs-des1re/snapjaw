import { describe, expect, it } from "vitest";

import {
  MAX_FILE_CHARACTERS,
  MAX_INPUT_CHARACTERS,
  MAX_SHARED_FILES,
  createSharedFileSchema,
  runInputSchema,
  runRequestSchema,
  runnerRunResultSchema,
  sharedFileIdSchema,
} from "./validation";

const VALID_PROJECT = {
  files: { "main.py": "print('hi')" },
  entryFile: "main.py",
  fontSize: 14,
};

const UUID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

describe("createSharedFileSchema", () => {
  it("accepts a well-formed project", () => {
    const result = createSharedFileSchema.safeParse(VALID_PROJECT);
    expect(result.success).toBe(true);
  });

  it("accepts multiple files", () => {
    const result = createSharedFileSchema.safeParse({
      files: { "main.py": "", "helper.py": "x = 1" },
      entryFile: "helper.py",
      fontSize: 18,
    });
    expect(result.success).toBe(true);
  });

  it("defaults the font size when it is omitted", () => {
    const result = createSharedFileSchema.parse({
      files: VALID_PROJECT.files,
      entryFile: VALID_PROJECT.entryFile,
    });
    expect(result.fontSize).toBe(14);
  });

  it("rejects an empty file set", () => {
    expect(createSharedFileSchema.safeParse({ ...VALID_PROJECT, files: {} }).success).toBe(false);
  });

  it("rejects an entry file that is not one of the files", () => {
    const result = createSharedFileSchema.safeParse({
      ...VALID_PROJECT,
      entryFile: "missing.py",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path.includes("entryFile"))).toBe(true);
    }
  });

  it.each([
    ["../../etc/passwd", "a traversal attempt"],
    ["nested/main.py", "a path separator"],
    ["my file.py", "a space"],
    ["emoji🐍.py", "a non-ascii character"],
    ["", "an empty name"],
  ])("rejects %j as a file name (%s)", (name) => {
    const result = createSharedFileSchema.safeParse({
      ...VALID_PROJECT,
      files: { [name]: "x" },
      entryFile: name,
    });
    expect(result.success).toBe(false);
  });

  it("rejects a font size below the supported range", () => {
    expect(createSharedFileSchema.safeParse({ ...VALID_PROJECT, fontSize: 2 }).success).toBe(false);
  });

  it("rejects a font size above the supported range", () => {
    expect(createSharedFileSchema.safeParse({ ...VALID_PROJECT, fontSize: 200 }).success).toBe(
      false,
    );
  });

  it("rejects a fractional font size", () => {
    expect(createSharedFileSchema.safeParse({ ...VALID_PROJECT, fontSize: 14.5 }).success).toBe(
      false,
    );
  });

  it("rejects a font size sent as a string", () => {
    expect(createSharedFileSchema.safeParse({ ...VALID_PROJECT, fontSize: "14" }).success).toBe(
      false,
    );
  });

  it("rejects a file body that is not a string", () => {
    const result = createSharedFileSchema.safeParse({
      ...VALID_PROJECT,
      files: { "main.py": { nested: true } },
    });
    expect(result.success).toBe(false);
  });

  it("rejects more files than the limit", () => {
    const files: Record<string, string> = {};
    for (let index = 0; index <= MAX_SHARED_FILES; index += 1) {
      files[`file-${index}.py`] = "";
    }
    const result = createSharedFileSchema.safeParse({
      files,
      entryFile: "file-0.py",
      fontSize: 14,
    });
    expect(result.success).toBe(false);
  });

  it("rejects a single oversized file", () => {
    const result = createSharedFileSchema.safeParse({
      files: { "main.py": "x".repeat(MAX_FILE_CHARACTERS + 1) },
      entryFile: "main.py",
      fontSize: 14,
    });
    expect(result.success).toBe(false);
  });

  it("rejects a body that is not an object", () => {
    expect(createSharedFileSchema.safeParse(null).success).toBe(false);
    expect(createSharedFileSchema.safeParse("nope").success).toBe(false);
  });
});

describe("sharedFileIdSchema", () => {
  it("accepts a uuid", () => {
    expect(sharedFileIdSchema.safeParse(UUID).success).toBe(true);
  });

  it.each([["not-a-uuid"], [""], ["123"], ["../../etc/passwd"]])("rejects %j", (candidate) => {
    expect(sharedFileIdSchema.safeParse(candidate).success).toBe(false);
  });
});

describe("runRequestSchema", () => {
  it("accepts a project and its entry file", () => {
    expect(
      runRequestSchema.safeParse({ files: { "main.py": "print(1)" }, entryFile: "main.py" })
        .success,
    ).toBe(true);
  });

  it("does not accept a font size, which running does not need", () => {
    const result = runRequestSchema.parse({
      files: { "main.py": "" },
      entryFile: "main.py",
      fontSize: 22,
    });
    expect(result).not.toHaveProperty("fontSize");
  });

  it("rejects an entry file that is not in the project", () => {
    expect(runRequestSchema.safeParse({ files: { "a.py": "" }, entryFile: "b.py" }).success).toBe(
      false,
    );
  });

  it.each([
    ["", "an empty project"],
    [undefined, "a missing project"],
  ])("rejects %j (%s)", (files, _description) => {
    expect(runRequestSchema.safeParse({ files, entryFile: "main.py" }).success).toBe(false);
  });

  it("rejects a traversal attempt in a file name", () => {
    expect(
      runRequestSchema.safeParse({ files: { "../escape.py": "" }, entryFile: "../escape.py" })
        .success,
    ).toBe(false);
  });

  it("rejects a project larger than the shared limit", () => {
    const files: Record<string, string> = {};
    for (let index = 0; index <= MAX_SHARED_FILES; index += 1) files[`f${index}.py`] = "";
    expect(runRequestSchema.safeParse({ files, entryFile: "f0.py" }).success).toBe(false);
  });
});

describe("runnerRunResultSchema", () => {
  const VALID = {
    entryFile: "main.py",
    stdout: "hi\n",
    stderr: "",
    exitCode: 0,
    durationMs: 42,
    timedOut: false,
    image: null,
  };

  it("accepts a console result", () => {
    expect(runnerRunResultSchema.safeParse(VALID).success).toBe(true);
  });

  it("accepts a captured display", () => {
    expect(
      runnerRunResultSchema.safeParse({ ...VALID, image: "data:image/png;base64,AAAA" }).success,
    ).toBe(true);
  });

  it("tolerates the runner's extra display flag", () => {
    const result = runnerRunResultSchema.safeParse({ ...VALID, hadDisplay: true });
    expect(result.success).toBe(true);
  });

  it.each([
    [{ ...VALID, stdout: undefined }, "a missing stdout"],
    [{ ...VALID, exitCode: "0" }, "a string exit code"],
    [{ ...VALID, timedOut: "no" }, "a non-boolean timeout flag"],
    [{ ...VALID, image: undefined }, "a missing image field"],
  ])("rejects %j (%s)", (payload, _description) => {
    expect(runnerRunResultSchema.safeParse(payload).success).toBe(false);
  });
});

const RUN_ID = "0123456789abcdef0123456789abcdef";

describe("runRequestSchema with a run id", () => {
  it("accepts an optional run id", () => {
    const result = runRequestSchema.safeParse({ ...VALID_PROJECT, runId: RUN_ID });
    expect(result.success).toBe(true);
  });

  it("still accepts a request without one", () => {
    expect(runRequestSchema.safeParse(VALID_PROJECT).success).toBe(true);
  });

  it.each([
    ["0123456789ABCDEF0123456789ABCDEF", "uppercase hex"],
    ["0123456789abcdef", "too short"],
    ["0123456789abcdef0123456789abcdeg", "a non-hex character"],
    ["../../etc/passwd", "a path"],
  ])("rejects %j as a run id (%s)", (runId, _description) => {
    expect(runRequestSchema.safeParse({ ...VALID_PROJECT, runId }).success).toBe(false);
  });
});

describe("runInputSchema", () => {
  it("accepts a line of input", () => {
    expect(runInputSchema.safeParse({ runId: RUN_ID, value: "Alice" }).success).toBe(true);
  });

  it("accepts an empty line, which is what pressing Enter sends", () => {
    expect(runInputSchema.safeParse({ runId: RUN_ID, value: "" }).success).toBe(true);
  });

  it("accepts text with quotes, newlines and unicode", () => {
    const value = 'he said "hi"\n🦈';
    expect(runInputSchema.safeParse({ runId: RUN_ID, value }).success).toBe(true);
  });

  it("rejects an over-long line", () => {
    const value = "x".repeat(MAX_INPUT_CHARACTERS + 1);
    expect(runInputSchema.safeParse({ runId: RUN_ID, value }).success).toBe(false);
  });

  it("rejects a missing value", () => {
    expect(runInputSchema.safeParse({ runId: RUN_ID }).success).toBe(false);
  });

  it("rejects an unknown run id shape", () => {
    expect(runInputSchema.safeParse({ runId: "nope", value: "hi" }).success).toBe(false);
  });
});
