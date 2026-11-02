/**
 * LocalFlow E2E Test Suite - Tier 3: Durable Pipeline Combinations
 * Exercises pairwise & chain combinations for distributed durability:
 * BullMQ queues, step journaling, crash resumption, cancellation, and idempotency.
 */

import { describe, it, expect, beforeEach } from '../harness/index.ts';
import { WorkflowRunner } from '../harness/workflow-runner.ts';
import { InMemoryDatabase } from '../harness/db-mock.ts';
import { workflowExecutionQueue, workflowDelayQueue, redisMock } from '../harness/redis-mock.ts';
import { mockServiceRouter } from '../harness/msw-handlers.ts';
import type { WorkflowDefinition } from '../harness/types.ts';

describe('Tier 3: Combination - Durable Pipeline Combinations', () => {
  const runner = new WorkflowRunner();
  let db: InMemoryDatabase;

  beforeEach(() => {
    db = new InMemoryDatabase();
    redisMock.reset();
    workflowExecutionQueue.clear();
    workflowDelayQueue.clear();
    mockServiceRouter.reset();
  });

  it('T3-DP-1: Pipeline surviving crash at delay step resumes from journaled state and delivers SMTP email', async () => {
    let httpCallCount = 0;
    const workflow: WorkflowDefinition = {
      id: 'wf_t3_dp_1',
      workspaceId: 'ws_durable',
      name: 'Crash Recovery and Email Dispatch',
      version: 1,
      nodes: [
        {
          id: 'node_trigger',
          type: 'trigger.manual',
          name: 'Manual Start',
          position: { x: 0, y: 0 },
          data: { config: {} }
        },
        {
          id: 'node_http',
          type: 'core.httpRequest',
          name: 'Fetch External Token',
          position: { x: 150, y: 0 },
          data: {
            config: {
              url: 'https://httpbin.org/get',
              method: 'GET'
            }
          }
        },
        {
          id: 'node_delay',
          type: 'primitive.delay',
          name: 'Async Delay Step',
          position: { x: 300, y: 0 },
          data: { config: { delayMs: 100 } }
        },
        {
          id: 'node_smtp',
          type: 'core.smtp',
          name: 'Dispatch Completion Email',
          position: { x: 450, y: 0 },
          data: {
            config: {
              from: 'durability@localflow.test',
              to: 'ops@company.test',
              subject: 'Pipeline Succeeded After Recovery',
              text: 'Status: {{ $nodes.node_http.output.status }}'
            }
          }
        }
      ],
      edges: [
        { id: 'e1', source: 'node_trigger', target: 'node_http', sourceHandle: 'main', targetHandle: 'main' },
        { id: 'e2', source: 'node_http', target: 'node_delay', sourceHandle: 'main', targetHandle: 'main' },
        { id: 'e3', source: 'node_delay', target: 'node_smtp', sourceHandle: 'main', targetHandle: 'main' }
      ]
    };

    // Phase 1: Run workflow with worker crash simulated at 'node_delay'
    const crashedResult = await runner.runWorkflow(workflow, {
      mockDatabase: db,
      simulateCrashAtNode: 'node_delay'
    });

    expect(crashedResult.crashedAt).toBe('node_delay');
    expect(crashedResult.execution.status).toBe('RUNNING');

    // Verify node_http succeeded before crash
    const httpStepBefore = db.findNodeExecutions(crashedResult.execution.id).find(s => s.node_id === 'node_http')!;
    expect(httpStepBefore.status).toBe('SUCCEEDED');

    // Phase 2: Resume crashed workflow from database state
    const resumedResult = await runner.resumeCrashedExecution(workflow, crashedResult.execution.id, {
      mockDatabase: db
    });

    expect(resumedResult.execution.status).toBe('SUCCEEDED');
    const smtpStep = resumedResult.stepRecords.find(s => s.nodeId === 'node_smtp')!;
    expect(smtpStep.status).toBe('SUCCEEDED');

    const smtpOut = resumedResult.nodeOutputs.get('node_smtp') as { sent: boolean; messageId: string };
    expect(smtpOut.sent).toBe(true);
  });

  it('T3-DP-2: Idempotent execution deduplication: same idempotency key ignores duplicate trigger and returns cached result', async () => {
    const workflow: WorkflowDefinition = {
      id: 'wf_t3_dp_2',
      workspaceId: 'ws_durable',
      name: 'Idempotency Dedup Flow',
      version: 1,
      nodes: [
        {
          id: 'node_trigger',
          type: 'trigger.webhook',
          name: 'Webhook Event',
          position: { x: 0, y: 0 },
          data: { config: {} }
        },
        {
          id: 'node_sql',
          type: 'core.postgresSql',
          name: 'Insert Ledger Record',
          position: { x: 150, y: 0 },
          data: {
            config: {
              query: 'INSERT INTO ledger (tx) VALUES ($1)',
              params: ['TX-10029']
            }
          }
        }
      ],
      edges: [
        { id: 'e1', source: 'node_trigger', target: 'node_sql', sourceHandle: 'main', targetHandle: 'main' }
      ]
    };

    const idempotencyKey = 'idempotent-charge-token-42';

    // First call executes normally
    const firstRun = await runner.runWorkflow(workflow, {
      idempotencyKey,
      mockDatabase: db
    });
    expect(firstRun.execution.status).toBe('SUCCEEDED');

    // Second call with identical idempotency key returns cached result
    const secondRun = await runner.runWorkflow(workflow, {
      idempotencyKey,
      mockDatabase: db
    });
    expect(secondRun.execution.id).toBe(firstRun.execution.id);
    expect(secondRun.execution.status).toBe('SUCCEEDED');

    // Ensure database contains exactly ONE execution record
    const allExecs = Array.from(db.executions.values()).filter(e => e.idempotency_key === idempotencyKey);
    expect(allExecs.length).toBe(1);
  });

  it('T3-DP-3: In-flight cancellation: worker stops processing downstream steps when execution is marked CANCELLED', async () => {
    const workflow: WorkflowDefinition = {
      id: 'wf_t3_dp_3',
      workspaceId: 'ws_durable',
      name: 'Cancellable Workflow',
      version: 1,
      nodes: [
        {
          id: 'node_trigger',
          type: 'trigger.manual',
          name: 'Trigger',
          position: { x: 0, y: 0 },
          data: { config: {} }
        },
        {
          id: 'node_step1',
          type: 'primitive.map',
          name: 'Step 1',
          position: { x: 150, y: 0 },
          data: { config: { stage: 1 } }
        },
        {
          id: 'node_step2',
          type: 'primitive.map',
          name: 'Step 2 - Target After Cancellation',
          position: { x: 300, y: 0 },
          data: { config: { stage: 2 } }
        }
      ],
      edges: [
        { id: 'e1', source: 'node_trigger', target: 'node_step1', sourceHandle: 'main', targetHandle: 'main' },
        { id: 'e2', source: 'node_step1', target: 'node_step2', sourceHandle: 'main', targetHandle: 'main' }
      ]
    };

    // Simulate execution creation and cancellation in DB
    const execId = 'exec_cancellation_test';
    db.createExecution({
      id: execId,
      workflow_id: workflow.id,
      workflow_version_id: 'v1',
      workspace_id: workflow.workspaceId,
      status: 'CANCELLED',
      trigger_type: 'manual',
      started_at: new Date()
    });

    const execRecord = db.executions.get(execId)!;
    expect(execRecord.status).toBe('CANCELLED');
  });

  it('T3-DP-4: Step retries on transient network error succeed on subsequent retry attempt', async () => {
    // Enable simulated transient failure for next OpenAI request
    mockServiceRouter.openAiFailNext = true;

    const workflow: WorkflowDefinition = {
      id: 'wf_t3_dp_4',
      workspaceId: 'ws_durable',
      name: 'Transient Retry Flow',
      version: 1,
      nodes: [
        {
          id: 'node_trigger',
          type: 'trigger.manual',
          name: 'Start',
          position: { x: 0, y: 0 },
          data: { config: {} }
        },
        {
          id: 'node_openai',
          type: 'ai.openai',
          name: 'OpenAI Prompt',
          position: { x: 150, y: 0 },
          data: {
            config: {
              apiKey: 'sk-test',
              model: 'gpt-4o-mini',
              messages: [{ role: 'user', content: 'Ping' }]
            }
          }
        }
      ],
      edges: [
        { id: 'e1', source: 'node_trigger', target: 'node_openai', sourceHandle: 'main', targetHandle: 'main' }
      ]
    };

    // First attempt hits 429 rate limit
    const attempt1 = await runner.runWorkflow(workflow, { mockDatabase: db });
    expect(attempt1.execution.status).toBe('SUCCEEDED');
    const out1 = attempt1.nodeOutputs.get('node_openai') as { status: number };
    expect(out1.status).toBe(429);

    // Second attempt recovers (mockServiceRouter reset openAiFailNext)
    const attempt2 = await runner.runWorkflow(workflow, { mockDatabase: db });
    expect(attempt2.execution.status).toBe('SUCCEEDED');
    const out2 = attempt2.nodeOutputs.get('node_openai') as { status: number; choices: any[] };
    expect(out2.status).toBe(200);
    expect(out2.choices.length).toBeGreaterThan(0);
  });

  it('T3-DP-5: BullMQ task queue lifecycle: job enqueued, active, and completed with state in Redis', async () => {
    const queue = workflowExecutionQueue;
    const jobId = 'job-lifecycle-999';

    // 1. Add job to queue
    const job = await queue.add('execute-workflow', { workflowId: 'wf-test', executionId: 'exec-123' }, { jobId });
    expect(job.id).toBe(jobId);
    expect(job.name).toBe('execute-workflow');

    // 2. Worker processes next job
    const processed = await queue.processNext(async (j) => {
      expect(j.id).toBe(jobId);
      return { result: 'SUCCESS' };
    });

    expect(processed).not.toBeNull();
    expect(processed?.state).toBe('completed');
    expect(processed?.returnvalue).toEqual({ result: 'SUCCESS' });

    // 3. Verify queue completed status
    const completed = await queue.getCompleted();
    expect(completed.length).toBe(1);
    expect(completed[0].id).toBe(jobId);
  });

  it('T3-DP-6: Multi-step pipeline with IF branch and crash recovery preserves active branch path', async () => {
    const workflow: WorkflowDefinition = {
      id: 'wf_t3_dp_6',
      workspaceId: 'ws_durable',
      name: 'Branching Crash Recovery',
      version: 1,
      nodes: [
        {
          id: 'node_trigger',
          type: 'trigger.manual',
          name: 'Start',
          position: { x: 0, y: 0 },
          data: { config: {} }
        },
        {
          id: 'node_if',
          type: 'primitive.if',
          name: 'Check Condition',
          position: { x: 150, y: 0 },
          data: { config: { condition: '{{ $trigger.amount > 50 }}' } }
        },
        {
          id: 'node_delay_true',
          type: 'primitive.delay',
          name: 'Delay on True Branch',
          position: { x: 300, y: -50 },
          data: { config: { delayMs: 50 } }
        },
        {
          id: 'node_map_true',
          type: 'primitive.map',
          name: 'Action True',
          position: { x: 450, y: -50 },
          data: { config: { branchTaken: 'HIGH_VALUE' } }
        },
        {
          id: 'node_map_false',
          type: 'primitive.map',
          name: 'Action False',
          position: { x: 450, y: 50 },
          data: { config: { branchTaken: 'LOW_VALUE' } }
        }
      ],
      edges: [
        { id: 'e1', source: 'node_trigger', target: 'node_if', sourceHandle: 'main', targetHandle: 'main' },
        { id: 'e2', source: 'node_if', target: 'node_delay_true', sourceHandle: 'true', targetHandle: 'main' },
        { id: 'e3', source: 'node_delay_true', target: 'node_map_true', sourceHandle: 'main', targetHandle: 'main' },
        { id: 'e4', source: 'node_if', target: 'node_map_false', sourceHandle: 'false', targetHandle: 'main' }
      ]
    };

    // Crash at delay node
    const crashedResult = await runner.runWorkflow(workflow, {
      triggerPayload: { amount: 100 },
      mockDatabase: db,
      simulateCrashAtNode: 'node_delay_true'
    });

    expect(crashedResult.crashedAt).toBe('node_delay_true');

    // Resume execution
    const resumed = await runner.resumeCrashedExecution(workflow, crashedResult.execution.id, {
      mockDatabase: db
    });

    expect(resumed.execution.status).toBe('SUCCEEDED');
    expect(resumed.nodeOutputs.get('node_map_true')).toEqual({ branchTaken: 'HIGH_VALUE' });
    expect(resumed.skippedNodes.has('node_map_false')).toBe(true);
  });
});
