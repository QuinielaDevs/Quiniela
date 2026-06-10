<h1 align="center">PIJA Quiniela</h1>

<p align="center">
  A private World Cup 2026 prediction pool for your group — championship mode.
</p>

<p align="center">
  <a href="#demo"><strong>Demo</strong></a> ·
  <a href="#what-it-does"><strong>What it does</strong></a> ·
  <a href="#how-scoring-works"><strong>Scoring</strong></a> ·
  <a href="#tech-stack"><strong>Tech stack</strong></a> ·
  <a href="#run-locally"><strong>Run locally</strong></a> ·
  <a href="#testing"><strong>Testing</strong></a>
</p>
<br/>

## Demo

Live app: **[quiniela-six-nu.vercel.app](https://quiniela-six-nu.vercel.app/)**

Sign in with email or Google, join a league with an invite code, and start
predicting scores for the FIFA World Cup 2026.

## What it does

PIJA Quiniela is a private prediction game built around the 2026 FIFA World Cup.
Each group creates its own **league**, invites members, and competes over the
whole tournament. The core loop:

- **Predict match scores.** Set the result you expect for every fixture before
  kickoff. Predictions lock at match start. A default `0-0` counts if you don't
  submit one, and you have a short grace window to undo a prediction after
  saving.
- **Earn points.** You score by getting the outcome right, with a bonus for
  nailing the exact scoreline (see [Scoring](#how-scoring-works)).
- **Predict early, score more.** Every prediction carries a multiplier that's
  higher the earlier in the tournament you commit — there's a real cost to
  waiting.
- **Special awards.** Call the big outcomes (champion, finalists, top scorer,
  etc.). The earlier you lock them in, the more they're worth — 50 points before
  the opening match, down to 2 points from the semifinals onward.
- **Duels / challenges (*desafíos*).** Bet part of your balance head-to-head
  against another member. Stakes go into escrow and pay out when the challenge
  resolves.
- **Standings.** Per-league leaderboards with a defined tiebreaker order, updated
  as results come in.
- **Live & rules.** A live view for matches in progress and an in-app rules page
  explaining scoring and multipliers.

Leagues are admin-managed (one admin per league, with the ability to promote
members), and the tournament calendar, phases, and results are driven by seeded
World Cup 2026 data plus a webhook integration that syncs match results.

## How scoring works

Final points for a match are:

```
final points = base points × multiplier
```

| Outcome              | Base points | Meaning                                            |
| -------------------- | ----------- | -------------------------------------------------- |
| **Exact score**      | highest     | You got both teams' goals right.                   |
| **Correct result**   | medium      | Right winner (or draw), wrong scoreline.           |
| **No hit**           | 0           | The match ended with a different result.           |

The **multiplier** is determined by how early you predict — predict before the
tournament heats up and a correct call is worth more.

**Special awards** are scored on a separate, phase-based scale:

| When you locked it in        | Reward  |
| ---------------------------- | ------- |
| Before the opening match     | 50 pts  |
| During the group stage       | 25 pts  |
| Round of 32 / 16 / quarters  | 10 pts  |
| Semifinals onward            | 2 pts   |

(The exact base values and multiplier tiers live in
[`src/utils/scoring`](src/utils/scoring.ts) and
[`src/config/tournamentPhases.ts`](src/config/tournamentPhases.ts), which is the
canonical source of truth for the 2026 phase boundaries.)

## Tech stack

- **[Next.js](https://nextjs.org)** (App Router, Server Actions) with **React 19**
- **[Supabase](https://supabase.com)** — Postgres, Auth (email + Google OAuth),
  Row Level Security, RPCs, and Realtime, wired up with `@supabase/ssr`
- **[Tailwind CSS](https://tailwindcss.com)** + **[shadcn/ui](https://ui.shadcn.com/)**
- **[Zod](https://zod.dev)** for validation
- **Vitest** (unit + integration) and **Playwright** (e2e)
- Deployed on **Vercel**

## Services & APIs

### Supabase (backend)

The whole backend runs on Supabase:

- **Postgres** as the system of record. The schema is defined entirely in
  [`supabase/migrations`](supabase/migrations) — leagues & members, matches,
  predictions, special awards, challenges/escrow, standings, and tournament
  phases.
- **Auth** with email/password and **Google OAuth** (`@supabase/ssr`, cookie
  based sessions across Server Components, Server Actions, and middleware).
- **Row Level Security** on every table so members only ever see and mutate data
  for leagues they belong to.
- **RPCs (Postgres functions)** for all the gameplay that must be atomic and
  trusted server-side — creating/joining a league by invite code, locking and
  scoring predictions, applying the per-round multiplier, resolving challenges
  and escrow payouts, advancing the knockout bracket, and admin result entry.
- **Realtime** — the live standings board subscribes to a per-league channel
  (`live-matches:{leagueId}`) and recomputes positions as match rows change
  ([`LiveStandingsBoard.tsx`](src/components/live/LiveStandingsBoard.tsx)).

### Server Actions

Client mutations go through Next.js Server Actions, validated with Zod, grouped
by domain in [`src/app/actions`](src/app/actions):

- `leagues.actions.ts` — create/join/leave leagues, member & admin management
- `predictions.actions.ts` — submit, edit (within the lock window), and undo
- `special-predictions.actions.ts` — special award picks
- `matches.actions.ts` — match data + admin result entry
- `duels.actions.ts` — create / accept / reject challenges
- `awards-search.actions.ts` — search award candidates (teams/players)

### Zafronix API (external football data)

Tournament data — fixtures, teams, rosters, and live results for World Cup
2026 — comes from the **Zafronix** API. The integration is unified in
[`src/lib/zafronix`](src/lib/zafronix) and documented in
[`docs/zafronix-api-unification.md`](docs/zafronix-api-unification.md) and
[`docs/zafronix-webhook-contract.md`](docs/zafronix-webhook-contract.md).

**Outbound (pull):**

- `GET /fifa/worldcup/v1/matches?year=2026` — the canonical fixtures feed, plus
  team and roster endpoints used to seed the database
  ([`scripts/fetch-seed-data.ts`](scripts/fetch-seed-data.ts),
  [`scripts/restore-zafronix-data.ts`](scripts/restore-zafronix-data.ts)).
- A **backup sync** ([`scripts/sync-matches.ts`](scripts/sync-matches.ts)) runs
  as a GitHub Actions cron every 30 minutes, using conditional `If-None-Match`
  ETag requests to refresh scores without burning the API quota.

**Inbound (push) — webhook:** `POST /api/webhooks/zafronix`
([route](src/app/api/webhooks/zafronix/route.ts)) is the primary, real-time path
for results. It:

- verifies an **HMAC-SHA256** signature (`X-Zafronix-Signature-256`) over
  `timestamp.rawBody` using `ZAFRONIX_WEBHOOK_SECRET`, with timing-safe
  comparison and a replay window check;
- handles the `match.finalized`, `match.patched`, and `match.postponed` events;
- resolves the local match by `external_ref`, bracket slot, or normalized team
  names, then triggers scoring/accrual RPCs.

### Internal API routes

- `POST /api/sync` ([route](src/app/api/sync/route.ts)) — authenticated batch
  upsert of match statuses/scores (≤100 per call), guarded by a
  `Bearer ${CRON_SECRET}` header. Used as a controlled, server-to-server entry
  point for score updates.

## Run locally

> Requires Node and the Supabase CLI (run it with `npx supabase ...` — no global
> install needed).

1. **Install dependencies**

   ```bash
   npm install
   ```

2. **Configure environment.** Copy `.env.example` to `.env.local` and fill in
   your Supabase project values:

   ```env
   NEXT_PUBLIC_SUPABASE_URL=your-project-url
   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your-publishable-or-anon-key
   ```

   Both values are in your [Supabase project's API settings](https://supabase.com/dashboard/project/_/settings/api).
   See `.env.example` for the full set of variables (Google OAuth, integration
   tests, and the match-sync webhook).

3. **(Optional) Run Supabase locally** and apply migrations:

   ```bash
   npx supabase start
   ```

   Migrations live in [`supabase/migrations`](supabase/migrations) and define the
   full schema (leagues, predictions, matches, awards, challenges/escrow,
   standings, RLS, and RPCs).

4. **Start the dev server**

   ```bash
   npm run dev
   ```

   The app runs at [localhost:3000](http://localhost:3000/).

### Useful scripts

| Script                  | What it does                          |
| ----------------------- | ------------------------------------- |
| `npm run dev`           | Start the Next.js dev server          |
| `npm run build`         | Production build                      |
| `npm run lint`          | ESLint                                |
| `npm run typecheck`     | TypeScript type checking              |
| `npm run db:types`      | Regenerate Supabase TypeScript types  |
| `npm run sync-matches`  | Sync match data                       |
| `npm run seed:setup`    | Fetch and generate seed SQL           |

## Testing

```bash
npm run test:unit          # Vitest unit tests
npm run test:integration   # Vitest integration tests (against local Supabase)
npm run test:e2e           # Playwright end-to-end tests
npm run test:ci            # All of the above
```

Integration tests run against a local Supabase instance and read their
credentials from `.env.test.local` (gitignored). Generate it with:

```bash
npx supabase status -o env > .env.test.local
```

## License

[MIT](LICENSE)
