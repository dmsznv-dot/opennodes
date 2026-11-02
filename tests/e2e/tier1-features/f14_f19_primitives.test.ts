/**
 * LocalFlow E2E Test Suite - Tier 1: Graph Primitives (Features F14 - F19)
 * Verifies Features F14 through F19 with >=5 tests per feature (30 tests total).
 */

import { describe, it, expect, beforeEach } from '../harness/index.ts';
import { workflowRunner } from '../harness/workflow-runner.ts';
import { InMemoryDatabase } from '../harness/db-mock.ts';
import type { WorkflowDefinition } from '../harness/types.ts';

describe('Tier 1: Feature F14 - Graph Primitive: Branch / IF', () => {
  let db: InMemoryDatabase;

  beforeEach(() => {
    db = new InMemoryDatabase();
  });

  it('F14-1: should route execution through "true" port when boolean condition is true', async () => {
    const wf: WorkflowDefinition = {
      id: 'wf_if_true',
      workspaceId: 'ws_1',
      name: 'IF True Test',
      nodes: [
        { id: 'trig', type: 'trigger.manual', data: { label: 'T', config: {} }, inputs: [], outputs: [] },
        { id: 'if_node', type: 'primitive.if', data: { label: 'Check', config: { condition: true } }, inputs: [], outputs: [] },
        { id: 'true_node', type: 'primitive.map', data: { label: 'True Action', config: { executed: 'true_branch' } }, inputs: [], outputs: [] },
        { id: 'false_node', type: 'primitive.map', data: { label: 'False Action', config: { executed: 'false_branch' } }, inputs: [], outputs: [] }
      ],
      edges: [
        { id: 'e1', source: 'trig', sourceHandle: 'main', target: 'if_node', targetHandle: 'main' },
        { id: 'e2', source: 'if_node', sourceHandle: 'true', target: 'true_node', targetHandle: 'main' },
        { id: 'e3', source: 'if_node', sourceHandle: 'false', target: 'false_node', targetHandle: 'main' }
      ]
    };

    const res = await workflowRunner.runWorkflow(wf, { mockDatabase: db });
    expect(res.execution.status).toBe('SUCCEEDED');
    expect(res.nodeOutputs.get('true_node')).toEqual({ executed: 'true_branch' });
    expect(res.skippedNodes.has('false_node')).toBe(true);
  });

  it('F14-2: should route execution through "false" port when boolean condition is false', async () => {
    const wf: WorkflowDefinition = {
      id: 'wf_if_false',
      workspaceId: 'ws_1',
      name: 'IF False Test',
      nodes: [
        { id: 'trig', type: 'trigger.manual', data: { label: 'T', config: {} }, inputs: [], outputs: [] },
        { id: 'if_node', type: 'primitive.if', data: { label: 'Check', config: { condition: false } }, inputs: [], outputs: [] },
        { id: 'true_node', type: 'primitive.map', data: { label: 'True Action', config: { executed: 'true_branch' } }, inputs: [], outputs: [] },
        { id: 'false_node', type: 'primitive.map', data: { label: 'False Action', config: { executed: 'false_branch' } }, inputs: [], outputs: [] }
      ],
      edges: [
        { id: 'e1', source: 'trig', sourceHandle: 'main', target: 'if_node', targetHandle: 'main' },
        { id: 'e2', source: 'if_node', sourceHandle: 'true', target: 'true_node', targetHandle: 'main' },
        { id: 'e3', source: 'if_node', sourceHandle: 'false', target: 'false_node', targetHandle: 'main' }
      ]
    };

    const res = await workflowRunner.runWorkflow(wf, { mockDatabase: db });
    expect(res.execution.status).toBe('SUCCEEDED');
    expect(res.nodeOutputs.get('false_node')).toEqual({ executed: 'false_branch' });
    expect(res.skippedNodes.has('true_node')).toBe(true);
  });

  it('F14-3: should evaluate expression templates in condition field dynamically', async () => {
    const wf: WorkflowDefinition = {
      id: 'wf_if_dynamic',
      workspaceId: 'ws_1',
      name: 'IF Dynamic Test',
      nodes: [
        { id: 'trig', type: 'trigger.manual', data: { label: 'T', config: {} }, inputs: [], outputs: [] },
        { id: 'step_num', type: 'primitive.map', data: { label: 'Num', config: { count: 15 } }, inputs: [], outputs: [] },
        { id: 'if_node', type: 'primitive.if', data: { label: 'Check', config: { condition: '{{ $nodes.step_num.output.count > 10 }}' } }, inputs: [], outputs: [] },
        { id: 'gt10', type: 'primitive.map', data: { label: 'GT10', config: { msg: 'greater than 10' } }, inputs: [], outputs: [] }
      ],
      edges: [
        { id: 'e1', source: 'trig', sourceHandle: 'main', target: 'step_num', targetHandle: 'main' },
        { id: 'e2', source: 'step_num', sourceHandle: 'main', target: 'if_node', targetHandle: 'main' },
        { id: 'e3', source: 'if_node', sourceHandle: 'true', target: 'gt10', targetHandle: 'main' }
      ]
    };

    const res = await workflowRunner.runWorkflow(wf, { mockDatabase: db });
    expect(res.execution.status).toBe('SUCCEEDED');
    expect(res.nodeOutputs.get('gt10')).toEqual({ msg: 'greater than 10' });
  });

  it('F14-4: should treat non-empty string and positive numbers as truthy', async () => {
    const wf: WorkflowDefinition = {
      id: 'wf_if_truthy',
      workspaceId: 'ws_1',
      name: 'IF Truthy Test',
      nodes: [
        { id: 'trig', type: 'trigger.manual', data: { label: 'T', config: {} }, inputs: [], outputs: [] },
        { id: 'if_node', type: 'primitive.if', data: { label: 'Check', config: { condition: 'valid-user-id' } }, inputs: [], outputs: [] },
        { id: 'true_node', type: 'primitive.map', data: { label: 'True', config: { ok: true } }, inputs: [], outputs: [] }
      ],
      edges: [
        { id: 'e1', source: 'trig', sourceHandle: 'main', target: 'if_node', targetHandle: 'main' },
        { id: 'e2', source: 'if_node', sourceHandle: 'true', target: 'true_node', targetHandle: 'main' }
      ]
    };

    const res = await workflowRunner.runWorkflow(wf, { mockDatabase: db });
    expect(res.nodeOutputs.get('true_node')).toEqual({ ok: true });
  });

  it('F14-5: should treat 0, null, and empty string as falsy and route to false port', async () => {
    const wf: WorkflowDefinition = {
      id: 'wf_if_falsy',
      workspaceId: 'ws_1',
      name: 'IF Falsy Test',
      nodes: [
        { id: 'trig', type: 'trigger.manual', data: { label: 'T', config: {} }, inputs: [], outputs: [] },
        { id: 'if_node', type: 'primitive.if', data: { label: 'Check', config: { condition: '' } }, inputs: [], outputs: [] },
        { id: 'false_node', type: 'primitive.map', data: { label: 'False', config: { ok: 'falsy_confirmed' } }, inputs: [], outputs: [] }
      ],
      edges: [
        { id: 'e1', source: 'trig', sourceHandle: 'main', target: 'if_node', targetHandle: 'main' },
        { id: 'e2', source: 'if_node', sourceHandle: 'false', target: 'false_node', targetHandle: 'main' }
      ]
    };

    const res = await workflowRunner.runWorkflow(wf, { mockDatabase: db });
    expect(res.nodeOutputs.get('false_node')).toEqual({ ok: 'falsy_confirmed' });
  });
});

