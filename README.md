# Snapjaw

An online Python editor. Write code in the browser, run it in a real sandboxed container —
turtle and tkinter windows included — and share it with a link.

![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=nextdotjs&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178c6?logo=typescript&logoColor=white)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-4-06b6d4?logo=tailwindcss&logoColor=white)
![Postgres](https://img.shields.io/badge/Postgres-Drizzle-4169e1?logo=postgresql&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-sandboxed-2496ed?logo=docker&logoColor=white)
![License](https://img.shields.io/badge/license-MIT-0099ff)

## What this is

Trinket shut down, so this is a from-scratch replacement built the way I wanted it: Monaco editor,
a live view of turtle/tkinter output rendered from an actual isolated container (not a browser
polyfill), and a share button that saves your files and hands you a link. No accounts, no bloat.

Untrusted code never runs inside the web app's process. It runs in a separate sandbox service that
executes Python inside a locked-down, networkless, read-only container and streams the display back
frame by frame.

## Running it locally

Needs Node 20.9+, Postgres, and Docker.

```bash
npm install
npm run image:build
npm run db:migrate
npm run dev:all
```

`npm run dev` alone starts just the web app — fine for editing and sharing, but Run will report the
sandbox as unavailable since execution lives in the separate runner. Use `dev:all`, or run `dev` and
`dev:runner` in separate terminals.

Env vars live in committed `.env.example` files next to git-ignored `.env.local` files. Neither has
comments — the variable names are self-explanatory enough on their own.

| Variable                 | Where  | What it does                                                   |
| ------------------------ | ------ | -------------------------------------------------------------- |
| `DATABASE_URL`           | web    | Postgres connection string.                                    |
| `APP_URL`                | web    | Public origin for building share links.                        |
| `SANDBOX_RUNNER_URL`     | web    | Base URL of the runner service.                                |
| `SANDBOX_RUNNER_TOKEN`   | both   | Optional shared secret between web and runner.                 |
| `UPSTASH_REDIS_REST_*`   | web    | Enables rate limiting on `/api/run`. Omit to disable it.       |
| `RUN_RATE_LIMIT`         | web    | Runs allowed per window (default `10`).                        |
| `RUN_RATE_WINDOW`        | web    | Rate limit window (default `1 m`).                             |
| `SANDBOX_POOL_SIZE`      | runner | Warm containers kept ready (default `3`).                      |
| `SANDBOX_TIMEOUT_MS`     | runner | Max time per run (default `10000`).                            |
| `SANDBOX_MEMORY`         | runner | Memory cap per container (default `256m`).                     |
| `SANDBOX_CPUS`           | runner | CPU cap per container (default `1`).                           |
| `SANDBOX_STREAM_FPS`     | runner | Target frame rate for live output (default `60`).              |
| `SANDBOX_STREAM_QUALITY` | runner | JPEG quality for streamed frames (default `60`).               |
| `SANDBOX_STREAM_WIDTH`   | runner | Downscale width for streamed frames (default `800`).           |
| `SANDBOX_STABLE_MS`      | runner | Idle time before a run is considered finished (default `600`). |

`APP_URL` is deliberately not `NEXT_PUBLIC_`-prefixed — that gets baked into the build at compile
time, which would hardcode one environment's URL into every deploy.

## Scripts

| Script                | Does                                     |
| --------------------- | ---------------------------------------- |
| `npm run dev`         | Web app only                             |
| `npm run dev:all`     | Web app + sandbox runner                 |
| `npm run image:build` | Build the sandbox image                  |
| `npm run build`       | Production build                         |
| `npm run db:migrate`  | Apply migrations                         |
| `npm run db:push`     | Push schema directly (no migration file) |
| `npm run lint`        | ESLint                                   |
| `npm test`            | Vitest, both workspaces                  |

## Deploying

`docker-compose.yml` currently runs two services: Caddy in front for automatic HTTPS, and the web
app behind it. Postgres and the sandbox runner aren't wired into compose yet — until they're added
back, sharing and Run will fail cleanly with a "service unavailable" error rather than crashing.

```bash
cp apps/web/.env.example apps/web/.env
docker compose up -d --build
```

Change the domain in `Caddyfile` to your own — it is set to `snapjaw.dev`. The web container
publishes no ports itself; Caddy is the only thing facing the internet and reaches it internally
as `web:3000`.

A few things worth knowing before running this for real:

- No `UPSTASH_REDIS_REST_*` means no rate limiting on `/api/run` — it's silently disabled, not a
  failure.
- `Caddyfile` sets `flush_interval -1` on the proxy so the live run stream isn't buffered. Don't
  remove it.
- One runner per Docker host — it prunes containers by its own name prefix on startup, so two
  runners would fight over the same pool.
- A hard-killed runner can leave idle sandbox containers behind. They cost nothing (`sleep
infinity`) and get swept on the next runner startup.
- Back up the `postgres-data` volume once Postgres is back in the compose file — shares live there
  and nowhere else.

## API

Every response includes `timestamp` and `version`. Errors always look like:

```json
{
  "error": { "code": "NOT_FOUND", "message": "That shared file does not exist." },
  "timestamp": "2026-01-01T00:00:00.000Z",
  "version": "1.0.0"
}
```

| Method | Route             | What it does                                      |
| ------ | ----------------- | ------------------------------------------------- |
| GET    | `/api/health`     | Liveness check, no database touch.                |
| GET    | `/api/ping`       | Round-trip latency.                               |
| POST   | `/api/run`        | Run a project, wait, return the result.           |
| POST   | `/api/run/stream` | Run a project, stream display frames live.        |
| POST   | `/api/file`       | Save a project, get back `{ id, url, path }`.     |
| GET    | `/api/file/[id]`  | Load a shared project. 404 if missing or deleted. |

`/api/run/stream` streams newline-delimited JSON — a `frame` message per captured frame, then one
final `result` or `error` message. The editor uses this endpoint; `/api/run` is the plain blocking
version for scripted use.

## How the sandbox works

Editor → `/api/run/stream` → runner service → `docker exec` into a pre-warmed container. The
Next.js process never touches user code directly.

**Pool.** The runner keeps a fixed number of containers idling on `sleep infinity`. A run claims
one, executes, and the container is wiped and returned to the pool. If all are busy, the request
queues briefly before failing with 503. Idle members are health-checked and replaced if they stop
responding.

**Isolation**, per container: no network, read-only root filesystem (only `/tmp` is writable),
memory/CPU/process-count caps, all Linux capabilities dropped, no privilege escalation, and an
unprivileged user inside. Between runs, `/tmp` is fully wiped — a previous project's files can't
leak into the next run.

**Turtle and tkinter.** These need a real X display, so the executor starts a private Xvfb per run
when a project imports either. Frames are captured with Pillow (not shelling out to ImageMagick,
which is roughly 20x slower per frame) and streamed to the browser live at up to 60fps as they're
drawn, then saved as a full-resolution PNG once the program settles. A run ends once the display
stops changing for a short window — measured in time, not frame count, so it behaves consistently
regardless of how fast frames are coming in.

Programs need to keep their window open to be captured — call `turtle.done()` or `root.mainloop()`,
same as running it locally. Without that the interpreter exits and there's nothing left to
photograph.

**Docker access.** The runner is given the host's Docker socket rather than running its own nested
Docker daemon (Docker-in-Docker). Socket access is effectively root on the host, which is fine here
because the runner itself is never exposed publicly — only the unprivileged, networkless containers
it spawns ever touch untrusted code.

## Database

One table, `shared_files` — `files` (jsonb), `entry_file`, `font_size`, UUID primary key,
`created_at`/`updated_at`, and a `deleted_at` soft-delete column. Shares are immutable snapshots:
there's no update endpoint, so re-sharing an edited project creates a new link.

`jsonb` doesn't preserve key order, so tab order is rebuilt on load: entry file first, then the rest
alphabetically.

## Design notes

- Editor on the left, output on the right, with a divider you can drag or move with the arrow keys.
  It stacks vertically below `md`.
- `#0099ff` is the primary action colour and nothing else — currently only the Run button. Tabs,
  focus rings, selection and links are greys.
- JetBrains Mono is the editor's font only. The UI is Inter; program output stays monospace.
- Ctrl or Cmd plus the wheel resizes the editor font.
- Dark theme only, by default and by design.

## License

MIT — see [LICENSE](./LICENSE).
