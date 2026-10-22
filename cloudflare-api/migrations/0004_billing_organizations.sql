CREATE TABLE IF NOT EXISTS organizations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  billing_status TEXT NOT NULL DEFAULT 'inactive',
  stripe_customer_id TEXT UNIQUE,
  stripe_subscription_id TEXT UNIQUE,
  created_at TEXT NOT NULL
);

INSERT OR IGNORE INTO organizations(id,name,billing_status,created_at)
SELECT org_id, org_id, 'active', MIN(created_at) FROM users GROUP BY org_id;

INSERT OR IGNORE INTO organizations(id,name,billing_status,created_at)
VALUES('klirline','Klirline Services','active',CURRENT_TIMESTAMP);

CREATE TABLE IF NOT EXISTS stripe_events (
  id TEXT PRIMARY KEY,
  processed_at TEXT NOT NULL
);
