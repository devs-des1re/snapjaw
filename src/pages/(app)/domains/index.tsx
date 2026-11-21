import { createSignal, onMount } from "@krate/runtime";
import { Button, Input } from "@krate/components";
import { PageHeader, Section } from "../../../../components/ui/page";
import { Field, Notice } from "../../../../components/ui/form";
import { Table, Empty } from "../../../../components/ui/table";
import { Status } from "../../../../components/ui/status";
import { api, formData, formatRelative } from "../../../../lib/client";

type Domain = { id: string; name: string; status: string; receiving: boolean; sending: boolean; region: string | null; records: unknown[]; checkedAt: string | null };

export default function Domains() {
  const [domains, setDomains] = createSignal<Domain[]>([]);
  const [error, setError] = createSignal("");
  const [busy, setBusy] = createSignal(false);

  async function load() {
    const result = await api.get<Domain[]>("/api/domains");
    if (result.ok) setDomains(result.data);
    else setError(result.error);
  }

  onMount(() => void load());

  async function add(event: Event) {
    event.preventDefault();
    const data = formData(event);
    setBusy(true);
    setError("");
    const result = await api.post<{ id: string }>("/api/domains", { name: data.name, receiving: data.receiving === "on", region: data.region });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    window.location.href = `/domains/view?id=${result.data.id}`;
  }

  return (
    <>
      <Head>
        <title>Domains - Snapjaw</title>
      </Head>
      <PageHeader title="Domains" description="Domains Snapjaw sends from and receives for. Each one is created in Resend and needs DNS records at your DNS provider." />
      <Notice tone="bad" hidden={!error()}>{error()}</Notice>
      <Table label="Domains">
        <thead>
          <tr><th>Domain</th><th>Status</th><th>Sending</th><th>Receiving</th><th>Region</th><th>Checked</th></tr>
        </thead>
        <tbody>
          {domains().map((d) => (
            <tr key={d.id}>
              <td class="mono"><a href={`/domains/view?id=${d.id}`}>{d.name}</a></td>
              <td><Status value={d.status} /></td>
              <td>{d.sending ? "on" : "off"}</td>
              <td>{d.receiving ? "on" : "off"}</td>
              <td class="mono">{d.region ?? "-"}</td>
              <td class="nowrap">{formatRelative(d.checkedAt)}</td>
            </tr>
          ))}
        </tbody>
      </Table>
      <Empty title="No domains yet" hidden={domains().length > 0}>Add the domain you want to send from and receive mail for.</Empty>

      <Section title="Add a domain" description="If the domain already exists in your Resend account, Snapjaw links to it instead of creating a second one.">
        <form class="form" onSubmit={(event: Event) => add(event)}>
          <div class="form-row">
            <Field label="Domain" for="domain-name" hint="Use a subdomain such as mail.example.com if example.com already has MX records.">
              <Input id="domain-name" name="name" type="text" placeholder="example.com" required class="mono" />
            </Field>
            <Field label="Region" for="domain-region">
              <select id="domain-region" name="region">
                <option value="us-east-1">us-east-1</option>
                <option value="eu-west-1">eu-west-1</option>
                <option value="sa-east-1">sa-east-1</option>
                <option value="ap-northeast-1">ap-northeast-1</option>
              </select>
            </Field>
          </div>
          <label class="checkbox-row"><input type="checkbox" name="receiving" defaultChecked /> Receive mail for this domain (adds an MX record)</label>
          <div class="form-actions"><Button type="submit" variant="primary" disabled={busy()}>{busy() ? "Adding" : "Add domain"}</Button></div>
        </form>
      </Section>
    </>
  );
}
