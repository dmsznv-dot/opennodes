# Project: LocalFlow

## Architecture
LocalFlow is an independent, deterministic workflow execution platform and visual automation engine designed for single-command self-hosted deployment.

### System Components & Runtime Boundaries
1. **Web Frontend (`apps/web`)**:
   - Modern visual IDE built on React, Vite, `@xyflow/react` (React Flow), Tailwind CSS, and shadcn/ui.
   - Strictly conforms to Unslop design principles: Ink/Graphite neutral ramp, Electric Cobalt (`#3b82f6`) accent (<2% surface), calm editorial typography, 4px spacing scale, nested radii, zero slop/purple gradients/glows.
   - Features: Typed port handles, real-time DFS cycle rejection, draft vs. immutable published version switcher, 480px JSON schema node configuration drawer, SSE execution run inspector, and `/setup` owner bootstrap wizard.
2. **API Gateway (`apps/api`)**:
   - Fastify HTTP service exposing typed OpenAPI endpoints, session/JWT authentication, and Server-Sent Events (`/api/v1/executions/:id/events`).
   - Enforces 4-tier RBAC (`Owner`, `Admin`, `Editor`, `Viewer`) on all workspace resources.
   - Webhook trigger ingestion endpoint with HMAC verification and idempotency keys.
   - Manual workflow execution trigger endpoint enqueuing execution jobs to BullMQ.
3. **Execution Worker (`apps/worker`)**:
   - Standalone daemon consuming workflow execution jobs from Redis/BullMQ.
   - Embeds deterministic DAG execution engine (`packages/workflow-engine`).
   - Telegram Polling daemon (`getUpdates`) receiving bot messages and enqueuing workflow runs.
   - Durable PostgreSQL journaling per step (`QUEUED`, `RUNNING`, `SUCCEEDED`, `FAILED`, `CANCELLED`).
   - Worker restart crash recovery: re-checks execution step journal to resume stalled jobs idempotently without side-effect re-execution.
4. **Shared Packages (`packages/*`)**:
   - `workflow-schema`: Zod schemas and TypeScript types for workflows, nodes, edges, ports, credentials, and execution events.
   - `workflow-engine`: Topological sorter, safe AST template expression evaluator (no `eval()`), state machine, and graph primitives (`Branch/IF`, `Filter`, `Map/Transform`, `Delay`, `For Each`, `Merge`).
   - `connector-sdk`: Standardized interfaces, manifest contracts, input/output port definitions, and error classes.
   - `connectors-core`: 10 foundational connectors (HTTP Request with SSRF guard, Webhook, Cron, JSON transform, CSV, RSS/Atom, SMTP email, PostgreSQL SQL, Telegram Bot, Filesystem).
   - `connectors-ai`: AI connectors (OpenAI-compatible LLM, local Ollama).
   - `db`: Drizzle ORM schema (18 tables), migrations, connection pooling, and in-memory mock adapters for testing.
   - `auth`: Envelope encryption (AES-256-GCM), password hashing (Argon2id/bcrypt), session management, and RBAC policy engine.
   - `observability`: Structured logging (Pino), secret redaction pipeline (recursive token masking), and telemetry.
   - `ui`: Shared Unslop design tokens, base UI components, and theme definitions.
   - `shared`: Utility functions, error handling primitives, and constants.

