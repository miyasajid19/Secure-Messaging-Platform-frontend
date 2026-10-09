# Signal Clone — Frontend

Next.js 16 (App Router) + TypeScript + Tailwind v4 + Zustand + TanStack Query. Talks to the FastAPI backend at `../backend/` over REST + a single WebSocket. The full architecture is in `../PLAN.md`.

## What it does

A pixel-aware Signal Messenger clone for the desktop browser:

- **Public landing** at `/` — project description, features grid, screenshots, social links, floating "Try the live demo" widget.
- **Mocked-OTP auth** — phone + `123456` → JWT in `localStorage`. No SMS.
- **Real-time chat** — three-pane shell (left rail / conversation list / chat pane). WebSocket-driven messages, typing indicators, presence, read receipts.
- **Direct + group conversations** — create groups, add/remove members, admin controls.
- **Bonus features** — reply/quoted messages, emoji reactions (Messenger-style "seen by" avatar stack on outgoing group bubbles), per-conversation disappearing-message timers, image attachments, dark mode toggle.

## Architecture

```
┌────────────────────────────────────────────┐
│ Browser tab                                 │
│                                             │
│  Next.js 16 App Router (Vercel)             │
│   ├─ React Server + Client Components       │
│   ├─ TanStack Query (singleton, bound)      │
│   ├─ Zustand stores (auth, UI, realtime)    │
│   └─ WebSocket client (reconnect + backoff) │
│         │                                   │
│         │  REST (apiFetch) + WS (?token=…)  │
└─────────┼───────────────────────────────────┘
          │
          ▼
   FastAPI backend (Railway)
   SQLite (Railway Volume)
```

The WebSocket connection is a **singleton** (single connection per browser tab), created after auth hydration. It uses `?token=<jwt>` in the query string — cookies don't survive cross-origin WS upgrades reliably.

## Tech stack

| Layer | Choice | Notes |
|---|---|---|
| Framework | Next.js 16 (App Router) | RSC + `'use client'` boundaries |
| UI | React 19 | |
| Language | TypeScript | strict |
| Styling | Tailwind v4 + `app/tokens.css` | Light theme for v1; dark mode toggle |
| UI state | Zustand | `auth`, `ui`, `realtime` stores |
| Server state | TanStack Query | singleton, `setQueryClient` bound in `Providers` |
| Realtime | Native `WebSocket` | wrapped in `lib/realtime.ts` with exponential reconnect |
| Toasts | sonner | mounted in `Providers` |
| Icons | lucide-react | |
| Date utils | date-fns | relative timestamps |
| Class composition | clsx + tailwind-merge | |

## Prerequisites

- Node.js 20+
- npm (project pins `package-lock.json`)
- The FastAPI backend running at `http://localhost:8000` — see `../backend/README.md`

## Install

```bash
cd frontend
npm install
cp .env.example .env.local   # defaults match local backend
```

## Develop

```bash
npm run dev
```

App boots on <http://localhost:3000> (auto-falls-back to 3001 if 3000 is busy). Hot reload via Turbopack.

| Script | What it does |
|---|---|
| `npm run dev` | Dev server with HMR |
| `npm run build` | Production build (TS check + Next build) |
| `npm run start` | Serve the production build |
| `npm run lint` | ESLint (Next + TS core-web-vitals) |

## Deployment (Vercel)

### One-time setup
1. Import the GitHub repo into Vercel.
2. Set the **Root Directory** to `frontend` (so Vercel finds `package.json` here, not at the repo root).
3. Framework preset: Next.js (auto-detected).
4. **Set the env vars** in the Vercel project settings BEFORE the first deploy — they are inlined at build time:
   - `NEXT_PUBLIC_API_URL` — e.g. `https://your-app.up.railway.app`
   - `NEXT_PUBLIC_WS_URL` — e.g. `wss://your-app.up.railway.app/ws`
