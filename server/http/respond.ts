import { fail, ok } from "../../src/api/_http";

export type Outcome<T> = { ok: true; data: T } | { ok: false; status: number; error: string };

export function respond<T>(result: Outcome<T>, status = 200): Response {
  return result.ok ? ok(result.data, status) : fail(result.error, result.status);
}

export function badRequest(message = "The request body must be JSON."): Response {
  return fail(message, 400);
}