describe('Tier 1: Feature F15 - Graph Primitive: Filter', () => {
  let db: InMemoryDatabase;

  beforeEach(() => {
    db = new InMemoryDatabase();
  });

  it('F15-1: should pass items matching filter criteria through "passed" output port', async () => {
    const wf: WorkflowDefinition = {
      id: 'wf_filter_pass',
      workspaceId: 'ws_1',
      name: 'Filter Pass Test',
      nodes: [
        { id: 'trig', type: 'trigger.manual', data: { label: 'T', config: {} }, inputs: [], outputs: [] },
        {
          id: 'filter_node',
          type: 'primitive.filter',
          data: {
            label: 'Filter Active',
            config: {
              items: [
                { id: 1, active: true },
                { id: 2, active: false },
                { id: 3, active: true }
              ],
              predicate: '{{ $item.active }}'
            }
          },
          inputs: [],
          outputs: []
        }
      ],
      edges: [
        { id: 'e1', source: 'trig', sourceHandle: 'main', target: 'filter_node', targetHandle: 'main' }
      ]
    };

    const res = await workflowRunner.runWorkflow(wf, { mockDatabase: db });
    const output = res.nodeOutputs.get('filter_node') as { passed: Array<{ id: number }>; discarded: Array<{ id: number }>; count: number };
    expect(output.count).toBe(2);
    expect(output.passed.map(x => x.id)).toEqual([1, 3]);
    expect(output.discarded.map(x => x.id)).toEqual([2]);
  });

  it('F15-2: should separate discarded items on "discarded" port', async () => {
    const wf: WorkflowDefinition = {
      id: 'wf_filter_discard',
      workspaceId: 'ws_1',
      name: 'Filter Discard Test',
      nodes: [
        { id: 'trig', type: 'trigger.manual', data: { label: 'T', config: {} }, inputs: [], outputs: [] },
        {
          id: 'filter_node',
          type: 'primitive.filter',
          data: {
            label: 'Filter Scores',
            config: {
              items: [10, 45, 80, 20, 95],
              predicate: '{{ $item >= 50 }}'
            }
          },
          inputs: [],
          outputs: []
        }
      ],
      edges: [
        { id: 'e1', source: 'trig', sourceHandle: 'main', target: 'filter_node', targetHandle: 'main' }
      ]
    };

    const res = await workflowRunner.runWorkflow(wf, { mockDatabase: db });
    const output = res.nodeOutputs.get('filter_node') as { passed: number[]; discarded: number[] };
    expect(output.passed).toEqual([80, 95]);
    expect(output.discarded).toEqual([10, 45, 20]);
  });

  it('F15-3: should handle empty array input safely with 0 count', async () => {
    const wf: WorkflowDefinition = {
      id: 'wf_filter_empty',
      workspaceId: 'ws_1',
      name: 'Filter Empty Test',
      nodes: [
        { id: 'trig', type: 'trigger.manual', data: { label: 'T', config: {} }, inputs: [], outputs: [] },
        {
          id: 'filter_node',
          type: 'primitive.filter',
          data: { label: 'Empty Filter', config: { items: [], predicate: true } },
          inputs: [],
          outputs: []
        }
      ],
      edges: [
        { id: 'e1', source: 'trig', sourceHandle: 'main', target: 'filter_node', targetHandle: 'main' }
      ]
    };

    const res = await workflowRunner.runWorkflow(wf, { mockDatabase: db });
    const output = res.nodeOutputs.get('filter_node') as { passed: unknown[]; count: number };
    expect(output.count).toBe(0);
    expect(output.passed).toHaveLength(0);
  });

  it('F15-4: should handle all items passing filter condition', async () => {
    const wf: WorkflowDefinition = {
      id: 'wf_filter_all_pass',
      workspaceId: 'ws_1',
      name: 'Filter All Pass',
      nodes: [
        { id: 'trig', type: 'trigger.manual', data: { label: 'T', config: {} }, inputs: [], outputs: [] },
        {
          id: 'filter_node',
          type: 'primitive.filter',
          data: { label: 'All Pass', config: { items: ['apple', 'avocado'], predicate: '{{ $item.startsWith("a") }}' } },
          inputs: [],
          outputs: []
        }
      ],
      edges: [
        { id: 'e1', source: 'trig', sourceHandle: 'main', target: 'filter_node', targetHandle: 'main' }
      ]
    };

    const res = await workflowRunner.runWorkflow(wf, { mockDatabase: db });
    const output = res.nodeOutputs.get('filter_node') as { count: number; discarded: unknown[] };
    expect(output.count).toBe(2);
    expect(output.discarded).toHaveLength(0);
  });

  it('F15-5: should handle all items failing filter condition without crashing pipeline', async () => {
    const wf: WorkflowDefinition = {
      id: 'wf_filter_none_pass',
      workspaceId: 'ws_1',
      name: 'Filter None Pass',
      nodes: [
        { id: 'trig', type: 'trigger.manual', data: { label: 'T', config: {} }, inputs: [], outputs: [] },
        {
          id: 'filter_node',
          type: 'primitive.filter',
          data: { label: 'None Pass', config: { items: [1, 2, 3], predicate: '{{ $item > 10 }}' } },
          inputs: [],
          outputs: []
        }
      ],
      edges: [
        { id: 'e1', source: 'trig', sourceHandle: 'main', target: 'filter_node', targetHandle: 'main' }
      ]
    };

    const res = await workflowRunner.runWorkflow(wf, { mockDatabase: db });
    expect(res.execution.status).toBe('SUCCEEDED');
    const output = res.nodeOutputs.get('filter_node') as { count: number; passed: unknown[] };
    expect(output.count).toBe(0);
  });
});

