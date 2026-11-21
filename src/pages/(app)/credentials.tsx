import { createEffect, createSignal, onMount } from "@krate/runtime";
import { Button, Input } from "@krate/components";
import { PageHeader, Section } from "../../../components/ui/page";
import { Field, Notice } from "../../../components/ui/form";
import { Table, Empty } from "../../../components/ui/table";
import { Status } from "../../../components/ui/status";
import { RowButton } from "../../../components/ui/button";
import { ValueBlock } from "../../../components/ui/copy";
import { api, fillForm, formData, formatDate, formatRelative } from "../../../lib/client";

type Credential = { id: string; name: string; username: string; allowedSenders: string[]; ratePerHour: number; lastUsedAt: string | null; revokedAt: string | null; createdAt: string };
type ApiKey = { id: string; name: string; prefix: string; allowedSenders: string[]; ratePerHour: number; lastUsedAt: string | null; revokedAt: string | null; createdAt: string };
type Server = { hostname: string; submissionPort: number; smtpsPort: number };
type Edit = { kind: "smtp" | "api"; id: string; name: string; senders: string; rate: number };

export default function Credentials() {
  const [credentials, setCredentials] = createSignal<Credential[]>([]);
  const [keys, setKeys] = createSignal<ApiKey[]>([]);
  const [server, setServer] = createSignal<Server | null>(null);
  const [secret, setSecret] = createSignal<{ title: string; lines: string } | null>(null);
  const [edit, setEdit] = createSignal<Edit | null>(null);
  const [message, setMessage] = createSignal("");
  const [error, setError] = createSignal("");
  const [tab, setTab] = createSignal<"smtp" | "api">("smtp");

  async function load() {
    const [smtp, api_] = await Promise.all([api.get<{ credentials: Credential[]; server: Server }>("/api/credentials/smtp"), api.get<ApiKey[]>("/api/credentials/keys")]);
    if (smtp.ok) {
      setCredentials(smtp.data.credentials);
      setServer(smtp.data.server);
    } else setError(smtp.error);
    if (api_.ok) setKeys(api_.data);
  }

  onMount(() => void load());

  createEffect(() => {
    const current = edit();
    if (!current) return;
    queueMicrotask(() => {
      const form = document.getElementById("edit-form");
      if (form) fillForm(form, { name: current.name, senders: current.senders, rate: current.rate });
      form?.scrollIntoView({ block: "start" });
    });
  });

  function done(text: string) {
    setError("");
    setMessage(text);
    void load();
  }

  async function createSmtp(event: Event) {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const data = formData(event);
    const result = await api.post<{ username: string; password: string }>("/api/credentials/smtp", { name: data.name, username: data.username, allowedSenders: data.senders, ratePerHour: data.rate });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    form.reset();
    setSecret({ title: "SMTP credential created. Copy the password now. It is not shown again.", lines: `Server: ${server()?.hostname}\nPort: 587 (STARTTLS) or 465 (SSL)\nUsername: ${result.data.username}\nPassword: ${result.data.password}` });
    done("Credential created.");
  }

  async function createKey(event: Event) {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const data = formData(event);
    const result = await api.post<{ key: string }>("/api/credentials/keys", { name: data.name, allowedSenders: data.senders, ratePerHour: data.rate });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    form.reset();
    setSecret({ title: "API key created. Copy it now. It is not shown again.", lines: result.data.key });
    done("API key created.");
  }

  async function rotate(item: Credential) {
    if (!window.confirm(`Create a new password for ${item.username}? The old one stops working right away.`)) return;
    const result = await api.post<{ username: string; password: string }>(`/api/credentials/smtp/${item.id}/rotate`);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setSecret({ title: "New password created. Update every client that uses it.", lines: `Username: ${result.data.username}\nPassword: ${result.data.password}` });
    done("Password rotated.");
  }

  async function revoke(kind: "smtp" | "api", id: string, label: string) {
    if (!window.confirm(`Revoke ${label}? Clients using it are refused from now on.`)) return;
    const result = await api.del(kind === "smtp" ? `/api/credentials/smtp/${id}` : `/api/credentials/keys/${id}`);
    if (!result.ok) setError(result.error);
    else done(`${label} revoked.`);
  }

  async function saveEdit(event: Event) {
    event.preventDefault();
    const current = edit();
    if (!current) return;
    const data = formData(event);
    const path = current.kind === "smtp" ? `/api/credentials/smtp/${current.id}` : `/api/credentials/keys/${current.id}`;
    const result = await api.patch(path, { name: data.name, allowedSenders: data.senders, ratePerHour: data.rate });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setEdit(null);
    done("Saved.");
  }

  return (
    <>
      <Head>
        <title>Credentials - Snapjaw</title>
      </Head>
      <PageHeader title="Credentials" description="SMTP logins and API keys belong to this Snapjaw, not to a person. Each one may only send as its allowed senders." />
      <Notice tone="good" hidden={!message()}>{message()}</Notice>
      <Notice tone="bad" hidden={!error()}>{error()}</Notice>
      <div class="section" hidden={!secret()}>
        <Notice tone="warn">{secret()?.title}</Notice>
        <ValueBlock text={secret()?.lines ?? ""} label="Copy" />
      </div>

      <dl class="details">
        <dt>SMTP server</dt>
        <dd class="mono">{server()?.hostname ?? "-"}</dd>
        <dt>Ports</dt>
        <dd>587 with STARTTLS, or 465 with SSL/TLS. Login is refused without TLS.</dd>
        <dt>Authentication</dt>
        <dd>PLAIN or LOGIN with a credential below</dd>
      </dl>

      <div class="tabs" role="tablist">
        <button type="button" role="tab" class="tab" aria-selected={tab() === "smtp" ? "true" : "false"} onClick={() => setTab("smtp")}>SMTP logins</button>
        <button type="button" role="tab" class="tab" aria-selected={tab() === "api" ? "true" : "false"} onClick={() => setTab("api")}>API keys</button>
      </div>

      <div class="section" hidden={tab() !== "smtp"}>
        <Table label="SMTP logins">
          <thead>
            <tr><th>Name</th><th>Username</th><th>Allowed senders</th><th class="num">Per hour</th><th>Last used</th><th>Status</th><th class="actions"><span class="visually-hidden">Actions</span></th></tr>
          </thead>
          <tbody>
            {credentials().map((c) => (
              <tr key={c.id}>
                <td>{c.name}</td>
                <td class="mono">{c.username}</td>
                <td class="mono truncate small" title={c.allowedSenders.join(", ")}>{c.allowedSenders.join(", ")}</td>
                <td class="num">{c.ratePerHour || "no limit"}</td>
                <td class="nowrap" title={formatDate(c.lastUsedAt)}>{formatRelative(c.lastUsedAt)}</td>
                <td><Status value={c.revokedAt ? "revoked" : "active"} /></td>
                <td class="actions">
                  <RowButton hidden={Boolean(c.revokedAt)} onClick={() => setEdit({ kind: "smtp", id: c.id, name: c.name, senders: c.allowedSenders.join(", "), rate: c.ratePerHour })}>Edit</RowButton>
                  <RowButton hidden={Boolean(c.revokedAt)} onClick={() => rotate(c)}>Rotate</RowButton>
                  <RowButton hidden={Boolean(c.revokedAt)} onClick={() => revoke("smtp", c.id, c.username)}>Revoke</RowButton>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
        <Empty title="No SMTP logins" hidden={credentials().length > 0}>Create one for Gmail's Send mail as, or for any app that speaks SMTP.</Empty>
        <Section title="New SMTP login">
          <form class="form" onSubmit={(event: Event) => createSmtp(event)}>
            <div class="form-row">
              <Field label="Name" for="smtp-name">
                <Input id="smtp-name" name="name" type="text" placeholder="Gmail send-as" />
              </Field>
              <Field label="Username" for="smtp-username" hint="Leave empty to generate one.">
                <Input id="smtp-username" name="username" type="text" class="mono" />
              </Field>
            </div>
            <Field label="Allowed senders" for="smtp-senders" hint="Addresses or @domains, separated by commas. Anything else is refused.">
              <Input id="smtp-senders" name="senders" type="text" placeholder="hello@example.com, @team.example.com" required class="mono" />
            </Field>
            <Field label="Recipients per hour" for="smtp-rate" hint="0 means no limit.">
              <Input id="smtp-rate" name="rate" type="number" defaultValue="100" />
            </Field>
            <div class="form-actions"><Button type="submit" variant="primary">Create login</Button></div>
          </form>
        </Section>
      </div>

      <div class="section" hidden={tab() !== "api"}>
        <p class="muted small">API keys work with POST /api/emails, which accepts the same JSON as Resend's POST /emails. Point an app at this Snapjaw's address instead of api.resend.com.</p>
        <Table label="API keys">
          <thead>
            <tr><th>Name</th><th>Prefix</th><th>Allowed senders</th><th class="num">Per hour</th><th>Last used</th><th>Status</th><th class="actions"><span class="visually-hidden">Actions</span></th></tr>
          </thead>
          <tbody>
            {keys().map((k) => (
              <tr key={k.id}>
                <td>{k.name}</td>
                <td class="mono">sj_{k.prefix}_...</td>
                <td class="mono truncate small" title={k.allowedSenders.join(", ")}>{k.allowedSenders.join(", ")}</td>
                <td class="num">{k.ratePerHour || "no limit"}</td>
                <td class="nowrap">{formatRelative(k.lastUsedAt)}</td>
                <td><Status value={k.revokedAt ? "revoked" : "active"} /></td>
                <td class="actions">
                  <RowButton hidden={Boolean(k.revokedAt)} onClick={() => setEdit({ kind: "api", id: k.id, name: k.name, senders: k.allowedSenders.join(", "), rate: k.ratePerHour })}>Edit</RowButton>
                  <RowButton hidden={Boolean(k.revokedAt)} onClick={() => revoke("api", k.id, k.name)}>Revoke</RowButton>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
        <Empty title="No API keys" hidden={keys().length > 0}>Create one for apps that use the Resend API.</Empty>
        <Section title="New API key">
          <form class="form" onSubmit={(event: Event) => createKey(event)}>
            <Field label="Name" for="key-name">
              <Input id="key-name" name="name" type="text" placeholder="Billing app" />
            </Field>
            <Field label="Allowed senders" for="key-senders" hint="Addresses or @domains, separated by commas.">
              <Input id="key-senders" name="senders" type="text" placeholder="billing@example.com" required class="mono" />
            </Field>
            <Field label="Recipients per hour" for="key-rate" hint="0 means no limit.">
              <Input id="key-rate" name="rate" type="number" defaultValue="100" />
            </Field>
            <div class="form-actions"><Button type="submit" variant="primary">Create key</Button></div>
          </form>
        </Section>
      </div>

      <Section title={`Edit ${edit()?.name ?? ""}`} hidden={!edit()}>
        <form class="form" id="edit-form" onSubmit={(event: Event) => saveEdit(event)}>
          <Field label="Name" for="edit-name">
            <input id="edit-name" name="name" type="text" />
          </Field>
          <Field label="Allowed senders" for="edit-senders">
            <input id="edit-senders" name="senders" type="text" class="mono" required />
          </Field>
          <Field label="Recipients per hour" for="edit-rate">
            <input id="edit-rate" name="rate" type="number" />
          </Field>
          <div class="form-actions">
            <Button type="submit" variant="primary">Save</Button>
            <Button type="button" variant="ghost" onClick={() => setEdit(null)}>Cancel</Button>
          </div>
        </form>
      </Section>
    </>
  );
}
