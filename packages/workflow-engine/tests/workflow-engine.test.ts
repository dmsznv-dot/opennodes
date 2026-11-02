import { describe, it, expect } from 'vitest';
import {
  ExpressionEvaluator,
  ExpressionEvaluationError,
  defaultPrimitiveRegistry,
  WorkflowEngine,
  InMemoryExecutionJournal,
  InMemoryQueueManager,
  buildResumptionState,
  SimpleCancellationToken,
} from '../src/index.js';
import type { WorkflowDefinition } from '@localflow/workflow-schema';

describe('@localflow/workflow-engine', () => {
  describe('ExpressionEvaluator (F09)', () => {
    const evaluator = new ExpressionEvaluator();

    it('interpolates templates and preserves native types for single expressions', () => {
      const scope = {
        $trigger: {
          user: { name: 'Alice', role: 'admin' },
          order: { amount: 250, items: ['laptop', 'mouse'] },
          temperature: -15.5,
        },
        $nodes: {
          http_fetch: { output: { data: { rate: 1.15 } } },
        },
      };

      expect(
        evaluator.evaluate(
          'User: {{ $trigger.user.name }} (Role: {{ $trigger.user.role }})',
          scope
        )
      ).toBe('User: Alice (Role: admin)');

      expect(evaluator.evaluate('{{ $nodes.http_fetch.output.data.rate }}', scope)).toBe(
        1.15
      );
      expect(evaluator.evaluate('{{ $trigger.order.amount > 100 }}', scope)).toBe(true);
      expect(evaluator.evaluate('{{ $trigger.user.role === "admin" }}', scope)).toBe(
        true
      );
      expect(
        evaluator.evaluate(
          '{{ $trigger.order.amount >= 200 ? "VIP" : "Standard" }}',
          scope
        )
      ).toBe('VIP');
      expect(evaluator.evaluate('{{ $trigger.order.items[0] }}', scope)).toBe('laptop');
      expect(evaluator.evaluate('{{ $trigger.temperature }}', scope)).toBe(-15.5);
    });

    it('returns undefined on deep missing properties without throwing', () => {
      expect(
        evaluator.evaluate('{{ $trigger.nonExistent.deep.prop }}', { $trigger: {} })
      ).toBeUndefined();
    });

    it('blocks prototype pollution and dangerous identifiers', () => {
      expect(() => evaluator.evaluate('{{ process.exit(1) }}', {})).toThrow(
        ExpressionEvaluationError
      );
      expect(() => evaluator.evaluate('{{ __proto__.polluted = true }}', {})).toThrow(
        ExpressionEvaluationError
      );
      expect(() => evaluator.evaluate('{{ constructor.prototype }}', {})).toThrow(
        ExpressionEvaluationError
      );
      expect(() => evaluator.evaluate('{{ $trigger.__proto__ }}', { $trigger: {} })).toThrow(
        ExpressionEvaluationError
      );
    });
  });

  describe('Graph Primitives (F14-F19)', () => {
    const evaluator = new ExpressionEvaluator();
    const baseCtx = {
      executionId: 'exec-1',
      nodeId: 'node-1',
      workspaceId: 'ws-1',
      nodeOutputs: new Map<string, unknown>(),
      incomingEdges: [],
      evaluateExpression: (expr: string, localScope?: Record<string, unknown>) =>
        evaluator.evaluate(expr, { ...localScope }),
    };

    it('executes branchIf / if primitive (F14)', async () => {
      const prim = defaultPrimitiveRegistry.get('primitive.if')!;
      const resTrue = await prim.execute({ condition: true }, baseCtx);
      expect(resTrue.activeHandles).toEqual(['true']);
      expect(resTrue.output).toEqual({ conditionResult: true });

      const resFalse = await prim.execute({ condition: 0 }, baseCtx);
      expect(resFalse.activeHandles).toEqual(['false']);
      expect(resFalse.output).toEqual({ conditionResult: false });
    });

    it('executes filter primitive (F15)', async () => {
      const prim = defaultPrimitiveRegistry.get('primitive.filter')!;
      const res = await prim.execute(
        { items: [10, 60, 30, 80], predicate: '{{ $item >= 50 }}' },
        baseCtx
      );
      expect(res.output).toEqual({
        passed: [60, 80],
        discarded: [10, 30],
        count: 2,
      });
    });

    it('executes map primitive (F16)', async () => {
      const prim = defaultPrimitiveRegistry.get('primitive.map')!;
      const res = await prim.execute(
        { transform: { doubled: 42, flag: true } },
        baseCtx
      );
      expect(res.output).toEqual({ doubled: 42, flag: true });
    });

    it('executes delay primitive (F17)', async () => {
      const prim = defaultPrimitiveRegistry.get('primitive.delay')!;
      const res = await prim.execute({ delayMs: 5 }, baseCtx);
      expect((res.output as any).delayedMs).toBe(5);
      expect(typeof (res.output as any).resumedAt).toBe('string');
    });

    it('executes forEach primitive (F18)', async () => {
      const prim = defaultPrimitiveRegistry.get('primitive.forEach')!;
      const res = await prim.execute({ items: ['a', 'b'] }, baseCtx);
      expect(res.output).toEqual({
        items: [
          { item: 'a', index: 0, processed: true },
          { item: 'b', index: 1, processed: true },
        ],
        total: 2,
      });
    });

    it('executes merge primitive (F19)', async () => {
      const prim = defaultPrimitiveRegistry.get('primitive.merge')!;
      const outputs = new Map<string, unknown>([
        ['n1', { val: 1 }],
        ['n2', { val: 2 }],
      ]);
      const res = await prim.execute(
        {},
        {
          ...baseCtx,
          nodeOutputs: outputs,
          incomingEdges: [
            { id: 'e1', source: 'n1', sourceHandle: 'main', target: 'm', targetHandle: 'main' },
            { id: 'e2', source: 'n2', sourceHandle: 'main', target: 'm', targetHandle: 'main' },
            { id: 'e3', source: 'n_skipped', sourceHandle: 'main', target: 'm', targetHandle: 'main' },
          ],
        }
      );
      expect(res.output).toEqual({
        merged: [{ val: 1 }, { val: 2 }],
        count: 2,
      });
    });
  });

  describe('WorkflowEngine, Journaling & Crash Recovery (F10, F11, F12, F13)', () => {
    const sampleWorkflow: WorkflowDefinition = {
      id: '00000000-0000-4000-8000-000000000001',
      workspaceId: '00000000-0000-4000-8000-000000000002',
      name: 'Branching & Merge Workflow',
      schemaVersion: '1.0',
      executionPolicy: { executionTimeoutMs: 300_000, maxConcurrency: 5 },
      nodes: [
        {
          id: 'trig',
          type: 'trigger.manual',
          data: { label: 'Trigger', config: {} },
          inputs: [],
          outputs: [{ id: 'main', name: 'Out', type: 'any', direction: 'output', required: false }],
        },
        {
          id: 'branch',
          type: 'primitive.if',
          data: {
            label: 'Check Amount',
            config: { condition: '{{ $trigger.amount > 100 }}' },
          },
          inputs: [{ id: 'main', name: 'In', type: 'any', direction: 'input', required: false }],
          outputs: [
            { id: 'true', name: 'True', type: 'any', direction: 'output', required: false },
            { id: 'false', name: 'False', type: 'any', direction: 'output', required: false },
          ],
        },
        {
          id: 'high_step',
          type: 'primitive.map',
          data: {
            label: 'High Value',
            config: { transform: { tier: 'high', secretToken: 'super-secret-value' } },
          },
          inputs: [{ id: 'main', name: 'In', type: 'any', direction: 'input', required: false }],
          outputs: [{ id: 'main', name: 'Out', type: 'any', direction: 'output', required: false }],
        },
        {
          id: 'low_step',
          type: 'primitive.map',
          data: {
            label: 'Low Value',
            config: { transform: { tier: 'low' } },
          },
          inputs: [{ id: 'main', name: 'In', type: 'any', direction: 'input', required: false }],
          outputs: [{ id: 'main', name: 'Out', type: 'any', direction: 'output', required: false }],
        },
      ],
      edges: [
        { id: 'e1', source: 'trig', sourceHandle: 'main', target: 'branch', targetHandle: 'main' },
        { id: 'e2', source: 'branch', sourceHandle: 'true', target: 'high_step', targetHandle: 'main' },
        { id: 'e3', source: 'branch', sourceHandle: 'false', target: 'low_step', targetHandle: 'main' },
      ],
    };

    it('executes DAG, skips unselected branch, and redacts secrets in journal', async () => {
      const journal = new InMemoryExecutionJournal();
      const engine = new WorkflowEngine({ journal });

      const result = await engine.executeWorkflow(sampleWorkflow, {
        triggerPayload: { amount: 250 },
      });

      expect(result.execution.status).toBe('SUCCEEDED');
      expect(result.skippedNodes.has('low_step')).toBe(true);
      expect(result.nodeOutputs.get('high_step')).toEqual({
        tier: 'high',
        secretToken: 'super-secret-value',
      });

      const highStepJournal = await journal.findNodeExecution(
        result.execution.id,
        'high_step'
      );
      expect((highStepJournal?.outputPayload as any).secretToken).toBe('[REDACTED]');
    });

    it('recovers from simulated crash without re-executing completed steps', async () => {
      const journal = new InMemoryExecutionJournal();
      let sideEffectCalls = 0;
      const engine = new WorkflowEngine({
        journal,
        nodeExecutors: {
          'custom.sideEffect': {
            execute: async () => {
              sideEffectCalls++;
              return { output: { charged: true } };
            },
          },
        },
      });

      const wf: WorkflowDefinition = {
        id: '00000000-0000-4000-8000-000000000010',
        workspaceId: '00000000-0000-4000-8000-000000000002',
        name: 'Crash Test',
        schemaVersion: '1.0',
        executionPolicy: { executionTimeoutMs: 300_000, maxConcurrency: 5 },
        nodes: [
          {
            id: 'step_charge',
            type: 'custom.sideEffect',
            data: { label: 'Charge Card', config: {} },
            inputs: [],
            outputs: [{ id: 'main', name: 'Out', type: 'any', direction: 'output', required: false }],
          },
          {
            id: 'step_notify',
            type: 'primitive.map',
            data: {
              label: 'Notify',
              config: { transform: { ok: '{{ $nodes.step_charge.output.charged }}' } },
            },
            inputs: [{ id: 'main', name: 'In', type: 'any', direction: 'input', required: false }],
            outputs: [{ id: 'main', name: 'Out', type: 'any', direction: 'output', required: false }],
          },
        ],
        edges: [
          {
            id: 'e1',
            source: 'step_charge',
            sourceHandle: 'main',
            target: 'step_notify',
            targetHandle: 'main',
          },
        ],
      };

      const crashRun = await engine.executeWorkflow(wf, {
        simulateCrashAtNode: 'step_notify',
      });
      expect(crashRun.crashedAt).toBe('step_notify');
      expect(sideEffectCalls).toBe(1);

      const resumeState = await buildResumptionState(crashRun.execution.id, journal);
      expect(resumeState.completedNodeIds.has('step_charge')).toBe(true);

      const resumedRun = await engine.executeWorkflow(wf, {
        resumeFromExecutionId: crashRun.execution.id,
        cachedNodeOutputs: resumeState.cachedOutputs,
        completedNodeIds: resumeState.completedNodeIds,
      });

      expect(resumedRun.execution.status).toBe('SUCCEEDED');
      expect(sideEffectCalls).toBe(1); // Not re-executed!
      expect(resumedRun.nodeOutputs.get('step_notify')).toEqual({ ok: true });
    });

    it('supports cancellation token and in-memory queue lifecycle', async () => {
      const token = new SimpleCancellationToken();
      token.cancel('Aborted by test');
      const engine = new WorkflowEngine();
      const res = await engine.executeWorkflow(sampleWorkflow, {
        cancellationToken: token,
      });
      expect(res.execution.status).toBe('CANCELLED');

      const qm = new InMemoryQueueManager();
      const job = await qm.executionProducer.add(
        'runWorkflow',
        {
          executionId: 'exec-q-1',
          workflowId: sampleWorkflow.id,
          workflowVersionId: 'v1',
          workspaceId: sampleWorkflow.workspaceId,
          triggerType: 'manual',
          enqueuedAt: Date.now(),
        },
        { jobId: 'exec-q-1', attempts: 2 }
      );
      expect(job.state).toBe('waiting');
    });
  });
});
