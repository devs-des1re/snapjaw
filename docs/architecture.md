# Snapjaw architecture

Snapjaw is a relay. It moves mail between Resend and the mail clients people already use. It holds a message body only while the message is in a queue and deletes it once delivery succeeds.

## Components

Everything runs in one Node.js process started by Krate. `src/instrumentation.ts` runs once at startup, applies database migrations and starts the relay core next to the web server.

| Component | Where | Job |
|---|---|---|
| Web server | Krate (`src/pages`, `src/api`) | Admin UI, admin API, webhook receiver, Resend-compatible API, `/api/health`, `/healthz`, `/metrics` |
| SMTP submission | `server/smtp/` (smtp-server) | Ports 465 (implicit TLS) and 587 (STARTTLS required). AUTH PLAIN and LOGIN only after TLS |
| Queue | `server/queue/` | Durable jobs in SQLite with leases, retries, exponential backoff and a dead-letter state |
| Outbound worker | `server/outbound/` | Turns a stored MIME message into a Resend `POST /emails` call |
| Inbound worker | `server/inbound/` | Fetches a received email from Resend, matches routes, fans out to destinations |
| Destinations | `server/destinations/` | Gmail API import, IMAP APPEND (imapflow), forward via Resend |
| Reconciler | `server/inbound/reconcile.ts` | Lists recent received emails and queues any Snapjaw has not seen |
| Resend client | `server/resend/` | Typed wrapper, shared 10 req/s token bucket, quota header capture, error mapping |
| Quota guard | `server/quota/` | Counts sent and received mail per UTC day and month, alerts at a threshold, rejects or holds sends over the cap |
| Secrets | `lib/crypto.ts` | AES-256-GCM for stored secrets with a key from `SNAPJAW_SECRET_KEY` |
| Audit log | `db/queries/audit.ts` | Every admin action with actor, action, target, IP and user agent |
| CLI | `cli/` | `snapjaw admin create`, `snapjaw doctor`, `snapjaw backup`, `snapjaw restore` |

## Data model

SQLite through Drizzle. All tables live in `db/schema.ts`.

- Auth tables from `@krate/auth` (`users`, `accounts`, `sessions`, `verificationTokens`, `authenticators`, `twoFactors`). `users` carries `role` (`owner`, `admin`, `viewer`) and `disabledAt`.
- `invites`: hashed token, role, expiry, creator, accepted time.
- `auditLog`: actor, action, target, detail JSON, IP, user agent, time.
- `settings`: key, value, `encrypted` flag. Holds the Resend API key, webhook secret, quota limits, retention and alert thresholds.
- `domains`: Resend domain id, name, status, DNS records JSON, capabilities, last check.
- `smtpCredentials`: username, argon2id hash, allowed senders, hourly rate limit, last used, revoked time.
- `apiKeys`: public prefix, SHA-256 hash of the secret, allowed senders, rate limit, revoked time.
- `routes`: match type (`address`, `wildcard`, `catchall`), pattern, domain, enabled.
- `destinations`: type (`gmail`, `imap`, `forward`), name, encrypted config, health, last error.
- `routeDestinations`: route to destination links.
- `messages`: the permanent metadata log. Direction, Resend id, from, to, subject, size, status, error, credential, times. No bodies.
- `messageEvents`: lifecycle entries per message (accepted, queued, sent, delivered, bounced, complained, failed).
- `blobs`: raw MIME bytes for queued messages. Deleted when every delivery for the message is final.
- `deliveries`: one row per inbound message and destination, unique on the pair.
- `jobs`: kind, reference, state, attempts, next run time, lease expiry, last error.
- `suppressions`: address, reason, source, time.
- `webhookEvents`: `svix-id` of every accepted webhook, used to reject replays.
- `usage`: per UTC day counts of sent and received mail.

## Message flows

### Outbound over SMTP

