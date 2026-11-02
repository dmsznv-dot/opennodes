import { randomUUID } from 'node:crypto';
import { AesGcmEncryptionService, EnvKeyProvider } from '@localflow/auth';
import type { DatabaseInstance } from '@localflow/db';
import { SafeHttpClient } from '@localflow/shared';
import {
  CrashRecoveryService,
  DrizzleExecutionJournal,
  WorkflowEngine,
  buildResumptionState,
  type IQueueConsumer,
  type IWorkflowQueueManager,
  type JournalExecutionRecord,
  type QueueJob,
  type WorkflowExecutionJobPayload,
} from '@localflow/workflow-engine';
import { buildConnectorExecutors } from './connectors.js';
import { buildDelayExecutors } from './delay.js';
import {
  DbCancellationToken,
  claimExecution,
  createCredentialResolver,
  failExecution,
  loadPublishedDefinition,
} from './store.js';

export interface RuntimeLogger {
  info(meta: unknown, msg?: string): void;
  warn(meta: unknown, msg?: string): void;
  error(meta: unknown, msg?: string): void;
}

const silentLogger: RuntimeLogger = { info() {}, warn() {}, error() {} };

export interface ExecutionRuntimeOptions {
  db: DatabaseInstance;
  /** Same key the API encrypts credentials with (64 hex chars). */
  encryptionKey: string;
  ssrfAllowlist?: string[];
  allowedFsRoot?: string;
  /** Delays up to this long run inline in the worker; longer ones suspend. */
  inlineDelayMaxMs?: number;
  /** How often a running run heartbeats and checks for cancellation. */
  heartbeatMs?: number;
  /** A RUNNING run without a heartbeat for this long is considered orphaned. */
  staleMs?: number;
  logger?: RuntimeLogger;
}

export interface EnqueueExecutionParams {
  workspaceId: string;
  workflowId: string;
  workflowVersionId: string;
  triggerType: string;
  triggerPayload?: unknown;
  idempotencyKey?: string;
}

/**
 * Everything needed to run published workflows: the engine with real connectors and
 * delays, the journal, and the queue job processor. Shared by the worker process and
 * by the API's embedded mode, so both execute through exactly the same code.
 */
export class ExecutionRuntime {
  readonly journal: DrizzleExecutionJournal;
  readonly engine: WorkflowEngine;
  readonly encryption: AesGcmEncryptionService;
  private readonly heartbeatMs: number;
  readonly staleMs: number;
  private readonly logger: RuntimeLogger;

  constructor(private readonly options: ExecutionRuntimeOptions) {
    this.journal = new DrizzleExecutionJournal(options.db);
    this.encryption = new AesGcmEncryptionService(new EnvKeyProvider(options.encryptionKey, 1));
    this.heartbeatMs = options.heartbeatMs ?? 5_000;
    this.staleMs = options.staleMs ?? 45_000;
    this.logger = options.logger ?? silentLogger;
    this.engine = new WorkflowEngine({
      journal: this.journal,
      strictNodeTypes: true,
      httpClient: new SafeHttpClient(),
      nodeExecutors: {
        ...buildConnectorExecutors({
          httpClient: new SafeHttpClient(),
          ssrfAllowlist: options.ssrfAllowlist,
          resolveCredential: createCredentialResolver(options.db, this.encryption),
        }),
        ...buildDelayExecutors({
          journal: this.journal,
          inlineMaxMs: options.inlineDelayMaxMs ?? 5_000,
        }),
      },
    });
  }

  /**
   * Records a QUEUED run and hands it to the queue. If the queue is unreachable the
   * run is marked FAILED with the reason instead of sitting in QUEUED forever.
   */
  async enqueue(
    queue: IWorkflowQueueManager,
    params: EnqueueExecutionParams
  ): Promise<JournalExecutionRecord> {
    const executionId = randomUUID();
    const record = await this.journal.createExecution({
      id: executionId,
      ...params,
      status: 'QUEUED',
    });
    try {
      await queue.executionProducer.add(
        'runWorkflow',
        { executionId, ...params, enqueuedAt: Date.now() },
        // A run must never be replayed blindly: retries could repeat side effects.
        { jobId: executionId, attempts: 1 }
      );
    } catch (err) {
      await failExecution(
        this.options.db,
        executionId,
        `Could not queue the run: ${err instanceof Error ? err.message : String(err)}`
      );
      throw err;
    }
    return record;
  }

