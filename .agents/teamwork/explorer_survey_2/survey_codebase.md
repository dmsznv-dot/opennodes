# Codebase & Repository Survey Report: LocalFlow (OpenNodes)

**Date:** 2026-11-02  
**Explorer:** Survey Explorer 2 (Codebase & Repository Inspector)  
**Target Repository:** `https://github.com/dmsznv-dot/opennodes`  
**Target Workspace:** `/Users/dmitrysazonov/.gemini/antigravity/scratch/opennodes`  
**Reference Documents:**  
- Product Requirements & Technical Architecture v1.0 (`/Users/dmitrysazonov/Downloads/LocalFlow_PRD_Architecture_v1.md`)  
- Original User Request (`/Users/dmitrysazonov/.gemini/antigravity/scratch/opennodes/.agents/teamwork/ORIGINAL_REQUEST.md`)  

---

## 1. Executive Summary & Repository Baseline

### 1.1 Repository Status
An exhaustive inspection of the target working directory and git remote revealed the following ground-truth status:
1. **GitHub Remote (`https://github.com/dmsznv-dot/opennodes`):**
   - Repository ID: `1442687662` (`node_id: R_kgDOVf2qrg`).
   - Created: `2026-11-02T08:15:21Z` (public repository created by user `dmsznv-dot`).
   - Repository size: `0 bytes`. Total commits: `0`. Total branches: `0` (default branch target: `main`).
   - The remote is a completely fresh, uninitialized GitHub repository.

2. **Local Workspace (`/Users/dmitrysazonov/.gemini/antigravity/scratch/opennodes`):**
   - Directory state: Contains only `.agents/teamwork/` metadata directories created by the AI orchestrator and survey agents.
   - Local `.git` folder: **None**. Running `git status` inside this directory traverses up into `/Users/dmitrysazonov/` where a parent user repository exists.
   - Existing source code files: **0 files**.
   - Existing configurations (`package.json`, `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.json`): **0 files**.
   - Existing Docker / container files: **0 files**.

### 1.2 Core Discovery
**LocalFlow is a 100% greenfield implementation.** There is no legacy or partial code to migrate or refactor. The entire monorepo architecture, application code, packages, database layer, queue system, execution engine, connectors, web canvas, security controls, and Docker deployment must be constructed from scratch in strict compliance with the PRD and Original Request.

---

## 2. Host System & Runtime Environment Audit

A full environment audit of the developer host machine (`macOS`, Apple Silicon Darwin ARM64) was performed:

| Tool / Runtime | Installed Version / Status | Location / Notes | Impact on Architecture & Setup |
|---|---|---|---|
| **Node.js** | `v24.21.0` (LTS/Current) | `/Users/dmitrysazonov/.nvm/versions/node/v24.21.0/bin/node` | Compatible with modern ES2024 features, Node.js native test runner/fetch/crypto. |
| **npm** | `12.2.0` | `/Users/dmitrysazonov/.nvm/versions/node/v24.21.0/bin/npm` | Global package manager available. |
| **Corepack** | `0.36.0` | `/Users/dmitrysazonov/.nvm/versions/node/v24.21.0/bin/corepack` | Available for enabling package managers. |
| **pnpm** | `12.16.1` (Activated) | `/Users/dmitrysazonov/.local/bin/pnpm` | Successfully enabled via corepack; ready for monorepo workspace management. |
| **Git** | `2.50.1` (Apple Git-155) | `/usr/bin/git` | Needs explicit `git init` in `opennodes` root to isolate from home directory. |
| **Docker** | **Not found** in `$PATH` | No Docker daemon running locally | **Critical**: Production Dockerfiles and `compose.yaml` must be created, but automated test suites (unit, contract, integration) MUST be capable of running standalone without an active Docker daemon (using in-memory mocks / PGlite / SQLite compatibility for tests). |
| **PostgreSQL CLI** | **Not found** (`psql` missing) | No local PostgreSQL daemon running | Automated tests require mock DB adapter / embedded PG runner (e.g. `pg-mem`, PGlite, or SQLite abstraction for test harness). |
| **Redis CLI** | **Not found** (`redis-cli` missing) | No local Redis daemon running | Queue test harness requires `ioredis-mock` or embedded in-memory queue fallback for test suites. |

---

## 3. Monorepo Architecture Blueprint

In accordance with PRD Section 5.1 and Section 10, the project must be structured as a Turborepo-managed monorepo powered by `pnpm` workspaces with TypeScript strict mode across all packages.

