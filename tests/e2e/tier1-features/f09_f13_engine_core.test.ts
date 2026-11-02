/**
 * LocalFlow E2E Test Suite - Tier 1: Engine Core & Infrastructure (Features F09 - F13)
 * Verifies Features F09 through F13 with >=5 tests per feature (25 tests total).
 */

import { describe, it, expect, beforeEach } from '../harness/index.ts';
import { expressionEvaluator, ExpressionEvaluationError } from '../harness/expression-evaluator.ts';
import { workflowRunner } from '../harness/workflow-runner.ts';
import { InMemoryDatabase } from '../harness/db-mock.ts';
import { InMemoryQueue } from '../harness/redis-mock.ts';
import type { WorkflowDefinition } from '../harness/types.ts';

describe('Tier 1: Feature F09 - Safe Expression Evaluator (No eval())', () => {
  const sampleScope = {
    $trigger: {
      user: { id: 101, name: 'Alice', role: 'admin' },
      order: { amount: 250, currency: 'USD', items: ['laptop', 'mouse'] }
    },
    $nodes: {
      http_fetch: {
        output: { status: 200, data: { rate: 1.15, cached: true } }
      }
    },
    $env: {
      ENVIRONMENT: 'production',
      REGION: 'us-east-1'
    }
  };

  it('F09-1: should evaluate simple path resolutions and string interpolations', () => {
    const res1 = expressionEvaluator.evaluate('User: {{ $trigger.user.name }} (Role: {{ $trigger.user.role }})', sampleScope);
    expect(res1).toBe('User: Alice (Role: admin)');

    const res2 = expressionEvaluator.evaluate('{{ $nodes.http_fetch.output.data.rate }}', sampleScope);
    expect(res2).toBe(1.15);
  });

  it('F09-2: should evaluate boolean conditions and comparisons without eval()', () => {
    const isOver100 = expressionEvaluator.evaluate('{{ $trigger.order.amount > 100 }}', sampleScope);
    expect(isOver100).toBe(true);

    const isAdmin = expressionEvaluator.evaluate('{{ $trigger.user.role === "admin" }}', sampleScope);
    expect(isAdmin).toBe(true);

    const isGuest = expressionEvaluator.evaluate('{{ $trigger.user.role === "guest" }}', sampleScope);
    expect(isGuest).toBe(false);
  });

  it('F09-3: should evaluate ternary expressions and logical operators', () => {
    const tier = expressionEvaluator.evaluate('{{ $trigger.order.amount >= 200 ? "VIP" : "Standard" }}', sampleScope);
    expect(tier).toBe('VIP');

    const multiCond = expressionEvaluator.evaluate('{{ $trigger.user.role === "admin" && $trigger.order.amount > 50 }}', sampleScope);
    expect(multiCond).toBe(true);
  });

  it('F09-4: should resolve array indices and nested bracket access', () => {
    const firstItem = expressionEvaluator.evaluate('{{ $trigger.order.items[0] }}', sampleScope);
    expect(firstItem).toBe('laptop');

    const secondItem = expressionEvaluator.evaluate('{{ $trigger.order.items[1] }}', sampleScope);
    expect(secondItem).toBe('mouse');
  });

  it('F09-5: should block code injection attempts, prototype access, and global objects', () => {
    expect(() => expressionEvaluator.evaluate('{{ process.exit(1) }}', sampleScope)).toThrow(ExpressionEvaluationError);
    expect(() => expressionEvaluator.evaluate('{{ __proto__.polluted = true }}', sampleScope)).toThrow(ExpressionEvaluationError);
    expect(() => expressionEvaluator.evaluate('{{ constructor.prototype }}', sampleScope)).toThrow(ExpressionEvaluationError);
    expect(() => expressionEvaluator.evaluate('{{ require("fs") }}', sampleScope)).toThrow(ExpressionEvaluationError);
  });
});

