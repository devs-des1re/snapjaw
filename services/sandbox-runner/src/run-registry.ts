import type { DockerStreamHandle } from "./docker.js";

export class RunRegistry {
  private readonly runs = new Map<string, DockerStreamHandle>();
  private readonly waiting = new Set<string>();

  register(runId: string, handle: DockerStreamHandle): void {
    this.runs.set(runId, handle);
    this.waiting.delete(runId);
  }

  unregister(runId: string): void {
    this.runs.delete(runId);
    this.waiting.delete(runId);
  }

  expectsInput(runId: string): void {
    if (this.runs.has(runId)) this.waiting.add(runId);
  }

  // Returns false when the run is gone or was not asking for anything.
  send(runId: string, value: string): boolean {
    const handle = this.runs.get(runId);
    if (!handle || !this.waiting.delete(runId)) return false;

    handle.write(`${value}\n`);
    return true;
  }

  size(): number {
    return this.runs.size;
  }
}
