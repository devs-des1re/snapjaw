import { createSignal } from "@krate/runtime";
import { Button, Input } from "@krate/components";
import { twoFactor } from "@krate/auth/client";
import { Wordmark } from "../../../../components/ui/logo";
import { Field, Notice } from "../../../../components/ui/form";
import { formData } from "../../../../lib/client";

function safeCallback(): string {
  const raw = new URLSearchParams(window.location.search).get("callbackUrl") ?? "/";
  return raw.startsWith("/") && !raw.startsWith("//") ? raw : "/";
}

export default function TwoFactorChallenge() {
  const [error, setError] = createSignal("");
  const [busy, setBusy] = createSignal(false);

  async function submit(event: Event) {
    event.preventDefault();
    const code = formData(event).code?.replace(/\s+/g, "") ?? "";
    setBusy(true);
    setError("");
    const result = await twoFactor.verify(code, { redirect: false, callbackUrl: safeCallback() });
    setBusy(false);
    if (!result.ok || result.error) {
      setError(result.error === "RateLimited" ? "Too many attempts. Wait a few minutes." : "That code did not work. Codes change every 30 seconds.");
      return;
    }
    window.location.href = safeCallback();
  }

  return (
    <div class="auth-page">
      <Head>
        <title>Two-factor check - Snapjaw</title>
      </Head>
      <div class="auth-card">
        <Wordmark />
        <div>
          <h1>Two-factor check</h1>
          <p class="muted">Enter the 6-digit code from your authenticator app, or one of your backup codes.</p>
        </div>
        <Notice tone="bad" hidden={!(Boolean(error()))}>{error()}</Notice>
        <form class="form" onSubmit={(event: Event) => submit(event)}>
          <Field label="Code" for="code">
            <Input id="code" name="code" type="text" autocomplete="one-time-code" required class="mono" />
          </Field>
          <Button type="submit" variant="primary" disabled={busy()}>{busy() ? "Checking" : "Continue"}</Button>
        </form>
        <p class="auth-foot"><a href="/login">Back to sign in</a></p>
      </div>
    </div>
  );
}
