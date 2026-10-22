# Ludo Sultan multiplayer server

WebSocket (ws) game server for Ludo Sultan. `npm install && npm start`. Listens on `$PORT` (default 8080). Health: `/health`.

## Persistence (3.10.2+)
Set `DATABASE_URL` (Neon Postgres, pooled URL) and the server stores everything (users/profiles/stats, friends, DMs, blocks,
reports, clubs, Halloween points, leaderboard) in table `ls_kv` (jsonb key-value), loaded at boot and written with a
1.5 s debounce + flush on SIGTERM. Without `DATABASE_URL` it falls back to JSON files in `server/data/` (local dev/tests).
Optional: `PG_TABLE` (separate table for tests), `PG_DRIVER=neon-ws` (dev-only, needs `@neondatabase/serverless`, for networks that block port 5432).
