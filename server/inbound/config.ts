import { recordAudit } from "../../db/queries/audit";
import { allDomainNames, verifiedDomainNames } from "../../db/queries/domains";
import {
  deleteDestination,
  deleteRoute,
  getDestination,
  getRoute,
  insertDestination,
  listDestinationRows,
  routesUsingDestination,
  saveRoute,
  setDestinationHealth,
  updateDestination,
  type DestinationConfig,
  type ForwardConfig,
  type GmailConfig,
  type ImapConfig,
} from "../../db/queries/destinations";
import { domainOf, isEmail } from "../../lib/address";
import { newId } from "../../lib/crypto";
import type { Actor } from "../http/guard";
import { testGmail } from "../destinations/gmail";
import { testImap } from "../destinations/imap";
import { normalizeRoutePattern } from "./match";

type Result<T> = { ok: true; data: T } | { ok: false; status: number; error: string };

const err = (status: number, error: string) => ({ ok: false as const, status, error });

export function publicDestination(destination: { id: string; name: string; type: string; health: string; lastError: string | null; lastCheckedAt: Date | null; createdAt: Date; config: DestinationConfig }) {
  const config = destination.config as Partial<ImapConfig & GmailConfig & ForwardConfig>;
  const summary =
    destination.type === "imap"
      ? `${config.username} at ${config.host}:${config.port} / ${config.mailbox}`
      : destination.type === "gmail"
        ? config.refreshToken
          ? `${config.email} (connected)`
          : "Not connected yet"
        : `${config.address} from ${config.from}`;
  return {
    id: destination.id,
    name: destination.name,
    type: destination.type,
    health: destination.health,
    lastError: destination.lastError,
    lastCheckedAt: destination.lastCheckedAt,
    createdAt: destination.createdAt,
    summary,
    connected: destination.type !== "gmail" || Boolean(config.refreshToken),
    settings:
      destination.type === "imap"
        ? { host: config.host, port: config.port, secure: config.secure, username: config.username, mailbox: config.mailbox }
        : destination.type === "gmail"
          ? { email: config.email, labelIds: config.labelIds }
          : { address: config.address, from: config.from },
  };
}

async function parseConfig(type: string, input: Record<string, unknown>, existing?: DestinationConfig): Promise<DestinationConfig | string> {
  if (type === "imap") {
    const previous = existing as ImapConfig | undefined;
    const host = String(input.host ?? previous?.host ?? "").trim();
    const port = Number(input.port ?? previous?.port ?? 993);
    const username = String(input.username ?? previous?.username ?? "").trim();
    const password = typeof input.password === "string" && input.password ? input.password : previous?.password ?? "";
    const mailbox = String(input.mailbox ?? previous?.mailbox ?? "INBOX").trim() || "INBOX";
    const secure = input.secure === undefined ? (previous?.secure ?? port === 993) : input.secure === true || input.secure === "true";
    if (!host || !/^[a-z0-9.-]+$/i.test(host)) return "Enter the IMAP server host, such as imap.gmail.com.";
    if (!Number.isInteger(port) || port < 1 || port > 65535) return "Enter a valid port. IMAP over TLS uses 993.";
    if (!username || !password) return "Enter the IMAP username and password.";
    return { host, port, secure, username, password, mailbox };
  }
  if (type === "gmail") {
    const previous = existing as GmailConfig | undefined;
    const labels = Array.isArray(input.labelIds) ? input.labelIds.map(String) : previous?.labelIds ?? ["INBOX", "UNREAD"];
    return { email: previous?.email ?? String(input.email ?? "").trim(), refreshToken: previous?.refreshToken ?? "", labelIds: labels.filter((label) => /^[A-Za-z0-9_-]+$/.test(label)), connectedAt: previous?.connectedAt };
  }
  if (type === "forward") {
    const address = String(input.address ?? (existing as ForwardConfig | undefined)?.address ?? "").trim().toLowerCase();
    const from = String(input.from ?? (existing as ForwardConfig | undefined)?.from ?? "").trim().toLowerCase();
    if (!isEmail(address)) return "Enter the address to forward to.";
    if (!isEmail(from)) return "Enter the sender address to forward from, such as forwarder@yourdomain.com.";
    const own = await allDomainNames();
    if (own.includes(domainOf(address))) return `Forwarding to ${address} would loop, because Snapjaw relays ${domainOf(address)}. Use an address outside your Snapjaw domains.`;
    const verified = await verifiedDomainNames();
    if (!verified.includes(domainOf(from))) return `The sender ${from} must use a verified Snapjaw domain.`;
    return { address, from };
  }
  return "Pick a destination type.";
}

export async function listDestinations() {
  return (await listDestinationRows()).map(publicDestination);
}

