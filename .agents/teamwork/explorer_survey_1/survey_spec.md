# LocalFlow Specification Survey & Technical Specification Report

**Document Version:** 1.0.0  
**Target Release:** LocalFlow M1 Engine Vertical Slice & P0 Public Alpha MVP  
**Specification Sources:**
- `LocalFlow_PRD_Architecture_v1.md` (Product Requirements & Architecture, 2026-11-02)
- `ORIGINAL_REQUEST.md` (Initial User Specification, 2026-11-02)
- Unslop UI Design Principles (`https://github.com/heydamir/unslop`)

---

## Executive Summary & Source Hierarchy

LocalFlow is an independent, Docker-first, self-hosted visual workflow automation platform designed to run reliably on user-controlled infrastructure. This document provides the exhaustive technical specification required to implement:
1. **M1 Engine Vertical Slice**: An end-to-end executable pipeline (Manual Trigger -> HTTP Request -> IF condition -> Telegram Bot notification) backed by durable PostgreSQL state persistence, Redis/BullMQ task queue, execution logging, and crash-resilient worker restart recovery.
2. **P0 Public Alpha MVP**: Complete multi-workspace automation platform featuring visual React Flow graph canvas, typed node ports, draft/published versioning, 12+ foundational connectors, RBAC (Owner, Admin, Editor, Viewer), envelope-encrypted credentials at rest, comprehensive secret redaction, robust SSRF protection, and single-command Docker Compose deployment with health checks.

### Architectural Decisions Baseline (ADR Summary)
- **ADR-001 (Engine Independence)**: LocalFlow uses its own lightweight, deterministic DAG execution engine and state machine, not an n8n fork or clone, guaranteeing clean licensing (Apache-2.0 baseline) and complete architectural control.
- **ADR-002 (Deployment Target)**: Docker Compose is the primary distribution format. Multi-tenant managed cloud SaaS is explicitly out of scope for v1; self-hosted logical workspace separation is the deployment model.
- **ADR-003 (Durable Storage Model)**: PostgreSQL is the single canonical source of truth for all workflows, version snapshots, credentials, execution records, step states, and audit logs. Redis is utilized strictly for queue brokering, transient locks, and rate limiting. SQLite is prohibited in multi-worker environments.
- **ADR-004 (Execution Semantics)**: At-least-once task delivery with explicit per-node idempotency, run correlation IDs, bounded exponential backoff retries, and dead-letter queues.
- **ADR-005 (Snapshot Immutability)**: Workflows execute exclusively against immutable published version snapshots (`workflow_versions`). Modifications to the draft canvas never mutate active running executions.
- **ADR-006 (Connector SDK Standard)**: Every connector implements an authored typed manifest declaring inputs, outputs, credentials, triggers, actions, and validation schemas.
- **ADR-007 (Credential Privacy)**: Envelope encryption at rest using AES-256-GCM. Credential plaintext is never returned over public APIs, never displayed in UIs, and never persisted in execution run logs.
- **ADR-008 (Sandbox Isolation)**: General-purpose unsandboxed arbitrary code execution (`eval()` or raw child process shell execution) is strictly prohibited. Expression interpolation is powered by a safe AST interpreter.
- **ADR-009 (SSRF Defense In Depth)**: All outbound HTTP traffic is governed by an SSRF prevention layer that blocks loopback, link-local, private RFC 1918, and cloud metadata addresses by default at both DNS resolution and socket connection levels, unless explicitly allowlisted by an instance administrator.

---

## 1. System Architecture & Component Boundaries

### 1.1 High-Level Component Topology

```text
                                 +---------------------------------------+
                                 |         Browser / Client UI           |
                                 | (React Flow Canvas, React 19, Vite,   |
                                 |  Tailwind CSS, shadcn/ui, Unslop)     |
                                 +-------------------+-------------------+
                                                     | HTTP / WebSocket / SSE
                                                     v
                                 +---------------------------------------+
                                 |               apps/api                |
                                 | (Node.js LTS, Fastify, OpenAPI/Zod)   |
                                 | - Auth & Session Management           |
                                 | - RBAC Enforcement Engine            |
                                 | - Workflow CRUD & Versioning          |
                                 | - Credential Vault (Envelope Encrypt) |
                                 | - Webhook Ingress Receiver            |
                                 | - Execution Dispatcher & Event Stream |
                                 +----------+-----------------+----------+
                                            |                 |
                   SQL Queries & Snapshots  |                 | Enqueue Job
                                            v                 v
                 +--------------------------+---+         +---+---------------------------+
                 |          postgres            |         |             redis             |
                 | (PostgreSQL 16)              |         | (Redis 7 Alpine)              |
                 | - Metadata & RBAC            |         | - BullMQ Execution Queues     |
                 | - Workflow Versions          |         | - Pub/Sub for Live SSE Events |
                 | - Executions & Step Logs     |         | - Idempotency & Rate Limiters |
                 | - Audit Logs & Credentials   |         +---------------+---------------+
                 +--------------------------+---+                         |
                                            ^                             | Worker Pull
                                            | Update State & Logs         |
                                 +----------+-----------------+-----------v---------------+
                                 |                      apps/worker                       |
                                 | (Node.js LTS Worker Service)                           |
                                 | - BullMQ Worker Consumer Loop                          |
                                 | - Deterministic DAG Engine (packages/workflow-engine)  |
                                 | - Cron Scheduler Daemon (bree / croner)                |
                                 | - Telegram Long-Polling Daemon                         |
                                 | - Connector Dispatcher (packages/connectors-*)         |
                                 | - SSRF-Guarded Outbound HTTP Client                    |
                                 +----------------------------+---------------------------+
                                                              | Outbound Integrations
                                                              v
                                 +--------------------------------------------------------+
                                 | External Services: HTTP APIs, SMTP, Telegram, Ollama, |
                                 | OpenAI, PostgreSQL DBs, Local Allowed Mounts           |
                                 +--------------------------------------------------------+
```

### 1.2 Component Responsibilities & Boundaries

1. **`apps/web` (Frontend Canvas & UI)**
   - Single Page Application (SPA) built with Vite, React, React Flow (`@xyflow/react`), TypeScript strict mode.
   - Applies **Unslop** editorial visual design principles: calm neutral palette, high contrast accessible typography, disciplined 8px layout grid, density without clutter, zero decorative gradients.
   - Interactive visual graph editor supporting node placement, typed port validation, cycle rejection, edge deletion/connection.
   - Workflow version controls (Draft editing vs. Published version switching, rollback trigger).
   - Dynamic JSON Schema node configuration panels with real-time validation and key autocomplete for node references (`$nodes.<id>.output`).
   - Run Inspector displaying node execution status, durations, sanitized input/output payloads, and root-cause error diagnostics.

2. **`apps/api` (Backend Fastify API)**
   - Stateless RESTful HTTP API service running on Fastify with TypeScript.
   - Auto-generated OpenAPI / Swagger documentation derived from Zod schemas.
   - Authentication via secure `HttpOnly`, `SameSite=Lax/Strict` session cookies; owner account bootstrapping on first start.
   - Workspace-scoped Role-Based Access Control (RBAC) enforced on every API route and SSE subscription.
   - Public Ingress for Webhook triggers (`/api/v1/hooks/:endpointId`) supporting HMAC signature validation and payload buffering.
   - Execution management: dispatches run requests to Redis/BullMQ and exposes Server-Sent Events (SSE) at `/api/v1/executions/:id/events`.
   - Credential management: handles envelope encryption using the configured Master Encryption Key (MEK) and redacts secrets on all read operations.

3. **`apps/worker` (Job Execution & Polling Worker)**
   - Background daemon service separate from the API process.
   - Connects to BullMQ queue to consume execution jobs.
   - Executes workflow graphs using the deterministic DAG runner (`packages/workflow-engine`).
   - Runs the internal Cron scheduler daemon to poll and trigger scheduled workflows.
   - Runs the Telegram Long-Polling listener daemon (`getUpdates`) for workflows configured with Telegram triggers.
   - Persists step-level status changes, start/end timestamps, and sanitized payload journals directly into PostgreSQL.
   - Handles worker shutdown signals (`SIGTERM`, `SIGINT`) gracefully: checks in-flight job progress, reports stalled status, and supports worker restart recovery.

