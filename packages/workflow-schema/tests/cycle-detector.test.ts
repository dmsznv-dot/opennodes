import { describe, it, expect } from 'vitest';
import { detectCycles } from '../src/validation/cycle-detector.js';

describe('Kahn Cycle Detector', () => {
  it('should accept a linear DAG and return topological order', () => {
    const nodes = [{ id: 'A' }, { id: 'B' }, { id: 'C' }];
    const edges = [
      { source: 'A', target: 'B' },
      { source: 'B', target: 'C' },
    ];

    const result = detectCycles(nodes, edges);
    expect(result.hasCycle).toBe(false);
    expect(result.topologicalOrder).toEqual(['A', 'B', 'C']);
    expect(result.cycleNodes).toHaveLength(0);
  });

  it('should accept a diamond DAG (branch and merge)', () => {
    const nodes = [{ id: 'A' }, { id: 'B' }, { id: 'C' }, { id: 'D' }];
    const edges = [
      { source: 'A', target: 'B' },
      { source: 'A', target: 'C' },
      { source: 'B', target: 'D' },
      { source: 'C', target: 'D' },
    ];

    const result = detectCycles(nodes, edges);
    expect(result.hasCycle).toBe(false);
    expect(result.topologicalOrder[0]).toBe('A');
    expect(result.topologicalOrder[3]).toBe('D');
  });

  it('should detect a simple 2-node cycle (A -> B -> A)', () => {
    const nodes = [{ id: 'A' }, { id: 'B' }];
    const edges = [
      { source: 'A', target: 'B' },
      { source: 'B', target: 'A' },
    ];

    const result = detectCycles(nodes, edges);
    expect(result.hasCycle).toBe(true);
    expect(result.topologicalOrder).toHaveLength(0);
    expect(result.cycleNodes).toEqual(expect.arrayContaining(['A', 'B']));
    expect(result.cyclePath.length).toBeGreaterThanOrEqual(2);
  });

  it('should detect a 5-node cycle in a larger graph', () => {
    const nodes = [
      { id: 'T' },
      { id: 'N1' },
      { id: 'N2' },
      { id: 'N3' },
      { id: 'N4' },
      { id: 'N5' },
    ];
    const edges = [
      { source: 'T', target: 'N1' },
      { source: 'N1', target: 'N2' },
      { source: 'N2', target: 'N3' },
      { source: 'N3', target: 'N4' },
      { source: 'N4', target: 'N5' },
      { source: 'N5', target: 'N2' }, // Cycle: N2 -> N3 -> N4 -> N5 -> N2
    ];

    const result = detectCycles(nodes, edges);
    expect(result.hasCycle).toBe(true);
    expect(result.cycleNodes).toEqual(expect.arrayContaining(['N2', 'N3', 'N4', 'N5']));
    expect(result.cycleNodes).not.toContain('T');
  });

  it('should detect a self-referencing loop (A -> A)', () => {
    const nodes = [{ id: 'A' }];
    const edges = [{ source: 'A', target: 'A' }];

    const result = detectCycles(nodes, edges);
    expect(result.hasCycle).toBe(true);
    expect(result.cycleNodes).toEqual(['A']);
  });

  it('should not report phantom cycle when duplicate node IDs exist without edges', () => {
    const nodes = [{ id: 'A' }, { id: 'A' }];
    const edges: { source: string; target: string }[] = [];

    const result = detectCycles(nodes, edges);
    expect(result.hasCycle).toBe(false);
    expect(result.topologicalOrder).toEqual(['A']);
    expect(result.cycleNodes).toHaveLength(0);
  });

  it('should detect genuine cycle even when duplicate node IDs exist in graph', () => {
    const nodes = [{ id: 'A' }, { id: 'A' }, { id: 'B' }];
    const edges = [
      { source: 'A', target: 'B' },
      { source: 'B', target: 'A' },
    ];

    const result = detectCycles(nodes, edges);
    expect(result.hasCycle).toBe(true);
    expect(result.cycleNodes).toEqual(expect.arrayContaining(['A', 'B']));
  });
});