### Security Architecture
- **Envelope Encryption**: Credentials encrypted at rest using AES-256-GCM with versioned data encryption keys (`key_version`, `iv`, `authTag`, `ciphertext`). Secrets are never revealed in plaintext API responses, logs, or exports.
- **SSRF Defense**: Outgoing HTTP connector enforces strict DNS resolution check and socket IP pinning, blocking RFC1918 private ranges (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`), loopback (`127.0.0.0/8`), link-local (`169.254.0.0/16`), and cloud metadata IP (`169.254.169.254`).
- **Secret Redaction**: Multi-tier pipeline masking sensitive keys (`password`, `secret`, `token`, `key`, `authorization`) across execution logs, UI inspector outputs, and exported workflow definitions.

---

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| F01 | Monorepo Tooling & Setup | pnpm workspace, Turborepo, tsconfig, ESLint, test runner | M1 | Survey (Codebase) |
| F02 | Drizzle Database Models | 18 PostgreSQL tables, relations, and in-memory test compatibility | M1 | Survey (Spec & Codebase) |
| F03 | RBAC & Identity | Owner bootstrapping, 4 roles (Owner, Admin, Editor, Viewer), sessions | M1 | Survey (Spec) |
| F04 | Credential Envelope Encryption | AES-256-GCM with versioned keys and zero plaintext exposure | M1 | Survey (Spec) |
| F05 | Secret Redaction Engine | Recursive masking of sensitive tokens in logs, UI, exports | M1 | Survey (Spec) |
| F06 | SSRF Protection Engine | DNS resolution and socket-level IP pinning blocking private/metadata IPs | M1 | Survey (Spec) |
| F07 | Workflow Definition Schema | Zod schemas for workflows, typed node ports, edges, and validations | M1 | Survey (Spec) |
| F08 | Cycle Prevention Engine | Real-time DFS / Kahn's algorithm topological validator | M1 | Survey (Spec & UI) |
| F09 | Safe Expression Evaluator | AST-based template evaluator (`{{ ... }}`) without `eval()` | M2 | Survey (Spec) |
| F10 | Execution Engine Core | Deterministic DAG runner with state machine transitions | M2 | Survey (Spec) |
| F11 | BullMQ Task Queue | Redis queue, concurrency control, exponential retry, DLQ | M2 | Survey (Spec) |
| F12 | Durable State Persistence | PostgreSQL journaling of workflow and node execution transitions | M2 | Survey (Spec) |
| F13 | Worker Restart Crash Recovery | Idempotent resume of stalled jobs without re-executing completed side-effects | M2 | Survey (Spec) |
| F14 | Graph Primitive: Branch / IF | Conditional branching based on boolean expression evaluation | M2 | Survey (Spec) |
| F15 | Graph Primitive: Filter | Discards items not matching criteria from downstream execution | M2 | Survey (Spec) |
| F16 | Graph Primitive: Map / Transform | Object and array transformation using expression mapping | M2 | Survey (Spec) |
| F17 | Graph Primitive: Delay / Wait | Asynchronous execution pausing via BullMQ delayed jobs | M2 | Survey (Spec) |
| F18 | Graph Primitive: For Each | Iterative loop primitive with item and done output handles | M2 | Survey (Spec) |
| F19 | Graph Primitive: Merge | Aggregates outputs from multiple incoming execution branches | M2 | Survey (Spec) |
| F20 | Trigger: Manual | Immediate execution trigger via API or canvas Run button | M3 | Survey (Spec) |
| F21 | Trigger: Cron Schedule | Automated recurring scheduling with timezone support | M3 | Survey (Spec) |
| F22 | Trigger: Webhook | Incoming webhook endpoint with HMAC validation and idempotency | M3 | Survey (Spec) |
| F23 | Trigger: Telegram Polling | Long-polling daemon for incoming Telegram bot messages | M3 | Survey (Spec) |
| F24 | Connector: HTTP Request | Full-featured HTTP client with methods, headers, body, SSRF check | M3 | Survey (Spec) |
| F25 | Connector: Outgoing Webhook | Dispatches external webhooks with payload payloads and retries | M3 | Survey (Spec) |
| F26 | Connector: Cron / Timer | Inline timing and delay actions | M3 | Survey (Spec) |
| F27 | Connector: JSON Transform | JSON querying and reshaping | M3 | Survey (Spec) |
| F28 | Connector: CSV Parser / Generator | CSV to JSON and JSON to CSV transformation | M3 | Survey (Spec) |
| F29 | Connector: RSS / Atom Reader | Fetches and parses RSS/Atom XML feeds into structured items | M3 | Survey (Spec) |
| F30 | Connector: SMTP Send Email | Dispatches formatted emails via SMTP credentials | M3 | Survey (Spec) |
| F31 | Connector: PostgreSQL SQL | Parameterized SQL queries against user databases | M3 | Survey (Spec) |
| F32 | Connector: Telegram Bot | Telegram sendMessage and message dispatch | M3 | Survey (Spec) |
| F33 | Connector: OpenAI-Compatible LLM | Chat completion calls with model, temperature, prompt configs | M3 | Survey (Spec) |
| F34 | Connector: Local Ollama | Local LLM inference integration via Ollama API | M3 | Survey (Spec) |
| F35 | Connector: Controlled Filesystem | Sandboxed file read/write within whitelisted directory mounts | M3 | Survey (Spec) |
| F36 | Fastify API Service | REST API endpoints for workflows, runs, credentials, and settings | M4 | Survey (Spec) |
| F37 | SSE Streaming Service | Real-time event streaming of execution state and step updates | M4 | Survey (Spec) |
| F38 | Docker Compose Deployment | Multi-container compose.yaml with health checks and .env.example | M4 | Survey (Spec & Codebase) |
| F39 | Unslop Visual Design System | Ink/Graphite ramp, Cobalt accent, 4px grid, calm typography | M5 | Survey (UI) |
| F40 | React Flow Canvas | Custom node cards, typed port handles, smoothstep edge routing | M5 | Survey (UI) |
| F41 | Node Configuration Drawer | 480px slide-over panel with dynamic JSON schema forms | M5 | Survey (UI) |
| F42 | Workflow Versioning UI | Draft vs published switcher and publication validation gate | M5 | Survey (UI) |
| F43 | Execution Run Inspector | Node status badges, micro-timing durations, sanitized step I/O viewer | M5 | Survey (UI) |
| F44 | Setup & Onboarding Wizard | `/setup` initial owner bootstrapping and workspace creation | M5 | Survey (UI) |
| F45 | Automated E2E Test Suite | Self-contained Tiers 1-5 test harness with in-memory mocks | M6 | Survey (Codebase & Spec) |

---

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | Core Foundation & Security | Monorepo scaffolding, Drizzle schema, AES envelope encryption, SSRF guard, RBAC, workflow schemas, cycle validator | none | DONE |
| M2 | Execution Engine & Primitives | DAG execution engine, safe template evaluator, BullMQ worker, durable state journal, crash recovery, 6 graph primitives | M1 | IN_PROGRESS |
| M3 | Triggers & Foundational Connectors | Manual, Cron, Webhook, Telegram triggers; 12+ foundational connectors (HTTP, CSV, RSS, SMTP, Postgres, LLM, Ollama, etc.) | M2 | PLANNED |
| M4 | API Service & Deployment | Fastify REST API, SSE streaming, Docker Compose config with health checks, .env.example | M3 | PLANNED |
| M5 | Web Application & Visual Canvas | Vite + React Flow canvas, Unslop design tokens, node config drawer, versioning UI, run inspector, setup wizard | M4 | PLANNED |
| M6 | E2E Testing Pass & Hardening | 100% pass of E2E Test Suite (Tiers 1-4) published by E2E Testing Track, followed by Tier 5 Adversarial Coverage Hardening | M5, TEST_READY.md |

---

## Interface Contracts

### 1. `workflow-schema` ↔ `workflow-engine`
```typescript
export interface NodePort {
  id: string;
  name: string;
  type: 'trigger' | 'json' | 'string' | 'number' | 'boolean' | 'binary' | 'any';
  direction: 'input' | 'output';
}

export interface WorkflowNode {
  id: string;
  type: string;
  data: {
    label: string;
    config: Record<string, unknown>;
    credentialId?: string;
  };
  inputs: NodePort[];
  outputs: NodePort[];
}

export interface WorkflowEdge {
  id: string;
  source: string;
  sourceHandle: string;
  target: string;
  targetHandle: string;
}

export interface WorkflowDefinition {
  id: string;
  workspaceId: string;
  name: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}
```

### 2. `workflow-engine` ↔ `db` (Execution Journal)
```typescript
export type ExecutionStatus = 'QUEUED' | 'RUNNING' | 'WAITING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED';

export interface StepExecutionRecord {
  id: string;
  executionId: string;
  nodeId: string;
  status: ExecutionStatus;
  startedAt?: Date;
  completedAt?: Date;
  durationMs?: number;
  inputPayload?: unknown;
  outputPayload?: unknown;
  errorMessage?: string;
  retryCount: number;
}
```

### 3. `connector-sdk` ↔ `connectors-*`
```typescript
export interface ConnectorContext {
  workspaceId: string;
  credentials?: Record<string, unknown>;
  logger: Logger;
  httpClient: SafeHttpClient; // SSRF-enforced HTTP client
}

export interface ConnectorAction<TInput = unknown, TOutput = unknown> {
  name: string;
  execute(input: TInput, ctx: ConnectorContext): Promise<TOutput>;
}
```

### 4. `auth` ↔ `api` / `connectors` (Envelope Encryption & Redaction)
```typescript
export interface EncryptedData {
  keyVersion: number;
  iv: string;       // base64
  authTag: string;  // base64
  ciphertext: string; // base64
}

export interface EncryptionService {
  encrypt(plaintext: string): Promise<EncryptedData>;
  decrypt(data: EncryptedData): Promise<string>;
}

export interface RedactionService {
  redact(obj: unknown): unknown; // recursively masks passwords, tokens, secrets
}
```

---

## Code Layout
```
/Users/dmitrysazonov/.gemini/antigravity/scratch/opennodes/
├── package.json
├── pnpm-workspace.yaml
├── turbo.json
├── tsconfig.base.json
├── .env.example
├── docker-compose.yml
├── infra/
│   ├── Dockerfile.api
│   ├── Dockerfile.worker
│   └── Dockerfile.web
├── apps/
│   ├── api/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   ├── worker/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   └── web/
│       ├── package.json
│       ├── tsconfig.json
│       ├── vite.config.ts
│       └── src/
├── packages/
│   ├── workflow-schema/
│   ├── workflow-engine/
│   ├── connector-sdk/
│   ├── connectors-core/
│   ├── connectors-ai/
│   ├── db/
│   ├── auth/
│   ├── observability/
│   ├── ui/
│   └── shared/
└── tests/
    ├── e2e/
    └── fixtures/
```
