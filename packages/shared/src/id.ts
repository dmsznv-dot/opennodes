import { randomUUID } from 'node:crypto';

/**
 * Generate a standard RFC 4122 v4 UUID
 */
export function generateUuid(): string {
  return randomUUID();
}

/**
 * Generate a prefixed instance ID (e.g. "node_a1b2c3d4", "exec_9f8e7d6c")
 */
export function generatePrefixedId(prefix: string): string {
  const shortId = randomUUID().replace(/-/g, '').substring(0, 12);
  return `${prefix}_${shortId}`;
}
