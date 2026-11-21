# Security policy

## Reporting a vulnerability

Email **me@devs-des1re.com** with the details. Do not open a public issue for a security problem.

Include what you found, how to reproduce it, the Snapjaw version or commit, and what an attacker could do with it. You will get an answer within 7 days. Once a fix is released you are credited in the release notes, unless you prefer not to be.

## Supported versions

Only the latest release gets security fixes.

## Scope

In scope:

- Using Snapjaw as an open relay, or sending as an address a credential is not allowed to use.
- Bypassing admin authentication, two-factor authentication, roles or CSRF protection.
- Forged or replayed Resend webhooks being accepted.
- Reading stored secrets (Resend key, OAuth tokens, IMAP passwords) without the secret key.
- Message bodies or secrets ending up in logs.
- Mail loops that Snapjaw should have stopped.

Out of scope:

- Attacks that need control of the host, the Docker daemon, the Resend account or the Google account.
- Spam filtering of inbound mail. Snapjaw does not filter spam.
- Denial of service through traffic volume.

## Threat model

The threat model, with each asset, threat and control, is in [docs/architecture.md](docs/architecture.md#threat-model).

## Hardening checklist

- Set `SNAPJAW_SECRET_KEY` and keep a copy outside the server.
- Serve the admin UI over HTTPS only.
- Give SMTP a trusted certificate.
- Require two-factor authentication for every admin under **Settings, Security**.
- Give every credential the narrowest allowed sender list and an hourly limit.
- Set `SNAPJAW_METRICS_TOKEN` if `/metrics` is reachable from outside a private network.
- Run `snapjaw doctor` after every change.
