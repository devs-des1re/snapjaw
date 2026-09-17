import { timingSafeEqual } from "node:crypto";

import express, { type NextFunction, type Request, type Response } from "express";
import { z } from "zod";

import type { RunnerConfig } from "./config.js";
import { describeError, log } from "./logger.js";
import { PoolUnavailableError, type PoolManager } from "./pool-manager.js";
import { RunFailedError, runInContainer } from "./run-in-container.js";

// Backstop only: the web layer owns the user-facing limits.
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

  app.post("/run/stream", requireToken(config), async (request, response) => {
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
        log("warn", "stream rejected, no sandbox available", { error: error.message });
        response.status(503).json({ error: "every sandbox is busy, try again shortly" });
        return;
      }
      throw error;
    }

    // Without these headers a proxy would buffer the stream.
    response.status(200);
    response.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
    response.setHeader("Cache-Control", "no-store, no-transform");
    response.setHeader("X-Accel-Buffering", "no");
    response.flushHeaders();

    const controller = new AbortController();
    let clientGone = false;
    request.on("close", () => {
      clientGone = true;
      controller.abort();
    });

    const write = (payload: unknown): void => {
      if (clientGone || response.writableEnded) return;
      response.write(`${JSON.stringify(payload)}\n`);
    };

    try {
      const result = await runInContainer(member.name, parsed.data, config, {
        signal: controller.signal,
        onFrame: (frame) => {
          write({
            type: "frame",
            seq: frame.seq,
            atMs: frame.atMs,
            format: frame.format,
            data: frame.data,
          });
        },
      });

      write({ type: "result", entryFile: parsed.data.entryFile, ...result });

      log("info", "streamed run completed", {
        entryFile: parsed.data.entryFile,
        exitCode: result.exitCode,
        timedOut: result.timedOut,
        frames: result.frameCount,
        programMs: result.durationMs,
        wallMs: Date.now() - startedAt,
        container: member.name,
      });
    } catch (error) {
      if (clientGone) {
        log("info", "streaming run abandoned by the client", {
          entryFile: parsed.data.entryFile,
          wallMs: Date.now() - startedAt,
        });
      } else {
        const message =
          error instanceof RunFailedError ? error.message : "the sandbox failed during the run";
        write({ type: "error", message });
        log("error", "streamed run failed", {
          entryFile: parsed.data.entryFile,
          container: member.name,
          error: describeError(error),
        });
      }
    } finally {
      await pool.release(member);
      if (!response.writableEnded) response.end();
    }
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
