# Handoff Report: Feature F10 (Execution Engine Core) & Feature F12 (Durable State Persistence)

**Author**: Explorer M2-2 (DAG Engine & State Persistence Explorer)  
**Date**: 2026-11-02  
**Milestone**: Milestone 2 (Execution Engine & Primitives)  
**Scope**: `packages/workflow-engine/src/engine/` & `packages/workflow-engine/src/persistence/`

---

## 1. Observation

Direct observations from examining the codebase, specifications, existing contracts, and test suites:

### 1.1 Existing Type Contracts and Schemas
- **`packages/workflow-schema/src/schemas/node.ts` (lines 13–21, 35–43)**:
  `NodeExecutionPolicySchema` defines `maxRetries` (0–5, default 0), `backoffType` (`'exponential' | 'fixed'`), `initialIntervalMs`, `maxIntervalMs`, `timeoutMs` (500–300000ms), and `continueOnError` (boolean, default false).
  `WorkflowNodeSchema` defines `id`, `type`, `data` (`label`, `config`, `credentialId`, `executionPolicy`), `inputs: NodePort[]`, and `outputs: NodePort[]`.
- **`packages/workflow-schema/src/schemas/edge.ts` (lines 3–9)**:
  `WorkflowEdgeSchema` defines `id`, `source`, `sourceHandle`, `target`, `targetHandle`.
- **`packages/workflow-schema/src/schemas/workflow.ts` (lines 13–25)**:
  `WorkflowDefinitionSchema` defines `id`, `workspaceId`, `name`, `schemaVersion: '1.0'`, `nodes`, `edges`, `triggerConfig`, and `executionPolicy` (`executionTimeoutMs` default 300000ms = 5 mins, `maxConcurrency` default 5).
- **`packages/workflow-schema/src/schemas/events.ts` (lines 3–19)**:
  `ExecutionStatusSchema`: `'QUEUED' | 'RUNNING' | 'WAITING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED'`.
  `NodeStatusSchema`: `'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'SKIPPED' | 'CANCELLED'`.
- **`packages/workflow-schema/src/validation/cycle-detector.ts` (lines 14–87)**:
  Exports `detectCycles(nodes, edges)` returning `CycleDetectionResult` (`hasCycle: boolean`, `topologicalOrder: string[]`, `cycleNodes: string[]`, `cyclePath: string[]`). Implements Kahn's Algorithm in O(V + E).

### 1.2 Existing Database Models and Tables
- **`packages/db/src/schema/executions.ts` (lines 6–107)**:
  - `executions`: `id` (uuid PK), `workspaceId` (uuid FK), `workflowId` (uuid FK), `workflowVersionId` (uuid FK), `status` (`execution_status`), `triggerType` (varchar), `triggerPayload` (jsonb), `idempotencyKey` (varchar), `startedAt` (timestamp with tz), `finishedAt` (timestamp with tz), `durationMs` (integer), `errorMessage` (text), `errorNodeId` (varchar), `retryCount` (integer), `priority` (integer), `metadata` (jsonb).
  - `nodeExecutions`: `id` (uuid PK), `executionId` (uuid FK), `nodeId` (varchar), `nodeType` (varchar), `nodeName` (varchar), `status` (`node_status`), `retryCount` (integer), `inputPayload` (jsonb), `outputPayload` (jsonb), `errorDetails` (jsonb), `errorMessage` (text), `startedAt` (timestamp with tz), `finishedAt` (timestamp with tz), `durationMs` (integer).
  - `executionLogs`: `id` (uuid PK), `executionId` (uuid FK), `nodeExecutionId` (uuid FK), `nodeId` (varchar), `level` (varchar), `message` (text), `metadata` (jsonb), `timestamp` (timestamp with tz).
  - `executionEvents`: `id` (uuid PK), `executionId` (uuid FK), `eventType` (varchar), `nodeId` (varchar), `payload` (jsonb), `createdAt` (timestamp with tz).
- **`packages/db/src/client.ts` (lines 9–11, 43–48)**:
  Exports `DatabaseInstance = PgDatabaseInstance | PgliteDatabaseInstance`.
  Exports `createPgDb(options)` for PostgreSQL pool and `createInMemoryDb()` returning `PgliteDatabaseInstance` with schema auto-synced.
