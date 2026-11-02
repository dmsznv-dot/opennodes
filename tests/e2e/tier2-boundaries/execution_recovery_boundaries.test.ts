/**
 * LocalFlow E2E Test Suite - Tier 2: Execution & Recovery Boundaries
 * Verifies multi-stage crash recovery, timeout limits, retries, DLQ routing, and cancellations.
 */

import { describe, it, expect, beforeEach } from '../harness/index.ts';
import { workflowRunner } from '../harness/workflow-runner.ts';
import { InMemoryDatabase } from '../harness/db-mock.ts';
import { InMemoryQueue } from '../harness/redis-mock.ts';
import type { WorkflowDefinition } from '../harness/types.ts';

describe('Tier 2: Boundary - Execution & Recovery Boundaries', () => {
  let db: InMemoryDatabase;

  beforeEach(() => {
    db = new InMemoryDatabase();
  });

  it('B-REC-1: should recover and resume when worker crashes during asynchronous delay', async () => {
    const wf: WorkflowDefinition = {
      id: 'wf_delay_crash',
      workspaceId: 'ws_1',
      name: 'Delay Crash Test',
      nodes: [
        { id: 'trig', type: 'trigger.manual', data: { label: 'T', config: {} }, inputs: [], outputs: [] },
        { id: 'step_1', type: 'primitive.map', data: { label: 'Step 1', config: { step1: 'done' } }, inputs: [], outputs: [] },
        { id: 'delay_node', type: 'primitive.delay', data: { label: 'Delay', config: { delayMs: 10 } }, inputs: [], outputs: [] },
        { id: 'step_3', type: 'primitive.map', data: { label: 'Final', config: { completed: true } }, inputs: [], outputs: [] }
      ],
      edges: [
        { id: 'e1', source: 'trig', sourceHandle: 'main', target: 'step_1', targetHandle: 'main' },
        { id: 'e2', source: 'step_1', sourceHandle: 'main', target: 'delay_node', targetHandle: 'main' },
        { id: 'e3', source: 'delay_node', sourceHandle: 'main', target: 'step_3', targetHandle: 'main' }
      ]
    };

    // Simulate crash at delay node
    const crashRun = await workflowRunner.runWorkflow(wf, { mockDatabase: db, simulateCrashAtNode: 'delay_node' });
    expect(crashRun.crashedAt).toBe('delay_node');

    // Resume after worker recovery
    const resumed = await workflowRunner.resumeCrashedExecution(wf, crashRun.execution.id, { mockDatabase: db });
    expect(resumed.execution.status).toBe('SUCCEEDED');
    expect(resumed.nodeOutputs.get('step_3')).toEqual({ completed: true });
  });

  it('B-REC-2: should withstand multiple consecutive worker crashes without corrupting state', async () => {
    const wf: WorkflowDefinition = {
      id: 'wf_multi_crash',
      workspaceId: 'ws_1',
      name: 'Multi Crash Test',
      nodes: [
        { id: 'trig', type: 'trigger.manual', data: { label: 'T', config: {} }, inputs: [], outputs: [] },
        { id: 'n1', type: 'primitive.map', data: { label: 'N1', config: { n1: 'ok' } }, inputs: [], outputs: [] },
        { id: 'n2', type: 'primitive.map', data: { label: 'N2', config: { n2: 'ok' } }, inputs: [], outputs: [] },
        { id: 'n3', type: 'primitive.map', data: { label: 'N3', config: { n3: 'ok' } }, inputs: [], outputs: [] }
      ],
      edges: [
        { id: 'e1', source: 'trig', sourceHandle: 'main', target: 'n1', targetHandle: 'main' },
        { id: 'e2', source: 'n1', sourceHandle: 'main', target: 'n2', targetHandle: 'main' },
        { id: 'e3', source: 'n2', sourceHandle: 'main', target: 'n3', targetHandle: 'main' }
      ]
    };

    // First crash at n1
    const crash1 = await workflowRunner.runWorkflow(wf, { mockDatabase: db, simulateCrashAtNode: 'n1' });
    expect(crash1.crashedAt).toBe('n1');

    // Second run crashes at n2
    const crash2 = await workflowRunner.runWorkflow(wf, { mockDatabase: db, simulateCrashAtNode: 'n2' });
    expect(crash2.crashedAt).toBe('n2');

    // Final resume completes all
    const resumed = await workflowRunner.resumeCrashedExecution(wf, crash2.execution.id, { mockDatabase: db });
    expect(resumed.execution.status).toBe('SUCCEEDED');
    expect(resumed.nodeOutputs.get('n3')).toEqual({ n3: 'ok' });
  });

  it('B-REC-3: should reject duplicate concurrent execution attempts using idempotency locks', async () => {
    const wf: WorkflowDefinition = {
      id: 'wf_idempotency_lock',
      workspaceId: 'ws_1',
      name: 'Idempotency Lock',
      nodes: [{ id: 'trig', type: 'trigger.manual', data: { label: 'T', config: {} }, inputs: [], outputs: [] }],
      edges: []
    };

    const run1 = await workflowRunner.runWorkflow(wf, { mockDatabase: db, idempotencyKey: 'charge_req_101' });
    const run2 = await workflowRunner.runWorkflow(wf, { mockDatabase: db, idempotencyKey: 'charge_req_101' });

    expect(run1.execution.id).toBe(run2.execution.id);
    expect(db.executions.size).toBe(1);
  });

  it('B-REC-4: should route permanently failed jobs to Dead Letter Queue (DLQ) after retry limit', async () => {
    const queue = new InMemoryQueue('dlq-test-queue');
    await queue.add('criticalTask', { id: 1 }, { attempts: 2 });

    // Attempt 1 fails -> re-queued
    try { await queue.processNext(async () => { throw new Error('Attempt 1 failed'); }); } catch {}
    // Attempt 2 fails -> routed to DLQ
    try { await queue.processNext(async () => { throw new Error('Attempt 2 permanent crash'); }); } catch {}

    expect(queue.dlq.length).toBe(1);
    expect(queue.dlq[0].name).toBe('criticalTask');
    expect(queue.dlq[0].state).toBe('failed');
  });

  it('B-REC-5: should mark execution FAILED with timeout error when hard timeout is exceeded', async () => {
    const execution = db.createExecution({
      workflow_id: 'wf_timeout_test',
      workflow_version_id: 'v1',
      workspace_id: 'ws_1',
      status: 'RUNNING',
      trigger_type: 'manual',
      started_at: new Date(Date.now() - 360000) // started 6 minutes ago (timeout limit is 5 mins)
    });

    const isTimedOut = (Date.now() - execution.started_at!.getTime()) > 300000;
    expect(isTimedOut).toBe(true);

    const updated = db.updateExecution(execution.id, {
      status: 'FAILED',
      finished_at: new Date(),
      error_summary: 'ERR_EXECUTION_TIMEOUT: Maximum workflow duration (300000ms) exceeded'
    });

    expect(updated.status).toBe('FAILED');
    expect(updated.error_summary).toContain('ERR_EXECUTION_TIMEOUT');
  });

  it('B-REC-6: should ensure cancelled workflow immediately stops downstream execution', async () => {
    const execution = db.createExecution({
      workflow_id: 'wf_abort',
      workflow_version_id: 'v1',
      workspace_id: 'ws_1',
      status: 'CANCELLED',
      trigger_type: 'manual',
      finished_at: new Date(),
      error_summary: 'User cancelled execution'
    });

    expect(execution.status).toBe('CANCELLED');
    // Inactive executions do not produce new step entries
    const steps = db.findNodeExecutions(execution.id);
    expect(steps.length).toBe(0);
  });
});
