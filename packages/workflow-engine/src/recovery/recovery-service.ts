import { eq, and, inArray, lt } from 'drizzle-orm';
import { executions, type DatabaseInstance } from '@localflow/db';
import type { IQueueProducer, WorkflowExecutionJobPayload } from '../queue/types.js';

export interface RecoveryScanOptions {
  staleThresholdMs?: number;
  hardTimeoutMs?: number;
  batchSize?: number;
}

export interface RecoveryScanResult {
  scannedCount: number;
  recoveredCount: number;
  timedOutCount: number;
  failedCount: number;
  recoveredExecutionIds: string[];
}

export interface RecoveryLogger {
  info(metaOrMsg: unknown, msg?: string): void;
  error(metaOrMsg: unknown, msg?: string): void;
}

export class CrashRecoveryService {
  constructor(
    private readonly db: DatabaseInstance,
    private readonly queueProducer: IQueueProducer<WorkflowExecutionJobPayload>,
    private readonly logger?: RecoveryLogger
  ) {}

  async scanAndRecover(options: RecoveryScanOptions = {}): Promise<RecoveryScanResult> {
    const staleThresholdMs = options.staleThresholdMs ?? 45_000;
    const hardTimeoutMs = options.hardTimeoutMs ?? 300_000;
    const staleCutoff = new Date(Date.now() - staleThresholdMs);

    const staleExecutions = await (this.db as any)
      .select()
      .from(executions)
      .where(
        and(
          inArray(executions.status, ['RUNNING', 'QUEUED']),
          lt(executions.updatedAt, staleCutoff)
        )
      )
      .limit(options.batchSize ?? 100);

    const result: RecoveryScanResult = {
      scannedCount: staleExecutions.length,
      recoveredCount: 0,
      timedOutCount: 0,
      failedCount: 0,
      recoveredExecutionIds: [],
    };

    for (const execution of staleExecutions) {
      try {
        const startedTime =
          execution.startedAt instanceof Date
            ? execution.startedAt.getTime()
            : execution.createdAt instanceof Date
              ? execution.createdAt.getTime()
              : Date.now();
        const totalDurationMs = Date.now() - startedTime;

        if (totalDurationMs > hardTimeoutMs) {
          await (this.db as any)
            .update(executions)
            .set({
              status: 'FAILED',
              finishedAt: new Date(),
              durationMs: totalDurationMs,
              errorMessage: `ERR_EXECUTION_TIMEOUT: Maximum workflow duration (${hardTimeoutMs}ms) exceeded during worker outage`,
              updatedAt: new Date(),
            })
            .where(eq(executions.id, execution.id));

          result.timedOutCount++;
          continue;
        }

        await this.queueProducer.add(
          'resumeWorkflow',
          {
            executionId: execution.id,
            workflowId: execution.workflowId,
            workflowVersionId: execution.workflowVersionId,
            workspaceId: execution.workspaceId,
            triggerType: execution.triggerType,
            triggerPayload: execution.triggerPayload,
            idempotencyKey: execution.idempotencyKey ?? undefined,
            isResume: true,
            enqueuedAt: Date.now(),
          },
          {
            jobId: `resume_${execution.id}`,
            priority: 1,
          }
        );

        await (this.db as any)
          .update(executions)
          .set({ updatedAt: new Date() })
          .where(eq(executions.id, execution.id));

        result.recoveredCount++;
        result.recoveredExecutionIds.push(execution.id);
        this.logger?.info(
          { executionId: execution.id },
          'Orphaned execution recovered and re-enqueued'
        );
      } catch (err: unknown) {
        result.failedCount++;
        this.logger?.error(
          { err, executionId: execution.id },
          'Failed to recover orphaned execution'
        );
      }
    }

    return result;
  }
}
