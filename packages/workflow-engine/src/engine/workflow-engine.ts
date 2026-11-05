import { randomUUID } from 'node:crypto';
import type { WorkflowDefinition, WorkflowNode } from '@localflow/workflow-schema';
import type { SafeHttpClient } from '@localflow/shared';
import { ExpressionEvaluator } from '../expressions/evaluator.js';
import { defaultPrimitiveRegistry, type PrimitiveRegistry } from '../primitives/registry.js';
import type { ExecutionJournal } from '../persistence/execution-journal.js';
import { InMemoryExecutionJournal } from '../persistence/in-memory-journal.js';
import { ExecutionContext, type CancellationToken } from './execution-context.js';
import { TopologicalScheduler } from './topological-scheduler.js';
import { EdgeResolver } from './edge-resolver.js';
import type { NodeExecutor, StepLogger } from './node-executor.js';
import { NodeExecutorRegistry } from './node-executor-registry.js';
import { ExecutionSuspendedSignal, ExecutionTimeoutError, UnknownNodeTypeError } from './errors.js';

export interface WorkflowEngineOptions {
  journal?: ExecutionJournal;
  nodeExecutors?: Record<string, NodeExecutor>;
  primitiveRegistry?: PrimitiveRegistry;
  defaultTimeoutMs?: number;
  env?: Record<string, string>;
  httpClient?: SafeHttpClient;
  /**
   * Fail steps whose type has no executor, primitive or trigger handler instead of
   * echoing their config as output. Production runtimes must enable this: otherwise
   * an unknown connector step is reported as SUCCEEDED without doing anything.
   */
  strictNodeTypes?: boolean;
}

export interface WorkflowRunOptions {
  executionId?: string;
  triggerType?: string;
  triggerPayload?: unknown;
  idempotencyKey?: string;
  workflowVersionId?: string;
  credentials?: Record<string, unknown>;
  allowedFsRoot?: string;
  cancellationToken?: CancellationToken;
  journal?: ExecutionJournal;
  timeoutMs?: number;
  resumeFromExecutionId?: string;
  cachedNodeOutputs?: ReadonlyMap<string, unknown>;
  completedNodeIds?: ReadonlySet<string>;
  /** Output handles each completed node activated, so branches resume correctly. */
  completedNodePorts?: ReadonlyMap<string, readonly string[]>;
  simulateCrashAtNode?: string;
}

export interface WorkflowExecutionSummary {
  id: string;
  workflowId: string;
  workflowVersionId: string;
  workspaceId: string;
  status: 'QUEUED' | 'RUNNING' | 'WAITING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED';
  triggerType: string;
  triggerPayload?: unknown;
  idempotencyKey?: string;
  startedAt?: Date;
  finishedAt?: Date;
  durationMs?: number;
  errorMessage?: string;
  errorNodeId?: string;
  retryCount?: number;
}

export interface StepExecutionRecord {
  id: string;
  executionId: string;
  nodeId: string;
  nodeType: string;
  nodeName?: string;
  status: 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'SKIPPED' | 'CANCELLED';
  startedAt?: Date;
  completedAt?: Date;
  durationMs?: number;
  inputPayload?: unknown;
  outputPayload?: unknown;
  errorMessage?: string;
  errorDetails?: Record<string, unknown>;
  retryCount: number;
}

export interface WorkflowRunResult {
  execution: WorkflowExecutionSummary;
  stepRecords: StepExecutionRecord[];
  nodeOutputs: Map<string, unknown>;
  skippedNodes: Set<string>;
  durationMs: number;
  crashedAt?: string;
  /** Set when a step paused the run (status WAITING); resume at `resumeAt`. */
  suspension?: { nodeId: string; resumeAt: Date };
}

