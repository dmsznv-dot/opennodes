-- 0005: workspace preset libraries, atomically versioned for browser/desktop sync.
-- Additive only: existing workspaces, workflows and browser preset IDs are preserved.
CREATE TABLE IF NOT EXISTS workspace_preset_libraries (
  workspace_id UUID PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL DEFAULT 0,
  voice_presets JSONB NOT NULL DEFAULT '[]'::jsonb,
  prompt_presets JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
