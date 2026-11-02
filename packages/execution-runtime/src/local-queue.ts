import { randomUUID } from 'node:crypto';
import type {
  EnqueueOptions,
  IQueueConsumer,
  IQueueProducer,
  IWorkflowQueueManager,
  QueueJob,
  WorkflowDelayJobPayload,
  WorkflowExecutionJobPayload,
} from '@localflow/workflow-engine';

/** setTimeout's ceiling; longer delays are re-armed in steps. */
const MAX_TIMER_MS = 2 ** 31 - 1;

/**
 * In-process queue for single-process deployments (no Redis) and tests. Unlike the
 * engine's InMemoryQueue test double it actually runs jobs: immediately, after
 * `delay`, with bounded concurrency. Delayed jobs are lost on restart; crash
 * recovery re-enqueues the affected runs from the database.
 */
class LocalQueue<T> implements IQueueProducer<T> {
  private readonly ready: Array<QueueJob<T>> = [];
  private readonly timers = new Set<NodeJS.Timeout>();
  private consumer?: {
    processor: (job: QueueJob<T>) => Promise<unknown>;
    concurrency: number;
    paused: boolean;
  };
  private active = 0;
  private closed = false;
  private idleWaiters: Array<() => void> = [];

  constructor(private readonly onError?: (err: unknown, job: QueueJob<unknown>) => void) {}

  async add(name: string, data: T, opts: EnqueueOptions = {}): Promise<QueueJob<T>> {
    const job: QueueJob<T> = {
      id: opts.jobId ?? randomUUID(),
      name,
      data,
      opts,
      state: opts.delay && opts.delay > 0 ? 'delayed' : 'waiting',
      attemptsMade: 0,
      timestamp: Date.now(),
    };
    if (!this.closed) this.schedule(job, Date.now() + (opts.delay ?? 0));
    return job;
  }

  private schedule(job: QueueJob<T>, dueAt: number): void {
    const wait = dueAt - Date.now();
    if (wait <= 0) {
      job.state = 'waiting';
      this.ready.push(job);
      setImmediate(() => this.pump());
      return;
    }
    const timer = setTimeout(
      () => {
        this.timers.delete(timer);
        if (!this.closed) this.schedule(job, dueAt);
      },
      Math.min(wait, MAX_TIMER_MS)
    );
    timer.unref?.();
    this.timers.add(timer);
  }

  consume(
    processor: (job: QueueJob<T>) => Promise<unknown>,
    concurrency: number
  ): IQueueConsumer<T> {
    this.consumer = { processor, concurrency: Math.max(1, concurrency), paused: true };
    let healthy = false;
    return {
      start: async () => {
        this.consumer!.paused = false;
        healthy = true;
        this.pump();
      },
      pause: async () => {
        this.consumer!.paused = true;
      },
      resume: async () => {
        this.consumer!.paused = false;
        this.pump();
      },
      close: async () => {
        healthy = false;
        this.consumer!.paused = true;
        await this.idle();
      },
      isHealthy: () => healthy,
    };
  }

  private pump(): void {
    const c = this.consumer;
    while (c && !c.paused && !this.closed && this.active < c.concurrency && this.ready.length) {
      const job = this.ready.shift()!;
      job.state = 'active';
      job.processedOn = Date.now();
      this.active++;
      c.processor(job)
        .then((result) => {
          job.state = 'completed';
          job.returnValue = result;
        })
        .catch((err: unknown) => {
          job.attemptsMade++;
          job.failedReason = err instanceof Error ? err.message : String(err);
          if (job.attemptsMade < (job.opts.attempts ?? 1)) {
            this.schedule(job, Date.now() + (job.opts.backoff?.delay ?? 1000));
          } else {
            job.state = 'failed';
            this.onError?.(err, job);
          }
        })
        .finally(() => {
          job.finishedOn = Date.now();
          this.active--;
          if (this.active === 0) for (const w of this.idleWaiters.splice(0)) w();
          this.pump();
        });
    }
  }

  private idle(): Promise<void> {
    return this.active === 0 ? Promise.resolve() : new Promise((r) => this.idleWaiters.push(r));
  }

  async close(): Promise<void> {
    this.closed = true;
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    this.ready.length = 0;
    await this.idle();
  }
}

export class LocalQueueManager implements IWorkflowQueueManager {
  private readonly execution: LocalQueue<WorkflowExecutionJobPayload>;
  private readonly delays: LocalQueue<WorkflowDelayJobPayload>;

  constructor(onError?: (err: unknown, job: QueueJob<unknown>) => void) {
    this.execution = new LocalQueue<WorkflowExecutionJobPayload>(onError);
    this.delays = new LocalQueue<WorkflowDelayJobPayload>(onError);
  }

  get executionProducer(): IQueueProducer<WorkflowExecutionJobPayload> {
    return this.execution;
  }

  get delayProducer(): IQueueProducer<WorkflowDelayJobPayload> {
    return this.delays;
  }

  createExecutionConsumer(
    processor: (job: QueueJob<WorkflowExecutionJobPayload>) => Promise<unknown>,
    options?: { concurrency?: number }
  ): IQueueConsumer<WorkflowExecutionJobPayload> {
    return this.execution.consume(processor, options?.concurrency ?? 4);
  }

  createDelayConsumer(
    processor: (job: QueueJob<WorkflowDelayJobPayload>) => Promise<unknown>,
    options?: { concurrency?: number }
  ): IQueueConsumer<WorkflowDelayJobPayload> {
    return this.delays.consume(processor, options?.concurrency ?? 1);
  }

  async closeAll(): Promise<void> {
    await Promise.all([this.execution.close(), this.delays.close()]);
  }
}
