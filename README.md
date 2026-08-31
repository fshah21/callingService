# call-service

An async REST + WebSocket service that simulates a calling/telephony platform. Calls progress
through a state machine over time (`queued -> ringing -> answered/unanswered -> completed`),
live state is held in Redis, and a background worker periodically (and immediately on
completion) persists calls durably to Postgres, then uploads a mock recording to S3.

## Architecture

```
                 ┌────────────┐        ┌────────────────────┐
  REST + WS ───▶ │  api (HTTP)│──────▶ │        Redis        │◀──────┐
                 └────────────┘  live  │  call:<id> hashes    │       │
                        ▲       state  │  apikey:<key>:active │   live state
                        │              │  apikey:<key>:cps:*   │       │
               call.update (pub/sub)   │  stats:* counters     │       │
                        │              │  BullMQ job queues     │       │
                        │              └────────────────────┘       │
                        │                        ▲                   │
                 ┌────────────┐         schedules/consumes           │
                 │   worker   │────────────────────────────────────┘
                 │ (BullMQ)   │────────────┐
                 └────────────┘            │ on completion (async)
                        │                   ▼
                periodic + on-completion  ┌──────────────┐
                        │ upsert          │ S3 / MinIO   │  mock recordings
                        ▼                 └──────────────┘
                 ┌────────────┐
                 │  Postgres  │  durable call history
                 └────────────┘
```

- **api**: Express REST API + `ws` WebSocket server. Handles auth, rate limiting,
  concurrency-limit admission, and read paths. Publishes/relays call status changes over
  WebSocket via Redis pub/sub.
- **worker**: BullMQ worker. Owns the call state machine — every status transition is a
  delayed job, so timing is durable across restarts. Also runs a repeatable job that flushes
  all live Redis call state into Postgres on an interval, and uploads a mock audio recording to
  S3/MinIO whenever a call completes.
- **Redis**: source of truth for *live* call state (`call:<id>` hash), per-API-key concurrency
  tracking (`apikey:<key>:active` set) and calls-per-second tracking (`apikey:<key>:cps:<sec>`
  counters), both checked/updated atomically via Lua scripts, running stats counters, and the
  BullMQ job queues.
- **Postgres**: durable history, applied via versioned migrations (see below). `GET /calls/:id`
  reads Redis first and falls back to Postgres (e.g. after a completed call's Redis TTL
  expires).
- **S3 / MinIO**: object storage for the (mock) call recording uploaded once a call completes.
  MinIO stands in for S3 for local/dev use — swap the `S3_*` env vars for real AWS credentials
  and endpoint to point this at actual S3.

## Call state machine

```
queued --(0.5-2s)--> ringing --(2-6s)--> answered --(5-30s)--> completed
                                     \--> unanswered --(0.5-1.5s)--> completed
```

Each arrow is a delayed BullMQ job (`call-transitions` queue) scheduled by the worker after
applying the previous transition. Timings and the answer probability are configurable via env
vars (see `.env.example`). On reaching `completed`, the worker also enqueues a `call-recordings`
job (see below) — this is fire-and-forget: enqueuing only writes the job to Redis, it does not
wait for the (separately processed) upload, so it never blocks the transition.

## Auth

Every `/calls` endpoint requires `Authorization: Bearer <api-key>`. Seeded demo keys (see
`migrations/0001_init.sql`): `demo-key-1` and `demo-key-2`, both with a concurrency limit of 3
and a CPS (calls-per-second) limit of 2 — both limits are per-API-key columns in `api_keys`, so
they're configurable per key, these are just the demo defaults.

`/health` and `/metrics` are intentionally left unauthenticated (typical for
liveness probes and internal Prometheus scraping) — put them behind network policy if they're
reachable externally.

## API

### `POST /calls`

```
POST /calls
Authorization: Bearer demo-key-1
Content-Type: application/json

{ "from": "+15551234567", "to": "+15559876543", "metadata": { "campaign": "q3-outbound" } }
```

Returns `201` with the call plus a `websocket_url` clients can connect to for live updates:

```json
{
  "call_id": "b302f613-5610-4382-90f4-0a81c6bad9b1",
  "from": "+15551234567",
  "to": "+15559876543",
  "metadata": { "campaign": "q3-outbound" },
  "status": "queued",
  "created_at": "2026-08-31T17:37:25.256Z",
  "updated_at": "2026-08-31T17:37:25.256Z",
  "answered_at": null,
  "ended_at": null,
  "duration_seconds": null,
  "audio_url": null,
  "websocket_url": "ws://localhost:3000/ws/calls/b302f613-5610-4382-90f4-0a81c6bad9b1"
}
```

Errors:
- `429 {"error":"rate limit exceeded"}` — this API key's calls-per-second limit was hit.
- `429 {"error":"concurrent call limit (3) reached for this api key"}` — this key already has
  the max number of in-flight calls.

### `GET /calls/:id`