export class WorkflowEngine {
  private readonly defaultJournal: ExecutionJournal;
  private readonly executorRegistry = new NodeExecutorRegistry();
  private readonly primitiveRegistry: PrimitiveRegistry;
  private readonly expressionEvaluator = new ExpressionEvaluator();
  private readonly scheduler = new TopologicalScheduler();
  private readonly edgeResolver = new EdgeResolver();
  private readonly defaultTimeoutMs: number;
  private readonly env: Record<string, string>;
  private readonly httpClient?: SafeHttpClient;
  private readonly strictNodeTypes: boolean;

  constructor(options: WorkflowEngineOptions = {}) {
    this.defaultJournal = options.journal ?? new InMemoryExecutionJournal();
    this.primitiveRegistry = options.primitiveRegistry ?? defaultPrimitiveRegistry;
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? 300_000;
    this.env = options.env ?? {};
    this.httpClient = options.httpClient;
    this.strictNodeTypes = options.strictNodeTypes ?? false;

    if (options.nodeExecutors) {
      for (const [type, executor] of Object.entries(options.nodeExecutors)) {
        this.executorRegistry.register(type, executor);
      }
    }
  }

  registerExecutor(nodeType: string, executor: NodeExecutor): void {
    this.executorRegistry.register(nodeType, executor);
  }

