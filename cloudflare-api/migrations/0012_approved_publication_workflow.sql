ALTER TABLE campaign_drafts ADD COLUMN publication_state TEXT NOT NULL DEFAULT 'not_published'
  CHECK (publication_state IN ('not_published','publishing','scheduled','published','needs_action'));
ALTER TABLE posts ADD COLUMN campaign_draft_id TEXT REFERENCES campaign_drafts(id) ON DELETE SET NULL;
ALTER TABLE scheduled_posts ADD COLUMN campaign_draft_id TEXT REFERENCES campaign_drafts(id) ON DELETE SET NULL;

CREATE INDEX campaign_drafts_org_publication_state ON campaign_drafts(org_id, publication_state, updated_at DESC);
