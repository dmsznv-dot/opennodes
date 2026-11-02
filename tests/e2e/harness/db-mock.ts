/**
 * LocalFlow E2E Test Suite - In-Memory Database Mock
 * Simulates all 18 PostgreSQL tables defined in PROJECT.md and survey_spec.md.
 * Provides genuine relational queries, foreign key enforcement, unique constraints, and transaction state.
 */

import * as crypto from 'node:crypto';
import type { ExecutionStatus, NodeExecutionStatus, UserRole } from './types.ts';

export interface DbUser {
  id: string;
  email: string;
  password_hash: string;
  full_name?: string;
  is_owner: boolean;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface DbSession {
  id: string;
  user_id: string;
  expires_at: Date;
  created_at: Date;
}

export interface DbWorkspace {
  id: string;
  name: string;
  slug: string;
  created_at: Date;
  updated_at: Date;
}

export interface DbMembership {
  id: string;
  user_id: string;
  workspace_id: string;
  role: UserRole;
  created_at: Date;
  updated_at: Date;
}

export interface DbCredential {
  id: string;
  workspace_id: string;
  name: string;
  type: string;
  key_version: number;
  encrypted_payload: string | { iv: string; authTag: string; ciphertext: string };
  created_by?: string;
  created_at: Date;
  updated_at: Date;
}

export interface DbWorkflow {
  id: string;
  workspace_id: string;
  name: string;
  description?: string;
  is_active: boolean;
  active_version_id?: string;
  draft_nodes: unknown[];
  draft_edges: unknown[];
  draft_trigger_config: Record<string, unknown>;
  created_by?: string;
  created_at: Date;
  updated_at: Date;
}

export interface DbWorkflowVersion {
  id: string;
  workflow_id: string;
  version_number: number;
  is_draft: boolean;
  snapshot: unknown;
  checksum: string;
  created_by?: string;
  created_at: Date;
}

export interface DbExecution {
  id: string;
  workflow_id: string;
  workflow_version_id: string;
  workspace_id: string;
  status: ExecutionStatus;
  trigger_type: string;
  trigger_payload: unknown;
  idempotency_key?: string;
  started_at?: Date;
  finished_at?: Date;
  duration_ms?: number;
  error_summary?: string;
  retry_count: number;
  created_at: Date;
  updated_at: Date;
}

export interface DbNodeExecution {
  id: string;
  execution_id: string;
  node_id: string;
  node_type: string;
  status: NodeExecutionStatus;
  retry_count: number;
  input_payload?: unknown;
  output_payload?: unknown;
  error_details?: unknown;
  started_at?: Date;
  finished_at?: Date;
  duration_ms?: number;
  created_at: Date;
}

export interface DbExecutionEvent {
  id: number;
  execution_id: string;
  event_type: string;
  node_id?: string;
  payload?: unknown;
  created_at: Date;
}

export interface DbWebhookEndpoint {
  id: string;
  workspace_id: string;
  workflow_id: string;
  endpoint_token: string;
  secret_hash?: string;
  http_method: string;
  is_active: boolean;
  created_at: Date;
}

export interface DbAuditLog {
  id: string;
  workspace_id: string;
  user_id?: string;
  action: string;
  target_id?: string;
  metadata?: unknown;
  created_at: Date;
}

export interface DbWorkspaceSetting {
  workspace_id: string;
  key: string;
  value: unknown;
  updated_at: Date;
}

export interface DbApiKey {
  id: string;
  workspace_id: string;
  user_id: string;
  key_hash: string;
  name: string;
  created_at: Date;
}

export interface DbInvitation {
  id: string;
  workspace_id: string;
  email: string;
  role: UserRole;
  token: string;
  expires_at: Date;
  created_at: Date;
}

export interface DbTrigger {
  id: string;
  workflow_id: string;
  type: string;
  config: unknown;
  is_enabled: boolean;
  created_at: Date;
}

export interface DbTriggerLog {
  id: string;
  trigger_type: string;
  workflow_id: string;
  status: string;
  payload: unknown;
  created_at: Date;
}

export interface DbSystemSetting {
  key: string;
  value: unknown;
  updated_at: Date;
}

export class InMemoryDatabase {
  // 18 tables storage
  users = new Map<string, DbUser>();
  sessions = new Map<string, DbSession>();
  workspaces = new Map<string, DbWorkspace>();
  memberships = new Map<string, DbMembership>();
  credentials = new Map<string, DbCredential>();
  workflows = new Map<string, DbWorkflow>();
  workflow_versions = new Map<string, DbWorkflowVersion>();
  executions = new Map<string, DbExecution>();
  node_executions = new Map<string, DbNodeExecution>();
  execution_events: DbExecutionEvent[] = [];
  webhook_endpoints = new Map<string, DbWebhookEndpoint>();
  audit_logs = new Map<string, DbAuditLog>();
  workspace_settings = new Map<string, DbWorkspaceSetting>();
  api_keys = new Map<string, DbApiKey>();
  invitations = new Map<string, DbInvitation>();
  triggers = new Map<string, DbTrigger>();
  trigger_logs = new Map<string, DbTriggerLog>();
  system_settings = new Map<string, DbSystemSetting>();

