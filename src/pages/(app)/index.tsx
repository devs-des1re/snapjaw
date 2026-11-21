import { createMemo, createSignal, onCleanup, onMount } from "@krate/runtime";
import { PageHeader, Section } from "../../../components/ui/page";
import { Notice } from "../../../components/ui/form";
import { Table, Empty } from "../../../components/ui/table";
import { Status } from "../../../components/ui/status";
import { api, formatRelative } from "../../../lib/client";

type Quota = { day: number; month: number; dailyLimit: number; monthlyLimit: number; alertPercent: number; mode: string };
type Failure = { id: string; direction: string; fromAddress: string; toAddresses: string[]; subject: string | null; status: string; error: string | null; updatedAt: string };
type Data = {
  quota: Quota;
  queue: { kind: string; state: string; n: number }[];
  failures: Failure[];
  last24h: { direction: string; status: string; n: number }[];
  domains: { id: string; name: string; status: string; receiving: boolean; checkedAt: string | null }[];
  destinations: { id: string; name: string; type: string; health: string; lastError: string | null; lastCheckedAt: string | null }[];
  setup: { resendKey: boolean; webhook: boolean; domain: boolean; certificate: boolean };
  smtp: { hostname: string; certificate: { source: string; daysLeft: number; matchesHost: boolean } | null };
};

function percent(used: number, limit: number) {
  return limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
}

function level(used: number, limit: number, alert: number) {
  const value = percent(used, limit);
  return value >= 100 ? "over" : value >= alert ? "warn" : "ok";
}

