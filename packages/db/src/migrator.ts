import { sql } from 'drizzle-orm';
import type { DatabaseInstance } from './client.js';

/**
 * Returns the raw canonical SQL DDL defining all enums, tables, and indexes.
 */
export function getInitialMigrationSql(): string {
  return `
-- Enums
DO $$ BEGIN
  CREATE TYPE user_role AS ENUM ('OWNER', 'ADMIN', 'EDITOR', 'VIEWER');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE execution_status AS ENUM ('QUEUED', 'RUNNING', 'WAITING', 'SUCCEEDED', 'FAILED', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE node_status AS ENUM ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'SKIPPED', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE trigger_type AS ENUM ('manual', 'cron', 'webhook', 'telegram');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE webhook_auth_type AS ENUM ('NONE', 'HEADER_TOKEN', 'HMAC_SIGNATURE');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- 1. Users
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  full_name VARCHAR(255),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  is_owner BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_is_owner ON users(is_owner);

-- 2. Sessions
CREATE TABLE IF NOT EXISTS sessions (
  id VARCHAR(128) PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  ip_address VARCHAR(64),
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);

-- 3. Workspaces
CREATE TABLE IF NOT EXISTS workspaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(255) NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_workspaces_slug ON workspaces(slug);

-- 4. Memberships
CREATE TABLE IF NOT EXISTS memberships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  role user_role NOT NULL DEFAULT 'VIEWER',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_memberships_user_workspace UNIQUE (user_id, workspace_id)
);
CREATE INDEX IF NOT EXISTS idx_memberships_user_id ON memberships(user_id);
CREATE INDEX IF NOT EXISTS idx_memberships_workspace_id ON memberships(workspace_id);

-- 5. Workspace Settings
CREATE TABLE IF NOT EXISTS workspace_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL UNIQUE REFERENCES workspaces(id) ON DELETE CASCADE,
  execution_timeout_ms INTEGER NOT NULL DEFAULT 300000,
  max_concurrency INTEGER NOT NULL DEFAULT 10,
  retention_days INTEGER NOT NULL DEFAULT 30,
  ssrf_allowlist JSONB NOT NULL DEFAULT '[]'::jsonb,
  settings_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_workspace_settings_workspace_id ON workspace_settings(workspace_id);

-- 6. API Keys
CREATE TABLE IF NOT EXISTS api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  key_prefix VARCHAR(16) NOT NULL,
  key_hash VARCHAR(255) NOT NULL UNIQUE,
  role user_role NOT NULL DEFAULT 'EDITOR',
  last_used_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_api_keys_key_hash ON api_keys(key_hash);
CREATE INDEX IF NOT EXISTS idx_api_keys_workspace_id ON api_keys(workspace_id);

-- 7. Invitations
CREATE TABLE IF NOT EXISTS invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  email VARCHAR(255) NOT NULL,
  role user_role NOT NULL DEFAULT 'VIEWER',
  token VARCHAR(255) NOT NULL UNIQUE,
  invited_by UUID REFERENCES users(id) ON DELETE SET NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_invitations_token ON invitations(token);
CREATE INDEX IF NOT EXISTS idx_invitations_workspace_email ON invitations(workspace_id, email);

-- 8. Credentials (Envelope Encrypted)
CREATE TABLE IF NOT EXISTS credentials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  type VARCHAR(100) NOT NULL,
  key_version INTEGER NOT NULL DEFAULT 1,
  iv VARCHAR(64) NOT NULL,
  auth_tag VARCHAR(64) NOT NULL,
  ciphertext TEXT NOT NULL,
  masked_hint VARCHAR(255),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_credentials_workspace_type ON credentials(workspace_id, type);
CREATE INDEX IF NOT EXISTS idx_credentials_workspace_name ON credentials(workspace_id, name);

-- 9. Workflows
CREATE TABLE IF NOT EXISTS workflows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT FALSE,
  is_archived BOOLEAN NOT NULL DEFAULT FALSE,
  active_version_id UUID,
  draft_nodes JSONB NOT NULL DEFAULT '[]'::jsonb,
  draft_edges JSONB NOT NULL DEFAULT '[]'::jsonb,
  draft_trigger_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  draft_execution_policy JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_workflows_workspace_id ON workflows(workspace_id);
CREATE INDEX IF NOT EXISTS idx_workflows_created_by ON workflows(created_by);

-- 10. Workflow Versions (Immutable Snapshots)
CREATE TABLE IF NOT EXISTS workflow_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id UUID NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,
  is_draft BOOLEAN NOT NULL DEFAULT FALSE,
  schema_version VARCHAR(16) NOT NULL DEFAULT '1.0',
  nodes JSONB NOT NULL,
  edges JSONB NOT NULL,
  trigger_config JSONB NOT NULL,
  execution_policy JSONB NOT NULL DEFAULT '{}'::jsonb,
  credential_references JSONB NOT NULL DEFAULT '[]'::jsonb,
  checksum VARCHAR(64) NOT NULL,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_workflow_versions_number UNIQUE (workflow_id, version_number)
);
CREATE INDEX IF NOT EXISTS idx_workflow_versions_lookup ON workflow_versions(workflow_id, is_draft);
CREATE INDEX IF NOT EXISTS idx_workflow_versions_checksum ON workflow_versions(checksum);

-- 11. Executions
CREATE TABLE IF NOT EXISTS executions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  workflow_id UUID NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  workflow_version_id UUID NOT NULL REFERENCES workflow_versions(id) ON DELETE RESTRICT,
  status execution_status NOT NULL DEFAULT 'QUEUED',
  trigger_type VARCHAR(50) NOT NULL,
  trigger_payload JSONB,
  idempotency_key VARCHAR(255),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  duration_ms INTEGER,
  error_message TEXT,
  error_node_id VARCHAR(100),
  retry_count INTEGER NOT NULL DEFAULT 0,
  priority INTEGER NOT NULL DEFAULT 0,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_executions_workspace_status ON executions(workspace_id, status);
CREATE INDEX IF NOT EXISTS idx_executions_workflow_started ON executions(workflow_id, started_at);
CREATE INDEX IF NOT EXISTS idx_executions_idempotency ON executions(workspace_id, idempotency_key);

-- 12. Node Executions
CREATE TABLE IF NOT EXISTS node_executions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  execution_id UUID NOT NULL REFERENCES executions(id) ON DELETE CASCADE,
  node_id VARCHAR(100) NOT NULL,
  node_type VARCHAR(100) NOT NULL,
  node_name VARCHAR(255),
  status node_status NOT NULL DEFAULT 'PENDING',
  retry_count INTEGER NOT NULL DEFAULT 0,
  input_payload JSONB,
  output_payload JSONB,
  error_details JSONB,
  error_message TEXT,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  duration_ms INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_node_executions_execution ON node_executions(execution_id);
CREATE INDEX IF NOT EXISTS idx_node_executions_node ON node_executions(execution_id, node_id);
CREATE INDEX IF NOT EXISTS idx_node_executions_status ON node_executions(execution_id, status);

-- 13. Execution Logs
CREATE TABLE IF NOT EXISTS execution_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  execution_id UUID NOT NULL REFERENCES executions(id) ON DELETE CASCADE,
  node_execution_id UUID REFERENCES node_executions(id) ON DELETE CASCADE,
  node_id VARCHAR(100),
  level VARCHAR(20) NOT NULL DEFAULT 'info',
  message TEXT NOT NULL,
  metadata JSONB,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_execution_logs_execution ON execution_logs(execution_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_execution_logs_node_execution ON execution_logs(node_execution_id);

-- 14. Execution Events
CREATE TABLE IF NOT EXISTS execution_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  execution_id UUID NOT NULL REFERENCES executions(id) ON DELETE CASCADE,
  event_type VARCHAR(64) NOT NULL,
  node_id VARCHAR(100),
  payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_execution_events_execution ON execution_events(execution_id, created_at);

-- 15. Triggers
CREATE TABLE IF NOT EXISTS triggers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  workflow_id UUID NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  type VARCHAR(50) NOT NULL,
  name VARCHAR(255) NOT NULL,
  is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_triggered_at TIMESTAMPTZ,
  next_trigger_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_triggers_workspace ON triggers(workspace_id);
CREATE INDEX IF NOT EXISTS idx_triggers_workflow ON triggers(workflow_id);
CREATE INDEX IF NOT EXISTS idx_triggers_type_enabled ON triggers(type, is_enabled);

-- 16. Trigger Logs
CREATE TABLE IF NOT EXISTS trigger_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trigger_id UUID NOT NULL REFERENCES triggers(id) ON DELETE CASCADE,
  execution_id UUID REFERENCES executions(id) ON DELETE SET NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'success',
  payload JSONB,
  error_message TEXT,
  triggered_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_trigger_logs_trigger ON trigger_logs(trigger_id, triggered_at);
CREATE INDEX IF NOT EXISTS idx_trigger_logs_execution ON trigger_logs(execution_id);

-- 17. Webhook Subscriptions
CREATE TABLE IF NOT EXISTS webhook_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  workflow_id UUID NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  endpoint_token VARCHAR(64) NOT NULL UNIQUE,
  http_method VARCHAR(16) NOT NULL DEFAULT 'POST',
  secret_hash VARCHAR(255),
  auth_type webhook_auth_type NOT NULL DEFAULT 'NONE',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  idempotency_header VARCHAR(64),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_webhook_subs_token ON webhook_subscriptions(endpoint_token);
CREATE INDEX IF NOT EXISTS idx_webhook_subs_workspace ON webhook_subscriptions(workspace_id);
CREATE INDEX IF NOT EXISTS idx_webhook_subs_workflow ON webhook_subscriptions(workflow_id);

-- 18. Audit Logs
CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  action VARCHAR(100) NOT NULL,
  resource_type VARCHAR(100) NOT NULL,
  resource_id VARCHAR(255) NOT NULL,
  details JSONB,
  ip_address VARCHAR(64),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_audit_logs_workspace_created ON audit_logs(workspace_id, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_resource ON audit_logs(resource_type, resource_id);
`;
}

/**
 * Synchronizes the schema by executing the canonical DDL statements.
 */
export async function syncSchema(db: DatabaseInstance): Promise<void> {
  const statements = getInitialMigrationSql();
  const rawClient = (db as any).session?.client ?? (db as any).$client;
  if (rawClient && typeof rawClient.exec === 'function') {
    await rawClient.exec(statements);
  } else if (rawClient && typeof rawClient.query === 'function') {
    await rawClient.query(statements);
  } else {
    await db.execute(sql.raw(statements));
  }
}

/**
 * Migration runner suitable for production or CLI execution.
 */
export async function runMigrations(db: DatabaseInstance): Promise<void> {
  await syncSchema(db);
}