export async function createDestination(actor: Actor, input: Record<string, unknown>): Promise<Result<{ id: string }>> {
  const type = String(input.type ?? "");
  const name = typeof input.name === "string" && input.name.trim() ? input.name.trim().slice(0, 80) : "";
  if (!name) return err(422, "Give the destination a name.");
  const config = await parseConfig(type, input);
  if (typeof config === "string") return err(422, config);
  const id = newId("dst");
  await insertDestination({ id, name, type: type as "gmail" | "imap" | "forward", config });
  await recordAudit(actor, "destination.create", name, { id, type });
  return { ok: true, data: { id } };
}

export async function editDestination(actor: Actor, id: string, input: Record<string, unknown>): Promise<Result<Record<string, never>>> {
  const current = await getDestination(id);
  if (!current) return err(404, "No such destination.");
  const config = await parseConfig(current.type, input, current.config);
  if (typeof config === "string") return err(422, config);
  await updateDestination(id, { name: typeof input.name === "string" && input.name.trim() ? input.name.trim().slice(0, 80) : undefined, config });
  await recordAudit(actor, "destination.update", current.name, { id });
  return { ok: true, data: {} };
}

export async function removeDestination(actor: Actor, id: string): Promise<Result<Record<string, never>>> {
  const current = await getDestination(id);
  if (!current) return err(404, "No such destination.");
  const used = await routesUsingDestination(id);
  if (used.length) return err(409, `Remove this destination from its ${used.length} route(s) first.`);
  await deleteDestination(id);
  await recordAudit(actor, "destination.remove", current.name, { id });
  return { ok: true, data: {} };
}

export async function testDestination(actor: Actor, id: string): Promise<Result<{ message: string }>> {
  const current = await getDestination(id);
  if (!current) return err(404, "No such destination.");
  try {
    let message: string;
    if (current.type === "imap") message = await testImap(current.config as ImapConfig);
    else if (current.type === "gmail") {
      if (!(current.config as GmailConfig).refreshToken) return err(422, "Connect the Gmail account first.");
      message = await testGmail(current.config as GmailConfig);
    } else {
      const config = current.config as ForwardConfig;
      const verified = await verifiedDomainNames();
      if (!verified.includes(domainOf(config.from))) throw new Error(`The sender ${config.from} is not on a verified domain.`);
      message = `Ready. Mail is forwarded to ${config.address} from ${config.from}. Each forward counts against the Resend quota.`;
    }
    await setDestinationHealth(id, "ok", null);
    await recordAudit(actor, "destination.test", current.name, { ok: true });
    return { ok: true, data: { message } };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await setDestinationHealth(id, "failing", message);
    return err(422, message);
  }
}

export async function upsertRoute(actor: Actor, id: string | null, input: Record<string, unknown>): Promise<Result<{ id: string }>> {
  const kind = String(input.kind ?? "address");
  if (!["address", "wildcard", "catchall"].includes(kind)) return err(422, "Pick address, wildcard or catch-all.");
  const normalized = normalizeRoutePattern(kind, String(input.pattern ?? ""));
  if (!normalized) {
    return err(422, kind === "catchall" ? "Enter the domain for the catch-all, such as example.com." : kind === "wildcard" ? "Use * in the local part, such as support-*@example.com." : "Enter a full address, such as hello@example.com.");
  }
  const domains = await allDomainNames();
  if (!domains.includes(normalized.domain)) return err(422, `${normalized.domain} is not a Snapjaw domain. Add it under Domains first.`);
  const destinationIds = Array.isArray(input.destinationIds) ? [...new Set(input.destinationIds.map(String))] : [];
  if (!destinationIds.length) return err(422, "Pick at least one destination.");
  for (const destinationId of destinationIds) {
    const destination = await getDestination(destinationId);
    if (!destination) return err(422, "One of the destinations no longer exists.");
    if (destination.type === "forward" && (destination.config as ForwardConfig).address === normalized.pattern) return err(422, "A route cannot forward to its own address.");
  }
  const routeId = id ?? newId("rte");
  if (id && !(await getRoute(id))) return err(404, "No such route.");
  try {
    await saveRoute({ id: routeId, kind: kind as "address" | "wildcard" | "catchall", pattern: normalized.pattern, domain: normalized.domain, enabled: input.enabled !== false, note: typeof input.note === "string" ? input.note.slice(0, 200) : null }, destinationIds);
  } catch {
    return err(409, `A route for ${normalized.pattern} already exists.`);
  }
  await recordAudit(actor, id ? "route.update" : "route.create", normalized.pattern, { id: routeId, destinationIds });
  return { ok: true, data: { id: routeId } };
}

export async function removeRoute(actor: Actor, id: string): Promise<Result<Record<string, never>>> {
  const route = await getRoute(id);
  if (!route) return err(404, "No such route.");
  await deleteRoute(id);
  await recordAudit(actor, "route.remove", route.pattern, { id });
  return { ok: true, data: {} };
}
