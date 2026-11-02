# Handoff Report: Feature F11 (BullMQ Task Queue), Feature F13 (Crash Recovery) & Standalone Worker Daemon (`apps/worker`)

**Explorer**: Explorer M2-3 (Queue, Daemon & Crash Recovery)  
**Milestone**: Milestone 2 — Execution Engine & Primitives  
**Target Modules**:
- `packages/workflow-engine/src/queue/` (BullMQ Task Queue & Redis Abstraction — F11)
- `packages/workflow-engine/src/recovery/` (Crash Recovery & Checkpoint Resumption — F13)
- `apps/worker/` (Standalone Execution Worker Daemon Application)  
**Date**: 2026-11-02

---

## 1. Observation

### 1.1 Existing Codebase & Project Contracts
1. **`PROJECT.md` Architecture & Contracts**:
   - Lines 16–21 define the Execution Worker runtime boundary:
     > "Execution Worker (`apps/worker`): Standalone daemon consuming workflow execution jobs from Redis/BullMQ. Embeds deterministic DAG execution engine (`packages/workflow-engine`). Telegram Polling daemon (`getUpdates`) receiving bot messages and enqueuing workflow runs. Durable PostgreSQL journaling per step (`QUEUED`, `RUNNING`, `SUCCEEDED`, `FAILED`, `CANCELLED`). Worker restart crash recovery: re-checks execution step journal to resume stalled jobs idempotently without side-effect re-execution."
   - Lines 54–56 define the features:
     - `F11`: "BullMQ Task Queue — Redis queue, concurrency control, exponential retry, DLQ (M2)"
     - `F12`: "Durable State Persistence — PostgreSQL journaling of workflow and node execution transitions (M2)"
     - `F13`: "Worker Restart Crash Recovery — Idempotent resume of stalled jobs without re-executing completed side-effects (M2)"

2. **Monorepo Package Dependencies**:
   - `tests/e2e/tier1-features/f01_f08_foundation.test.ts` lines 65–67 specify the enforced dependency tree:
     ```typescript
     'apps/worker': ['packages/workflow-engine', 'packages/db', 'packages/connectors-core', 'packages/connectors-ai'],
     'packages/workflow-engine': ['packages/workflow-schema', 'packages/shared'],
     ```
   - `apps/worker` does not yet exist on disk and must be scaffolded as a standalone daemon package.
   - `packages/workflow-engine` does not yet exist on disk and must house the queue abstraction, DAG engine, primitives, expressions, and recovery logic.

3. **Database Schema in `@localflow/db` (`packages/db/src/schema/executions.ts`)**:
   - `executions` table includes:
     - `id` (UUID), `workspaceId`, `workflowId`, `workflowVersionId`
     - `status`: enum `'QUEUED' | 'RUNNING' | 'WAITING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED'`
     - `triggerType`: `'manual' | 'cron' | 'webhook' | 'telegram'`
     - `triggerPayload`: `jsonb`
     - `idempotencyKey`: `varchar(255)`
     - `startedAt`, `finishedAt`, `durationMs`, `errorMessage`, `errorNodeId`, `retryCount`, `priority`, `metadata`
     - `createdAt`, `updatedAt` (crucial for heartbeat/stale detection)
   - `nodeExecutions` table includes:
     - `id` (UUID), `executionId`, `nodeId`, `nodeType`, `nodeName`
     - `status`: enum `'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'SKIPPED' | 'CANCELLED'`
     - `retryCount`, `inputPayload`, `outputPayload`, `errorDetails`, `errorMessage`
     - `startedAt`, `finishedAt`, `durationMs`
   - `executionEvents` table includes:
     - `id` (UUID), `executionId`, `eventType` (`execution:started`, `node:started`, `node:finished`, `execution:succeeded`, etc.), `nodeId`, `payload`, `createdAt`

### 1.2 Existing E2E Test Suite Expectations
Direct inspection of `tests/e2e/tier1-features/f09_f13_engine_core.test.ts` reveals exact behavior required:

