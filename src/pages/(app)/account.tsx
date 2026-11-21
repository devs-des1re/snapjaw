import { createSignal, onMount } from "@krate/runtime";
import { Button, Input } from "@krate/components";
import { RowButton } from "../../../components/ui/button";
import { twoFactor } from "@krate/auth/client";
import { PageHeader, Section } from "../../../components/ui/page";
import { Field, Notice } from "../../../components/ui/form";
import { Table, Empty } from "../../../components/ui/table";
import { ValueBlock } from "../../../components/ui/copy";
import { api, formData, formatDate } from "../../../lib/client";

type Session = { publicId: string; userAgent: string | null; ip: string | null; createdAt: string; expires: string; current: boolean };
type Status = { enabled: boolean; pending: boolean; backupCodesRemaining: number; required: boolean };
type Qr = { size: number; path: string };

function device(agent: string | null): string {
  if (!agent) return "Unknown device";
  const browser = /Firefox/.test(agent) ? "Firefox" : /Edg\//.test(agent) ? "Edge" : /Chrome/.test(agent) ? "Chrome" : /Safari/.test(agent) ? "Safari" : "Browser";
  const os = /Windows/.test(agent) ? "Windows" : /Mac OS/.test(agent) ? "macOS" : /Android/.test(agent) ? "Android" : /iPhone|iPad/.test(agent) ? "iOS" : /Linux/.test(agent) ? "Linux" : "";
  return os ? `${browser} on ${os}` : browser;
}

