import { randomUUID } from 'node:crypto';
import type {
  EnqueueOptions,
  IQueueConsumer,
  IQueueProducer,
  IWorkflowQueueManager,
  QueueJob,
  WorkflowDelayJobPayload,
  WorkflowExecutionJobPayload,
} from './types.js';

export class InMemoryQueue<TData = unknown, TResult = unknown>
  implements IQueueProducer<TData>
{
  readonly jobs = new Map<string, QueueJob<TData, TResult>>();
  readonly dlq: Array<QueueJob<TData, TResult>> = [];
  private consumers: Array<{
    processor: (job: QueueJob<TData, TResult>) => Promise<TResult>;
    paused: boolean;
    lockDurationMs: number;
  }> = [];

  constructor(public readonly queueName: string) {}

  async add(
    jobName: string,
    data: TData,
    opts: EnqueueOptions = {}
  ): Promise<QueueJob<TData, TResult>> {
    const id = opts.jobId ?? randomUUID();
    const existing = this.jobs.get(id);
    if (existing) {
      return existing;
    }

    const now = Date.now();
    const delay = opts.delay ?? 0;
    const job: QueueJob<TData, TResult> = {
      id,
      name: jobName,
      data,
      opts: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 },
        ...opts,
      },
      state: delay > 0 ? 'delayed' : 'waiting',
      attemptsMade: 0,
      timestamp: now,
    };

    this.jobs.set(id, job);
    return job;
  }

  promoteDelayedJobs(advanceMs = 0): number {
    let count = 0;
    const now = Date.now() + advanceMs;
    for (const job of this.jobs.values()) {
      if (job.state === 'delayed') {
        const dueAt = job.timestamp + (job.opts.delay ?? 0);
        if (now >= dueAt) {
          job.state = 'waiting';
          count++;
        }
      }
    }
    return count;
  }

  detectStalledJobs(now = Date.now()): QueueJob<TData, TResult>[] {
    const stalled: QueueJob<TData, TResult>[] = [];
    for (const job of this.jobs.values()) {
      if (job.state === 'active' && job.lockUntil && job.lockUntil < now) {
        job.state = 'waiting';
        stalled.push(job);
      }
    }
    return stalled;
  }

  async processNext(
    processor?: (job: QueueJob<TData, TResult>) => Promise<TResult>,
    lockDurationMs = 30_000
  ): Promise<QueueJob<TData, TResult> | undefined> {
    const activeProcessor = processor ?? this.consumers.find((c) => !c.paused)?.processor;
    if (!activeProcessor) return undefined;

    const waitingJob = Array.from(this.jobs.values()).find((j) => j.state === 'waiting');
    if (!waitingJob) return undefined;

    waitingJob.state = 'active';
    waitingJob.processedOn = Date.now();
    waitingJob.lockUntil = Date.now() + lockDurationMs;

    try {
      const result = await activeProcessor(waitingJob);
      waitingJob.state = 'completed';
      waitingJob.returnValue = result;
      waitingJob.finishedOn = Date.now();
    } catch (err: unknown) {
      waitingJob.attemptsMade += 1;
      const maxAttempts = waitingJob.opts.attempts ?? 3;
      waitingJob.failedReason = err instanceof Error ? err.message : String(err);

      if (waitingJob.attemptsMade >= maxAttempts) {
        waitingJob.state = 'failed';
        waitingJob.finishedOn = Date.now();
        this.dlq.push(waitingJob);
      } else {
        waitingJob.state = 'waiting';
      }
    }

    return waitingJob;
  }

  registerConsumer(
    processor: (job: QueueJob<TData, TResult>) => Promise<TResult>,
    lockDurationMs = 30_000
  ): IQueueConsumer<TData, TResult> {
    const entry = { processor, paused: false, lockDurationMs };
    this.consumers.push(entry);
    let healthy = true;

    return {
      start: async () => {
        entry.paused = false;
      },
      pause: async () => {
        entry.paused = true;
      },
      resume: async () => {
        entry.paused = false;
      },
      close: async () => {
        entry.paused = true;
        healthy = false;
      },
      isHealthy: () => healthy,
    };
  }

  async close(): Promise<void> {
    this.consumers = [];
  }
}

export class InMemoryQueueManager implements IWorkflowQueueManager {
  readonly executionQueue = new InMemoryQueue<WorkflowExecutionJobPayload>(
    'workflow-execution'
  );
  readonly delayQueue = new InMemoryQueue<WorkflowDelayJobPayload>('workflow-delays');

  get executionProducer(): IQueueProducer<WorkflowExecutionJobPayload> {
    return this.executionQueue;
  }

  get delayProducer(): IQueueProducer<WorkflowDelayJobPayload> {
    return this.delayQueue;
  }

  createExecutionConsumer(
    processor: (job: QueueJob<WorkflowExecutionJobPayload>) => Promise<unknown>,
    options?: { concurrency?: number; lockDurationMs?: number }
  ): IQueueConsumer<WorkflowExecutionJobPayload> {
    return this.executionQueue.registerConsumer(
      processor,
      options?.lockDurationMs ?? 30_000
    );
  }

  createDelayConsumer(
    processor: (job: QueueJob<WorkflowDelayJobPayload>) => Promise<unknown>
  ): IQueueConsumer<WorkflowDelayJobPayload> {
    return this.delayQueue.registerConsumer(processor, 30_000);
  }

  async closeAll(): Promise<void> {
    await this.executionQueue.close();
    await this.delayQueue.close();
  }
}
