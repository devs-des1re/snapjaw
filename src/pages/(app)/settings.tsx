import { createEffect, createMemo, createSignal, onMount } from "@krate/runtime";
import { Button, Input } from "@krate/components";
import { PageHeader, Section } from "../../../components/ui/page";
import { Field, Notice } from "../../../components/ui/form";
import { Status } from "../../../components/ui/status";
import { ValueBlock } from "../../../components/ui/copy";
import { Table, Empty } from "../../../components/ui/table";
import { api, fillForm, formData, formatDate, formatRelative } from "../../../lib/client";

type Setting = { value: string; secret: boolean; set: boolean };
type Tls = { source: string; subject: string; issuer: string; validTo: string; names: string; matchesHost: boolean; daysLeft: number };
type Check = { name: string; status: "ok" | "warn" | "fail"; detail: string; fix?: string };
type Data = {
  settings: Record<string, Setting>;
  webhookUrl: string;
  publicUrl: string;
  smtpHostname: string;
  googleRedirectUri: string;
  tls: Tls | null;
  acme: { enabled: boolean; lastError: string | null };
  reconciler: { lastRun: string | null; lastResult: string | null };
  role: string;
};

export default function Settings() {
  const [data, setData] = createSignal<Data | null>(null);
  const [message, setMessage] = createSignal("");
  const [error, setError] = createSignal("");
  const [checks, setChecks] = createSignal<Check[]>([]);
  const [running, setRunning] = createSignal(false);

  async function runChecks() {
    setRunning(true);
    const result = await api.post<Check[]>("/api/doctor");
    setRunning(false);
    if (result.ok) setChecks(result.data);
    else setError(result.error);
  }

  async function load() {
    const result = await api.get<Data>("/api/settings");
    if (result.ok) setData(result.data);
    else setError(result.error);
  }

  onMount(() => void load());

  createEffect(() => {
    const values = Object.fromEntries(Object.entries(cfg()).filter(([, setting]) => !setting.secret).map(([key, setting]) => [key, setting.value]));
    queueMicrotask(() => fillForm(document, values));
  });

  const cfg = createMemo<Record<string, Setting>>(() => data()?.settings ?? {});

  function report(result: { ok: boolean; error?: string }, text: string) {
    if (!result.ok) {
      setMessage("");
      setError(result.error ?? "That did not work.");
      window.scrollTo(0, 0);
      return;
    }
    setError("");
    setMessage(text);
    window.scrollTo(0, 0);
    void load();
  }

  async function save(event: Event, keys: string[], text = "Saved.") {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const values = formData(event);
    const body: Record<string, string> = {};
    for (const key of keys) {
      const input = form.elements.namedItem(key) as HTMLInputElement | null;
      if (input?.type === "checkbox") body[key] = input.checked ? "true" : "false";
      else body[key] = values[key] ?? "";
    }
    const result = await api.patch("/api/settings", body);
    report(result as never, text);
    if (result.ok) for (const key of keys) {
      const input = form.elements.namedItem(key) as HTMLInputElement | null;
      if (input?.type === "password") input.value = "";
    }
  }

  async function testKey() {
    const input = document.getElementById("resend-key") as HTMLInputElement | null;
    const result = await api.post<{ domains: number }>("/api/settings/test", { apiKey: input?.value ?? "" });
    report(result as never, result.ok ? `Resend answered. The account has ${result.data.domains} domain(s).` : "");
  }

  async function connectWebhook() {
    const result = await api.post<{ endpoint: string; reused: boolean }>("/api/settings/webhook");
    report(result as never, result.ok ? (result.data.reused ? "Linked the existing webhook in Resend and stored its secret." : "Created the webhook in Resend and stored its signing secret.") : "");
  }

  return (
    <>
      <Head>
        <title>Settings - Snapjaw</title>
      </Head>
      <PageHeader title="Settings" description="Resend connection, quotas, limits, retention, alerts and TLS. Secrets are encrypted at rest and never shown again after saving." />
      <Notice tone="good" hidden={!message()}>{message()}</Notice>
      <Notice tone="bad" hidden={!error()}>{error()}</Notice>

      <Section title="Resend API key" description="Use a full access key so Snapjaw can manage domains and read received mail.">
        <form class="form" onSubmit={(event: Event) => save(event, ["resend.apiKey"], "API key saved.")}>
          <Field label="API key" for="resend-key" hint={Boolean(cfg()["resend.apiKey"]?.set) ? "A key is stored. Enter a new one to replace it." : "No key stored yet."}>
            <Input id="resend-key" name="resend.apiKey" type="password" autocomplete="off" placeholder="re_..." class="mono" />
          </Field>
          <div class="form-actions">
            <Button type="submit" variant="primary">Save key</Button>
            <Button type="button" variant="secondary" onClick={() => testKey()}>Test connection</Button>
          </div>
        </form>
      </Section>

      <Section title="Webhook" description="Resend tells Snapjaw about received mail, deliveries, bounces and complaints through this webhook.">
        <ValueBlock text={data()?.webhookUrl ?? ""} label="Copy webhook URL" />
        <p class="muted small">
          Secret: {Boolean(cfg()["resend.webhookSecret"]?.set) ? "stored" : "not set"}. Reconciler last ran {formatRelative(data()?.reconciler.lastRun)}{data()?.reconciler.lastResult ? ` (${data()?.reconciler.lastResult})` : ""}.
        </p>
        <div class="form-actions">
          <Button variant="primary" onClick={() => connectWebhook()}>Connect automatically</Button>
        </div>
        <form class="form" onSubmit={(event: Event) => save(event, ["resend.webhookSecret"], "Webhook secret saved.")}>
          <Field label="Signing secret" for="webhook-secret" hint="Only needed if you created the webhook by hand in the Resend dashboard.">
            <Input id="webhook-secret" name="resend.webhookSecret" type="password" autocomplete="off" placeholder="whsec_..." class="mono" />
          </Field>
          <div class="form-actions"><Button type="submit" variant="secondary">Save secret</Button></div>
        </form>
      </Section>

      <Section title="Quota" description="Match your Resend plan. Free is 100 a day and 3,000 a month. Sent and received mail both count.">
        <form class="form" onSubmit={(event: Event) => save(event, ["quota.daily", "quota.monthly", "quota.alertPercent", "quota.mode", "resend.rateLimit"], "Quota settings saved.")}>
          <div class="form-row">
            <Field label="Daily limit" for="quota-daily" hint="0 means no daily limit.">
              <input id="quota-daily" name="quota.daily" type="number" min="0" />
            </Field>
            <Field label="Monthly limit" for="quota-monthly" hint="0 means no monthly limit.">
              <input id="quota-monthly" name="quota.monthly" type="number" min="0" />
            </Field>
          </div>
          <div class="form-row">
            <Field label="Alert at percent" for="quota-alert">
              <input id="quota-alert" name="quota.alertPercent" type="number" min="1" max="100" />
            </Field>
            <Field label="Requests per second to Resend" for="quota-rate" hint="Resend allows 10 by default.">
              <input id="quota-rate" name="resend.rateLimit" type="number" min="1" />
            </Field>
          </div>
          <Field label="Over the cap" for="quota-mode">
            <select id="quota-mode" name="quota.mode">
              <option value="hold">Hold: accept and send when the quota resets</option>
              <option value="reject">Reject: refuse new mail with a clear error</option>
            </select>
          </Field>
          <div class="form-actions"><Button type="submit" variant="primary">Save quota</Button></div>
        </form>
      </Section>

      <Section title="Limits and retention">
        <form class="form" onSubmit={(event: Event) => save(event, ["limits.maxMessageBytes", "limits.maxAttachments", "retention.days", "inbound.reconcileMinutes"], "Limits saved.")}>
          <div class="form-row">
            <Field label="Largest message in bytes" for="limit-bytes" hint="Resend accepts up to 40 MB after encoding.">
              <input id="limit-bytes" name="limits.maxMessageBytes" type="number" />
            </Field>
            <Field label="Most attachments" for="limit-attachments">
              <input id="limit-attachments" name="limits.maxAttachments" type="number" />
            </Field>
          </div>
          <div class="form-row">
            <Field label="Keep the message log for days" for="retention" hint="Bodies are deleted as soon as delivery succeeds, whatever this says.">
              <input id="retention" name="retention.days" type="number" />
            </Field>
            <Field label="Reconcile received mail every minutes" for="reconcile">
              <input id="reconcile" name="inbound.reconcileMinutes" type="number" />
            </Field>
          </div>
          <div class="form-actions"><Button type="submit" variant="primary">Save limits</Button></div>
        </form>
      </Section>

      <Section title="Alerts" description="Snapjaw emails this address when the quota passes the alert level or a destination keeps failing. Alerts count against the quota.">
        <form class="form" onSubmit={(event: Event) => save(event, ["alerts.email", "alerts.from", "alerts.failureThreshold"], "Alert settings saved.")}>
          <div class="form-row">
            <Field label="Send alerts to" for="alerts-email">
              <input id="alerts-email" name="alerts.email" type="email" />
            </Field>
            <Field label="Send alerts from" for="alerts-from" hint="An address on a verified domain.">
              <input id="alerts-from" name="alerts.from" type="text" placeholder="Snapjaw <alerts@example.com>" />
            </Field>
          </div>
          <Field label="Alert after this many failures in an hour" for="alerts-threshold">
            <input id="alerts-threshold" name="alerts.failureThreshold" type="number" min="1" />
          </Field>
          <div class="form-actions"><Button type="submit" variant="primary">Save alerts</Button></div>
        </form>
      </Section>

      <Section title="Gmail API" description="Needed for Gmail import destinations. Create an OAuth client of type Web application in Google Cloud and add the redirect URI below.">
        <ValueBlock text={data()?.googleRedirectUri ?? ""} label="Copy redirect URI" />
        <form class="form" onSubmit={(event: Event) => save(event, ["google.clientId", "google.clientSecret"], "Google OAuth client saved.")}>
          <Field label="Client ID" for="google-id">
            <input id="google-id" name="google.clientId" type="text" class="mono" />
          </Field>
          <Field label="Client secret" for="google-secret" hint={Boolean(cfg()["google.clientSecret"]?.set) ? "A secret is stored. Enter a new one to replace it." : "Not set."}>
            <Input id="google-secret" name="google.clientSecret" type="password" autocomplete="off" class="mono" />
          </Field>
          <div class="form-actions"><Button type="submit" variant="primary">Save client</Button></div>
        </form>
      </Section>

      <Section title="Security" description="Owners can require two-factor authentication for every admin.">
        <form class="form" onSubmit={(event: Event) => save(event, ["security.require2fa"], "Security settings saved.")}>
          <label class="checkbox-row">
            <input type="checkbox" name="security.require2fa" disabled={data()?.role !== "owner"} /> Require two-factor authentication
          </label>
          <div class="form-actions"><Button type="submit" variant="primary" disabled={data()?.role !== "owner"}>Save security</Button></div>
        </form>
      </Section>

      <section class="section" id="tls">
        <div class="section-head">
          <div>
            <h2>SMTP and TLS</h2>
            <p>Gmail only connects to an SMTP server with a valid certificate for its host name. Set the certificate with SNAPJAW_TLS_CERT and SNAPJAW_TLS_KEY, or turn on Let's Encrypt with SNAPJAW_ACME_EMAIL.</p>
          </div>
        </div>
        <dl class="details">
          <dt>Host name</dt>
          <dd class="mono">{data()?.smtpHostname ?? "-"}</dd>
          <dt>Certificate</dt>
          <dd><Status value={data()?.tls?.source === "self-signed" ? "self-signed" : data()?.tls ? "ok" : "unknown"} tone={data()?.tls?.source === "self-signed" ? "bad" : "good"} /> {data()?.tls?.source ?? ""}</dd>
          <dt>Issued by</dt>
          <dd class="small">{data()?.tls?.issuer ?? "-"}</dd>
          <dt>Valid until</dt>
          <dd>{formatDate(data()?.tls?.validTo)} ({data()?.tls?.daysLeft ?? 0} days)</dd>
          <dt>Matches host</dt>
          <dd>{data()?.tls?.matchesHost ? "Yes" : "No. Clients will refuse it."}</dd>
          <dt>Let's Encrypt</dt>
          <dd>{data()?.acme.enabled ? (data()?.acme.lastError ? `On, last attempt failed: ${data()?.acme.lastError}` : "On") : "Off"}</dd>
        </dl>
      </section>

      <Section title="Health checks" description="The same checks as snapjaw doctor: DNS records, TLS, Resend, the webhook, SMTP ports and destinations.">
        <div class="form-actions"><Button variant="secondary" onClick={() => runChecks()} disabled={running()}>{running() ? "Checking" : "Run checks"}</Button></div>
        <Table label="Health checks">
          <thead>
            <tr><th>Check</th><th>Result</th><th>Detail</th><th>Fix</th></tr>
          </thead>
          <tbody>
            {checks().map((check) => (
              <tr key={check.name}>
                <td>{check.name}</td>
                <td><Status value={check.status} tone={check.status === "ok" ? "good" : check.status === "warn" ? "wait" : "bad"} /></td>
                <td class="small">{check.detail}</td>
                <td class="small muted">{check.status === "ok" ? "" : check.fix ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </Table>
        <Empty title="Not run yet" hidden={checks().length > 0}>Press Run checks. It can take a few seconds.</Empty>
      </Section>
    </>
  );
}