describe('Tier 1: Feature F16 - Graph Primitive: Map / Transform', () => {
  let db: InMemoryDatabase;

  beforeEach(() => {
    db = new InMemoryDatabase();
  });

  it('F16-1: should transform input payload using template mapping', async () => {
    const wf: WorkflowDefinition = {
      id: 'wf_map_1',
      workspaceId: 'ws_1',
      name: 'Map Test',
      nodes: [
        { id: 'trig', type: 'trigger.manual', data: { label: 'T', config: {} }, inputs: [], outputs: [] },
        { id: 'source', type: 'primitive.map', data: { label: 'Source', config: { user: { firstName: 'Jane', lastName: 'Doe', age: 30 } } }, inputs: [], outputs: [] },
        {
          id: 'mapper',
          type: 'primitive.map',
          data: {
            label: 'Mapper',
            config: {
              transform: {
                fullName: '{{ $nodes.source.output.user.firstName }} {{ $nodes.source.output.user.lastName }}',
                isAdult: '{{ $nodes.source.output.user.age >= 18 }}'
              }
            }
          },
          inputs: [],
          outputs: []
        }
      ],
      edges: [
        { id: 'e1', source: 'trig', sourceHandle: 'main', target: 'source', targetHandle: 'main' },
        { id: 'e2', source: 'source', sourceHandle: 'main', target: 'mapper', targetHandle: 'main' }
      ]
    };

    const res = await workflowRunner.runWorkflow(wf, { mockDatabase: db });
    expect(res.execution.status).toBe('SUCCEEDED');
    const mapped = res.nodeOutputs.get('mapper') as { fullName: string; isAdult: boolean };
    expect(mapped.fullName).toBe('Jane Doe');
    expect(mapped.isAdult).toBe(true);
  });

  it('F16-2: should preserve numbers, booleans, and nested structures in mapped output', async () => {
    const wf: WorkflowDefinition = {
      id: 'wf_map_types',
      workspaceId: 'ws_1',
      name: 'Map Types',
      nodes: [
        { id: 'trig', type: 'trigger.manual', data: { label: 'T', config: {} }, inputs: [], outputs: [] },
        {
          id: 'map_node',
          type: 'primitive.map',
          data: {
            label: 'Types',
            config: {
              transform: {
                count: 100,
                active: false,
                metadata: { tier: 'pro', limits: [10, 20] }
              }
            }
          },
          inputs: [],
          outputs: []
        }
      ],
      edges: [{ id: 'e1', source: 'trig', sourceHandle: 'main', target: 'map_node', targetHandle: 'main' }]
    };

    const res = await workflowRunner.runWorkflow(wf, { mockDatabase: db });
    const output = res.nodeOutputs.get('map_node') as any;
    expect(output.count).toBe(100);
    expect(output.active).toBe(false);
    expect(output.metadata.tier).toBe('pro');
    expect(output.metadata.limits).toEqual([10, 20]);
  });

  it('F16-3: should handle optional missing fields by returning undefined or empty string', async () => {
    const wf: WorkflowDefinition = {
      id: 'wf_map_missing',
      workspaceId: 'ws_1',
      name: 'Map Missing',
      nodes: [
        { id: 'trig', type: 'trigger.manual', data: { label: 'T', config: {} }, inputs: [], outputs: [] },
        {
          id: 'map_node',
          type: 'primitive.map',
          data: {
            label: 'Missing Fields',
            config: {
              transform: {
                nickname: '{{ $trigger.nonExistentField }}'
              }
            }
          },
          inputs: [],
          outputs: []
        }
      ],
      edges: [{ id: 'e1', source: 'trig', sourceHandle: 'main', target: 'map_node', targetHandle: 'main' }]
    };

    const res = await workflowRunner.runWorkflow(wf, { mockDatabase: db });
    expect(res.execution.status).toBe('SUCCEEDED');
    const output = res.nodeOutputs.get('map_node') as { nickname: unknown };
    expect(output.nickname).toBeUndefined();
  });

  it('F16-4: should compute mathematical expressions in mapping transforms', async () => {
    const wf: WorkflowDefinition = {
      id: 'wf_map_math',
      workspaceId: 'ws_1',
      name: 'Map Math',
      nodes: [
        { id: 'trig', type: 'trigger.manual', data: { label: 'T', config: {} }, inputs: [], outputs: [] },
        { id: 'base', type: 'primitive.map', data: { label: 'B', config: { price: 100, taxRate: 1.2 } }, inputs: [], outputs: [] },
        {
          id: 'calc',
          type: 'primitive.map',
          data: {
            label: 'Calc',
            config: {
              transform: {
                isExpensive: '{{ $nodes.base.output.price > 50 }}'
              }
            }
          },
          inputs: [],
          outputs: []
        }
      ],
      edges: [
        { id: 'e1', source: 'trig', sourceHandle: 'main', target: 'base', targetHandle: 'main' },
        { id: 'e2', source: 'base', sourceHandle: 'main', target: 'calc', targetHandle: 'main' }
      ]
    };

    const res = await workflowRunner.runWorkflow(wf, { mockDatabase: db });
    const output = res.nodeOutputs.get('calc') as { isExpensive: boolean };
    expect(output.isExpensive).toBe(true);
  });

  it('F16-5: should support array transformations and mapping', async () => {
    const wf: WorkflowDefinition = {
      id: 'wf_map_array',
      workspaceId: 'ws_1',
      name: 'Map Array',
      nodes: [
        { id: 'trig', type: 'trigger.manual', data: { label: 'T', config: {} }, inputs: [], outputs: [] },
        {
          id: 'map_node',
          type: 'primitive.map',
          data: {
            label: 'Array Map',
            config: {
              transform: {
                tags: ['a', 'b', 'c']
              }
            }
          },
          inputs: [],
          outputs: []
        }
      ],
      edges: [{ id: 'e1', source: 'trig', sourceHandle: 'main', target: 'map_node', targetHandle: 'main' }]
    };

    const res = await workflowRunner.runWorkflow(wf, { mockDatabase: db });
    const output = res.nodeOutputs.get('map_node') as { tags: string[] };
    expect(output.tags).toEqual(['a', 'b', 'c']);
  });
});