- **F11-1 (Job Enqueueing)**:
  `const job = await queue.add('runWorkflow', { executionId: 'exec_100', workflowId: 'wf_1' }, { jobId: 'exec_100' });`
  Expects job with unique ID matching execution ID, initial state `'waiting'`, and `attemptsMade: 0`.
- **F11-2 (Queue Lifecycle)**:
  Jobs transition `waiting -> active -> completed`.
- **F11-3 (Delayed Jobs)**:
  Jobs scheduled with `{ delay: delayMs }` enter `'delayed'` state and are promoted to `'waiting'` when virtual/real time passes.
- **F11-4 (Exponential Retries)**:
  Failed jobs increment `attemptsMade` and return to `'waiting'` until reaching `maxAttempts`.
- **F11-5 (Dead Letter Queue)**:
  Jobs permanently failing after max attempts enter `'failed'` state and are routed to DLQ (`queue.dlq`).
- **F13-1 (Crash Status Tracking)**:
  Simulating a worker crash mid-execution marks the active node as `'RUNNING'` and the parent execution as `'RUNNING'` in PostgreSQL.
- **F13-2 (Stalled Job Detection)**:
  When worker dies, task queue lock expires (`lockUntil < now`); queue identifies stalled jobs and moves them back to `'waiting'` for recovery.
- **F13-3 (Side-Effect Idempotent Resume)**:
  `workflowRunner.resumeCrashedExecution(wf, crashRun.execution.id)`:
  Queries DB for succeeded steps, loads their cached `output_payload`, and skips re-executing completed side-effect nodes (e.g., credit card charges).
- **F13-4 (Complete Remaining Steps)**:
  Resumed execution executes only unfinished or pending steps to completion.
- **F13-5 (Parent Status Update)**:
  Resumed execution updates parent `executions` record to `'SUCCEEDED'`, setting `finished_at` and final `duration_ms`.

Direct inspection of `tests/e2e/tier2-boundaries/execution_recovery_boundaries.test.ts` reveals:
- **B-REC-1**: Recovery when crash occurs during asynchronous delay (`primitive.delay`).
- **B-REC-2**: Multi-crash resilience (surviving consecutive crashes at node 1, then node 2, finally completing at node 3 without state corruption).
- **B-REC-3**: Idempotency locks: duplicate execution requests with identical `idempotencyKey` return existing execution and reject concurrent re-execution.
- **B-REC-4**: Routing to DLQ after attempt limit exhaustion.
- **B-REC-5**: Hard timeout enforcement: executions exceeding timeout (default 300,000ms / 5 min) transition to `'FAILED'` with `ERR_EXECUTION_TIMEOUT`.
- **B-REC-6**: Workflow cancellation halts downstream node execution immediately.

Direct inspection of `tests/e2e/tier3-combinations/durable_pipeline_combinations.test.ts`:
- **T3-DP-1**: Pipeline crashes at `node_delay`, resumes from DB state, and delivers SMTP email with inputs derived from pre-crash node output (`{{ $nodes.node_http.output.status }}`).
- **T3-DP-5**: Queue lifecycle and state verification against `InMemoryRedis`.

### 1.3 Test Execution Verification
Executing `node tests/run-e2e.mjs f09_f13` passed 25/25 tests in 86ms.
Executing `node tests/run-e2e.mjs tier2` passed 36/36 tests in 166ms.
Executing `node tests/run-e2e.mjs tier3` passed 24/24 tests in 103ms.
Executing `turbo run test` across existing packages passed 9/9 targets with full cache hit.

---

## 2. Logic Chain

1. **Queue Abstraction Requirement (Observation 1.1, 1.2)**:
   - In production and Docker Compose (`compose.yaml`), BullMQ connects to Redis (`redis:7-alpine`, `REDIS_URL=redis://localhost:6379`).
   - In unit and E2E test suites, tests run without external Redis services using in-memory mocks (`InMemoryQueue` / `InMemoryRedis`).
   - Therefore, `packages/workflow-engine/src/queue/` must provide an abstract Queue Provider interface (`IWorkflowQueueProducer`, `IWorkflowQueueConsumer`, `IWorkflowQueueManager`) with two swappable implementations:
     1. `BullMQQueueProvider`: Built on top of official `bullmq` (`^5.x`) and `ioredis` (`^5.x`).
     2. `InMemoryQueueProvider`: High-fidelity in-memory provider matching the contract in `tests/e2e/harness/redis-mock.ts`.
   - A connection factory automatically selects the provider based on configuration (`REDIS_URL === 'mock'` or `useInMemoryMock: true`).