export default function Account() {
  const [sessions, setSessions] = createSignal<Session[]>([]);
  const [status, setStatus] = createSignal<Status | null>(null);
  const [setup, setSetup] = createSignal<{ secret: string; qr: Qr | null } | null>(null);
  const [codes, setCodes] = createSignal<string[]>([]);
  const [message, setMessage] = createSignal("");
  const [error, setError] = createSignal("");
  const [mustSetup, setMustSetup] = createSignal(false);

  async function loadSessions() {
    const result = await api.get<Session[]>("/api/sessions");
    if (result.ok) setSessions(result.data);
  }

  async function loadStatus() {
    const result = await twoFactor.status();
    if (result.ok) setStatus(result.data);
  }

  onMount(() => {
    setMustSetup(new URLSearchParams(window.location.search).get("setup") === "2fa");
    void loadSessions();
    void loadStatus();
  });

  function done(text: string) {
    setError("");
    setMessage(text);
  }

  async function changePassword(event: Event) {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const data = formData(event);
    if (data.next !== data.confirm) {
      setError("The new passwords do not match.");
      return;
    }
    const result = await api.post("/api/account/password", { current: data.current, next: data.next });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    form.reset();
    done("Password changed. Other sessions were signed out.");
    void loadSessions();
  }

  async function startSetup() {
    const result = await twoFactor.setup();
    if (!result.ok) {
      setError(result.error ?? "Could not start two-factor setup.");
      return;
    }
    const qr = await api.post<Qr>("/api/account/qr", { text: result.data.otpauthUrl });
    setSetup({ secret: result.data.secret, qr: qr.ok ? qr.data : null });
  }

  async function enable(event: Event) {
    event.preventDefault();
    const code = formData(event).code?.replace(/\s+/g, "") ?? "";
    const result = await twoFactor.enable(code);
    if (!result.ok) {
      setError("That code did not work. Check the time on your phone and try again.");
      return;
    }
    setSetup(null);
    setCodes(result.data.backupCodes);
    setMustSetup(false);
    done("Two-factor authentication is on. Store the backup codes somewhere safe.");
    void loadStatus();
  }

  async function disable(event: Event) {
    event.preventDefault();
    const code = formData(event).code?.replace(/\s+/g, "") ?? "";
    const result = await twoFactor.disable(code);
    if (!result.ok) {
      setError("That code did not work.");
      return;
    }
    setCodes([]);
    done("Two-factor authentication is off.");
    void loadStatus();
  }

  async function regenerate(event: Event) {
    event.preventDefault();
    const code = formData(event).code?.replace(/\s+/g, "") ?? "";
    const result = await twoFactor.regenerateBackupCodes(code);
    if (!result.ok) {
      setError("That code did not work.");
      return;
    }
    setCodes(result.data.backupCodes);
    done("New backup codes created. The old ones no longer work.");
    void loadStatus();
  }

  async function revoke(id: string) {
    const result = await api.del(`/api/sessions/${encodeURIComponent(id)}`);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    done("Session signed out.");
    void loadSessions();
  }

  return (
    <>
      <Head>
        <title>Account - Snapjaw</title>
      </Head>
      <PageHeader title="Account" description="Your password, two-factor authentication and signed-in devices." />
      <Notice tone="warn" title="Two-factor authentication required" hidden={!(mustSetup())}>
        An owner requires two-factor authentication. Set it up below to continue.
      </Notice>
      <Notice tone="good" hidden={!(Boolean(message()))}>{message()}</Notice>
      <Notice tone="bad" hidden={!(Boolean(error()))}>{error()}</Notice>

      <Section title="Two-factor authentication" description="A time-based code from an authenticator app, asked for at every sign-in.">
        <div class="panel">
          <div class="panel-body">
            <p hidden={!(status()?.enabled === true)}>
              On. {status()?.backupCodesRemaining ?? 0} backup codes left.
            </p>
            <p hidden={!(status()?.enabled === false && !setup())}>Off.</p>
            <div hidden={!(status()?.enabled === false && !setup())}>
              <Button variant="primary" onClick={() => startSetup()}>Set up two-factor</Button>
            </div>
            <div class="split" hidden={!(Boolean(setup()))}>
              <div class="section">
                <ol class="steps">
                  <li>Scan the code with an authenticator app, or enter the key by hand.</li>
                  <li>Enter the 6-digit code the app shows.</li>
                </ol>
                <div hidden={!(Boolean(setup()?.qr))}>
                  <svg class="qr" viewBox={`-2 -2 ${(setup()?.qr?.size ?? 21) + 4} ${(setup()?.qr?.size ?? 21) + 4}`} role="img" aria-label="Authenticator QR code">
                    <path d={setup()?.qr?.path ?? ""} fill="var(--color-qr-fg)" />
                  </svg>
                </div>
                <ValueBlock text={setup()?.secret ?? ""} label="Copy key" />
              </div>
              <form class="form" onSubmit={(event: Event) => enable(event)}>
                <Field label="Code from the app" for="enable-code">
                  <Input id="enable-code" name="code" type="text" autocomplete="one-time-code" required class="mono" />
                </Field>
                <div class="form-actions">
                  <Button type="submit" variant="primary">Turn on</Button>
                  <Button type="button" variant="ghost" onClick={() => setSetup(null)}>Cancel</Button>
                </div>
              </form>
            </div>
            <div class="section" hidden={!(codes().length > 0)}>
              <h3>Backup codes</h3>
              <p class="muted small">Each code works once. They are shown only now.</p>
              <div class="codes">{codes().map((code) => <span key={code}>{code}</span>)}</div>
              <ValueBlock text={codes().join("\n")} label="Copy all backup codes" />
            </div>
            <div class="split" hidden={!(status()?.enabled === true)}>
              <form class="form" onSubmit={(event: Event) => regenerate(event)}>
                <Field label="New backup codes" for="regen-code" hint="Enter a current code from the app.">
                  <Input id="regen-code" name="code" type="text" autocomplete="one-time-code" required class="mono" />
                </Field>
                <div class="form-actions"><Button type="submit" variant="secondary">Replace backup codes</Button></div>
              </form>
              <form class="form" onSubmit={(event: Event) => disable(event)} hidden={!(status()?.required !== true)}>
                <Field label="Turn off" for="disable-code" hint="Enter a code from the app or a backup code.">
                  <Input id="disable-code" name="code" type="text" autocomplete="one-time-code" required class="mono" />
                </Field>
                <div class="form-actions"><Button type="submit" variant="destructive">Turn off two-factor</Button></div>
              </form>
            </div>
          </div>
        </div>
      </Section>

      <Section title="Password">
        <form class="form" onSubmit={(event: Event) => changePassword(event)}>
          <Field label="Current password" for="current">
            <Input id="current" name="current" type="password" autocomplete="current-password" required />
          </Field>
          <Field label="New password" for="next" hint="At least 12 characters. Other sessions are signed out.">
            <Input id="next" name="next" type="password" autocomplete="new-password" required />
          </Field>
          <Field label="Confirm new password" for="confirm">
            <Input id="confirm" name="confirm" type="password" autocomplete="new-password" required />
          </Field>
          <div class="form-actions"><Button type="submit" variant="primary">Change password</Button></div>
        </form>
      </Section>

      <Section title="Sessions" description="Devices signed in to your account.">
        <Table label="Sessions">
          <thead>
            <tr><th>Device</th><th>IP address</th><th>Signed in</th><th>Expires</th><th class="actions"><span class="visually-hidden">Actions</span></th></tr>
          </thead>
          <tbody>
            {sessions().map((s) => (
              <tr key={s.publicId}>
                <td>{device(s.userAgent)} <span class="muted" hidden={!s.current}>(this device)</span></td>
                <td class="mono">{s.ip ?? "-"}</td>
                <td>{formatDate(s.createdAt)}</td>
                <td>{formatDate(s.expires)}</td>
                <td class="actions">
                  <RowButton hidden={s.current} onClick={() => revoke(s.publicId)}>Sign out</RowButton>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
        <Empty title="No other sessions" hidden={!(sessions().length === 0)}>Sign in from another device and it will show here.</Empty>
      </Section>
    </>
  );
}
