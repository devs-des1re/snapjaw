import { timingSafeEqual } from "node:crypto";

import express, { type NextFunction, type Request, type Response } from "express";
import { z } from "zod";

import type { RunnerConfig } from "./config.js";
import { describeError, log } from "./logger.js";
import { PoolUnavailableError, type PoolManager } from "./pool-manager.js";
import { RunFailedError, runInContainer } from "./run-in-container.js";

/**
 * Deliberately looser than the web app's sharing limits. The web layer owns
 * the user-facing policy; these are the backstop for anything that reaches
 * the runner directly, so the two do not have to stay in lockstep.
 */
const BACKSTOP_MAX_FILES = 50;
const BACKSTOP_MAX_FILE_CHARACTERS = 256 * 1024;
const BACKSTOP_MAX_TOTAL_CHARACTERS = 1024 * 1024;

const fileNameSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(
    /^[A-Za-z0-9._-]+$/,
    "file names may only contain letters, numbers, dots, dashes and underscores",
  );

export const runRequestSchema = z
  .object({
    files: z
      .record(fileNameSchema, z.string().max(BACKSTOP_MAX_FILE_CHARACTERS))
      .refine((files) => Object.keys(files).length >= 1, "at least one file is required")
      .refine((files) => Object.keys(files).length <= BACKSTOP_MAX_FILES, "too many files")
      .refine(
        (files) =>
          Object.values(files).reduce((total, content) => total + content.length, 0) <=
          BACKSTOP_MAX_TOTAL_CHARACTERS,
        "project is too large",
      ),
    entryFile: z.string().min(1),
    timeoutMs: z.number().int().min(100).max(30_000).optional(),
  })
  .refine((value) => Object.hasOwn(value.files, value.entryFile), {
    message: "entryFile must be one of the files",
    path: ["entryFile"],
  });

function tokenMatches(expected: string, provided: string): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Optional shared secret between the web app and this service. Off unless
 * SANDBOX_RUNNER_TOKEN is set on both sides.
 */
function requireToken(config: RunnerConfig) {
  return (request: Request, response: Response, next: NextFunction): void => {
    if (!config.token) {
      next();
      return;
    }

    const header = request.get("authorization") ?? "";
    const provided = header.startsWith("Bearer ") ? header.slice(7) : "";

    if (!provided || !tokenMatches(config.token, provided)) {
      response.status(401).json({ error: "unauthorized" });
      return;
    }
    next();
  };
}

export function createApp(config: RunnerConfig, pool: PoolManager) {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "4mb" }));

  app.get("/health", (_request, response) => {
    const snapshot = pool.snapshot();
    response.json({
      status: snapshot.size > 0 ? "ok" : "degraded",
      pool: snapshot,
      timestamp: new Date().toISOString(),
    });
  });

  app.get("/pool", (_request, response) => {
    response.json(pool.snapshot());
  });

  app.post("/run", requireToken(config), async (request, response) => {
    const parsed = runRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({
        error: "invalid run request",
        details: parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
      });
      return;
    }

    const startedAt = Date.now();
    let member;
    try {
      member = await pool.acquire();
    } catch (error) {
      if (error instanceof PoolUnavailableError) {
        log("warn", "run rejected, no sandbox available", { error: error.message });
        response.status(503).json({ error: "every sandbox is busy, try again shortly" });
        return;
      }
      throw error;
    }

    try {
      const result = await runInContainer(member.name, parsed.data, config);

      log("info", "run completed", {
        entryFile: parsed.data.entryFile,
        fileCount: Object.keys(parsed.data.files).length,
        exitCode: result.exitCode,
        timedOut: result.timedOut,
        programMs: result.durationMs,
        wallMs: Date.now() - startedAt,
        captured: result.image !== null,
        display: result.hadDisplay,
        container: member.name,
      });

      response.json({ entryFile: parsed.data.entryFile, ...result });
    } catch (error) {
      if (error instanceof RunFailedError) {
        log("error", "run failed in the sandbox", {
          entryFile: parsed.data.entryFile,
          container: member.name,
          error: error.message,
          wallMs: Date.now() - startedAt,
        });
        response.status(502).json({ error: error.message });
        return;
      }
      throw error;
    } finally {
      await pool.release(member);
    }
  });

  app.use((_request, response) => {
    response.status(404).json({ error: "not found" });
  });

  app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    const status =
      typeof error === "object" && error !== null && "status" in error
        ? Number((error as { status?: unknown }).status) || 500
        : 500;

    if (status === 413) {
      response.status(413).json({ error: "request body is too large" });
      return;
    }

    log("error", "unhandled request error", { error: describeError(error) });
    response.status(status >= 400 && status < 600 ? status : 500).json({ error: "internal error" });
  });

  return app;
}