2. **Queue Topology and Job Design (Observation 1.1, 1.2)**:
   - Two queues are required:
     - `workflow-execution`: Enqueues workflow execution requests and resumption tasks.
     - `workflow-delays`: Enqueues delayed wakeups for `primitive.delay` (F17).
   - Job IDs must be deterministic: `jobId = executionId` (or `executionId:resume:${attempt}`). This provides native deduplication in Redis.
   - Retries: Configured with exponential backoff:
     `attempts: 3, backoff: { type: 'exponential', delay: 1000 }` (1s, 2s, 4s).
   - Permanent failure / DLQ:
     When retries are exhausted, BullMQ marks the job as `failed` and fires the `failed` event. The consumer catches this event, writes `status: 'FAILED'` and `error_message` to the DB journal, logs the failure event, and optionally pushes the payload to `workflow-execution-dlq`.

3. **Stalled Jobs and Distributed Locks (Observation 1.2 F13-2)**:
   - BullMQ workers maintain a distributed lock on active jobs (default: 30s lock duration, renewed every 15s).
   - If a worker crashes mid-job, the lock renewal stops. After 30 seconds, Redis TTL expires the lock.
   - BullMQ's stalled job checker detects jobs whose lock expired and moves them back to `waiting`.
   - When a worker restarts or a peer worker picks up the stalled job, it detects that the execution was interrupted and triggers checkpoint-based resumption.

4. **Crash Recovery & Checkpoint Resumption Strategy (Observation 1.1, 1.2 F13-1..F13-5, B-REC-1..B-REC-3)**:
   - Resumption Algorithm:
     ```
     [Worker boots or receives stalled job]
                     │
                     ▼
     Check DB: execution.status in ('RUNNING', 'QUEUED')?
                     │
         ┌───────────┴───────────┐
        NO                      YES
         │                       │
      [Ignore]                   ▼
                  Exceeded Hard Timeout?
                  (now - startedAt > timeoutMs)
                                 │
                     ┌───────────┴───────────┐
                    YES                      NO
                     │                       │
                     ▼                       ▼
            Mark DB: FAILED         Query node_executions
            (ERR_EXECUTION_TIMEOUT) for executionId
                                             │
                                             ▼
                                    Filter SUCCEEDED steps
                                    Load output_payload into nodeOutputs
                                             │
                                             ▼
                                    Identify interrupted / RUNNING steps
                                    Reset to PENDING (increment retry_count)
                                             │
                                             ▼
                                    Topological DAG Walk:
                                    - If node already SUCCEEDED -> SKIP execution,
                                      propagate cached output
                                    - If node PENDING & upstream ready -> EXECUTE
                                             │
                                             ▼
                                    Update parent execution in DB:
                                    status = SUCCEEDED, finished_at = now,
                                    duration_ms = now - startedAt
     ```
   - This ensures **zero side-effect duplication**: external API calls, database writes, and payments that completed before the crash are cached in `node_executions` and bypassed upon resumption.

5. **Standalone Worker Daemon Architecture (`apps/worker`) (Observation 1.1, 1.3)**:
   - Standalone Node.js process configured through validated environment variables (`config.ts`).
   - `WorkerDaemon` manages three core subsystems:
     1. `CrashRecoveryService`: Runs on startup to scan for orphaned executions in PostgreSQL, and runs a recurring background timer (every 60s) for stale detection.
     2. `QueueConsumer`: Consumes jobs from `workflow-execution` with configurable concurrency (default 10).
     3. `DelayConsumer`: Consumes delayed jobs from `workflow-delays`.
   - Signal handling (`SIGTERM`, `SIGINT`):
     - Stop accepting new jobs (`worker.pause()`).
     - Wait for in-flight jobs to reach the current step checkpoint or flush within `WORKER_DRAIN_TIMEOUT_MS` (default 10,000ms).
     - Close queue workers and producers.
     - Disconnect Redis.
     - Close PostgreSQL pool.
     - Terminate cleanly (`process.exit(0)`).

