# Development notes

Things that are easy to get wrong in this codebase. Read this before changing the admin UI.

## Running locally

```sh
npm install
cp .env.example .env
npm run dev
```

The dev server listens on port 3000. The first start prints a setup token in the log. Local test accounts for manual testing are in `test/fixtures/dev-admins.json`.

## UI rules that come from Krate

The admin UI is static Krate pages that fetch from the REST API under `src/api`. Krate components run once and update through signals, which leads to a few rules.

- **Toggle with `hidden`, not `showIf`.** `showIf` sets inline styles at runtime, and the strict Content Security Policy blocks inline styles. Use `hidden={!condition}` on elements. Components in `components/ui` accept a `hidden` prop.
- **Derived values are `createMemo`.** A plain helper such as `const canEdit = () => me()?.role === "owner"` is not tracked when it is passed to a component prop. Write `const canEdit = createMemo(() => ...)`.
- **List rows read only row data.** Inside `items().map(...)`, do not read signals or memos, and do not render `@krate/components` such as `Button`. Rows that do that render empty after an update. Compute per-row flags when the data loads (for example `manageable`) and use `RowButton` from `components/ui/button`.
- **Dynamic tables use `components/ui/table`.** Krate's `Table.Body` does not re-render children that come from a signal.
- **Capture the form before `await`.** `event.currentTarget` is `null` after the first `await` in a submit handler. Read it into a variable first.
- **No reactive Krate components in JSX props.** A `<Button>` with signal text passed as a prop such as `actions={...}` renders empty. Put it in the children instead.
- **Icons use `<Icon name="set:icon" />`.** The prop is `name`. Wrap an icon in `<span hidden={...}>` to toggle it.

## Backend rules

- Every route returns through `ok()` or `fail()` from `src/api/_http.ts`.
- Routes call functions in `db/queries` or `server/`. They never write SQL.
- State-changing routes call `requireRole`, which also rejects cross-site requests.
- Process-wide singletons live on `globalThis`, because Krate may load a module more than once.
- Log through `lib/logger.ts`. Never log message bodies or secrets.

## Database changes

Edit `db/schema.ts`, then run `npm run db:generate`. Migrations run at startup.
