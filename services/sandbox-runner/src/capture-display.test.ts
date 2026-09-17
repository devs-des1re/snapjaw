import { describe, expect, it } from "vitest";

import { DEFAULT_CAPTURE_POLICY, projectNeedsDisplay } from "./capture-display.js";

describe("projectNeedsDisplay", () => {
  it("detects a plain turtle import", () => {
    expect(projectNeedsDisplay({ "main.py": "import turtle\nturtle.forward(10)\n" })).toBe(true);
  });

  it("detects an aliased import", () => {
    expect(projectNeedsDisplay({ "main.py": "import tkinter as tk\nroot = tk.Tk()\n" })).toBe(true);
  });

  it("detects a from-import", () => {
    expect(projectNeedsDisplay({ "main.py": "from tkinter import Tk\n" })).toBe(true);
  });

  it("detects an indented import inside a function", () => {
    expect(projectNeedsDisplay({ "main.py": "def draw():\n    import turtle\n" })).toBe(true);
  });

  it("detects the import in a helper module, not just the entry file", () => {
    expect(
      projectNeedsDisplay({
        "main.py": "import shapes\n",
        "shapes.py": "import turtle\n",
      }),
    ).toBe(true);
  });

  it("ignores a commented-out import", () => {
    expect(projectNeedsDisplay({ "main.py": "# import turtle\nprint('hi')\n" })).toBe(false);
  });

  it("ignores a non-python file that mentions the module", () => {
    expect(projectNeedsDisplay({ "notes.txt": "import turtle\n" })).toBe(false);
  });

  it("returns false for a console-only program", () => {
    expect(projectNeedsDisplay({ "main.py": "print('hello')\n" })).toBe(false);
  });

  it("does not match an unrelated identifier that contains the word", () => {
    expect(projectNeedsDisplay({ "main.py": "import turtleneck\n" })).toBe(false);
  });

  it("returns false for an empty project", () => {
    expect(projectNeedsDisplay({})).toBe(false);
  });
});

describe("DEFAULT_CAPTURE_POLICY", () => {
  it("samples often enough to look like live animation", () => {
    expect(DEFAULT_CAPTURE_POLICY.captureIntervalMs).toBeLessThanOrEqual(200);
  });

  it("starts capturing soon after the program begins", () => {
    expect(DEFAULT_CAPTURE_POLICY.firstCaptureAtMs).toBeLessThanOrEqual(300);
  });

  it("requires several stable frames so a pause mid-animation does not end a run", () => {
    expect(DEFAULT_CAPTURE_POLICY.stableFramesRequired).toBeGreaterThanOrEqual(3);
  });
});
