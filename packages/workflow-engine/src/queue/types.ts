export interface WorkflowExecutionJobPayload {
  executionId: string;
  workflowId: string;
  workflowVersionId: string;
  workspaceId: string;
  triggerType: 'manual' | 'cron' | 'webhook' | 'telegram' | string;
  triggerPayload?: unknown;
  idempotencyKey?: string;
  priority?: number;
  isResume?: boolean;
  resumeNodeId?: string;
  enqueuedAt: number;
  metadata?: Record<string, unknown>;
}

export interface WorkflowDelayJobPayload {
  executionId: string;
  workflowId: string;
  nodeId: string;
  delayMs: number;
  resumeAt: number;
  scopeSnapshot?: Record<string, unknown>;
}

export interface EnqueueOptions {
  jobId?: string;
  priority?: number;
  delay?: number;
  attempts?: number;
  backoff?: {
    type: 'fixed' | 'exponential';
    delay: number;
  };
  removeOnComplete?: boolean | number | { age?: number; count?: number };
  removeOnFail?: boolean | number | { age?: number; count?: number };
}

export interface QueueJob<TData = unknown, TResult = unknown> {
  id: string;
  name: string;
  data: TData;
  opts: EnqueueOptions;
  state: 'waiting' | 'active' | 'delayed' | 'completed' | 'failed' | 'stalled';
  attemptsMade: number;
  failedReason?: string;
  returnValue?: TResult;
  timestamp: number;
  processedOn?: number;
  finishedOn?: number;
  lockUntil?: number;
}

export interface IQueueProducer<TData = unknown> {
  add(jobName: string, data: TData, opts?: EnqueueOptions): Promise<QueueJob<TData>>;
  close(): Promise<void>;
}

export interface IQueueConsumer<TData = unknown, _TResult = unknown> {
  start(): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  close(force?: boolean): Promise<void>;
  isHealthy(): boolean;
}

export interface IWorkflowQueueManager {
  readonly executionProducer: IQueueProducer<WorkflowExecutionJobPayload>;
  readonly delayProducer: IQueueProducer<WorkflowDelayJobPayload>;
  createExecutionConsumer(
    processor: (job: QueueJob<WorkflowExecutionJobPayload>) => Promise<unknown>,
    options?: { concurrency?: number; lockDurationMs?: number }
  ): IQueueConsumer<WorkflowExecutionJobPayload>;
  createDelayConsumer(
    processor: (job: QueueJob<WorkflowDelayJobPayload>) => Promise<unknown>,
    options?: { concurrency?: number }
  ): IQueueConsumer<WorkflowDelayJobPayload>;
  closeAll(): Promise<void>;
}
