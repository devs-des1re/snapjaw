import { createMemo, createSignal, onMount } from "@krate/runtime";
import { Button, Input } from "@krate/components";
import { RowButton } from "../../../components/ui/button";
import { PageHeader, Section } from "../../../components/ui/page";
import { Field, Notice } from "../../../components/ui/form";
import { Table, Empty } from "../../../components/ui/table";
import { Status } from "../../../components/ui/status";
import { ValueBlock } from "../../../components/ui/copy";
import { api, formData, formatDate, formatRelative } from "../../../lib/client";

type Admin = {
  id: string;
  email: string;
  name: string | null;
  role: string;
  twoFactorEnabled: boolean;
  disabledAt: string | null;
  lastLoginAt: string | null;
  lastLoginIp: string | null;
  manageable?: boolean;
};
type Invite = { id: string; email: string; role: string; expiresAt: string; manageable?: boolean };
type Me = { id: string; role: string };

export default function Admins() {
  const [admins, setAdmins] = createSignal<Admin[]>([]);
  const [invites, setInvites] = createSignal<Invite[]>([]);
  const [me, setMe] = createSignal<Me | null>(null);
  const [link, setLink] = createSignal("");
  const [message, setMessage] = createSignal("");
  const [error, setError] = createSignal("");
  const [mode, setMode] = createSignal<"invite" | "create">("invite");

  async function load() {
    const [list, who] = await Promise.all([api.get<{ admins: Admin[]; invites: Invite[] }>("/api/admins"), api.get<Me>("/api/me")]);
    const viewer = who.ok ? who.data : null;
    if (viewer) setMe(viewer);
    const manager = viewer?.role === "owner" || viewer?.role === "admin";
    if (list.ok) {
      setAdmins(list.data.admins.map((a) => ({ ...a, manageable: manager && a.id !== viewer?.id && (viewer?.role === "owner" || a.role !== "owner") })));
      setInvites(list.data.invites.map((i) => ({ ...i, manageable: manager })));
    } else setError(list.error);
  }

  onMount(() => void load());

  const canManage = createMemo(() => me()?.role === "owner" || me()?.role === "admin");

  function report(result: { ok: boolean; error?: string }, text: string) {
    if (!result.ok) {
      setMessage("");
      setError(result.error ?? "That did not work.");
      return false;
    }
    setError("");
    setMessage(text);
    void load();
    return true;
  }

  async function invite(event: Event) {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const data = formData(event);
    const result = await api.post<{ url: string }>("/api/invites", { email: data.email, role: data.role });
    if (report(result as never, "Invite created. Send the link to the new admin. It works once and expires in 7 days.") && result.ok) {
      setLink(result.data.url);
      form.reset();
    }
  }

  async function create(event: Event) {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const data = formData(event);
    const result = await api.post("/api/admins", { email: data.email, name: data.name, role: data.role, password: data.password });
    if (report(result as never, "Admin created. Share the password with them through a safe channel.")) form.reset();
  }

  async function setRole(admin: Admin, role: string) {
    report((await api.patch(`/api/admins/${admin.id}`, { role })) as never, `${admin.email} is now ${role}.`);
  }

  async function toggle(admin: Admin) {
    const disabled = !admin.disabledAt;
    report((await api.patch(`/api/admins/${admin.id}`, { disabled })) as never, disabled ? `${admin.email} is disabled and signed out.` : `${admin.email} is enabled.`);
  }

  async function remove(admin: Admin) {
    if (!window.confirm(`Remove ${admin.email}? This cannot be undone.`)) return;
    report((await api.del(`/api/admins/${admin.id}`)) as never, `${admin.email} was removed.`);
  }

  async function revokeInvite(item: Invite) {
    report((await api.del(`/api/invites/${item.id}`)) as never, `Invite for ${item.email} revoked.`);
  }

  return (
    <>
      <Head>
        <title>Admins - Snapjaw</title>
      </Head>
      <PageHeader title="Admins" description="Owners have full control. Admins manage everything except owners. Viewers can read logs and status." />
      <Notice tone="good" hidden={!(Boolean(message()))}>{message()}</Notice>
      <Notice tone="bad" hidden={!(Boolean(error()))}>{error()}</Notice>
      <div hidden={!(Boolean(link()))}>
        <ValueBlock text={link()} label="Copy invite link" />
      </div>

      <Section title="Accounts">
        <Table label="Admin accounts">
          <thead>
            <tr><th>Email</th><th>Name</th><th>Role</th><th>2FA</th><th>Status</th><th>Last sign in</th><th class="actions"><span class="visually-hidden">Actions</span></th></tr>
          </thead>
          <tbody>
            {admins().map((admin) => (
              <tr key={admin.id}>
                <td class="mono">{admin.email}</td>
                <td>{admin.name ?? "-"}</td>
                <td>
                  <select aria-label={"Role for " + admin.email} hidden={!admin.manageable} value={admin.role} onChange={(event: Event) => setRole(admin, (event.currentTarget as HTMLSelectElement).value)}>
                    <option value="owner">owner</option>
                    <option value="admin">admin</option>
                    <option value="viewer">viewer</option>
                  </select>
                  <span hidden={Boolean(admin.manageable)}>{admin.role}</span>
                </td>
                <td><Status value={admin.twoFactorEnabled ? "on" : "off"} tone={admin.twoFactorEnabled ? "good" : "muted"} /></td>
                <td><Status value={admin.disabledAt ? "disabled" : "active"} /></td>
                <td title={formatDate(admin.lastLoginAt)}>{formatRelative(admin.lastLoginAt)}</td>
                <td class="actions">
                  <RowButton hidden={!admin.manageable} onClick={() => toggle(admin)}>{admin.disabledAt ? "Enable" : "Disable"}</RowButton>
                  <RowButton hidden={!admin.manageable} onClick={() => remove(admin)}>Remove</RowButton>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Section>

      <Section title="Open invites" description="Links that have not been used yet.">
        <Table label="Open invites">
          <thead>
            <tr><th>Email</th><th>Role</th><th>Expires</th><th class="actions"><span class="visually-hidden">Actions</span></th></tr>
          </thead>
          <tbody>
            {invites().map((item) => (
              <tr key={item.id}>
                <td class="mono">{item.email}</td>
                <td>{item.role}</td>
                <td>{formatDate(item.expiresAt)}</td>
                <td class="actions"><RowButton hidden={!item.manageable} onClick={() => revokeInvite(item)}>Revoke</RowButton></td>
              </tr>
            ))}
          </tbody>
        </Table>
        <Empty title="No open invites" hidden={!(invites().length === 0)}>Invite an admin below.</Empty>
      </Section>

      <Section title="Add an admin" hidden={!(canManage())}>
        <div class="tabs" role="tablist">
          <button type="button" role="tab" class="tab" aria-selected={mode() === "invite" ? "true" : "false"} onClick={() => setMode("invite")}>Invite link</button>
          <button type="button" role="tab" class="tab" aria-selected={mode() === "create" ? "true" : "false"} onClick={() => setMode("create")}>Create directly</button>
        </div>
        <form class="form" hidden={!(mode() === "invite")} onSubmit={(event: Event) => invite(event)}>
          <div class="form-row">
            <Field label="Email" for="invite-email">
              <Input id="invite-email" name="email" type="email" required />
            </Field>
            <Field label="Role" for="invite-role">
              <select id="invite-role" name="role">
                <option value="admin">admin</option>
                <option value="viewer">viewer</option>
                <option value="owner">owner</option>
              </select>
            </Field>
          </div>
          <div class="form-actions"><Button type="submit" variant="primary">Create invite link</Button></div>
        </form>
        <form class="form" hidden={!(mode() === "create")} onSubmit={(event: Event) => create(event)}>
          <div class="form-row">
            <Field label="Email" for="create-email">
              <Input id="create-email" name="email" type="email" required />
            </Field>
            <Field label="Name" for="create-name">
              <Input id="create-name" name="name" type="text" />
            </Field>
          </div>
          <div class="form-row">
            <Field label="Role" for="create-role">
              <select id="create-role" name="role">
                <option value="admin">admin</option>
                <option value="viewer">viewer</option>
                <option value="owner">owner</option>
              </select>
            </Field>
            <Field label="Temporary password" for="create-password" hint="At least 12 characters.">
              <Input id="create-password" name="password" type="password" autocomplete="new-password" required />
            </Field>
          </div>
          <div class="form-actions"><Button type="submit" variant="primary">Create admin</Button></div>
        </form>
      </Section>
    </>
  );
}