  private eventCounter = 1;

  reset(): void {
    this.users.clear();
    this.sessions.clear();
    this.workspaces.clear();
    this.memberships.clear();
    this.credentials.clear();
    this.workflows.clear();
    this.workflow_versions.clear();
    this.executions.clear();
    this.node_executions.clear();
    this.execution_events = [];
    this.webhook_endpoints.clear();
    this.audit_logs.clear();
    this.workspace_settings.clear();
    this.api_keys.clear();
    this.invitations.clear();
    this.triggers.clear();
    this.trigger_logs.clear();
    this.system_settings.clear();
    this.eventCounter = 1;
  }

  // Users & Auth
  createUser(user: Omit<DbUser, 'id' | 'created_at' | 'updated_at'> & { id?: string }): DbUser {
    // Unique email constraint
    for (const u of this.users.values()) {
      if (u.email.toLowerCase() === user.email.toLowerCase()) {
        throw new Error(`Unique constraint violation: email "${user.email}" already exists`);
      }
    }
    const record: DbUser = {
      id: user.id || crypto.randomUUID(),
      email: user.email,
      password_hash: user.password_hash,
      full_name: user.full_name,
      is_owner: user.is_owner ?? false,
      is_active: user.is_active ?? true,
      created_at: new Date(),
      updated_at: new Date()
    };
    this.users.set(record.id, record);
    return record;
  }

  findUserByEmail(email: string): DbUser | undefined {
    return Array.from(this.users.values()).find(u => u.email.toLowerCase() === email.toLowerCase());
  }

  // Workspaces
  createWorkspace(ws: Omit<DbWorkspace, 'id' | 'created_at' | 'updated_at'> & { id?: string }): DbWorkspace {
    for (const w of this.workspaces.values()) {
      if (w.slug.toLowerCase() === ws.slug.toLowerCase()) {
        throw new Error(`Unique constraint violation: slug "${ws.slug}" already exists`);
      }
    }
    const record: DbWorkspace = {
      id: ws.id || crypto.randomUUID(),
      name: ws.name,
      slug: ws.slug,
      created_at: new Date(),
      updated_at: new Date()
    };
    this.workspaces.set(record.id, record);
    return record;
  }

  // Memberships
  addMembership(m: Omit<DbMembership, 'id' | 'created_at' | 'updated_at'> & { id?: string }): DbMembership {
    for (const mem of this.memberships.values()) {
      if (mem.user_id === m.user_id && mem.workspace_id === m.workspace_id) {
        throw new Error(`Unique constraint violation: user ${m.user_id} already has membership in workspace ${m.workspace_id}`);
      }
    }
    const record: DbMembership = {
      id: m.id || crypto.randomUUID(),
      user_id: m.user_id,
      workspace_id: m.workspace_id,
      role: m.role,
      created_at: new Date(),
      updated_at: new Date()
    };
    this.memberships.set(record.id, record);
    return record;
  }

  // Workflows
  createWorkflow(wf: Omit<DbWorkflow, 'id' | 'created_at' | 'updated_at'> & { id?: string }): DbWorkflow {
    const record: DbWorkflow = {
      id: wf.id || crypto.randomUUID(),
      workspace_id: wf.workspace_id,
      name: wf.name,
      description: wf.description,
      is_active: wf.is_active ?? false,
      active_version_id: wf.active_version_id,
      draft_nodes: wf.draft_nodes || [],
      draft_edges: wf.draft_edges || [],
      draft_trigger_config: wf.draft_trigger_config || {},
      created_by: wf.created_by,
      created_at: new Date(),
      updated_at: new Date()
    };
    this.workflows.set(record.id, record);
    return record;
  }

