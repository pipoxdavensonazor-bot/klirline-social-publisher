CREATE TABLE campaign_drafts (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  author_user_id TEXT NOT NULL REFERENCES users(id),
  updated_by_user_id TEXT NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  text TEXT NOT NULL,
  targets_json TEXT NOT NULL DEFAULT '[]',
  media_id TEXT REFERENCES media(id) ON DELETE SET NULL,
  country_code TEXT NOT NULL DEFAULT '',
  language_tag TEXT NOT NULL DEFAULT '',
  timezone TEXT NOT NULL DEFAULT '',
  review_status TEXT NOT NULL DEFAULT 'draft' CHECK(review_status IN ('draft','in_review','approved','rejected')),
  review_note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX campaign_drafts_org_updated ON campaign_drafts(org_id, updated_at DESC);
