import { and, eq, isNull } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { sharedFiles, type SharedFileRow } from "@/lib/db/schema";

export type SharedFileRecord = SharedFileRow;

export interface CreateSharedFileInput {
  files: Record<string, string>;
  entryFile: string;
  fontSize: number;
}

export async function createSharedFile(input: CreateSharedFileInput): Promise<SharedFileRecord> {
  const rows = await getDb().insert(sharedFiles).values(input).returning();

  const row = rows[0];
  if (!row) {
    throw new Error("Insert into shared_files returned no row.");
  }
  return row;
}

export async function getSharedFileById(id: string): Promise<SharedFileRecord | null> {
  const rows = await getDb()
    .select()
    .from(sharedFiles)
    .where(and(eq(sharedFiles.id, id), isNull(sharedFiles.deletedAt)))
    .limit(1);

  return rows[0] ?? null;
}