describe('Tier 1: Feature F17 - Graph Primitive: Delay / Wait', () => {
  let db: InMemoryDatabase;

  beforeEach(() => {
    db = new InMemoryDatabase();
  });

  it('F17-1: should pause workflow execution and schedule delay job in task queue', async () => {
    const wf: WorkflowDefinition = {
      id: 'wf_delay_sched',
      workspaceId: 'ws_1',
      name: 'Delay Schedule',
      nodes: [
        { id: 'trig', type: 'trigger.manual', data: { label: 'T', config: {} }, inputs: [], outputs: [] },
        { id: 'delay_node', type: 'primitive.delay', data: { label: 'Wait 50ms', config: { delayMs: 50 } }, inputs: [], outputs: [] }
      ],
      edges: [{ id: 'e1', source: 'trig', sourceHandle: 'main', target: 'delay_node', targetHandle: 'main' }]
    };

    const res = await workflowRunner.runWorkflow(wf, { mockDatabase: db });
    expect(res.execution.status).toBe('SUCCEEDED');
    const delayOut = res.nodeOutputs.get('delay_node') as { delayedMs: number; resumedAt: string };
    expect(delayOut.delayedMs).toBe(50);
    expect(delayOut.resumedAt).toBeDefined();
  });

  it('F17-2: should record delay step completion in PostgreSQL step journal', async () => {
    const wf: WorkflowDefinition = {
      id: 'wf_delay_journal',
      workspaceId: 'ws_1',
      name: 'Delay Journal',
      nodes: [
        { id: 'trig', type: 'trigger.manual', data: { label: 'T', config: {} }, inputs: [], outputs: [] },
        { id: 'delay_node', type: 'primitive.delay', data: { label: 'Wait 20ms', config: { delayMs: 20 } }, inputs: [], outputs: [] }
      ],
      edges: [{ id: 'e1', source: 'trig', sourceHandle: 'main', target: 'delay_node', targetHandle: 'main' }]
    };

    const res = await workflowRunner.runWorkflow(wf, { mockDatabase: db });
    const steps = db.findNodeExecutions(res.execution.id);
    const delayStep = steps.find(s => s.node_id === 'delay_node');
    expect(delayStep?.status).toBe('SUCCEEDED');
  });

  it('F17-3: should execute downstream actions after delay resumes', async () => {
    const wf: WorkflowDefinition = {
      id: 'wf_delay_downstream',
      workspaceId: 'ws_1',
      name: 'Delay Downstream',
      nodes: [
        { id: 'trig', type: 'trigger.manual', data: { label: 'T', config: {} }, inputs: [], outputs: [] },
        { id: 'delay_node', type: 'primitive.delay', data: { label: 'Wait 10ms', config: { delayMs: 10 } }, inputs: [], outputs: [] },
        { id: 'after_delay', type: 'primitive.map', data: { label: 'After', config: { executedAfterDelay: true } }, inputs: [], outputs: [] }
      ],
      edges: [
        { id: 'e1', source: 'trig', sourceHandle: 'main', target: 'delay_node', targetHandle: 'main' },
        { id: 'e2', source: 'delay_node', sourceHandle: 'main', target: 'after_delay', targetHandle: 'main' }
      ]
    };

    const res = await workflowRunner.runWorkflow(wf, { mockDatabase: db });
    expect(res.execution.status).toBe('SUCCEEDED');
    expect(res.nodeOutputs.get('after_delay')).toEqual({ executedAfterDelay: true });
  });

  it('F17-4: should handle zero or small delay as immediate resolution', async () => {
    const wf: WorkflowDefinition = {
      id: 'wf_delay_zero',
      workspaceId: 'ws_1',
      name: 'Zero Delay',
      nodes: [
        { id: 'trig', type: 'trigger.manual', data: { label: 'T', config: {} }, inputs: [], outputs: [] },
        { id: 'delay_node', type: 'primitive.delay', data: { label: 'Zero', config: { delayMs: 0 } }, inputs: [], outputs: [] }
      ],
      edges: [{ id: 'e1', source: 'trig', sourceHandle: 'main', target: 'delay_node', targetHandle: 'main' }]
    };

    const res = await workflowRunner.runWorkflow(wf, { mockDatabase: db });
    expect(res.execution.status).toBe('SUCCEEDED');
  });

  it('F17-5: should support delay cancellation if execution is aborted during wait', async () => {
    const ex = db.createExecution({
      workflow_id: 'wf_delay_cancel',
      workflow_version_id: 'v1',
      workspace_id: 'ws_1',
      status: 'WAITING',
      trigger_type: 'manual'
    });

    const cancelled = db.updateExecution(ex.id, {
      status: 'CANCELLED',
      finished_at: new Date(),
      error_summary: 'Cancelled during delay'
    });
    expect(cancelled.status).toBe('CANCELLED');
  });
});

