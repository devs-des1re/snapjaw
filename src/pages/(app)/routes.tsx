import { createEffect, createSignal, onMount } from "@krate/runtime";
import { Button, Input } from "@krate/components";
import { PageHeader, Section } from "../../../components/ui/page";
import { Field, Notice } from "../../../components/ui/form";
import { Table, Empty } from "../../../components/ui/table";
import { Status } from "../../../components/ui/status";
import { RowButton } from "../../../components/ui/button";
import { api, fillForm, formData } from "../../../lib/client";

type Route = { id: string; kind: string; pattern: string; domain: string; enabled: boolean; note: string | null; destinationIds: string[]; destinationNames?: string };
type Destination = { id: string; name: string; type: string };
type Domain = { id: string; name: string };
type Edit = { id: string | null; kind: string; pattern: string; enabled: boolean; note: string; destinationIds: string[] };

const empty: Edit = { id: null, kind: "address", pattern: "", enabled: true, note: "", destinationIds: [] };

export default function Routes() {
  const [routes, setRoutes] = createSignal<Route[]>([]);
  const [destinations, setDestinations] = createSignal<Destination[]>([]);
  const [domains, setDomains] = createSignal<Domain[]>([]);
  const [edit, setEdit] = createSignal<Edit>(empty);
  const [message, setMessage] = createSignal("");
  const [error, setError] = createSignal("");

  async function load() {
    const [r, d, dom] = await Promise.all([api.get<Route[]>("/api/routes"), api.get<{ destinations: Destination[] }>("/api/destinations"), api.get<Domain[]>("/api/domains")]);
    const list = d.ok ? d.data.destinations : [];
    if (d.ok) setDestinations(list);
    if (dom.ok) setDomains(dom.data);
    if (r.ok) setRoutes(r.data.map((route) => ({ ...route, destinationNames: route.destinationIds.map((id) => list.find((x) => x.id === id)?.name ?? "missing").join(", ") })));
    else setError(r.error);
  }

  onMount(() => void load());

  createEffect(() => {
    const ids = edit().destinationIds;
    destinations();
    queueMicrotask(() => {
      const current = edit();
      const form = document.getElementById("route-form");
      if (form) fillForm(form, { kind: current.kind, pattern: current.pattern, note: current.note, enabled: current.enabled });
      document.querySelectorAll<HTMLInputElement>('input[name="destination"]').forEach((box) => {
        box.checked = ids.includes(box.value);
      });
    });
  });

  function report(result: { ok: boolean; error?: string }, text: string) {
    if (!result.ok) {
      setMessage("");
      setError(result.error ?? "That did not work.");
      return false;
    }
    setError("");
    setMessage(text);
    void load();
    return true;
  }

  async function save(event: Event) {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const data = formData(event);
    const ids = [...form.querySelectorAll<HTMLInputElement>('input[name="destination"]:checked')].map((input) => input.value);
    const body = { kind: data.kind, pattern: data.pattern, note: data.note, enabled: data.enabled === "on", destinationIds: ids };
    const current = edit();
    const result = current.id ? await api.put(`/api/routes/${current.id}`, body) : await api.post("/api/routes", body);
    if (report(result as never, current.id ? "Route saved." : "Route created.")) {
      setEdit({ ...empty });
      form.reset();
    }
  }

  async function remove(route: Route) {
    if (!window.confirm(`Delete the route for ${route.pattern}? Mail to it will be rejected unless another route matches.`)) return;
    report((await api.del(`/api/routes/${route.id}`)) as never, "Route deleted.");
  }

  async function test(route: Route) {
    const from = window.prompt("Send the test from which address? It must be on a verified domain.", "");
    if (from === null) return;
    const result = await api.post<{ to: string; note: string }>(`/api/routes/${route.id}/test`, { from });
    report(result as never, result.ok ? `Test sent to ${result.data.to}. ${result.data.note} Check the Messages page.` : "");
  }

  return (
    <>
      <Head>
        <title>Routes - Snapjaw</title>
      </Head>
      <PageHeader title="Routes" description="Where received mail goes. An exact address wins over a wildcard, and a wildcard wins over the catch-all." />
      <Notice tone="good" hidden={!message()}>{message()}</Notice>
      <Notice tone="bad" hidden={!error()}>{error()}</Notice>
      <Table label="Routes">
        <thead>
          <tr><th>Address</th><th>Kind</th><th>Destinations</th><th>Status</th><th>Note</th><th class="actions"><span class="visually-hidden">Actions</span></th></tr>
        </thead>
        <tbody>
          {routes().map((route) => (
            <tr key={route.id}>
              <td class="mono">{route.pattern}</td>
              <td>{route.kind === "catchall" ? "catch-all" : route.kind}</td>
              <td class="truncate" title={route.destinationNames ?? ""}>{route.destinationNames}</td>
              <td><Status value={route.enabled ? "enabled" : "disabled"} /></td>
              <td class="truncate small">{route.note ?? ""}</td>
              <td class="actions">
                <RowButton onClick={() => test(route)}>Send test</RowButton>
                <RowButton onClick={() => setEdit({ id: route.id, kind: route.kind, pattern: route.kind === "catchall" ? route.domain : route.pattern, enabled: route.enabled, note: route.note ?? "", destinationIds: route.destinationIds })}>Edit</RowButton>
                <RowButton onClick={() => remove(route)}>Delete</RowButton>
              </td>
            </tr>
          ))}
        </tbody>
      </Table>
      <Empty title="No routes" hidden={routes().length > 0}>Without a route, received mail is not delivered anywhere.</Empty>

      <Section title={edit().id ? `Edit ${edit().pattern}` : "New route"} description={domains().length ? `Your domains: ${domains().map((d) => d.name).join(", ")}` : "Add a domain first."}>
        <form class="form" id="route-form" onSubmit={(event: Event) => save(event)}>
          <div class="form-row">
            <Field label="Kind" for="route-kind">
              <select id="route-kind" name="kind">
                <option value="address">Exact address</option>
                <option value="wildcard">Wildcard</option>
                <option value="catchall">Catch-all for a domain</option>
              </select>
            </Field>
            <Field label="Address or domain" for="route-pattern" hint="hello@example.com, support-*@example.com, or example.com for a catch-all.">
              <input id="route-pattern" name="pattern" type="text" class="mono" required />
            </Field>
          </div>
          <fieldset class="field">
            <legend class="field-label">Deliver to</legend>
            <div class="checkbox-grid">
              {destinations().map((d) => (
                <label key={d.id} class="checkbox-row">
                  <input type="checkbox" name="destination" value={d.id} /> {d.name} <span class="muted small">({d.type})</span>
                </label>
              ))}
            </div>
            <span class="field-hint" hidden={destinations().length > 0}>Create a destination first.</span>
          </fieldset>
          <Field label="Note" for="route-note">
            <input id="route-note" name="note" type="text" />
          </Field>
          <label class="checkbox-row"><input type="checkbox" name="enabled" defaultChecked /> Enabled</label>
          <div class="form-actions">
            <Button type="submit" variant="primary">{edit().id ? "Save route" : "Create route"}</Button>
            <Button type="button" variant="ghost" onClick={() => setEdit({ ...empty })}>Clear</Button>
          </div>
        </form>
      </Section>
    </>
  );
}
