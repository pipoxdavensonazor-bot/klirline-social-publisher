CREATE TABLE IF NOT EXISTS atproto_oauth_states (
  state_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  state_ciphertext TEXT NOT NULL,
  state_iv TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_atproto_oauth_states_expiry
  ON atproto_oauth_states(expires_at);

CREATE TABLE IF NOT EXISTS atproto_oauth_sessions (
  did TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_ciphertext TEXT NOT NULL,
  session_iv TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS atproto_session_locks (
  lock_key TEXT PRIMARY KEY,
  lease_until TEXT NOT NULL
);