- **`packages/db/tests/db.test.ts` (lines 197–313)**:
  Demonstrates transactional lifecycle test against PGlite: inserts execution in `QUEUED`, transitions to `RUNNING` with `startedAt`, creates `nodeExecutions` in `RUNNING`, appends logs and events, completes step to `SUCCEEDED` with `outputPayload`, and completes execution to `SUCCEEDED` with `durationMs`.

### 1.3 Existing Redaction Pipeline
- **`packages/observability/src/redaction/redactor.ts` (lines 28–99)**:
  Exports `redact(value, options)` which traverses objects up to depth 25, checks `isSensitiveKey(key)` (`password`, `token`, `secret`, `authorization`, etc.) and token regex patterns, and replaces sensitive values with `'[REDACTED]'`.

### 1.4 E2E Test Expectations (`tests/e2e/tier1-features/f09_f13_engine_core.test.ts`)
- **F10-1**: Sequential 3-node DAG (`trig -> step_1 -> step_2`) executes in topological order; downstream node resolves `$nodes.step_1.output.step1` via expression scope; final execution status is `SUCCEEDED`.
- **F10-2**: Micro-timing durations (`durationMs >= 0`) recorded on every executed node.
- **F10-3**: Branch selection (`primitive.if` condition false): `false_action` executes, `true_action` marked `SKIPPED`; execution status succeeds without failing.
- **F10-4**: Unhandled error (`ERR_PATH_TRAVERSAL_DETECTED`): execution terminates with status `FAILED` and error summary containing the error code.
- **F10-5**: Cancellation cleanly updates state to `CANCELLED` with `error_summary`.
- **F12-1**: Execution record persisted in database before executing any workflow steps.
- **F12-2**: `node_executions` records created for each executed step with timestamps.
- **F12-3**: Output payloads in `node_executions` have sensitive keys (`password`, `token`) replaced with `'[REDACTED]'`.
- **F12-4**: Status transitions enforced in DB journal (`QUEUED -> RUNNING -> SUCCEEDED`).
- **F12-5**: Event stream logs `execution:started`, `node:started`, `node:finished`, `execution:succeeded`.

---

## 2. Logic Chain

1. **Topological Order as Deterministic Execution Schedule**:
   - From `detectCycles` in `packages/workflow-schema/src/validation/cycle-detector.ts`, every valid DAG yields a deterministic topological order array `topologicalOrder: string[]`.
   - Trigger nodes (in-degree 0) initiate execution with `triggerPayload`.
   - Iterating through nodes in topological order guarantees that all predecessor nodes are evaluated before any successor node is reached.

2. **Handle-Aware Port Dependency Resolution and Cascading Skips**:
   - In LocalFlow, edges connect specific handles (`sourceHandle -> targetHandle`).
   - When a node (such as `primitive.if` or `primitive.filter`) executes, it marks which output handles are active in `activePortBranches` (e.g. `Set(['true'])` or `Set(['false'])`).
   - When the scheduler arrives at a node `N`:
     - If `incomingEdges.length === 0`: independent root, can run.
     - For `primitive.merge`: runs if at least one incoming edge completed (it aggregates outputs of all completed incoming branches).
     - For standard nodes: checks if at least one incoming edge originates from an active handle. If not, node `N` is marked `SKIPPED`.
     - Because `N` is skipped, it produces no active handles in `activePortBranches`, deterministically causing downstream nodes that depend solely on `N` to also be marked `SKIPPED`.

3. **Step-Level Execution Lifecycle & Real-Time Journaling**:
   - To support both crash resilience (F13) and audit compliance (F12), state transitions must not be delayed or buffered.
   - Before executing step:
     1. Insert or update `node_executions` record with `status: 'RUNNING'`, `startedAt: new Date()`, and sanitized `inputPayload`.
     2. Insert event `node:started` into `execution_events`.
   - If node succeeds:
     1. Record `status: 'SUCCEEDED'`, `finishedAt: new Date()`, `durationMs = Date.now() - nodeStart`, and sanitized `outputPayload`.
     2. Insert event `node:finished`.
     3. Save output into `ExecutionContext.nodeOutputs` and activate output handles.
   - If node fails:
     1. Record `status: 'FAILED'`, `errorDetails`, and `errorMessage`.
     2. Check `node.data.executionPolicy.continueOnError`. If false, workflow fails immediately (`STOP_ON_FAILURE`).

