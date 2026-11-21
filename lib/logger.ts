type Level = "info" | "warn" | "error";

const colors: Record<Level, string> = {
  info: "\x1b[36m",
  warn: "\x1b[33m",
  error: "\x1b[31m",
};
const reset = "\x1b[0m";
const useColor = process.env.NODE_ENV !== "production";

function write(level: Level, message: string, meta?: unknown) {
  const time = new Date().toISOString();
  const label = level.toUpperCase().padEnd(5);
  const tag = useColor ? `${colors[level]}${label}${reset}` : label;
  const line = `${time} ${tag} ${message}`;
  const out = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
  meta === undefined ? out(line) : out(line, meta);
}

export const logger = {
  info: (message: string, meta?: unknown) => write("info", message, meta),
  warn: (message: string, meta?: unknown) => write("warn", message, meta),
  error: (message: string, meta?: unknown) => write("error", message, meta),
};
