export type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number; error: string };

async function call<T>(method: string, path: string, body?: unknown): Promise<ApiResult<T>> {
  try {
    const response = await fetch(path, {
      method,
      credentials: "same-origin",
      headers: body === undefined ? { accept: "application/json" } : { accept: "application/json", "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = (await response.json().catch(() => null)) as { data?: T; error?: string } | null;
    if (response.status === 401 && typeof window !== "undefined" && !path.startsWith("/api/auth")) {
      window.location.href = `/login?callbackUrl=${encodeURIComponent(window.location.pathname + window.location.search)}`;
    }
    if (!response.ok || !json || json.error !== undefined) {
      return { ok: false, status: response.status, error: json?.error ?? `Request failed with status ${response.status}.` };
    }
    return { ok: true, data: json.data as T };
  } catch {
    return { ok: false, status: 0, error: "Could not reach Snapjaw. Check your connection." };
  }
}

export const api = {
  get: <T>(path: string) => call<T>("GET", path),
  post: <T>(path: string, body: unknown = {}) => call<T>("POST", path, body),
  patch: <T>(path: string, body: unknown) => call<T>("PATCH", path, body),
  put: <T>(path: string, body: unknown) => call<T>("PUT", path, body),
  del: <T>(path: string) => call<T>("DELETE", path),
};

export function formData(event: Event): Record<string, string> {
  const form = event.currentTarget as HTMLFormElement;
  const out: Record<string, string> = {};
  new FormData(form).forEach((value, key) => {
    if (typeof value === "string") out[key] = value;
  });
  return out;
}

export function formatDate(value: string | number | Date | null | undefined): string {
  if (value === null || value === undefined || value === "") return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString(undefined, { year: "numeric", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export function formatRelative(value: string | number | Date | null | undefined): string {
  if (value === null || value === undefined || value === "") return "never";
  const date = new Date(value).getTime();
  const diff = Math.round((Date.now() - date) / 1000);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} h ago`;
  return `${Math.floor(diff / 86400)} d ago`;
}

export function formatBytes(bytes: number | null | undefined): string {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function queryParam(name: string): string {
  return new URLSearchParams(window.location.search).get(name) ?? "";
}

export function fillForm(root: ParentNode, values: Record<string, string | boolean | number | null | undefined>) {
  for (const [name, value] of Object.entries(values)) {
    const field = root.querySelector<HTMLInputElement | HTMLSelectElement>(`[name="${CSS.escape(name)}"]`);
    if (!field) continue;
    if (field instanceof HTMLInputElement && field.type === "checkbox") field.checked = value === true || value === "true";
    else if (field instanceof HTMLInputElement && field.type === "password") continue;
    else field.value = value === null || value === undefined ? "" : String(value);
  }
}
