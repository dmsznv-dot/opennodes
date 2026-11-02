/**
 * LocalFlow E2E Test Suite - Tier 2: Schema & Cycle Boundary Cases
 * Verifies graph limits, extreme sizes, cycle topology edge cases, and empty payloads.
 */

import { describe, it, expect, beforeEach } from '../harness/index.ts';
import { cycleDetector } from '../harness/cycle-detector.ts';
import { workflowRunner } from '../harness/workflow-runner.ts';
import { InMemoryDatabase } from '../harness/db-mock.ts';
import type { WorkflowDefinition, WorkflowNode, WorkflowEdge } from '../harness/types.ts';

describe('Tier 2: Boundary - Schema & Cycle Extremes', () => {
  let db: InMemoryDatabase;

  beforeEach(() => {
    db = new InMemoryDatabase();
  });

  it('B-SCH-1: should validate and execute a massive 50-node linear pipeline without recursion overflow', async () => {
    const nodes: WorkflowNode[] = [
      { id: 'trig', type: 'trigger.manual', data: { label: 'Start', config: {} }, inputs: [], outputs: [] }
    ];
    const edges: WorkflowEdge[] = [];

    for (let i = 1; i <= 50; i++) {
      const nodeId = `node_${i}`;
      nodes.push({
        id: nodeId,
        type: 'primitive.map',
        data: { label: `Step ${i}`, config: { step: i } },
        inputs: [],
        outputs: []
      });
      const prevId = i === 1 ? 'trig' : `node_${i - 1}`;
      edges.push({
        id: `e_${prevId}_${nodeId}`,
        source: prevId,
        sourceHandle: 'main',
        target: nodeId,
        targetHandle: 'main'
      });
    }

    const largeWf: WorkflowDefinition = {
      id: 'wf_large_chain_50',
      workspaceId: 'ws_1',
      name: '50 Node Chain',
      nodes,
      edges
    };

    const validation = cycleDetector.validateGraph(largeWf);
    expect(validation.isValid).toBe(true);
    expect(validation.topologicalOrder.length).toBe(51);

    const res = await workflowRunner.runWorkflow(largeWf, { mockDatabase: db });
    expect(res.execution.status).toBe('SUCCEEDED');
    expect(res.stepRecords.length).toBe(51);
  });

  it('B-SCH-2: should mark completely disconnected nodes as SKIPPED without failing execution', async () => {
    const disconnectedWf: WorkflowDefinition = {
      id: 'wf_disconnected',
      workspaceId: 'ws_1',
      name: 'Disconnected Nodes',
      nodes: [
        { id: 'trig', type: 'trigger.manual', data: { label: 'T', config: {} }, inputs: [], outputs: [] },
        { id: 'connected_step', type: 'primitive.map', data: { label: 'Active', config: { ok: true } }, inputs: [], outputs: [] },
        { id: 'orphan_island', type: 'primitive.map', data: { label: 'Orphan', config: { ok: false } }, inputs: [], outputs: [] }
      ],
      edges: [
        { id: 'e1', source: 'trig', sourceHandle: 'main', target: 'connected_step', targetHandle: 'main' }
      ]
    };

    const res = await workflowRunner.runWorkflow(disconnectedWf, { mockDatabase: db });
    expect(res.execution.status).toBe('SUCCEEDED');
    expect(res.nodeOutputs.has('connected_step')).toBe(true);
    expect(res.skippedNodes.has('orphan_island')).toBe(true);
  });

  it('B-SCH-3: should detect complex cross-branch cycle in multi-branch DAG', () => {
    // Structure: Trig -> (BranchA, BranchB)
    // BranchA -> A2 -> Merge
    // BranchB -> B2 -> A2 (Cross-edge)
    // Merge -> BranchB (Back-edge creating cycle: BranchB -> B2 -> A2 -> Merge -> BranchB)
    const complexCycleWf: WorkflowDefinition = {
      id: 'wf_complex_cycle',
      workspaceId: 'ws_1',
      name: 'Complex Cross-Branch Cycle',
      nodes: [
        { id: 'trig', type: 'trigger.manual', data: { label: 'T', config: {} }, inputs: [], outputs: [] },
        { id: 'bA', type: 'primitive.map', data: { label: 'BA', config: {} }, inputs: [], outputs: [] },
        { id: 'bB', type: 'primitive.map', data: { label: 'BB', config: {} }, inputs: [], outputs: [] },
        { id: 'a2', type: 'primitive.map', data: { label: 'A2', config: {} }, inputs: [], outputs: [] },
        { id: 'b2', type: 'primitive.map', data: { label: 'B2', config: {} }, inputs: [], outputs: [] },
        { id: 'merge', type: 'primitive.merge', data: { label: 'M', config: {} }, inputs: [], outputs: [] }
      ],
      edges: [
        { id: 'e0', source: 'trig', sourceHandle: 'main', target: 'bA', targetHandle: 'main' },
        { id: 'e1', source: 'trig', sourceHandle: 'main', target: 'bB', targetHandle: 'main' },
        { id: 'e2', source: 'bA', sourceHandle: 'main', target: 'a2', targetHandle: 'main' },
        { id: 'e3', source: 'bB', sourceHandle: 'main', target: 'b2', targetHandle: 'main' },
        { id: 'e4', source: 'b2', sourceHandle: 'main', target: 'a2', targetHandle: 'main' },
        { id: 'e5', source: 'a2', sourceHandle: 'main', target: 'merge', targetHandle: 'main' },
        { id: 'e6', source: 'merge', sourceHandle: 'main', target: 'bB', targetHandle: 'main' } // Back-edge!
      ]
    };

    const res = cycleDetector.validateGraph(complexCycleWf);
    expect(res.isValid).toBe(false);
    expect(res.errors[0]).toContain('ERR_CYCLIC_DEPENDENCY_DETECTED');
    expect(res.cycles.length).toBeGreaterThan(0);
  });

  it('B-SCH-4: should handle empty JSON payload {} passing through pipeline cleanly', async () => {
    const emptyWf: WorkflowDefinition = {
      id: 'wf_empty_payload',
      workspaceId: 'ws_1',
      name: 'Empty Payload Run',
      nodes: [
        { id: 'trig', type: 'trigger.manual', data: { label: 'T', config: {} }, inputs: [], outputs: [] },
        { id: 'step', type: 'primitive.map', data: { label: 'Pass', config: { received: '{{ $trigger }}' } }, inputs: [], outputs: [] }
      ],
      edges: [{ id: 'e1', source: 'trig', sourceHandle: 'main', target: 'step', targetHandle: 'main' }]
    };

    const res = await workflowRunner.runWorkflow(emptyWf, { mockDatabase: db, triggerPayload: {} });
    expect(res.execution.status).toBe('SUCCEEDED');
  });

  it('B-SCH-5: should process large array payload (10,000 items) without memory degradation', async () => {
    const items = Array.from({ length: 10000 }, (_, i) => ({ id: i, val: `item_${i}` }));

    const wf: WorkflowDefinition = {
      id: 'wf_large_items',
      workspaceId: 'ws_1',
      name: 'Large Items Test',
      nodes: [
        { id: 'trig', type: 'trigger.manual', data: { label: 'T', config: {} }, inputs: [], outputs: [] },
        {
          id: 'filter_step',
          type: 'primitive.filter',
          data: {
            label: 'Filter Mod',
            config: { items, predicate: '{{ $item.id >= 9990 }}' }
          },
          inputs: [],
          outputs: []
        }
      ],
      edges: [{ id: 'e1', source: 'trig', sourceHandle: 'main', target: 'filter_step', targetHandle: 'main' }]
    };

    const res = await workflowRunner.runWorkflow(wf, { mockDatabase: db });
    expect(res.execution.status).toBe('SUCCEEDED');
    const out = res.nodeOutputs.get('filter_step') as { count: number };
    expect(out.count).toBe(10);
  });

  it('B-SCH-6: should reject edge with matching source and target node IDs (direct self-reference)', () => {
    const selfRefWf: WorkflowDefinition = {
      id: 'wf_self_ref',
      workspaceId: 'ws_1',
      name: 'Self Reference',
      nodes: [
        { id: 'trig', type: 'trigger.manual', data: { label: 'T', config: {} }, inputs: [], outputs: [] },
        { id: 'loop_me', type: 'primitive.map', data: { label: 'Loop', config: {} }, inputs: [], outputs: [] }
      ],
      edges: [
        { id: 'e1', source: 'trig', sourceHandle: 'main', target: 'loop_me', targetHandle: 'main' },
        { id: 'e2', source: 'loop_me', sourceHandle: 'main', target: 'loop_me', targetHandle: 'main' }
      ]
    };

    const res = cycleDetector.validateGraph(selfRefWf);
    expect(res.isValid).toBe(false);
    expect(res.errors[0]).toContain('self-loop');
  });
});
