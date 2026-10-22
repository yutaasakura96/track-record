#!/bin/bash
# The proxy image's own /app/start.sh, mounted over it by docker-compose.yml,
# with three flags added: `--endpoint-rps-limit` and the two `--sql-over-http-pool`
# ones below it.
#
# The proxy rate-limits authentication attempts per endpoint, and over HTTP
# every query is one. Its default burst allowance is sized for a cloud service
# guarding a compute. Here it guards a local container, and the suite's parallel
# files exceed it within three seconds of starting: 60 queries refused with
# "Too many connections to this endpoint" in a single second. The limit had
# only ever held because SCRAM made each query cost ~110ms
# (`scripts/ensure-databases.mjs`).
#
# The pool flags stop a connection being opened and thrown away per query. The
# proxy draws from its pool only for requests that send `Neon-Pool-Opt-In:
# true`, and the driver never sends it, so every query opened a Postgres
# connection and handed it back to a pool capped at 20. Past the cap each one was
# closed with an INFO line: 30,820 "pool is full" lines in one suite run
# (decision log 2026-10-22). `--sql-over-http-pool-opt-in=false` pools every
# request. A full suite run peaked at 25 Postgres connections, so the cap of 64
# is headroom that stays under `max_connections` of 100 with room for the
# proxy's own role lookups and a psql session.
#
# Everything else is the image's script verbatim, as of the digest pinned in
# docker-compose.yml. Re-copy it when that digest changes:
# `docker compose exec neon-proxy cat start.sh`.

# Forward SIGTERM to child processes
trap 'kill -TERM $(jobs -p) 2>/dev/null' TERM

if [ -z "$PG_CONNECTION_STRING" ]; then
  echo "PG_CONNECTION_STRING is not set"
  exit 1
fi

# Create required tables
psql -Atx $PG_CONNECTION_STRING \
  -c "CREATE SCHEMA IF NOT EXISTS neon_control_plane" \
  -c "CREATE TABLE neon_control_plane.endpoints (endpoint_id VARCHAR(255) PRIMARY KEY, allowed_ips VARCHAR(255))"

# Start the neon-proxy
./neon-proxy \
  -c server.pem \
  -k server.key \
  --auth-backend=postgres \
  --auth-endpoint=$PG_CONNECTION_STRING \
  --wss=0.0.0.0:4445 \
  --endpoint-rps-limit=100000@1s \
  --sql-over-http-pool-opt-in=false \
  --sql-over-http-pool-max-conns-per-endpoint=64 \
  &

# Start caddy reverse proxy
caddy run \
  --config ./Caddyfile \
  --adapter caddyfile \
  &

wait