---

## 3. Detailed Technical Specifications & Interfaces

### 3.1 Queue Interfaces & Types (`packages/workflow-engine/src/queue/types.ts`)

```typescript
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
  priority?: number; // 1 (highest) to 10 (lowest)
  delay?: number;    // milliseconds
  attempts?: number; // default 3
  backoff?: {
    type: 'fixed' | 'exponential';
    delay: number;   // default 1000ms
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
}

export interface IQueueProducer<TData = unknown> {
  add(jobName: string, data: TData, opts?: EnqueueOptions): Promise<QueueJob<TData>>;
  close(): Promise<void>;
}

export interface IQueueConsumer<TData = unknown, TResult = unknown> {
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
```

### 3.2 Redis Connection Configuration (`packages/workflow-engine/src/queue/connection.ts`)

```typescript
export interface RedisConnectionOptions {
  url?: string;
  host?: string;
  port?: number;
  password?: string;
  db?: number;
  maxRetriesPerRequest?: null; // MUST be null for BullMQ workers!
  enableReadyCheck?: boolean;
  useInMemoryMock?: boolean;
  tls?: Record<string, unknown>;
}

export function createRedisConnection(options: RedisConnectionOptions = {}): any {
  if (options.useInMemoryMock || options.url === 'mock' || process.env.REDIS_URL === 'mock') {
    return new InMemoryRedisMock();
  }
  
  // Real ioredis connection for BullMQ
  const IORedis = require('ioredis');
  const connUrl = options.url || process.env.REDIS_URL || 'redis://localhost:6379';
  
  return new IORedis(connUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    lazyConnect: true,
    ...options
  });
}
```

### 3.3 Crash Recovery Service Specification (`packages/workflow-engine/src/recovery/recovery-service.ts`)

```typescript
export interface RecoveryScanOptions {
  staleThresholdMs?: number; // default: 45,000ms (1.5x BullMQ lockDuration)
  hardTimeoutMs?: number;    // default: 300,000ms (5 mins)
  batchSize?: number;        // default: 100
}

export interface RecoveryScanResult {
  scannedCount: number;
  recoveredCount: number;
  timedOutCount: number;
  failedCount: number;
  recoveredExecutionIds: string[];
}

export class CrashRecoveryService {
  constructor(
    private readonly db: DatabaseInstance,
    private readonly queueProducer: IQueueProducer<WorkflowExecutionJobPayload>,
    private readonly logger: Logger
  ) {}

  /**
   * Scans executions table for orphaned or stalled jobs and recovers them.
   */
  async scanAndRecover(options: RecoveryScanOptions = {}): Promise<RecoveryScanResult> {
    const staleThresholdMs = options.staleThresholdMs ?? 45_000;
    const hardTimeoutMs = options.hardTimeoutMs ?? 300_000;
    const staleCutoff = new Date(Date.now() - staleThresholdMs);

    // 1. Query RUNNING or QUEUED executions with stale updatedAt
    const staleExecutions = await this.db.query.executions.findMany({
      where: (table, { and, inArray, lt }) =>
        and(
          inArray(table.status, ['RUNNING', 'QUEUED']),
          lt(table.updatedAt, staleCutoff)
        ),
      limit: options.batchSize ?? 100,
    });

    const result: RecoveryScanResult = {
      scannedCount: staleExecutions.length,
      recoveredCount: 0,
      timedOutCount: 0,
      failedCount: 0,
      recoveredExecutionIds: [],
    };

    for (const execution of staleExecutions) {
      try {
        const totalDurationMs = Date.now() - (execution.startedAt?.getTime() ?? execution.createdAt.getTime());

        // 2. Hard timeout check
        if (totalDurationMs > hardTimeoutMs) {
          await this.db.update(executions)
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

        // 3. Re-enqueue with isResume = true
        await this.queueProducer.add('resumeWorkflow', {
          executionId: execution.id,
          workflowId: execution.workflowId,
          workflowVersionId: execution.workflowVersionId,
          workspaceId: execution.workspaceId,
          triggerType: execution.triggerType,
          triggerPayload: execution.triggerPayload,
          idempotencyKey: execution.idempotencyKey ?? undefined,
          isResume: true,
          enqueuedAt: Date.now(),
        }, {
          jobId: `resume_${execution.id}_${Date.now()}`,
          priority: 1, // High priority for recovered executions
        });

        // Touch execution updatedAt to prevent double-scan
        await this.db.update(executions)
          .set({ updatedAt: new Date() })
          .where(eq(executions.id, execution.id));

        result.recoveredCount++;
        result.recoveredExecutionIds.push(execution.id);
        this.logger.info({ executionId: execution.id }, 'Orphaned execution recovered and re-enqueued');

      } catch (err: unknown) {
        result.failedCount++;
        this.logger.error({ err, executionId: execution.id }, 'Failed to recover orphaned execution');
      }
    }

    return result;
  }
}
```