5. Deploy. Vercel picks up the `frontend/` subdirectory automatically when you set the root directory; otherwise add a `vercel.json` at the repo root pointing at it.

```json
{
  "buildCommand": "npm run build",
  "outputDirectory": ".next",
  "framework": "nextjs"
}
```

### Verify a live deploy
1. Open the deployed URL → landing page renders with the floating widget.
2. Click **Try the demo** → `/auth/phone`.
3. Enter `+15550000001`, continue, OTP auto-fills to `123456` (or type it), verify.
4. Land on `/chat` with Alice's seeded conversations.
5. Click into a direct conversation, send a message.
6. Open a second window, log in as Bob (`+15550000002`), send a message back → should appear on Alice's side within 1 s.
7. Open Settings → Appearance → toggle dark mode → entire UI flips instantly.
8. The GitHub, LinkedIn, and email links in the footer point at the right URLs.

## Environment variables

All vars are client-visible (`NEXT_PUBLIC_*`) — keep secrets on the server. `lib/env.ts` exports a typed `env` object with a dev-mode fail-fast guard (throw on missing in production; warn-and-fallback in dev).

| Var | Dev default | Production |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | `http://localhost:8000` | `https://your-app.up.railway.app` |
| `NEXT_PUBLIC_WS_URL` | `ws://localhost:8000/ws` | `wss://your-app.up.railway.app/ws` |

Always import via `import { env } from "@/lib/env"` — never read `process.env` ad hoc. The `lib/env.ts` module exports `apiUrl` and `wsUrl`.

## Routes

| Path | Auth | Description |
|---|---|---|
| `/` | — | Public landing page |
| `/auth/phone` | — | Phone entry |
| `/auth/otp?phone=…` | — | OTP entry (auto-fills `123456` in dev) |
| `/onboarding` | ✅ | First-time profile setup (display name) |
| `/chat` | ✅ | Three-pane chat shell |
| `/settings?section=…` | ✅ | Account / Privacy / Notifications / Appearance |

## Authentication flow

1. `/auth/phone` — user enters phone → `POST /auth/request-otp` (upserts the user) → router pushes to `/auth/otp?phone=…`.
2. `/auth/otp` — user enters OTP (or clicks "Use 123456 (dev)") → `POST /auth/verify-otp` → token + user object → `setAuth(token, user)` → if `user.display_name` is null, push to `/onboarding`; else push to `/chat`.
3. After hydration, the WebSocket opens with `?token=${token}` in the query string.
4. Logout (Settings menu or left-rail avatar popover) → `POST /auth/logout` (best-effort) → `useAuthStore.clear()` → router pushes to `/auth/phone`.

The JWT lives in `localStorage` under `signal-clone:token` and `signal-clone:user`. The realtime store has its own session flag `signal-clone:hide-floating-login` that hides the landing-page widget after "Just browsing".

## State management

Three Zustand stores:

- `store/auth.ts` — `token`, `user`, `hydrated`, `setAuth`, `clear`, manual `hydrate()` from `localStorage`. **No `persist` middleware** (it would read `localStorage` at module init and crash SSR). The hydrate runs in a `useEffect` inside `Providers`.
- `store/ui.ts` — `selectedConversationId`, `wsReady`, modal open flags. `getSelectedConversationId`, `setSelected`.
- `store/realtime.ts` — `typingByConversation`, `presenceByUser`. Setters called by the WS handler in `lib/realtime.ts`.

Plus TanStack Query for server state. The client is a **singleton** created by `getQueryClient()` and bound into the React context by `Providers` on mount — the WS handler uses `getQueryClient()` so its `setQueryData` writes hit the same cache `useQuery` reads.

## WebSocket lifecycle

