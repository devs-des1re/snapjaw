import { describe, expect, it } from "vitest";

import { loadConfig, transportTimeoutMs, type Env } from "./config.js";

const MINIMAL: Env = {};

describe("loadConfig", () => {
  it("uses documented defaults when nothing is set", () => {
    const config = loadConfig(MINIMAL);

    expect(config.port).toBe(4000);
    expect(config.image).toBe("snapjaw-runner:latest");
    expect(config.poolSize).toBe(3);
    expect(config.runTimeoutMs).toBe(5000);
    expect(config.memoryLimit).toBe("256m");
    expect(config.cpuLimit).toBe("1");
    expect(config.token).toBeNull();
  });

  it("reads overrides from the environment", () => {
    const config = loadConfig({
      SANDBOX_RUNNER_PORT: "4555",
      SANDBOX_POOL_SIZE: "6",
      SANDBOX_TIMEOUT_MS: "9000",
      SANDBOX_MEMORY: "512m",
      SANDBOX_RUNNER_TOKEN: "  secret  ",
    });

    expect(config.port).toBe(4555);
    expect(config.poolSize).toBe(6);
    expect(config.runTimeoutMs).toBe(9000);
    expect(config.memoryLimit).toBe("512m");
    expect(config.token).toBe("secret");
  });

  it("treats a blank token as no auth", () => {
    expect(loadConfig({ SANDBOX_RUNNER_TOKEN: "   " }).token).toBeNull();
  });

  it.each([
    ["not a number", "SANDBOX_POOL_SIZE"],
    ["0", "SANDBOX_POOL_SIZE"],
    ["-4", "SANDBOX_POOL_SIZE"],
  ])("falls back when %s is given for %s", (value, name) => {
    expect(loadConfig({ [name]: value }).poolSize).toBe(3);
  });

  it("never allows a pool size below one", () => {
    expect(loadConfig({ SANDBOX_POOL_SIZE: "0" }).poolSize).toBeGreaterThanOrEqual(1);
  });

  it("allows a zero acquire timeout, meaning do not wait", () => {
    expect(loadConfig({ SANDBOX_ACQUIRE_TIMEOUT_MS: "0" }).acquireTimeoutMs).toBe(0);
  });
});

describe("transportTimeoutMs", () => {
  it("outlives the program's own timeout so the helper can report first", () => {
    const config = loadConfig({ SANDBOX_TIMEOUT_MS: "5000" });
    expect(transportTimeoutMs(config)).toBeGreaterThan(config.runTimeoutMs);
  });
});
