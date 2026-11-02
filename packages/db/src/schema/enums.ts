import { pgEnum } from 'drizzle-orm/pg-core';

export const userRoleEnum = pgEnum('user_role', [
  'OWNER',
  'ADMIN',
  'EDITOR',
  'VIEWER',
]);

export const executionStatusEnum = pgEnum('execution_status', [
  'QUEUED',
  'RUNNING',
  'WAITING',
  'SUCCEEDED',
  'FAILED',
  'CANCELLED',
]);

export const nodeStatusEnum = pgEnum('node_status', [
  'PENDING',
  'RUNNING',
  'SUCCEEDED',
  'FAILED',
  'SKIPPED',
  'CANCELLED',
]);

export const triggerTypeEnum = pgEnum('trigger_type', [
  'manual',
  'cron',
  'webhook',
  'telegram',
]);

export const webhookAuthTypeEnum = pgEnum('webhook_auth_type', [
  'NONE',
  'HEADER_TOKEN',
  'HMAC_SIGNATURE',
]);
