import { createSignal } from "@krate/runtime";
import { Button, Input } from "@krate/components";
import { Wordmark } from "../../../components/ui/logo";
import { Field, Notice } from "../../../components/ui/form";
import { api, formData } from "../../../lib/client";

export default function Setup() {
  const [error, setError] = createSignal("");
  const [busy, setBusy] = createSignal(false);

  async function submit(event: Event) {
    event.preventDefault();
    const data = formData(event);
    if (data.password !== data.confirm) {
      setError("The two passwords do not match.");
      return;
    }
    setBusy(true);
    setError("");
    const result = await api.post("/api/setup", { token: data.token, email: data.email, name: data.name, password: data.password });
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
        <title>Set up - Snapjaw</title>
      </Head>
      <div class="auth-card">
        <Wordmark />
        <div>
          <h1>Create the first owner</h1>
          <p class="muted">The setup token is printed in the Snapjaw logs. Run docker compose logs snapjaw to find it.</p>
        </div>
        <Notice tone="bad" hidden={!(Boolean(error()))}>{error()}</Notice>
        <form class="form" onSubmit={(event: Event) => submit(event)}>
          <Field label="Setup token" for="token">
            <Input id="token" name="token" type="text" autocomplete="off" required class="mono" />
          </Field>
          <Field label="Name" for="name">
            <Input id="name" name="name" type="text" autocomplete="name" />
          </Field>
          <Field label="Email" for="email">
            <Input id="email" name="email" type="email" autocomplete="username" required />
          </Field>
          <Field label="Password" for="password" hint="At least 12 characters.">
            <Input id="password" name="password" type="password" autocomplete="new-password" required />
          </Field>
          <Field label="Confirm password" for="confirm">
            <Input id="confirm" name="confirm" type="password" autocomplete="new-password" required />
          </Field>
          <Button type="submit" variant="primary" disabled={busy()}>{busy() ? "Creating" : "Create owner"}</Button>
        </form>
      </div>
    </div>
  );
}
