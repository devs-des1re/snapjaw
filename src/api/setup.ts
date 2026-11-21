import { fail, ok } from "./_http";
import { completeSetup } from "../../server/admin/setup";
import { isSameOrigin, readJson, requestInfo } from "../../server/http/request";
import { countUsers } from "../../db/queries/users";
import { badRequest } from "../../server/http/respond";

export async function GET() {
  return ok({ needed: (await countUsers()) === 0 });
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return fail("Cross-site request blocked.", 403);
  const body = await readJson<Record<string, unknown>>(request);
  if (!body) return badRequest();
  const result = await completeSetup(
    {
      token: String(body.token ?? ""),
      email: String(body.email ?? ""),
      name: String(body.name ?? ""),
      password: String(body.password ?? ""),
    },
    requestInfo(request),
  );
  return result.ok ? ok({ id: result.id }, 201) : fail(result.error, result.status);
}
