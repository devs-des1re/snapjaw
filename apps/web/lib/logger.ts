import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogFields {
  [key: string]: unknown;
}

const LOG_LEVEL: LogLevel = (process.env.LOG_LEVEL as LogLevel | undefined) ?? "info";

const LEVEL_RANK: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

/**
 * Fixed, not configurable: the bundler statically traces filesystem access, and
 * a dynamic directory makes it pull the entire project into the server output.
 */
const LOG_DIRECTORY = "logs";

let logFilePath: string | null = null;

/** Serialise writes so concurrent requests cannot interleave inside a line. */
let writeQueue: Promise<void> = Promise.resolve();

function fileNameFor(date: Date): string {
  return `${date.toISOString().replace(/[:.]/g, "-")}.log`;
}

async function resolveLogFile(): Promise<string> {
  if (logFilePath) return logFilePath;

  const directory = path.join(process.cwd(), LOG_DIRECTORY);
  await mkdir(directory, { recursive: true });
  logFilePath = path.join(directory, fileNameFor(new Date()));
  return logFilePath;
}

function enqueueWrite(line: string): void {
  writeQueue = writeQueue
    .then(async () => {
      const file = await resolveLogFile();
      await appendFile(file, line, "utf8");
    })
    .catch(() => {
      // Logging must never take a request down.
    });
}

/**
 * Structured logging: one JSON object per line, mirrored to stdout for
 * container logs and appended to a timestamped file under `logs/`.
 *
 * The file is named for the moment the process first logged, so a run's
 * entries stay together rather than scattering across files.
 */
export function log(level: LogLevel, message: string, fields: LogFields = {}): void {
  if (LEVEL_RANK[level] < LEVEL_RANK[LOG_LEVEL]) return;

  const entry = { level, time: new Date().toISOString(), message, ...fields };
  const line = `${JSON.stringify(entry)}\n`;

  if (level === "error") console.error(line.trimEnd());
  else if (level === "warn") console.warn(line.trimEnd());
  else console.log(line.trimEnd());

  enqueueWrite(line);
}

export function describeError(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}

/** Where log lines are being written, for startup diagnostics. */
export function currentLogFile(): string | null {
  return logFilePath;
}
