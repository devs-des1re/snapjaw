import { createSignal, onMount } from "@krate/runtime";
import { Button } from "@krate/components";
import { PageHeader, Section } from "../../../../components/ui/page";
import { Notice } from "../../../../components/ui/form";
import { Table, Empty } from "../../../../components/ui/table";
import { Status } from "../../../../components/ui/status";
import { Value } from "../../../../components/ui/copy";
import { api, formatBytes, formatDate, queryParam } from "../../../../lib/client";

type Message = { id: string; direction: string; resendId: string | null; messageId: string | null; fromAddress: string; toAddresses: string[]; subject: string | null; size: number; recipients: number; status: string; error: string | null; source: string | null; createdAt: string; updatedAt: string };
type Event = { id: number; status: string; detail: string | null; createdAt: string };
type Delivery = { id: string; destinationId: string; recipient: string; state: string; attempts: number; error: string | null; updatedAt: string };
type Job = { id: string; kind: string; state: string; attempts: number; maxAttempts: number; runAt: string; lastError: string | null };
type Detail = { message: Message; events: Event[]; deliveries: Delivery[]; jobs: Job[]; help: { summary: string; fix: string | null } };

export default function MessageView() {
  const [detail, setDetail] = createSignal<Detail | null>(null);
  const [error, setError] = createSignal("");
  const [message, setMessage] = createSignal("");

  async function load() {
    const result = await api.get<Detail>(`/api/messages/${encodeURIComponent(queryParam("id"))}`);
    if (result.ok) setDetail(result.data);
    else setError(result.error);
  }

  onMount(() => void load());

  async function retry() {
    const result = await api.post(`/api/messages/${detail()!.message.id}/retry`);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setMessage("Retry queued.");
    await load();
  }

  return (
    <>
      <Head>
        <title>Message - Snapjaw</title>
      </Head>
      <PageHeader title={detail()?.message.subject ?? "Message"} description={detail()?.help.summary ?? ""}>
        <Button variant="secondary" onClick={() => retry()} disabled={!["failed", "partial"].includes(detail()?.message.status ?? "")}>Retry</Button>
      </PageHeader>
      <Notice tone="good" hidden={!message()}>{message()}</Notice>
      <Notice tone="bad" hidden={!error()}>{error()}</Notice>
      <Notice tone="bad" title="What went wrong" hidden={!detail()?.message.error}>
        {detail()?.message.error}
      </Notice>
      <Notice tone="info" title="Suggested fix" hidden={!detail()?.help.fix}>
        {detail()?.help.fix}
      </Notice>
      <dl class="details" hidden={!detail()}>
        <dt>Status</dt>
        <dd><Status value={detail()?.message.status ?? "unknown"} /></dd>
        <dt>Direction</dt>
        <dd>{detail()?.message.direction} via {detail()?.message.source ?? "-"}</dd>
        <dt>From</dt>
        <dd class="mono">{detail()?.message.fromAddress}</dd>
        <dt>To</dt>
        <dd class="mono">{detail()?.message.toAddresses.join(", ")}</dd>
        <dt>Size</dt>
        <dd>{formatBytes(detail()?.message.size)} for {detail()?.message.recipients} recipient(s)</dd>
        <dt>Snapjaw ID</dt>
        <dd><Value text={detail()?.message.id ?? ""} /></dd>
        <dt>Resend ID</dt>
        <dd><Value text={detail()?.message.resendId ?? "-"} /></dd>
        <dt>Message-ID</dt>
        <dd><Value text={detail()?.message.messageId ?? "-"} /></dd>
        <dt>Created</dt>
        <dd>{formatDate(detail()?.message.createdAt)}</dd>
      </dl>

      <Section title="Lifecycle">
        <ol class="timeline">
          {(detail()?.events ?? []).map((e) => (
            <li key={String(e.id)}>
              <strong>{e.status.replace(/_/g, " ")}</strong> <span class="muted">{formatDate(e.createdAt)}</span>
              <div class="small muted">{e.detail ?? ""}</div>
            </li>
          ))}
        </ol>
      </Section>

      <Section title="Deliveries" description="One per destination. A failure in one does not hold up the others." hidden={(detail()?.deliveries ?? []).length === 0}>
        <Table label="Deliveries">
          <thead>
            <tr><th>Recipient</th><th>Destination</th><th>State</th><th class="num">Attempts</th><th>Error</th></tr>
          </thead>
          <tbody>
            {(detail()?.deliveries ?? []).map((d) => (
              <tr key={d.id}>
                <td class="mono">{d.recipient}</td>
                <td class="mono small">{d.destinationId}</td>
                <td><Status value={d.state} /></td>
                <td class="num">{d.attempts}</td>
                <td class="truncate small" title={d.error ?? ""}>{d.error ?? "-"}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Section>

      <Section title="Queue jobs">
        <Table label="Queue jobs">
          <thead>
            <tr><th>Kind</th><th>State</th><th class="num">Attempts</th><th>Next run</th><th>Last error</th></tr>
          </thead>
          <tbody>
            {(detail()?.jobs ?? []).map((j) => (
              <tr key={j.id}>
                <td>{j.kind}</td>
                <td><Status value={j.state} /></td>
                <td class="num">{j.attempts} / {j.maxAttempts}</td>
                <td class="nowrap">{formatDate(j.runAt)}</td>
                <td class="truncate small" title={j.lastError ?? ""}>{j.lastError ?? "-"}</td>
              </tr>
            ))}
          </tbody>
        </Table>
        <Empty title="No jobs" hidden={(detail()?.jobs ?? []).length > 0}>Nothing is queued for this message.</Empty>
      </Section>
    </>
  );
}
