import { spawn } from "node:child_process";

// Killing the spawned client does not stop the process inside the container; the pool's reset does.

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

export interface StreamingDockerOptions extends DockerOptions {
  onStdoutLine?: (line: string) => void;
  signal?: AbortSignal;
}

export function runDockerStreaming(
  args: string[],
  options: StreamingDockerOptions = {},
): Promise<DockerResult> {
  const {
    input,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxBufferBytes = DEFAULT_MAX_BUFFER_BYTES,
    onStdoutLine,
    signal,
  } = options;

  return new Promise<DockerResult>((resolve, reject) => {
    const child = spawn("docker", args, {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });

    const errChunks: Buffer[] = [];
    let errBytes = 0;
    let timedOut = false;
    let settled = false;

    let pending = "";
    let droppedBytes = 0;

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
      signal?.removeEventListener("abort", onAbort);
      action();
    };

    function onAbort() {
      child.kill("SIGKILL");
      finish(() => reject(new Error("aborted")));
    }

    if (signal) {
      if (signal.aborted) {
        child.kill("SIGKILL");
        finish(() => reject(new Error("aborted")));
        return;
      }
      signal.addEventListener("abort", onAbort, { once: true });
    }

    child.stdout.on("data", (chunk: Buffer) => {
      if (droppedBytes > 0 || !onStdoutLine) {
        droppedBytes += chunk.length;
        return;
      }

      pending += chunk.toString("utf8");
      let index = pending.indexOf("\n");
      while (index !== -1) {
        const line = pending.slice(0, index);
        pending = pending.slice(index + 1);
        if (line.length > 0) onStdoutLine(line);
        index = pending.indexOf("\n");
      }

      if (pending.length > maxBufferBytes) {
        droppedBytes += pending.length;
        pending = "";
      }
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
      finish(() => {
        if (pending.length > 0 && onStdoutLine) onStdoutLine(pending);
        resolve({
          code: code ?? -1,
          stdout: droppedBytes > 0 ? `[snapjaw] dropped ${droppedBytes} bytes of stdout` : "",
          stderr: Buffer.concat(errChunks).toString("utf8"),
          timedOut,
        });
      });
    });

    child.stdin.on("error", () => {
      // The child can exit before reading stdin; close reports it.
    });
    child.stdin.end(input ?? "");
  });
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
    // Ignored: removing a container that is already gone is fine.
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

export interface ContainerRef {
  id: string;
  name: string;
}

export async function dockerListContainersByLabel(label: string): Promise<ContainerRef[]> {
  try {
    const result = await runDocker(
      ["ps", "-a", "--filter", `label=${label}`, "--format", "{{.ID}}\t{{.Names}}"],
      { timeoutMs: 20_000 },
    );
    if (result.code !== 0) return [];

    return result.stdout
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [id, name] = line.split("\t");
        return { id: id ?? "", name: name ?? "" };
      })
      .filter((entry) => entry.id !== "" && entry.name !== "");
  } catch {
    return [];
  }
}