  async executeWorkflow(
    workflow: WorkflowDefinition,
    options: WorkflowRunOptions = {}
  ): Promise<WorkflowRunResult> {
    const journal = options.journal ?? this.defaultJournal;
    const workflowVersionId = options.workflowVersionId ?? randomUUID();
    const triggerType = options.triggerType ?? 'manual';
    const timeoutMs =
      options.timeoutMs ?? workflow.executionPolicy?.executionTimeoutMs ?? this.defaultTimeoutMs;

    // 1. Idempotency check
    if (options.idempotencyKey && !options.resumeFromExecutionId) {
      const existing = await journal.findExecutionByIdempotencyKey(
        workflow.workspaceId,
        workflow.id,
        options.idempotencyKey
      );
      if (existing) {
        const existingNodes = await journal.findNodeExecutions(existing.id);
        const outputs = new Map<string, unknown>();
        const skipped = new Set<string>();
        const steps: StepExecutionRecord[] = existingNodes.map((n) => {
          if (n.status === 'SUCCEEDED' && n.outputPayload !== undefined) {
            outputs.set(n.nodeId, n.outputPayload);
          }
          if (n.status === 'SKIPPED') {
            skipped.add(n.nodeId);
          }
          return {
            id: n.id,
            executionId: n.executionId,
            nodeId: n.nodeId,
            nodeType: n.nodeType,
            nodeName: n.nodeName ?? undefined,
            status: n.status,
            startedAt: n.startedAt ?? undefined,
            completedAt: n.finishedAt ?? undefined,
            durationMs: n.durationMs ?? undefined,
            inputPayload: n.inputPayload,
            outputPayload: n.outputPayload,
            errorMessage: n.errorMessage ?? undefined,
            errorDetails: n.errorDetails ?? undefined,
            retryCount: n.retryCount,
          };
        });
        return {
          execution: {
            id: existing.id,
            workflowId: existing.workflowId,
            workflowVersionId: existing.workflowVersionId,
            workspaceId: existing.workspaceId,
            status: existing.status,
            triggerType: existing.triggerType,
            triggerPayload: existing.triggerPayload,
            idempotencyKey: existing.idempotencyKey ?? undefined,
            startedAt: existing.startedAt ?? undefined,
            finishedAt: existing.finishedAt ?? undefined,
            durationMs: existing.durationMs ?? undefined,
            errorMessage: existing.errorMessage ?? undefined,
            errorNodeId: existing.errorNodeId ?? undefined,
            retryCount: existing.retryCount,
          },
          stepRecords: steps,
          nodeOutputs: outputs,
          skippedNodes: skipped,
          durationMs: existing.durationMs ?? 0,
        };
      }
    }

    // 2. Topological sort & cycle check
    const orderedNodes = this.scheduler.schedule(workflow.nodes, workflow.edges);

    const startWall = Date.now();
    const executionId = options.resumeFromExecutionId ?? options.executionId ?? randomUUID();

    // 3. Create or transition Execution row in journal
    let execRecord = await journal.findExecutionById(executionId);
    if (!execRecord) {
      execRecord = await journal.createExecution({
        id: executionId,
        workspaceId: workflow.workspaceId,
        workflowId: workflow.id,
        workflowVersionId,
        status: 'QUEUED',
        triggerType,
        triggerPayload: options.triggerPayload,
        idempotencyKey: options.idempotencyKey,
        startedAt: new Date(startWall),
      });
    }

    execRecord = await journal.updateExecution(executionId, {
      status: 'RUNNING',
      startedAt: execRecord.startedAt ?? new Date(startWall),
    });

    await journal.createEvent({
      executionId,
      eventType: 'execution:started',
      payload: { workflowId: workflow.id, triggerType },
    });

    const context = new ExecutionContext({
      executionId,
      workflowId: workflow.id,
      workflowVersionId,
      workspaceId: workflow.workspaceId,
      triggerPayload: options.triggerPayload,
      triggerType,
      idempotencyKey: options.idempotencyKey,
      env: this.env,
      cancellationToken: options.cancellationToken,
      initialNodeOutputs: options.cachedNodeOutputs,
    });

    const stepRecords: StepExecutionRecord[] = [];
    const completedIds = options.completedNodeIds ?? new Set<string>();

    for (const node of orderedNodes) {
      // Check timeout
      const elapsed = Date.now() - startWall;
      if (elapsed > timeoutMs) {
        const timeoutErr = new ExecutionTimeoutError(executionId, timeoutMs);
        const finishedAt = new Date();
        execRecord = await journal.updateExecution(executionId, {
          status: 'FAILED',
          finishedAt,
          durationMs: elapsed,
          errorMessage: timeoutErr.message,
          errorNodeId: node.id,
        });
        await journal.createEvent({
          executionId,
          eventType: 'execution:failed',
          nodeId: node.id,
          payload: { error: timeoutErr.message },
        });
        return {
          execution: this.mapExecutionSummary(execRecord),
          stepRecords,
          nodeOutputs: context.nodeOutputs,
          skippedNodes: context.skippedNodes,
          durationMs: elapsed,
        };
      }

      // Check cancellation
      if (options.cancellationToken?.isCancelled) {
        const cancelMsg = options.cancellationToken.reason ?? 'User requested cancellation';
        const finishedAt = new Date();
        const durationMs = Date.now() - startWall;
        execRecord = await journal.updateExecution(executionId, {
          status: 'CANCELLED',
          finishedAt,
          durationMs,
          errorMessage: cancelMsg,
        });
        await journal.createEvent({
          executionId,
          eventType: 'execution:cancelled',
          payload: { reason: cancelMsg },
        });
        return {
          execution: this.mapExecutionSummary(execRecord),
          stepRecords,
          nodeOutputs: context.nodeOutputs,
          skippedNodes: context.skippedNodes,
          durationMs,
        };
      }

      // Skip already-completed step during crash resumption
      if (completedIds.has(node.id)) {
        const cachedOut = context.getNodeOutput(node.id);
        context.setActivePorts(node.id, [
          ...(options.completedNodePorts?.get(node.id) ?? ['main']),
        ]);
        stepRecords.push({
          id: randomUUID(),
          executionId,
          nodeId: node.id,
          nodeType: node.type,
          nodeName: node.data.label,
          status: 'SUCCEEDED',
          outputPayload: cachedOut,
          durationMs: 0,
          retryCount: 0,
        });
        continue;
      }

      // Check edge dependency / branch skip
      const shouldRun = this.edgeResolver.shouldExecuteNode(node, workflow.edges, context);

      // On resume a node may already have a journal row (interrupted, waiting or skipped);
      // reuse it so a run never lists the same step twice.
      const priorRow = options.resumeFromExecutionId
        ? await journal.findNodeExecution(executionId, node.id)
        : undefined;

      if (!shouldRun) {
        context.markSkipped(node.id);
        const now = new Date();
        const skippedDb =
          priorRow ??
          (await journal.createNodeExecution({
            executionId,
            nodeId: node.id,
            nodeType: node.type,
            nodeName: node.data.label,
            status: 'SKIPPED',
            startedAt: now,
            finishedAt: now,
            durationMs: 0,
          }));
        stepRecords.push({
          id: skippedDb.id,
          executionId,
          nodeId: node.id,
          nodeType: node.type,
          nodeName: node.data.label,
          status: 'SKIPPED',
          startedAt: now,
          completedAt: now,
          durationMs: 0,
          retryCount: 0,
        });
        continue;
      }

      // A switched-off step is passed over: it does nothing and the flow continues.
      if (node.data.disabled) {
        context.setActivePorts(
          node.id,
          node.outputs.length ? node.outputs.map((o) => o.id) : ['main']
        );
        const now = new Date();
        const disabledDb =
          priorRow ??
          (await journal.createNodeExecution({
            executionId,
            nodeId: node.id,
            nodeType: node.type,
            nodeName: node.data.label,
            status: 'SKIPPED',
            outputPayload: { disabled: true },
            startedAt: now,
            finishedAt: now,
            durationMs: 0,
          }));
        stepRecords.push({
          id: disabledDb.id,
          executionId,
          nodeId: node.id,
          nodeType: node.type,
          nodeName: node.data.label,
          status: 'SKIPPED',
          outputPayload: { disabled: true },
          startedAt: now,
          completedAt: now,
          durationMs: 0,
          retryCount: 0,
        });
        continue;
      }

      // Evaluate node config expressions
      const scope = context.buildExpressionScope();
      let evaluatedConfig: Record<string, unknown>;
      try {
        evaluatedConfig = this.expressionEvaluator.evaluateObject(node.data.config ?? {}, scope);
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err);
        const now = new Date();
        const failedStep = await journal.createNodeExecution({
          executionId,
          nodeId: node.id,
          nodeType: node.type,
          nodeName: node.data.label,
          status: 'FAILED',
          inputPayload: node.data.config,
          startedAt: now,
          finishedAt: now,
          durationMs: 0,
        });
        await journal.updateNodeExecution(failedStep.id, {
          status: 'FAILED',
          errorMessage: errMsg,
          finishedAt: now,
          durationMs: 0,
        });
        stepRecords.push({
          id: failedStep.id,
          executionId,
          nodeId: node.id,
          nodeType: node.type,
          nodeName: node.data.label,
          status: 'FAILED',
          startedAt: now,
          completedAt: now,
          durationMs: 0,
          errorMessage: errMsg,
          retryCount: 0,
        });

        const totalDuration = Date.now() - startWall;
        execRecord = await journal.updateExecution(executionId, {
          status: 'FAILED',
          finishedAt: now,
          durationMs: totalDuration,
          errorMessage: errMsg,
          errorNodeId: node.id,
        });
        await journal.createEvent({
          executionId,
          eventType: 'execution:failed',
          nodeId: node.id,
          payload: { error: errMsg },
        });
        return {
          execution: this.mapExecutionSummary(execRecord),
          stepRecords,
          nodeOutputs: context.nodeOutputs,
          skippedNodes: context.skippedNodes,
          durationMs: totalDuration,
        };
      }

      context.setNodeInput(node.id, evaluatedConfig);
      const stepStartWall = Date.now();
      const stepStartDate = new Date(stepStartWall);

      const nodeExecRow = priorRow
        ? await journal.updateNodeExecution(priorRow.id, { status: 'RUNNING' })
        : await journal.createNodeExecution({
            executionId,
            nodeId: node.id,
            nodeType: node.type,
            nodeName: node.data.label,
            status: 'RUNNING',
            inputPayload: evaluatedConfig,
            startedAt: stepStartDate,
          });

      await journal.createEvent({
        executionId,
        eventType: 'node:started',
        nodeId: node.id,
        payload: { nodeType: node.type },
      });

      // Simulated crash mid-step for crash recovery testing
      if (options.simulateCrashAtNode === node.id) {
        return {
          execution: this.mapExecutionSummary(execRecord),
          stepRecords: [
            ...stepRecords,
            {
              id: nodeExecRow.id,
              executionId,
              nodeId: node.id,
              nodeType: node.type,
              nodeName: node.data.label,
              status: 'RUNNING',
              startedAt: stepStartDate,
              inputPayload: evaluatedConfig,
              retryCount: 0,
            },
          ],
          nodeOutputs: context.nodeOutputs,
          skippedNodes: context.skippedNodes,
          durationMs: Date.now() - startWall,
          crashedAt: node.id,
        };
      }

      const maxRetries = node.data.executionPolicy?.maxRetries ?? 0;
      const continueOnError = node.data.executionPolicy?.continueOnError ?? false;
      let attempt = 0;
      let stepSucceeded = false;
      let lastError: unknown;
      let output: unknown;
      let activeHandles: string[] = ['main'];
      let suspended: ExecutionSuspendedSignal | undefined;

      while (attempt <= maxRetries) {
        try {
          const result = await this.invokeNode(
            node,
            evaluatedConfig,
            workflow,
            context,
            journal,
            nodeExecRow.id,
            options
          );
          output = result.output;
          activeHandles = result.activeHandles;
          stepSucceeded = true;
          break;
        } catch (err: unknown) {
          if (err instanceof ExecutionSuspendedSignal) {
            suspended = err;
            break;
          }
          lastError = err;
          attempt++;
          if (attempt <= maxRetries) {
            await journal.updateNodeExecution(nodeExecRow.id, {
              retryCount: attempt,
            });
          }
        }
      }

      if (suspended) {
        const resumeAt = suspended.resumeAt;
        const waitingRow = await journal.updateNodeExecution(nodeExecRow.id, {
          status: 'PENDING',
          outputPayload: { ...suspended.details, waitingUntil: resumeAt.toISOString() },
        });
        execRecord = await journal.updateExecution(executionId, {
          status: 'WAITING',
          metadata: { resumeAt: resumeAt.toISOString(), waitingNodeId: node.id },
        });
        await journal.createEvent({
          executionId,
          eventType: 'execution:waiting',
          nodeId: node.id,
          payload: { resumeAt: resumeAt.toISOString() },
        });
        stepRecords.push({
          id: waitingRow.id,
          executionId,
          nodeId: node.id,
          nodeType: node.type,
          nodeName: node.data.label,
          status: 'PENDING',
          startedAt: stepStartDate,
          outputPayload: waitingRow.outputPayload,
          retryCount: 0,
        });
        return {
          execution: this.mapExecutionSummary(execRecord),
          stepRecords,
          nodeOutputs: context.nodeOutputs,
          skippedNodes: context.skippedNodes,
          durationMs: Date.now() - startWall,
          suspension: { nodeId: node.id, resumeAt },
        };
      }

      const stepFinishWall = Date.now();
      const stepFinishDate = new Date(stepFinishWall);
      const stepDurationMs = Math.max(0, stepFinishWall - stepStartWall);

      if (stepSucceeded) {
        context.setNodeOutput(node.id, output);
        context.setActivePorts(node.id, activeHandles);

        const updatedNodeRow = await journal.updateNodeExecution(nodeExecRow.id, {
          status: 'SUCCEEDED',
          outputPayload: output,
          finishedAt: stepFinishDate,
          durationMs: stepDurationMs,
          retryCount: attempt,
        });

        await journal.createEvent({
          executionId,
          eventType: 'node:finished',
          nodeId: node.id,
          payload: { status: 'SUCCEEDED', durationMs: stepDurationMs, activeHandles },
        });

        stepRecords.push({
          id: updatedNodeRow.id,
          executionId,
          nodeId: node.id,
          nodeType: node.type,
          nodeName: node.data.label,
          status: 'SUCCEEDED',
          startedAt: stepStartDate,
          completedAt: stepFinishDate,
          durationMs: stepDurationMs,
          inputPayload: updatedNodeRow.inputPayload,
          outputPayload: updatedNodeRow.outputPayload,
          retryCount: attempt,
        });
      } else {
        const errMsg = lastError instanceof Error ? lastError.message : String(lastError);
        const errCode =
          lastError &&
          typeof lastError === 'object' &&
          'code' in lastError &&
          typeof (lastError as { code?: unknown }).code === 'string'
            ? (lastError as { code: string }).code
            : undefined;
        const fullErrSummary =
          errCode && !errMsg.includes(errCode) ? `${errCode}: ${errMsg}` : errMsg;

        const updatedNodeRow = await journal.updateNodeExecution(nodeExecRow.id, {
          status: 'FAILED',
          errorMessage: fullErrSummary,
          errorDetails: { code: errCode, message: errMsg },
          finishedAt: stepFinishDate,
          durationMs: stepDurationMs,
          retryCount: Math.max(0, attempt - 1),
        });

        await journal.createEvent({
          executionId,
          eventType: 'node:finished',
          nodeId: node.id,
          payload: { status: 'FAILED', error: fullErrSummary },
        });

        stepRecords.push({
          id: updatedNodeRow.id,
          executionId,
          nodeId: node.id,
          nodeType: node.type,
          nodeName: node.data.label,
          status: 'FAILED',
          startedAt: stepStartDate,
          completedAt: stepFinishDate,
          durationMs: stepDurationMs,
          inputPayload: updatedNodeRow.inputPayload,
          errorMessage: fullErrSummary,
          retryCount: Math.max(0, attempt - 1),
        });

        if (!continueOnError) {
          const totalDuration = Date.now() - startWall;
          execRecord = await journal.updateExecution(executionId, {
            status: 'FAILED',
            finishedAt: stepFinishDate,
            durationMs: totalDuration,
            errorMessage: fullErrSummary,
            errorNodeId: node.id,
          });
          await journal.createEvent({
            executionId,
            eventType: 'execution:failed',
            nodeId: node.id,
            payload: { error: fullErrSummary, nodeId: node.id },
          });
          return {
            execution: this.mapExecutionSummary(execRecord),
            stepRecords,
            nodeOutputs: context.nodeOutputs,
            skippedNodes: context.skippedNodes,
            durationMs: totalDuration,
          };
        } else {
          context.setNodeOutput(node.id, { error: fullErrSummary });
          context.setActivePorts(node.id, ['main', 'error']);
        }
      }
    }