4. **`postgres` (PostgreSQL 16 Database)**
   - Authoritative persistent store.
   - Stores users, sessions, workspaces, memberships, workflows, immutable workflow version snapshots, envelope-encrypted credentials, execution runs, step execution states, and audit trails.

5. **`redis` (Redis 7 In-Memory Broker)**
   - BullMQ queue storage for `workflow-executions` and `workflow-delays`.
   - Redis Pub/Sub channels for publishing real-time execution events consumed by `apps/api` to stream via SSE.
   - Distributed locking (`Redlock` or Redis `SET NX EX`) for cron triggering and long-polling worker leaders.

### 1.3 Monorepo Structure (`localflow`)

```text
localflow/
├── apps/
│   ├── api/                     # Fastify REST API, auth, webhook ingress, SSE
│   ├── web/                     # Vite + React Flow UI, Unslop design system
│   └── worker/                  # BullMQ processor, DAG executor, Cron/Telegram daemons
├── packages/
│   ├── auth/                    # RBAC policies, password hashing (argon2), session utilities
│   ├── connector-sdk/           # Connector interfaces, manifest schemas, credential types
│   ├── connectors-ai/           # OpenAI-compatible API & local Ollama connectors
│   ├── connectors-core/         # HTTP, Webhook, Cron, JSON, CSV, RSS, SMTP, Postgres, Telegram, FS
│   ├── observability/           # Structured JSON logger, OpenTelemetry tracing, Prometheus metrics
│   ├── shared/                  # Common domain types, Zod schemas, error classes
│   ├── ui/                      # Design system components (shadcn/ui adapted with Unslop aesthetic)
│   ├── workflow-engine/         # Core deterministic DAG runner, safe interpreter, cycle detector
│   └── workflow-schema/         # Zod schemas for workflow graph, versions, nodes, and edges
├── infra/
│   ├── compose.yaml             # Production single-command Docker Compose
│   ├── compose.dev.yaml         # Development Docker Compose with live reload
│   ├── migrations/              # Canonical PostgreSQL schema migrations
│   └── proxy/                   # Optional reverse proxy configuration (Caddy / Nginx)
├── docs/
│   ├── adr/                     # Architectural Decision Records
│   ├── architecture/            # Component interaction & data flow diagrams
│   └── security/                # Threat model, SSRF policy, redaction rules
├── tests/
│   ├── contract/                # Connector manifest & schema contract tests
│   ├── e2e/                     # End-to-end full platform workflows
│   ├── integration/             # Engine + Postgres + Redis integration tests
│   ├── mocks/                   # Self-contained HTTP, SMTP, Telegram, Ollama fixtures
│   └── reliability/             # Worker crash, restart recovery, and concurrency tests
├── .env.example                 # Comprehensive environment variable template
├── package.json                 # Monorepo root package.json (pnpm workspaces + Turborepo)
├── turbo.json                   # Turborepo task pipeline configuration
└── tsconfig.base.json           # Base TypeScript strict configuration
```

---

## 2. Complete Execution Engine Lifecycle & State Machine

### 2.1 State Machine & Transitions

The workflow execution engine models executions at two distinct levels:
1. **Workflow Execution Level** (`executions` table)
2. **Step / Node Execution Level** (`node_executions` table)

```text
                               +-------------------+
                               |      QUEUED       | <--- Enqueued by Trigger/API
                               +---------+---------+
                                         |
                                         | Worker picks up job from BullMQ
                                         v
                               +-------------------+
         +-------------------> |      RUNNING      |
         |                     +----+----+----+----+
         |                          |    |    |
         | Delay timer triggers     |    |    | Node failed, no retries left
         | or external event arrives|    |    v
+--------+--------+                 |    |  +-------------------+
|     WAITING     | <---------------+    |  |      FAILED       |
+-----------------+                      |  +-------------------+
  (Paused state for Delay                |
   or Human Approval)                    v
                               +-------------------+
                               |     CANCELLED     | <--- User aborts run
                               +-------------------+
                                         |
                                         | All terminal nodes succeed
                                         v
                               +-------------------+
                               |     SUCCEEDED     |
                               +-------------------+
```

#### Valid Workflow Execution State Transitions:
- `QUEUED` -> `RUNNING`
- `QUEUED` -> `CANCELLED`
- `RUNNING` -> `WAITING` (when encountering a `Delay` node or asynchronous wait event)
- `WAITING` -> `RUNNING` (when delayed BullMQ job fires or resume token is received)
- `RUNNING` -> `SUCCEEDED` (when all executable paths in the DAG reach successful completion)
- `RUNNING` -> `FAILED` (when any node fails after exhausting configured retry attempts)
- `RUNNING` -> `CANCELLED` (when user issues `/api/v1/executions/:id/cancel` or execution reaches hard timeout)
- `WAITING` -> `CANCELLED` (when a paused execution is explicitly aborted)

#### Valid Node Execution State Transitions:
- `PENDING` -> `RUNNING`
- `RUNNING` -> `SUCCEEDED`
- `RUNNING` -> `FAILED` (may transition to `RUNNING` on retry attempt if `retryCount < maxRetries`)
- `RUNNING` -> `SKIPPED` (e.g. inactive branch of an IF condition or filtered-out element)
- `RUNNING` -> `CANCELLED` (if parent execution is cancelled while node is in flight)

### 2.2 BullMQ Queue Architecture & Persistence

- **Primary Queue:** `workflow-execution`
  - Jobs are pushed with a unique `jobId = executionId`.
  - Job Data Payload:
    ```typescript
    interface WorkflowJobData {
      executionId: string;
      workflowId: string;
      workflowVersionId: string;
      workspaceId: string;
      triggerType: 'manual' | 'cron' | 'webhook' | 'telegram';
      triggerPayload: Record<string, unknown>;
      idempotencyKey?: string;
    }
    ```
- **Delayed Queue / Scheduler:**
  - Used for `Delay` nodes (`delayMs`). When a DAG runner reaches a Delay node, it updates execution status to `WAITING`, schedules a resume job in BullMQ with `{ delay: delayMs }`, and yields the worker thread.
- **Job Options:**
  - `removeOnComplete: false` (records kept for bounded TTL or offloaded to PostgreSQL).
  - `removeOnFail: false`.
  - `attempts: 1` (workflow-level retries are managed deterministically by LocalFlow engine; individual node retries have discrete exponential backoff policies).

### 2.3 Worker Restart Durability & Crash Recovery

To prevent silent job loss or corrupted state when a worker container restarts or crashes:
1. **Heartbeat & Lock Renewal:** Active workers periodically renew locks on running jobs in BullMQ (default lock duration: 30s, renewed every 10s).
2. **PostgreSQL Event Journal:** Before executing each node, the worker writes a `node_executions` record with status `RUNNING`. Upon completion, it writes status `SUCCEEDED` along with sanitized output payloads in a single transaction.
3. **Stalled Job Detection:** BullMQ's built-in stalled job checker identifies jobs whose worker failed to renew its lock (e.g., killed via `docker restart`).
4. **Recovery Protocol:**
   - On worker startup or stalled job re-queue, the engine inspects the `executions` and `node_executions` tables in PostgreSQL.
   - For already completed nodes, the engine loads their cached `outputPayload` from PostgreSQL and does **not** re-execute them (preventing duplicate side effects like sending multiple emails or duplicate charges).
   - The engine resumes execution from the exact node that was in-flight or pending at the time of worker interruption.
   - If a node was interrupted mid-flight and is marked non-idempotent, the engine marks the step as failed with error code `ERR_WORKER_CRASHED_DURING_EXECUTION` unless explicit retry is configured.

### 2.4 Retry Policy & Dead Letter Queue (DLQ)

- **Node-Level Retries:** Configurable per node in `executionPolicy`:
  - `maxRetries`: Default 0, maximum 5.
  - `backoffType`: `exponential` or `fixed`.
  - `initialIntervalMs`: Default 1000ms.
  - `maxIntervalMs`: Default 30000ms.
