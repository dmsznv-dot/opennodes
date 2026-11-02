import { describe, it, expect } from 'vitest';
import { computeWorkflowChecksum } from '../src/utils/checksum.js';

describe('Workflow Checksum', () => {
  it('should generate identical checksum regardless of object key order', () => {
    const objA = {
      b: 2,
      a: 1,
      nested: { z: 10, y: 20 },
    };
    const objB = {
      a: 1,
      nested: { y: 20, z: 10 },
      b: 2,
    };

    const hashA = computeWorkflowChecksum(objA);
    const hashB = computeWorkflowChecksum(objB);

    expect(hashA).toBe(hashB);
    expect(hashA).toHaveLength(64);
  });

  it('should produce different checksums when content changes', () => {
    const objA = { name: 'Workflow A', version: 1 };
    const objB = { name: 'Workflow B', version: 1 };

    expect(computeWorkflowChecksum(objA)).not.toBe(computeWorkflowChecksum(objB));
  });

  it('should generate identical checksum regardless of node ordering in nodes array', () => {
    const nodeA = { id: 'node_1', type: 'core.http', data: { label: 'A' } };
    const nodeB = { id: 'node_2', type: 'core.log', data: { label: 'B' } };

    const hash1 = computeWorkflowChecksum({ nodes: [nodeA, nodeB], edges: [] });
    const hash2 = computeWorkflowChecksum({ nodes: [nodeB, nodeA], edges: [] });

    expect(hash1).toBe(hash2);
  });

  it('should generate identical checksum regardless of edge ordering in edges array', () => {
    const edgeA = { id: 'edge_1', source: 'node_1', target: 'node_2' };
    const edgeB = { id: 'edge_2', source: 'node_2', target: 'node_3' };

    const hash1 = computeWorkflowChecksum({ nodes: [], edges: [edgeA, edgeB] });
    const hash2 = computeWorkflowChecksum({ nodes: [], edges: [edgeB, edgeA] });

    expect(hash1).toBe(hash2);
  });

  it('should maintain permutation invariance across combined permuted nodes, edges, and object keys', () => {
    const nodeA = { id: 'n1', data: { z: 1, a: 2 }, type: 'core.http' };
    const nodeB = { type: 'core.log', id: 'n2', data: { a: 2, z: 1 } };
    const edgeA = { id: 'e1', target: 'n2', source: 'n1' };
    const edgeB = { source: 'n2', id: 'e2', target: 'n3' };

    const hash1 = computeWorkflowChecksum({ nodes: [nodeA, nodeB], edges: [edgeA, edgeB] });
    const hash2 = computeWorkflowChecksum({ edges: [edgeB, edgeA], nodes: [nodeB, nodeA] });

    expect(hash1).toBe(hash2);
  });
});
