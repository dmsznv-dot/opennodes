import {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  timestamp,
  jsonb,
  index,
  bigint,
  primaryKey,
} from 'drizzle-orm/pg-core';
import { webhookAuthTypeEnum } from './enums.js';
import { workspaces } from './workspaces.js';
import { workflows } from './workflows.js';
import { executions } from './executions.js';
import { credentials } from './credentials.js';

export const triggers = pgTable(
  'triggers',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    workflowId: uuid('workflow_id')
      .notNull()
      .references(() => workflows.id, { onDelete: 'cascade' }),
    type: varchar('type', { length: 50 }).notNull(), // 'manual', 'cron', 'webhook', 'telegram'
    name: varchar('name', { length: 255 }).notNull(),
    isEnabled: boolean('is_enabled').notNull().default(true),
    config: jsonb('config').$type<Record<string, unknown>>().notNull().default({}),
    lastTriggeredAt: timestamp('last_triggered_at', { withTimezone: true }),
    nextTriggerAt: timestamp('next_trigger_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_triggers_workspace').on(table.workspaceId),
    index('idx_triggers_workflow').on(table.workflowId),
    index('idx_triggers_type_enabled').on(table.type, table.isEnabled),
  ]
);

export const triggerLogs = pgTable(
  'trigger_logs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    triggerId: uuid('trigger_id')
      .notNull()
      .references(() => triggers.id, { onDelete: 'cascade' }),
    executionId: uuid('execution_id').references(() => executions.id, {
      onDelete: 'set null',
    }),
    status: varchar('status', { length: 32 }).notNull().default('success'), // 'success', 'failed', 'ignored'
    payload: jsonb('payload').$type<Record<string, unknown>>(),
    errorMessage: text('error_message'),
    triggeredAt: timestamp('triggered_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_trigger_logs_trigger').on(table.triggerId, table.triggeredAt),
    index('idx_trigger_logs_execution').on(table.executionId),
  ]
);

export const webhookSubscriptions = pgTable(
  'webhook_subscriptions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    workflowId: uuid('workflow_id')
      .notNull()
      .references(() => workflows.id, { onDelete: 'cascade' }),
    endpointToken: varchar('endpoint_token', { length: 64 }).notNull().unique(),
    httpMethod: varchar('http_method', { length: 16 }).notNull().default('POST'),
    secretHash: varchar('secret_hash', { length: 255 }),
    authType: webhookAuthTypeEnum('auth_type').notNull().default('NONE'),
    isActive: boolean('is_active').notNull().default(true),
    idempotencyHeader: varchar('idempotency_header', { length: 64 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_webhook_subs_token').on(table.endpointToken),
    index('idx_webhook_subs_workspace').on(table.workspaceId),
    index('idx_webhook_subs_workflow').on(table.workflowId),
  ]
);

/** Telegram trigger polling: the getUpdates cursor and the polling lease of one bot. */
export const telegramBotCursors = pgTable('telegram_bot_cursors', {
  credentialId: uuid('credential_id')
    .primaryKey()
    .references(() => credentials.id, { onDelete: 'cascade' }),
  updateOffset: bigint('update_offset', { mode: 'number' }).notNull().default(0),
  leaseHolder: varchar('lease_holder', { length: 100 }),
  leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
  lastPolledAt: timestamp('last_polled_at', { withTimezone: true }),
  lastError: text('last_error'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** RSS "only new items": what a step already handed on (pending until its run succeeds). */
export const rssSeenItems = pgTable(
  'rss_seen_items',
  {
    workflowId: uuid('workflow_id')
      .notNull()
      .references(() => workflows.id, { onDelete: 'cascade' }),
    nodeId: varchar('node_id', { length: 100 }).notNull(),
    itemKey: varchar('item_key', { length: 64 }).notNull(),
    executionId: uuid('execution_id'),
    committed: boolean('committed').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.workflowId, table.nodeId, table.itemKey] }),
    index('idx_rss_seen_execution').on(table.executionId),
  ]
);
