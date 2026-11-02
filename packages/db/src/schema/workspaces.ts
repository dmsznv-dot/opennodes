import { pgTable, uuid, varchar, timestamp, integer, jsonb, index, unique } from 'drizzle-orm/pg-core';
import { userRoleEnum } from './enums.js';
import { users } from './users.js';

export const workspaces = pgTable(
  'workspaces',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: varchar('name', { length: 255 }).notNull(),
    slug: varchar('slug', { length: 255 }).notNull().unique(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('idx_workspaces_slug').on(table.slug)]
);

export const memberships = pgTable(
  'memberships',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    role: userRoleEnum('role').notNull().default('VIEWER'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('uq_memberships_user_workspace').on(table.userId, table.workspaceId),
    index('idx_memberships_user_id').on(table.userId),
    index('idx_memberships_workspace_id').on(table.workspaceId),
  ]
);

export const workspaceSettings = pgTable(
  'workspace_settings',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .unique()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    executionTimeoutMs: integer('execution_timeout_ms').notNull().default(300000),
    maxConcurrency: integer('max_concurrency').notNull().default(10),
    retentionDays: integer('retention_days').notNull().default(30),
    ssrfAllowlist: jsonb('ssrf_allowlist').$type<string[]>().notNull().default([]),
    settingsJson: jsonb('settings_json').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('idx_workspace_settings_workspace_id').on(table.workspaceId)]
);

export const apiKeys = pgTable(
  'api_keys',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 255 }).notNull(),
    keyPrefix: varchar('key_prefix', { length: 16 }).notNull(),
    keyHash: varchar('key_hash', { length: 255 }).notNull().unique(),
    role: userRoleEnum('role').notNull().default('EDITOR'),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_api_keys_key_hash').on(table.keyHash),
    index('idx_api_keys_workspace_id').on(table.workspaceId),
  ]
);
