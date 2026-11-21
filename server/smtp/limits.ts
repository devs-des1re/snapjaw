type Entry = { count: number; first: number };

const windowMs = 15 * 60 * 1000;
const maxFailures = 5;

const store = globalThis as typeof globalThis & { __snapjawSmtpFailures?: Map<string, Entry> };

function map() {
  store.__snapjawSmtpFailures ??= new Map();
  return store.__snapjawSmtpFailures;
}

export const authFailures = {
  blocked(ip: string): boolean {
    const entry = map().get(ip);
    if (!entry) return false;
    if (Date.now() - entry.first > windowMs) {
      map().delete(ip);
      return false;
    }
    return entry.count >= maxFailures;
  },
  fail(ip: string) {
    const entry = map().get(ip);
    if (!entry || Date.now() - entry.first > windowMs) map().set(ip, { count: 1, first: Date.now() });
    else entry.count += 1;
  },
  clear(ip: string) {
    map().delete(ip);
  },
};