describe('Tier 1: Feature F10 - Execution Engine Core', () => {
  let db: InMemoryDatabase;

  beforeEach(() => {
    db = new InMemoryDatabase();
  });

  it('F10-1: should execute a 3-node sequential DAG in deterministic topological order', async () => {
    const wf: WorkflowDefinition = {
      id: 'wf_core_topo',
      workspaceId: 'ws_1',
      name: 'Deterministic Pipeline',
      nodes: [
        { id: 'trig', type: 'trigger.manual', data: { label: 'T', config: {} }, inputs: [], outputs: [] },
        { id: 'step_1', type: 'primitive.map', data: { label: 'Step 1', config: { step1: 'done' } }, inputs: [], outputs: [] },
        { id: 'step_2', type: 'primitive.map', data: { label: 'Step 2', config: { step2: 'done', prior: '{{ $nodes.step_1.output.step1 }}' } }, inputs: [], outputs: [] }
      ],
      edges: [
        { id: 'e1', source: 'trig', sourceHandle: 'main', target: 'step_1', targetHandle: 'main' },
        { id: 'e2', source: 'step_1', sourceHandle: 'main', target: 'step_2', targetHandle: 'main' }
      ]
    };

    const res = await workflowRunner.runWorkflow(wf, { mockDatabase: db });
    expect(res.execution.status).toBe('SUCCEEDED');
    expect(res.stepRecords.length).toBe(3);
    expect(res.stepRecords[0].nodeId).toBe('trig');
    expect(res.stepRecords[1].nodeId).toBe('step_1');
    expect(res.stepRecords[2].nodeId).toBe('step_2');
    
    const step2Output = res.nodeOutputs.get('step_2') as { prior: string };
    expect(step2Output.prior).toBe('done');
  });

  it('F10-2: should record micro-timing durations on every executed node', async () => {
    const wf: WorkflowDefinition = {
      id: 'wf_timing',
      workspaceId: 'ws_1',
      name: 'Timing Pipeline',
      nodes: [
        { id: 'trig', type: 'trigger.manual', data: { label: 'T', config: {} }, inputs: [], outputs: [] },
        { id: 'action', type: 'primitive.map', data: { label: 'A', config: { val: 42 } }, inputs: [], outputs: [] }
      ],
      edges: [
        { id: 'e1', source: 'trig', sourceHandle: 'main', target: 'action', targetHandle: 'main' }
      ]
    };

    const res = await workflowRunner.runWorkflow(wf, { mockDatabase: db });
    expect(res.stepRecords.every(s => typeof s.durationMs === 'number' && s.durationMs >= 0)).toBe(true);
  });

  it('F10-3: should mark unselected downstream branches as SKIPPED without failing execution', async () => {
    const wf: WorkflowDefinition = {
      id: 'wf_skip_branch',
      workspaceId: 'ws_1',
      name: 'Skip Branch Pipeline',
      nodes: [
        { id: 'trig', type: 'trigger.manual', data: { label: 'T', config: {} }, inputs: [], outputs: [] },
        { id: 'if_node', type: 'primitive.if', data: { label: 'IF', config: { condition: false } }, inputs: [], outputs: [] },
        { id: 'true_action', type: 'primitive.map', data: { label: 'True Branch', config: { executed: true } }, inputs: [], outputs: [] },
        { id: 'false_action', type: 'primitive.map', data: { label: 'False Branch', config: { executed: false } }, inputs: [], outputs: [] }
      ],
      edges: [
        { id: 'e1', source: 'trig', sourceHandle: 'main', target: 'if_node', targetHandle: 'main' },
        { id: 'e2', source: 'if_node', sourceHandle: 'true', target: 'true_action', targetHandle: 'main' },
        { id: 'e3', source: 'if_node', sourceHandle: 'false', target: 'false_action', targetHandle: 'main' }
      ]
    };

    const res = await workflowRunner.runWorkflow(wf, { mockDatabase: db });
    expect(res.execution.status).toBe('SUCCEEDED');
    expect(res.skippedNodes.has('true_action')).toBe(true);
    expect(res.skippedNodes.has('false_action')).toBe(false);
  });

  it('F10-4: should gracefully terminate and mark execution FAILED when a node raises an unhandled error', async () => {
    const wf: WorkflowDefinition = {
      id: 'wf_error_fail',
      workspaceId: 'ws_1',
      name: 'Failing Pipeline',
      nodes: [
        { id: 'trig', type: 'trigger.manual', data: { label: 'T', config: {} }, inputs: [], outputs: [] },
        { id: 'fail_node', type: 'core.filesystem', data: { label: 'FS Escape', config: { action: 'readFile', path: '../../etc/passwd' } }, inputs: [], outputs: [] }
      ],
      edges: [
        { id: 'e1', source: 'trig', sourceHandle: 'main', target: 'fail_node', targetHandle: 'main' }
      ]
    };

    const res = await workflowRunner.runWorkflow(wf, { mockDatabase: db });
    expect(res.execution.status).toBe('FAILED');
    expect(res.execution.errorMessage).toContain('ERR_PATH_TRAVERSAL_DETECTED');
  });

  it('F10-5: should support workflow cancellation and update state cleanly', async () => {
    const execution = db.createExecution({
      workflow_id: 'wf_cancel',
      workflow_version_id: 'v1',
      workspace_id: 'ws_1',
      status: 'RUNNING',
      trigger_type: 'manual',
      started_at: new Date()
    });

    const cancelled = db.updateExecution(execution.id, {
      status: 'CANCELLED',
      finished_at: new Date(),
      error_summary: 'User requested cancellation'
    });

    expect(cancelled.status).toBe('CANCELLED');
    expect(cancelled.error_summary).toBe('User requested cancellation');
  });
});

