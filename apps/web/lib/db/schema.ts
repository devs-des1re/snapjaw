import { integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

// Immutable snapshots; deletes are soft, so reads filter `deleted_at IS NULL`.
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
