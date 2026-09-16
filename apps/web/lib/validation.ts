import { z } from "zod";

import { DEFAULT_FONT_SIZE, MAX_FONT_SIZE, MIN_FONT_SIZE } from "@/lib/project";

export const MAX_SHARED_FILES = 20;
export const MAX_FILE_NAME_LENGTH = 64;
export const MAX_FILE_CHARACTERS = 128 * 1024;
export const MAX_TOTAL_CHARACTERS = 512 * 1024;

const fileNameSchema = z
  .string()
  .min(1, "File names cannot be empty.")
  .max(MAX_FILE_NAME_LENGTH, `File names are limited to ${MAX_FILE_NAME_LENGTH} characters.`)
  .regex(
    /^[A-Za-z0-9._-]+$/,
    "File names may only contain letters, numbers, dots, dashes and underscores.",
  );

export const sharedFilesSchema = z
  .record(fileNameSchema, z.string().max(MAX_FILE_CHARACTERS, "That file is too large to share."))
  .refine((files) => Object.keys(files).length >= 1, "Share at least one file.")
  .refine(
    (files) => Object.keys(files).length <= MAX_SHARED_FILES,
    `Share at most ${MAX_SHARED_FILES} files.`,
  )
  .refine(
    (files) =>
      Object.values(files).reduce((total, content) => total + content.length, 0) <=
      MAX_TOTAL_CHARACTERS,
    "Those files are too large to share.",
  );

export const createSharedFileSchema = z
  .object({
    files: sharedFilesSchema,
    entryFile: z.string().min(1, "An entry file is required."),
    fontSize: z
      .number()
      .int("Font size must be a whole number.")
      .min(MIN_FONT_SIZE)
      .max(MAX_FONT_SIZE)
      .default(DEFAULT_FONT_SIZE),
  })
  .refine((value) => Object.hasOwn(value.files, value.entryFile), {
    message: "The entry file must be one of the shared files.",
    path: ["entryFile"],
  });

export type CreateSharedFileInput = z.infer<typeof createSharedFileSchema>;

export const sharedFileIdSchema = z.uuid("That is not a valid shared file id.");

/** POST /api/run — the same project shape, minus anything about persistence. */
export const runRequestSchema = z
  .object({
    files: sharedFilesSchema,
    entryFile: z.string().min(1, "An entry file is required."),
  })
  .refine((value) => Object.hasOwn(value.files, value.entryFile), {
    message: "The entry file must be one of the project's files.",
    path: ["entryFile"],
  });

export type RunRequestInput = z.infer<typeof runRequestSchema>;

/** What the sandbox runner is expected to hand back. */
export const runnerRunResultSchema = z.object({
  entryFile: z.string(),
  stdout: z.string(),
  stderr: z.string(),
  exitCode: z.number().int(),
  durationMs: z.number(),
  timedOut: z.boolean(),
  image: z.string().nullable(),
  hadDisplay: z.boolean().optional(),
});
