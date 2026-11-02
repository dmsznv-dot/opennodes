import type { DatabaseInstance } from '@localflow/db';
import type { IWorkflowQueueManager } from '@localflow/workflow-engine';
import { ExecutionRuntime, ExecutionWorker } from '@localflow/execution-runtime';
import type { WorkerConfig } from './config.js';

export interface WorkerLogger {
  info(metaOrMsg: unknown, msg?: string): void;
  warn(metaOrMsg: unknown, msg?: string): void;
  error(metaOrMsg: unknown, msg?: string): void;
}

/**
 * The execution worker process: consumes runs the API queued, executes them with
 * real connectors, resumes delayed runs, re-queues runs orphaned by a crash, and
 * starts runs from schedules and Telegram messages.
 */
export class WorkerDaemon {
  private readonly worker: ExecutionWorker;
  private isShuttingDown = false;
  private started = false;

  constructor(
    private readonly config: WorkerConfig,
    db: DatabaseInstance,
    private readonly queueManager: IWorkflowQueueManager,
    private readonly logger: WorkerLogger
  ) {
    const runtime = new ExecutionRuntime({
      db,
      encryptionKey: config.ENCRYPTION_KEY,
      ssrfAllowlist: config.SSRF_ALLOWLIST.split(',')
        .map((h) => h.trim())
        .filter(Boolean),
      allowedFsRoot: config.ALLOWED_FS_ROOT,
      inlineDelayMaxMs: config.INLINE_DELAY_MAX_MS,
      heartbeatMs: config.WORKER_HEARTBEAT_INTERVAL_MS,
      staleMs: config.ORPHAN_THRESHOLD_MS,
      logger,
    });
    this.worker = new ExecutionWorker({
      runtime,
      queue: queueManager,
      db,
      concurrency: config.WORKER_CONCURRENCY,
      recoveryIntervalMs: config.ORPHAN_SCAN_INTERVAL_MS,
      hardTimeoutMs: config.HARD_TIMEOUT_MS,
      triggers: {
        tickMs: config.TRIGGER_TICK_MS,
        telegramApiBase: config.TELEGRAM_API_BASE,
        telegramPollTimeoutSec: config.TELEGRAM_POLL_TIMEOUT_SEC,
      },
      logger,
    });
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    this.logger.info('Starting LocalFlow execution worker...');
    await this.worker.start();
    this.logger.info(
      { concurrency: this.config.WORKER_CONCURRENCY },
      'Worker ready to process runs'
    );
  }

  get running(): boolean {
    return this.started && !this.isShuttingDown && this.worker.running;
  }

  async shutdown(): Promise<void> {
    if (this.isShuttingDown) return;
    this.isShuttingDown = true;
    this.logger.info('Graceful shutdown: finishing active runs...');
    await Promise.race([
      this.worker.stop(),
      new Promise((resolve) => setTimeout(resolve, this.config.WORKER_DRAIN_TIMEOUT_MS)),
    ]);
    await this.queueManager.closeAll();
    this.started = false;
    this.logger.info('Worker shut down cleanly');
  }
}
