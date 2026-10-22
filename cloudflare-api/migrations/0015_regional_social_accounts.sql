-- A workspace can manage multiple market-specific accounts on the same network.
-- Preserve existing connections while changing uniqueness from user/provider
-- to user/provider/account identity.
DROP INDEX IF EXISTS idx_connections_user_provider;
CREATE TABLE connections_new (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  org_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  account_id TEXT NOT NULL,
  account_label TEXT NOT NULL,
  account_json TEXT NOT NULL DEFAULT '{}',
  scopes_json TEXT NOT NULL DEFAULT '[]',
  token_ciphertext TEXT NOT NULL,
  token_iv TEXT NOT NULL,
  expires_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(org_id, provider, account_id)
);
INSERT INTO connections_new(id,user_id,org_id,provider,account_id,account_label,account_json,scopes_json,token_ciphertext,token_iv,expires_at,created_at)
SELECT c.id,c.user_id,u.org_id,c.provider,c.account_id,c.account_label,c.account_json,c.scopes_json,c.token_ciphertext,c.token_iv,c.expires_at,c.created_at
FROM connections c JOIN users u ON u.id=c.user_id;
DROP TABLE connections;
ALTER TABLE connections_new RENAME TO connections;
CREATE INDEX idx_connections_user_provider ON connections(user_id, provider);
CREATE INDEX idx_connections_org_provider ON connections(org_id, provider, created_at DESC);

-- A single scheduled publication may target several accounts on one network.
CREATE TABLE scheduled_results_new (
  job_id TEXT NOT NULL REFERENCES scheduled_posts(id) ON DELETE CASCADE,
  target_key TEXT NOT NULL,
  provider TEXT NOT NULL,
  connection_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('queued','published','failed','action-required')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_run_at TEXT NOT NULL,
  result_json TEXT,
  PRIMARY KEY(job_id, target_key)
);
INSERT INTO scheduled_results_new(job_id,target_key,provider,connection_id,status,attempts,next_run_at,result_json)
SELECT job_id,provider,provider,NULL,status,attempts,next_run_at,result_json
FROM scheduled_results;
DROP TABLE scheduled_results;
ALTER TABLE scheduled_results_new RENAME TO scheduled_results;