- Created once per browser tab on auth hydration.
- URL: `${env.wsUrl}?token=${token}`.
- Reconnect with exponential backoff (1s → 2s → 4s, capped at 30s) on disconnect.
- Events handled:
  - `presence.snapshot` → seed presence map; flips `wsReady = true`
  - `presence` → update presence map
  - `message.new` → push into `['messages', conversation_id]` cache; invalidate `['conversations']`
  - `message.read.bulk` → mark messages read in cache
  - `typing` → update `typingByConversation` map
  - `reactions.update` → replace reactions array on the message
  - `conversation.updated` / `conversation.deleted` → replace / remove conversation in `['conversations']`
  - `message.delete` → remove the message from `['messages', conversation_id]`

## Visual style

All colors come from `app/tokens.css`. **Never hardcode hex literals in components** — grep for them and you'll find only the tokens file. The tokens are split across two scopes:

- `:root { --color-* }` — light palette (default)
- `[data-theme="dark"] { --color-* }` — dark palette

A small `useTheme()` hook in `lib/theme.tsx` reads `localStorage('signal-clone:theme')` and applies `document.documentElement.dataset.theme`. The Settings → Appearance toggle flips this.

## Project layout

```
frontend/
├── app/
│   ├── layout.tsx           # root layout; wraps <Providers>
│   ├── globals.css          # Tailwind v4 entry; imports tokens.css
│   ├── tokens.css           # Signal palette (light + dark)
│   ├── page.tsx             # public landing page
│   ├── chat/
│   │   └── page.tsx         # authenticated chat shell (moved here in Phase 9.5)
│   ├── auth/
│   │   ├── phone/page.tsx   # phone entry
│   │   ├── otp/
│   │   │   ├── page.tsx     # Suspense shell
│   │   │   └── otp-form.tsx # client form
│   │   └── profile/         # (deprecated — onboarding handles first-time profile)
│   ├── onboarding/page.tsx  # first-time profile (display name)
│   └── settings/page.tsx    # Account / Privacy / Notifications / Appearance
├── components/              # UI primitives + feature components
│   ├── avatar.tsx
│   ├── chat-pane.tsx
│   ├── composer.tsx
│   ├── conversation-list-pane.tsx
│   ├── conversation-list-row.tsx
│   ├── empty-state.tsx
│   ├── floating-login-widget.tsx
│   ├── left-rail.tsx
│   ├── message-bubble.tsx
│   ├── new-group-modal.tsx
│   ├── group-info-modal.tsx
│   ├── system-message.tsx
│   ├── seen-by-avatars.tsx
│   ├── add-contact-modal.tsx
│   ├── settings-menu.tsx
│   ├── confirm-logout-modal.tsx
│   └── auth/                # shared auth card chrome
├── lib/
│   ├── api.ts               # apiFetch wrapper + endpoint helpers + types
│   ├── auth-actions.ts      # shared performLogout(router)
│   ├── conversation-title.ts # single source of truth for direct/group titles
│   ├── env.ts               # typed env with fail-fast guard
│   ├── format.ts            # date formatting
│   ├── mock-data.ts         # (deprecated; kept for Phase 7 deletion)
│   ├── notification-sound.ts# Web Audio chime, gated by settings toggle
│   ├── realtime.ts          # WS client (singleton) + handlers
│   └── theme.tsx             # useTheme hook
├── store/
│   ├── auth.ts              # JWT + user
│   ├── ui.ts                # selected conversation, modal flags
│   ├── realtime.ts          # typing + presence
│   └── reply.ts             # reply/quoted target
├── scripts/                  # Playwright verification scripts (Python)
│   ├── walk_auth_flow.py
│   ├── verify_phase3.py / 4 / 5 / 6 / 7
│   ├── verify_realtime_reception.py
│   ├── verify_logout_promotion.py
│   ├── verify_direct_title.py
│   ├── verify_replies.py / reactions.py / disappearing.py / dark_mode.py
│   ├── verify_no_self_in_group.py
│   ├── verify_no_dup_send.py
│   └── verify_seen_by.py
├── public/                   # static assets
├── next.config.ts
├── tsconfig.json
├── tailwind.config.*         # (minimal — most config in tokens.css)
├── package.json
└── README.md
```

