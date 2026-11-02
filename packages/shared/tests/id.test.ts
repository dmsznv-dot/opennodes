import { describe, it, expect } from 'vitest';
import { generateUuid, generatePrefixedId } from '../src/id.js';

describe('ID generators', () => {
  it('generates valid RFC 4122 v4 UUIDs', () => {
    const id1 = generateUuid();
    const id2 = generateUuid();
    expect(id1).not.toBe(id2);
    expect(id1).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });

  it('generates prefixed instance IDs', () => {
    const nodeId = generatePrefixedId('node');
    expect(nodeId.startsWith('node_')).toBe(true);
    expect(nodeId.length).toBeGreaterThan(12);
  });
});
