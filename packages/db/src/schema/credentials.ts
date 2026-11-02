import { pgTable, uuid, varchar, text, integer, timestamp, index } from 'drizzle-orm/pg-core';
import { workspaces } from './workspaces.js';
import { users } from './users.js';

export const credentials = pgTable(
  'credentials',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 255 }).notNull(),
    type: varchar('type', { length: 100 }).notNull(), // 'telegram', 'smtp', 'postgres', 'openai', 'http_basic', etc.
    keyVersion: integer('key_version').notNull().default(1),
    iv: varchar('iv', { length: 64 }).notNull(), // Base64 or Hex IV
    authTag: varchar('auth_tag', { length: 64 }).notNull(), // Base64 or Hex Auth Tag
    ciphertext: text('ciphertext').notNull(), // Base64 or Hex Ciphertext
    maskedHint: varchar('masked_hint', { length: 255 }), // e.g. '••••••••1234'
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_credentials_workspace_type').on(table.workspaceId, table.type),
    index('idx_credentials_workspace_name').on(table.workspaceId, table.name),
  ]
);
