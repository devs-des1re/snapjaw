import { describe, expect, it } from "vitest";

import {
  MAX_FILE_CHARACTERS,
  MAX_SHARED_FILES,
  createSharedFileSchema,
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
