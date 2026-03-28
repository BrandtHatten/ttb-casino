# TTB Casino

A full-stack multiplayer casino platform featuring six games, real-time WebSocket communication, user progression, and an admin panel.

## Games

- **Slots** — 5×6 tumble slot machine with free spins, scatter wins, multipliers, and a Buy Feature
- **Crash** — Live multiplier game; place your bet and cash out before it crashes
- **Plinko** — Drop balls through a peg board across 4 risk levels and 5 row configurations
- **Roulette** — European roulette with straight, dozen, color, and high/low bets
- **Blackjack** — Multiplayer 5-seat table with hit, stand, double, and split
- **Case Opening** — Loot box opening with tiered multipliers and autobet

## Features

- JWT authentication with bcrypt password hashing
- 20 rank tiers (Bronze → Exotic) with daily login rewards
- 13 unlockable achievements
- Progressive jackpot system
- Real-time chat and live leaderboards
- Session net gain/loss tracking on all games
- Autobet with stop-profit/stop-loss on Crash, Plinko, and Case Opening
- Admin panel for broadcasts, user management, and jackpot control

## Stack

**Frontend:** React 19, TypeScript, Vite, TailwindCSS, Framer Motion, Socket.io-client

**Backend:** Node.js, Express, Socket.io, SQLite (better-sqlite3)

## Setup

```bash
npm install
cp .env.example .env
# Add your GEMINI_API_KEY to .env
npm run dev
```

Server runs on port `3002` by default.