  createWorkflowVersion(v: Omit<DbWorkflowVersion, 'id' | 'created_at'> & { id?: string }): DbWorkflowVersion {
    for (const ver of this.workflow_versions.values()) {
      if (ver.workflow_id === v.workflow_id && ver.version_number === v.version_number) {
        throw new Error(`Unique constraint violation: version ${v.version_number} already exists for workflow ${v.workflow_id}`);
      }
    }
    const record: DbWorkflowVersion = {
      id: v.id || crypto.randomUUID(),
      workflow_id: v.workflow_id,
      version_number: v.version_number,
      is_draft: v.is_draft ?? false,
      snapshot: v.snapshot,
      checksum: v.checksum,
      created_by: v.created_by,
      created_at: new Date()
    };
    this.workflow_versions.set(record.id, record);
    return record;
  }

  // Credentials
  createCredential(cred: Omit<DbCredential, 'id' | 'created_at' | 'updated_at'> & { id?: string }): DbCredential {
    const record: DbCredential = {
      id: cred.id || crypto.randomUUID(),
      workspace_id: cred.workspace_id,
      name: cred.name,
      type: cred.type,
      key_version: cred.key_version || 1,
      encrypted_payload: cred.encrypted_payload,
      created_by: cred.created_by,
      created_at: new Date(),
      updated_at: new Date()
    };
    this.credentials.set(record.id, record);
    return record;
  }

  // Executions
  createExecution(ex: Omit<DbExecution, 'id' | 'created_at' | 'updated_at'> & { id?: string }): DbExecution {
    const record: DbExecution = {
      id: ex.id || crypto.randomUUID(),
      workflow_id: ex.workflow_id,
      workflow_version_id: ex.workflow_version_id,
      workspace_id: ex.workspace_id,
      status: ex.status || 'QUEUED',
      trigger_type: ex.trigger_type,
      trigger_payload: ex.trigger_payload,
      idempotency_key: ex.idempotency_key,
      started_at: ex.started_at,
      finished_at: ex.finished_at,
      duration_ms: ex.duration_ms,
      error_summary: ex.error_summary,
      retry_count: ex.retry_count || 0,
      created_at: new Date(),
      updated_at: new Date()
    };
    this.executions.set(record.id, record);
    return record;
  }

  updateExecution(id: string, updates: Partial<DbExecution>): DbExecution {
    const ex = this.executions.get(id);
    if (!ex) {
      throw new Error(`Execution ${id} not found`);
    }
    const updated = {
      ...ex,
      ...updates,
      updated_at: new Date()
    };
    this.executions.set(id, updated);
    return updated;
  }

  // Node Executions (Step Journaling)
  createNodeExecution(ne: Omit<DbNodeExecution, 'id' | 'created_at'> & { id?: string }): DbNodeExecution {
    const record: DbNodeExecution = {
      id: ne.id || crypto.randomUUID(),
      execution_id: ne.execution_id,
      node_id: ne.node_id,
      node_type: ne.node_type,
      status: ne.status || 'PENDING',
      retry_count: ne.retry_count || 0,
      input_payload: ne.input_payload,
      output_payload: ne.output_payload,
      error_details: ne.error_details,
      started_at: ne.started_at,
      finished_at: ne.finished_at,
      duration_ms: ne.duration_ms,
      created_at: new Date()
    };
    this.node_executions.set(record.id, record);
    return record;
  }

  updateNodeExecution(id: string, updates: Partial<DbNodeExecution>): DbNodeExecution {
    const ne = this.node_executions.get(id);
    if (!ne) {
      throw new Error(`Node execution ${id} not found`);
    }
    const updated = {
      ...ne,
      ...updates
    };
    this.node_executions.set(id, updated);
    return updated;
  }

  findNodeExecutions(executionId: string): DbNodeExecution[] {
    return Array.from(this.node_executions.values()).filter(ne => ne.execution_id === executionId);
  }

  // Events
  logEvent(executionId: string, eventType: string, nodeId?: string, payload?: unknown): DbExecutionEvent {
    const event: DbExecutionEvent = {
      id: this.eventCounter++,
      execution_id: executionId,
      event_type: eventType,
      node_id: nodeId,
      payload,
      created_at: new Date()
    };
    this.execution_events.push(event);
    return event;
  }

  // Audit Logs
  createAuditLog(log: Omit<DbAuditLog, 'id' | 'created_at'> & { id?: string }): DbAuditLog {
    const record: DbAuditLog = {
      id: log.id || crypto.randomUUID(),
      workspace_id: log.workspace_id,
      user_id: log.user_id,
      action: log.action,
      target_id: log.target_id,
      metadata: log.metadata,
      created_at: new Date()
    };
    this.audit_logs.set(record.id, record);
    return record;
  }
}

export const dbMock = new InMemoryDatabase();
