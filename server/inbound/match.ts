import { domainOf } from "../../lib/address";

export type RouteRule = { id: string; kind: "address" | "wildcard" | "catchall"; pattern: string; domain: string; enabled: boolean; destinationIds: string[] };

function wildcardRegex(pattern: string): RegExp {
  const escaped = pattern.toLowerCase().replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^@]*");
  return new RegExp(`^${escaped}$`);
}

export function matchRoute(recipient: string, rules: RouteRule[]): RouteRule | null {
  const address = recipient.trim().toLowerCase();
  const domain = domainOf(address);
  const active = rules.filter((rule) => rule.enabled);
  const exact = active.find((rule) => rule.kind === "address" && rule.pattern.toLowerCase() === address);
  if (exact) return exact;
  const wildcards = active
    .filter((rule) => rule.kind === "wildcard" && wildcardRegex(rule.pattern).test(address))
    .sort((a, b) => b.pattern.replace(/\*/g, "").length - a.pattern.replace(/\*/g, "").length);
  if (wildcards[0]) return wildcards[0];
  return active.find((rule) => rule.kind === "catchall" && rule.domain === domain) ?? null;
}

export function normalizeRoutePattern(kind: string, pattern: string): { pattern: string; domain: string } | null {
  const value = pattern.trim().toLowerCase();
  if (kind === "catchall") {
    const domain = value.replace(/^\*?@/, "");
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) return null;
    return { pattern: `*@${domain}`, domain };
  }
  const at = value.lastIndexOf("@");
  if (at <= 0) return null;
  const local = value.slice(0, at);
  const domain = value.slice(at + 1);
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) return null;
  if (kind === "address" && !/^[a-z0-9!#$%&'+/=?^_`{|}~.-]+$/.test(local)) return null;
  if (kind === "wildcard" && (!local.includes("*") || !/^[a-z0-9!#$%&'+/=?^_`{|}~.*-]+$/.test(local))) return null;
  return { pattern: `${local}@${domain}`, domain };
}