4. **Dual Database Architecture Support**:
   - Production uses PostgreSQL via `NodePgDatabase` (`createPgDb`).
   - Unit tests and headless environments use PGlite via `PgliteDatabase` (`createInMemoryDb()`).
   - Both implement the identical Drizzle ORM query API.
   - By creating `ExecutionJournal` interface with `DrizzleExecutionJournal` (accepting `DatabaseInstance`) and `InMemoryExecutionJournal` (matching `InMemoryDatabase`), the engine seamlessly runs across real Postgres, in-memory PGlite, and mock harness environments.

---

## 3. Architecture Specification & Type Signatures

### 3.1 Package Location
- Path: `packages/workflow-engine/`
- Dependencies in `package.json`:
  - `@localflow/workflow-schema`: `workspace:*`
  - `@localflow/db`: `workspace:*`
  - `@localflow/observability`: `workspace:*`
  - `@localflow/shared`: `workspace:*`
  - `@localflow/connector-sdk`: `workspace:*`
  - `drizzle-orm`: `^0.38.3`

### 3.2 Core Type Definitions

#### `WorkflowEngine` & Engine Options (`packages/workflow-engine/src/engine/workflow-engine.ts`)
```typescript
import type { WorkflowDefinition, WorkflowNode } from '@localflow/workflow-schema';
import type { ExecutionJournal } from '../persistence/execution-journal.js';
import type { NodeExecutor } from './node-executor.js';
import type { ExecutionContext, ExpressionScope } from './execution-context.js';

export interface WorkflowEngineOptions {
  journal?: ExecutionJournal;
  nodeExecutors?: Record<string, NodeExecutor>;
  defaultTimeoutMs?: number; // default: 300,000 (5 minutes)
  env?: Record<string, string>;
}

export interface WorkflowRunOptions {
  triggerPayload?: unknown;
  idempotencyKey?: string;
  workflowVersionId?: string;
  credentials?: Record<string, unknown>;
  allowedFsRoot?: string;
  cancellationToken?: CancellationToken;
  journal?: ExecutionJournal;
  // Crash recovery / resume options:
  resumeFromExecutionId?: string;
  cachedNodeOutputs?: Map<string, unknown>;
  completedNodeIds?: Set<string>;
  simulateCrashAtNode?: string; // For testing crash recovery
}

export interface WorkflowRunResult {
  execution: WorkflowExecutionSummary;
  stepRecords: StepExecutionRecord[];
  nodeOutputs: Map<string, unknown>;
  skippedNodes: Set<string>;
  durationMs: number;
  crashedAt?: string;
}

export interface WorkflowExecutionSummary {
  id: string;
  workflowId: string;
  workflowVersionId: string;
  workspaceId: string;
  status: 'QUEUED' | 'RUNNING' | 'WAITING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED';
  triggerType: string;
  triggerPayload?: unknown;
  idempotencyKey?: string;
  startedAt?: Date;
  finishedAt?: Date;
  durationMs?: number;
  errorMessage?: string;
  errorNodeId?: string;
  retryCount?: number;
}

export interface StepExecutionRecord {
  id: string;
  executionId: string;
  nodeId: string;
  nodeType: string;
  nodeName?: string;
  status: 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'SKIPPED' | 'CANCELLED';
  startedAt?: Date;
  completedAt?: Date;
  durationMs?: number;
  inputPayload?: unknown;
  outputPayload?: unknown;
  errorMessage?: string;
  errorDetails?: Record<string, unknown>;
  retryCount: number;
}

export interface CancellationToken {
  isCancelled: boolean;
  reason?: string;
  onCancelled(callback: (reason?: string) => void): void;
}
```