### 3.1 Workspace Layout
```text
opennodes/
├── .github/
│   └── workflows/
│       ├── ci.yml                 # Lint, Typecheck, Unit & Integration Tests
│       └── release.yml            # Container build and artifact tagging
├── apps/
│   ├── api/                       # Fastify REST API, SSE endpoints, Webhook ingress
│   ├── web/                       # React 18/19 + Vite + React Flow + Tailwind CSS UI
│   └── worker/                    # BullMQ job orchestrator, workflow step executors
├── packages/
│   ├── auth/                      # Session management, RBAC checks, password hashing
│   ├── connector-sdk/             # Typed connector interfaces, manifest schemas, base types
│   ├── connectors-ai/             # OpenAI-compatible HTTP connector, local Ollama connector
│   ├── connectors-core/           # HTTP Request, Webhook, Cron, JSON, CSV, RSS, SMTP, Postgres, Telegram, Filesystem
│   ├── db/                        # Drizzle ORM schema, migrations, connection pool, seeders
│   ├── observability/             # Structured JSON logger, OpenTelemetry hooks, metrics
│   ├── shared/                    # Common DTOs, error classes, utility helpers
│   ├── ui/                        # Unslop design tokens, shadcn/Radix components, icons
│   ├── workflow-engine/           # Deterministic DAG execution engine, cycle detection, state machine
│   └── workflow-schema/           # Zod schemas for nodes, edges, versions, triggers, execution events
├── infra/
│   ├── docker/
│   │   ├── Dockerfile.api
│   │   ├── Dockerfile.web
│   │   ├── Dockerfile.worker
│   │   └── nginx.conf             # Optional reverse proxy configuration
│   ├── compose.yaml               # Canonical production multi-container deployment
│   └── compose.dev.yaml           # Local development override with volume mounting
├── tests/
│   ├── contracts/                 # Schema & API contract tests
│   ├── e2e/                       # Full workflow lifecycle and worker crash resilience tests
│   ├── fixtures/                  # Test payloads, mocked external responses, node templates
│   └── security/                  # SSRF, RBAC boundary, secret redaction validation tests
├── .env.example                   # Complete documented environment variables
├── .gitignore                     # Node, build, test, and environment ignores
├── package.json                   # Root workspace manifest with global scripts
├── pnpm-workspace.yaml            # pnpm workspace definition (apps/*, packages/*)
├── turbo.json                     # Turborepo task pipeline (build, test, lint, typecheck)
├── tsconfig.base.json             # Root TypeScript strict configuration
└── README.md                      # Quickstart and operator guide
```

### 3.2 Root Tooling & Scripts Configuration
- **Package Manager:** `pnpm` (version `12.x` via corepack).
- **Turborepo:** `turbo` (v2.x) pipeline for caching builds and coordinating inter-package dependencies.
- **Root `package.json` Scripts:**
  - `pnpm dev`: Concurrently start `apps/api`, `apps/worker`, and `apps/web` in development mode.
  - `pnpm build`: Run `turbo run build` across all packages in topological order.
  - `pnpm typecheck`: Run `turbo run typecheck` enforcing strict TypeScript validation (`tsc --noEmit`).
  - `pnpm lint`: Run Biome or ESLint across all apps and packages.
  - `pnpm test`: Run `turbo run test` executing Vitest suites.
  - `pnpm test:e2e`: Execute end-to-end integration and resilience test suites.
  - `pnpm db:generate`: Generate database migrations using Drizzle Kit.
  - `pnpm db:migrate`: Apply pending migrations to the configured database.
  - `pnpm db:seed`: Bootstrap default owner account and primary workspace.

---

## 4. Apps & Packages Layout Specification

### 4.1 Applications (`apps/`)

#### 1. `apps/api` (Fastify REST API & Ingress Service)
- **Role:** Central API gateway, webhook ingress receiver, execution trigger coordinator, authentication/RBAC authority, and Server-Sent Events (SSE) broadcaster.
- **Key Dependencies:** `fastify`, `@fastify/cors`, `@fastify/cookie`, `@fastify/swagger`, `@fastify/swagger-ui`, `zod`, `bullmq`, `ioredis`.
- **Key Endpoints:**
  - Auth: `POST /api/v1/auth/setup` (one-time bootstrap), `POST /api/v1/auth/login`, `POST /api/v1/auth/logout`, `GET /api/v1/me`.
  - Workspaces: `GET /api/v1/workspaces`, `POST /api/v1/workspaces`.
  - Workflows: `GET /api/v1/workflows`, `POST /api/v1/workflows`, `GET /api/v1/workflows/:id/draft`, `PATCH /api/v1/workflows/:id/draft`, `POST /api/v1/workflows/:id/publish`, `POST /api/v1/workflows/:id/rollback`.
  - Executions: `POST /api/v1/workflows/:id/execute` (manual trigger), `GET /api/v1/executions/:id`, `POST /api/v1/executions/:id/cancel`, `GET /api/v1/executions/:id/events` (SSE live stream).
  - Triggers & Ingress: `POST /api/v1/hooks/:endpointId` (webhook trigger ingress with signature validation and rate limiting).
  - Connectors & Credentials: `GET /api/v1/connectors`, `GET /api/v1/credentials`, `POST /api/v1/credentials` (encrypted storage).
  - Health & Metrics: `GET /health/live`, `GET /health/ready`, `GET /metrics`.

