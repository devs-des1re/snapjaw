import { spawn } from "node:child_process";

/**
 * Thin wrapper over the `docker` CLI.
 *
 * The runner shells out rather than driving the daemon through a client
 * library: the CLI already knows how to reach the socket on every platform,
 * and the runner does no container work beyond `run` and `exec`.
 *
 * Killing the spawned client does NOT reliably stop the process inside the
 * container — SIGKILL cannot be proxied. The pool's reset step is what
 * guarantees a container is clean before it is reused.
 */

const DEFAULT_MAX_BUFFER_BYTES = 32 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 60_000;

export interface DockerResult {
  code: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export interface DockerOptions {
  input?: string;
  timeoutMs?: number;
  maxBufferBytes?: number;
}

export class DockerError extends Error {
  readonly result: DockerResult;

  constructor(message: string, result: DockerResult) {
    super(message);
    this.name = "DockerError";
    this.result = result;
  }
}

export function runDocker(args: string[], options: DockerOptions = {}): Promise<DockerResult> {
  const {
    input,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxBufferBytes = DEFAULT_MAX_BUFFER_BYTES,
  } = options;

  return new Promise<DockerResult>((resolve, reject) => {
    const child = spawn("docker", args, {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });

    const outChunks: Buffer[] = [];
    const errChunks: Buffer[] = [];
    let outBytes = 0;
    let errBytes = 0;
    let timedOut = false;
    let settled = false;

    const timer =
      timeoutMs > 0
        ? setTimeout(() => {
            timedOut = true;
            child.kill("SIGKILL");
          }, timeoutMs)
        : null;

    const finish = (action: () => void) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      action();
    };

    child.stdout.on("data", (chunk: Buffer) => {
      if (outBytes >= maxBufferBytes) return;
      outChunks.push(chunk);
      outBytes += chunk.length;
    });

    child.stderr.on("data", (chunk: Buffer) => {
      if (errBytes >= maxBufferBytes) return;
      errChunks.push(chunk);
      errBytes += chunk.length;
    });

    child.on("error", (error) => {
      finish(() => reject(error));
    });

    child.on("close", (code) => {
      finish(() =>
        resolve({
          code: code ?? -1,
          stdout: Buffer.concat(outChunks).toString("utf8"),
          stderr: Buffer.concat(errChunks).toString("utf8"),
          timedOut,
        }),
      );
    });

    child.stdin.on("error", () => {
      // The child can exit before reading stdin; the close handler reports it.
    });
    child.stdin.end(input ?? "");
  });
}

export async function dockerRunDetached(args: string[], timeoutMs = 120_000): Promise<string> {
  const result = await runDocker(["run", "-d", ...args], { timeoutMs });
  if (result.code !== 0) {
    throw new DockerError(
      `docker run failed: ${result.stderr.trim() || result.stdout.trim()}`,
      result,
    );
  }
  return result.stdout.trim();
}

export async function dockerExec(
  container: string,
  command: string[],
  options: DockerOptions = {},
): Promise<DockerResult> {
  return runDocker(["exec", "-i", container, ...command], options);
}

export async function dockerIsRunning(container: string): Promise<boolean> {
  try {
    const result = await runDocker(["inspect", "-f", "{{.State.Running}}", container], {
      timeoutMs: 15_000,
    });
    return result.code === 0 && result.stdout.trim() === "true";
  } catch {
    return false;
  }
}

export async function dockerRemove(container: string): Promise<void> {
  try {
    await runDocker(["rm", "-f", container], { timeoutMs: 30_000 });
  } catch {
    // Best effort: a container that is already gone is not a problem.
  }
}

export async function dockerImageExists(image: string): Promise<boolean> {
  try {
    const result = await runDocker(["image", "inspect", image], { timeoutMs: 20_000 });
    return result.code === 0;
  } catch {
    return false;
  }
}
