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
