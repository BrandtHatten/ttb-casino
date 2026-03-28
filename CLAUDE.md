# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install        # Install dependencies
npm run dev        # Start development server (Express + Vite HMR on port 3002)
npm run build      # Build frontend for production (Vite → /dist/)
npm run lint       # Type-check only (tsc --noEmit — no test runner configured)
npm run clean      # Remove dist directory
```

No test framework is configured.

## Environment

Copy `.env.example` to `.env`. Key variables:
- `PORT` — server port (default 3002)
- `JWT_SECRET` — auth signing key
- `GEMINI_API_KEY` — Google Gemini AI integration
- `ADMIN_USERNAME` / `ADMIN_PASSWORD` — admin account credentials
- `DISABLE_HMR` — disable Vite HMR (for AI Studio compatibility)

## Architecture

This is a full-stack casino platform with a single Express server (`server.ts`) that serves both the REST API and, in development, proxies Vite's dev server.

### Data Flow

```
Client (React) ←→ Socket.io ←→ server.ts ←→ db.ts ←→ casino.db (SQLite)
Client (React) ←→ REST API  ←→ server.ts
```

All real-time state (balances, leaderboards, jackpot, chat, game results) flows through Socket.io. REST endpoints handle auth and initial data loads.

### Backend (`server.ts` + `db.ts`)

- `server.ts` — 1,600+ line monolith: Express routes, Socket.io event handlers, and game logic are co-located. All game outcome logic lives server-side.
- `db.ts` — SQLite via `better-sqlite3`. Initializes schema and exports typed query helpers. Tables: `users`, `transactions`, `jackpot`, `user_achievements`.
- Auth: JWT tokens, bcrypt password hashing. JWT secret and admin credentials come from env vars.

### Frontend (`src/`)

- `src/App.tsx` — 1,900+ line root component. Owns the auth state, Socket.io connection, global user state, and React Router routes. All game page components receive user/socket props drilled from here.
- `src/components/` — One large component per game (`CrashGame.tsx`, `PlinkoGame.tsx`, `RouletteGame.tsx`, `CaseOpening.tsx`, `Blackjack.tsx`, `AdminPanel.tsx`). These are self-contained with local state but communicate via Socket.io events.
- `src/services/gameService.ts` — Client-side symbol and grid generation for slots (visual only; outcomes are determined server-side).
- `src/lib/` — Pure data/logic: `achievements.ts` (13 achievement definitions), `ranks.ts` (20 rank tiers with daily bonuses), `caseItems.ts` (loot box items), `utils.ts`.
- `src/types.ts` — Shared TypeScript interfaces (`User`, `GameSymbol`, `WinResult`, etc.).

### Games

| Game | Key files |
|------|-----------|
| Slots | `App.tsx` (game logic), `src/services/gameService.ts` (symbol gen) |
| Crash | `src/components/CrashGame.tsx` |
| Plinko | `src/components/PlinkoGame.tsx` |
| Roulette | `src/components/RouletteGame.tsx` |
| Blackjack | `src/components/Blackjack.tsx` (multiplayer, 5 seats) |
| Case Opening | `src/components/CaseOpening.tsx` |

### Key Design Patterns

- **Socket.io is the primary state sync mechanism.** After any balance-changing event, the server emits updated user data back to the client. Don't rely solely on REST responses for post-action state.
- **Game outcomes are always server-authoritative.** Client-side animations and previews are cosmetic; the server validates bets, computes outcomes, and persists results.
- **The monolithic `App.tsx` and `server.ts` are intentional.** Adding new features typically means extending these files rather than splitting them.
