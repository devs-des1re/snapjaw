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
  /**
   * How long the display must stay unchanged before a run is considered
   * finished drawing. Measured in time rather than frames so the value means
   * the same thing at 8fps and at 60fps.
   */
  stableMs: number;
  /** Target frames per second for the live stream. */
  streamFps: number;
  /** JPEG quality for streamed frames. */
  streamQuality: number;
  /** Downscale width for streamed frames; 0 captures at full display size. */
  streamWidth: number;
}

export const DEFAULT_CAPTURE_POLICY: CapturePolicy = {
  firstCaptureAtMs: 150,
  stableMs: 600,
  streamFps: 60,
  streamQuality: 60,
  streamWidth: 800,
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