#### `ExecutionContext` (`packages/workflow-engine/src/engine/execution-context.ts`)
```typescript
export interface ExecutionContext {
  readonly executionId: string;
  readonly workflowId: string;
  readonly workflowVersionId: string;
  readonly workspaceId: string;
  readonly triggerPayload: unknown;
  readonly triggerType: string;
  readonly idempotencyKey?: string;
  readonly nodeOutputs: Map<string, unknown>;
  readonly nodeInputs: Map<string, unknown>;
  readonly skippedNodes: Set<string>;
  readonly activePortBranches: Map<string, Set<string>>;
  readonly env: Record<string, string>;
  readonly cancellationToken?: CancellationToken;
  
  getNodeOutput(nodeId: string): unknown | undefined;
  setNodeOutput(nodeId: string, output: unknown): void;
  getNodeInput(nodeId: string): unknown | undefined;
  setNodeInput(nodeId: string, input: unknown): void;
  setActivePorts(nodeId: string, ports: string[] | Set<string>): void;
  getActivePorts(nodeId: string): Set<string> | undefined;
  markSkipped(nodeId: string): void;
  isSkipped(nodeId: string): boolean;
  buildExpressionScope(): ExpressionScope;
}

export interface ExpressionScope {
  $trigger: unknown;
  $nodes: Record<string, { input?: unknown; output?: unknown }>;
  $env: Record<string, string>;
  [key: string]: unknown;
}
```

#### `NodeExecutor` & Registry (`packages/workflow-engine/src/engine/node-executor.ts`)
```typescript
import type { WorkflowNode } from '@localflow/workflow-schema';
import type { SafeHttpClient } from '@localflow/shared';

export interface StepExecutionContext {
  readonly executionId: string;
  readonly workspaceId: string;
  readonly workflowId: string;
  readonly nodeId: string;
  readonly nodeType: string;
  readonly credentials?: Record<string, unknown>;
  readonly fsRoot?: string;
  readonly logger: StepLogger;
  readonly httpClient: SafeHttpClient;
  readonly expressionScope: ExpressionScope;
  readonly cancellationToken?: CancellationToken;
}

export interface StepLogger {
  info(message: string, metadata?: Record<string, unknown>): void;
  warn(message: string, metadata?: Record<string, unknown>): void;
  error(message: string, metadata?: Record<string, unknown>): void;
  debug(message: string, metadata?: Record<string, unknown>): void;
}

export interface NodeExecutionResult {
  output: unknown;
  activeOutputs?: string[]; // Handle names, e.g. ['true'] or ['false'], ['passed'], ['done']
}

export interface NodeExecutor {
  execute(
    node: WorkflowNode,
    evaluatedConfig: Record<string, unknown>,
    context: StepExecutionContext
  ): Promise<NodeExecutionResult>;
}
```

#### `ExecutionJournal` (`packages/workflow-engine/src/persistence/execution-journal.ts`)
```typescript
import type { ExecutionStatus, NodeStatus } from '@localflow/workflow-schema';

export interface ExecutionJournal {
  // Executions (Workflow Level)
  findExecutionById(executionId: string): Promise<JournalExecutionRecord | undefined>;
  findExecutionByIdempotencyKey(
    workspaceId: string,
    workflowId: string,
    idempotencyKey: string
  ): Promise<JournalExecutionRecord | undefined>;
  createExecution(params: CreateExecutionParams): Promise<JournalExecutionRecord>;
  updateExecution(executionId: string, params: UpdateExecutionParams): Promise<JournalExecutionRecord>;

  // Node Executions (Step Level)
  findNodeExecutions(executionId: string): Promise<JournalNodeExecutionRecord[]>;
  findNodeExecution(executionId: string, nodeId: string): Promise<JournalNodeExecutionRecord | undefined>;
  createNodeExecution(params: CreateNodeExecutionParams): Promise<JournalNodeExecutionRecord>;
  updateNodeExecution(id: string, params: UpdateNodeExecutionParams): Promise<JournalNodeExecutionRecord>;

  // Logs & Events
  createLog(params: CreateLogParams): Promise<void>;
  createEvent(params: CreateEventParams): Promise<void>;
  findEvents(executionId: string): Promise<JournalEventRecord[]>;
}

export interface JournalExecutionRecord {
  id: string;
  workspaceId: string;
  workflowId: string;
  workflowVersionId: string;
  status: ExecutionStatus;
  triggerType: string;
  triggerPayload?: unknown;
  idempotencyKey?: string;
  startedAt?: Date;
  finishedAt?: Date;
  durationMs?: number;
  errorMessage?: string;
  errorNodeId?: string;
  retryCount: number;
  metadata?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface JournalNodeExecutionRecord {
  id: string;
  executionId: string;
  nodeId: string;
  nodeType: string;
  nodeName?: string;
  status: NodeStatus;
  retryCount: number;
  inputPayload?: unknown;
  outputPayload?: unknown;
  errorDetails?: Record<string, unknown>;
  errorMessage?: string;
  startedAt?: Date;
  finishedAt?: Date;
  durationMs?: number;
  createdAt: Date;
}

export interface JournalEventRecord {
  id: string | number;
  executionId: string;
  eventType: string;
  nodeId?: string;
  payload?: Record<string, unknown>;
  createdAt: Date;
}
```