1. A client connects to 465 or 587. On 587 Snapjaw refuses AUTH and MAIL until STARTTLS completes.
2. AUTH PLAIN or LOGIN checks the username and argon2id hash. Failures are rate limited per IP.
3. `MAIL FROM` and the header `From` must both match the credential's allowed senders, which can be exact addresses or `@domain` entries. The domain must be a verified Snapjaw domain.
4. Each `RCPT TO` is checked against the suppression list and the per-credential rate limit.
5. At `DATA` Snapjaw enforces the size limit, counts attachments, and refuses relayed loops (`X-Snapjaw-Relay` carrying this instance id).
6. The quota guard reserves one unit per recipient. Over the cap, the transaction gets `452 4.5.3` (hold mode, the client retries) or `550 5.7.1` (reject mode), with a plain message.
7. The raw message goes into `blobs`, a `messages` row is written, and a `send` job is queued in one transaction. The client gets `250` only after that commit.
8. The outbound worker parses the MIME, maps it to Resend fields and calls `POST /emails` with `Idempotency-Key: snapjaw-<message id>`. Header `To` and `Cc` stay as written. Envelope recipients missing from them become `bcc`. Message-ID, In-Reply-To, References and other safe headers go in `headers`. Attachments keep filename, type and content id.
9. On success the blob is deleted and the Resend id is stored. Resend webhooks (`email.delivered`, `email.bounced`, `email.complained`, `email.failed`, `email.delivery_delayed`) then update the lifecycle. Bounces and complaints add suppressions.

The HTTP entry point (`POST /api/emails`, Resend-compatible) joins this flow at step 6 with a JSON body instead of MIME.

### Inbound

1. Resend receives mail for the domain and posts `email.received` to `/api/webhooks/resend`.
2. Snapjaw verifies the Svix signature on the raw body, rejects timestamps outside five minutes, and rejects a `svix-id` it has already seen.
3. It inserts a `messages` row keyed by the Resend email id (unique) and an `inbound` job, then answers `200`. Duplicates are no-ops.
4. The worker calls `GET /emails/receiving/{id}` and downloads the raw MIME from `raw.download_url`. It adds `X-Snapjaw-Relay` and `Delivered-To` headers, and a Message-ID if one is missing.
5. It matches recipients against routes: exact address first, then wildcard, then the domain catch-all. Each matched destination gets a `deliveries` row and its own job, so one failing destination does not block the others.
6. When every delivery is final, the blob is deleted.
7. The reconciler runs every few minutes. It calls `GET /emails/receiving` for the recent window and queues any id not in `messages`. Downtime therefore loses nothing.

### Exactly-once delivery after a crash

A delivery attempt sets `state = in_flight` before calling the destination. If the process dies there, the next attempt sees `in_flight` and checks the destination first: IMAP `SEARCH HEADER Message-ID` and Gmail `messages.list q=rfc822msgid:`. If the message is already present, the delivery is marked done without appending again.

## Threat model

| Asset | Threat | Control |
|---|---|---|
| Sending reputation and quota | Open relay abuse | Authenticated submission only, strict per-credential sender allowlist on envelope and header From, per-credential rate limits, quota guard |
| SMTP credentials | Brute force | argon2id, per-IP failure limit with backoff, AUTH only over TLS |
| Admin accounts | Credential stuffing, session theft | argon2id, TOTP 2FA (enforceable), rate-limited login, `HttpOnly` `Secure` `SameSite` cookies, per-device session revoke |
| Admin UI | CSRF, XSS, clickjacking | CSRF token on every state change, strict CSP, `frame-ancestors 'none'`, server-rendered output escaping |
| Webhook endpoint | Forged or replayed events | Svix signature over the raw body, five minute timestamp window, `svix-id` replay table |
| Stored secrets | Database theft | AES-256-GCM with a key that lives only in the environment, never logged |
| Mail content | Disclosure through logs or backups | Bodies only in the queue, deleted after delivery, never logged; metadata retention is configurable |
| Inbox | Mail loops | `X-Snapjaw-Relay` hop header, `Auto-Submitted` check before forwarding, routes that point back at a Snapjaw domain are refused |
| Host | Resource exhaustion | Message size and attachment count limits, connection limits, request body limits |

Out of scope: a compromised host, a compromised Resend or Google account, and spam filtering of inbound mail.
