# Snapjaw

A Trinket-style online code editor for Python. Write code in your browser, run it in a real
sandboxed container — turtle and tkinter output included — and share your files with a link.

![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=nextdotjs&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178c6?logo=typescript&logoColor=white)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-4-06b6d4?logo=tailwindcss&logoColor=white)
![Postgres](https://img.shields.io/badge/Postgres-Drizzle-4169e1?logo=postgresql&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-sandboxed-2496ed?logo=docker&logoColor=white)
![License](https://img.shields.io/badge/license-MIT-0099ff)

## Status

Phase 3 of 4 is complete: real sandboxed execution. **Run** now executes Python in a disposable
container and returns genuine stdout, stderr and exit codes, with turtle and tkinter windows
captured as screenshots.

| Phase | Scope                             | State |
| ----- | --------------------------------- | ----- |
| 1     | Editor UI shell                   | Done  |
| 2     | Database and file sharing         | Done  |
| 3     | Sandbox runner and real execution | Done  |
| 4     | Deployment and polish             | Next  |

## Repository layout

```
snapjaw/
├── apps/
│   └── web/                       Next.js app — editor UI, API routes, sharing
│       ├── app/api/               health, ping, run, shared-files
│       ├── app/s/[id]/            shared file view
│       ├── lib/db/                schema, connection, queries
│       ├── lib/ratelimit.ts       Upstash limiter, /api/run only
│       └── drizzle/               generated migrations
└── services/
    └── sandbox-runner/            Warm container pool that runs untrusted Python
        ├── src/                   Express server, pool manager, docker wrapper
        └── runner-image/          Python + Tk + Xvfb image and the in-container executor
```

The sandbox runner is a separate service on purpose. Untrusted user code must never execute
inside the Next.js process, where it would share an address space with the database credentials
and application internals.

## Getting started

Requires Node.js 20.9 or newer, a Postgres database, and Docker.

```bash
npm install
npm run image:build --workspace @snapjaw/sandbox-runner   # build the sandbox image
npm run db:migrate                                        # after setting DATABASE_URL
npm run dev                                               # web app on :3000
npm run dev --workspace @snapjaw/sandbox-runner           # runner on :4000
```

Environment variables live in `.env.example` files (committed) alongside git-ignored `.env.local`
files. Neither contains comments — the key names are the documentation.

| Variable               | Where  | Purpose                                                                                               |
| ---------------------- | ------ | ----------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`         | web    | Postgres connection string. Required.                                                                 |
| `APP_URL`              | web    | Public origin used to build share links. Falls back to the request's forwarded host, then its origin. |
| `SANDBOX_RUNNER_URL`   | web    | Base URL of the runner service. Required for Run.                                                     |
| `SANDBOX_RUNNER_TOKEN` | both   | Optional shared secret. When set on both sides, `/run` requires it.                                   |
| `UPSTASH_REDIS_REST_*` | web    | Enables rate limiting on `/api/run`. Without them the limiter is disabled and logs a warning.         |
| `RUN_RATE_LIMIT`       | web    | Runs allowed per window. Default `10`.                                                                |
| `RUN_RATE_WINDOW`      | web    | Rate limit window. Default `1 m`.                                                                     |
| `SANDBOX_POOL_SIZE`    | runner | Warm containers to keep. Default `3`.                                                                 |
| `SANDBOX_TIMEOUT_MS`   | runner | Wall clock per program. Default `5000`.                                                               |
| `SANDBOX_MEMORY`       | runner | Per-container memory cap. Default `256m`.                                                             |
| `SANDBOX_CPUS`         | runner | Per-container CPU cap. Default `1`.                                                                   |

`APP_URL` is deliberately **not** prefixed `NEXT_PUBLIC_`. That prefix gets inlined at build time,
which would bake one environment's URL into every deployment.

## Scripts

Run from the repository root. `dev`, `build`, `start`, `lint`, `typecheck`, `test` and the `db:*`
commands delegate to the workspace packages.

| Script                 | Purpose                                  |
| ---------------------- | ---------------------------------------- |
| `npm run dev`          | Start the web app in development         |
| `npm run build`        | Production build                         |
| `npm start`            | Serve the production build               |
| `npm run db:generate`  | Generate a migration from the schema     |
| `npm run db:migrate`   | Apply pending migrations                 |
| `npm run db:push`      | Push the schema straight to the database |
| `npm run lint`         | ESLint                                   |
| `npm run typecheck`    | `tsc --noEmit`                           |
| `npm test`             | Vitest, both workspaces                  |
| `npm run format`       | Prettier, writes changes                 |
| `npm run format:check` | Prettier, check only                     |

## API

Every response carries `timestamp` and `version`. Success payloads are spread at the top level;
failures always use the same shape:

```json
{
  "error": { "code": "NOT_FOUND", "message": "That shared file does not exist." },
  "timestamp": "2026-09-16T19:08:04.061Z",
  "version": "0.3.0"
}
```

| Method | Route                    | Notes                                                             |
| ------ | ------------------------ | ----------------------------------------------------------------- |
| `GET`  | `/api/health`            | `{ "status": "ok" }`. Liveness only — never touches the database. |
| `GET`  | `/api/ping`              | `{ "pong": true, "latencyMs": n }` — server handling time.        |
| `POST` | `/api/run`               | Execute a project. Rate limited. Returns the run result.          |
| `POST` | `/api/shared-files`      | Store a project, return `{ id, url, path }`. `201`.               |
| `GET`  | `/api/shared-files/[id]` | Fetch a shared project. `404` if absent or soft-deleted.          |

Validation is Zod on every request body. Status codes: `400` malformed or invalid, `404` missing,
`413` oversized, `429` rate limited, `502` the sandbox failed, `503` the sandbox is unavailable,
`500` unexpected.

## The sandbox

A run goes: editor → `POST /api/run` → the runner service → `docker exec` into a warm container.
The Next.js process never executes user code.

### Warm container pool

The runner keeps `SANDBOX_POOL_SIZE` containers running `runner-image`, each idling on
`sleep infinity`. A run acquires one, executes through a single `docker exec`, and then the
container is reset and returned to the pool. If every container is busy the request queues for
`SANDBOX_ACQUIRE_TIMEOUT_MS` before giving up with `503`.

Members are health-checked on a timer and replaced when they stop responding. A member held far
longer than any run could legitimately take is reclaimed too — otherwise a wedged reset would
shrink the pool permanently, since busy members are skipped by the normal health check.

### Isolation

Each container is started with:

| Flag                               | Effect                                                         |
| ---------------------------------- | -------------------------------------------------------------- |
| `--network none`                   | No network access at all.                                      |
| `--read-only`                      | Root filesystem is immutable; only a `/tmp` tmpfs is writable. |
| `--tmpfs /tmp:rw,size=…,mode=1777` | The single scratch area.                                       |
| `--memory` / `--memory-swap`       | Hard memory cap.                                               |
| `--cpus`                           | CPU cap.                                                       |
| `--pids-limit`                     | Fork bomb ceiling.                                             |
| `--cap-drop ALL`                   | No Linux capabilities.                                         |
| `--security-opt no-new-privileges` | Cannot gain privileges.                                        |

Inside, the image runs as an unprivileged `sandbox` user (uid 1000), and the executor refuses file
names containing path separators, so a project cannot write outside its scratch directory.

Between runs the container is swept: stray executors and X servers are killed, and every entry
under `/tmp` is deleted. Because the container is read-only, that is a complete wipe — a previous
project's files cannot be observed by the next one.

### Display capture

`turtle` and `tkinter` need an X display, so for projects that import them the executor starts a
private Xvfb, runs the program with `DISPLAY` pointed at it, and screenshots the root window with
ImageMagick.

The executor samples the display repeatedly and stops as soon as two consecutive frames are
identical — a window that has stopped changing is a program sitting in its main loop, and there is
no reason to burn the whole timeout on it. A frame is only accepted when a window has actually been
mapped, so a console program cannot come back with a screenshot of an empty display.

**Programs must keep their window open to be captured.** Call `turtle.done()` or `root.mainloop()`.
Without it the interpreter exits, Tk destroys the window, and there is nothing left to photograph —
the same thing that happens on a desktop.

### Docker access: socket mount, not DinD

The runner is given the host's Docker socket. In `docker-compose.yml` that is:

```yaml
volumes:
  - /var/run/docker.sock:/var/run/docker.sock
```

**Why not Docker-in-Docker?** DinD runs a second daemon inside the runner container, which needs
`--privileged`, its own storage driver and image cache, and a nested network setup. The socket mount
needs one line and reuses the host's image cache, so the sandbox image is built once. The tradeoff is
that socket access is effectively root on the host, which is acceptable for a single-tenant
self-hosted deployment: the runner is never publicly reachable, and the untrusted code itself runs
in _sibling_ containers that are unprivileged, networkless and read-only.

The runner shells out to the `docker` CLI rather than using a client library. The CLI already knows
how to reach the socket on every platform, and the runner does no container work beyond `run` and
`exec`.

## Database

Postgres via Drizzle. One table, `shared_files`, holding `files` as `jsonb`, the `entry_file`, and
the `font_size` to restore on open. UUID primary keys, `created_at`/`updated_at` on every row, and a
`deleted_at` soft-delete column that all reads filter on.

Shares are **immutable snapshots** — v1 has no update endpoint, so editing a shared project and
sharing again creates a new link rather than mutating the old one.

`jsonb` does not preserve key order, so tab order is rebuilt deterministically when a share is
opened: the entry file first, then the rest alphabetically.

Both services log structured JSON to `logs/<timestamp>.log` and mirror it to stdout.

## Design notes

- Dark theme only, always on. There is no light mode.
- The accent colour is `#0099ff`, used sparingly: the Run button, the active tab border, and focus
  rings. Never as a glow or a box-shadow.
- Design tokens (colour, spacing, radius, type) are declared once in `apps/web/app/globals.css`
  via Tailwind's `@theme`, not split across files.
- This is **file sharing**, not "snippets" — the database table, routes, and UI copy all say
  "files".

## License

MIT — see [LICENSE](./LICENSE).
