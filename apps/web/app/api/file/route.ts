import { jsonError, jsonOk } from "@/lib/api/response";
import { shareUrlFor } from "@/lib/api/share-url";
import { createSharedFile } from "@/lib/db/queries/shared-files";
import { describeError, log } from "@/lib/logger";
import { MAX_TOTAL_CHARACTERS, createSharedFileSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

// Checked before parsing so an oversized body is rejected without buffering it.
const MAX_REQUEST_BYTES = 2 * 1024 * 1024;

// POST /api/file — store a project and return its shareable link.
export async function POST(request: Request): Promise<Response> {
  const startedAt = Date.now();

  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BYTES) {
    return jsonError("PAYLOAD_TOO_LARGE", "That request body is too large.");
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("BAD_REQUEST", "Request body must be valid JSON.");
  }

  const parsed = createSharedFileSchema.safeParse(body);
  if (!parsed.success) {
    const details = parsed.error.issues.map((issue) => {
      const field = issue.path.join(".");
      return field ? `${field}: ${issue.message}` : issue.message;
    });
    log("warn", "file rejected", { details, durationMs: Date.now() - startedAt });
    return jsonError("VALIDATION_ERROR", "Those files could not be shared.", details);
  }

  const { files, entryFile, fontSize, history } = parsed.data;

  try {
    const record = await createSharedFile({ files, entryFile, fontSize, history: history ?? [] });

    log("info", "file created", {
      id: record.id,
      fileCount: Object.keys(files).length,
      characters: Object.values(files).reduce((total, content) => total + content.length, 0),
      maxCharacters: MAX_TOTAL_CHARACTERS,
      historyEntries: record.history.length,
      durationMs: Date.now() - startedAt,
    });

    return jsonOk(
      {
        id: record.id,
        url: shareUrlFor(request, record.id),
        path: `/file/${record.id}`,
        entryFile: record.entryFile,
        fontSize: record.fontSize,
        createdAt: record.createdAt.toISOString(),
      },
      201,
    );
  } catch (error) {
    log("error", "file creation failed", {
      error: describeError(error),
      durationMs: Date.now() - startedAt,
    });
    return jsonError("INTERNAL_ERROR", "Could not save those files. Try again.");
  }
}