---

## 4. State Machine Specification

### 4.1 Workflow Execution State Machine

```
                  ┌──────────────────────┐
                  │       (START)        │
                  └──────────┬───────────┘
                             │
                             ▼
                    ┌─────────────────┐
                    │     QUEUED      │
                    └────────┬────────┘
                             │ Engine picks up job
                             ▼
                    ┌─────────────────┐
                    │     RUNNING     │◄────────────┐
                    └──┬──────┬─────┬─┘             │
                       │      │     │               │ Delay finished /
                       │      │     │ primitive.delay resumed
                       │      │     └──────────────►┌───────────────┐
                       │      │                     │    WAITING    │
                       │      │                     └───────┬───────┘
                       │      │                             │
        All reachable  │      │ Unhandled error             │ Cancelled
        steps succeed  │      │ (continueOnError=false)     │ during delay
                       │      │                             │
                       ▼      ▼                             ▼
        ┌──────────────┐   ┌────────────┐            ┌─────────────┐
        │  SUCCEEDED   │   │   FAILED   │            │  CANCELLED  │
        └──────────────┘   └────────────┘            └─────────────┘
```

#### Transition Rules:
| Current State | Event / Trigger | Target State | Side Effects & Journal Actions |
|---------------|-----------------|--------------|--------------------------------|
| `None` | Engine trigger | `QUEUED` | Persist execution record in DB, journal status `QUEUED`. |
| `QUEUED` | Worker starts DAG | `RUNNING` | Set `startedAt = new Date()`, log `execution:started`. |
| `RUNNING` | `primitive.delay` scheduled | `WAITING` | Set status `WAITING`, BullMQ delay job registered. |
| `WAITING` | Delay timer elapses | `RUNNING` | Set status `RUNNING`, continue topological loop. |
| `RUNNING` | All reachable steps complete | `SUCCEEDED` | Set `finishedAt = new Date()`, calculate `durationMs`, log `execution:succeeded`. |
| `RUNNING` | Step error (`continueOnError=false`) | `FAILED` | Set `finishedAt`, calculate `durationMs`, record `errorMessage` and `errorNodeId`, log `execution:failed`. |
| `RUNNING` / `WAITING` | User cancel / timeout | `CANCELLED` | Set `finishedAt`, `errorMessage = 'User requested cancellation'`, abort active step, log `execution:cancelled`. |

### 4.2 Node Execution State Machine

```
                  ┌──────────────────────┐
                  │       PENDING        │
                  └──────┬────────┬──────┘
                         │        │
  Upstream branch active │        │ Upstream branch skipped / inactive
                         ▼        ▼
              ┌─────────────┐   ┌─────────────┐
              │   RUNNING   │   │   SKIPPED   │ (Terminal)
              └──┬───┬───┬──┘   └─────────────┘
                 │   │   │
        Success  │   │   │ Error & maxRetries exceeded
                 │   │   │
                 ▼   │   ▼
   ┌─────────────┐   │  ┌────────────┐
   │  SUCCEEDED  │   │  │   FAILED   │ (Terminal)
   └─────────────┘   │  └────────────┘
                     │
                     │ Workflow cancelled
                     ▼
              ┌─────────────┐
              │  CANCELLED  │ (Terminal)
              └─────────────┘
```

#### Node Transition Rules:
1. `PENDING -> SKIPPED`: When upstream incoming edges do not contain an active handle (except for `primitive.merge` when at least one branch is active). `startedAt` and `finishedAt` set to current time, `durationMs = 0`.
2. `PENDING -> RUNNING`: When incoming edges are satisfied. Redacted `inputPayload` persisted to `node_executions`, `startedAt = new Date()`, event `node:started` logged.
3. `RUNNING -> SUCCEEDED`: When executor resolves without error. Redacted `outputPayload` persisted to `node_executions`, `finishedAt = new Date()`, `durationMs` calculated, active output handles registered in context, event `node:finished` logged.
4. `RUNNING -> FAILED`: When executor throws an error. If `retryCount < maxRetries`, increment `retryCount` and retry. If retries exhausted: persist `errorMessage` and `errorDetails`, set `finishedAt` and `durationMs`. If `continueOnError === true`, allow workflow to proceed; if false, trigger workflow `FAILED`.
5. `RUNNING -> CANCELLED`: When cancellation token is triggered while node is executing.