## Verification scripts

`scripts/verify_*.py` are Playwright walks that drive the live frontend against the backend. They live in the repo so anyone can re-run them after a change:

```bash
# Backend running at localhost:8000 with seeded data.
# Frontend running at localhost:3000.

# Single-user scripts (no second context)
python scripts/verify_phase3.py            # shell renders, 3-pane layout
python scripts/verify_phase4.py            # live API + add contact
python scripts/verify_direct_title.py      # direct-conv title fix
python scripts/verify_logout_promotion.py  # settings menu + confirm modal
python scripts/verify_dark_mode.py         # theme toggle flips <html data-theme>

# Two-context scripts
python scripts/verify_realtime_reception.py  # Alice sends → Bob sees < 1s
python scripts/verify_replies.py             # reply flow end-to-end
python scripts/verify_reactions.py           # reactions end-to-end
```

Exit 0 on success; non-zero on first failed assertion. Most tests assume the seed is loaded (`python -m app.seed` from the backend dir).

## Locked decisions

These are the decisions in `../PLAN.md` that constrain frontend choices; flagged here so future contributors don't relitigate:

1. Auth: **JWT in localStorage** (NOT httpOnly cookie — keeps WS auth simple via `?token=`).
2. State: **Zustand (UI) + TanStack Query (server)**. **No Redux.**
3. Styling: **Tailwind v4 + `tokens.css`**. **No Material/Chakra.**
4. Bonus features: all 5 shipped (reply, reactions, dark mode, disappearing, attachments).
5. Database / hosting: SQLite + WAL on Railway Volume + single uvicorn worker (backend concerns; surfaced in the WS auth flow).
6. Visual theme (v1): **Light theme only** (dark mode toggle added as a bonus).
7. **Phase 9.5 split** — public landing at `/`, chat shell at `/chat`.

## Known limitations

These are intentional for the assignment's scope; flagging them so they don't surprise you:

- **`/chat` is the protected route.** Auth-guard inside the chat shell redirects to `/auth/phone` if there's no token. There's no middleware-level guard because Edge runtime can't access `localStorage`.
- **`getQueryClient()` is a lazy singleton.** It must be bound by `Providers` on mount before any caller uses it (the WS handler reads from it). A future contributor adding a new caller outside the React tree must call `setQueryClient(c)` first. The `lib/api.ts` lazy fallback exists for module-load paths that fire before `Providers` mounts.
- **WebSocket reconnect replays nothing.** When the WS drops, queued outgoing messages aren't held; they need a refetch on reconnect (the next `useQuery(['messages', id]` does that). A live demo with sub-second reconnect is fine; a chat that goes offline for hours needs explicit offline UI.
- **`localStorage` for the JWT** is fine for the demo. For a real product, switch to an httpOnly cookie + CSRF token + a `/auth/logout` that revokes server-side.
- **No E2E encryption.** Per the assignment scope, encryption is mocked. Real production would use the Signal Protocol (Double Ratchet) or similar.
- **Some earlier verify scripts have known carry-over failures** (e.g. `verify_phase4.py` reports a `??`-from-self-search fail that the frontend mitigates with a "That's you" hint; `verify_no_self_in_group.py` is a no-op against the current backend). These are out of Phase 9 scope.

## Local development tips

- `npm run build` — make sure this passes before pushing. Most regressions surface here.
- The dev server occasionally holds stale state across HMR. If something looks weird, kill the dev process (`taskkill //PID <n>` on Windows or `pkill -f next-dev` on Linux) and restart.
- `window.__qc` is exposed in dev builds only (gated behind `process.env.NODE_ENV !== "production"`) — verify scripts use it to inspect the TanStack Query cache. Don't ship that branch to prod.
- `tokens.css` is the source of truth for color tokens. Adding a new token there means every component using `var(--your-new)` works without code changes.