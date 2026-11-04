import { randomUUID } from 'node:crypto';
import { AesGcmEncryptionService, EnvKeyProvider } from '@localflow/auth';
import type { DatabaseInstance } from '@localflow/db';
import { SafeHttpClient } from '@localflow/shared';
import {
  CrashRecoveryService,
  DrizzleExecutionJournal,
  InMemoryExecutionJournal,
  WorkflowEngine,
  defaultPrimitiveRegistry,
  buildResumptionState,
  type ExecutionJournal,
  type IQueueConsumer,
  type IWorkflowQueueManager,
  type JournalExecutionRecord,
  type NodeExecutor,
  type QueueJob,
  type WorkflowExecutionJobPayload,
  type WorkflowRunResult,
} from '@localflow/workflow-engine';
import type { WorkflowDefinition } from '@localflow/workflow-schema';
import { buildConnectorExecutors, notImplementedNodeTypes } from './connectors.js';

/** Triggers the engine starts runs from (they need no executor). */
const TRIGGER_TYPES = ['trigger.manual', 'trigger.webhook', 'trigger.cron', 'trigger.telegram'];
import { buildDelayExecutors } from './delay.js';
import { buildLogicExecutors } from './logic.js';
import { settleRssItems, withOnlyNewItems, withPageImages } from './rss.js';
import { buildAgentExecutor } from './agent.js';
import { buildExtraExecutors } from './extras.js';
import {
  DbCancellationToken,
  claimExecution,
  createCredentialResolver,
  failExecution,
  loadPublishedDefinition,
} from './store.js';
import { TriggerScheduler, type TriggerSchedulerOptions } from './triggers.js';
import { pruneHistory } from './retention.js';
import { buildContextExecutors } from './context.js';
import { FOR_EACH_TYPES, withForEach } from './for-each.js';

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
  /** Telegram Bot API base for sending (tests, a local Bot API server). */
  telegramApiBase?: string;
  allowedFsRoot?: string;
  /** Delays up to this long run inline in the worker; longer ones suspend. */
  inlineDelayMaxMs?: number;
  /** Pause between repetitions of a “for each item” messenger step (default per service). */
  forEachPauseMs?: number;
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
  readonly ssrfAllowlist: string[];
  private readonly executorTypes: string[];
  private readonly logger: RuntimeLogger;

  constructor(private readonly options: ExecutionRuntimeOptions) {
    this.encryption = new AesGcmEncryptionService(new EnvKeyProvider(options.encryptionKey, 1));
    const encryption = this.encryption;
    this.journal = new DrizzleExecutionJournal(options.db, {
      sealer: {
        seal: (value) => encryption.encryptJson(value, 'step-output'),
        unseal: (sealed) => encryption.decryptJson(sealed as never, 'step-output'),
      },
    });
    this.heartbeatMs = options.heartbeatMs ?? 5_000;
    this.staleMs = options.staleMs ?? 45_000;
    this.ssrfAllowlist = options.ssrfAllowlist ?? [];
    this.logger = options.logger ?? silentLogger;
    const connectors = buildConnectorExecutors({
      httpClient: new SafeHttpClient(),
      ssrfAllowlist: options.ssrfAllowlist,
      telegramApiBase: options.telegramApiBase,
      resolveCredential: createCredentialResolver(options.db, this.encryption),
    });
    Object.assign(
      connectors,
      buildExtraExecutors({
        httpClient: new SafeHttpClient(),
        ssrfAllowlist: options.ssrfAllowlist,
        resolveCredential: createCredentialResolver(options.db, this.encryption),
      })
    );
    connectors['core.rss'] = withPageImages(
      withOnlyNewItems(connectors['core.rss']!, options.db),
      new SafeHttpClient(),
      options.ssrfAllowlist
    );
    connectors['ai.agent'] = buildAgentExecutor({
      httpClient: new SafeHttpClient(),
      ssrfAllowlist: options.ssrfAllowlist,
      resolveCredential: createCredentialResolver(options.db, this.encryption),
    });
    const nodeExecutors = {
      ...connectors,
      ...buildLogicExecutors(),
      ...buildContextExecutors(),
      ...buildDelayExecutors({
        journal: this.journal,
        inlineMaxMs: options.inlineDelayMaxMs ?? 5_000,
      }),
    };
    for (const type of FOR_EACH_TYPES) {
      const inner = (nodeExecutors as Record<string, NodeExecutor>)[type];
      if (inner)
        (nodeExecutors as Record<string, NodeExecutor>)[type] = withForEach(inner, type, {
          pauseMs: options.forEachPauseMs,
        });
    }
    this.executorTypes = Object.keys(nodeExecutors);
    this.engine = new WorkflowEngine({
      journal: this.journal,
      strictNodeTypes: true,
      httpClient: new SafeHttpClient(),
      nodeExecutors,
    });
  }

  /** Node types this server can run; the editor offers only these. */
  catalog(): { nodeTypes: string[]; notImplemented: string[] } {
    const notImplemented = notImplementedNodeTypes();
    const types = new Set([
      ...TRIGGER_TYPES,
      ...defaultPrimitiveRegistry.listCanonical().map((p) => p.type),
      ...this.executorTypes,
    ]);
    for (const t of notImplemented) types.delete(t);
    return { nodeTypes: [...types].sort(), notImplemented };
  }

  /**
   * Records a QUEUED run and hands it to the queue. If the queue is unreachable the
   * run is marked FAILED with the reason instead of sitting in QUEUED forever.
   */
  async enqueue(
    queue: IWorkflowQueueManager,
    params: EnqueueExecutionParams
  ): Promise<JournalExecutionRecord> {
    const record = await this.recordQueuedRun(this.journal, params);
    try {
      await this.dispatch(queue, record.id, params);
    } catch (err) {
      await failExecution(
        this.options.db,
        record.id,
        `Could not queue the run: ${err instanceof Error ? err.message : String(err)}`
      );
      throw err;
    }
    return record;
  }

  /**
   * Inserts the QUEUED row only. Pass a journal bound to a transaction to record the
   * run atomically with other writes (a trigger advancing its schedule or cursor);
   * if the process dies before `dispatch`, crash recovery queues the row later.
   */
  recordQueuedRun(
    journal: ExecutionJournal,
    params: EnqueueExecutionParams
  ): Promise<JournalExecutionRecord> {
    return journal.createExecution({ id: randomUUID(), ...params, status: 'QUEUED' });
  }

  /** Hands a recorded run to the queue; the job carries the unredacted trigger payload. */
  async dispatch(
    queue: IWorkflowQueueManager,
    executionId: string,
    params: EnqueueExecutionParams
  ): Promise<void> {
    await queue.executionProducer.add(
      'runWorkflow',
      { executionId, ...params, enqueuedAt: Date.now() },
      // A run must never be replayed blindly: retries could repeat side effects.
      { jobId: executionId, attempts: 1 }
    );
  }

  /**
   * Runs a graph that is not published (the editor's "Test") with the real steps, in
   * this process and without recording it: nothing appears in run history. A delay
   * longer than the inline limit stops the test with status WAITING.
   */
  async testRun(
    definition: WorkflowDefinition,
    triggerPayload: unknown
  ): Promise<WorkflowRunResult> {
    const executionId = randomUUID();
    const result = await this.engine.executeWorkflow(definition, {
      executionId,
      workflowVersionId: 'draft',
      triggerType: 'test',
      triggerPayload,
      journal: new InMemoryExecutionJournal(),
    });
    // RSS steps that remember tests: their items count as used only if the test succeeded.
    await settleRssItems(this.options.db, executionId, result.execution.status === 'SUCCEEDED');
    return result;
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

        if (result.execution.status !== 'WAITING') {
          await settleRssItems(db, executionId, result.execution.status === 'SUCCEEDED');
        }
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
        await settleRssItems(db, executionId, false).catch(() => {});
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
  /** Finished runs older than this many days are deleted (hourly); 0 keeps them. Default 90. */
  retentionDays?: number;
  /** Schedule and Telegram triggers; `false` leaves them to another process. */
  triggers?: false | Omit<TriggerSchedulerOptions, 'db' | 'runtime' | 'queue' | 'logger'>;
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
  private lastPrune = 0;
  readonly scheduler?: TriggerScheduler;

  constructor(private readonly options: ExecutionWorkerOptions) {
    this.logger = options.logger ?? silentLogger;
    this.recovery = new CrashRecoveryService(
      options.db,
      options.queue.executionProducer,
      this.logger
    );
    if (options.triggers !== false) {
      this.scheduler = new TriggerScheduler({
        ...options.triggers,
        db: options.db,
        runtime: options.runtime,
        queue: options.queue,
        logger: this.logger,
      });
    }
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
    await this.scheduler?.start();
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
    if (Date.now() - this.lastPrune >= 3_600_000) {
      this.lastPrune = Date.now();
      await this.prune();
    }
  }

  /** Deletes old finished runs and expired sign-ins (see `pruneHistory`). */
  async prune(): Promise<void> {
    try {
      const removed = await pruneHistory(this.options.db, this.options.retentionDays ?? 90);
      if (removed.executions || removed.triggerLogs) {
        this.logger.info({ removed }, 'Removed old run history');
      }
    } catch (err) {
      this.logger.error({ err }, 'Run history cleanup failed');
    }
  }

  async stop(): Promise<void> {
    await this.scheduler?.stop();
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    await this.consumer?.close(false);
  }
}
