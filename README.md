# Signal Clone — Frontend

Next.js 16 (App Router) + TypeScript + Tailwind v4 front-end for the Signal
messenger clone. See `../PLAN.md` for the overall design.

## Status

**Phase 0 — scaffolding complete.** Boots, builds, env wired, libraries
installed. UI is the default starter page; the Signal shell (three-pane
layout, conversation list, chat pane, bubbles, composer) lands in Phase 3.

## Prerequisites

- **Node.js 20+**
- **npm** (project pins `package-lock.json`; swap for `pnpm`/`yarn` if you
  prefer, but don't mix)
- The FastAPI backend on `http://localhost:8000` — see `../backend/` (Phase 1+)

## Install

```bash
npm install
```

## Develop

```bash
npm run dev
```

App boots on <http://localhost:3000> (auto-falls-back to 3001 if 3000 is
busy). Hot reload via Turbopack.

Other scripts:

| Script           | What it does                            |
| ---------------- | --------------------------------------- |
| `npm run dev`    | Dev server with HMR                     |
| `npm run build`  | Production build                        |
| `npm run start`  | Serve the production build              |
| `npm run lint`   | ESLint (Next + TS core-web-vitals)      |

## Environment variables

All vars are client-visible (`NEXT_PUBLIC_*`) — keep secrets on the server.
Copy `.env.example` to `.env.local` and fill in:

| Var                    | Default                          | Used in     |
| ---------------------- | -------------------------------- | ----------- |
| `NEXT_PUBLIC_API_URL`  | `http://localhost:8000`          | REST calls  |
| `NEXT_PUBLIC_WS_URL`   | `ws://localhost:8000/ws`         | WebSocket   |

`lib/env.ts` exports a typed `env` object with a dev-mode fail-fast guard.
Use `import { env } from "@/lib/env"` rather than reading `process.env` ad hoc.

## Project layout

```
app/
  layout.tsx        # root layout (Next.js 16 LayoutProps<'/'>)
  page.tsx          # placeholder — replaced by the Signal shell in Phase 3
  globals.css       # Tailwind v4 entry; imports tokens.css
  tokens.css        # Signal palette (placeholder values; refined in Phase 3)
lib/
  env.ts            # typed env with dev-mode guard
public/             # static assets
```

## Phase 3 placeholder

The three-pane Signal shell (nav rail + conversation list + chat pane) and
all shared UI primitives will live under `app/` (route-segment files) and
`components/`. Component code should already prefer `var(--color-…)` tokens
from `app/tokens.css` over raw Tailwind palette utilities, so the Phase 3→8
dark-mode polish is cheap.

State and data libs installed but not yet wired:

- `zustand` — UI state (e.g. selected conversation, modals)
- `@tanstack/react-query` — server state (REST cache, mutations)
- `sonner` — toasts
- `lucide-react` — icons
- `clsx` + `tailwind-merge` — class composition
- `date-fns` — relative timestamps
