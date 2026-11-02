import { describe, it, expect } from 'vitest';
import { createInMemoryDb } from '../src/client.js';
import { getInitialMigrationSql, runMigrations } from '../src/migrator.js';

describe('packages/db: Migrations Runner', () => {
  it('generates non-empty initial migration SQL containing all 18 tables', () => {
    const sql = getInitialMigrationSql();
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS users');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS sessions');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS workspaces');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS memberships');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS workspace_settings');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS api_keys');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS invitations');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS credentials');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS workflows');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS workflow_versions');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS executions');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS node_executions');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS execution_logs');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS execution_events');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS triggers');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS trigger_logs');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS webhook_subscriptions');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS audit_logs');
  });

  it('runs migrations idempotently against a PGlite instance', async () => {
    const db = await createInMemoryDb();
    // Run migrations again to verify idempotency
    await expect(runMigrations(db)).resolves.not.toThrow();
  });
});