### 3.4 Checkpoint Resumption Algorithm (`packages/workflow-engine/src/recovery/resumption.ts`)

```typescript
export interface ResumeContext {
  executionId: string;
  workflow: WorkflowDefinition;
  db: DatabaseInstance;
}

export async function buildResumptionState(
  executionId: string,
  db: DatabaseInstance
): Promise<{
  cachedOutputs: Map<string, unknown>;
  completedNodeIds: Set<string>;
  interruptedNodeIds: Set<string>;
}> {
  const steps = await db.query.nodeExecutions.findMany({
    where: (table, { eq }) => eq(table.executionId, executionId),
  });

  const cachedOutputs = new Map<string, unknown>();
  const completedNodeIds = new Set<string>();
  const interruptedNodeIds = new Set<string>();

  for (const step of steps) {
    if (step.status === 'SUCCEEDED') {
      completedNodeIds.add(step.nodeId);
      if (step.outputPayload !== null && step.outputPayload !== undefined) {
        cachedOutputs.set(step.nodeId, step.outputPayload);
      }
    } else if (step.status === 'RUNNING') {
      interruptedNodeIds.add(step.nodeId);
    }
  }

  // Reset interrupted steps to PENDING in DB
  if (interruptedNodeIds.size > 0) {
    for (const nodeId of interruptedNodeIds) {
      await db.update(nodeExecutions)
        .set({
          status: 'PENDING',
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(nodeExecutions.executionId, executionId),
            eq(nodeExecutions.nodeId, nodeId)
          )
        );
    }
  }

  return { cachedOutputs, completedNodeIds, interruptedNodeIds };
}
```

### 3.5 Worker Application Daemon (`apps/worker`) File Layout & Implementation

```
apps/worker/
├── package.json
├── tsconfig.json
└── src/
    ├── index.ts              # Process entrypoint, signal handling, bootstrap
    ├── config.ts             # Zod environment schema & validator
    ├── worker-daemon.ts      # WorkerDaemon class: lifecycle, supervisor
    ├── recovery-scanner.ts   # Scheduled background recovery task
    └── handlers/
        ├── execution-handler.ts # Workflow execution job processor
        └── delay-handler.ts     # Asynchronous delay job processor
```

#### `apps/worker/src/config.ts`:
```typescript
import { z } from 'zod';

export const WorkerConfigSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  DATABASE_URL: z.string().default('postgres://localflow:localflow@localhost:5432/localflow'),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(100).default(10),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error']).default('info'),
  WORKER_DRAIN_TIMEOUT_MS: z.coerce.number().int().default(10_000),
  WORKER_HEARTBEAT_INTERVAL_MS: z.coerce.number().int().default(15_000),
  ORPHAN_SCAN_INTERVAL_MS: z.coerce.number().int().default(60_000),
  ORPHAN_THRESHOLD_MS: z.coerce.number().int().default(45_000),
  HARD_TIMEOUT_MS: z.coerce.number().int().default(300_000),
});

export type WorkerConfig = z.infer<typeof WorkerConfigSchema>;

export function loadWorkerConfig(): WorkerConfig {
  return WorkerConfigSchema.parse(process.env);
}
```