- **Dead Letter Queue (DLQ):**
  - If an execution fails permanently or exceeds maximum timeout (`executionTimeoutMs`, default 300,000ms / 5 minutes), the execution is marked `FAILED` in PostgreSQL, an audit log entry is recorded, and the failed job metadata is written to the Redis dead-letter stream `workflow-dlq` for operator visibility and dead-letter inspection.

---

## 3. Graph Orchestration Primitives & Graph Validation

### 3.1 Graph Representation & Validation Rules

A workflow version snapshot is represented as a directed graph $G = (V, E)$, where $V$ is a set of nodes and $E$ is a set of directed edges connecting typed node ports.

```typescript
interface WorkflowGraph {
  schemaVersion: '1.0';
  workflowId: string;
  versionId: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  triggerConfig: TriggerConfiguration;
  executionPolicy: WorkflowExecutionPolicy;
  credentialReferences: string[]; // UUIDs of bound credentials
  checksum: string; // SHA-256 of canonical JSON
}

interface WorkflowNode {
  id: string; // unique node instance ID, e.g. "http_1"
  type: string; // connector or primitive identifier, e.g. "core.httpRequest"
  name: string; // human-readable node name
  position: { x: number; y: number };
  config: Record<string, unknown>; // schema-validated configuration
  credentialId?: string; // reference to credential
}

interface WorkflowEdge {
  id: string;
  source: string; // source node id
  sourceHandle: string; // output port: "main", "true", "false", "item", "done"
  target: string; // target node id
  targetHandle: string; // input port: "main"
}
```

### 3.2 Cycle Detection & Edge Validation Rules

1. **Cycle Prevention:**
   - In standard DAG flows, cycles are strictly forbidden. Before publishing or executing a workflow, the engine performs Topological Sort using **Kahn's Algorithm** or **Tarjan's strongly connected components algorithm**.
   - If a back-edge creating a directed cycle is detected outside an explicit loop construct (`For Each`), validation fails immediately with error `ERR_CYCLIC_DEPENDENCY_DETECTED`.
2. **Typed Port Validation:**
   - Nodes expose named, typed output ports:
     - Standard Actions: `main`
     - Branch / IF: `true`, `false`
     - For Each: `item` (loop body), `done` (continuation after loop completion)
     - Filter: `passed`, `discarded`
   - Connections can only be made between compatible port types (e.g. an edge cannot connect an output port to an output port).
3. **Single Trigger Constraint:**
   - A workflow must have exactly one root Trigger node (Manual, Cron, Webhook, or Telegram Polling). All executable paths originate from this trigger.

### 3.3 Orchestration Primitives Specification

| Primitive | Node Type | Input Ports | Output Ports | Semantics & Behavior |
|---|---|---|---|---|
| **Branch / IF** | `primitive.if` | `main` | `true`, `false` | Evaluates a set of boolean conditions against prior node outputs using the safe expression interpreter. If true, routes execution payload exclusively through the `true` port; if false, through the `false` port. Unselected branch nodes are marked `SKIPPED`. |
| **Filter** | `primitive.filter` | `main` | `passed`, `discarded` | Evaluates an array or object against a predicate expression. Items meeting the criteria emerge on `passed`; failing items emerge on `discarded` or are dropped. |
| **Map / Transform** | `primitive.map` | `main` | `main` | Transforms incoming JSON payloads into a new target structure using expression templates (e.g. mapping fields `{ "userId": "$nodes.http_1.output.id" }`). |
| **Delay** | `primitive.delay` | `main` | `main` | Suspends workflow execution for a configured duration (`seconds`, `minutes`, `hours`). Uses BullMQ delayed jobs. Does not hold a worker thread in memory. |
| **For Each** | `primitive.forEach` | `main` | `item`, `done` | Iterates over an array in the input payload. For each element, fires the `item` output port with context `{ item, index, total }`. Supports bounded concurrency (`batchSize: 1..10`). Once all items have executed their downstream sub-graph, fires the `done` port with aggregated results. |
| **Merge** | `primitive.merge` | `input_1`, `input_2` (multi-input) | `main` | Synchronizes multiple converging paths. Configurable modes: <br>• `WAIT_ALL`: waits until all incoming active edges have produced an output, then combines payloads.<br>• `WAIT_ANY`: executes downstream as soon as the first incoming branch completes. |

### 3.4 Safe Expression Interpreter (No `eval()`)

- **Rule:** Direct JavaScript `eval()`, `new Function()`, or `vm.runInContext()` without strict containerization is strictly banned.
- **Implementation:** LocalFlow implements a sandboxed, deterministic Abstract Syntax Tree (AST) expression evaluator (or vetted parser such as `jsonata` or a bespoke safe tokenizing evaluator).
- **Variable Scopes Available to Expressions:**
  - `$trigger`: The raw payload that initiated the workflow (e.g. webhook body/headers, cron timestamp, telegram message).
  - `$nodes.<nodeId>.input`: The input parameters passed to `<nodeId>`.
  - `$nodes.<nodeId>.output`: The output data produced by `<nodeId>`.
  - `$env`: Whitelisted, non-secret workflow variables.
- **Syntax Examples:**
  - `"{{ $nodes.http_request_1.output.data.user.email }}"`
  - `"{{ $trigger.body.event == 'payment_completed' }}"`
  - `"{{ $nodes.json_transform.output.items[0].id }}"`

---

## 4. Triggers Architecture & Implementations

Every workflow execution is initiated by an authoritative Trigger that produces a standardized `triggerPayload`.

```typescript
interface BaseTriggerPayload {
  triggerType: 'manual' | 'cron' | 'webhook' | 'telegram';
  timestamp: string; // ISO-8601
  executionId: string;
  metadata: Record<string, unknown>;
}
```

### 4.1 Manual Trigger (`trigger.manual`)
- **Invocation:** Triggered directly via API endpoint `POST /api/v1/workflows/:id/execute` or via the web UI "Run" button.
- **Inputs:** Optional test JSON payload `{ "payload": { ... } }`.
- **Outputs:** `{ triggerType: 'manual', timestamp: '...', user: { id, email }, payload: { ... } }`.
- **Use Case:** Testing workflows from the canvas, ad-hoc execution runs.

### 4.2 Cron Trigger (`trigger.cron`)
- **Invocation:** Time-based scheduler running inside `apps/worker` using a resilient in-process cron manager (e.g. `croner`).
- **Configuration:**
  - `cronExpression`: Standard 5-field or 6-field cron syntax (e.g. `0 9 * * 1-5` for 9 AM weekdays).
  - `timezone`: IANA timezone string (e.g. `UTC`, `America/New_York`, `Europe/Moscow`). Handles Daylight Saving Time (DST) transitions safely without duplicate triggers.
  - `catchUpPolicy`: `SKIP` (default) or `RUN_ONCE`. If the worker was down during a scheduled tick, `SKIP` drops missed runs, whereas `RUN_ONCE` immediately triggers a single catch-up execution.
- **Outputs:** `{ triggerType: 'cron', timestamp: '...', scheduledTime: '...', timezone: '...' }`.

### 4.3 Webhook Trigger (`trigger.webhook`)
- **Invocation:** Inbound HTTP requests received at `apps/api` on `/api/v1/hooks/:endpointId`.
- **Configuration:**
  - `httpMethod`: `POST`, `GET`, `PUT`.
  - `authentication`: `NONE`, `HEADER_TOKEN` (shared secret header), `HMAC_SIGNATURE` (sha256 signature header with shared secret).
  - `idempotencyHeader`: Optional header name (e.g. `X-Idempotency-Key` or `X-Request-Id`).
- **Behavior:**
  - Webhook receiver validates request method, signature/token, and payload size (max 5MB default).
  - Performs deduplication: if `idempotencyKey` is present and an execution with the same key was created within the deduplication window (default 24h), returns cached response code without re-enqueuing.
  - Returns `202 Accepted` with `{ "executionId": "uuid" }` or immediate HTTP response per workflow configuration.
- **Outputs:**
  ```json
  {
    "triggerType": "webhook",
    "timestamp": "2026-11-02T10:00:00.000Z",
    "headers": { "content-type": "application/json", "user-agent": "Stripe/1.0" },
    "query": { "source": "checkout" },
    "body": { "id": "evt_123", "type": "payment_intent.succeeded" }
  }
  ```