#### 2. `apps/worker` (BullMQ Execution Worker)
- **Role:** Independent execution daemon consuming workflow execution jobs from Redis/BullMQ, loading immutable workflow version snapshots, executing node graphs deterministically, dispatching connector tasks, handling step timeouts, and persisting state transitions into PostgreSQL.
- **Key Dependencies:** `bullmq`, `ioredis`, `@opennodes/workflow-engine`, `@opennodes/db`, `@opennodes/connectors-core`, `@opennodes/connectors-ai`, `@opennodes/observability`.
- **Reliability Guarantee:** Supports graceful shutdown (`SIGTERM`/`SIGINT`), worker crash recovery (jobs re-acquired or marked failed with transparent diagnostic reason), step-level timeout enforcement, and idempotency key deduplication.

#### 3. `apps/web` (React Flow Canvas & Unslop UI)
- **Role:** Visual workflow automation web application implementing the Unslop design principles (calm, editorial, high-contrast, disciplined typography).
- **Key Dependencies:** `react` 18/19, `react-dom`, `@xyflow/react` (React Flow), `@tanstack/react-query`, `lucide-react`, `tailwindcss`, `zod`, `i18next`.
- **Key Views:**
  - Canvas Editor: React Flow graph with pan/zoom, typed input/output ports, cycle rejection, minimap, undo/redo, draft indicator.
  - Node Configuration Drawer: Dynamic JSON Schema form renderer with live field validation, credential selectors, and expression helper.
  - Execution Run Inspector: Bottom/drawer inspector displaying node execution states (queued, running, succeeded, failed, skipped), duration/timings, error stack/cause, and sanitized input/output payloads (secrets redacted).
  - Dashboard & Workspaces: Overview, Workflow list, Credentials manager, Audit log viewer, Initial setup / Owner bootstrapping wizard.

---

### 4.2 Shared Packages (`packages/`)

| Package | Primary Responsibility | Critical Exports |
|---|---|---|
| `packages/workflow-schema` | Single source of truth for workflow definitions, node contracts, edge rules, and validation. | `WorkflowDefinitionSchema`, `NodeSchema`, `EdgeSchema`, `PortSchema`, `TriggerConfigSchema`, `ExecutionStateEnum`. |
| `packages/workflow-engine` | Pure, deterministic execution engine: topological sort, cycle detection, state machine, expression interpreter. | `WorkflowEngine`, `TopologicalSorter`, `CycleDetector`, `SafeExpressionEvaluator`, `ExecutionStateMachine`. |
| `packages/connector-sdk` | Base interfaces, authored manifest types, execution context, credential decoders, and rate limiters. | `BaseConnector`, `ConnectorManifest`, `ExecutionContext`, `ConnectorActionResult`, `SSRFGuard`. |
| `packages/connectors-core` | 10 foundational core connectors and trigger listeners. | `HttpRequestConnector`, `WebhookTrigger`, `CronTrigger`, `JsonTransformConnector`, `CsvConnector`, `RssConnector`, `SmtpConnector`, `PostgresConnector`, `TelegramConnector`, `FilesystemConnector`. |
| `packages/connectors-ai` | AI/LLM providers with schema-enforced structured outputs. | `OpenAiCompatibleConnector`, `OllamaConnector`, `StructuredOutputValidator`. |
| `packages/db` | Database schema, Drizzle ORM client, migration files, seeders, repository queries. | `db`, `schema`, `runMigrations()`, `UserRepository`, `WorkflowRepository`, `ExecutionRepository`. |
| `packages/auth` | Workspace isolation, session tokens, password hashing (Argon2id/scrypt), RBAC authorization guards. | `hashPassword`, `verifyPassword`, `createSession`, `authorizeWorkspaceRole(role, action)`. |
| `packages/observability` | Envelope encryption, secret masking/redaction, structured JSON logger, OpenTelemetry hooks. | `encryptSecret`, `decryptSecret`, `redactSecretsInPayload`, `createLogger`, `metricsCollector`. |
| `packages/ui` | Unslop design system tokens, Tailwind preset, base UI components (Button, Input, Card, Modal, Drawer, Badge). | `Button`, `Input`, `Drawer`, `Card`, `Badge`, `unslopTheme`. |
| `packages/shared` | Common error classes, DTOs, network ranges, validation helpers. | `AppError`, `NotFoundError`, `ForbiddenError`, `SSRFBlockedError`, `PRIVATE_IP_RANGES`. |

---

## 5. Database Architecture, ORM Evaluation & Schema Blueprint

### 5.1 ORM Evaluation: Drizzle ORM vs Prisma

