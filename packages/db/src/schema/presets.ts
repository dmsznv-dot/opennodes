import { pgTable, uuid, integer, jsonb, timestamp } from 'drizzle-orm/pg-core';
import { workspaces } from './workspaces.js';

/** Browser-compatible IDs deliberately remain strings (including legacy vp_ IDs). */
export interface PresetVersion {
  version: number;
  config: Record<string, string>;
  savedAt: number;
}

export interface Preset {
  id: string;
  name: string;
  versions: PresetVersion[];
}

/** One atomic compare-and-swap unit per workspace, with append-only version histories. */
export const workspacePresetLibraries = pgTable('workspace_preset_libraries', {
  workspaceId: uuid('workspace_id')
    .primaryKey()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  revision: integer('revision').notNull().default(0),
  voicePresets: jsonb('voice_presets').$type<Preset[]>().notNull().default([]),
  promptPresets: jsonb('prompt_presets').$type<Preset[]>().notNull().default([]),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
