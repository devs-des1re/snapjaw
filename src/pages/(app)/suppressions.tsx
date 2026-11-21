import { createSignal, onMount } from "@krate/runtime";
import { Button, Input } from "@krate/components";
import { PageHeader, Section } from "../../../components/ui/page";
import { Field, Notice } from "../../../components/ui/form";
import { Table, Empty } from "../../../components/ui/table";
import { Status } from "../../../components/ui/status";
import { RowButton } from "../../../components/ui/button";
import { api, formData, formatDate } from "../../../lib/client";

type Suppression = { email: string; reason: string; detail: string | null; source: string | null; createdAt: string };

export default function Suppressions() {
  const [items, setItems] = createSignal<Suppression[]>([]);
  const [query, setQuery] = createSignal("");
  const [message, setMessage] = createSignal("");
  const [error, setError] = createSignal("");

  async function load() {
    const result = await api.get<Suppression[]>(`/api/suppressions?q=${encodeURIComponent(query())}`);
    if (result.ok) setItems(result.data);
    else setError(result.error);
  }

  onMount(() => void load());

  async function add(event: Event) {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const data = formData(event);
    const result = await api.post("/api/suppressions", { email: data.email, detail: data.detail });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    form.reset();
    setError("");
    setMessage(`${data.email} is suppressed.`);
    void load();
  }

  async function remove(item: Suppression) {
    if (!window.confirm(`Remove ${item.email} from the suppression list? Snapjaw will send to it again.`)) return;
    const result = await api.del(`/api/suppressions/${encodeURIComponent(item.email)}`);
    if (!result.ok) setError(result.error);
    else {
      setMessage(`${item.email} removed.`);
      void load();
    }
  }

  return (
    <>
      <Head>
        <title>Suppressions - Snapjaw</title>
      </Head>
      <PageHeader title="Suppressions" description="Addresses Snapjaw refuses to send to. Permanent bounces and spam complaints from Resend are added automatically." />
      <Notice tone="good" hidden={!message()}>{message()}</Notice>
      <Notice tone="bad" hidden={!error()}>{error()}</Notice>
      <form class="toolbar" onSubmit={(event: Event) => { event.preventDefault(); void load(); }}>
        <Field label="Search" for="sup-q">
          <input id="sup-q" type="search" placeholder="Address" onInput={(event: Event) => setQuery((event.currentTarget as HTMLInputElement).value)} />
        </Field>
        <Button type="submit" variant="secondary">Search</Button>
      </form>
      <Table label="Suppressed addresses">
        <thead>
          <tr><th>Address</th><th>Reason</th><th>Detail</th><th>Added</th><th class="actions"><span class="visually-hidden">Actions</span></th></tr>
        </thead>
        <tbody>
          {items().map((item) => (
            <tr key={item.email}>
              <td class="mono">{item.email}</td>
              <td><Status value={item.reason} tone={item.reason === "manual" ? "neutral" : "bad"} /></td>
              <td class="truncate small" title={item.detail ?? ""}>{item.detail ?? "-"}</td>
              <td class="nowrap">{formatDate(item.createdAt)}</td>
              <td class="actions"><RowButton onClick={() => remove(item)}>Remove</RowButton></td>
            </tr>
          ))}
        </tbody>
      </Table>
      <Empty title="Nobody is suppressed" hidden={items().length > 0}>Bounces and complaints show up here.</Empty>
      <Section title="Suppress an address">
        <form class="form" onSubmit={(event: Event) => add(event)}>
          <div class="form-row">
            <Field label="Address" for="sup-email">
              <Input id="sup-email" name="email" type="email" required />
            </Field>
            <Field label="Note" for="sup-detail">
              <Input id="sup-detail" name="detail" type="text" placeholder="Asked to stop" />
            </Field>
          </div>
          <div class="form-actions"><Button type="submit" variant="primary">Suppress</Button></div>
        </form>
      </Section>
    </>
  );
}
