import { describe, it, expect } from 'vitest';
import { migrateWorkflowToV11, computeWorkflowChecksum } from '../src/index.js';
import type { WorkflowDefinition } from '../src/types.js';

describe('opt-in graph migration', () => {
  it('classifies legacy dependencies without modifying the source snapshot', () => {
    const graph: WorkflowDefinition = {
      id: 'wf', workspaceId: 'ws', name: 'Legacy', schemaVersion: '1.0',
      executionPolicy: { executionTimeoutMs: 300000, maxConcurrency: 1 },
      nodes: [
        { id: 'voice', type: 'context.voice', data: { label: 'Voice', config: { presetVersion: 2 } }, inputs: [], outputs: [] },
        { id: 'ai', type: 'ai.process', data: { label: 'Write', config: {} }, inputs: [], outputs: [] },
      ],
      edges: [{ id: 'e', source: 'voice', sourceHandle: 'main', target: 'ai', targetHandle: 'main' }],
    };
    const checksum = computeWorkflowChecksum(graph);
    const migrated = migrateWorkflowToV11(graph);
    expect(migrated.schemaVersion).toBe('1.1');
    expect(migrated.edges[0]?.kind).toBe('context');
    expect(migrated.nodes[0]?.data.config.presetVersion).toBe(2);
    expect(computeWorkflowChecksum(graph)).toBe(checksum);
    expect(graph.edges[0]?.kind).toBeUndefined();
    expect(migrateWorkflowToV11(migrated)).toEqual(migrated);
  });
});