| Evaluation Criteria | Prisma ORM | Drizzle ORM | Recommended Choice |
|---|---|---|---|
| **Binary Dependencies** | Requires native query engine binary (`libquery_engine`). Can complicate multi-platform Docker and ARM64/x86_64 builds. | Zero binary dependencies. Pure TypeScript/JavaScript client on top of `pg` / `postgres.js`. | **Drizzle** |
| **Worker Cold-Start & Memory** | Heavier memory footprint (~30-50MB per instance) due to engine process. | Lightweight (~5MB), zero overhead; critical for worker scalability. | **Drizzle** |
| **Testing Flexibility** | Requires live PostgreSQL or complex Prisma mock extensions. | Supports standard SQL dialect, works seamlessly with mock DB drivers or in-memory runners. | **Drizzle** |
| **Migration Control** | `prisma migrate` enforces declarative migrations with shadow database. | `drizzle-kit` generates clean, editable raw SQL migrations with explicit rollback capability. | **Drizzle** |
| **Type Safety** | Schema-first generation. | TypeScript-first definition (`drizzle-orm/pg-core`), compile-time checked. | **Drizzle** |

**Architectural Decision:** **Drizzle ORM** is the recommended choice for LocalFlow. It provides lightweight, fast, binary-free execution with complete SQL migration transparency and compile-time TypeScript type safety.

### 5.2 Complete Database Schema Blueprint (18 Tables)

```sql
-- 1. Users & Authentication
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(255),
    is_owner BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE sessions (
    id VARCHAR(128) PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Workspaces & RBAC
CREATE TABLE workspaces (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(255) UNIQUE NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE memberships (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role VARCHAR(32) NOT NULL CHECK (role IN ('owner', 'admin', 'editor', 'viewer')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(workspace_id, user_id)
);

-- 3. Credentials & Envelope Encryption
CREATE TABLE credentials (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    type VARCHAR(64) NOT NULL, -- e.g. 'http_basic', 'bearer_token', 'postgres', 'telegram', 'openai'
    encrypted_payload TEXT NOT NULL, -- AES-256-GCM ciphertext:iv:tag
    key_version INT NOT NULL DEFAULT 1,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. Workflows & Versioning
CREATE TABLE workflows (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    is_active BOOLEAN NOT NULL DEFAULT FALSE,
    published_version_id UUID,
    draft_nodes JSONB NOT NULL DEFAULT '[]'::jsonb,
    draft_edges JSONB NOT NULL DEFAULT '[]'::jsonb,
    draft_trigger_config JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE workflow_versions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workflow_id UUID NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
    version_number INT NOT NULL,
    schema_version VARCHAR(16) NOT NULL DEFAULT '1.0',
    nodes JSONB NOT NULL,
    edges JSONB NOT NULL,
    trigger_config JSONB NOT NULL,
    execution_policy JSONB NOT NULL DEFAULT '{}'::jsonb, -- timeout, retry policy, concurrency
    checksum VARCHAR(64) NOT NULL,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(workflow_id, version_number)
);

ALTER TABLE workflows ADD CONSTRAINT fk_published_version FOREIGN KEY (published_version_id) REFERENCES workflow_versions(id) ON DELETE SET NULL;

-- 5. Triggers & Webhook Ingress
CREATE TABLE webhook_endpoints (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    workflow_id UUID NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
    endpoint_token VARCHAR(64) UNIQUE NOT NULL,
    http_method VARCHAR(16) NOT NULL DEFAULT 'POST',
    secret_token VARCHAR(255),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 6. Executions & Step Timing
CREATE TABLE executions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    workflow_id UUID NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
    workflow_version_id UUID NOT NULL REFERENCES workflow_versions(id),
    trigger_type VARCHAR(32) NOT NULL, -- 'manual', 'cron', 'webhook', 'telegram'
    trigger_payload JSONB,
    status VARCHAR(32) NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled', 'waiting')),
    started_at TIMESTAMPTZ,
    finished_at TIMESTAMPTZ,
    duration_ms INT,
    error_message TEXT,
    error_node_id VARCHAR(64),
    retry_count INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE node_executions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    execution_id UUID NOT NULL REFERENCES executions(id) ON DELETE CASCADE,
    node_id VARCHAR(64) NOT NULL,
    node_type VARCHAR(64) NOT NULL,
    status VARCHAR(32) NOT NULL CHECK (status IN ('pending', 'running', 'succeeded', 'failed', 'skipped')),
    input_payload JSONB, -- Redacted of secrets
    output_payload JSONB, -- Redacted of secrets
    error_message TEXT,
    error_stack TEXT,
    started_at TIMESTAMPTZ,
    finished_at TIMESTAMPTZ,
    duration_ms INT,
    retry_count INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE execution_events (
    id BIGSERIAL PRIMARY KEY,
    execution_id UUID NOT NULL REFERENCES executions(id) ON DELETE CASCADE,
    event_type VARCHAR(64) NOT NULL, -- 'execution:started', 'node:started', 'node:finished', 'execution:succeeded', etc.
    node_id VARCHAR(64),
    payload JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 7. Audit & Settings
CREATE TABLE audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id),
    action VARCHAR(64) NOT NULL, -- 'workflow.published', 'credential.created', 'settings.updated'
    target_id UUID,
    metadata JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE system_settings (
    key VARCHAR(64) PRIMARY KEY,
    value JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

---

## 6. Queue Architecture & Distributed Execution Setup

### 6.1 BullMQ & Redis Integration
- **Queue Engine:** `bullmq` running on Redis (connection pool via `ioredis`).
- **Queue Channels:**
  - `workflow-executions`: Primary queue for initiating workflow runs.
  - `workflow-step-tasks`: Step execution queue for distributed / asynchronous node execution.
  - `workflow-delays`: Delay queue leveraging Redis delayed jobs for the `Delay` primitive.

### 6.2 Job Lifecycle & Payload Model
```typescript
interface WorkflowExecutionJobData {
  executionId: string;
  workspaceId: string;
  workflowId: string;
  versionId: string;
  triggerType: 'manual' | 'cron' | 'webhook' | 'telegram';
  triggerPayload: Record<string, unknown>;
  correlationId: string;
  attempt: number;
}
```

### 6.3 State Transitions & Durability
```text
[ Trigger Arrival ]
        │
        ▼
   ( queued ) ───( Worker picks up job )───► ( running )
        │                                        │
        ├─( User cancels run )──► [ cancelled ] ├─( Node fails & no retry )──► [ failed ]
        │                                        │
        │                                        ├─( All nodes pass )─────────► [ succeeded ]
        │                                        │
        └─( Delay / Wait primitive )────────────► ( waiting ) ──( Timer/Event )─► ( running )
