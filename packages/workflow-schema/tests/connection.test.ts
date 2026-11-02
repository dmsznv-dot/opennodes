import { describe, it, expect } from 'vitest';
import { wouldCreateCycle } from '../src/validation/connection.js';

describe('Real-time Connection Validator (wouldCreateCycle)', () => {
  it('should reject immediate self-loop connection', () => {
    expect(wouldCreateCycle([], { source: 'node1', target: 'node1' })).toBe(true);
  });

  it('should allow valid forward edge', () => {
    const edges = [
      { source: 'node1', target: 'node2' },
      { source: 'node2', target: 'node3' },
    ];
    expect(wouldCreateCycle(edges, { source: 'node3', target: 'node4' })).toBe(false);
  });

  it('should reject back-edge creating direct 2-node cycle', () => {
    const edges = [{ source: 'node1', target: 'node2' }];
    expect(wouldCreateCycle(edges, { source: 'node2', target: 'node1' })).toBe(true);
  });

  it('should reject back-edge creating indirect multi-step cycle', () => {
    const edges = [
      { source: 'A', target: 'B' },
      { source: 'B', target: 'C' },
      { source: 'C', target: 'D' },
    ];
    expect(wouldCreateCycle(edges, { source: 'D', target: 'A' })).toBe(true);
    expect(wouldCreateCycle(edges, { source: 'D', target: 'B' })).toBe(true);
  });
});