---

## 5. Persistence Integration Design with `@localflow/db`

### 5.1 Architecture: `DrizzleExecutionJournal`
```typescript
import { eq, and } from 'drizzle-orm';
import type { DatabaseInstance } from '@localflow/db';
import * as schema from '@localflow/db';
import { redact, redactString } from '@localflow/observability';
import type { ExecutionJournal, CreateExecutionParams, UpdateExecutionParams, ... } from './execution-journal.js';

export class DrizzleExecutionJournal implements ExecutionJournal {
  constructor(private readonly db: DatabaseInstance) {}

  async findExecutionById(executionId: string) {
    const records = await this.db
      .select()
      .from(schema.executions)
      .where(eq(schema.executions.id, executionId))
      .limit(1);
    return records[0];
  }

  async findExecutionByIdempotencyKey(workspaceId: string, workflowId: string, idempotencyKey: string) {
    const records = await this.db
      .select()
      .from(schema.executions)
      .where(
        and(
          eq(schema.executions.workspaceId, workspaceId),
          eq(schema.executions.workflowId, workflowId),
          eq(schema.executions.idempotencyKey, idempotencyKey)
        )
      )
      .limit(1);
    return records[0];
  }

  async createExecution(params: CreateExecutionParams) {
    const [record] = await this.db
      .insert(schema.executions)
      .values({
        id: params.id ?? crypto.randomUUID(),
        workspaceId: params.workspaceId,
        workflowId: params.workflowId,
        workflowVersionId: params.workflowVersionId,
        status: params.status,
        triggerType: params.triggerType,
        triggerPayload: redact(params.triggerPayload) as Record<string, unknown>,
        idempotencyKey: params.idempotencyKey,
        startedAt: params.startedAt ?? new Date(),
        metadata: params.metadata,
      })
      .returning();
    return record!;
  }

  async updateExecution(executionId: string, params: UpdateExecutionParams) {
    const [updated] = await this.db
      .update(schema.executions)
      .set({
        ...(params.status ? { status: params.status } : {}),
        ...(params.startedAt ? { startedAt: params.startedAt } : {}),
        ...(params.finishedAt ? { finishedAt: params.finishedAt } : {}),
        ...(params.durationMs !== undefined ? { durationMs: params.durationMs } : {}),
        ...(params.errorMessage ? { errorMessage: redactString(params.errorMessage) } : {}),
        ...(params.errorNodeId ? { errorNodeId: params.errorNodeId } : {}),
        ...(params.retryCount !== undefined ? { retryCount: params.retryCount } : {}),
        updatedAt: new Date(),
      })
      .where(eq(schema.executions.id, executionId))
      .returning();
    return updated!;
  }

  async createNodeExecution(params: CreateNodeExecutionParams) {
    const [record] = await this.db
      .insert(schema.nodeExecutions)
      .values({
        id: params.id ?? crypto.randomUUID(),
        executionId: params.executionId,
        nodeId: params.nodeId,
        nodeType: params.nodeType,
        nodeName: params.nodeName,
        status: params.status,
        retryCount: params.retryCount ?? 0,
        inputPayload: redact(params.inputPayload),
        startedAt: params.startedAt ?? new Date(),
      })
      .returning();
    return record!;
  }

  async updateNodeExecution(id: string, params: UpdateNodeExecutionParams) {
    const [updated] = await this.db
      .update(schema.nodeExecutions)
      .set({
        ...(params.status ? { status: params.status } : {}),
        ...(params.outputPayload !== undefined ? { outputPayload: redact(params.outputPayload) } : {}),
        ...(params.errorDetails ? { errorDetails: redact(params.errorDetails) as Record<string, unknown> } : {}),
        ...(params.errorMessage ? { errorMessage: redactString(params.errorMessage) } : {}),
        ...(params.finishedAt ? { finishedAt: params.finishedAt } : {}),
        ...(params.durationMs !== undefined ? { durationMs: params.durationMs } : {}),
        ...(params.retryCount !== undefined ? { retryCount: params.retryCount } : {}),
        updatedAt: new Date(),
      })
      .where(eq(schema.nodeExecutions.id, id))
      .returning();
    return updated!;
  }

  async createEvent(params: CreateEventParams) {
    await this.db.insert(schema.executionEvents).values({
      id: crypto.randomUUID(),
      executionId: params.executionId,
      eventType: params.eventType,
      nodeId: params.nodeId,
      payload: redact(params.payload) as Record<string, unknown>,
      createdAt: new Date(),
    });
  }
}
```

