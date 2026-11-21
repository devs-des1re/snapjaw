# Contributing to Snapjaw

Thanks for helping. Bug reports, fixes, docs and tests are all welcome.

## Before you start

- For anything larger than a small fix, open an issue first so the approach can be agreed before you write code.
- Read [docs/architecture.md](docs/architecture.md), [docs/decisions.md](docs/decisions.md) and [docs/development.md](docs/development.md). The development notes list Krate rules that are easy to trip over.
- Snapjaw is a relay, not a mail server. Mailbox storage, an IMAP or POP server, webmail, spam filtering, billing and telemetry are out of scope.

## Setup

You need Node.js 22 or later.

```sh
git clone https://github.com/devs-des1re/snapjaw.git
cd snapjaw
npm install
cp .env.example .env
npm run dev
```

The dev server runs on port 3000. The first start prints a setup token.

## Checks

Run these before opening a pull request. CI runs the same ones.

```sh
npm run typecheck
npm run lint
npm test
npm run build
```

Tests use a fake Resend server and a temporary database, so they need no accounts or network.

## Code style

- TypeScript everywhere.
- No comments in code. Make the code clear instead.
- No emoji, no em or en dashes, plain ASCII in code and docs.
- Styles live in `src/styles/globals.css`, and every color is a CSS variable.
- Icons use `<Icon name="lucide:..." />`.
- Log through `lib/logger.ts`. Never log message bodies or secrets.
- API routes return through `ok()` and `fail()` in `src/api/_http.ts` and call `db/queries` or `server/` instead of writing SQL.
- UI copy is short, plain and slightly dry. No exclamation marks.

## Commits and branches

- Branch from `dev`. `main` holds releases.
- Use [Conventional Commits](https://www.conventionalcommits.org): `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`, `ci:`, `build:`, `perf:`, `style:`. Release notes are generated from them.
- One logical change per commit.

## Database changes

Edit `db/schema.ts`, run `npm run db:generate`, and commit the new migration. Migrations run automatically at startup.

## Pull requests

Fill in the template, link the issue, and describe how you tested the change. Add or update tests for behaviour changes.