```

- **At-Least-Once Delivery & Worker Restarts:**
  - Jobs are locked using Redis distributed locks during active processing.
  - If a worker crashes or is abruptly killed (`SIGKILL` during restart tests), BullMQ detects the stalled lock after the lock duration and reassigns the job to an active worker.
  - The worker checks PostgreSQL `executions` table upon pickup: if already `succeeded`, `failed`, or `cancelled`, the duplicate job is safely acknowledged and discarded without re-executing side effects.
- **Dockerless Test Mode (Crucial for Local CI):**
  - For local runs where Redis is not running, the test suite initializes an in-memory queue adapter (`ioredis-mock` + synchronized step executor) ensuring 100% of workflow engine tests execute cleanly.

---

## 7. Graph Orchestration & Workflow Engine Lifecycle

### 7.1 Graph Data Structures & Primitives
Workflows in LocalFlow are represented as directed graphs $G = (V, E)$:
- **Vertices ($V$):** Nodes with declared typed input ports, typed output ports, and node configuration.
- **Edges ($E$):** Connections mapping an output port of a source node to an input port of a target node.

### 7.2 Cycle Detection & Validation
- **Algorithm:** Depth-First Search (DFS) with three-color marking (`UNVISITED`, `VISITING`, `VISITED`) or Tarjan's Strongly Connected Components algorithm.
- **Rule:** Cycles are strictly rejected during graph creation, edge connection, and workflow publication, unless explicitly enclosed within a controlled `For Each` loop primitive.
- **Edge Type Matching:** Source port output type must be compatible with target port input type (e.g. `string` -> `string`, `json` -> `any`).

### 7.3 Graph Orchestration Primitives (Required for P0)
1. **Branch / IF:** Evaluates conditional boolean expressions against upstream output; activates either the `true` or `false` branch.
2. **Filter:** Evaluates condition array items; downstream nodes only execute if condition is met, otherwise terminates branch gracefully without error.
3. **Map / Transform:** Transforms input payloads using declarative key mappings or pure expression templates.
4. **Delay:** Pauses workflow execution for a configured duration ($1\text{s} \dots 86400\text{s}$) using BullMQ delayed jobs.
5. **For Each:** Iterates over an array of items, executing the inner sub-graph sequentially or with bounded concurrency.
6. **Merge:** Combines outputs from multiple parallel branches (supports `wait_all`, `first_completed`, or `append_results`).

### 7.4 Safe Expression Evaluation (No `eval()`)
- In strict adherence to PRD Section 3.1 (ED-04) and Section 6, arbitrary JavaScript `eval()` or `Function()` execution is **forbidden**.
- Expressions like `{{ $node["HTTP_1"].data.user.id }}` or `{{ $trigger.body.event }}` are parsed using an AST-based safe template evaluator with access strictly restricted to the workflow run context.

---

## 8. Connectors & Integration Framework

### 8.1 Authored Connector Manifest
Every connector must implement the standard `ConnectorManifest` contract:
```typescript
export interface ConnectorManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  icon: string;
  category: 'core' | 'ai' | 'data' | 'communication' | 'utility';
  authType?: 'none' | 'basic' | 'bearer' | 'apiKey' | 'oauth2';
  triggers?: ConnectorTriggerDefinition[];
  actions: ConnectorActionDefinition[];
}
```

### 8.2 Inventory of Required Foundational Connectors (12+)

| # | Connector Name | Type | Key Capabilities & Verification |
|---|---|---|---|
| 1 | **Manual Trigger** | Trigger | Instant execution trigger from UI or API with optional mock test payload. |
| 2 | **Cron Trigger** | Trigger | Cron expression scheduler (e.g. `*/5 * * * *`) with timezone support. |
| 3 | **Webhook Ingress** | Trigger | Dedicated incoming HTTP endpoint with signature checking and payload forwarding. |
| 4 | **Telegram Bot Trigger** | Trigger | Long-polling (`getUpdates`) and webhook mode for bot messages. |
| 5 | **HTTP Request** | Action | GET/POST/PUT/PATCH/DELETE, headers, query params, auth, retry with backoff, SSRF filter. |
| 6 | **JSON Transform** | Action | Declarative JSON path extraction, reshaping, array flattening, math/string utilities. |
| 7 | **CSV Processor** | Action | Parse CSV text into JSON array; convert JSON objects into formatted CSV. |
| 8 | **RSS / Atom Reader** | Action | Fetch RSS/Atom XML feeds, parse items, extract title, link, pubDate, description. |
| 9 | **Send Email (SMTP)** | Action | Connect to SMTP host, TLS/STARTTLS, send HTML/plain text email with attachments. |
| 10 | **PostgreSQL Client** | Action | Execute parameterized SQL queries against user-configured database connection. |
| 11 | **Telegram Bot Action** | Action | Send messages, markdown text, notifications to Telegram chats/channels via Bot API. |
| 12 | **OpenAI-Compatible LLM** | Action | Chat completions against OpenAI API or compatible endpoints (e.g. Groq, vLLM). |
| 13 | **Local Ollama** | Action | Chat / generate with local Ollama daemon (`http://host.docker.internal:11434`). |
| 14 | **Filesystem Access** | Action | Read/write files restricted strictly within mounted `/data/allowed` directories. |

