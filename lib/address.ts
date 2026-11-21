const emailPattern = /^[^\s@<>()[\]\\,;:"]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i;

export function isEmail(value: unknown): value is string {
  return typeof value === "string" && value.length <= 254 && emailPattern.test(value.trim());
}

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function domainOf(address: string): string {
  const at = address.lastIndexOf("@");
  return at === -1 ? "" : address.slice(at + 1).toLowerCase();
}

export function localPart(address: string): string {
  const at = address.lastIndexOf("@");
  return at === -1 ? address : address.slice(0, at).toLowerCase();
}

export function isDomain(value: unknown): value is string {
  return typeof value === "string" && /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i.test(value.trim());
}

export function senderAllowed(address: string, allowed: string[]): boolean {
  const email = normalizeEmail(address);
  const domain = domainOf(email);
  return allowed.some((entry) => {
    const rule = entry.trim().toLowerCase();
    if (!rule) return false;
    if (rule.startsWith("@")) return domain === rule.slice(1);
    return email === rule;
  });
}

export function extractAddress(value: string): string {
  const match = value.match(/<([^>]+)>/);
  return normalizeEmail(match ? match[1]! : value);
}
