CREATE TABLE IF NOT EXISTS auth_limits (
  bucket_key TEXT PRIMARY KEY,
  window_started INTEGER NOT NULL,
  failures INTEGER NOT NULL
);