---

## 9. Security, Isolation, Encryption & SSRF Defense

### 9.1 Envelope Encryption for Credentials
- **Algorithm:** AES-256-GCM.
- **Key Derivation:** Master encryption key supplied via `ENCRYPTION_MASTER_KEY` environment variable (32-byte hex string).
- **Payload Format:** `iv:ciphertext:tag` (stored in `credentials.encrypted_payload`).
- **Zero Plaintext Leakage:** Plaintext credentials are never returned over the API, never logged in execution event streams, never included in workflow exports, and never rendered in UI forms after creation.

### 9.2 SSRF Protection Engine
All outgoing HTTP requests (from `HttpRequestConnector`, `WebhookTrigger`, `RssConnector`, etc.) must pass through a strict network validator prior to DNS resolution and connection:
- **Blocked IPv4 Ranges:**
  - `0.0.0.0/8` (Current network)
  - `10.0.0.0/8` (Private RFC 1918)
  - `100.64.0.0/10` (Carrier-grade NAT)
  - `127.0.0.0/8` (Loopback addresses)
  - `169.254.0.0/16` (Link-local & AWS/GCP cloud metadata `169.254.169.254`)
  - `172.16.0.0/12` (Private RFC 1918)
  - `192.168.0.0/16` (Private RFC 1918)
- **Blocked IPv6 Ranges:**
  - `::1/128` (Loopback)
  - `fc00::/7` (Unique Local RFC 4193)
  - `fe80::/10` (Link-local unicast)
- **DNS Rebinding Defense:** The validator resolves hostnames using custom lookup, validates the resolved IP addresses against the blocklist, and binds the socket strictly to the verified IP.
- **Admin Bypass:** Internal host access is denied by default and can only be enabled if explicitly added to an `SSRF_ALLOWED_HOSTS` admin whitelist.

### 9.3 Role-Based Access Control (RBAC) Matrix
Four workspace roles are enforced across every API route:

| Action / Capability | Owner | Admin | Editor | Viewer |
|---|:---:|:---:|:---:|:---:|
| View Workflows & Canvas | ✅ | ✅ | ✅ | ✅ |
| View Execution History & Sanitized Logs | ✅ | ✅ | ✅ | ✅ |
| Edit Workflow Drafts & Test Nodes | ✅ | ✅ | ✅ | ❌ |
| Manage Workspace Credentials | ✅ | ✅ | ✅ | ❌ |
| Publish / Disable / Rollback Workflows | ✅ | ✅ | ❌ | ❌ |
| Invite / Manage Workspace Members | ✅ | ✅ | ❌ | ❌ |
| Delete Workspace / Transfer Ownership | ✅ | ❌ | ❌ | ❌ |

---

