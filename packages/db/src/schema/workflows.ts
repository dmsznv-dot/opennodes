import { pgTable, uuid, varchar, text, boolean, integer, timestamp, jsonb, index, unique } from 'drizzle-orm/pg-core';
import { workspaces } from './workspaces.js';
import { users } from './users.js';

export const workflows = pgTable(
  'workflows',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 255 }).notNull(),
    description: text('description'),
    isActive: boolean('is_active').notNull().default(false),
    isArchived: boolean('is_archived').notNull().default(false),
    activeVersionId: uuid('active_version_id'), // References workflow_versions.id
    draftNodes: jsonb('draft_nodes').$type<unknown[]>().notNull().default([]),
    draftEdges: jsonb('draft_edges').$type<unknown[]>().notNull().default([]),
    draftTriggerConfig: jsonb('draft_trigger_config')
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    draftExecutionPolicy: jsonb('draft_execution_policy')
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_workflows_workspace_id').on(table.workspaceId),
    index('idx_workflows_created_by').on(table.createdBy),
  ]
);

export const workflowVersions = pgTable(
  'workflow_versions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workflowId: uuid('workflow_id')
      .notNull()
      .references(() => workflows.id, { onDelete: 'cascade' }),
    versionNumber: integer('version_number').notNull(),
    isDraft: boolean('is_draft').notNull().default(false),
    schemaVersion: varchar('schema_version', { length: 16 }).notNull().default('1.0'),
    nodes: jsonb('nodes').$type<unknown[]>().notNull(),
    edges: jsonb('edges').$type<unknown[]>().notNull(),
    triggerConfig: jsonb('trigger_config').$type<Record<string, unknown>>().notNull(),
    executionPolicy: jsonb('execution_policy')
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    credentialReferences: jsonb('credential_references')
      .$type<string[]>()
      .notNull()
      .default([]),
    checksum: varchar('checksum', { length: 64 }).notNull(), // SHA-256 of canonical snapshot JSON
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('uq_workflow_versions_number').on(table.workflowId, table.versionNumber),
    index('idx_workflow_versions_lookup').on(table.workflowId, table.isDraft),
    index('idx_workflow_versions_checksum').on(table.checksum),
  ]
);
