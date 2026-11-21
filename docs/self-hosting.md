# Self-hosting guide

This guide takes a fresh server to a working Snapjaw: admin UI, SMTP submission for sending, and inbound delivery from Resend.

## What you need

- A Linux server with Docker and Docker Compose, reachable from the internet on ports 80, 443, 465 and 587.
- A domain you control, for example `example.com`, and access to its DNS.
- A Resend account and a full access API key.
- A host name for Snapjaw itself, for example `relay.example.com`, with an A or AAAA record pointing at the server.

Many cloud providers block outbound port 25. Snapjaw never needs it: mail goes out through Resend's HTTPS API.

## 1. Start Snapjaw

```sh
mkdir snapjaw && cd snapjaw
curl -fsSLO https://raw.githubusercontent.com/devs-des1re/snapjaw/main/docker-compose.yml
curl -fsSL https://raw.githubusercontent.com/devs-des1re/snapjaw/main/.env.example -o .env
```

Edit `.env`:

| Variable | Value |
|---|---|
| `SNAPJAW_PUBLIC_URL` | The https address of the admin UI, such as `https://relay.example.com` |
| `SNAPJAW_SECRET_KEY` | 32 random bytes, base64 encoded: `openssl rand -base64 32`. Back it up. |
| `SNAPJAW_SMTP_HOSTNAME` | The host name mail clients connect to, such as `relay.example.com` |
| `SNAPJAW_TLS_CERT`, `SNAPJAW_TLS_KEY` | Paths inside the container to a certificate and key, such as `/certs/fullchain.pem` |
| `SNAPJAW_ACME_EMAIL` | Instead of cert files: your email, to get a Let's Encrypt certificate automatically |
| `SNAPJAW_METRICS_TOKEN` | Optional bearer token for `/metrics` |
| `SNAPJAW_TRUST_PROXY` | `true` when a reverse proxy sits in front of the web port |

Then start it:

```sh
docker compose up -d
docker compose logs snapjaw
```

The log prints a setup token. Open `SNAPJAW_PUBLIC_URL/setup`, paste the token and create the first owner. You can also create the owner from the command line:

```sh
docker compose exec snapjaw snapjaw admin create --email you@example.com
```

## 2. Put the admin UI behind HTTPS

Resend only posts webhooks to https addresses, and Google only redirects OAuth to https. Put a reverse proxy in front of port 3000. With Caddy:

```
relay.example.com {
  reverse_proxy 127.0.0.1:3000
}
```

Set `SNAPJAW_TRUST_PROXY=true` so Snapjaw sees the real client address. SMTP ports 465 and 587 are not proxied: they are published straight from the container, because port 587 starts in plain text and upgrades with STARTTLS, which an SNI router cannot route.

### Dokploy

Use `docker-compose.dokploy.yml`. It joins the `dokploy-network`, routes the web UI through Traefik with a Let's Encrypt certificate, and publishes 465 and 587 directly. Set `SNAPJAW_DOMAIN` in `.env` to the host name.

## 3. Give SMTP a trusted certificate

Gmail refuses SMTP servers with self-signed certificates. Pick one:

- **Certificate files.** Mount them into `/certs` (the compose file maps `./certs`) and set `SNAPJAW_TLS_CERT` and `SNAPJAW_TLS_KEY`. Snapjaw checks the files every minute and reloads them when they change, so a renewal on the host needs no restart. The proxy's certificate for the same host name works.
- **Built-in Let's Encrypt.** Set `SNAPJAW_ACME_EMAIL`. Setting it means you accept the Let's Encrypt subscriber agreement. Port 80 for `SNAPJAW_SMTP_HOSTNAME` must reach Snapjaw's web port, because the HTTP-01 challenge is answered at `/.well-known/acme-challenge/`. With a reverse proxy, forward that path to Snapjaw. Certificates renew when 30 days are left.

## 4. Connect Resend

1. In the admin UI open **Settings**, paste the Resend API key and press **Test connection**.
2. Press **Connect automatically** under Webhook. Snapjaw creates the webhook in Resend and stores its signing secret.
3. Set the quota to match your plan. Free is 100 a day and 3,000 a month, and received mail counts too.

## 5. Add your domain

Open **Domains**, add the domain and keep **Receive mail** on. Snapjaw shows the DNS records Resend needs: DKIM, SPF for the return path, and MX for receiving. Create them at your DNS provider, then press **Re-check**.

If the domain already receives mail elsewhere, use a subdomain such as `mail.example.com`. Resend only gets the mail when its MX record has the lowest priority value.

## 6. Check everything

```sh
docker compose exec snapjaw snapjaw doctor
```

Doctor checks the secret key, owners, Resend, the webhook, each DNS record, the certificate, the SMTP ports and every destination, and prints a fix for anything that fails. The same checks run from **Settings, Health checks**.

## Operations

- **Health.** `GET /api/health` returns status and uptime. `GET /healthz` is Krate's liveness probe.
- **Metrics.** `GET /metrics` serves Prometheus metrics: queue depth, quota, messages by status, destination and domain health. With `SNAPJAW_METRICS_TOKEN` set it needs `Authorization: Bearer <token>`; without it, only private addresses may scrape.
- **Logs.** One line per event on stdout. Message bodies and secrets are never logged.
- **Backups.** `docker compose exec snapjaw snapjaw backup /data/backup-2026-01-01.db` writes a consistent copy of the database. Keep `SNAPJAW_SECRET_KEY` with it: stored secrets cannot be decrypted without it.
- **Restore.** Stop Snapjaw, run `docker compose run --rm snapjaw snapjaw restore /data/backup.db`, start it again. The old database is kept with a `.before-restore` suffix.
- **Upgrades.** `docker compose pull && docker compose up -d`. Migrations run at startup.
- **Lost access.** `snapjaw admin reset-password --email you@example.com` and `snapjaw admin reset-2fa --email you@example.com` work from inside the container.

## Data and privacy

The database lives in the `snapjaw-data` volume at `/data`. Message bodies are stored only while a message is queued and are deleted as soon as every delivery succeeds. The message log keeps metadata only (time, addresses, subject, size, status, error) for the number of days set under **Settings, Limits and retention**.