### 5.2 Real-Time Sanitization Guarantee
- Every payload written to PostgreSQL via `createExecution`, `createNodeExecution`, `updateNodeExecution`, or `createEvent` is piped through `redact()` or `redactString()`.
- Sensitive fields (`password`, `token`, `secret`, `authorization`, `privateKey`, `apiKey`) and regex token patterns (Bearer tokens, AWS keys, JWTs) are replaced with `[REDACTED]`.
- Non-sensitive operational data (`status`, `rowCount`, `durationMs`, `url`, `method`) remains fully readable for the UI execution inspector.

---

## 6. File Layout & Test Plan

### 6.1 Concrete File Layout
```
packages/workflow-engine/
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── src/
│   ├── index.ts
│   ├── types.ts
│   ├── engine/
│   │   ├── index.ts
│   │   ├── workflow-engine.ts           # Main DAG runner implementation
│   │   ├── execution-context.ts          # State tracking & expression scope
│   │   ├── topological-scheduler.ts      # Graph topological ordering & cycle check
│   │   ├── edge-resolver.ts              # Port routing & branch condition resolution
│   │   ├── node-executor.ts              # NodeExecutor interface & step context
│   │   ├── node-executor-registry.ts     # Extensible executor lookup table
│   │   └── errors.ts                     # EngineError, StepExecutionError, TimeoutError
│   └── persistence/
│       ├── index.ts
│       ├── execution-journal.ts          # ExecutionJournal interface & params
│       ├── drizzle-journal.ts            # Drizzle ORM implementation (PGlite & Postgres)
│       └── in-memory-journal.ts          # Fast in-memory map implementation for tests
└── tests/
    ├── engine/
    │   ├── workflow-engine.test.ts       # Full DAG execution, branching, error stop
    │   ├── topological-scheduler.test.ts # Ordering, multi-branch, cycle detection
    │   ├── edge-resolver.test.ts         # Port handles, conditional skips, merge tolerance
    │   ├── execution-context.test.ts     # Scope construction & metrics
    │   └── cancellation.test.ts          # In-flight abort & cancellation handling
    └── persistence/
        ├── drizzle-journal.test.ts       # PGlite real SQL table assertions
        ├── in-memory-journal.test.ts     # In-memory journal operations
        └── redaction-journaling.test.ts  # Verification of secret masking in DB rows
```

### 6.2 Unit Test Plan Matrix

| Test Suite | Test Case | Target Behavior Verified |
|------------|-----------|--------------------------|
| `topological-scheduler.test.ts` | Linear 3-node graph | Produces exact sequential execution order `['n1', 'n2', 'n3']`. |
| `topological-scheduler.test.ts` | Diamond graph (A->B, A->C, B->D, C->D) | Schedules A first, B and C in parallel/intermediate, D last. |
| `topological-scheduler.test.ts` | Cyclic graph detection | Rejects graph with Kahn's algorithm and throws `CycleError`. |
| `edge-resolver.test.ts` | Port activation routing | Activates `'true'` or `'false'` port based on boolean output. |
| `edge-resolver.test.ts` | Cascading skip propagation | Marks unselected branch and all transitive downstream steps as `SKIPPED`. |
| `edge-resolver.test.ts` | Merge node partial inputs | `primitive.merge` executes if at least 1 incoming edge is active, even if other is skipped. |
| `workflow-engine.test.ts` | Sequential execution | Full run completes with `SUCCEEDED`, all micro-timings `durationMs >= 0`. |
| `workflow-engine.test.ts` | Error propagation (`STOP_ON_FAILURE`) | Execution halts immediately on error; status transitions to `FAILED`. |
| `workflow-engine.test.ts` | Retry with exponential backoff | Step retries up to `maxRetries` before failing. |
| `workflow-engine.test.ts` | `continueOnError: true` | Failed step does not abort pipeline if policy allows continuation. |
| `workflow-engine.test.ts` | In-flight cancellation | Aborts subsequent steps immediately and commits `CANCELLED`. |
| `drizzle-journal.test.ts` | Initial execution journal | Row inserted in `executions` table before first node runs. |
| `drizzle-journal.test.ts` | Step journal transitions | Real-time updates to `node_executions` table (`PENDING -> RUNNING -> SUCCEEDED`). |
| `redaction-journaling.test.ts` | Secret masking in DB rows | `password` and `token` replaced with `'[REDACTED]'` in `node_executions.output_payload`. |

