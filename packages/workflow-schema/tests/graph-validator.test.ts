import { describe, it, expect } from 'vitest';
import { validateWorkflowGraph } from '../src/validation/graph-validator.js';
import { WorkflowNode, WorkflowEdge } from '../src/types.js';

describe('Workflow Graph Validator', () => {
  const triggerNode: WorkflowNode = {
    id: 'trigger_1',
    type: 'trigger.manual',
    data: { label: 'Manual Trigger', config: {} },
    inputs: [],
    outputs: [{ id: 'main', name: 'Main', type: 'trigger', direction: 'output', required: true }],
  };

  const actionNode: WorkflowNode = {
    id: 'http_1',
    type: 'core.httpRequest',
    data: { label: 'HTTP Request', config: { url: 'https://api.example.com' } },
    inputs: [{ id: 'main', name: 'Main', type: 'any', direction: 'input', required: true }],
    outputs: [{ id: 'main', name: 'Main', type: 'json', direction: 'output', required: true }],
  };

  const edge: WorkflowEdge = {
    id: 'edge_1',
    source: 'trigger_1',
    sourceHandle: 'main',
    target: 'http_1',
    targetHandle: 'main',
  };

  it('should pass validation for a valid single-trigger DAG', () => {
    const result = validateWorkflowGraph([triggerNode, actionNode], [edge]);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.topologicalOrder).toEqual(['trigger_1', 'http_1']);
  });

  it('should fail if missing trigger node', () => {
    const result = validateWorkflowGraph([actionNode], []);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === 'ERR_MISSING_TRIGGER')).toBe(true);
  });

  it('should fail if multiple trigger nodes are present', () => {
    const secondTrigger: WorkflowNode = {
      ...triggerNode,
      id: 'trigger_2',
      type: 'trigger.cron',
    };
    const result = validateWorkflowGraph([triggerNode, secondTrigger, actionNode], [edge]);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === 'ERR_MULTIPLE_TRIGGERS')).toBe(true);
  });

  it('should fail if edge references dangling node', () => {
    const badEdge: WorkflowEdge = {
      ...edge,
      target: 'non_existent_node',
    };
    const result = validateWorkflowGraph([triggerNode, actionNode], [badEdge]);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === 'ERR_TARGET_NODE_NOT_FOUND')).toBe(true);
  });

  it('should fail if edge references non-existent handle', () => {
    const badEdge: WorkflowEdge = {
      ...edge,
      targetHandle: 'ghost_handle',
    };
    const result = validateWorkflowGraph([triggerNode, actionNode], [badEdge]);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === 'ERR_TARGET_HANDLE_NOT_FOUND')).toBe(true);
  });

  it('should handle malformed nodes missing type property gracefully without throwing TypeError', () => {
    const malformedNode = { id: 'n1' } as unknown as WorkflowNode;
    expect(() => {
      const result = validateWorkflowGraph([malformedNode], [], { requireSingleTrigger: false });
      expect(result.valid).toBe(true);
    }).not.toThrow();

    expect(() => {
      const resultWithTrigger = validateWorkflowGraph([malformedNode], [], { requireSingleTrigger: true });
      expect(resultWithTrigger.valid).toBe(false);
      expect(resultWithTrigger.errors.some((e) => e.code === 'ERR_MISSING_TRIGGER')).toBe(true);
    }).not.toThrow();
  });

  it('should report duplicate node ID without phantom cycle error', () => {
    const dup1: WorkflowNode = { ...triggerNode, id: 'dup_node' };
    const dup2: WorkflowNode = { ...triggerNode, id: 'dup_node' };

    const result = validateWorkflowGraph([dup1, dup2], [], { requireSingleTrigger: false });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === 'ERR_DUPLICATE_NODE_ID')).toBe(true);
    expect(result.errors.some((e) => e.code === 'ERR_CYCLIC_DEPENDENCY_DETECTED')).toBe(false);
  });
});