export default function Dashboard() {
  const [data, setData] = createSignal<Data | null>(null);
  const [error, setError] = createSignal("");

  async function load() {
    const result = await api.get<Data>("/api/dashboard");
    if (result.ok) {
      setData(result.data);
      setError("");
    } else setError(result.error);
  }

  onMount(() => {
    void load();
    const timer = setInterval(() => void load(), 15000);
    onCleanup(() => clearInterval(timer));
  });

  const quota = createMemo(() => data()?.quota ?? { day: 0, month: 0, dailyLimit: 0, monthlyLimit: 0, alertPercent: 80, mode: "hold" });
  const queued = createMemo(() => (data()?.queue ?? []).filter((q) => q.state === "queued" || q.state === "running").reduce((sum, q) => sum + Number(q.n), 0));
  const dead = createMemo(() => (data()?.queue ?? []).filter((q) => q.state === "dead").reduce((sum, q) => sum + Number(q.n), 0));
  const count = (direction: string, statuses: string[]) => (data()?.last24h ?? []).filter((row) => row.direction === direction && statuses.includes(row.status)).reduce((sum, row) => sum + Number(row.n), 0);
  const sent24 = createMemo(() => count("outbound", ["sent", "delivered"]));
  const failed24 = createMemo(() => count("outbound", ["failed", "bounced", "complained", "rejected"]) + count("inbound", ["failed", "rejected", "partial"]));
  const received24 = createMemo(() => count("inbound", ["delivered", "queued", "received", "partial"]));
  const setupDone = createMemo(() => {
    const setup = data()?.setup;
    return Boolean(setup && setup.resendKey && setup.webhook && setup.domain && setup.certificate);
  });
  const dayLevel = createMemo(() => level(quota().day, quota().dailyLimit, quota().alertPercent));
  const monthLevel = createMemo(() => level(quota().month, quota().monthlyLimit, quota().alertPercent));
  const dayWidth = createMemo(() => `width-${Math.round(percent(quota().day, quota().dailyLimit) / 5) * 5}`);
  const monthWidth = createMemo(() => `width-${Math.round(percent(quota().month, quota().monthlyLimit) / 5) * 5}`);

  return (
    <>
      <Head>
        <title>Dashboard - Snapjaw</title>
      </Head>
      <PageHeader title="Dashboard" description="Quota, queues and delivery health. Refreshes every 15 seconds." />
      <Notice tone="bad" hidden={!error()}>{error()}</Notice>

      <Section title="Finish setup" description="Snapjaw needs these before mail can flow." hidden={!data() || setupDone()}>
        <ol class="checklist">
          <li data-done={data()?.setup.resendKey ? "true" : "false"}><a href="/settings">Add a Resend API key</a></li>
          <li data-done={data()?.setup.webhook ? "true" : "false"}><a href="/settings">Connect the Resend webhook</a></li>
          <li data-done={data()?.setup.domain ? "true" : "false"}><a href="/domains">Add and verify a domain</a></li>
          <li data-done={data()?.setup.certificate ? "true" : "false"}><a href="/settings#tls">Give SMTP a trusted TLS certificate</a></li>
        </ol>
      </Section>

      <div class="stats">
        <div class="stat">
          <span class="stat-label">Quota today</span>
          <span class="stat-value">{quota().day}<span class="stat-of"> / {quota().dailyLimit || "no limit"}</span></span>
          <div class="meter" data-level={dayLevel()}><span class={dayWidth()} /></div>
          <span class="stat-note">Sent and received both count. Resets at 00:00 UTC.</span>
        </div>
        <div class="stat">
          <span class="stat-label">Quota this month</span>
          <span class="stat-value">{quota().month}<span class="stat-of"> / {quota().monthlyLimit || "no limit"}</span></span>
          <div class="meter" data-level={monthLevel()}><span class={monthWidth()} /></div>
          <span class="stat-note">Over the cap, mail is {quota().mode === "reject" ? "rejected" : "held until it resets"}.</span>
        </div>
        <div class="stat">
          <span class="stat-label">Queue</span>
          <span class="stat-value">{queued()}</span>
          <span class="stat-note">{dead()} in the dead-letter list.</span>
        </div>
        <div class="stat">
          <span class="stat-label">Last 24 hours</span>
          <span class="stat-value">{sent24() + received24()}</span>
          <span class="stat-note">{sent24()} sent, {received24()} received, {failed24()} failed.</span>
        </div>
      </div>

      <Section title="Recent failures" actions={<a href="/messages?status=failed">All failed</a>}>
        <Table label="Recent failures">
          <thead>
            <tr><th>When</th><th>Direction</th><th>From</th><th>Subject</th><th>Status</th><th>Error</th></tr>
          </thead>
          <tbody>
            {(data()?.failures ?? []).map((m) => (
              <tr key={m.id}>
                <td class="nowrap"><a href={`/messages/view?id=${m.id}`}>{formatRelative(m.updatedAt)}</a></td>
                <td>{m.direction}</td>
                <td class="mono truncate">{m.fromAddress}</td>
                <td class="truncate">{m.subject ?? "(no subject)"}</td>
                <td><Status value={m.status} /></td>
                <td class="truncate small" title={m.error ?? ""}>{m.error ?? "-"}</td>
              </tr>
            ))}
          </tbody>
        </Table>
        <Empty title="No failures" hidden={(data()?.failures ?? []).length > 0}>Nothing has failed recently.</Empty>
      </Section>

      <div class="split">
        <Section title="Domains" actions={<a href="/domains">Manage</a>}>
          <Table label="Domain status">
            <thead>
              <tr><th>Domain</th><th>Status</th><th>Receiving</th></tr>
            </thead>
            <tbody>
              {(data()?.domains ?? []).map((d) => (
                <tr key={d.id}>
                  <td class="mono">{d.name}</td>
                  <td><Status value={d.status} /></td>
                  <td>{d.receiving ? "on" : "off"}</td>
                </tr>
              ))}
            </tbody>
          </Table>
          <Empty title="No domains" hidden={(data()?.domains ?? []).length > 0}>Add one under Domains.</Empty>
        </Section>
        <Section title="Destinations" actions={<a href="/destinations">Manage</a>}>
          <Table label="Destination health">
            <thead>
              <tr><th>Name</th><th>Type</th><th>Health</th><th>Checked</th></tr>
            </thead>
            <tbody>
              {(data()?.destinations ?? []).map((d) => (
                <tr key={d.id}>
                  <td title={d.lastError ?? ""}>{d.name}</td>
                  <td>{d.type}</td>
                  <td><Status value={d.health} /></td>
                  <td class="nowrap">{formatRelative(d.lastCheckedAt)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
          <Empty title="No destinations" hidden={(data()?.destinations ?? []).length > 0}>Add one under Destinations.</Empty>
        </Section>
      </div>
    </>
  );
}