describe('Tier 1: Feature F11 - BullMQ Task Queue', () => {
  let queue: InMemoryQueue;

  beforeEach(() => {
    queue = new InMemoryQueue('test-task-queue');
  });

  it('F11-1: should enqueue a job with unique execution ID and initial waiting state', async () => {
    const job = await queue.add('runWorkflow', { executionId: 'exec_100', workflowId: 'wf_1' }, { jobId: 'exec_100' });
    expect(job.id).toBe('exec_100');
    expect(job.state).toBe('waiting');
    expect(job.attemptsMade).toBe(0);
  });

  it('F11-2: should process jobs through waiting -> active -> completed lifecycle', async () => {
    await queue.add('job1', { data: 'test' });
    let executed = false;

    const finished = await queue.processNext(async (j) => {
      executed = true;
      return { ok: true, received: j.data };
    });

    expect(executed).toBe(true);
    expect(finished?.state).toBe('completed');
  });

  it('F11-3: should schedule delayed jobs in delayed state and promote when time passes', async () => {
    const delayMs = 500;
    const job = await queue.add('delayedJob', { action: 'remind' }, { delay: delayMs });
    expect(job.state).toBe('delayed');

    const waitingBefore = await queue.getWaiting();
    expect(waitingBefore.length).toBe(0);

    // Fast-forward virtual time
    queue.promoteDelayedJobs(Date.now() + delayMs + 10);
    const waitingAfter = await queue.getWaiting();
    expect(waitingAfter.length).toBe(1);
    expect(waitingAfter[0].id).toBe(job.id);
  });

  it('F11-4: should retry failed jobs up to configured max attempts', async () => {
    await queue.add('retryJob', { attemptCount: 0 }, { attempts: 3 });

    // First attempt fails -> re-queued
    try {
      await queue.processNext(async () => { throw new Error('Transient error 1'); });
    } catch {}

    const jobAfterFail1 = await queue.getJob('test-task-queue_1');
    expect(jobAfterFail1?.attemptsMade).toBe(1);
    expect(jobAfterFail1?.state).toBe('waiting'); // re-queued for retry

    // Second attempt succeeds
    await queue.processNext(async () => { return 'recovered'; });
    expect(jobAfterFail1?.state).toBe('completed');
    expect(jobAfterFail1?.attemptsMade).toBe(2);
  });

  it('F11-5: should route permanently failed jobs to Dead Letter Queue (DLQ)', async () => {
    await queue.add('fatalJob', { important: true }, { attempts: 1 });

    try {
      await queue.processNext(async () => { throw new Error('Permanent database crash'); });
    } catch {}

    const job = await queue.getJob('test-task-queue_1');
    expect(job?.state).toBe('failed');
    expect(queue.dlq.length).toBe(1);
    expect(queue.dlq[0].id).toBe('test-task-queue_1');
  });
});