### 4.4 Telegram Polling Trigger (`trigger.telegram_polling`)
- **Invocation:** Long-polling daemon in `apps/worker` that periodically calls Telegram Bot API `getUpdates` method.
- **Configuration:**
  - `credentialId`: Bound Telegram Bot Token.
  - `pollIntervalSeconds`: Default 1s (long-polling timeout 30s).
  - `allowedUpdates`: Array of strings (`["message", "callback_query", "channel_post"]`).
- **Behavior:**
  - Maintains `lastUpdateId` per bot in PostgreSQL or Redis to ensure each Telegram update is processed exactly once.
  - Upon receiving updates, acknowledges offset `lastUpdateId + 1` and enqueues an execution for each matching update.
  - Operates completely behind firewalls/NAT without requiring a public inbound IP or reverse proxy tunnel.
- **Outputs:**
  ```json
  {
    "triggerType": "telegram",
    "timestamp": "2026-11-02T10:00:00.000Z",
    "updateId": 123456789,
    "message": {
      "messageId": 42,
      "from": { "id": 987654, "username": "alice", "firstName": "Alice" },
      "chat": { "id": 987654, "type": "private" },
      "date": 1798884000,
      "text": "/start"
    }
  }
  ```

---

## 5. Foundational Connectors & Actions (The 12+ P0 Connectors)

Every connector implements the `ConnectorManifest` contract defined in `packages/connector-sdk`.

```typescript
export interface ConnectorManifest {
  id: string; // e.g. "core.httpRequest"
  name: string;
  version: string; // "1.0.0"
  description: string;
  category: 'network' | 'utility' | 'database' | 'messaging' | 'ai' | 'storage';
  auth?: AuthDefinition;
  actions: ActionDefinition[];
  triggers?: TriggerDefinition[];
}
```

### Detailed Connector Specifications:

#### 1. HTTP Request (`core.httpRequest`)
- **Category:** Network / Universal Connector
- **Capabilities:**
  - Methods: `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `HEAD`.
  - URL expression interpolation with strict SSRF validation before resolution and connection.
  - Headers: key-value map with expression evaluation.
  - Query Parameters: key-value map.
  - Body Types: `JSON`, `Form Data`, `x-www-form-urlencoded`, `Raw Text`.
  - Authentication: `None`, `Bearer Token`, `Basic Auth` (username/password), `API Key` (Header or Query), `OAuth2` (Client Credentials or Refresh Token).
  - Pagination: Supports cursor-based, page-based, and offset-based pagination with max pages guardrail (default limit: 50 pages).
  - Timeout: Configurable 1000ms - 60000ms (default 10000ms).
- **SSRF Defense:** Hardened HTTP agent resolves DNS, verifies destination IP is not private/loopback/link-local/metadata, and binds socket exclusively to verified IP.
- **Output:** `{ status: number, statusText: string, headers: Record<string, string>, data: unknown }`.

#### 2. Webhook Connector (`core.webhook`)
- **Category:** Triggers & Ingress
- **Capabilities:** Authored manifest defining inbound endpoint generation, path routing, signature verification (HMAC SHA-256), rate limiting, and response payload drafting.

#### 3. Cron Connector (`core.cron`)
- **Category:** Triggers & Scheduling
- **Capabilities:** Periodic execution triggering, crontab expression parsing, timezone normalization, and catch-up scheduling.

#### 4. JSON Transform (`core.jsonTransform`)
- **Category:** Utility
- **Capabilities:**
  - Modes:
    - `Extract / Query`: Evaluates JSON path / expression against input to extract subsets.
    - `Construct / Remap`: Constructs a new JSON object based on a key-value template mapping.
    - `Stringify / Parse`: Converts between raw JSON string and structured JSON object.
- **Input:** `{ data: unknown, template?: Record<string, unknown>, expression?: string }`.
- **Output:** `{ result: unknown }`.

#### 5. CSV Connector (`core.csv`)
- **Category:** Utility
- **Capabilities:**
  - Actions:
    - `parse`: Converts raw CSV text into array of JSON objects. Configurable delimiter (`,`, `;`, `\t`), quote character, header row presence, skip empty lines.
    - `generate`: Converts array of JSON objects into formatted CSV string.
- **Error Handling:** Emits `ERR_CSV_PARSE_FAILED` on malformed line or mismatched column count with offending line number.

#### 6. RSS / Atom Read (`core.rss`)
- **Category:** Utility / Ingress
- **Capabilities:**
  - Fetches and parses RSS 2.0 and Atom feeds.
  - Deduplication: Maintains state of previously observed item GUIDs / URLs / publication timestamps.
  - Output: Array of normalized feed items: `{ guid: string, title: string, link: string, pubDate: string, author: string, content: string }`.

#### 7. Send Email via SMTP (`core.smtp`)
- **Category:** Messaging
- **Capabilities:**
  - Connection: Host, port (587, 465, 25), security (`TLS`, `STARTTLS`, `None`).
  - Auth: Username, Password (envelope-encrypted credential).
  - Fields: `from` (verified format), `to` (comma-separated or array), `cc`, `bcc`, `replyTo`, `subject`, `text`, `html`.
  - Output: `{ messageId: string, accepted: string[], rejected: string[] }`.

#### 8. Database SQL - PostgreSQL (`core.postgresSql`)
- **Category:** Database
- **Capabilities:**
  - Connection: Host, port, database, user, password, SSL mode (`require`, `prefer`, `disable`).
  - Action: `executeQuery`.
  - Parameterized Queries: Strict query parameterization (`$1, $2, ...`) to prevent SQL injection.
  - Guardrails: Optional read-only transaction flag (`SET TRANSACTION READ ONLY`); query timeout enforced (default 15s); max returned rows limit (default 1000 rows).
  - Output: `{ rows: Record<string, unknown>[], rowCount: number, fields: string[] }`.

#### 9. Telegram Bot Connector (`core.telegramBot`)
- **Category:** Messaging
- **Capabilities:**
  - Actions:
    - `sendMessage`: `chatId`, `text`, `parseMode` (`HTML` or `MarkdownV2`), `disableWebPagePreview`, `replyToMessageId`.
    - `sendPhoto`: `chatId`, `photoUrl` or file reference, `caption`.
  - Rate Limiting: Telegram limits (30 messages/second, 1 message/second per group chat) handled with automatic backoff on HTTP 429.
  - Output: `{ ok: boolean, messageId: number, chat: { id: number, ... } }`.

#### 10. Generic OpenAI-Compatible LLM (`ai.openai`)
- **Category:** AI / LLM
- **Capabilities:**
  - Compatible with OpenAI, Groq, Mistral, Together, vLLM, and any OpenAI API-compatible provider.
  - Parameters: `baseUrl` (default `https://api.openai.com/v1`), `apiKey`, `model` (e.g. `gpt-4o-mini`), `messages` (`system`, `user`, `assistant`), `temperature`, `maxTokens`.
  - Structured Output: Enforces JSON output validated against an authored JSON Schema (`response_format: { type: "json_schema", json_schema: { ... } }`).
  - Metadata: Captures token usage (`promptTokens`, `completionTokens`, `totalTokens`) and estimated cost where available.
  - Output: `{ text: string, json?: unknown, usage: { promptTokens: number, completionTokens: number, totalTokens: number } }`.

#### 11. Local Ollama Connector (`ai.ollama`)
- **Category:** AI / LLM
- **Capabilities:**
  - Connects to local or network Ollama daemon (e.g. `http://host.docker.internal:11434` or custom URL).
  - Actions:
    - `generate`: Single prompt completion.
    - `chat`: Multi-turn chat completion with message array.
  - Options: `model` (e.g. `llama3`, `mistral`), `temperature`, `format: "json"`.
  - Output: `{ response: string, json?: unknown, totalDuration: number, evalCount: number }`.

