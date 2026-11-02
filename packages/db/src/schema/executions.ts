import { pgTable, uuid, varchar, text, integer, timestamp, jsonb, index } from 'drizzle-orm/pg-core';
import { executionStatusEnum, nodeStatusEnum } from './enums.js';
import { workspaces } from './workspaces.js';
import { workflows, workflowVersions } from './workflows.js';

export const executions = pgTable(
  'executions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    workflowId: uuid('workflow_id')
      .notNull()
      .references(() => workflows.id, { onDelete: 'cascade' }),
    workflowVersionId: uuid('workflow_version_id')
      .notNull()
      .references(() => workflowVersions.id, { onDelete: 'restrict' }),
    status: executionStatusEnum('status').notNull().default('QUEUED'),
    triggerType: varchar('trigger_type', { length: 50 }).notNull(), // 'manual', 'cron', 'webhook', 'telegram'
    triggerPayload: jsonb('trigger_payload').$type<Record<string, unknown>>(),
    idempotencyKey: varchar('idempotency_key', { length: 255 }),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    durationMs: integer('duration_ms'),
    errorMessage: text('error_message'),
    errorNodeId: varchar('error_node_id', { length: 100 }),
    retryCount: integer('retry_count').notNull().default(0),
    priority: integer('priority').notNull().default(0),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_executions_workspace_status').on(table.workspaceId, table.status),
    index('idx_executions_workflow_started').on(table.workflowId, table.startedAt),
    index('idx_executions_idempotency').on(table.workspaceId, table.idempotencyKey),
  ]
);

export const nodeExecutions = pgTable(
  'node_executions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    executionId: uuid('execution_id')
      .notNull()
      .references(() => executions.id, { onDelete: 'cascade' }),
    nodeId: varchar('node_id', { length: 100 }).notNull(), // e.g. 'http_1'
    nodeType: varchar('node_type', { length: 100 }).notNull(), // e.g. 'core.httpRequest'
    nodeName: varchar('node_name', { length: 255 }),
    status: nodeStatusEnum('status').notNull().default('PENDING'),
    retryCount: integer('retry_count').notNull().default(0),
    inputPayload: jsonb('input_payload').$type<unknown>(), // Redacted of secrets
    outputPayload: jsonb('output_payload').$type<unknown>(), // Redacted of secrets
    errorDetails: jsonb('error_details').$type<Record<string, unknown>>(),
    errorMessage: text('error_message'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    durationMs: integer('duration_ms'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_node_executions_execution').on(table.executionId),
    index('idx_node_executions_node').on(table.executionId, table.nodeId),
    index('idx_node_executions_status').on(table.executionId, table.status),
  ]
);

export const executionLogs = pgTable(
  'execution_logs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    executionId: uuid('execution_id')
      .notNull()
      .references(() => executions.id, { onDelete: 'cascade' }),
    nodeExecutionId: uuid('node_execution_id').references(() => nodeExecutions.id, {
      onDelete: 'cascade',
    }),
    nodeId: varchar('node_id', { length: 100 }),
    level: varchar('level', { length: 20 }).notNull().default('info'), // 'trace', 'debug', 'info', 'warn', 'error'
    message: text('message').notNull(),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    timestamp: timestamp('timestamp', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_execution_logs_execution').on(table.executionId, table.timestamp),
    index('idx_execution_logs_node_execution').on(table.nodeExecutionId),
  ]
);

export const executionEvents = pgTable(
  'execution_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    executionId: uuid('execution_id')
      .notNull()
      .references(() => executions.id, { onDelete: 'cascade' }),
    eventType: varchar('event_type', { length: 64 }).notNull(), // 'execution:started', 'node:started', etc.
    nodeId: varchar('node_id', { length: 100 }),
    payload: jsonb('payload').$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_execution_events_execution').on(table.executionId, table.createdAt),
  ]
);
