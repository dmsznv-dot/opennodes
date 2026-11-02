import type { DatabaseInstance } from '@localflow/db';
import {
  CrashRecoveryService,
  type IQueueConsumer,
  type IWorkflowQueueManager,
  type WorkflowEngine,
} from '@localflow/workflow-engine';
import type { WorkerConfig } from './config.js';
import { executeWorkflowJob } from './handlers/execution-handler.js';
import { executeDelayJob } from './handlers/delay-handler.js';

export interface WorkerLogger {
  info(metaOrMsg: unknown, msg?: string): void;
  warn(metaOrMsg: unknown, msg?: string): void;
  error(metaOrMsg: unknown, msg?: string): void;
}

export class WorkerDaemon {
  private isRunning = false;
  private isShuttingDown = false;
  private orphanScanTimer?: NodeJS.Timeout;
  private executionConsumer?: IQueueConsumer<any>;
  private delayConsumer?: IQueueConsumer<any>;

  constructor(
    private readonly config: WorkerConfig,
    private readonly db: DatabaseInstance,
    private readonly queueManager: IWorkflowQueueManager,
    private readonly recoveryService: CrashRecoveryService,
    private readonly logger: WorkerLogger,
    private readonly engine?: WorkflowEngine
  ) {}

  async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;
    this.logger.info('Starting LocalFlow Execution Worker Daemon...');

    const recoveryResult = await this.recoveryService.scanAndRecover({
      staleThresholdMs: this.config.ORPHAN_THRESHOLD_MS,
      hardTimeoutMs: this.config.HARD_TIMEOUT_MS,
    });
    this.logger.info({ recoveryResult }, 'Startup recovery scan complete');

    this.orphanScanTimer = setInterval(async () => {
      if (this.isShuttingDown) return;
      try {
        await this.recoveryService.scanAndRecover({
          staleThresholdMs: this.config.ORPHAN_THRESHOLD_MS,
          hardTimeoutMs: this.config.HARD_TIMEOUT_MS,
        });
      } catch (err) {
        this.logger.error({ err }, 'Error in periodic orphan recovery scan');
      }
    }, this.config.ORPHAN_SCAN_INTERVAL_MS);

    this.executionConsumer = this.queueManager.createExecutionConsumer(
      async (job) => executeWorkflowJob(job, this.db, this.engine),
      { concurrency: this.config.WORKER_CONCURRENCY }
    );
    await this.executionConsumer.start();

    this.delayConsumer = this.queueManager.createDelayConsumer(
      async (job) => executeDelayJob(job, this.queueManager.executionProducer),
      { concurrency: this.config.WORKER_CONCURRENCY }
    );
    await this.delayConsumer.start();

    this.logger.info(
      { concurrency: this.config.WORKER_CONCURRENCY },
      'Worker Daemon ready to process execution jobs'
    );
  }

  get running(): boolean {
    return this.isRunning && !this.isShuttingDown;
  }

  async shutdown(): Promise<void> {
    if (this.isShuttingDown) return;
    this.isShuttingDown = true;
    this.logger.info('Graceful shutdown initiated, draining active jobs...');

    if (this.orphanScanTimer) {
      clearInterval(this.orphanScanTimer);
      this.orphanScanTimer = undefined;
    }

    const drainTimeout = this.config.WORKER_DRAIN_TIMEOUT_MS;
    const timeoutPromise = new Promise((resolve) => setTimeout(resolve, drainTimeout));

    try {
      await Promise.race([
        Promise.all([
          this.executionConsumer?.close(false),
          this.delayConsumer?.close(false),
        ]),
        timeoutPromise,
      ]);
    } catch (err) {
      this.logger.error({ err }, 'Error closing queue consumers');
    }

    await this.queueManager.closeAll();
    this.isRunning = false;
    this.logger.info('Worker Daemon shut down cleanly');
  }
}
