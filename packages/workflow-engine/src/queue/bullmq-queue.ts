import { Queue, Worker } from 'bullmq';
import { createRedisConnection, type RedisConnectionOptions } from './connection.js';
import { InMemoryQueueManager } from './in-memory-queue.js';
import type {
  EnqueueOptions,
  IQueueConsumer,
  IQueueProducer,
  IWorkflowQueueManager,
  QueueJob,
  WorkflowDelayJobPayload,
  WorkflowExecutionJobPayload,
} from './types.js';

export class BullMQQueueManager implements IWorkflowQueueManager {
  private readonly fallbackMock?: InMemoryQueueManager;
  private readonly execQueue?: Queue;
  private readonly delQueue?: Queue;
  private readonly consumers: Array<IQueueConsumer<any>> = [];

  readonly executionProducer: IQueueProducer<WorkflowExecutionJobPayload>;
  readonly delayProducer: IQueueProducer<WorkflowDelayJobPayload>;

  constructor(private readonly options: RedisConnectionOptions = {}) {
    if (
      options.useInMemoryMock ||
      options.url === 'mock' ||
      process.env.REDIS_URL === 'mock'
    ) {
      this.fallbackMock = new InMemoryQueueManager();
      this.executionProducer = this.fallbackMock.executionProducer;
      this.delayProducer = this.fallbackMock.delayProducer;
      return;
    }

    const connection = createRedisConnection(options) as any;
    this.execQueue = new Queue('workflow-execution', { connection });
    this.delQueue = new Queue('workflow-delays', { connection });

    this.executionProducer = this.wrapQueue(this.execQueue);
    this.delayProducer = this.wrapQueue(this.delQueue);
  }

  private wrapQueue<TData>(queue: Queue): IQueueProducer<TData> {
    return {
      add: async (jobName: string, data: TData, opts: EnqueueOptions = {}) => {
        const bullJob = await queue.add(jobName, data, {
          jobId: opts.jobId,
          priority: opts.priority,
          delay: opts.delay,
          attempts: opts.attempts ?? 3,
          backoff: opts.backoff ?? { type: 'exponential', delay: 1000 },
          removeOnComplete: (opts.removeOnComplete ?? { age: 86_400, count: 1000 }) as never,
          removeOnFail: (opts.removeOnFail ?? { age: 7 * 86_400 }) as never,
        });
        return {
          id: String(bullJob.id ?? opts.jobId ?? ''),
          name: bullJob.name,
          data: bullJob.data as TData,
          opts,
          state: opts.delay && opts.delay > 0 ? 'delayed' : 'waiting',
          attemptsMade: bullJob.attemptsMade,
          timestamp: bullJob.timestamp,
        };
      },
      close: async () => {
        await queue.close();
      },
    };
  }

  createExecutionConsumer(
    processor: (job: QueueJob<WorkflowExecutionJobPayload>) => Promise<unknown>,
    options?: { concurrency?: number; lockDurationMs?: number }
  ): IQueueConsumer<WorkflowExecutionJobPayload> {
    if (this.fallbackMock) {
      return this.fallbackMock.createExecutionConsumer(processor, options);
    }

    return this.createBullWorker<WorkflowExecutionJobPayload>(
      'workflow-execution',
      processor,
      options
    );
  }

  createDelayConsumer(
    processor: (job: QueueJob<WorkflowDelayJobPayload>) => Promise<unknown>,
    options?: { concurrency?: number }
  ): IQueueConsumer<WorkflowDelayJobPayload> {
    if (this.fallbackMock) {
      return this.fallbackMock.createDelayConsumer(processor);
    }

    return this.createBullWorker<WorkflowDelayJobPayload>(
      'workflow-delays',
      processor,
      options
    );
  }

  private createBullWorker<TData>(
    queueName: string,
    processor: (job: QueueJob<TData>) => Promise<unknown>,
    options?: { concurrency?: number; lockDurationMs?: number }
  ): IQueueConsumer<TData> {
    let worker: Worker | undefined;
    let healthy = false;

    const consumer: IQueueConsumer<TData> = {
      start: async () => {
        const connection = createRedisConnection(this.options) as any;
        worker = new Worker(
          queueName,
          async (bullJob) => {
            const mapped: QueueJob<TData> = {
              id: String(bullJob.id ?? ''),
              name: bullJob.name,
              data: bullJob.data as TData,
              opts: {
                jobId: bullJob.opts.jobId,
                priority: bullJob.opts.priority,
                delay: bullJob.opts.delay,
                attempts: bullJob.opts.attempts,
              },
              state: 'active',
              attemptsMade: bullJob.attemptsMade,
              timestamp: bullJob.timestamp,
              processedOn: bullJob.processedOn,
            };
            return processor(mapped);
          },
          {
            connection,
            concurrency: options?.concurrency ?? 10,
            lockDuration: options?.lockDurationMs ?? 30_000,
          }
        );
        healthy = true;
      },
      pause: async () => {
        await worker?.pause();
      },
      resume: async () => {
        worker?.resume();
      },
      close: async (force = false) => {
        healthy = false;
        await worker?.close(force);
      },
      isHealthy: () => healthy,
    };

    this.consumers.push(consumer);
    return consumer;
  }

  async closeAll(): Promise<void> {
    if (this.fallbackMock) {
      await this.fallbackMock.closeAll();
      return;
    }
    for (const c of this.consumers) {
      await c.close();
    }
    await this.execQueue?.close();
    await this.delQueue?.close();
  }
}