  /** Queue job handler: claim, run (or resume) the run, re-queue it if it suspended. */
  createProcessor(
    queue: IWorkflowQueueManager
  ): (job: QueueJob<WorkflowExecutionJobPayload>) => Promise<unknown> {
    return async (job) => {
      const { db } = this.options;
      const { executionId } = job.data;
      const claimed = await claimExecution(db, executionId, new Date(Date.now() - this.staleMs));
      if (!claimed) return { executionId, skipped: true };

      const definition = await loadPublishedDefinition(db, claimed.workflowVersionId);
      if (!definition) {
        await failExecution(db, executionId, 'The published workflow version no longer exists.');
        return { executionId, status: 'FAILED' };
      }

      const resuming = (await this.journal.findNodeExecutions(executionId)).length > 0;
      const resume = resuming ? await buildResumptionState(executionId, this.journal) : undefined;
      const token = new DbCancellationToken(db, executionId);
      token.start(this.heartbeatMs);
      try {
        const result = await this.engine.executeWorkflow(definition, {
          executionId,
          workflowVersionId: claimed.workflowVersionId,
          triggerType: claimed.triggerType,
          // The job carries the original payload; the journal copy is redacted.
          triggerPayload: job.data.triggerPayload ?? claimed.triggerPayload,
          // Deduplication already happened when the run was queued; passing the key
          // here would make the engine find this very run and skip it.
          journal: this.journal,
          cancellationToken: token,
          allowedFsRoot: this.options.allowedFsRoot,
          ...(resume && {
            resumeFromExecutionId: executionId,
            cachedNodeOutputs: resume.cachedOutputs,
            completedNodeIds: resume.completedNodeIds,
            completedNodePorts: resume.completedNodePorts,
          }),
        });

        if (result.execution.status === 'WAITING' && result.suspension) {
          const resumeAt = result.suspension.resumeAt.getTime();
          await queue.executionProducer.add(
            'resumeWorkflow',
            { ...job.data, isResume: true, enqueuedAt: Date.now() },
            {
              jobId: `wait_${executionId}_${resumeAt}`,
              delay: Math.max(0, resumeAt - Date.now()),
              attempts: 1,
            }
          );
        }
        return { executionId, status: result.execution.status };
      } catch (err) {
        this.logger.error({ err, executionId }, 'Run crashed outside of a step');
        await failExecution(
          db,
          executionId,
          `The run stopped unexpectedly: ${err instanceof Error ? err.message : String(err)}`
        );
        return { executionId, status: 'FAILED' };
      } finally {
        token.stop();
      }
    };
  }
}

export interface ExecutionWorkerOptions {
  runtime: ExecutionRuntime;
  queue: IWorkflowQueueManager;
  db: DatabaseInstance;
  concurrency?: number;
  /** How often to look for runs whose worker died (and lost delayed resumes). */
  recoveryIntervalMs?: number;
  /** Runs older than this that never finished are failed instead of resumed. */
  hardTimeoutMs?: number;
  logger?: RuntimeLogger;
}

/**
 * Consumes the execution queue and periodically re-queues orphaned runs. Used by the
 * worker process (BullMQ) and by the API in embedded mode (in-process queue).
 */
export class ExecutionWorker {
  private consumer?: IQueueConsumer<WorkflowExecutionJobPayload>;
  private timer?: NodeJS.Timeout;
  private readonly recovery: CrashRecoveryService;
  private readonly logger: RuntimeLogger;

  constructor(private readonly options: ExecutionWorkerOptions) {
    this.logger = options.logger ?? silentLogger;
    this.recovery = new CrashRecoveryService(
      options.db,
      options.queue.executionProducer,
      this.logger
    );
  }

  get running(): boolean {
    return this.consumer?.isHealthy() ?? false;
  }

  async start(): Promise<void> {
    await this.scan();
    this.timer = setInterval(() => void this.scan(), this.options.recoveryIntervalMs ?? 60_000);
    this.timer.unref?.();
    this.consumer = this.options.queue.createExecutionConsumer(
      this.options.runtime.createProcessor(this.options.queue),
      { concurrency: this.options.concurrency ?? 4 }
    );
    await this.consumer.start();
  }

  async scan(): Promise<void> {
    try {
      const result = await this.recovery.scanAndRecover({
        staleThresholdMs: this.options.runtime.staleMs,
        hardTimeoutMs: this.options.hardTimeoutMs ?? 24 * 3_600_000,
      });
      if (result.recoveredCount || result.timedOutCount) {
        this.logger.info({ result }, 'Recovered orphaned runs');
      }
    } catch (err) {
      this.logger.error({ err }, 'Orphaned-run recovery scan failed');
    }
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    await this.consumer?.close(false);
  }
}