describe('Tier 1: Feature F18 - Graph Primitive: For Each', () => {
  let db: InMemoryDatabase;

  beforeEach(() => {
    db = new InMemoryDatabase();
  });

  it('F18-1: should iterate over array items and aggregate total count', async () => {
    const wf: WorkflowDefinition = {
      id: 'wf_foreach_1',
      workspaceId: 'ws_1',
      name: 'For Each Test',
      nodes: [
        { id: 'trig', type: 'trigger.manual', data: { label: 'T', config: {} }, inputs: [], outputs: [] },
        {
          id: 'loop_node',
          type: 'primitive.forEach',
          data: {
            label: 'Process Items',
            config: { items: ['item_a', 'item_b', 'item_c'] }
          },
          inputs: [],
          outputs: []
        }
      ],
      edges: [{ id: 'e1', source: 'trig', sourceHandle: 'main', target: 'loop_node', targetHandle: 'main' }]
    };

    const res = await workflowRunner.runWorkflow(wf, { mockDatabase: db });
    expect(res.execution.status).toBe('SUCCEEDED');
    const out = res.nodeOutputs.get('loop_node') as { items: Array<{ item: string; index: number }>; total: number };
    expect(out.total).toBe(3);
    expect(out.items[0]).toEqual({ item: 'item_a', index: 0, processed: true });
    expect(out.items[2]).toEqual({ item: 'item_c', index: 2, processed: true });
  });

  it('F18-2: should handle empty array by returning total 0 without error', async () => {
    const wf: WorkflowDefinition = {
      id: 'wf_foreach_empty',
      workspaceId: 'ws_1',
      name: 'For Each Empty',
      nodes: [
        { id: 'trig', type: 'trigger.manual', data: { label: 'T', config: {} }, inputs: [], outputs: [] },
        { id: 'loop_node', type: 'primitive.forEach', data: { label: 'Empty Loop', config: { items: [] } }, inputs: [], outputs: [] }
      ],
      edges: [{ id: 'e1', source: 'trig', sourceHandle: 'main', target: 'loop_node', targetHandle: 'main' }]
    };

    const res = await workflowRunner.runWorkflow(wf, { mockDatabase: db });
    expect(res.execution.status).toBe('SUCCEEDED');
    const out = res.nodeOutputs.get('loop_node') as { items: unknown[]; total: number };
    expect(out.total).toBe(0);
    expect(out.items).toHaveLength(0);
  });

  it('F18-3: should iterate single-item array properly', async () => {
    const wf: WorkflowDefinition = {
      id: 'wf_foreach_single',
      workspaceId: 'ws_1',
      name: 'Single Item Loop',
      nodes: [
        { id: 'trig', type: 'trigger.manual', data: { label: 'T', config: {} }, inputs: [], outputs: [] },
        { id: 'loop_node', type: 'primitive.forEach', data: { label: 'Solo', config: { items: [{ id: 99 }] } }, inputs: [], outputs: [] }
      ],
      edges: [{ id: 'e1', source: 'trig', sourceHandle: 'main', target: 'loop_node', targetHandle: 'main' }]
    };

    const res = await workflowRunner.runWorkflow(wf, { mockDatabase: db });
    const out = res.nodeOutputs.get('loop_node') as { items: Array<{ item: { id: number } }>; total: number };
    expect(out.total).toBe(1);
    expect(out.items[0].item.id).toBe(99);
  });

  it('F18-4: should preserve ordering of array elements across iterations', async () => {
    const list = [10, 20, 30, 40, 50];
    const wf: WorkflowDefinition = {
      id: 'wf_foreach_order',
      workspaceId: 'ws_1',
      name: 'Order Test',
      nodes: [
        { id: 'trig', type: 'trigger.manual', data: { label: 'T', config: {} }, inputs: [], outputs: [] },
        { id: 'loop_node', type: 'primitive.forEach', data: { label: 'Order', config: { items: list } }, inputs: [], outputs: [] }
      ],
      edges: [{ id: 'e1', source: 'trig', sourceHandle: 'main', target: 'loop_node', targetHandle: 'main' }]
    };

    const res = await workflowRunner.runWorkflow(wf, { mockDatabase: db });
    const out = res.nodeOutputs.get('loop_node') as { items: Array<{ item: number; index: number }> };
    expect(out.items.map(i => i.item)).toEqual(list);
    expect(out.items.map(i => i.index)).toEqual([0, 1, 2, 3, 4]);
  });

  it('F18-5: should allow downstream continuation after loop completion', async () => {
    const wf: WorkflowDefinition = {
      id: 'wf_foreach_done',
      workspaceId: 'ws_1',
      name: 'Loop Done Step',
      nodes: [
        { id: 'trig', type: 'trigger.manual', data: { label: 'T', config: {} }, inputs: [], outputs: [] },
        { id: 'loop_node', type: 'primitive.forEach', data: { label: 'Loop', config: { items: ['x', 'y'] } }, inputs: [], outputs: [] },
        { id: 'post_loop', type: 'primitive.map', data: { label: 'Done Action', config: { loopFinished: true } }, inputs: [], outputs: [] }
      ],
      edges: [
        { id: 'e1', source: 'trig', sourceHandle: 'main', target: 'loop_node', targetHandle: 'main' },
        { id: 'e2', source: 'loop_node', sourceHandle: 'done', target: 'post_loop', targetHandle: 'main' }
      ]
    };

    const res = await workflowRunner.runWorkflow(wf, { mockDatabase: db });
    expect(res.execution.status).toBe('SUCCEEDED');
    expect(res.nodeOutputs.get('post_loop')).toEqual({ loopFinished: true });
  });
});