---

## 7. Caveats

1. **Expressions and Primitives Implementation**:
   - The expression evaluator (F09) and individual primitives (F14–F19) are investigated and specified by Explorer M2-1 (`packages/workflow-engine/src/expressions/` and `packages/workflow-engine/src/primitives/`).
   - The `WorkflowEngine` design delegates primitive execution through the `NodeExecutorRegistry`. When M2-1 delivers the primitive executors, they plug into the engine without modifying the core DAG runner or persistence layer.
2. **Crash Recovery Daemon & BullMQ Coordination**:
   - Worker daemon crash recovery (F13) and BullMQ queues (F11) are investigated by Explorer M2-3.
   - The `ExecutionJournal` and `WorkflowEngine.resumeWorkflow()` designed here provide the exact resumption checkpoint API needed by Explorer M2-3 (querying `node_executions`, replaying cached outputs, and scheduling unexecuted steps).
3. **Database Schema Locking in PostgreSQL**:
   - For high concurrency under PostgreSQL, updating an execution row should use optimistic or row-level locking (`SELECT ... FOR UPDATE`) if multiple workers attempt to process the same execution. In M2 with BullMQ job uniqueness (`jobId: executionId`), BullMQ prevents multiple concurrent workers from claiming the same execution ID.

---

## 8. Conclusion

Features F10 (Execution Engine Core) and F12 (Durable State Persistence) form the deterministic heart of LocalFlow's execution runtime.
- **F10** is fully specified as a deterministic DAG topological runner with handle-aware edge dependency resolution, real-time cascading skips for conditional branches, and strict execution lifecycle policies.
- **F12** is fully specified as a dual-engine durable persistence journal (`DrizzleExecutionJournal` for PGlite/Postgres and `InMemoryExecutionJournal` for headless testing), integrating `@localflow/db` tables and `@localflow/observability` recursive secret redaction.
- The interface contracts cleanly align with the existing E2E test harness (`f09_f13_engine_core.test.ts`) and prepare the codebase for seamless integration with Explorer M2-1's primitives and Explorer M2-3's BullMQ crash recovery.

---

## 9. Verification Method

To independently verify the facts, contracts, and test readiness outlined in this report:

1. **Verify Existing E2E Core Test Expectations**:
   ```bash
   cd /Users/dmitrysazonov/.gemini/antigravity/scratch/opennodes
   pnpm --filter @localflow/workflow-schema test
   pnpm --filter @localflow/db test
   ```
   Both test suites pass with 100% success (34 tests in `workflow-schema`, 8 tests in `db`).

2. **Verify Drizzle Database Schema Tables**:
   Inspect `packages/db/src/schema/executions.ts` to confirm table columns:
   - `executions`: `workspace_id`, `workflow_id`, `status`, `trigger_type`, `started_at`, `finished_at`, `duration_ms`.
   - `node_executions`: `execution_id`, `node_id`, `node_type`, `status`, `input_payload`, `output_payload`, `duration_ms`.
   - `execution_events`: `execution_id`, `event_type`, `payload`.

3. **Verify Secret Redaction API**:
   Inspect `packages/observability/src/redaction/redactor.ts`:
   - `redact(obj)` masks keys matching sensitive key registry and token regexes.

4. **Verify Topological Ordering Logic**:
   Inspect `packages/workflow-schema/src/validation/cycle-detector.ts`:
   - `detectCycles(nodes, edges).topologicalOrder` produces the evaluation order.

5. **Invalidation Conditions**:
   - If `@localflow/db` changes column names or removes `node_executions`, the journal mapping must be updated.
   - If `NodeStatusSchema` in `@localflow/workflow-schema` introduces new intermediate states, the node state machine must incorporate them.
