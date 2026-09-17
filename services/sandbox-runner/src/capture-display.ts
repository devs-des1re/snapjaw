export interface CapturePolicy {
  firstCaptureAtMs: number;
  stableMs: number;
  streamFps: number;
  streamQuality: number;
  streamWidth: number;
}

export const DEFAULT_CAPTURE_POLICY: CapturePolicy = {
  firstCaptureAtMs: 150,
  stableMs: 600,
  streamFps: 60,
  streamQuality: 60,
  streamWidth: 800,
};

// A line starting with # cannot match, so commented-out imports are ignored.
const DISPLAY_MODULE_IMPORT = /^[ \t]*(?:import|from)[ \t]+(turtle|tkinter)\b/m;

export function projectNeedsDisplay(files: Record<string, string>): boolean {
  return Object.entries(files).some(
    ([name, source]) => name.endsWith(".py") && DISPLAY_MODULE_IMPORT.test(source),
  );
}
