import { describe, expect, it, vi } from "vitest";

import { RunRegistry } from "./run-registry.js";

function fakeHandle() {
  const write = vi.fn();
  return { handle: { write, kill: vi.fn() }, write };
}

const RUN_ID = "0123456789abcdef0123456789abcdef";

describe("RunRegistry", () => {
  it("writes a line to a run that asked for input", () => {
    const registry = new RunRegistry();
    const { handle, write } = fakeHandle();

    registry.register(RUN_ID, handle);
    registry.expectsInput(RUN_ID);

    expect(registry.send(RUN_ID, "Alice")).toBe(true);
    expect(write).toHaveBeenCalledWith("Alice\n");
  });

  it("refuses input for an unknown run", () => {
    const registry = new RunRegistry();
    expect(registry.send(RUN_ID, "hello")).toBe(false);
  });

  it("refuses a second line for the same prompt", () => {
    const registry = new RunRegistry();
    const { handle } = fakeHandle();

    registry.register(RUN_ID, handle);
    registry.expectsInput(RUN_ID);

    expect(registry.send(RUN_ID, "one")).toBe(true);
    expect(registry.send(RUN_ID, "two")).toBe(false);
  });

  it("accepts the next line once the program asks again", () => {
    const registry = new RunRegistry();
    const { handle, write } = fakeHandle();

    registry.register(RUN_ID, handle);
    registry.expectsInput(RUN_ID);
    registry.send(RUN_ID, "one");

    registry.expectsInput(RUN_ID);
    expect(registry.send(RUN_ID, "two")).toBe(true);
    expect(write).toHaveBeenLastCalledWith("two\n");
  });

  it("sends an empty line, which is a legitimate answer", () => {
    const registry = new RunRegistry();
    const { handle, write } = fakeHandle();

    registry.register(RUN_ID, handle);
    registry.expectsInput(RUN_ID);

    expect(registry.send(RUN_ID, "")).toBe(true);
    expect(write).toHaveBeenCalledWith("\n");
  });

  it("refuses input as soon as the run is unregistered", () => {
    const registry = new RunRegistry();
    const { handle } = fakeHandle();

    registry.register(RUN_ID, handle);
    registry.expectsInput(RUN_ID);
    registry.unregister(RUN_ID);

    expect(registry.send(RUN_ID, "hello")).toBe(false);
    expect(registry.size()).toBe(0);
  });

  it("ignores a prompt claim from a run it does not know", () => {
    const registry = new RunRegistry();
    registry.expectsInput(RUN_ID);
    expect(registry.send(RUN_ID, "hello")).toBe(false);
  });

  it("forgets a pending prompt when a new run reuses the id", () => {
    const registry = new RunRegistry();
    const first = fakeHandle();
    const second = fakeHandle();

    registry.register(RUN_ID, first.handle);
    registry.expectsInput(RUN_ID);
    registry.register(RUN_ID, second.handle);

    expect(registry.send(RUN_ID, "hello")).toBe(false);
    expect(first.write).not.toHaveBeenCalled();
  });
});
