import { createSignal } from "@krate/runtime";
import { Button, Input } from "@krate/components";
import { signIn } from "@krate/auth/client";
import { Wordmark } from "../../../../components/ui/logo";
import { Field, Notice } from "../../../../components/ui/form";
import { formData } from "../../../../lib/client";

const messages: Record<string, string> = {
  CredentialsSignin: "That email and password do not match an active admin.",
  RateLimited: "Too many attempts. Wait a few minutes and try again.",
  AccessDenied: "This account cannot sign in.",
};

function safeCallback(): string {
  const raw = new URLSearchParams(window.location.search).get("callbackUrl") ?? "/";
  return raw.startsWith("/") && !raw.startsWith("//") ? raw : "/";
}

export default function Login() {
  const [error, setError] = createSignal("");
  const [busy, setBusy] = createSignal(false);

  async function submit(event: Event) {
    event.preventDefault();
    const data = formData(event);
    setBusy(true);
    setError("");
    const result = await signIn("credentials", { email: data.email, password: data.password, redirect: false, callbackUrl: safeCallback() });
    setBusy(false);
    if (result.twoFactorRequired) {
      window.location.href = `/login/2fa?callbackUrl=${encodeURIComponent(safeCallback())}`;
      return;
    }
    if (!result.ok || result.error) {
      setError(messages[result.error ?? ""] ?? "Sign in failed. Try again.");
      return;
    }
    window.location.href = safeCallback();
  }

  return (
    <div class="auth-page">
      <Head>
        <title>Sign in - Snapjaw</title>
      </Head>
      <div class="auth-card">
        <Wordmark />
        <div>
          <h1>Sign in</h1>
          <p class="muted">Admin access to this Snapjaw instance.</p>
        </div>
        <Notice tone="bad" hidden={!(Boolean(error()))}>{error()}</Notice>
        <form class="form" onSubmit={(event: Event) => submit(event)}>
          <Field label="Email" for="email">
            <Input id="email" name="email" type="email" autocomplete="username" required />
          </Field>
          <Field label="Password" for="password">
            <Input id="password" name="password" type="password" autocomplete="current-password" required />
          </Field>
          <Button type="submit" variant="primary" disabled={busy()}>{busy() ? "Signing in" : "Sign in"}</Button>
        </form>
        <p class="auth-foot"><span>Forgot your password? Ask an owner to reset it.</span></p>
      </div>
    </div>
  );
}
