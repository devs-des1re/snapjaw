import { jsonError, jsonOk } from "@/lib/api/response";
import { getSharedFileById } from "@/lib/db/queries/shared-files";
import { describeError, log } from "@/lib/logger";
import { sharedFileIdSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

/** GET /api/shared-files/[id] — fetch one shared project. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const startedAt = Date.now();
  const { id } = await params;

  const parsedId = sharedFileIdSchema.safeParse(id);
  if (!parsedId.success) {
    return jsonError("BAD_REQUEST", "That is not a valid shared file id.");
  }

  try {
    const record = await getSharedFileById(parsedId.data);
    if (!record) {
      return jsonError("NOT_FOUND", "That shared file does not exist.");
    }

    log("info", "shared file read", { id: record.id, durationMs: Date.now() - startedAt });

    return jsonOk({
      id: record.id,
      files: record.files,
      entryFile: record.entryFile,
      fontSize: record.fontSize,
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    });
  } catch (error) {
    log("error", "shared file read failed", {
      id: parsedId.data,
      error: describeError(error),
      durationMs: Date.now() - startedAt,
    });
    return jsonError("INTERNAL_ERROR", "Could not load that shared file. Try again.");
  }
}