    const finishWall = Date.now();
    const totalDuration = Math.max(0, finishWall - startWall);
    execRecord = await journal.updateExecution(executionId, {
      status: 'SUCCEEDED',
      finishedAt: new Date(finishWall),
      durationMs: totalDuration,
    });

    await journal.createEvent({
      executionId,
      eventType: 'execution:succeeded',
      payload: { durationMs: totalDuration },
    });

    return {
      execution: this.mapExecutionSummary(execRecord),
      stepRecords,
      nodeOutputs: context.nodeOutputs,
      skippedNodes: context.skippedNodes,
      durationMs: totalDuration,
    };
  }

  private async invokeNode(
    node: WorkflowNode,
    evaluatedConfig: Record<string, unknown>,
    workflow: WorkflowDefinition,
    context: ExecutionContext,
    journal: ExecutionJournal,
    nodeExecutionId: string,
    options: WorkflowRunOptions
  ): Promise<{ output: unknown; activeHandles: string[] }> {
    const stepLogger: StepLogger = {
      info: (msg, meta) => {
        void journal.createLog({
          executionId: context.executionId,
          nodeExecutionId,
          nodeId: node.id,
          level: 'info',
          message: msg,
          metadata: meta,
        });
      },
      warn: (msg, meta) => {
        void journal.createLog({
          executionId: context.executionId,
          nodeExecutionId,
          nodeId: node.id,
          level: 'warn',
          message: msg,
          metadata: meta,
        });
      },
      error: (msg, meta) => {
        void journal.createLog({
          executionId: context.executionId,
          nodeExecutionId,
          nodeId: node.id,
          level: 'error',
          message: msg,
          metadata: meta,
        });
      },
      debug: (msg, meta) => {
        void journal.createLog({
          executionId: context.executionId,
          nodeExecutionId,
          nodeId: node.id,
          level: 'debug',
          message: msg,
          metadata: meta,
        });
      },
    };

    // 1. Check custom NodeExecutorRegistry
    const customExecutor = this.executorRegistry.get(node.type);
    if (customExecutor) {
      const res = await customExecutor.execute(node, evaluatedConfig, {
        executionId: context.executionId,
        workspaceId: context.workspaceId,
        workflowId: context.workflowId,
        nodeId: node.id,
        nodeType: node.type,
        triggerType: context.triggerType,
        credentials: options.credentials,
        fsRoot: options.allowedFsRoot,
        logger: stepLogger,
        httpClient: this.httpClient,
        expressionScope: context.buildExpressionScope(),
        cancellationToken: options.cancellationToken,
      });
      return {
        output: res.output,
        activeHandles: res.activeOutputs ?? ['main'],
      };
    }

    // 2. Check Primitives Registry
    const primitive = this.primitiveRegistry.get(node.type);
    if (primitive) {
      const incomingEdges = this.edgeResolver.getIncomingEdges(node.id, workflow.edges);
      const rawConfig =
        node.type === 'primitive.filter' ||
        node.type === 'primitive.branchIf' ||
        node.type === 'primitive.if'
          ? {
              ...(node.data.config ?? {}),
              ...evaluatedConfig,
              predicate: node.data.config?.predicate,
            }
          : evaluatedConfig;

      const primResult = await primitive.execute(rawConfig, {
        executionId: context.executionId,
        nodeId: node.id,
        workspaceId: context.workspaceId,
        nodeOutputs: context.nodeOutputs,
        incomingEdges,
        evaluateExpression: (expr, localScope) =>
          this.expressionEvaluator.evaluate(expr, context.buildExpressionScope(localScope)),
        logger: stepLogger,
      });
      return {
        output: primResult.output,
        activeHandles: primResult.activeHandles,
      };
    }

    // 3. Built-in Trigger pass-through
    if (node.type.startsWith('trigger.')) {
      return {
        output: {
          triggered: true,
          triggerType: node.type,
          payload: context.triggerPayload,
          ...evaluatedConfig,
        },
        activeHandles: ['main'],
      };
    }

    // 4. Default pass-through for generic test steps (never in strict runtimes)
    if (this.strictNodeTypes) {
      throw new UnknownNodeTypeError(node.type);
    }
    return {
      output: { ...evaluatedConfig },
      activeHandles: ['main'],
    };
  }

  private mapExecutionSummary(record: {
    id: string;
    workflowId: string;
    workflowVersionId: string;
    workspaceId: string;
    status: 'QUEUED' | 'RUNNING' | 'WAITING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED';
    triggerType: string;
    triggerPayload?: unknown;
    idempotencyKey?: string | null;
    startedAt?: Date | null;
    finishedAt?: Date | null;
    durationMs?: number | null;
    errorMessage?: string | null;
    errorNodeId?: string | null;
    retryCount: number;
  }): WorkflowExecutionSummary {
    return {
      id: record.id,
      workflowId: record.workflowId,
      workflowVersionId: record.workflowVersionId,
      workspaceId: record.workspaceId,
      status: record.status,
      triggerType: record.triggerType,
      triggerPayload: record.triggerPayload,
      idempotencyKey: record.idempotencyKey ?? undefined,
      startedAt: record.startedAt ?? undefined,
      finishedAt: record.finishedAt ?? undefined,
      durationMs: record.durationMs ?? undefined,
      errorMessage: record.errorMessage ?? undefined,
      errorNodeId: record.errorNodeId ?? undefined,
      retryCount: record.retryCount,
    };
  }
}