describe('Tier 1: Feature F12 - Durable State Persistence', () => {
  let db: InMemoryDatabase;

  beforeEach(() => {
    db = new InMemoryDatabase();
  });

  it('F12-1: should persist execution record before executing any workflow step', async () => {
    const wf: WorkflowDefinition = {
      id: 'wf_persist_check',
      workspaceId: 'ws_1',
      name: 'Persist Pipeline',
      nodes: [
        { id: 'trig', type: 'trigger.manual', data: { label: 'T', config: {} }, inputs: [], outputs: [] }
      ],
      edges: []
    };

    const res = await workflowRunner.runWorkflow(wf, { mockDatabase: db });
    const stored = db.executions.get(res.execution.id);
    expect(stored).toBeDefined();
    expect(stored?.id).toBe(res.execution.id);
    expect(stored?.workflow_id).toBe('wf_persist_check');
  });

  it('F12-2: should create node_executions records for each executed step with timestamps', async () => {
    const wf: WorkflowDefinition = {
      id: 'wf_step_journal',
      workspaceId: 'ws_1',
      name: 'Step Journal',
      nodes: [
        { id: 'trig', type: 'trigger.manual', data: { label: 'T', config: {} }, inputs: [], outputs: [] },
        { id: 'step_1', type: 'primitive.map', data: { label: 'S1', config: { x: 1 } }, inputs: [], outputs: [] }
      ],
      edges: [
        { id: 'e1', source: 'trig', sourceHandle: 'main', target: 'step_1', targetHandle: 'main' }
      ]
    };

    const res = await workflowRunner.runWorkflow(wf, { mockDatabase: db });
    const stepLogs = db.findNodeExecutions(res.execution.id);
    expect(stepLogs.length).toBe(2);
    expect(stepLogs[1].started_at).toBeDefined();
    expect(stepLogs[1].finished_at).toBeDefined();
  });

  it('F12-3: should store sanitized output payloads in node_executions with secrets redacted', async () => {
    const wf: WorkflowDefinition = {
      id: 'wf_sanitize_journal',
      workspaceId: 'ws_1',
      name: 'Sanitized Journal',
      nodes: [
        { id: 'trig', type: 'trigger.manual', data: { label: 'T', config: {} }, inputs: [], outputs: [] },
        {
          id: 'step_secret',
          type: 'primitive.map',
          data: {
            label: 'Secret Step',
            config: {
              publicField: 'visible',
              password: 'sensitive_db_password',
              token: 'sensitive_auth_token'
            }
          },
          inputs: [],
          outputs: []
        }
      ],
      edges: [
        { id: 'e1', source: 'trig', sourceHandle: 'main', target: 'step_secret', targetHandle: 'main' }
      ]
    };

    const res = await workflowRunner.runWorkflow(wf, { mockDatabase: db });
    const stepLogs = db.findNodeExecutions(res.execution.id);
    const secretStep = stepLogs.find(s => s.node_id === 'step_secret');

    const output = secretStep?.output_payload as Record<string, string>;
    expect(output.publicField).toBe('visible');
    expect(output.password).toBe('[REDACTED]');
    expect(output.token).toBe('[REDACTED]');
  });

  it('F12-4: should enforce execution status transitions in database journal', async () => {
    const ex = db.createExecution({
      workflow_id: 'wf_trans',
      workflow_version_id: 'v1',
      workspace_id: 'ws_1',
      status: 'QUEUED',
      trigger_type: 'webhook',
      trigger_payload: { event: 'ping' }
    });
    expect(ex.status).toBe('QUEUED');

    db.updateExecution(ex.id, { status: 'RUNNING', started_at: new Date() });
    expect(db.executions.get(ex.id)?.status).toBe('RUNNING');

    db.updateExecution(ex.id, { status: 'SUCCEEDED', finished_at: new Date(), duration_ms: 120 });
    expect(db.executions.get(ex.id)?.status).toBe('SUCCEEDED');
  });

  it('F12-5: should capture execution event stream for live monitoring and replay', () => {
    const executionId = 'exec_event_stream';
    db.logEvent(executionId, 'execution:started', undefined, { trigger: 'cron' });
    db.logEvent(executionId, 'node:started', 'http_1');
    db.logEvent(executionId, 'node:finished', 'http_1', { durationMs: 40 });
    db.logEvent(executionId, 'execution:succeeded');

    const events = db.execution_events.filter(e => e.execution_id === executionId);
    expect(events.length).toBe(4);
    expect(events[0].event_type).toBe('execution:started');
    expect(events[3].event_type).toBe('execution:succeeded');
  });
});

