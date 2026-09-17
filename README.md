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

v1 — complete. Write Python in the browser, run it in a disposable sandbox with turtle and tkinter
rendered live at up to 60fps, and share your files with a link.

| Phase | Scope                             | State |
| ----- | --------------------------------- | ----- |
| 1     | Editor UI shell                   | Done  |
| 2     | Database and file sharing         | Done  |
| 3     | Sandbox runner and real execution | Done  |
| 4     | Deployment and polish             | Done  |

## Repository layout

```
snapjaw/
├── apps/
│   └── web/                       Next.js app — editor UI, API routes, sharing
│       ├── app/api/               health, ping, run, run/stream, shared-files
│       ├── app/s/[id]/            shared file view
│       ├── lib/db/                schema, connection, queries
│       ├── lib/ratelimit.ts       Upstash limiter, /api/run/stream only
│       ├── drizzle/               generated migrations
│       └── Dockerfile             three targets: builder, migrator, runner
├── services/
│   └── sandbox-runner/            Warm container pool that runs untrusted Python
│       ├── src/                   Express server, pool manager, docker wrapper
│       ├── runner-image/          Python + Tk + Xvfb image and the in-container executor
│       └── Dockerfile             the runner service's own image
└── docker-compose.yml             postgres + migrate + sandbox-runner + web
```

The sandbox runner is a separate service on purpose. Untrusted user code must never execute
inside the Next.js process, where it would share an address space with the database credentials
and application internals.

## Getting started

Requires Node.js 20.9 or newer, a Postgres database, and Docker.

```bash
npm install
npm run image:build   # build the sandbox image (once, or after editing runner-image/)
npm run db:migrate    # after setting DATABASE_URL
npm run dev:all       # runner on :4000 and the web app on :3000
```

`npm run dev` starts the web app alone, which is enough for editing and sharing but leaves **Run**
reporting that the sandbox is unavailable — execution lives in the separate runner service. Use
`npm run dev:all` for both, or `npm run dev` and `npm run dev:runner` in two terminals.

Environment variables live in `.env.example` files (committed) alongside git-ignored `.env.local`
files. Neither contains comments — the key names are the documentation.

| Variable                         | Where  | Purpose                                                                                               |
| -------------------------------- | ------ | ----------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                   | web    | Postgres connection string. Required.                                                                 |
| `APP_URL`                        | web    | Public origin used to build share links. Falls back to the request's forwarded host, then its origin. |
| `SANDBOX_RUNNER_URL`             | web    | Base URL of the runner service. Required for Run.                                                     |
| `SANDBOX_RUNNER_TOKEN`           | both   | Optional shared secret. When set on both sides, `/run` requires it.                                   |
| `UPSTASH_REDIS_REST_*`           | web    | Enables rate limiting on `/api/run`. Without them the limiter is disabled and logs a warning.         |
| `RUN_RATE_LIMIT`                 | web    | Runs allowed per window. Default `10`.                                                                |
| `RUN_RATE_WINDOW`                | web    | Rate limit window. Default `1 m`.                                                                     |
| `SANDBOX_POOL_SIZE`              | runner | Warm containers to keep. Default `3`.                                                                 |
| `SANDBOX_TIMEOUT_MS`             | runner | Wall clock per program. Default `10000`.                                                              |
| `SANDBOX_MEMORY`                 | runner | Per-container memory cap. Default `256m`.                                                             |
| `SANDBOX_CPUS`                   | runner | Per-container CPU cap. Default `1`.                                                                   |
| `SANDBOX_STREAM_FPS`             | runner | Target live frame rate. Default `60`.                                                                 |
| `SANDBOX_STREAM_QUALITY`         | runner | JPEG quality for streamed frames. Default `60`.                                                       |
| `SANDBOX_STREAM_WIDTH`           | runner | Downscale width for streamed frames. Default `800`.                                                   |
| `SANDBOX_STABLE_MS`              | runner | How long the display must stop changing to end a run. Default `600`.                                  |
| `SANDBOX_FORCE_FALLBACK_CAPTURE` | runner | Force the slower ImageMagick capture path. Diagnostics.                                               |

`APP_URL` is deliberately **not** prefixed `NEXT_PUBLIC_`. That prefix gets inlined at build time,
which would bake one environment's URL into every deployment.

## Scripts

Run from the repository root. `dev`, `build`, `start`, `lint`, `typecheck`, `test` and the `db:*`
commands delegate to the workspace packages.

| Script                 | Purpose                                      |
| ---------------------- | -------------------------------------------- |
| `npm run dev`          | Start the web app in development             |
| `npm run dev:all`      | Start the web app **and** the sandbox runner |
| `npm run dev:runner`   | Start only the sandbox runner                |
| `npm run image:build`  | Build the sandbox image                      |
| `npm run build`        | Production build                             |
| `npm start`            | Serve the production build                   |
| `npm run db:generate`  | Generate a migration from the schema         |
| `npm run db:migrate`   | Apply pending migrations                     |
| `npm run db:push`      | Push the schema straight to the database     |
| `npm run lint`         | ESLint                                       |
| `npm run typecheck`    | `tsc --noEmit`                               |
| `npm test`             | Vitest, both workspaces                      |
| `npm run format`       | Prettier, writes changes                     |
| `npm run format:check` | Prettier, check only                         |

## Deployment

The whole stack runs under Docker Compose: Postgres, a migration step, the sandbox runner and the
web app, with Traefik labels on the web service.

```bash
cp .env.example .env      # set POSTGRES_PASSWORD, APP_HOST and APP_URL at minimum
docker network create traefik   # unless your proxy already has one
docker compose up -d --build
```