## 10. Docker Deployment, Compose & Infrastructure

### 10.1 Multi-Container Compose Architecture
The production deployment defined in `infra/compose.yaml` coordinates 5 services:

```yaml
services:
  postgres:
    image: postgres:16-alpine
    restart: unless-stopped
    volumes:
      - postgres_data:/var/lib/postgresql/data
    environment:
      POSTGRES_DB: localflow
      POSTGRES_USER: ${POSTGRES_USER:-localflow}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER:-localflow} -d localflow"]
      interval: 5s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    restart: unless-stopped
    volumes:
      - redis_data:/data
    command: redis-server --appendonly yes
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 5

  api:
    build:
      context: .
      dockerfile: infra/docker/Dockerfile.api
    restart: unless-stopped
    ports:
      - "${API_PORT:-4000}:4000"
    environment:
      DATABASE_URL: postgres://${POSTGRES_USER:-localflow}:${POSTGRES_PASSWORD}@postgres:5432/localflow
      REDIS_URL: redis://redis:6379
      ENCRYPTION_MASTER_KEY: ${ENCRYPTION_MASTER_KEY}
      SESSION_SECRET: ${SESSION_SECRET}
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    healthcheck:
      test: ["CMD-SHELL", "wget -qO- http://localhost:4000/health/live || exit 1"]
      interval: 10s
      timeout: 5s
      retries: 3

  worker:
    build:
      context: .
      dockerfile: infra/docker/Dockerfile.worker
    restart: unless-stopped
    environment:
      DATABASE_URL: postgres://${POSTGRES_USER:-localflow}:${POSTGRES_PASSWORD}@postgres:5432/localflow
      REDIS_URL: redis://redis:6379
      ENCRYPTION_MASTER_KEY: ${ENCRYPTION_MASTER_KEY}
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy

  web:
    build:
      context: .
      dockerfile: infra/docker/Dockerfile.web
    restart: unless-stopped
    ports:
      - "${WEB_PORT:-3000}:80"
    depends_on:
      api:
        condition: service_healthy

volumes:
  postgres_data:
  redis_data:
```

### 10.2 Environment Variable Specification (`.env.example`)
```bash
# ==============================================================================
# LocalFlow Environment Configuration
# ==============================================================================

# General
NODE_ENV=production
PORT=4000
WEB_PORT=3000
API_URL=http://localhost:4000
WEB_URL=http://localhost:3000

# Database (PostgreSQL)
POSTGRES_USER=localflow
POSTGRES_PASSWORD=replace_with_secure_postgres_password
POSTGRES_DB=localflow
DATABASE_URL=postgres://localflow:replace_with_secure_postgres_password@localhost:5432/localflow

# Queue & Cache (Redis)
REDIS_URL=redis://localhost:6379

# Security & Secrets
# 32-byte hex key for envelope AES-256-GCM encryption
ENCRYPTION_MASTER_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
# Cookie and session signing secret
SESSION_SECRET=replace_with_at_least_32_characters_session_secret

# SSRF Policy (comma-separated allowed internal hosts if needed)
SSRF_ALLOWED_HOSTS=

# Filesystem Connector Allowed Base Directory
ALLOWED_FS_ROOT=/data/allowed
```

---

## 11. Build, Lint, and Test Strategy (CI / Quality Gates)

### 11.1 Test Suite Organization (5 Tiers)
1. **Tier 1: Unit Tests (Fast, In-Memory)**
   - Schema validation (`packages/workflow-schema`).
   - Topological sorting and cycle detection (`packages/workflow-engine`).
   - Safe expression template evaluator (`packages/workflow-engine`).
   - Secret redaction and masking utility (`packages/observability`).
   - Encryption/decryption roundtrips (`packages/observability`).
2. **Tier 2: Connector Contract Tests**
   - Each connector tested against mock responses verifying schema conformity, input validation, and typed error responses.
3. **Tier 3: In-Memory Integration Tests**
   - Fastify route integration with mock sessions and mock DB repositories.
   - BullMQ queue handling with in-memory Redis mock (`ioredis-mock`).
4. **Tier 4: End-to-End Workflow Execution & Resilience**
   - Complete workflow execution: Trigger -> HTTP -> IF -> Transform -> Telegram.
   - Worker restart resilience test: Worker crash/kill simulation does not drop queued executions; state remains durable in database.
5. **Tier 5: Security & Adversarial Tests**
   - SSRF attack vectors: attempts to fetch `127.0.0.1`, `169.254.169.254`, `10.0.0.1`, `localhost` must throw `SSRFBlockedError`.
   - RBAC privilege escalation: Viewer attempting to publish or edit draft receives 403 Forbidden.
   - Credential leaks: Ensure raw API tokens are never present in execution logs, step outputs, or exported JSON.

---

## 12. Comprehensive Gap Analysis & Milestone Roadmap

### 12.1 Detailed Implementation Gap Matrix

