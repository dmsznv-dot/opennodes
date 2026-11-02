-- Telegram trigger polling: one getUpdates cursor and lease per bot connection, so
-- updates are acknowledged only after their runs are recorded and only one process
-- polls a bot at a time.
CREATE TABLE IF NOT EXISTS telegram_bot_cursors (
  credential_id UUID PRIMARY KEY REFERENCES credentials(id) ON DELETE CASCADE,
  update_offset BIGINT NOT NULL DEFAULT 0,
  lease_holder VARCHAR(100),
  lease_expires_at TIMESTAMPTZ,
  last_polled_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_triggers_due ON triggers(type, is_enabled, next_trigger_at);
