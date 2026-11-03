-- RSS "only new items": feed items a workflow step has already handed on. A row is
-- pending while its run is in flight, committed when the run succeeds and removed
-- when it fails, so a failed post is retried on the next run instead of being lost.
CREATE TABLE IF NOT EXISTS rss_seen_items (
  workflow_id UUID NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  node_id VARCHAR(100) NOT NULL,
  item_key VARCHAR(64) NOT NULL,
  execution_id UUID,
  committed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (workflow_id, node_id, item_key)
);
CREATE INDEX IF NOT EXISTS idx_rss_seen_execution ON rss_seen_items(execution_id);