Returns the current call state in the same shape as above (`404` if not found or not owned by
the requesting key). Once the completed-call recording finishes uploading, `audio_url` is
populated.

### `GET /metrics`

Prometheus exposition format. Includes `calls_by_status`, `calls_created_total`,
`calls_answered_total`, `calls_unanswered_total`, `calls_completed_total`,
`call_answered_duration_seconds_avg`, `concurrent_calls{api_key}`,
`concurrent_calls_limit{api_key}`, `call_queue_jobs{state}`, `websocket_connections`, plus
Node's default process metrics.

### `GET /health`

Liveness/readiness check — pings Redis and Postgres.

## WebSocket

Connect with `Authorization: Bearer <api-key>` (works with any WS client library that can set
headers), or `?apiKey=` as a fallback for browsers, which can't set custom headers on the native
WebSocket handshake. The `websocket_url` returned from `POST /calls` doesn't embed the key —
append `?apiKey=` yourself for a browser client, or set the header for anything else.

- `ws://host/ws/calls/:id` — auto-subscribes to one call's updates.
- `ws://host/ws` — connect, then send `{"type":"subscribe","call_id":"..."}` per call you want
  to watch (and `{"type":"unsubscribe","call_id":"..."}` to stop).

You only ever receive updates for calls owned by your own API key. Every message is JSON:

```
{"type":"connected","clientId":1}
{"type":"subscribed","call_id":"...","call":{...}}
{"type":"call.update","call":{...}}
{"type":"error","error":"call not found","call_id":"..."}
```

## Database schema / migrations

Schema lives in `migrations/*.sql`, applied in filename order by `scripts/migrate.js` — a small
dependency-free runner (just uses the existing `pg` client) that tracks what's been applied in a
`schema_migrations` table, so it's safe to run repeatedly. In `docker-compose.yml` this runs as
a one-off `migrate` service that `api`/`worker` wait on (`service_completed_successfully`)
before starting. To add a schema change, drop a new `NNNN_description.sql` file into
`migrations/` and re-run `node scripts/migrate.js` (or just `docker compose up`, which re-runs
it automatically since previously-applied files are skipped).

Tables: `api_keys` (key, name, concurrency_limit, cps_limit) and `calls` (id, from_number,
to_number, metadata, status, api_key, created_at, updated_at, answered_at, ended_at,
duration_seconds, audio_url).

## Running it

```
docker compose up --build
```

This runs migrations against Postgres, then starts Redis, MinIO (S3-compatible storage, console
at `:9001`, user/pass `minioadmin`/`minioadmin`), the `api` service on `:3000`, and the `worker`
service.

Quick smoke test once it's up:

```bash
curl -s -X POST localhost:3000/calls \
  -H 'Authorization: Bearer demo-key-1' -H 'content-type: application/json' \
  -d '{"from":"+15551234567","to":"+15559876543"}' | tee /tmp/call.json

CALL_ID=$(node -e "console.log(require('/tmp/call.json').call_id)")
curl -s localhost:3000/calls/$CALL_ID -H 'Authorization: Bearer demo-key-1'
curl -s localhost:3000/metrics
```

Watch a call live over WebSocket (e.g. with `wscat`):

```bash
wscat -c "ws://localhost:3000/ws/calls/$CALL_ID" -H "Authorization: Bearer demo-key-1"
```

Trigger the CPS limit (2/sec per key):

```bash
for i in 1 2 3 4 5; do
  curl -s -o /dev/null -w "%{http_code}\n" -X POST localhost:3000/calls \
    -H 'Authorization: Bearer demo-key-1' -H 'content-type: application/json' \
    -d '{"from":"+1555000000'"$i"'","to":"+15559999999"}' &
done; wait
```

### Running without Docker

Point `REDIS_URL`/`DATABASE_URL`/`S3_*` at local instances, run migrations once, then:

```bash
npm install
node scripts/migrate.js
npm start          # api
npm run worker      # in a second terminal
```

## Notes / things to harden for real production use

- API keys are seeded via migration for the demo; a real deployment would manage them through
  an admin API/table with hashed keys rather than plaintext.
- Redis is authoritative for live state with no persistence guarantees of its own beyond the
  periodic Postgres flush (default every 10s) and the immediate write-through on call
  completion — a Redis crash between flushes can lose in-flight (not-yet-completed) call
  progress. Enabling Redis AOF/RDB persistence would close that gap further.
- The CPS limiter is a fixed-window (per wall-clock second) counter, not a sliding window — it's
  simple and race-free but allows short bursts across a window boundary (e.g. 2 requests at
  `t=0.99s` and 2 more at `t=1.01s`). A sliding-window or token-bucket algorithm would be
  stricter if that matters for your use case.
- The uploaded "recording" is a generated silent WAV sized to the call's talk time — there's no
  real audio in a simulator. Swap `recordingService.buildMockWavBuffer` for real audio if this
  is ever wired to something that produces actual audio.
