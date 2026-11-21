import { createSignal, onMount } from "@krate/runtime";
import { Button, Input } from "@krate/components";
import { PageHeader, Section } from "../../../components/ui/page";
import { Field, Notice } from "../../../components/ui/form";
import { Table, Empty } from "../../../components/ui/table";
import { Status } from "../../../components/ui/status";
import { RowButton } from "../../../components/ui/button";
import { api, formData, formatRelative } from "../../../lib/client";

type Destination = { id: string; name: string; type: string; health: string; lastError: string | null; lastCheckedAt: string | null; summary: string; connected: boolean; needsConnect?: boolean };
type Gmail = { redirectUri: string; configured: boolean };

const gmailMessages: Record<string, string> = {
  connected: "Gmail connected. Press Test to check it.",
  denied: "Google sign-in was cancelled.",
  expired: "The Google sign-in took too long or was started by another admin. Try again.",
  failed: "Google refused the connection. Check the client ID, secret and redirect URI under Settings.",
  missing: "That destination no longer exists.",
  signin: "Sign in to Snapjaw first, then connect Gmail again.",
};

export default function Destinations() {
  const [items, setItems] = createSignal<Destination[]>([]);
  const [gmail, setGmail] = createSignal<Gmail | null>(null);
  const [type, setType] = createSignal<"imap" | "gmail" | "forward">("imap");
  const [message, setMessage] = createSignal("");
  const [error, setError] = createSignal("");

  async function load() {
    const result = await api.get<{ destinations: Destination[]; gmail: Gmail }>("/api/destinations");
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setItems(result.data.destinations.map((d) => ({ ...d, needsConnect: d.type === "gmail" })));
    setGmail(result.data.gmail);
  }

  onMount(() => {
    const status = new URLSearchParams(window.location.search).get("gmail");
    if (status) {
      if (status === "connected") setMessage(gmailMessages[status]!);
      else setError(gmailMessages[status] ?? "Gmail connection failed.");
      history.replaceState(null, "", window.location.pathname);
    }
    void load();
  });

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

  async function create(event: Event) {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const data = formData(event);
    const body: Record<string, unknown> = { type: type(), name: data.name };
    if (type() === "imap") Object.assign(body, { host: data.host, port: Number(data.port), secure: data.secure === "on", username: data.username, password: data.password, mailbox: data.mailbox });
    if (type() === "forward") Object.assign(body, { address: data.address, from: data.from });
    if (type() === "gmail") Object.assign(body, { email: data.email, labelIds: data.unread === "on" ? ["INBOX", "UNREAD"] : ["INBOX"] });
    const result = await api.post<{ id: string }>("/api/destinations", body);
    if (!report(result as never, "Destination created.")) return;
    form.reset();
    if (type() === "gmail" && result.ok) await connect(result.data.id);
  }

  async function connect(id: string) {
    const result = await api.post<{ url: string }>(`/api/destinations/${id}/connect`);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    window.location.href = result.data.url;
  }

  async function test(item: Destination) {
    setMessage(`Testing ${item.name}...`);
    const result = await api.post<{ message: string }>(`/api/destinations/${item.id}/test`);
    report(result as never, result.ok ? result.data.message : "");
  }

  async function remove(item: Destination) {
    if (!window.confirm(`Delete ${item.name}?`)) return;
    report((await api.del(`/api/destinations/${item.id}`)) as never, `${item.name} deleted.`);
  }

  async function editPassword(item: Destination) {
    const password = window.prompt(`New IMAP password for ${item.name}`);
    if (!password) return;
    report((await api.patch(`/api/destinations/${item.id}`, { password })) as never, "Password updated.");
  }

  return (
    <>
      <Head>
        <title>Destinations - Snapjaw</title>
      </Head>
      <PageHeader title="Destinations" description="Mailboxes that received mail is delivered to. Gmail import keeps the original sender. IMAP works with any provider. Forwarding is the fallback." />
      <Notice tone="good" hidden={!message()}>{message()}</Notice>
      <Notice tone="bad" hidden={!error()}>{error()}</Notice>
      <Table label="Destinations">
        <thead>
          <tr><th>Name</th><th>Type</th><th>Target</th><th>Health</th><th>Checked</th><th class="actions"><span class="visually-hidden">Actions</span></th></tr>
        </thead>
        <tbody>
          {items().map((item) => (
            <tr key={item.id}>
              <td>{item.name}</td>
              <td>{item.type}</td>
              <td class="mono truncate small" title={item.summary}>{item.summary}</td>
              <td title={item.lastError ?? ""}><Status value={item.health} /></td>
              <td class="nowrap">{formatRelative(item.lastCheckedAt)}</td>
              <td class="actions">
                <RowButton hidden={!item.needsConnect} onClick={() => connect(item.id)}>{item.connected ? "Reconnect" : "Connect"}</RowButton>
                <RowButton hidden={item.type !== "imap"} onClick={() => editPassword(item)}>Password</RowButton>
                <RowButton onClick={() => test(item)}>Test</RowButton>
                <RowButton onClick={() => remove(item)}>Delete</RowButton>
              </td>
            </tr>
          ))}
        </tbody>
      </Table>
      <Empty title="No destinations" hidden={items().length > 0}>Add a mailbox to deliver received mail to.</Empty>

      <Section title="New destination">
        <div class="tabs" role="tablist">
          <button type="button" role="tab" class="tab" aria-selected={type() === "imap" ? "true" : "false"} onClick={() => setType("imap")}>IMAP</button>
          <button type="button" role="tab" class="tab" aria-selected={type() === "gmail" ? "true" : "false"} onClick={() => setType("gmail")}>Gmail API</button>
          <button type="button" role="tab" class="tab" aria-selected={type() === "forward" ? "true" : "false"} onClick={() => setType("forward")}>Forward via Resend</button>
        </div>
        <Notice tone="warn" title="Forwarding is the last resort" hidden={type() !== "forward"}>
          The sender is rewritten to your forwarding address, the original sender goes in Reply-To, and every forward costs one more email against the Resend quota. Prefer Gmail API or IMAP.
        </Notice>
        <Notice tone="warn" title="Set up Google first" hidden={type() !== "gmail" || Boolean(gmail()?.configured)}>
          Add a Google OAuth client ID and secret under Settings, with this redirect URI: {gmail()?.redirectUri ?? ""}
        </Notice>
        <form class="form" onSubmit={(event: Event) => create(event)}>
          <Field label="Name" for="dst-name">
            <Input id="dst-name" name="name" type="text" required placeholder="My inbox" />
          </Field>
          <div class="section" hidden={type() !== "imap"}>
            <div class="form-row">
              <Field label="IMAP server" for="dst-host" hint="Gmail: imap.gmail.com">
                <input id="dst-host" name="host" type="text" class="mono" placeholder="imap.gmail.com" />
              </Field>
              <Field label="Port" for="dst-port">
                <input id="dst-port" name="port" type="number" defaultValue="993" />
              </Field>
            </div>
            <label class="checkbox-row"><input type="checkbox" name="secure" defaultChecked /> Connect with TLS (port 993)</label>
            <div class="form-row">
              <Field label="Username" for="dst-user">
                <input id="dst-user" name="username" type="text" autocomplete="off" />
              </Field>
              <Field label="Password" for="dst-pass" hint="Gmail needs an app password.">
                <input id="dst-pass" name="password" type="password" autocomplete="new-password" />
              </Field>
            </div>
            <Field label="Mailbox" for="dst-mailbox">
              <input id="dst-mailbox" name="mailbox" type="text" defaultValue="INBOX" />
            </Field>
          </div>
          <div class="section" hidden={type() !== "gmail"}>
            <Field label="Gmail address" for="dst-gmail" hint="Used as a hint on Google's sign-in page.">
              <input id="dst-gmail" name="email" type="email" />
            </Field>
            <label class="checkbox-row"><input type="checkbox" name="unread" defaultChecked /> Mark imported mail as unread</label>
          </div>
          <div class="section" hidden={type() !== "forward"}>
            <div class="form-row">
              <Field label="Forward to" for="dst-address">
                <input id="dst-address" name="address" type="email" />
              </Field>
              <Field label="Forward from" for="dst-from" hint="An address on a verified Snapjaw domain.">
                <input id="dst-from" name="from" type="email" placeholder="forwarder@example.com" />
              </Field>
            </div>
          </div>
          <div class="form-actions">
            <Button type="submit" variant="primary">{type() === "gmail" ? "Create and connect Gmail" : "Create destination"}</Button>
          </div>
        </form>
      </Section>
    </>
  );
}