| Component / Subsystem | Required Functionality | Current State | Gap Status | Required Implementation Work |
|---|---|:---:|:---:|---|
| **Git Repository** | Clean, isolated local git repository linked to origin | No local `.git` (picks up `/Users/dmitrysazonov`) | **CRITICAL GAP** | Initialize `git init` in `opennodes/`, set remote origin to `https://github.com/dmsznv-dot/opennodes.git`. |
| **Monorepo Structure** | pnpm workspaces + Turborepo + TypeScript | Empty root | **CRITICAL GAP** | Create root `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json`. |
| **Database & ORM** | PostgreSQL schema + Drizzle ORM + migrations | None | **CRITICAL GAP** | Implement `packages/db` with 18 tables, Drizzle client, and initial migration SQL. |
| **Queue & Worker** | BullMQ + Redis + job recovery | None | **CRITICAL GAP** | Implement `apps/worker` with queue listeners, worker restart recovery, and `ioredis-mock` for Dockerless test execution. |
| **Workflow Engine** | Deterministic DAG runner, cycle detection, state machine | None | **CRITICAL GAP** | Implement `packages/workflow-engine` with topological sort, cycle rejection, expression parser, and state transitions. |
| **Workflow Schemas** | Zod schemas for nodes, edges, versions, triggers | None | **CRITICAL GAP** | Implement `packages/workflow-schema` with complete type definitions. |
| **Connectors (12+)** | Core connectors & triggers | None | **CRITICAL GAP** | Implement `packages/connector-sdk`, `packages/connectors-core` (10 connectors) and `packages/connectors-ai` (2 connectors). |
| **Fastify API Server** | REST API, SSE stream, webhook ingress, auth/RBAC | None | **CRITICAL GAP** | Implement `apps/api` with routes, Swagger OpenAPI, and health checks. |
| **Web UI Application** | React Flow canvas, unslop design, inspector | None | **CRITICAL GAP** | Implement `apps/web` with Vite, React Flow, typed ports, configuration drawer, execution inspector. |
| **Security Controls** | AES-256-GCM encryption, secret redaction, SSRF filter | None | **CRITICAL GAP** | Implement `packages/observability` and `packages/auth` with SSRF guard and encryption. |
| **Docker & Compose** | Multi-stage Dockerfiles, `compose.yaml`, `.env.example` | None | **CRITICAL GAP** | Create Dockerfiles for api/worker/web, `compose.yaml` with health checks, and documented `.env.example`. |
| **Testing Suites** | Unit, contract, integration, resilience, and security tests | None | **CRITICAL GAP** | Set up Vitest test infrastructure across all packages with isolated mocks and CI script. |

---

### 12.2 Sequenced Delivery Path

1. **Phase 1: Foundation Setup (M0)**
   - Initialize git repository and set remote.
   - Establish root monorepo tooling: `pnpm-workspace.yaml`, `package.json`, `turbo.json`, `tsconfig.base.json`.
   - Scaffold `packages/shared`, `packages/workflow-schema`, `packages/observability`, and `packages/db`.
   - Set up Vitest testing harness and TypeScript strict typechecking.

2. **Phase 2: Engine Vertical Slice (M1)**
   - Implement `packages/workflow-engine` (topological sorter, cycle detector, safe expression evaluator, state machine).
   - Implement `packages/connector-sdk` and first 4 M1 connectors: Manual Trigger, HTTP Request, IF Branch, and Telegram Action.
   - Implement `apps/worker` BullMQ queue consumer with durable state persistence in PostgreSQL.
   - Implement `apps/api` with execution trigger endpoint and status inspector.
   - Write end-to-end integration test proving execution of Manual -> HTTP -> IF -> Telegram with worker crash recovery.

3. **Phase 3: Visual Canvas, UI & Credentials (M2)**
   - Implement `packages/ui` adopting Unslop design tokens and editorial aesthetics.
   - Implement `apps/web` with React Flow canvas, typed ports, cycle rejection, and draft/published version management.
   - Implement envelope-encrypted credentials system in `packages/observability` and `apps/api`.
   - Implement node configuration drawer and execution run inspector.

4. **Phase 4: Foundational Connectors & Triggers (M3)**
   - Implement remaining connectors: Cron trigger, Webhook trigger, Telegram polling trigger, JSON transform, CSV, RSS/Atom, SMTP Email, PostgreSQL SQL, OpenAI-compatible LLM, local Ollama, and Filesystem access.
   - Implement SSRF filter with loopback, private IP, and metadata blocking.

5. **Phase 5: Public Alpha Hardening, Security & Deployment (M4)**
   - Implement multi-stage Dockerfiles for `api`, `worker`, and `web`.
   - Create production `infra/compose.yaml` with service health checks.
   - Complete 5-tier automated test suite (unit, contract, integration, resilience, security).
   - Validate owner bootstrapping and single-command deployment.
