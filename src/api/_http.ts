import pkg from "../../package.json" with { type: "json" };

function envelope<T>(body: T) {
  return {
    ...body,
    timestamp: new Date().toISOString(),
    version: pkg.version,
  };
}

export function ok<T>(data: T, status = 200): Response {
  return Response.json(envelope({ data }), { status });
}

export function fail(message: string, status = 400): Response {
  return Response.json(envelope({ error: message }), { status });
}

export function resendCompat(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers });
}

export function resendCompatError(statusCode: number, name: string, message: string): Response {
  return Response.json({ statusCode, name, message }, { status: statusCode });
}