`docker compose up -d` brings things up in the right order on its own:

1. `postgres` starts and passes its healthcheck.
2. `sandbox-image` builds `snapjaw-runner:latest` and exits. It exists only so that
   `docker compose build` produces the image the runner launches through the host daemon.
3. `migrate` applies pending Drizzle migrations and exits. It is idempotent, so running it on
   every `up` is safe.
4. `sandbox-runner` starts, prunes any sandbox containers left behind by a previous run, and
   fills its pool.
5. `web` starts once migrations have completed.

The web service binds to `127.0.0.1:8080` by default — enough to smoke-test the stack without a
proxy in front of it. Traefik routes the public host to it on port 3000.

### Notes for operating it

- **One runner per Docker host.** The runner drives the host daemon and prunes containers
  matching its name prefix at startup, so a second instance would fight the first.
- **Redeploys can briefly leave idle sandbox containers.** A hard-killed runner cannot remove its
  pool. The incoming runner sweeps those at startup and again over its next couple of health
  ticks, so the count self-corrects; a graceful stop removes them immediately. The residue is
  inert — containers idling on `sleep infinity`, costing no CPU.
- **Nothing but the web app is exposed.** The runner sits only on the internal network; the
  containers it spawns have no network at all.
- **Back up the `postgres-data` volume.** Shares live there and nowhere else.
- **Compression middleware is deliberately not enabled** on the Traefik router. Traefik's
  compress middleware buffers responses, and `/api/run/stream` depends on unbuffered delivery.
- **Rate limiting needs Upstash credentials.** Without `UPSTASH_REDIS_REST_*` the limiter is
  disabled and logs a warning rather than failing closed.

### Runtime image sizes

The web image is around 440 MB (a Next.js standalone bundle on `node:22-slim`). The sandbox image
is around 630 MB, most of which is the Tk, Xvfb and ImageMagick apt layer — Pillow, which does the
fast display capture, is under 20 MB of it. It is pulled once and reused by every run.

## API

Every response carries `timestamp` and `version`. Success payloads are spread at the top level;
failures always use the same shape:

```json
{
  "error": { "code": "NOT_FOUND", "message": "That shared file does not exist." },
  "timestamp": "2026-01-01T00:00:00.000Z",
  "version": "1.0.0"
}
```

| Method | Route                    | Notes                                                             |
| ------ | ------------------------ | ----------------------------------------------------------------- |
| `GET`  | `/api/health`            | `{ "status": "ok" }`. Liveness only — never touches the database. |
| `GET`  | `/api/ping`              | `{ "pong": true, "latencyMs": n }` — server handling time.        |
| `POST` | `/api/run`               | Execute a project, wait, return the result as JSON.               |
| `POST` | `/api/run/stream`        | Execute a project and relay display frames live.                  |
| `POST` | `/api/shared-files`      | Store a project, return `{ id, url, path }`. `201`.               |
| `GET`  | `/api/shared-files/[id]` | Fetch a shared project. `404` if absent or soft-deleted.          |

`/api/run/stream` responds with newline-delimited JSON:
`{"type":"frame","seq":n,"atMs":n,"png":"<base64>"}` while a turtle or tkinter window is being
drawn, then exactly one `{"type":"result",...}` or `{"type":"error",...}`. Console programs simply
produce no frames. The editor uses this endpoint; `/api/run` stays as the simple blocking call for
scripts.

Validation is Zod on every request body. Status codes: `400` malformed or invalid, `404` missing,
`413` oversized, `429` rate limited, `502` the sandbox failed, `503` the sandbox is unavailable,
`500` unexpected.

## The sandbox

A run goes: editor → `/api/run/stream` → the runner service → `docker exec` into a warm container.
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
private Xvfb and runs the program with `DISPLAY` pointed at it.

**Frames stream live, at around 55fps.** The executor writes each capture to stdout as it happens and
flushes, the runner relays it over the same connection, and the web layer pipes it straight through
to the browser — so a turtle drawing is watched as it draws, not just photographed at the end.

Getting there needed three things to line up:

1. **Capture in-process.** Shelling out to ImageMagick costs ~130ms per frame, which caps the whole
   thing at ~8fps however fast everything else is. Grabbing the display with Pillow and encoding
   JPEG in the same process is ~7ms, so the ceiling is well above 60fps. ImageMagick remains as a
   fallback if Pillow is unavailable; `SANDBOX_FORCE_FALLBACK_CAPTURE=1` exercises that path.
2. **Downscale and compress the stream.** Frames go out as 800px-wide JPEG rather than full-size PNG,
   which lands around 15 KiB per frame — roughly 0.6 MiB/s at 60fps. The finished run is still saved
   as a full-resolution PNG.
3. **Keep frames out of React state.** Routing 60 setState calls a second through React made it
   coalesce them and drop about two thirds of the animation. The stream now writes into a ref and the
   panel paints it on animation frames, so React never renders in the hot path.

A frame is only accepted once a window has actually been mapped, so a console program cannot come
back with a screenshot of an empty display.

The run ends when the drawing stops: once the display has been unchanged for `SANDBOX_STABLE_MS` the
program is sitting in its main loop and there is no reason to burn the whole timeout on it. That is
measured in **time, not frames** — "three identical frames" is a different duration at 8fps than at
60fps, and at 60fps it is short enough to mistake a `time.sleep(0.05)` between turtle steps for the
end of the run.

**Programs must keep their window open to be captured.** Call `turtle.done()` or `root.mainloop()`.
Without it the interpreter exits, Tk destroys the window, and there is nothing left to photograph —
the same thing that happens on a desktop. The streamed frames up to that point are still delivered.

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