#### 12. Controlled Filesystem Access (`core.filesystem`)
- **Category:** Storage
- **Capabilities:**
  - Actions: `readFile`, `writeFile`, `listFiles`, `deleteFile`.
  - Sandboxing: Operations are strictly confined to an administrator-configured mount path (e.g. `/data/storage`).
  - Security Enforcement: Strict canonical path resolution (`path.resolve`) to verify that the target path does not escape the allowed root directory via `../` traversal or symbolic link following (`ERR_PATH_TRAVERSAL_DETECTED`).
  - Output: `{ path: string, sizeBytes: number, content?: string | Buffer, files?: string[] }`.

---

## 6. Comprehensive Data Models & Schemas

### 6.1 Entity-Relationship Overview

```text
+-------------------+       +--------------------+       +----------------------+
|       User        | 1   * |     Membership     | *   1 |      Workspace       |
|-------------------|-------|--------------------|-------|----------------------|
| id (UUID PK)      |       | id (UUID PK)       |       | id (UUID PK)         |
| email (Unique)    |       | userId (FK)        |       | name                 |
| passwordHash      |       | workspaceId (FK)   |       | slug (Unique)        |
| createdAt         |       | role (Enum)        |       | createdAt            |
+-------------------+       +--------------------+       +----------+-----------+
                                                                    | 1
                                                                    | *
                                                         +----------+-----------+
                                                         |       Workflow       |
                                                         |----------------------|
                                                         | id (UUID PK)         |
                                                         | workspaceId (FK)     |
                                                         | name                 |
                                                         | isArchived           |
                                                         | activeVersionId (FK) |
                                                         | createdAt            |
                                                         +----------+-----------+
                                                                    | 1
                                                                    | *
                                                         +----------+-----------+
                                                         |   WorkflowVersion    |
                                                         |----------------------|
                                                         | id (UUID PK)         |
                                                         | workflowId (FK)      |
                                                         | versionNumber (Int)  |
                                                         | isDraft (Boolean)    |
                                                         | snapshot (JSONB)     |
                                                         | checksum (SHA256)    |
                                                         | createdBy (FK User)  |
                                                         +----------+-----------+
                                                                    | 1
                                                                    | *
                                                         +----------+-----------+
                                                         |      Execution       |
                                                         |----------------------|
                                                         | id (UUID PK)         |
                                                         | workflowId (FK)      |
                                                         | workflowVersionId(FK)|
                                                         | workspaceId (FK)     |
                                                         | status (Enum)        |
                                                         | triggerType          |
                                                         | startedAt, finishedAt|
                                                         +----------+-----------+
                                                                    | 1
                                                                    | *
                                                         +----------+-----------+
                                                         |    NodeExecution     |
                                                         |----------------------|
                                                         | id (UUID PK)         |
                                                         | executionId (FK)     |
                                                         | nodeId (String)      |
                                                         | status (Enum)        |
                                                         | inputPayload (JSONB) |
                                                         | outputPayload (JSONB)|
                                                         | errorDetails (JSONB) |
                                                         | startedAt, finishedAt|
                                                         +----------------------+
```

### 6.2 Relational Database Schema (PostgreSQL DDL)

```sql
-- Enums
CREATE TYPE user_role AS ENUM ('OWNER', 'ADMIN', 'EDITOR', 'VIEWER');
CREATE TYPE execution_status AS ENUM ('QUEUED', 'RUNNING', 'WAITING', 'SUCCEEDED', 'FAILED', 'CANCELLED');
CREATE TYPE node_status AS ENUM ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'SKIPPED', 'CANCELLED');

-- Workspaces
CREATE TABLE workspaces (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(255) NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Users
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(255),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Workspace Memberships (RBAC)
CREATE TABLE memberships (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    role user_role NOT NULL DEFAULT 'VIEWER',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_user_workspace UNIQUE (user_id, workspace_id)
);

-- Credentials (Envelope Encrypted)
CREATE TABLE credentials (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    type VARCHAR(100) NOT NULL, -- e.g. "telegram", "smtp", "postgres", "openai"
    key_version INTEGER NOT NULL DEFAULT 1,
    encrypted_payload JSONB NOT NULL, -- { iv: "hex", authTag: "hex", ciphertext: "hex" }
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Workflows
CREATE TABLE workflows (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    is_active BOOLEAN NOT NULL DEFAULT FALSE,
    active_version_id UUID, -- References published workflow_versions(id)
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Workflow Versions (Draft vs Published Snapshots)
CREATE TABLE workflow_versions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workflow_id UUID NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
    version_number INTEGER NOT NULL,
    is_draft BOOLEAN NOT NULL DEFAULT FALSE,
    snapshot JSONB NOT NULL, -- Complete canonical WorkflowGraph schema
    checksum VARCHAR(64) NOT NULL, -- SHA-256 hash of canonical snapshot JSON
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_workflow_version UNIQUE (workflow_id, version_number)
);

-- Webhook Ingress Endpoints
CREATE TABLE webhook_endpoints (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    workflow_id UUID NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
    endpoint_token VARCHAR(64) NOT NULL UNIQUE,
    secret_hash VARCHAR(255),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Workflow Executions
CREATE TABLE executions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workflow_id UUID NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
    workflow_version_id UUID NOT NULL REFERENCES workflow_versions(id) ON DELETE RESTRICT,
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    status execution_status NOT NULL DEFAULT 'QUEUED',
    trigger_type VARCHAR(50) NOT NULL,
    trigger_payload JSONB,
    idempotency_key VARCHAR(255),
    started_at TIMESTAMPTZ,
    finished_at TIMESTAMPTZ,
    duration_ms INTEGER,
    error_summary TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Step / Node Executions (Sanitized Payloads)
CREATE TABLE node_executions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    execution_id UUID NOT NULL REFERENCES executions(id) ON DELETE CASCADE,
    node_id VARCHAR(100) NOT NULL,
    node_type VARCHAR(100) NOT NULL,
    status node_status NOT NULL DEFAULT 'PENDING',
    retry_count INTEGER NOT NULL DEFAULT 0,
    input_payload JSONB, -- Redacted of secrets
    output_payload JSONB, -- Redacted of secrets
    error_details JSONB, -- { message, code, stack: redacted }
    started_at TIMESTAMPTZ,
    finished_at TIMESTAMPTZ,
    duration_ms INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Audit Logs
CREATE TABLE audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    action VARCHAR(100) NOT NULL, -- e.g. "workflow.publish", "credential.update", "workspace.invite"
    resource_type VARCHAR(100) NOT NULL,
    resource_id UUID NOT NULL,
    details JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for Query Performance
CREATE INDEX idx_memberships_user ON memberships(user_id);
CREATE INDEX idx_workflows_workspace ON workflows(workspace_id);
CREATE INDEX idx_workflow_versions_lookup ON workflow_versions(workflow_id, is_draft);
CREATE INDEX idx_executions_workspace_status ON executions(workspace_id, status);
CREATE INDEX idx_executions_workflow_started ON executions(workflow_id, started_at DESC);
CREATE INDEX idx_node_executions_execution ON node_executions(execution_id);
CREATE INDEX idx_executions_idempotency ON executions(workspace_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
```

---

## 7. Security Architecture & Threat Mitigations

### 7.1 Role-Based Access Control (RBAC) Matrix

Every API route and execution stream requires an active authenticated session and enforces workspace-level permissions according to the user's role in that workspace:

| Capability / Action | Owner | Admin | Editor | Viewer |
|---|:---:|:---:|:---:|:---:|
| **Delete Workspace / Transfer Ownership** | ✅ | ❌ | ❌ | ❌ |
| **Manage Members & Roles** | ✅ | ✅ | ❌ | ❌ |
| **Create / Update Credentials** | ✅ | ✅ | ❌ | ❌ |
| **Reference Credentials in Workflows** | ✅ | ✅ | ✅ | ❌ |
| **View Decrypted Credential Secrets** | ❌ (Never) | ❌ (Never) | ❌ (Never) | ❌ (Never) |
| **Create & Edit Workflow Drafts** | ✅ | ✅ | ✅ | ❌ |
| **Publish / Rollback Workflows** | ✅ | ✅ | ❌ | ❌ |
| **Execute Workflows (Manual Run / Test)** | ✅ | ✅ | ✅ | ❌ |
| **View Workflows & Canvas** | ✅ | ✅ | ✅ | ✅ |
| **View Execution History & Step Payloads** | ✅ | ✅ | ✅ | ✅ (Sanitized) |
| **Cancel Running Execution** | ✅ | ✅ | ✅ | ❌ |
| **View Workspace Audit Logs** | ✅ | ✅ | ❌ | ❌ |

