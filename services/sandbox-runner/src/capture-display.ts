/**
 * Deciding whether a run needs a virtual display.
 *
 * Tk and turtle only draw into an X display, so Xvfb and the screenshot loop
 * are pure overhead for a console script. The helper independently confirms a
 * window was actually mapped before returning an image, so this scan is an
 * optimisation rather than the thing standing between us and a blank frame.
 */

export interface CapturePolicy {
  firstCaptureAtMs: number;
  captureIntervalMs: number;
  /** Consecutive identical frames before a run is considered finished drawing. */
  stableFramesRequired: number;
}

export const DEFAULT_CAPTURE_POLICY: CapturePolicy = {
  firstCaptureAtMs: 150,
  captureIntervalMs: 120,
  stableFramesRequired: 3,
};

/**
 * Matches `import turtle`, `import tkinter as tk`, `from tkinter import ...`
 * and the same with leading indentation. A line beginning with `#` cannot
 * match, so commented-out imports are ignored.
 */
const DISPLAY_MODULE_IMPORT = /^[ \t]*(?:import|from)[ \t]+(turtle|tkinter)\b/m;

export function projectNeedsDisplay(files: Record<string, string>): boolean {
  return Object.entries(files).some(
    ([name, source]) => name.endsWith(".py") && DISPLAY_MODULE_IMPORT.test(source),
  );
}
