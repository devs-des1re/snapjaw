# Snapjaw

A Trinket-style online code editor for Python. Write code in your browser, run it in a real
sandboxed container — turtle and tkinter output included — and share your files with a link.

![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=nextdotjs&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178c6?logo=typescript&logoColor=white)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-4-06b6d4?logo=tailwindcss&logoColor=white)
![Postgres](https://img.shields.io/badge/Postgres-Drizzle-4169e1?logo=postgresql&logoColor=white)
![License](https://img.shields.io/badge/license-MIT-0099ff)

## Status

Phase 2 of 4 is complete: the database and real file sharing. Sharing genuinely persists a project
and hands back a working `/s/[id]` link that reopens the files at the same font size. **Run** still
returns placeholder output — real execution arrives with the sandbox runner in Phase 3.

| Phase | Scope                             | State   |
| ----- | --------------------------------- | ------- |
| 1     | Editor UI shell                   | Done    |
| 2     | Database and file sharing         | Done    |
| 3     | Sandbox runner and real execution | Next    |
| 4     | Deployment and polish             | Pending |

## Repository layout

```
snapjaw/
├── apps/
│   └── web/                       Next.js app — editor UI, API routes, sharing
│       ├── app/api/               health, ping, shared-files
│       ├── app/s/[id]/            shared file view
│       ├── lib/db/                schema, connection, queries
│       └── drizzle/               generated migrations
└── services/
    └── sandbox-runner/            Isolated Python execution service (Phase 3)
```

The sandbox runner is a separate service on purpose. Untrusted user code must never execute
inside the Next.js process, where it would share an address space with the database credentials
and application internals.

## Getting started

Requires Node.js 20.9 or newer, and a Postgres database.

```bash
npm install
npm run db:migrate     # after setting DATABASE_URL
npm run dev
```

The app is then on [http://localhost:3000](http://localhost:3000).

Environment variables live in `apps/web/.env.example` (committed) and `apps/web/.env.local`
(git-ignored). Neither file contains comments — the key names are the documentation.

| Variable               | Purpose                                                                                               |
| ---------------------- | ----------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`         | Postgres connection string. Required.                                                                 |
| `APP_URL`              | Public origin used to build share links. Falls back to the request's forwarded host, then its origin. |
| `SANDBOX_RUNNER_URL`   | Sandbox runner service. Phase 3.                                                                      |
| `UPSTASH_REDIS_REST_*` | Rate limiting on `/api/run`. Phase 3.                                                                 |

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
| `npm test`             | Vitest                                   |
| `npm run format`       | Prettier, writes changes                 |
| `npm run format:check` | Prettier, check only                     |

## API

Every response carries `timestamp` and `version`. Success payloads are spread at the top level;
failures always use the same shape:

```json
{
  "error": { "code": "NOT_FOUND", "message": "That shared file does not exist." },
  "timestamp": "2026-09-16T19:08:04.061Z",
  "version": "0.2.0"
}
```

| Method | Route                    | Notes                                                             |
| ------ | ------------------------ | ----------------------------------------------------------------- |
| `GET`  | `/api/health`            | `{ "status": "ok" }`. Liveness only — never touches the database. |
| `GET`  | `/api/ping`              | `{ "pong": true, "latencyMs": n }` — server handling time.        |
| `POST` | `/api/shared-files`      | Store a project, return `{ id, url, path }`. `201`.               |
| `GET`  | `/api/shared-files/[id]` | Fetch a shared project. `404` if absent or soft-deleted.          |

Validation is Zod on every request body. Status codes: `400` malformed or invalid, `404` missing,
`413` oversized, `500` unexpected.

## Database

Postgres via Drizzle. One table, `shared_files`, holding `files` as `jsonb`, the `entry_file`, and
the `font_size` to restore on open. UUID primary keys, `created_at`/`updated_at` on every row, and a
`deleted_at` soft-delete column that all reads filter on.

Shares are **immutable snapshots** — v1 has no update endpoint, so editing a shared project and
sharing again creates a new link rather than mutating the old one.

`jsonb` does not preserve key order, so tab order is rebuilt deterministically when a share is
opened: the entry file first, then the rest alphabetically.

Logs are structured JSON, written to `logs/<timestamp>.log` and mirrored to stdout.

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
