CREATE TABLE IF NOT EXISTS api_keys (
  key                 TEXT PRIMARY KEY,
  name                TEXT NOT NULL,
  concurrency_limit   INTEGER NOT NULL DEFAULT 3,
  cps_limit           INTEGER NOT NULL DEFAULT 2,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS calls (
  id                  UUID PRIMARY KEY,
  from_number         TEXT NOT NULL,
  to_number           TEXT NOT NULL,
  metadata            JSONB NOT NULL DEFAULT '{}',
  status              TEXT NOT NULL,
  api_key             TEXT NOT NULL REFERENCES api_keys(key),
  created_at          TIMESTAMPTZ NOT NULL,
  updated_at          TIMESTAMPTZ NOT NULL,
  answered_at         TIMESTAMPTZ,
  ended_at            TIMESTAMPTZ,
  duration_seconds    NUMERIC,
  audio_url           TEXT
);

CREATE INDEX IF NOT EXISTS idx_calls_status ON calls(status);
CREATE INDEX IF NOT EXISTS idx_calls_api_key ON calls(api_key);
CREATE INDEX IF NOT EXISTS idx_calls_created_at ON calls(created_at);

-- Seed demo API keys. Replace/remove for real use.
INSERT INTO api_keys (key, name, concurrency_limit, cps_limit)
VALUES
  ('demo-key-1', 'Demo Key 1', 3, 2),
  ('demo-key-2', 'Demo Key 2', 3, 2)
ON CONFLICT (key) DO NOTHING;
