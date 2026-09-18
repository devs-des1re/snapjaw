export interface TracebackFrame {
  file: string;
  line: number;
}

// The sandbox runs the project in a per-run temp directory, so the useful part of the
// path is the base name — that is what matches a tab in the editor.
const FRAME_PATTERN = /File "([^"]+)", line (\d+)/g;

export function parseTracebackFrames(text: string): TracebackFrame[] {
  const frames: TracebackFrame[] = [];
  for (const match of text.matchAll(FRAME_PATTERN)) {
    const rawPath = match[1] ?? "";
    const line = Number.parseInt(match[2] ?? "", 10);
    if (!rawPath || !Number.isFinite(line) || line <= 0) continue;

    const file = baseName(rawPath);
    if (!file) continue;

    frames.push({ file, line });
  }
  return frames;
}

function baseName(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const slash = normalized.lastIndexOf("/");
  return slash === -1 ? normalized : normalized.slice(slash + 1);
}