### 7.2 Envelope Encryption for Credentials at Rest

- **Master Encryption Key (MEK):**
  - Configured via environment variable `ENCRYPTION_KEY` (32-byte / 256-bit cryptographically secure key, hex-encoded).
  - Versioned in database (`key_version = 1`) to support zero-downtime key rotation.
- **Encryption Scheme:**
  - Standard: **AES-256-GCM** (Galois/Counter Mode).
  - Initialization Vector (IV): 12 bytes randomly generated per encryption operation via `crypto.randomBytes(12)`. IV is never reused.
  - Authentication Tag: 16 bytes generated by GCM cipher to guarantee ciphertext integrity and authenticity.
  - Storage Payload in PostgreSQL `credentials.encrypted_payload`:
    ```json
    {
      "iv": "a1b2c3d4e5f6789012345678",
      "authTag": "f1e2d3c4b5a6978876543210fedcba98",
      "ciphertext": "0987654321abcdef..."
    }
    ```
- **Zero Plaintext Exfiltration:**
  - The API **never** exposes an endpoint to reveal decrypted credentials.
  - When returning credentials via `GET /api/v1/credentials`, only metadata (`id`, `name`, `type`, `createdAt`, `maskedHint`: `"••••••••abc"`) is transmitted.
  - Decryption happens exclusively in-memory inside `apps/worker` at the exact instant an action executes.

### 7.3 Secret Redaction Engine

- **Redaction Pipeline:**
  - All logs, execution step inputs, outputs, error messages, and exported workflow definitions pass through a multi-layer redaction filter before being logged or stored in PostgreSQL.
- **Redaction Layers:**
  1. **Exact Secret Masking:** The engine registers all decrypted credential values utilized during an execution and executes verbatim string replacement with `[REDACTED_SECRET]`.
  2. **Header Scrubbing:** Sensitive HTTP headers (`Authorization`, `Proxy-Authorization`, `X-Api-Key`, `Cookie`, `Set-Cookie`) are automatically replaced with `[REDACTED]`.
  3. **Key Pattern Matching:** Any JSON object key matching regex `/(token|secret|password|key|auth|credential|api_key|private)/i` has its corresponding string value masked.
  4. **Regex Entropy / Token Detectors:** Detects and masks JWT patterns (`eyJh...`), AWS keys (`AKIA...`), Slack tokens (`xox[baprs]-...`), Telegram bot tokens (`\d{9,10}:[A-Za-z0-9_-]{35}`), and private key headers (`-----BEGIN ... PRIVATE KEY-----`).

### 7.4 SSRF Defense Engine

All outbound network requests made by connectors (primarily `core.httpRequest` and `ai.openai`) are filtered through the SSRF defense agent:

1. **Denied Network Ranges (RFC 1918, RFC 3927, RFC 6890, RFC 4291):**
   - Loopback: `127.0.0.0/8`, `::1/128`
   - Private IPv4: `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`
   - Link-Local: `169.254.0.0/16`, `fe80::/10`
   - Carrier-Grade NAT: `100.64.0.0/10`
   - Cloud Metadata Services: `169.254.169.254`, `metadata.google.internal`
   - Broadcast / Multicast / Reserved: `0.0.0.0/8`, `224.0.0.0/4`, `240.0.0.0/4`
2. **DNS Rebinding Mitigation:**
   - The engine does not rely on URL hostname checks alone.
   - It performs initial DNS resolution (`dns.lookup`), verifies that all returned IP addresses are public, and pins the connection to the verified IP address via a custom `http.Agent` / `https.Agent`.
   - If an endpoint attempts an HTTP redirect (`301`, `302`), the redirect target URL is subjected to the exact same SSRF resolution validation before the client follows it.
3. **Admin Configurable Allowlist:**
   - For legitimate internal service automation (e.g. connecting to an internal CRM or ERP on `http://192.168.1.50:8080`), instance administrators can specify explicit CIDRs or hostnames via the `SSRF_ALLOWLIST` environment variable.

---

## 8. Deployment, Infrastructure & Environment

### 8.1 Docker Compose Architecture (`infra/compose.yaml`)

```yaml
version: '3.8'

services:
  postgres:
    image: postgres:16-alpine
    container_name: localflow-postgres
    restart: unless-stopped
    environment:
      POSTGRES_DB: ${POSTGRES_DB:-localflow}
      POSTGRES_USER: ${POSTGRES_USER:-localflow}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?Required}
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U $$POSTGRES_USER -d $$POSTGRES_DB"]
      interval: 5s
      timeout: 5s
      retries: 5
    networks:
      - localflow-internal

  redis:
    image: redis:7-alpine
    container_name: localflow-redis
    restart: unless-stopped
    command: ["redis-server", "--appendonly", "yes", "--requirepass", "${REDIS_PASSWORD:?Required}"]
    volumes:
      - redis_data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "-a", "${REDIS_PASSWORD}", "ping"]
      interval: 5s
      timeout: 5s
      retries: 5
    networks:
      - localflow-internal

  api:
    build:
      context: ..
      dockerfile: apps/api/Dockerfile
    container_name: localflow-api
    restart: unless-stopped
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    environment:
      NODE_ENV: production
      PORT: 4000
      DATABASE_URL: postgresql://${POSTGRES_USER:-localflow}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB:-localflow}
      REDIS_URL: redis://:${REDIS_PASSWORD}@redis:6379/0
      ENCRYPTION_KEY: ${ENCRYPTION_KEY:?Required}
      JWT_SECRET: ${JWT_SECRET:?Required}
      CORS_ORIGIN: ${CORS_ORIGIN:-http://localhost:3000}
      SSRF_ALLOWLIST: ${SSRF_ALLOWLIST:-}
      STORAGE_ALLOWED_PATHS: /data/storage
    volumes:
      - localflow_storage:/data/storage
    healthcheck:
      test: ["CMD-SHELL", "wget --no-verbose --tries=1 --spider http://127.0.0.1:4000/api/v1/health/ready || exit 1"]
      interval: 10s
      timeout: 5s
      retries: 3
    ports:
      - "${API_PORT:-4000}:4000"
    networks:
      - localflow-internal

  worker:
    build:
      context: ..
      dockerfile: apps/worker/Dockerfile
    container_name: localflow-worker
    restart: unless-stopped
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
      api:
        condition: service_healthy
    environment:
      NODE_ENV: production
      DATABASE_URL: postgresql://${POSTGRES_USER:-localflow}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB:-localflow}
      REDIS_URL: redis://:${REDIS_PASSWORD}@redis:6379/0
      ENCRYPTION_KEY: ${ENCRYPTION_KEY:?Required}
      SSRF_ALLOWLIST: ${SSRF_ALLOWLIST:-}
      STORAGE_ALLOWED_PATHS: /data/storage
    volumes:
      - localflow_storage:/data/storage
    networks:
      - localflow-internal

  web:
    build:
      context: ..
      dockerfile: apps/web/Dockerfile
    container_name: localflow-web
    restart: unless-stopped
    depends_on:
      api:
        condition: service_healthy
    ports:
      - "${WEB_PORT:-3000}:80"
    networks:
      - localflow-internal

volumes:
  postgres_data:
    name: localflow_postgres_data
  redis_data:
    name: localflow_redis_data
  localflow_storage:
    name: localflow_storage_data

networks:
  localflow-internal:
    driver: bridge
```

### 8.2 Environment Variable Specification (`.env.example`)

