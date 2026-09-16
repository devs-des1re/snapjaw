export interface RunnerConfig {
  port: number;
  image: string;
  containerPrefix: string;
  poolSize: number;
  acquireTimeoutMs: number;
  healthIntervalMs: number;
  runTimeoutMs: number;
  maxOutputBytes: number;
  memoryLimit: string;
  cpuLimit: string;
  pidsLimit: number;
  screen: string;
  tmpfsSize: string;
  firstCaptureAtMs: number;
  captureIntervalMs: number;
  token: string | null;
}

export type Env = Record<string, string | undefined>;

function readInt(env: Env, name: string, fallback: number, min = 0): number {
  const raw = env[name]?.trim();
  if (!raw) return fallback;

  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value < min) return fallback;
  return value;
}

function readString(env: Env, name: string, fallback: string): string {
  const raw = env[name]?.trim();
  return raw ? raw : fallback;
}

export function loadConfig(env: Env = process.env): RunnerConfig {
  return {
    port: readInt(env, "SANDBOX_RUNNER_PORT", 4000, 1),
    image: readString(env, "SANDBOX_IMAGE", "snapjaw-runner:latest"),
    containerPrefix: readString(env, "SANDBOX_CONTAINER_PREFIX", "snapjaw-runner"),
    poolSize: readInt(env, "SANDBOX_POOL_SIZE", 3, 1),
    acquireTimeoutMs: readInt(env, "SANDBOX_ACQUIRE_TIMEOUT_MS", 15000, 0),
    healthIntervalMs: readInt(env, "SANDBOX_HEALTH_INTERVAL_MS", 15000, 1000),
    runTimeoutMs: readInt(env, "SANDBOX_TIMEOUT_MS", 5000, 100),
    maxOutputBytes: readInt(env, "SANDBOX_MAX_OUTPUT_BYTES", 65536, 1024),
    memoryLimit: readString(env, "SANDBOX_MEMORY", "256m"),
    cpuLimit: readString(env, "SANDBOX_CPUS", "1"),
    pidsLimit: readInt(env, "SANDBOX_PIDS_LIMIT", 128, 8),
    screen: readString(env, "SANDBOX_DISPLAY", "1024x768x24"),
    tmpfsSize: readString(env, "SANDBOX_TMPFS_SIZE", "128m"),
    firstCaptureAtMs: readInt(env, "SANDBOX_FIRST_CAPTURE_MS", 400),
    captureIntervalMs: readInt(env, "SANDBOX_CAPTURE_INTERVAL_MS", 400, 50),
    token: env.SANDBOX_RUNNER_TOKEN?.trim() || null,
  };
}

/**
 * The helper enforces the program's wall clock itself; this is the outer
 * guard for the `docker exec` transport, so it must always be longer.
 */
export function transportTimeoutMs(config: RunnerConfig): number {
  return config.runTimeoutMs + 15000;
}
