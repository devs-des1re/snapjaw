# Decisions log

Each entry says what was decided and why. Newest at the bottom.

## D1. Krate and TypeScript instead of Go

The spec suggested a Go binary. The project follows the maintainer's standing convention of Krate and TypeScript instead, which the maintainer confirmed. The protocol libraries are mature on Node: `smtp-server` and `mailparser` from the Nodemailer project, `imapflow` for IMAP and `googleapis` for Gmail. Snapjaw ships as a Docker image rather than a static binary.

## D2. One process

Krate's API routes, middleware and instrumentation run on its Node runtime with one worker (`ssr.nodeWorkers: 1`). `instrumentation.ts` starts the SMTP listeners, queue workers and reconciler in the same process as the API routes. They share one SQLite connection and one Resend rate limiter. With more workers, each would start its own SMTP listener and queue, so the single worker is deliberate.

## D3. `src/api` instead of `api/`

Krate only serves TypeScript API routes from `src/api`. The response helpers live in `src/api/_http.ts`. Shared server code lives in `server/`, `db/` and `lib/` at the root.

## D4. SQLite only for now

SQLite through Drizzle and libsql. One instance with one database file is what self-hosters need. Postgres is listed as optional in the spec. It is deferred because a second dialect doubles the schema and migration work.

## D5. Resend API for outbound, not Resend SMTP

Mail goes out through `POST /emails`. That gives an idempotency key per message, structured errors (`daily_quota_exceeded`, `rate_limit_exceeded`) and quota headers. Threading headers are passed through the `headers` field. Envelope recipients missing from To and Cc go out as `bcc`.

## D6. Raw MIME for inbound

Inbound delivery uses `raw.download_url` from `GET /emails/receiving/{id}`. Gmail import and IMAP APPEND need the original RFC 822 bytes so that the sender, headers, DKIM signatures and attachments stay intact. A message without a raw URL falls back to rebuilding MIME from the parsed fields and logs that it did.

## D7. Svix library for webhook verification

Resend's docs point to Svix for signature checks and do not specify the algorithm themselves. Snapjaw uses the official `svix` package and adds its own replay table on `svix-id`.

## D8. Quota counts recipients

Resend counts every To, Cc and Bcc recipient and every received email as one unit. The guard does the same. It reads `x-resend-daily-quota` and `x-resend-monthly-quota` when Resend sends them and keeps the larger of its own count and Resend's.

## D9. Free-plan defaults

Defaults are 100 per day, 3,000 per month, 10 requests per second and an 80% alert threshold. All of them can be changed in Settings for paid plans. Pro and Scale have no daily cap, so a daily limit of 0 means none.

## D10. Prebuilt image on GHCR

CI publishes `ghcr.io/devs-des1re/snapjaw` for amd64 and arm64 on version tags, plus an `edge` tag from `main`. The default `docker-compose.yml` pulls that image, so self-hosters need nothing else. `docker-compose.dokploy.yml` adds Traefik labels for the web UI. `docker-compose.dev.yml` builds from source. SMTP ports are published directly, because port 587 uses STARTTLS, which cannot be routed by SNI.

## D11. Gmail scopes

Gmail import uses the `gmail.insert` and `gmail.readonly` scopes. `gmail.readonly` exists only for the duplicate check after a crash. Both are restricted scopes. A self-hosted Google OAuth client in Testing status issues refresh tokens that expire after 7 days, so the setup guide covers publishing the app for internal or personal use, and Snapjaw warns when a token is close to expiry.

## D12. Google ends third-party Send mail as in January 2027

Google says Send mail as for third-party addresses goes away starting January 2027. It does not say whether that covers a self-owned domain routed through an external SMTP server. The Gmail guide says so plainly and points to the official notice. The SMTP server works with any client, so Snapjaw does not depend on Gmail for sending.

## D13. Auth through @krate/auth

`@krate/auth` handles credentials sign-in, TOTP with backup codes, database sessions, CSRF and sign-in rate limits. Snapjaw supplies argon2id verification, roles, disabled accounts, invites and the audit log through its callbacks and events.

## D14. A generated secret key when none is set

If `SNAPJAW_SECRET_KEY` is empty, Snapjaw creates a random key in the data folder and logs a warning to back it up. A fresh `docker compose up` then reaches the setup screen without editing anything. The setup guide still tells people to set the variable.

## D15. Static pages with a JSON API

`@krate/components` cannot be bundled into Preact `"use client"` islands, and their interactive parts do not render inside async server components. The admin UI is therefore built from static Krate pages with signals that call the REST API in `src/api`. Middleware gates every page on the session.

## D16. Hidden attribute instead of showIf

Krate's `showIf` toggles inline styles, which the strict Content Security Policy blocks. The UI toggles the `hidden` attribute instead, so the policy can stay at `style-src 'self'` with hashed scripts. The other Krate rules this led to are in `docs/development.md`.

## D17. Own table and row button primitives

Krate's `Table.Body` and `Button` do not update reliably inside lists that change. Dynamic tables use `components/ui/table` and rows use `RowButton`. Both reuse Krate's class names so they look the same.

## D18. Icons use the `name` prop

Krate's `<Icon>` takes `name="lucide:x"`. The maintainer's conventions show `icon=`, which Krate does not read.

## D19. Unprivileged SMTP ports inside the container

The image runs as the `node` user and listens on 2587 and 2465. Compose maps host ports 587 and 465 to them. Nothing in the container needs root.

## D20. Login rate limits live in memory

`@krate/auth` keeps sign-in and two-factor counters per process. Snapjaw runs one process, so that is enough. A multi-instance setup would need a shared limiter, which is out of scope.

## D21. The compatibility API answers in Resend's shape

`POST /api/emails` and `GET /api/emails/{id}` return Resend's bare JSON (`{ "id": ... }` and `{ statusCode, name, message }` for errors) instead of Snapjaw's usual envelope, so the official Resend SDKs work unchanged. The responses still go through `src/api/_http.ts`, through `resendCompat` and `resendCompatError`. Request bodies are turned into MIME and pass through the same checks as SMTP submissions.

## D22. Bcc-only messages are addressed to the sender

Resend needs a To address. When a message has no To header, Snapjaw sets To to the sender rather than promoting a Bcc recipient, which would expose that address to everyone else. The sender's copy counts as one more unit of quota.