```bash
# ==============================================================================
# LocalFlow Environment Configuration (.env.example)
# ==============================================================================

# Node Environment
NODE_ENV=production

# Server Ports
WEB_PORT=3000
API_PORT=4000

# PostgreSQL Database Configuration
POSTGRES_DB=localflow
POSTGRES_USER=localflow
POSTGRES_PASSWORD=generate_a_strong_postgres_password_here
DATABASE_URL=postgresql://localflow:generate_a_strong_postgres_password_here@postgres:5432/localflow

# Redis Configuration
REDIS_PASSWORD=generate_a_strong_redis_password_here
REDIS_URL=redis://:generate_a_strong_redis_password_here@redis:6379/0

# Security & Secrets
# 32-byte hex-encoded key for AES-256-GCM envelope encryption (openssl rand -hex 32)
ENCRYPTION_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
# Cryptographic secret for signing session tokens and webhook signatures
JWT_SECRET=generate_a_long_random_jwt_secret_at_least_64_characters_long

# CORS & Host URL
CORS_ORIGIN=http://localhost:3000
PUBLIC_API_URL=http://localhost:4000

# SSRF Network Protections
# Comma-separated list of permitted internal CIDRs or domain names for intranet automation
# Example: SSRF_ALLOWLIST=192.168.1.0/24,intranet.local
SSRF_ALLOWLIST=

# Filesystem Connector Storage
# Absolute path inside containers permitted for file node read/write operations
STORAGE_ALLOWED_PATHS=/data/storage

# Execution Limits
MAX_EXECUTION_TIMEOUT_MS=300000
MAX_PAYLOAD_SIZE_BYTES=5242880
MAX_CONCURRENT_JOBS_PER_WORKER=10
```

---

## 9. Features Discovered Table

| # | Category | Feature | Description | Inputs | Outputs | Error Behavior | Discovered Via |
|---|---|---|---|---|---|---|---|
| 1 | Architecture | Monorepo Structure | pnpm + Turborepo modular architecture with strict boundaries (`apps/web`, `apps/api`, `apps/worker`, `packages/*`) | Source files, configs | Built artifacts, containers | Build fails on dependency violation | PRD §5.1, §10 |
| 2 | Architecture | Independent DAG Engine | Custom deterministic workflow runner, decoupled from any third-party engine (ADR-001) | Workflow snapshot, trigger payload | Execution step results, final status | Returns detailed error trace | PRD §1.0, §11 (ADR-001) |
| 3 | Execution | State Machine Persistence | Durable execution states (`QUEUED`, `RUNNING`, `WAITING`, `SUCCEEDED`, `FAILED`, `CANCELLED`) stored in PostgreSQL | State transition event | Persisted database row | Rollback transaction on DB failure | PRD §5.3, ORIGINAL_REQUEST §R1 |
| 4 | Execution | BullMQ Task Queue | Redis-backed distributed task queue for asynchronous workflow and step jobs | Job ID, execution data | Dequeued job execution | Unacknowledged jobs return to queue | PRD §5.1, §5.2 |
| 5 | Execution | Worker Restart Durability | Resilient execution resumption after worker kill or crash without duplicate side effects | Stalled job in BullMQ | Resumed execution from step journal | Interrupted steps flagged if non-idempotent | PRD §5.3, §8.7 |
| 6 | Execution | Execution Cancellation | Dynamic cancellation of in-flight or waiting executions via API `/executions/:id/cancel` | Execution ID | Updated state `CANCELLED` | Ignores already terminal runs | PRD §3.2 (OR-05), §5.5 |
| 7 | Orchestration | Cycle Rejection | Topological sort validation blocking cycles in graph editor and publish gates | Node graph definition | Success or cycle error | Throws `ERR_CYCLIC_DEPENDENCY` | PRD §3.1 (ED-02) |
| 8 | Orchestration | Branch / IF Primitive | Conditional routing between `true` and `false` output handles based on expression | Evaluated expression, payload | Routed payload to selected branch | Non-boolean condition defaults false | PRD §3.2 (OR-03) |
| 9 | Orchestration | Filter Primitive | Evaluates collection elements against predicate, routing passed items | Array payload, predicate | Filtered array | Drops items on expression error | PRD §3.2 (OR-03) |
| 10 | Orchestration | Map / Transform | Transforms JSON payload according to defined mapping template | Source payload, mapping config | Transformed JSON object | Throws validation error if required field missing | PRD §3.2 (OR-03) |
| 11 | Orchestration | Delay Primitive | Suspends workflow execution for specified time using BullMQ delayed jobs | Duration in ms/sec/min | Resumed execution trigger | Invalid duration throws error | PRD §3.2 (OR-03) |
| 12 | Orchestration | For Each Primitive | Iterates over input arrays with bounded concurrency, aggregate results | Array payload, concurrency limit | Item streams and completed batch | Halts iteration on sub-graph failure | PRD §3.2 (OR-03) |
| 13 | Orchestration | Merge Primitive | Synchronizes converging DAG branches using `WAIT_ALL` or `WAIT_ANY` | Multiple inbound branch inputs | Consolidated payload | Missing required branch halts execution | PRD §3.2 (OR-03) |
| 14 | Orchestration | Safe Expression Evaluator | AST-based expression interpolator (`$trigger`, `$nodes.<id>.output`) without `eval()` | Expression string, context object | Evaluated value | Throws safe syntax error, no code execution | PRD §3.1 (ED-04), §6 |
| 15 | Triggers | Manual Trigger | Ad-hoc run initiation from UI or API endpoint `/workflows/:id/execute` | Workflow ID, optional payload | Execution record & ID | 404 if workflow not found, 403 if unauthorized | PRD §3.2 (OR-01), §5.5 |
| 16 | Triggers | Cron Trigger | Time-based scheduling with crontab syntax, timezone handling, and catch-up policy | Cron expression, timezone | Scheduled execution run | Rejects invalid cron format | PRD §3.2 (OR-01), §5.3 |
| 17 | Triggers | Webhook Trigger | Ingress HTTP endpoint `/api/v1/hooks/:endpointId` supporting HMAC and idempotency | HTTP method, headers, body | Execution queued (202 Accepted) | 401 on invalid signature, 429 on rate limit | PRD §3.2 (OR-01, OR-04), §5.5 |
| 18 | Triggers | Telegram Polling Trigger | Long-polling `getUpdates` worker daemon fetching Telegram bot events | Bot credential, update types | Execution queued per update | Backs off on Telegram API error | PRD §3.2 (OR-01), §3.3 |
| 19 | Connectors | HTTP Request (SSRF Guard) | Outbound HTTP requests with strict IP range blocking, auth, and pagination | URL, method, headers, body, auth | HTTP status, headers, body | 403 on blocked SSRF target IP | PRD §3.3, §6, ORIGINAL_REQUEST §R4 |
| 20 | Connectors | JSON Transform Connector | Projection, path extraction, and stringify/parse utility for JSON | JSON payload, path / template | Transformed output | Emits `ERR_JSON_INVALID` on malformed string | PRD §3.3 |
| 21 | Connectors | CSV Connector | Bidirectional conversion between CSV text and JSON record arrays | CSV string or JSON array | Converted JSON or CSV string | Emits parse error with line number | PRD §3.3 |
| 22 | Connectors | RSS / Atom Read | Fetches and parses RSS/Atom feeds, deduplicating items by GUID | Feed URL, optional auth | Array of parsed feed items | Throws on network or XML parse failure | PRD §3.3 |
| 23 | Connectors | Send Email (SMTP) | Transmits emails via SMTP with TLS/STARTTLS authentication | Host, port, credentials, email fields | Delivery receipt `{ messageId }` | Throws SMTP auth / connection error | PRD §3.3 |
| 24 | Connectors | PostgreSQL SQL Connector | Executes parameterized SQL queries with read-only transaction safeguards | Query string, parameters array | Query rows, rowCount, fields | Throws SQL syntax / connection error | PRD §3.3 |
| 25 | Connectors | Telegram Bot Connector | Sends messages, photos, and formatted Markdown/HTML via Bot API | Chat ID, message text, media | Telegram message response | 429 on rate limit (retries with backoff) | PRD §3.3 |
| 26 | Connectors | Generic OpenAI LLM | Calls OpenAI-compatible endpoints with prompt and JSON schema validation | Base URL, API key, model, prompt | LLM text and structured JSON | Throws on provider error or schema mismatch | PRD §3.3, §3.4 |
| 27 | Connectors | Local Ollama Connector | Interacts with local Ollama daemon for inference without cloud dependencies | Host URL, model name, prompt | Completed response text | Throws if model unavailable or host unreachable | PRD §3.3, §3.4 |
| 28 | Connectors | Controlled Filesystem | Reads, writes, and lists files within strictly mounted directories | Action, relative file path, content | File contents or operation status | Throws `ERR_PATH_TRAVERSAL` if escaping root | PRD §3.3, ORIGINAL_REQUEST §R1 |
| 29 | Data Models | Draft vs Published Versions | Workflow snapshot immutability; draft updates do not alter published runs | Workflow ID, version draft | Published version snapshot | Cannot publish without valid trigger & schema | PRD §3.1 (ED-05), §5.3 |
| 30 | Data Models | Envelope Credential Vault | AES-256-GCM encrypted credentials at rest with versioned keys | Credential secrets, key version | Ciphertext, IV, AuthTag | Decryption fails on tampered payload | PRD §5.1, §6 |
| 31 | Security | Workspace RBAC | Role permissions (Owner, Admin, Editor, Viewer) on workspaces and resources | User session, requested action | Authorized / Forbidden | 403 Forbidden on privilege violation | PRD §3.5, §6 |
| 32 | Security | Secret Redaction Engine | Automatic sanitization of credentials, auth headers, and tokens in logs & UI | Log entry or step payload | Sanitized payload string | Replaces sensitive values with `[REDACTED]` | PRD §6, §8.5 |
| 33 | Security | Owner Bootstrapping | First-run setup wizard creates initial system owner; closes further registration | Owner registration payload | Created owner account & session | Rejects bootstrapping once owner exists | PRD §3.5, §6 |
| 34 | Deployment | Single-Command Compose | Docker Compose starting `web`, `api`, `worker`, `postgres`, `redis` with health checks | `docker compose up -d` | All services running & healthy | Fails if environment variables missing | PRD §5.1, §8.1 |
| 35 | Observability | Health Checks & Metrics | Liveness (`/health/live`), readiness (`/health/ready`), and Prometheus metrics | HTTP GET request | Health status JSON / Prometheus text | Returns 503 if DB or Redis down | PRD §5.1, §5.5 |
| 36 | UI / UX | Unslop Visual Standards | Disciplined, high-contrast, editorial React Flow canvas and config inspector | User interaction | Modern, responsive visual canvas | WCAG 2.2 AA compliant contrast | PRD §7, ORIGINAL_REQUEST §R3 |

