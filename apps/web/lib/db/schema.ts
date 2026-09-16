import { integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * A shared project: the user's files plus the editor state needed to reopen
 * them exactly as they were.
 *
 * Shares are immutable snapshots. v1 has no update endpoint, so `updated_at`
 * only ever matches `created_at`; the column exists so a future edit endpoint
 * can bump it. Deletes are soft — reads filter on `deleted_at IS NULL`.
 */
export const sharedFiles = pgTable("shared_files", {
  id: uuid("id").primaryKey().defaultRandom(),
  files: jsonb("files").$type<Record<string, string>>().notNull(),
  entryFile: text("entry_file").notNull(),
  fontSize: integer("font_size").notNull().default(14),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export type SharedFileRow = typeof sharedFiles.$inferSelect;
export type NewSharedFileRow = typeof sharedFiles.$inferInsert;
