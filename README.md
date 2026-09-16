# Snapjaw

A Trinket-style online code editor for Python. Write code in your browser, run it in a real
sandboxed container — turtle and tkinter output included — and share your files with a link.

![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=nextdotjs&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178c6?logo=typescript&logoColor=white)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-4-06b6d4?logo=tailwindcss&logoColor=white)
![License](https://img.shields.io/badge/license-MIT-0099ff)

## Status

Phase 1 of 4 is complete: the editor UI shell. The editor, file tabs, font size control, output
panel and top menu bar are all in place and functional. **Run** currently returns placeholder
output, and **Share** is stubbed — real execution and real sharing land in later phases.

| Phase | Scope                             | State       |
| ----- | --------------------------------- | ----------- |
| 1     | Editor UI shell                   | Done        |
| 2     | Database and file sharing         | Not started |
| 3     | Sandbox runner and real execution | Not started |
| 4     | Deployment and polish             | Not started |

## Repository layout

```
snapjaw/
├── apps/
│   └── web/                  Next.js app — editor UI, API routes, sharing
└── services/
    └── sandbox-runner/       Isolated Python execution service (Phase 3)
```

The sandbox runner is a separate service on purpose. Untrusted user code must never execute
inside the Next.js process, where it would share an address space with the database credentials
and application internals.

## Getting started

Requires Node.js 20.9 or newer.

```bash
npm install
npm run dev
```

The app is then on [http://localhost:3000](http://localhost:3000).

Environment variables live in `apps/web/.env.example` (committed) and `apps/web/.env.local`
(git-ignored). Neither file contains comments — the key names are the documentation.

## Scripts

Run from the repository root. `dev`, `build`, `start`, `lint`, `typecheck` and `test` delegate to
the workspace packages.

| Script                 | Purpose                          |
| ---------------------- | -------------------------------- |
| `npm run dev`          | Start the web app in development |
| `npm run build`        | Production build                 |
| `npm start`            | Serve the production build       |
| `npm run lint`         | ESLint                           |
| `npm run typecheck`    | `tsc --noEmit`                   |
| `npm test`             | Vitest                           |
| `npm run format`       | Prettier, writes changes         |
| `npm run format:check` | Prettier, check only             |

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
