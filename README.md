# Ludo Sultan multiplayer server

WebSocket (ws) game server for Ludo Sultan. `npm install && npm start`. Listens on `$PORT` (default 8080). Health: `/health`.

## Persistence (3.10.2+)
Set `DATABASE_URL` (Neon Postgres, pooled URL) and the server stores everything (users/profiles/stats, friends, DMs, blocks,
reports, clubs, Halloween points, leaderboard) in table `ls_kv` (jsonb key-value), loaded at boot and written with a
1.5 s debounce + flush on SIGTERM. Without `DATABASE_URL` it falls back to JSON files in `server/data/` (local dev/tests).
Optional: `PG_TABLE` (separate table for tests), `PG_DRIVER=neon-ws` (dev-only, needs `@neondatabase/serverless`, for networks that block port 5432).

## 3.11.0: accounts, tournaments, 6-player online, events
- **Accounts** (`server/accounts.js`): email + password (scrypt N=16384, per-user salt), hashed session tokens (SHA-256, 180 days, max 10/account),
  guest linking (the current player id becomes the account id), cloud save (`acc_push`/`acc_pull`, max 400 KB), `acc_delete` (also purges social data).
  Stored in Neon table `ls_accounts` (auto-created), JSON fallback `server/data/accounts.json`. Login rate limit: 8 failures / email / 15 min.
- **Google / Facebook sign-in** verification (optional env vars; without them the client shows "coming soon"):
  - `GOOGLE_WEB_CLIENT_ID` — OAuth *Web* client ID (comma-separated list allowed). ID tokens are verified against Google JWKS (RS256, iss, aud, exp, email_verified).
  - `FB_APP_ID`, `FB_APP_SECRET` — access tokens are checked with Graph `debug_token` (app id + validity), then `/me`.
- **Tournaments** (`server/tour.js`): 8-player knockout cups (bronze/silver/sultan/diamond); bots fill after `TOUR_FILL_MS` (default 60 s).
- **6-player online**: `quick` with `size:6` → 6P classic room, bots after 60 s.
- **Event leaderboards**: `evscore` / `evlb` (Halloween `hw26`, Festival of Lights `fol26`).
- Health: `/health`, `/health/db`.
- Tests: `node server/test-v3110.js`, `node server/test-tour-unit.js` (run with `DATABASE_URL` unset).

### 3.11.0 skins
- Client sends `{t:"skin",tok,dice}` (ids `[a-z0-9]{1,16}`, else `classic`) on connect and on equip; saved in the profile (`skin`), restored on reconnect, and included as `tok`/`dice` on each player in `room` messages so opponents see each other's equipped skins. Unlocks/purchases stay client-side (in-game coins/diamonds only, no trading).
- Test: `node server/test-skins.js`.
