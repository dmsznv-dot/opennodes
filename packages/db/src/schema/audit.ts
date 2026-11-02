import { pgTable, uuid, varchar, timestamp, jsonb, index } from 'drizzle-orm/pg-core';
import { workspaces } from './workspaces.js';
import { users } from './users.js';

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    action: varchar('action', { length: 100 }).notNull(), // 'workflow.publish', 'credential.create', 'workspace.invite'
    resourceType: varchar('resource_type', { length: 100 }).notNull(), // 'workflow', 'credential', 'workspace'
    resourceId: varchar('resource_id', { length: 255 }).notNull(),
    details: jsonb('details').$type<Record<string, unknown>>(),
    ipAddress: varchar('ip_address', { length: 64 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_audit_logs_workspace_created').on(table.workspaceId, table.createdAt),
    index('idx_audit_logs_user').on(table.userId),
    index('idx_audit_logs_resource').on(table.resourceType, table.resourceId),
  ]
);
