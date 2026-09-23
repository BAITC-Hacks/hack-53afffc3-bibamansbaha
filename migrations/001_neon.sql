CREATE TABLE IF NOT EXISTS ekt_sessions (
  id text PRIMARY KEY CHECK (id ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  state jsonb NOT NULL,
  revision bigint NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS ekt_sessions_expiry ON ekt_sessions(expires_at);
-- State is the existing session aggregate: cart/items, proposals/confirmation receipts,
-- requested lines and ordered messages. Integer minor-unit money is preserved in JSONB.
-- Every read/modify/write holds this session row FOR UPDATE until the aggregate is saved.
CREATE TABLE IF NOT EXISTS ekt_budget_policy (
  purpose text PRIMARY KEY CHECK (purpose IN ('acceptance', 'demo')),
  max_calls integer NOT NULL,
  max_nano_usd bigint NOT NULL,
  CHECK ((purpose='acceptance' AND max_calls BETWEEN 0 AND 6 AND max_nano_usd BETWEEN 0 AND 250000000)
      OR (purpose='demo' AND max_calls BETWEEN 0 AND 100 AND max_nano_usd BETWEEN 0 AND 1000000000))
);
CREATE TABLE IF NOT EXISTS ekt_budget_attempts (
  id uuid PRIMARY KEY,
  purpose text NOT NULL REFERENCES ekt_budget_policy(purpose),
  requested_model text NOT NULL,
  returned_model text,
  status text NOT NULL CHECK(status IN ('reserved','completed','error','timeout')),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  input_tokens bigint,
  output_tokens bigint,
  reasoning_tokens bigint,
  duration_ms bigint,
  reserved_nano_usd bigint NOT NULL CHECK(reserved_nano_usd>=0),
  committed_nano_usd bigint NOT NULL CHECK(committed_nano_usd>=0)
);
CREATE INDEX IF NOT EXISTS ekt_budget_attempts_purpose ON ekt_budget_attempts(purpose);
CREATE TABLE IF NOT EXISTS ekt_rate_limits (
  key text NOT NULL,
  bucket bigint NOT NULL,
  count integer NOT NULL,
  PRIMARY KEY(key, bucket)
);