---

## 10. Edge Cases & Boundary Conditions Table

| # | Feature | Input / Condition | Observed & Specified Behavior |
|---|---|---|---|
| 1 | Execution Engine | Worker container abruptly killed (`SIGKILL`) while executing HTTP Request node | BullMQ lock expires; stalled job supervisor detects unfinished run; worker reloads step journal from PostgreSQL, verifies HTTP step was incomplete, resumes or retries without duplicating prior steps. |
| 2 | Execution Engine | Workflow encounters an infinite execution loop due to cyclic edge configuration | Cycle detection rejects workflow during draft validation and publish gates (`ERR_CYCLIC_DEPENDENCY_DETECTED`). Cannot be enqueued. |
| 3 | Execution Engine | Workflow step payload exceeds `MAX_PAYLOAD_SIZE_BYTES` (5MB) | Node execution halts with error `ERR_PAYLOAD_TOO_LARGE`; payload is truncated or flagged for blob storage offload; prevents worker memory exhaustion. |
| 4 | Execution Engine | Execution run reaches global timeout `MAX_EXECUTION_TIMEOUT_MS` (5 minutes) | Watchdog terminates in-flight execution, marks status `CANCELLED` with reason `ERR_EXECUTION_TIMED_OUT`, and notifies client via SSE. |
| 5 | Graph Primitives | IF condition receives `null`, `undefined`, or unresolvable expression path | Evaluator safely treats invalid/null condition as `false`, routing data through `false` port and marking `true` branch as `SKIPPED`. |
| 6 | Graph Primitives | For Each primitive receives an empty array (`[]`) | Bypasses `item` iteration sub-graph; immediately triggers `done` handle with empty result array. |
| 7 | Graph Primitives | For Each encounters failure in item 3 of 10 while `continueOnError` is false | Stops processing remaining items; marks For Each node `FAILED`; records index 3 in error details. |
| 8 | Graph Primitives | Merge node in `WAIT_ALL` mode where one incoming branch is permanently SKIPPED by an IF node | Engine detects that the skipped branch will never produce an output; automatically releases Merge node with active branch inputs, avoiding deadlocks. |
| 9 | Cron Trigger | Host clock undergoes Daylight Saving Time (DST) shift backwards by 1 hour | Cron scheduler uses persistent timezone normalization and records timestamp of last triggered tick to prevent firing duplicate runs within the repeated hour. |
| 10 | Cron Trigger | Worker was offline during 3 scheduled cron intervals; `catchUpPolicy = SKIP` | Worker resumes, calculates current schedule, drops the 3 missed intervals, and waits for next future tick. |
| 11 | Webhook Trigger | Client transmits duplicate webhook with same `X-Idempotency-Key` within 10 seconds | Redis idempotency cache identifies active/completed execution; returns identical `202 Accepted` or cached response without enqueuing duplicate job. |
| 12 | Webhook Trigger | Inbound webhook payload contains invalid HMAC signature | Fastify route immediately rejects request with `401 Unauthorized`; logs security warning; does not enqueue job. |
| 13 | Telegram Polling | Telegram API returns HTTP 429 Too Many Requests (`retry_after: 25`) | Polling daemon pauses requests for 25 seconds; enters exponential backoff; resumes polling automatically without crashing worker. |
| 14 | HTTP Connector | Target URL resolves to AWS metadata endpoint `http://169.254.169.254/latest/meta-data/` | SSRF defense interceptor resolves IP, identifies restricted link-local metadata range, aborts connection immediately with `ERR_SSRF_BLOCKED`. |
| 15 | HTTP Connector | Target URL uses DNS rebinding (resolves to public IP on first check, private IP on socket connect) | Custom agent performs DNS resolution, pins the connection directly to the verified socket IP address, preventing DNS rebinding. |
| 16 | HTTP Connector | Remote HTTP server returns 302 redirect pointing to `http://127.0.0.1:5432` | Redirect interceptor subjects destination URL to full SSRF validation; blocks redirect to loopback with `ERR_SSRF_BLOCKED`. |
| 17 | Filesystem Connector | Node configuration requests path `../../../../etc/passwd` | Path resolver evaluates `path.resolve(ALLOWED_BASE, inputPath)`; detects target path is outside allowed root; raises `ERR_PATH_TRAVERSAL_DETECTED`. |
| 18 | Credentials | Administrator updates Master Encryption Key (`ENCRYPTION_KEY`) for key rotation | System reads `key_version` from credentials; decrypts legacy credentials using old key; re-encrypts using new key; updates `key_version = 2`. |
| 19 | Secret Redaction | An error stack trace from a third-party API includes the raw Bearer token in the URL | Redaction regex strips token matching known credential values and auth patterns, replacing it with `[REDACTED_SECRET]` before saving to `node_executions.error_details`. |
| 20 | RBAC Security | User with `VIEWER` role attempts to trigger manual run via `POST /api/v1/workflows/:id/execute` | Fastify RBAC pre-handler verifies membership role; rejects with `403 Forbidden` (`ERR_INSUFFICIENT_PERMISSIONS`). |
| 21 | RBAC Security | User with `EDITOR` role attempts to fetch credentials list via `GET /api/v1/credentials` | API returns credential IDs, names, and types for workflow binding, but completely omits secret keys and raw tokens. |
| 22 | Postgres Connector | User inputs raw SQL query with unescaped user string `SELECT * FROM users WHERE id = '` + `$trigger.id` | Postgres connector enforces mandatory parameterization array (`$1`); raw string concatenation is rejected during node validation. |
| 23 | Docker Compose | PostgreSQL container starts slower than API service | Docker Compose health checks prevent API from starting until PostgreSQL passes `pg_isready`; API connection pool retries with backoff. |
| 24 | Workflow Versioning | User edits draft canvas while workflow v1 is currently executing a 10-minute job | Active execution references immutable `workflow_versions` snapshot v1; edits only affect `is_draft = true` record; running workflow finishes unaffected. |
