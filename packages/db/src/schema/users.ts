import { pgTable, uuid, varchar, boolean, timestamp, text, index } from 'drizzle-orm/pg-core';
import { userRoleEnum } from './enums.js';
import { workspaces } from './workspaces.js';

export const users = pgTable(
  'users',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    email: varchar('email', { length: 255 }).notNull().unique(),
    passwordHash: varchar('password_hash', { length: 255 }).notNull(),
    fullName: varchar('full_name', { length: 255 }),
    isActive: boolean('is_active').notNull().default(true),
    isOwner: boolean('is_owner').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_users_email').on(table.email),
    index('idx_users_is_owner').on(table.isOwner),
  ]
);

export const sessions = pgTable(
  'sessions',
  {
    id: varchar('id', { length: 128 }).primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    ipAddress: varchar('ip_address', { length: 64 }),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_sessions_user_id').on(table.userId),
    index('idx_sessions_expires_at').on(table.expiresAt),
  ]
);

export const invitations = pgTable(
  'invitations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    email: varchar('email', { length: 255 }).notNull(),
    role: userRoleEnum('role').notNull().default('VIEWER'),
    token: varchar('token', { length: 255 }).notNull().unique(),
    invitedBy: uuid('invited_by').references(() => users.id, { onDelete: 'set null' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_invitations_token').on(table.token),
    index('idx_invitations_workspace_email').on(table.workspaceId, table.email),
  ]
);
