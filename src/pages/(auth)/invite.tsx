import { createSignal, onMount } from "@krate/runtime";
import { Button, Input } from "@krate/components";
import { Wordmark } from "../../../components/ui/logo";
import { Field, Notice } from "../../../components/ui/form";
import { api, formData } from "../../../lib/client";

type Invite = { email: string; role: string };

export default function AcceptInvite() {
  const [invite, setInvite] = createSignal<Invite | null>(null);
  const [error, setError] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const [token, setToken] = createSignal("");

  onMount(async () => {
    const value = new URLSearchParams(window.location.search).get("token") ?? "";
    setToken(value);
    const result = await api.get<Invite>(`/api/invites/accept?token=${encodeURIComponent(value)}`);
    if (result.ok) setInvite(result.data);
    else setError(result.error);
  });

  async function submit(event: Event) {
    event.preventDefault();
    const data = formData(event);
    if (data.password !== data.confirm) {
      setError("The two passwords do not match.");
      return;
    }
    setBusy(true);
    setError("");
    const result = await api.post("/api/invites/accept", { token: token(), name: data.name, password: data.password });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    window.location.href = "/login";
  }

  return (
    <div class="auth-page">
      <Head>
        <title>Accept invite - Snapjaw</title>
      </Head>
      <div class="auth-card">
        <Wordmark />
        <div>
          <h1>Accept invite</h1>
          <p class="muted" hidden={!(Boolean(invite()))}>
            You were invited as {invite()?.role} with <span class="mono">{invite()?.email}</span>. Choose a password to finish.
          </p>
        </div>
        <Notice tone="bad" hidden={!(Boolean(error()))}>{error()}</Notice>
        <form class="form" hidden={!(Boolean(invite()))} onSubmit={(event: Event) => submit(event)}>
          <Field label="Name" for="name">
            <Input id="name" name="name" type="text" autocomplete="name" />
          </Field>
          <Field label="Password" for="password" hint="At least 12 characters.">
            <Input id="password" name="password" type="password" autocomplete="new-password" required />
          </Field>
          <Field label="Confirm password" for="confirm">
            <Input id="confirm" name="confirm" type="password" autocomplete="new-password" required />
          </Field>
          <Button type="submit" variant="primary" disabled={busy()}>{busy() ? "Creating account" : "Create account"}</Button>
        </form>
        <p class="auth-foot"><a href="/login">Back to sign in</a></p>
      </div>
    </div>
  );
}
