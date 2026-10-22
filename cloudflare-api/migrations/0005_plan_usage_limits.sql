ALTER TABLE organizations ADD COLUMN billing_period_start TEXT;
ALTER TABLE organizations ADD COLUMN billing_period_end TEXT;
ALTER TABLE posts ADD COLUMN usage_period TEXT;
ALTER TABLE scheduled_posts ADD COLUMN usage_period TEXT;

CREATE TABLE IF NOT EXISTS usage_counters (
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  period_key TEXT NOT NULL,
  publication_count INTEGER NOT NULL DEFAULT 0 CHECK (publication_count >= 0),
  PRIMARY KEY(org_id, period_key)
);
