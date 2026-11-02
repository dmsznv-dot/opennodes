/**
 * LocalFlow E2E Test Suite - In-Memory Redis & BullMQ Mock
 * Provides accurate simulation of BullMQ job queue, delayed jobs, distributed locks, and Redis pub/sub.
 */

export interface JobOptions {
  jobId?: string;
  delay?: number;
  attempts?: number;
  backoff?: {
    type: 'fixed' | 'exponential';
    delay: number;
  };
  removeOnComplete?: boolean;
  removeOnFail?: boolean;
}

export type JobState = 'waiting' | 'active' | 'delayed' | 'completed' | 'failed' | 'stalled';

export interface MockJob<T = unknown> {
  id: string;
  name: string;
  data: T;
  opts: JobOptions;
  state: JobState;
  attemptsMade: number;
  failedReason?: string;
  returnvalue?: unknown;
  timestamp: number;
  processedOn?: number;
  finishedOn?: number;
  delayUntil?: number;
  lockUntil?: number;
}

export class InMemoryRedis {
  private kv = new Map<string, string>();
  private expirations = new Map<string, number>();
  private subscribers = new Map<string, Set<(message: string) => void>>();

  async set(key: string, value: string, mode?: string, duration?: number): Promise<'OK' | null> {
    if (mode === 'NX' && this.existsInternal(key)) {
      return null;
    }
    this.kv.set(key, value);
    if (duration) {
      this.expirations.set(key, Date.now() + duration * 1000);
    } else {
      this.expirations.delete(key);
    }
    return 'OK';
  }

  async get(key: string): Promise<string | null> {
    if (!this.existsInternal(key)) {
      return null;
    }
    return this.kv.get(key) ?? null;
  }

  async del(key: string): Promise<number> {
    const existed = this.kv.delete(key);
    this.expirations.delete(key);
    return existed ? 1 : 0;
  }

  async exists(key: string): Promise<number> {
    return this.existsInternal(key) ? 1 : 0;
  }

  private existsInternal(key: string): boolean {
    if (!this.kv.has(key)) return false;
    const exp = this.expirations.get(key);
    if (exp && Date.now() > exp) {
      this.kv.delete(key);
      this.expirations.delete(key);
      return false;
    }
    return true;
  }

  async publish(channel: string, message: string): Promise<number> {
    const subs = this.subscribers.get(channel);
    if (!subs || subs.size === 0) return 0;
    for (const callback of subs) {
      callback(message);
    }
    return subs.size;
  }

  subscribe(channel: string, callback: (message: string) => void): () => void {
    if (!this.subscribers.has(channel)) {
      this.subscribers.set(channel, new Set());
    }
    const set = this.subscribers.get(channel)!;
    set.add(callback);
    return () => {
      set.delete(callback);
    };
  }

  flushall(): void {
    this.kv.clear();
    this.expirations.clear();
    this.subscribers.clear();
  }

  reset(): void {
    this.flushall();
  }
}

export class InMemoryQueue<T = unknown> {
  name: string;
  jobs: Map<string, MockJob<T>> = new Map();
  dlq: MockJob<T>[] = [];
  private jobCounter = 1;

  constructor(name: string) {
    this.name = name;
  }

  async add(name: string, data: T, opts: JobOptions = {}): Promise<MockJob<T>> {
    const id = opts.jobId || `${this.name}_${this.jobCounter++}`;
    const now = Date.now();
    const delay = opts.delay || 0;
    const job: MockJob<T> = {
      id,
      name,
      data,
      opts,
      state: delay > 0 ? 'delayed' : 'waiting',
      attemptsMade: 0,
      timestamp: now,
      delayUntil: delay > 0 ? now + delay : undefined
    };

    this.jobs.set(id, job);
    return job;
  }

  async getJob(id: string): Promise<MockJob<T> | undefined> {
    return this.jobs.get(id);
  }

  async getWaiting(): Promise<MockJob<T>[]> {
    this.promoteDelayedJobs();
    return Array.from(this.jobs.values()).filter(j => j.state === 'waiting');
  }

  async getActive(): Promise<MockJob<T>[]> {
    return Array.from(this.jobs.values()).filter(j => j.state === 'active');
  }

  async getCompleted(): Promise<MockJob<T>[]> {
    return Array.from(this.jobs.values()).filter(j => j.state === 'completed');
  }

  async getFailed(): Promise<MockJob<T>[]> {
    return Array.from(this.jobs.values()).filter(j => j.state === 'failed');
  }

  async getDelayed(): Promise<MockJob<T>[]> {
    return Array.from(this.jobs.values()).filter(j => j.state === 'delayed');
  }

  promoteDelayedJobs(currentTime: number = Date.now()): number {
    let promoted = 0;
    for (const job of this.jobs.values()) {
      if (job.state === 'delayed' && job.delayUntil && currentTime >= job.delayUntil) {
        job.state = 'waiting';
        job.delayUntil = undefined;
        promoted++;
      }
    }
    return promoted;
  }

  async processNext(processor: (job: MockJob<T>) => Promise<unknown>, lockDurationMs: number = 30000): Promise<MockJob<T> | null> {
    this.promoteDelayedJobs();
    const waiting = Array.from(this.jobs.values()).find(j => j.state === 'waiting');
    if (!waiting) return null;

    waiting.state = 'active';
    waiting.processedOn = Date.now();
    waiting.lockUntil = Date.now() + lockDurationMs;
    waiting.attemptsMade++;

    try {
      const result = await processor(waiting);
      waiting.state = 'completed';
      waiting.finishedOn = Date.now();
      waiting.returnvalue = result;
      return waiting;
    } catch (err: unknown) {
      const maxAttempts = waiting.opts.attempts || 1;
      const errorMsg = err instanceof Error ? err.message : String(err);
      waiting.failedReason = errorMsg;

      if (waiting.attemptsMade < maxAttempts) {
        waiting.state = 'waiting'; // ready for retry
      } else {
        waiting.state = 'failed';
        waiting.finishedOn = Date.now();
        this.dlq.push(waiting);
      }
      throw err;
    }
  }

  simulateStalledJobs(stallThresholdMs: number = 30000): MockJob<T>[] {
    const now = Date.now();
    const stalled: MockJob<T>[] = [];
    for (const job of this.jobs.values()) {
      if (job.state === 'active' && job.lockUntil && now > job.lockUntil) {
        job.state = 'waiting'; // re-queued for recovery
        stalled.push(job);
      }
    }
    return stalled;
  }

  clear(): void {
    this.jobs.clear();
    this.dlq = [];
    this.jobCounter = 1;
  }
}

export const redisMock = new InMemoryRedis();
export const workflowExecutionQueue = new InMemoryQueue('workflow-execution');
export const workflowDelayQueue = new InMemoryQueue('workflow-delays');