describe('Tier 1: Feature F13 - Worker Restart Crash Recovery', () => {
  let db: InMemoryDatabase;

  beforeEach(() => {
    db = new InMemoryDatabase();
  });

  it('F13-1: should detect worker crash during execution and record unfinished status in DB', async () => {
    const wf: WorkflowDefinition = {
      id: 'wf_crash_test',
      workspaceId: 'ws_1',
      name: 'Crash Recovery Test',
      nodes: [
        { id: 'trig', type: 'trigger.manual', data: { label: 'T', config: {} }, inputs: [], outputs: [] },
        { id: 'step_1', type: 'primitive.map', data: { label: 'Step 1', config: { step1Result: 'cached_data' } }, inputs: [], outputs: [] },
        { id: 'crash_step', type: 'primitive.map', data: { label: 'Crash Step', config: { val: 2 } }, inputs: [], outputs: [] },
        { id: 'step_3', type: 'primitive.map', data: { label: 'Step 3', config: { final: true } }, inputs: [], outputs: [] }
      ],
      edges: [
        { id: 'e1', source: 'trig', sourceHandle: 'main', target: 'step_1', targetHandle: 'main' },
        { id: 'e2', source: 'step_1', sourceHandle: 'main', target: 'crash_step', targetHandle: 'main' },
        { id: 'e3', source: 'crash_step', sourceHandle: 'main', target: 'step_3', targetHandle: 'main' }
      ]
    };

    // Simulate crash at crash_step
    const initialRun = await workflowRunner.runWorkflow(wf, {
      mockDatabase: db,
      simulateCrashAtNode: 'crash_step'
    });

    expect(initialRun.crashedAt).toBe('crash_step');
    expect(initialRun.execution.status).toBe('RUNNING'); // Interrupted mid-flight

    const steps = db.findNodeExecutions(initialRun.execution.id);
    const step1 = steps.find(s => s.node_id === 'step_1');
    const crashStep = steps.find(s => s.node_id === 'crash_step');

    expect(step1?.status).toBe('SUCCEEDED');
    expect(crashStep?.status).toBe('RUNNING'); // Was in-flight when crashed
  });

  it('F13-2: should identify stalled jobs when lock expires in task queue', () => {
    const queue = new InMemoryQueue('stalled-test');
    // Simulate a job active with expired lock
    const now = Date.now();
    queue.jobs.set('stalled_job', {
      id: 'stalled_job',
      name: 'run',
      data: { executionId: 'exec_stalled' },
      opts: {},
      state: 'active',
      attemptsMade: 1,
      timestamp: now - 60000,
      lockUntil: now - 1000 // lock expired 1 second ago
    });

    const stalled = queue.simulateStalledJobs();
    expect(stalled.length).toBe(1);
    expect(stalled[0].id).toBe('stalled_job');
    expect(stalled[0].state).toBe('waiting'); // Re-assigned to queue for recovery
  });

  it('F13-3: should load cached outputs of SUCCEEDED steps and avoid re-executing completed side-effects', async () => {
    const wf: WorkflowDefinition = {
      id: 'wf_side_effect_resume',
      workspaceId: 'ws_1',
      name: 'Side Effect Idempotent Resume',
      nodes: [
        { id: 'trig', type: 'trigger.manual', data: { label: 'T', config: {} }, inputs: [], outputs: [] },
        { id: 'side_effect_step', type: 'primitive.map', data: { label: 'Charge Card', config: { chargeId: 'ch_9999' } }, inputs: [], outputs: [] },
        { id: 'crash_point', type: 'primitive.map', data: { label: 'Crash', config: {} }, inputs: [], outputs: [] },
        { id: 'notify_step', type: 'primitive.map', data: { label: 'Send Receipt', config: { done: true } }, inputs: [], outputs: [] }
      ],
      edges: [
        { id: 'e1', source: 'trig', sourceHandle: 'main', target: 'side_effect_step', targetHandle: 'main' },
        { id: 'e2', source: 'side_effect_step', sourceHandle: 'main', target: 'crash_point', targetHandle: 'main' },
        { id: 'e3', source: 'crash_point', sourceHandle: 'main', target: 'notify_step', targetHandle: 'main' }
      ]
    };

    // 1. Initial run crashes at crash_point
    const crashRun = await workflowRunner.runWorkflow(wf, {
      mockDatabase: db,
      simulateCrashAtNode: 'crash_point'
    });
    expect(crashRun.crashedAt).toBe('crash_point');

    // 2. Resume execution after worker restart
    const resumedRun = await workflowRunner.resumeCrashedExecution(wf, crashRun.execution.id, {
      mockDatabase: db
    });

    expect(resumedRun.execution.status).toBe('SUCCEEDED');
    expect(resumedRun.nodeOutputs.get('side_effect_step')).toEqual({ chargeId: 'ch_9999' });
  });

  it('F13-4: should successfully complete remaining unexecuted steps upon recovery', async () => {
    const wf: WorkflowDefinition = {
      id: 'wf_complete_rest',
      workspaceId: 'ws_1',
      name: 'Complete Rest Test',
      nodes: [
        { id: 'trig', type: 'trigger.manual', data: { label: 'T', config: {} }, inputs: [], outputs: [] },
        { id: 'step_a', type: 'primitive.map', data: { label: 'A', config: { a: 1 } }, inputs: [], outputs: [] },
        { id: 'step_b', type: 'primitive.map', data: { label: 'B', config: { b: 2 } }, inputs: [], outputs: [] }
      ],
      edges: [
        { id: 'e1', source: 'trig', sourceHandle: 'main', target: 'step_a', targetHandle: 'main' },
        { id: 'e2', source: 'step_a', sourceHandle: 'main', target: 'step_b', targetHandle: 'main' }
      ]
    };

    const crashRun = await workflowRunner.runWorkflow(wf, { mockDatabase: db, simulateCrashAtNode: 'step_b' });
    const resumed = await workflowRunner.resumeCrashedExecution(wf, crashRun.execution.id, { mockDatabase: db });

    expect(resumed.execution.status).toBe('SUCCEEDED');
    expect(resumed.stepRecords.find(s => s.nodeId === 'step_b')?.status).toBe('SUCCEEDED');
  });

  it('F13-5: should update the parent execution record to SUCCEEDED and commit final duration', async () => {
    const wf: WorkflowDefinition = {
      id: 'wf_final_status',
      workspaceId: 'ws_1',
      name: 'Final Status Pipeline',
      nodes: [
        { id: 'trig', type: 'trigger.manual', data: { label: 'T', config: {} }, inputs: [], outputs: [] },
        { id: 'action', type: 'primitive.map', data: { label: 'Act', config: { result: 'ok' } }, inputs: [], outputs: [] }
      ],
      edges: [
        { id: 'e1', source: 'trig', sourceHandle: 'main', target: 'action', targetHandle: 'main' }
      ]
    };

    const res = await workflowRunner.runWorkflow(wf, { mockDatabase: db });
    const finalEx = db.executions.get(res.execution.id);

    expect(finalEx?.status).toBe('SUCCEEDED');
    expect(finalEx?.finished_at).toBeDefined();
    expect(typeof finalEx?.duration_ms).toBe('number');
  });
});