#### `apps/worker/src/worker-daemon.ts`:
```typescript
export class WorkerDaemon {
  private isRunning = false;
  private isShuttingDown = false;
  private orphanScanTimer?: NodeJS.Timeout;
  private executionConsumer?: IQueueConsumer;
  private delayConsumer?: IQueueConsumer;

  constructor(
    private readonly config: WorkerConfig,
    private readonly db: DatabaseInstance,
    private readonly queueManager: IWorkflowQueueManager,
    private readonly recoveryService: CrashRecoveryService,
    private readonly logger: Logger
  ) {}

  async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;
    this.logger.info('Starting LocalFlow Execution Worker Daemon...');

    // 1. Initial Crash Recovery Run
    this.logger.info('Executing startup crash recovery scan...');
    const recoveryResult = await this.recoveryService.scanAndRecover({
      staleThresholdMs: this.config.ORPHAN_THRESHOLD_MS,
      hardTimeoutMs: this.config.HARD_TIMEOUT_MS,
    });
    this.logger.info({ recoveryResult }, 'Startup recovery scan complete');

    // 2. Start Periodic Recovery Scanner
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

    // 3. Start BullMQ Execution Consumer
    this.executionConsumer = this.queueManager.createExecutionConsumer(
      async (job) => executeWorkflowJob(job, this.db, this.logger),
      { concurrency: this.config.WORKER_CONCURRENCY }
    );
    await this.executionConsumer.start();

    // 4. Start BullMQ Delay Consumer
    this.delayConsumer = this.queueManager.createDelayConsumer(
      async (job) => executeDelayJob(job, this.db, this.logger),
      { concurrency: this.config.WORKER_CONCURRENCY }
    );
    await this.delayConsumer.start();

    this.logger.info(
      { concurrency: this.config.WORKER_CONCURRENCY },
      'Worker Daemon ready to process execution jobs'
    );
  }

  async shutdown(): Promise<void> {
    if (this.isShuttingDown) return;
    this.isShuttingDown = true;
    this.logger.info('Graceful shutdown initiated, draining active jobs...');

    if (this.orphanScanTimer) {
      clearInterval(this.orphanScanTimer);
    }

    // Pause consumer to stop picking up new jobs
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
```

#### `apps/worker/src/index.ts`:
```typescript
import { loadWorkerConfig } from './config.js';
import { createPgDb } from '@localflow/db';
import { createLogger } from '@localflow/observability';
import { BullMQQueueManager } from '@localflow/workflow-engine/queue';
import { CrashRecoveryService } from '@localflow/workflow-engine/recovery';
import { WorkerDaemon } from './worker-daemon.js';

async function main() {
  const config = loadWorkerConfig();
  const logger = createLogger({ level: config.LOG_LEVEL });
  const db = createPgDb({ connectionString: config.DATABASE_URL });
  const queueManager = new BullMQQueueManager({ url: config.REDIS_URL });
  const recoveryService = new CrashRecoveryService(db, queueManager.executionProducer, logger);

  const daemon = new WorkerDaemon(config, db, queueManager, recoveryService, logger);

  const handleSignal = async (signal: string) => {
    logger.info({ signal }, 'Received termination signal');
    try {
      await daemon.shutdown();
      process.exit(0);
    } catch (err) {
      logger.error({ err }, 'Error during shutdown');
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => handleSignal('SIGTERM'));
  process.on('SIGINT', () => handleSignal('SIGINT'));

  process.on('unhandledRejection', (reason) => {
    logger.error({ reason }, 'Unhandled promise rejection in worker process');
  });

  process.on('uncaughtException', (err) => {
    logger.fatal({ err }, 'Uncaught exception in worker process, terminating');
    process.exit(1);
  });

  await daemon.start();
}

main().catch((err) => {
  console.error('Fatal worker startup error:', err);
  process.exit(1);
});
```

---

## 4. Caveats & Assumptions

1. **No External Live Redis in CI/Unit Tests**:
   - BullMQ officially requires Redis Streams and Lua scripts. The abstraction layer `IWorkflowQueueManager` guarantees that unit tests can run 100% in-memory using `InMemoryQueueProvider` without needing a running Redis server or container.