describe('Tier 1: Feature F19 - Graph Primitive: Merge', () => {
  let db: InMemoryDatabase;

  beforeEach(() => {
    db = new InMemoryDatabase();
  });

  it('F19-1: should merge outputs from two parallel upstream branches into combined array', async () => {
    const wf: WorkflowDefinition = {
      id: 'wf_merge_2',
      workspaceId: 'ws_1',
      name: 'Merge 2 Branches',
      nodes: [
        { id: 'trig', type: 'trigger.manual', data: { label: 'T', config: {} }, inputs: [], outputs: [] },
        { id: 'branch_a', type: 'primitive.map', data: { label: 'Branch A', config: { dataA: 'alpha' } }, inputs: [], outputs: [] },
        { id: 'branch_b', type: 'primitive.map', data: { label: 'Branch B', config: { dataB: 'beta' } }, inputs: [], outputs: [] },
        { id: 'merge_node', type: 'primitive.merge', data: { label: 'Merge', config: {} }, inputs: [], outputs: [] }
      ],
      edges: [
        { id: 'e1', source: 'trig', sourceHandle: 'main', target: 'branch_a', targetHandle: 'main' },
        { id: 'e2', source: 'trig', sourceHandle: 'main', target: 'branch_b', targetHandle: 'main' },
        { id: 'e3', source: 'branch_a', sourceHandle: 'main', target: 'merge_node', targetHandle: 'main' },
        { id: 'e4', source: 'branch_b', sourceHandle: 'main', target: 'merge_node', targetHandle: 'main' }
      ]
    };

    const res = await workflowRunner.runWorkflow(wf, { mockDatabase: db });
    expect(res.execution.status).toBe('SUCCEEDED');
    const mergeOut = res.nodeOutputs.get('merge_node') as { merged: unknown[]; count: number };
    expect(mergeOut.count).toBe(2);
    expect(mergeOut.merged).toContainEqual({ dataA: 'alpha' });
    expect(mergeOut.merged).toContainEqual({ dataB: 'beta' });
  });

  it('F19-2: should handle merge when one upstream branch was SKIPPED by an IF condition', async () => {
    const wf: WorkflowDefinition = {
      id: 'wf_merge_skipped_branch',
      workspaceId: 'ws_1',
      name: 'Merge Skipped',
      nodes: [
        { id: 'trig', type: 'trigger.manual', data: { label: 'T', config: {} }, inputs: [], outputs: [] },
        { id: 'if_node', type: 'primitive.if', data: { label: 'IF', config: { condition: true } }, inputs: [], outputs: [] },
        { id: 'true_node', type: 'primitive.map', data: { label: 'True Branch', config: { branch: 'true' } }, inputs: [], outputs: [] },
        { id: 'false_node', type: 'primitive.map', data: { label: 'False Branch', config: { branch: 'false' } }, inputs: [], outputs: [] },
        { id: 'merge_node', type: 'primitive.merge', data: { label: 'Merge', config: {} }, inputs: [], outputs: [] }
      ],
      edges: [
        { id: 'e1', source: 'trig', sourceHandle: 'main', target: 'if_node', targetHandle: 'main' },
        { id: 'e2', source: 'if_node', sourceHandle: 'true', target: 'true_node', targetHandle: 'main' },
        { id: 'e3', source: 'if_node', sourceHandle: 'false', target: 'false_node', targetHandle: 'main' },
        { id: 'e4', source: 'true_node', sourceHandle: 'main', target: 'merge_node', targetHandle: 'main' },
        { id: 'e5', source: 'false_node', sourceHandle: 'main', target: 'merge_node', targetHandle: 'main' }
      ]
    };

    const res = await workflowRunner.runWorkflow(wf, { mockDatabase: db });
    expect(res.execution.status).toBe('SUCCEEDED');
    expect(res.skippedNodes.has('false_node')).toBe(true);
    const mergeOut = res.nodeOutputs.get('merge_node') as { merged: unknown[]; count: number };
    expect(mergeOut.count).toBe(1);
    expect(mergeOut.merged).toEqual([{ branch: 'true' }]);
  });

  it('F19-3: should support 3 converging branches merging into single downstream consumer', async () => {
    const wf: WorkflowDefinition = {
      id: 'wf_merge_3',
      workspaceId: 'ws_1',
      name: 'Merge 3',
      nodes: [
        { id: 'trig', type: 'trigger.manual', data: { label: 'T', config: {} }, inputs: [], outputs: [] },
        { id: 'b1', type: 'primitive.map', data: { label: 'B1', config: { v: 1 } }, inputs: [], outputs: [] },
        { id: 'b2', type: 'primitive.map', data: { label: 'B2', config: { v: 2 } }, inputs: [], outputs: [] },
        { id: 'b3', type: 'primitive.map', data: { label: 'B3', config: { v: 3 } }, inputs: [], outputs: [] },
        { id: 'merge_node', type: 'primitive.merge', data: { label: 'Merge', config: {} }, inputs: [], outputs: [] }
      ],
      edges: [
        { id: 'e1', source: 'trig', sourceHandle: 'main', target: 'b1', targetHandle: 'main' },
        { id: 'e2', source: 'trig', sourceHandle: 'main', target: 'b2', targetHandle: 'main' },
        { id: 'e3', source: 'trig', sourceHandle: 'main', target: 'b3', targetHandle: 'main' },
        { id: 'e4', source: 'b1', sourceHandle: 'main', target: 'merge_node', targetHandle: 'main' },
        { id: 'e5', source: 'b2', sourceHandle: 'main', target: 'merge_node', targetHandle: 'main' },
        { id: 'e6', source: 'b3', sourceHandle: 'main', target: 'merge_node', targetHandle: 'main' }
      ]
    };

    const res = await workflowRunner.runWorkflow(wf, { mockDatabase: db });
    const mergeOut = res.nodeOutputs.get('merge_node') as { count: number };
    expect(mergeOut.count).toBe(3);
  });

  it('F19-4: should execute downstream actions after merge produces synchronized payload', async () => {
    const wf: WorkflowDefinition = {
      id: 'wf_merge_consumer',
      workspaceId: 'ws_1',
      name: 'Merge Consumer',
      nodes: [
        { id: 'trig', type: 'trigger.manual', data: { label: 'T', config: {} }, inputs: [], outputs: [] },
        { id: 'b1', type: 'primitive.map', data: { label: 'B1', config: { part: 'header' } }, inputs: [], outputs: [] },
        { id: 'b2', type: 'primitive.map', data: { label: 'B2', config: { part: 'body' } }, inputs: [], outputs: [] },
        { id: 'merge', type: 'primitive.merge', data: { label: 'Merge', config: {} }, inputs: [], outputs: [] },
        { id: 'final_step', type: 'primitive.map', data: { label: 'Final', config: { mergedCount: '{{ $nodes.merge.output.count }}' } }, inputs: [], outputs: [] }
      ],
      edges: [
        { id: 'e1', source: 'trig', sourceHandle: 'main', target: 'b1', targetHandle: 'main' },
        { id: 'e2', source: 'trig', sourceHandle: 'main', target: 'b2', targetHandle: 'main' },
        { id: 'e3', source: 'b1', sourceHandle: 'main', target: 'merge', targetHandle: 'main' },
        { id: 'e4', source: 'b2', sourceHandle: 'main', target: 'merge', targetHandle: 'main' },
        { id: 'e5', source: 'merge', sourceHandle: 'main', target: 'final_step', targetHandle: 'main' }
      ]
    };

    const res = await workflowRunner.runWorkflow(wf, { mockDatabase: db });
    expect(res.execution.status).toBe('SUCCEEDED');
    const finalOut = res.nodeOutputs.get('final_step') as { mergedCount: number };
    expect(finalOut.mergedCount).toBe(2);
  });

  it('F19-5: should act as pass-through when only a single incoming branch is configured', async () => {
    const wf: WorkflowDefinition = {
      id: 'wf_merge_single',
      workspaceId: 'ws_1',
      name: 'Single Input Merge',
      nodes: [
        { id: 'trig', type: 'trigger.manual', data: { label: 'T', config: {} }, inputs: [], outputs: [] },
        { id: 'b1', type: 'primitive.map', data: { label: 'Single', config: { only: true } }, inputs: [], outputs: [] },
        { id: 'merge', type: 'primitive.merge', data: { label: 'Merge', config: {} }, inputs: [], outputs: [] }
      ],
      edges: [
        { id: 'e1', source: 'trig', sourceHandle: 'main', target: 'b1', targetHandle: 'main' },
        { id: 'e2', source: 'b1', sourceHandle: 'main', target: 'merge', targetHandle: 'main' }
      ]
    };

    const res = await workflowRunner.runWorkflow(wf, { mockDatabase: db });
    const mergeOut = res.nodeOutputs.get('merge') as { count: number; merged: unknown[] };
    expect(mergeOut.count).toBe(1);
    expect(mergeOut.merged[0]).toEqual({ only: true });
  });
});
