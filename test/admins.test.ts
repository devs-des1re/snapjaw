import { beforeEach, describe, expect, it } from "vitest";
import { actor, freshDatabase } from "./helpers";
import { completeSetup, setupTokenForTests } from "../server/admin/setup";
import { acceptInvite, changeAdmin, createAdminDirect, inviteAdmin, removeAdmin } from "../server/admin/admins";
import { countActiveOwners, findUserByEmail } from "../db/queries/users";
import { listAudit } from "../db/queries/audit";
import { hashPassword, verifyPassword } from "../lib/passwords";

const info = { ip: "127.0.0.1", userAgent: "vitest" };
const password = "a-long-enough-password";

async function setupOwner() {
  setupTokenForTests("token-123");
  const result = await completeSetup({ token: "token-123", email: "owner@example.com", name: "Owner", password }, info);
  if (!result.ok) throw new Error(result.error);
  return actor({ id: result.id, email: "owner@example.com", role: "owner" });
}

beforeEach(async () => {
  await freshDatabase();
});

describe("passwords", () => {
  it("hashes with argon2id and verifies", async () => {
    const hash = await hashPassword(password);
    expect(hash.startsWith("$argon2id$")).toBe(true);
    expect(await verifyPassword(password, hash)).toBe(true);
    expect(await verifyPassword("wrong-password-here", hash)).toBe(false);
    expect(await verifyPassword(password, null)).toBe(false);
  });
});

describe("first-run setup", () => {
  it("rejects a wrong token", async () => {
    setupTokenForTests("right");
    const result = await completeSetup({ token: "wrong", email: "owner@example.com", name: "", password }, info);
    expect(result.ok).toBe(false);
  });

  it("creates the first owner once", async () => {
    const owner = await setupOwner();
    expect(owner.id).toMatch(/^usr_/);
    expect(await countActiveOwners()).toBe(1);
    setupTokenForTests("token-123");
    const again = await completeSetup({ token: "token-123", email: "second@example.com", name: "", password }, info);
    expect(again.ok).toBe(false);
    const audit = await listAudit({});
    expect(audit.map((a) => a.action)).toContain("admin.setup");
  });

  it("rejects short passwords", async () => {
    setupTokenForTests("t");
    const result = await completeSetup({ token: "t", email: "owner@example.com", name: "", password: "short" }, info);
    expect(result.ok).toBe(false);
  });
});

describe("admin management", () => {
  it("lets an owner invite an admin who can then accept", async () => {
    const owner = await setupOwner();
    const invite = await inviteAdmin(owner, { email: "new@example.com", role: "admin" });
    expect(invite.ok).toBe(true);
    if (!invite.ok) return;
    const token = new URL(invite.data.url).searchParams.get("token")!;
    const accepted = await acceptInvite({ token, name: "New", password }, info);
    expect(accepted.ok).toBe(true);
    const reuse = await acceptInvite({ token, name: "New", password }, info);
    expect(reuse.ok).toBe(false);
    const found = await findUserByEmail("new@example.com");
    expect(found?.user.role).toBe("admin");
    const actions = (await listAudit({})).map((a) => a.action);
    expect(actions).toContain("admin.invite");
    expect(actions).toContain("admin.invite_accept");
  });

  it("stops an admin from creating or changing owners", async () => {
    const owner = await setupOwner();
    const created = await createAdminDirect(owner, { email: "admin@example.com", name: "", role: "admin", password });
    if (!created.ok) throw new Error(created.error);
    const admin = actor({ id: created.data.id, email: "admin@example.com", role: "admin" });
    const makeOwner = await createAdminDirect(admin, { email: "x@example.com", name: "", role: "owner", password });
    expect(makeOwner.ok).toBe(false);
    const promote = await changeAdmin(admin, owner.id, { role: "viewer" });
    expect(promote.ok).toBe(false);
    const removeOwner = await removeAdmin(admin, owner.id);
    expect(removeOwner.ok).toBe(false);
  });

  it("stops viewers from managing anyone", async () => {
    const owner = await setupOwner();
    const viewer = actor({ id: "usr_viewer", role: "viewer" });
    const result = await inviteAdmin(viewer, { email: "v@example.com", role: "viewer" });
    expect(result.ok).toBe(false);
    expect(owner.role).toBe("owner");
  });

  it("keeps at least one owner", async () => {
    const owner = await setupOwner();
    const created = await createAdminDirect(owner, { email: "second@example.com", name: "", role: "owner", password });
    if (!created.ok) throw new Error(created.error);
    const second = actor({ id: created.data.id, email: "second@example.com", role: "owner" });
    expect((await changeAdmin(second, owner.id, { disabled: true })).ok).toBe(true);
    expect(await countActiveOwners()).toBe(1);
    const demoteLast = await changeAdmin(owner, second.id, { role: "admin" });
    expect(demoteLast.ok).toBe(false);
    expect((await removeAdmin(owner, owner.id)).ok).toBe(false);
  });

  it("lets an owner remove another owner", async () => {
    const owner = await setupOwner();
    const created = await createAdminDirect(owner, { email: "second@example.com", name: "", role: "owner", password });
    if (!created.ok) throw new Error(created.error);
    expect((await removeAdmin(owner, created.data.id)).ok).toBe(true);
    expect(await findUserByEmail("second@example.com")).toBeNull();
  });
});