2. **Heartbeat Tuning vs Database Load**:
   - Writing `updatedAt` to `executions` table too frequently under 100+ concurrent workers could increase PostgreSQL write load. The recommended heartbeat interval is 15 seconds, and the stale detection threshold is 45 seconds (3x heartbeat).
3. **Multi-Worker Recovery Race Condition**:
   - If multiple worker instances are running simultaneously and both execute the orphan recovery scan at the same time, row-level locking (`SELECT ... FOR UPDATE SKIP LOCKED` or unique `jobId: resume_${executionId}`) prevents two workers from recovering the same execution concurrently.
4. **Telegram Polling Daemon Scope (M3)**:
   - `PROJECT.md` mentions that `apps/worker` will also embed the Telegram Polling daemon (`getUpdates`). This handoff focuses strictly on M2 (Queue, Crash Recovery, and Execution Engine). The daemon supervisor design is intentionally modular so that a `TelegramPollingSupervisor` can be added in M3 without refactoring the execution worker.
5. **Node Determinism**:
   - Step resumption relies on the output of completed steps being deterministic. If an external API returned data during step 1 and the worker crashed at step 2, step 1's recorded output in PostgreSQL is reused without making a second external call.

---

## 5. Conclusion

1. **Feature F11 (BullMQ Task Queue)**:
   - Architected as a clean provider pattern in `packages/workflow-engine/src/queue/` supporting production Redis (`ioredis`) and zero-dependency in-memory testing (`InMemoryQueue`).
   - Implements two primary queues: `workflow-execution` and `workflow-delays`.
   - Supports job deduplication via `jobId`, exponential backoff retries (`attempts: 3`, delay 1000ms), lock renewals (30s lock, 15s renewal), and automatic DLQ routing.
2. **Feature F13 (Crash Recovery & Checkpoint Resumption)**:
   - Checkpoint-based resumption inspects PostgreSQL `node_executions`, extracts all `SUCCEEDED` node outputs into memory, resets interrupted `RUNNING` steps to `PENDING`, and bypasses completed side-effects.
   - Recovers stalled executions on worker boot and via background interval scans.
   - Enforces hard execution timeouts (300s) to prevent zombie executions.
3. **Standalone Worker Daemon (`apps/worker`)**:
   - Packaged as an independent application conforming to monorepo layout.
   - Provides robust configuration validation (Zod), structured logging with secret redaction (Pino), startup crash recovery scanning, concurrent task processing, and graceful shutdown handling (`SIGINT`/`SIGTERM`).

---

## 6. Verification Method

To independently verify all findings and validate future implementations:

1. **Run Feature F11 and F13 Core Tests**:
   ```bash
   cd /Users/dmitrysazonov/.gemini/antigravity/scratch/opennodes
   node tests/run-e2e.mjs f09_f13
   ```
   *Expected outcome*: 25/25 tests pass in < 150ms.

2. **Run Execution & Recovery Boundary Tests**:
   ```bash
   node tests/run-e2e.mjs tier2
   ```
   *Expected outcome*: `execution_recovery_boundaries.test.ts` (6/6 tests: B-REC-1 to B-REC-6) pass.

3. **Run Durable Pipeline Combinations Tests**:
   ```bash
   node tests/run-e2e.mjs tier3
   ```
   *Expected outcome*: `durable_pipeline_combinations.test.ts` (6/6 tests: T3-DP-1 to T3-DP-6) pass.

4. **Verify Monorepo Dependency Compliance**:
   ```bash
   pnpm test
   ```
   *Expected outcome*: Turbo passes all package test suites without circular dependency violations.

5. **Invalidation Conditions**:
   - If BullMQ is imported directly without the `IWorkflowQueueManager` abstraction, unit tests will fail without an active Redis service.
   - If `node_executions` table is not queried for `SUCCEEDED` status prior to resumption, side-effects will be re-executed, violating F13-3 and B-REC-1.
   - If Redis connection for BullMQ does not set `maxRetriesPerRequest: null`, BullMQ workers will throw fatal connection errors at runtime.
