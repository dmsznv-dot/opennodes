import { randomUUID } from 'node:crypto';
import { eq, and } from 'drizzle-orm';
import type { DatabaseInstance } from '@localflow/db';
import {
  executions,
  nodeExecutions,
  executionLogs,
  executionEvents,
} from '@localflow/db';
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

export class DrizzleExecutionJournal implements ExecutionJournal {
  constructor(private readonly db: DatabaseInstance) {}

  async findExecutionById(executionId: string): Promise<JournalExecutionRecord | undefined> {
    const rows = await (this.db as any)
      .select()
      .from(executions)
      .where(eq(executions.id, executionId))
      .limit(1);
    return rows[0] as JournalExecutionRecord | undefined;
  }

  async findExecutionByIdempotencyKey(
    workspaceId: string,
    workflowId: string,
    idempotencyKey: string
  ): Promise<JournalExecutionRecord | undefined> {
    const rows = await (this.db as any)
      .select()
      .from(executions)
      .where(
        and(
          eq(executions.workspaceId, workspaceId),
          eq(executions.workflowId, workflowId),
          eq(executions.idempotencyKey, idempotencyKey)
        )
      )
      .limit(1);
    return rows[0] as JournalExecutionRecord | undefined;
  }

  async createExecution(params: CreateExecutionParams): Promise<JournalExecutionRecord> {
    const now = new Date();
    const [row] = await (this.db as any)
      .insert(executions)
      .values({
        id: params.id ?? randomUUID(),
        workspaceId: params.workspaceId,
        workflowId: params.workflowId,
        workflowVersionId: params.workflowVersionId,
        status: params.status,
        triggerType: params.triggerType,
        triggerPayload: (params.triggerPayload !== undefined
          ? redact(params.triggerPayload)
          : null) as Record<string, unknown> | null,
        idempotencyKey: params.idempotencyKey ?? null,
        startedAt: params.startedAt ?? now,
        metadata: (params.metadata ? redact(params.metadata) : null) as
          | Record<string, unknown>
          | null,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    return row as JournalExecutionRecord;
  }

  async updateExecution(
    executionId: string,
    params: UpdateExecutionParams
  ): Promise<JournalExecutionRecord> {
    const [row] = await (this.db as any)
      .update(executions)
      .set({
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
      })
      .where(eq(executions.id, executionId))
      .returning();
    return row as JournalExecutionRecord;
  }

  async findNodeExecutions(executionId: string): Promise<JournalNodeExecutionRecord[]> {
    const rows = await (this.db as any)
      .select()
      .from(nodeExecutions)
      .where(eq(nodeExecutions.executionId, executionId));
    return rows as JournalNodeExecutionRecord[];
  }

  async findNodeExecution(
    executionId: string,
    nodeId: string
  ): Promise<JournalNodeExecutionRecord | undefined> {
    const rows = await (this.db as any)
      .select()
      .from(nodeExecutions)
      .where(
        and(eq(nodeExecutions.executionId, executionId), eq(nodeExecutions.nodeId, nodeId))
      )
      .limit(1);
    return rows[0] as JournalNodeExecutionRecord | undefined;
  }

  async createNodeExecution(
    params: CreateNodeExecutionParams
  ): Promise<JournalNodeExecutionRecord> {
    const now = new Date();
    const [row] = await (this.db as any)
      .insert(nodeExecutions)
      .values({
        id: params.id ?? randomUUID(),
        executionId: params.executionId,
        nodeId: params.nodeId,
        nodeType: params.nodeType,
        nodeName: params.nodeName ?? null,
        status: params.status,
        retryCount: params.retryCount ?? 0,
        inputPayload: params.inputPayload !== undefined ? redact(params.inputPayload) : null,
        outputPayload: params.outputPayload !== undefined ? redact(params.outputPayload) : null,
        startedAt: params.startedAt ?? now,
        finishedAt: params.finishedAt ?? null,
        durationMs: params.durationMs ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    return row as JournalNodeExecutionRecord;
  }

  async updateNodeExecution(
    id: string,
    params: UpdateNodeExecutionParams
  ): Promise<JournalNodeExecutionRecord> {
    const [row] = await (this.db as any)
      .update(nodeExecutions)
      .set({
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
      })
      .where(eq(nodeExecutions.id, id))
      .returning();
    return row as JournalNodeExecutionRecord;
  }

  async createLog(params: CreateLogParams): Promise<void> {
    await (this.db as any).insert(executionLogs).values({
      id: randomUUID(),
      executionId: params.executionId,
      nodeExecutionId: params.nodeExecutionId ?? null,
      nodeId: params.nodeId ?? null,
      level: params.level,
      message: redactString(params.message),
      metadata: (params.metadata ? redact(params.metadata) : null) as
        | Record<string, unknown>
        | null,
      timestamp: new Date(),
    });
  }

  async createEvent(params: CreateEventParams): Promise<void> {
    await (this.db as any).insert(executionEvents).values({
      id: randomUUID(),
      executionId: params.executionId,
      eventType: params.eventType,
      nodeId: params.nodeId ?? null,
      payload: (params.payload ? redact(params.payload) : null) as
        | Record<string, unknown>
        | null,
      createdAt: new Date(),
    });
  }

  async findEvents(executionId: string): Promise<JournalEventRecord[]> {
    const rows = await (this.db as any)
      .select()
      .from(executionEvents)
      .where(eq(executionEvents.executionId, executionId));
    return rows as JournalEventRecord[];
  }
}
