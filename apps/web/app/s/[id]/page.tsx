import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { EditorWorkspace } from "@/components/blocks/editor-workspace";
import { getSharedFileById } from "@/lib/db/queries/shared-files";
import { describeError, log } from "@/lib/logger";
import { projectFilesFromRecord } from "@/lib/project";
import { sharedFileIdSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Shared files — Snapjaw",
};

export default async function SharedFilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const parsedId = sharedFileIdSchema.safeParse(id);
  if (!parsedId.success) notFound();

  let record;
  try {
    record = await getSharedFileById(parsedId.data);
  } catch (error) {
    log("error", "shared file page failed to load", {
      id: parsedId.data,
      error: describeError(error),
    });
    throw error;
  }

  if (!record) notFound();

  const project = projectFilesFromRecord(record.files, record.entryFile);

  return (
    <EditorWorkspace
      initialFiles={project.files}
      initialActiveFile={project.activeFile}
      initialFontSize={record.fontSize}
    />
  );
}
