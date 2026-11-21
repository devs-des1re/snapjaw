import { createSignal, onMount } from "@krate/runtime";
import { Button, Input } from "@krate/components";
import { PageHeader } from "../../../components/ui/page";
import { Field, Notice } from "../../../components/ui/form";
import { Table, Empty } from "../../../components/ui/table";
import { api, formatDate } from "../../../lib/client";

type Entry = {
  id: number;
  actorEmail: string | null;
  action: string;
  target: string | null;
  detail: Record<string, unknown> | null;
  ip: string | null;
  createdAt: string;
};

export default function Audit() {
  const [entries, setEntries] = createSignal<Entry[]>([]);
  const [next, setNext] = createSignal<number | null>(null);
  const [query, setQuery] = createSignal("");
  const [error, setError] = createSignal("");

  async function load(append = false) {
    const params = new URLSearchParams();
    if (query()) params.set("q", query());
    if (append && next()) params.set("before", String(next()));
    const result = await api.get<{ entries: Entry[]; next: number | null }>(`/api/audit?${params}`);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setEntries(append ? [...entries(), ...result.data.entries] : result.data.entries);
    setNext(result.data.entries.length >= 50 ? result.data.next : null);
  }

  onMount(() => void load());

  function search(event: Event) {
    event.preventDefault();
    void load();
  }

  return (
    <>
      <Head>
        <title>Audit log - Snapjaw</title>
      </Head>
      <PageHeader title="Audit log" description="Every admin action: who did it, what changed, when, and from where." />
      <Notice tone="bad" hidden={!(Boolean(error()))}>{error()}</Notice>
      <form class="toolbar" onSubmit={(event: Event) => search(event)}>
        <Field label="Search" for="audit-q">
          <Input id="audit-q" name="q" type="search" placeholder="Email, action or target" onInput={(event: Event) => setQuery((event.currentTarget as HTMLInputElement).value)} />
        </Field>
        <Button type="submit" variant="secondary">Search</Button>
      </form>
      <Table label="Audit log">
        <thead>
          <tr><th>Time</th><th>Actor</th><th>Action</th><th>Target</th><th>Detail</th><th>IP address</th></tr>
        </thead>
        <tbody>
          {entries().map((entry) => (
            <tr key={String(entry.id)}>
              <td class="nowrap">{formatDate(entry.createdAt)}</td>
              <td class="mono">{entry.actorEmail ?? "system"}</td>
              <td class="mono">{entry.action}</td>
              <td class="mono truncate" title={entry.target ?? ""}>{entry.target ?? "-"}</td>
              <td class="mono truncate small" title={entry.detail ? JSON.stringify(entry.detail) : ""}>{entry.detail ? JSON.stringify(entry.detail) : "-"}</td>
              <td class="mono">{entry.ip ?? "-"}</td>
            </tr>
          ))}
        </tbody>
      </Table>
      <Empty title="Nothing logged yet" hidden={!(entries().length === 0)}>Admin actions appear here as they happen.</Empty>
      <div class="pager" hidden={!(next() !== null)}>
        <span>Showing {entries().length} entries</span>
        <Button variant="secondary" size="sm" onClick={() => load(true)}>Load older</Button>
      </div>
    </>
  );
}
