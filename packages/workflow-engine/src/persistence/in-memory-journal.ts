import { randomUUID } from 'node:crypto';
import { redact, redactString } from '@localflow/observability';
import type {
  CreateEventParams,
  CreateExecutionParams,
  CreateLogParams,
  CreateNodeExecutionParams,
  ExecutionJournal,
  JournalEventRecord,
  JournalExecutionRecord,
  JournalNodeExecutionRecord,
  UpdateExecutionParams,
  UpdateNodeExecutionParams,
} from './execution-journal.js';

export class InMemoryExecutionJournal implements ExecutionJournal {
  private readonly executionsMap = new Map<string, JournalExecutionRecord>();
  private readonly nodeExecutionsMap = new Map<string, JournalNodeExecutionRecord>();
  private readonly eventsList: JournalEventRecord[] = [];
  private readonly logsList: Array<CreateLogParams & { id: string; timestamp: Date }> = [];

  async findExecutionById(executionId: string): Promise<JournalExecutionRecord | undefined> {
    return this.executionsMap.get(executionId);
  }

  async findExecutionByIdempotencyKey(
    workspaceId: string,
    workflowId: string,
    idempotencyKey: string
  ): Promise<JournalExecutionRecord | undefined> {
    for (const exec of this.executionsMap.values()) {
      if (
        exec.workspaceId === workspaceId &&
        exec.workflowId === workflowId &&
        exec.idempotencyKey === idempotencyKey
      ) {
        return exec;
      }
    }
    return undefined;
  }

  async createExecution(params: CreateExecutionParams): Promise<JournalExecutionRecord> {
    const now = new Date();
    const record: JournalExecutionRecord = {
      id: params.id ?? randomUUID(),
      workspaceId: params.workspaceId,
      workflowId: params.workflowId,
      workflowVersionId: params.workflowVersionId,
      status: params.status,
      triggerType: params.triggerType,
      triggerPayload:
        params.triggerPayload !== undefined ? redact(params.triggerPayload) : undefined,
      idempotencyKey: params.idempotencyKey ?? null,
      startedAt: params.startedAt ?? now,
      finishedAt: null,
      durationMs: null,
      errorMessage: null,
      errorNodeId: null,
      retryCount: 0,
      metadata: params.metadata
        ? (redact(params.metadata) as Record<string, unknown>)
        : null,
      createdAt: now,
      updatedAt: now,
    };
    this.executionsMap.set(record.id, record);
    return { ...record };
  }

  async updateExecution(
    executionId: string,
    params: UpdateExecutionParams
  ): Promise<JournalExecutionRecord> {
    const existing = this.executionsMap.get(executionId);
    if (!existing) {
      throw new Error(`Execution "${executionId}" not found in journal`);
    }
    const updated: JournalExecutionRecord = {
      ...existing,
      ...(params.status ? { status: params.status } : {}),
      ...(params.startedAt ? { startedAt: params.startedAt } : {}),
      ...(params.finishedAt ? { finishedAt: params.finishedAt } : {}),
      ...(params.durationMs !== undefined ? { durationMs: params.durationMs } : {}),
      ...(params.errorMessage !== undefined
        ? { errorMessage: redactString(params.errorMessage) }
        : {}),
      ...(params.errorNodeId !== undefined ? { errorNodeId: params.errorNodeId } : {}),
      ...(params.retryCount !== undefined ? { retryCount: params.retryCount } : {}),
      ...(params.metadata !== undefined
        ? { metadata: redact(params.metadata) as Record<string, unknown> }
        : {}),
      updatedAt: new Date(),
    };
    this.executionsMap.set(executionId, updated);
    return { ...updated };
  }

  async findNodeExecutions(executionId: string): Promise<JournalNodeExecutionRecord[]> {
    const res: JournalNodeExecutionRecord[] = [];
    for (const nodeExec of this.nodeExecutionsMap.values()) {
      if (nodeExec.executionId === executionId) {
        res.push({ ...nodeExec });
      }
    }
    return res;
  }

  async findNodeExecution(
    executionId: string,
    nodeId: string
  ): Promise<JournalNodeExecutionRecord | undefined> {
    for (const nodeExec of this.nodeExecutionsMap.values()) {
      if (nodeExec.executionId === executionId && nodeExec.nodeId === nodeId) {
        return { ...nodeExec };
      }
    }
    return undefined;
  }

  async createNodeExecution(
    params: CreateNodeExecutionParams
  ): Promise<JournalNodeExecutionRecord> {
    const now = new Date();
    const record: JournalNodeExecutionRecord = {
      id: params.id ?? randomUUID(),
      executionId: params.executionId,
      nodeId: params.nodeId,
      nodeType: params.nodeType,
      nodeName: params.nodeName ?? null,
      status: params.status,
      retryCount: params.retryCount ?? 0,
      inputPayload: params.inputPayload !== undefined ? redact(params.inputPayload) : undefined,
      outputPayload:
        params.outputPayload !== undefined ? redact(params.outputPayload) : undefined,
      errorDetails: null,
      errorMessage: null,
      startedAt: params.startedAt ?? now,
      finishedAt: params.finishedAt ?? null,
      durationMs: params.durationMs ?? null,
      createdAt: now,
      updatedAt: now,
    };
    this.nodeExecutionsMap.set(record.id, record);
    return { ...record };
  }

  async updateNodeExecution(
    id: string,
    params: UpdateNodeExecutionParams
  ): Promise<JournalNodeExecutionRecord> {
    const existing = this.nodeExecutionsMap.get(id);
    if (!existing) {
      throw new Error(`NodeExecution "${id}" not found in journal`);
    }
    const updated: JournalNodeExecutionRecord = {
      ...existing,
      ...(params.status ? { status: params.status } : {}),
      ...(params.outputPayload !== undefined
        ? { outputPayload: redact(params.outputPayload) }
        : {}),
      ...(params.errorDetails !== undefined
        ? { errorDetails: redact(params.errorDetails) as Record<string, unknown> }
        : {}),
      ...(params.errorMessage !== undefined
        ? { errorMessage: redactString(params.errorMessage) }
        : {}),
      ...(params.finishedAt ? { finishedAt: params.finishedAt } : {}),
      ...(params.durationMs !== undefined ? { durationMs: params.durationMs } : {}),
      ...(params.retryCount !== undefined ? { retryCount: params.retryCount } : {}),
      updatedAt: new Date(),
    };
    this.nodeExecutionsMap.set(id, updated);
    return { ...updated };
  }

  async createLog(params: CreateLogParams): Promise<void> {
    this.logsList.push({
      ...params,
      id: randomUUID(),
      message: redactString(params.message),
      metadata: params.metadata
        ? (redact(params.metadata) as Record<string, unknown>)
        : undefined,
      timestamp: new Date(),
    });
  }

  async createEvent(params: CreateEventParams): Promise<void> {
    this.eventsList.push({
      id: randomUUID(),
      executionId: params.executionId,
      eventType: params.eventType,
      nodeId: params.nodeId ?? null,
      payload: params.payload
        ? (redact(params.payload) as Record<string, unknown>)
        : null,
      createdAt: new Date(),
    });
  }

  async findEvents(executionId: string): Promise<JournalEventRecord[]> {
    return this.eventsList.filter((ev) => ev.executionId === executionId);
  }
}
