import { createSignal, onMount } from "@krate/runtime";
import { Button } from "@krate/components";
import { PageHeader, Section } from "../../../../components/ui/page";
import { Notice } from "../../../../components/ui/form";
import { Table, Empty } from "../../../../components/ui/table";
import { Status } from "../../../../components/ui/status";
import { api, copyText, formatDate, queryParam } from "../../../../lib/client";

type DnsRecord = { record: string; name: string; type: string; ttl?: string; status?: string; value: string; priority?: number };
type Domain = { id: string; name: string; status: string; receiving: boolean; region: string | null; records: DnsRecord[]; checkedAt: string | null };

const help: Record<string, string> = {
  not_started: "Add the records below at your DNS provider, then press Re-check.",
  pending: "Resend is checking the records. DNS changes can take up to an hour to show up.",
  verified: "All records are in place. Mail can flow.",
  partially_verified: "One capability is verified. The other still waits for its records.",
  partially_failed: "One capability failed. Check the records marked failed.",
  failed: "Resend could not find the records within 72 hours. Fix them and press Re-check.",
  temporary_failure: "A record that was verified cannot be found right now. Check it is still published.",
};

export default function DomainView() {
  const [domain, setDomain] = createSignal<Domain | null>(null);
  const [message, setMessage] = createSignal("");
  const [error, setError] = createSignal("");
  const [busy, setBusy] = createSignal(false);

  async function load() {
    const result = await api.get<Domain>(`/api/domains/${encodeURIComponent(queryParam("id"))}`);
    if (result.ok) setDomain(result.data);
    else setError(result.error);
  }

  onMount(() => void load());

  async function recheck() {
    setBusy(true);
    const result = await api.post<{ status: string }>(`/api/domains/${domain()!.id}/verify`);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError("");
    setMessage(`Re-check started. Status: ${result.data.status.replace(/_/g, " ")}.`);
    await load();
  }

  async function remove() {
    const alsoResend = window.confirm(`Remove ${domain()!.name} from Snapjaw?\n\nPress OK to also delete it in Resend, or Cancel to keep it in Resend.`);
    if (!window.confirm(alsoResend ? "This deletes the domain in Resend too. Continue?" : "Remove it from Snapjaw only?")) return;
    const result = await api.del(`/api/domains/${domain()!.id}?resend=${alsoResend}`);
    if (!result.ok) setError(result.error);
    else window.location.href = "/domains";
  }

  async function copy(value: string) {
    setMessage((await copyText(value)) ? "Copied to the clipboard." : "Could not copy. Select the value and copy it by hand.");
  }

  return (
    <>
      <Head>
        <title>Domain - Snapjaw</title>
      </Head>
      <PageHeader title={domain()?.name ?? "Domain"} description={help[domain()?.status ?? ""] ?? ""}>
        <Button variant="primary" onClick={() => recheck()} disabled={busy() || !domain()}>{busy() ? "Checking" : "Re-check"}</Button>
        <Button variant="secondary" onClick={() => remove()} disabled={!domain()}>Remove</Button>
      </PageHeader>
      <Notice tone="good" hidden={!message()}>{message()}</Notice>
      <Notice tone="bad" hidden={!error()}>{error()}</Notice>
      <dl class="details" hidden={!domain()}>
        <dt>Status</dt>
        <dd><Status value={domain()?.status ?? "unknown"} /></dd>
        <dt>Receiving</dt>
        <dd>{domain()?.receiving ? "On. Resend accepts mail for this domain." : "Off"}</dd>
        <dt>Region</dt>
        <dd class="mono">{domain()?.region ?? "-"}</dd>
        <dt>Last checked</dt>
        <dd>{formatDate(domain()?.checkedAt)}</dd>
      </dl>
      <Section title="DNS records" description="Create these at your DNS provider. Names are relative to the domain unless they end with a dot.">
        <Table label="DNS records">
          <thead>
            <tr><th>Purpose</th><th>Type</th><th>Name</th><th>Value</th><th>Priority</th><th>Status</th></tr>
          </thead>
          <tbody>
            {(domain()?.records ?? []).map((r) => (
              <tr key={`${r.record}-${r.type}-${r.name}`}>
                <td>{r.record}</td>
                <td class="mono">{r.type}</td>
                <td class="mono">
                  <span class="value"><code>{r.name}</code><button type="button" class="copy" aria-label={`Copy name ${r.name}`} onClick={() => copy(r.name)}><Icon name="lucide:copy" /></button></span>
                </td>
                <td class="mono">
                  <span class="value"><code class="truncate" title={r.value}>{r.value}</code><button type="button" class="copy" aria-label="Copy value" onClick={() => copy(r.value)}><Icon name="lucide:copy" /></button></span>
                </td>
                <td class="mono">{r.priority ?? "-"}</td>
                <td><Status value={r.status ?? "unknown"} /></td>
              </tr>
            ))}
          </tbody>
        </Table>
        <Empty title="No records" hidden={(domain()?.records ?? []).length > 0}>Resend returned no records for this domain.</Empty>
        <p class="muted small">Receiving only works when the Resend MX record has the lowest priority value of all MX records on the name. If the domain already receives mail elsewhere, use a subdomain.</p>
      </Section>
    </>
  );
}
