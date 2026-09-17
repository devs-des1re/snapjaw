import { describe, expect, it } from "vitest";

import {
  collectImportAliases,
  completionsFor,
  lineContext,
  type PythonCompletion,
} from "./completions";

function labels(completions: PythonCompletion[]): string[] {
  return completions.map((completion) => completion.label);
}

function find(completions: PythonCompletion[], label: string): PythonCompletion | undefined {
  return completions.find((completion) => completion.label === label);
}

const NO_IMPORTS: Record<string, string> = {};

describe("lineContext", () => {
  it("treats plain code as code", () => {
    expect(lineContext("random.")).toBe("code");
    expect(lineContext('print("hi") + "ok"')).toBe("code");
  });

  it("detects an unterminated string", () => {
    expect(lineContext('message = "import ran')).toBe("string");
    expect(lineContext("names = ['a', 'b")).toBe("string");
  });

  it("detects a comment", () => {
    expect(lineContext("# import ran")).toBe("comment");
    expect(lineContext("x = 1  # ran")).toBe("comment");
  });

  it("closes a triple quoted string", () => {
    expect(lineContext('"""import random"""')).toBe("code");
    expect(lineContext('"""import random')).toBe("string");
  });
});

describe("collectImportAliases", () => {
  it("binds the module name for a plain import", () => {
    expect(collectImportAliases("import turtle")).toEqual({ turtle: "turtle" });
  });

  it("binds the alias when one is given", () => {
    expect(collectImportAliases("import turtle as t")).toEqual({ t: "turtle" });
  });

  it("binds the root name for a dotted import", () => {
    expect(collectImportAliases("import os.path")).toEqual({ os: "os" });
    expect(collectImportAliases("import os.path as p")).toEqual({ p: "os.path" });
  });

  it("binds every name of a from-import", () => {
    expect(collectImportAliases("from os.path import join, dirname as parent")).toEqual({
      join: "os.path.join",
      parent: "os.path.dirname",
    });
  });

  it("handles parenthesised, comma separated and commented imports", () => {
    expect(collectImportAliases("import random, math  # handy")).toEqual({
      random: "random",
      math: "math",
    });
    expect(collectImportAliases("from math import (sqrt, pi)")).toEqual({
      sqrt: "math.sqrt",
      pi: "math.pi",
    });
  });
});

describe("completionsFor — imports", () => {
  it("offers module names while typing an import", () => {
    const completions = completionsFor({ linePrefix: "import ra", imports: NO_IMPORTS });
    expect(labels(completions)).toContain("random");
    expect(completions.every((completion) => completion.kind === "module")).toBe(true);
  });

  it("offers module names for a bare import and does not leak keywords", () => {
    const completions = completionsFor({ linePrefix: "import ", imports: NO_IMPORTS });
    expect(labels(completions)).toContain("turtle");
    expect(labels(completions)).toContain("json");
    expect(labels(completions)).not.toContain("return");
  });

  it("offers module names after from", () => {
    expect(labels(completionsFor({ linePrefix: "from ra", imports: NO_IMPORTS }))).toContain(
      "random",
    );
  });

  it("offers the members of the module after from … import", () => {
    const completions = completionsFor({ linePrefix: "from math import ", imports: NO_IMPORTS });
    expect(labels(completions)).toContain("sqrt");
    expect(labels(completions)).toContain("pi");
    expect(labels(completions)).not.toContain("return");
  });

  it("inserts a call with the cursor inside the parentheses", () => {
    const completions = completionsFor({ linePrefix: "from math import ", imports: NO_IMPORTS });
    expect(find(completions, "sqrt")?.insertText).toBe("sqrt($0)");
    expect(find(completions, "sqrt")?.detail).toBe("sqrt(x)");
    expect(find(completions, "pi")?.kind).toBe("value");
  });

  it("offers the members of a dotted module after from … import", () => {
    const completions = completionsFor({ linePrefix: "from os.path import ", imports: NO_IMPORTS });
    expect(labels(completions)).toContain("join");
  });
});

describe("completionsFor — attributes", () => {
  it("completes members of a module that was never imported", () => {
    const completions = completionsFor({ linePrefix: "turtle.", imports: NO_IMPORTS });
    expect(labels(completions)).toContain("forward");
    expect(labels(completions)).toContain("Turtle");
  });

  it("completes members through an alias", () => {
    const imports = collectImportAliases("import turtle as t");
    expect(labels(completionsFor({ linePrefix: "t.", imports }))).toContain("forward");
  });

  it("completes members after an earlier import line", () => {
    const imports = collectImportAliases("import random\n\nrandom.");
    expect(labels(completionsFor({ linePrefix: "random.", imports }))).toContain("randint");
  });

  it("filters on the partial member name", () => {
    const completions = completionsFor({ linePrefix: "random.rand", imports: NO_IMPORTS });
    expect(labels(completions)).toContain("randint");
  });

  it("stays quiet for an unknown receiver", () => {
    expect(completionsFor({ linePrefix: "self.", imports: NO_IMPORTS })).toEqual([]);
    expect(completionsFor({ linePrefix: "result.value.", imports: NO_IMPORTS })).toEqual([]);
  });
});

describe("completionsFor — globals", () => {
  it("offers keywords, builtins and exceptions while typing an identifier", () => {
    const completions = completionsFor({ linePrefix: "pri", imports: NO_IMPORTS });
    expect(labels(completions)).toContain("print");
    expect(find(completions, "print")?.kind).toBe("function");
    expect(find(completions, "print")?.insertText).toBe("print($0)");
  });

  it("offers keywords", () => {
    const completions = completionsFor({ linePrefix: "ret", imports: NO_IMPORTS });
    expect(find(completions, "return")?.kind).toBe("keyword");
  });

  it("offers builtin classes and values", () => {
    const completions = completionsFor({ linePrefix: "ValueErr", imports: NO_IMPORTS });
    expect(find(completions, "ValueError")?.kind).toBe("class");
    expect(
      find(completionsFor({ linePrefix: "NotIm", imports: NO_IMPORTS }), "NotImplemented"),
    ).toBeDefined();
  });

  it("offers snippets instead of a bare keyword of the same name", () => {
    const completions = completionsFor({ linePrefix: "for", imports: NO_IMPORTS });
    const forEntries = completions.filter((completion) => completion.label === "for");
    expect(forEntries).toHaveLength(1);
    expect(forEntries[0]?.kind).toBe("snippet");
    expect(forEntries[0]?.insertText).toContain("for ${1:item} in ${2:iterable}");
  });

  it("never returns duplicate labels", () => {
    const completions = completionsFor({ linePrefix: "", imports: NO_IMPORTS });
    expect(new Set(labels(completions)).size).toBe(completions.length);
  });

  it("stays quiet inside strings and comments", () => {
    expect(completionsFor({ linePrefix: 'x = "ran', imports: NO_IMPORTS })).toEqual([]);
    expect(completionsFor({ linePrefix: "# import ran", imports: NO_IMPORTS })).toEqual([]);
  });
});
