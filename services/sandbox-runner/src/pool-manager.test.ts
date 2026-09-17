import { describe, expect, it } from "vitest";

import { SANDBOX_LABEL, selectOrphanedSandboxes } from "./pool-manager.js";

describe("SANDBOX_LABEL", () => {
  it("is the label the pool stamps on containers it creates", () => {
    expect(SANDBOX_LABEL).toBe("snapjaw.role=sandbox");
  });
});

describe("selectOrphanedSandboxes", () => {
  it("picks containers carrying this instance's name prefix", () => {
    const containers = [
      { id: "1", name: "snapjaw-runner-aaaa1111" },
      { id: "2", name: "snapjaw-runner-bbbb2222" },
    ];
    expect(selectOrphanedSandboxes(containers, "snapjaw-runner")).toEqual(containers);
  });

  it("leaves containers from another stack alone", () => {
    const containers = [
      { id: "1", name: "snapjaw-runner-aaaa1111" },
      { id: "2", name: "other-stack-runner-cccc3333" },
      { id: "3", name: "snapjaw-staging-runner-dddd4444" },
    ];
    expect(selectOrphanedSandboxes(containers, "snapjaw-runner")).toEqual([
      { id: "1", name: "snapjaw-runner-aaaa1111" },
    ]);
  });

  it("does not match a name that merely starts with the prefix characters", () => {
    const containers = [{ id: "1", name: "snapjaw-runnerish-1" }];
    expect(selectOrphanedSandboxes(containers, "snapjaw-runner")).toEqual([]);
  });

  it("honours a custom prefix", () => {
    const containers = [
      { id: "1", name: "custom-1" },
      { id: "2", name: "snapjaw-runner-aaaa1111" },
    ];
    expect(selectOrphanedSandboxes(containers, "custom")).toEqual([{ id: "1", name: "custom-1" }]);
  });

  it("returns nothing for an empty list", () => {
    expect(selectOrphanedSandboxes([], "snapjaw-runner")).toEqual([]);
  });
});
