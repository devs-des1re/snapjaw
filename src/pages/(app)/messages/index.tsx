import { createSignal, onMount } from "@krate/runtime";
import { Button } from "@krate/components";
import { PageHeader } from "../../../../components/ui/page";
import { Field, Notice } from "../../../../components/ui/form";
import { Table, Empty } from "../../../../components/ui/table";
import { Status } from "../../../../components/ui/status";
import { api, formatBytes, formatDate } from "../../../../lib/client";

type Message = { id: string; direction: string; fromAddress: string; toAddresses: string[]; subject: string | null; size: number; status: string; error: string | null; createdAt: string };

const statuses = ["", "queued", "held", "sent", "delivered", "delivery_delayed", "bounced", "complained", "failed", "rejected", "partial", "received", "suppressed"];

export default function Messages() {
  const [messages, setMessages] = createSignal<Message[]>([]);
  const [next, setNext] = createSignal<string | null>(null);
  const [error, setError] = createSignal("");
  const [filters, setFilters] = createSignal<Record<string, string>>({});

  async function load(append = false) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(filters())) if (value) params.set(key, value);
    if (append && next()) params.set("before", next()!);
    const result = await api.get<{ messages: Message[]; next: string | null }>(`/api/messages?${params}`);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError("");
    setMessages(append ? [...messages(), ...result.data.messages] : result.data.messages);
    setNext(result.data.next);
  }

  onMount(() => {
    const params = new URLSearchParams(window.location.search);
    const initial: Record<string, string> = {};
    for (const key of ["direction", "status", "q", "from", "to"]) if (params.get(key)) initial[key] = params.get(key)!;
    setFilters(initial);
    for (const [key, value] of Object.entries(initial)) {
      const input = document.querySelector<HTMLInputElement | HTMLSelectElement>(`[name="${key}"]`);
      if (input) input.value = value;
    }
    void load();
  });

  function apply(event: Event) {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const values: Record<string, string> = {};
    new FormData(form).forEach((value, key) => {
      if (typeof value === "string" && value) values[key] = value;
    });
    setFilters(values);
    const query = new URLSearchParams(values).toString();
    history.replaceState(null, "", query ? `?${query}` : window.location.pathname);
    void load();
  }

  return (
    <>
      <Head>
        <title>Messages - Snapjaw</title>
      </Head>
      <PageHeader title="Messages" description="Every message Snapjaw handled. Metadata only: bodies are never logged." />
      <Notice tone="bad" hidden={!error()}>{error()}</Notice>
      <form class="toolbar" onSubmit={(event: Event) => apply(event)}>
        <Field label="Search" for="msg-q">
          <input id="msg-q" name="q" type="search" placeholder="Address, subject or ID" />
        </Field>
        <Field label="Direction" for="msg-direction">
          <select id="msg-direction" name="direction">
            <option value="">Both</option>
            <option value="outbound">Outbound</option>
            <option value="inbound">Inbound</option>
          </select>
        </Field>
        <Field label="Status" for="msg-status">
          <select id="msg-status" name="status">
            {statuses.map((s) => <option key={s || "any"} value={s}>{s ? s.replace(/_/g, " ") : "Any"}</option>)}
          </select>
        </Field>
        <Field label="From date" for="msg-from">
          <input id="msg-from" name="from" type="date" />
        </Field>
        <Field label="To date" for="msg-to">
          <input id="msg-to" name="to" type="date" />
        </Field>
        <Button type="submit" variant="secondary">Filter</Button>
      </form>
      <Table label="Messages">
        <thead>
          <tr><th>Time</th><th>Dir</th><th>From</th><th>To</th><th>Subject</th><th class="num">Size</th><th>Status</th></tr>
        </thead>
        <tbody>
          {messages().map((m) => (
            <tr key={m.id}>
              <td class="nowrap"><a href={`/messages/view?id=${m.id}`}>{formatDate(m.createdAt)}</a></td>
              <td>{m.direction === "outbound" ? "out" : "in"}</td>
              <td class="mono truncate small" title={m.fromAddress}>{m.fromAddress}</td>
              <td class="mono truncate small" title={m.toAddresses.join(", ")}>{m.toAddresses.join(", ")}</td>
              <td class="truncate" title={m.subject ?? ""}>{m.subject ?? "(no subject)"}</td>
              <td class="num">{formatBytes(m.size)}</td>
              <td title={m.error ?? ""}><Status value={m.status} /></td>
            </tr>
          ))}
        </tbody>
      </Table>
      <Empty title="No messages" hidden={messages().length > 0}>Nothing matches these filters yet.</Empty>
      <div class="pager" hidden={!next()}>
        <span>Showing {messages().length}</span>
        <Button variant="secondary" size="sm" onClick={() => load(true)}>Load older</Button>
      </div>
    </>
  );
}
