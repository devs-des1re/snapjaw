import http from "node:http";
import type { AddressInfo } from "node:net";

export type Sent = { body: Record<string, unknown>; idempotencyKey: string | undefined };

export type Received = { id: string; from: string; to: string[]; subject: string; raw: string; created_at: string; message_id: string; headers?: Record<string, string> };

export type FakeResend = {
  url: string;
  sent: Sent[];
  received: Map<string, Received>;
  domains: { id: string; name: string; status: string; records: unknown[]; capabilities: Record<string, string> }[];
  failNextSends: number;
  close: () => Promise<void>;
};

export async function startFakeResend(): Promise<FakeResend> {
  const state: Omit<FakeResend, "url" | "close"> = { sent: [], received: new Map(), domains: [], failNextSends: 0 };
  const idempotent = new Map<string, string>();
  const server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const text = Buffer.concat(chunks).toString("utf8");
    const url = new URL(req.url ?? "/", "http://localhost");
    const json = (status: number, body: unknown, headers: Record<string, string> = {}) => {
      res.writeHead(status, { "content-type": "application/json", ...headers });
      res.end(JSON.stringify(body));
    };
    if (url.pathname.startsWith("/raw/")) {
      const item = state.received.get(url.pathname.slice(5));
      if (!item) return json(404, { name: "not_found", message: "missing" });
      res.writeHead(200, { "content-type": "message/rfc822" });
      return res.end(item.raw);
    }
    if (req.headers.authorization !== "Bearer re_test_key") return json(401, { name: "missing_api_key", message: "Missing API key" });
    if (req.method === "POST" && url.pathname === "/emails") {
      const key = req.headers["idempotency-key"] as string | undefined;
      if (state.failNextSends > 0) {
        state.failNextSends -= 1;
        return json(500, { name: "application_error", message: "Internal error" });
      }
      if (key && idempotent.has(key)) return json(200, { id: idempotent.get(key) }, { "x-resend-daily-quota": String(state.sent.length) });
      const id = `re_sent_${state.sent.length + 1}`;
      state.sent.push({ body: JSON.parse(text), idempotencyKey: key });
      if (key) idempotent.set(key, id);
      return json(200, { id }, { "x-resend-daily-quota": String(state.sent.length) });
    }
    if (req.method === "GET" && url.pathname === "/emails/receiving") {
      return json(200, { object: "list", has_more: false, data: [...state.received.values()].map((r) => ({ id: r.id, from: r.from, to: r.to, subject: r.subject, created_at: r.created_at, message_id: r.message_id })) });
    }
    const receivedMatch = url.pathname.match(/^\/emails\/receiving\/([^/]+)$/);
    if (req.method === "GET" && receivedMatch) {
      const item = state.received.get(receivedMatch[1]!);
      if (!item) return json(404, { name: "not_found", message: "Email not found" });
      const address = server.address() as AddressInfo;
      return json(200, {
        object: "email",
        id: item.id,
        from: item.from,
        to: item.to,
        subject: item.subject,
        created_at: item.created_at,
        message_id: item.message_id,
        headers: item.headers ?? {},
        received_for: item.to,
        raw: { download_url: `http://127.0.0.1:${address.port}/raw/${item.id}`, expires_at: new Date(Date.now() + 3600_000).toISOString() },
        attachments: [],
      });
    }
    if (req.method === "GET" && url.pathname === "/domains") return json(200, { object: "list", data: state.domains });
    const domainMatch = url.pathname.match(/^\/domains\/([^/]+)(\/verify)?$/);
    if (domainMatch) {
      const domain = state.domains.find((d) => d.id === domainMatch[1]);
      if (!domain) return json(404, { name: "not_found", message: "Domain not found" });
      if (domainMatch[2]) return json(200, { object: "domain", id: domain.id });
      return json(200, { object: "domain", ...domain });
    }
    if (req.method === "POST" && url.pathname === "/domains") {
      const body = JSON.parse(text) as { name: string; capabilities?: Record<string, string> };
      const domain = { id: `dom_${state.domains.length + 1}`, name: body.name, status: "verified", capabilities: { sending: "enabled", receiving: body.capabilities?.receiving ?? "disabled" }, records: [{ record: "DKIM", name: "resend._domainkey", type: "TXT", ttl: "Auto", status: "verified", value: "p=abc" }] };
      state.domains.push(domain);
      return json(200, { object: "domain", ...domain });
    }
    return json(404, { name: "not_found", message: `No fake for ${req.method} ${url.pathname}` });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address() as AddressInfo;
  return Object.assign(state, {
    url: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }) as FakeResend;
}
