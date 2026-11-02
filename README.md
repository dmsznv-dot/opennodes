<p align="center">
  <img src="./assets/logo.svg" alt="OpenNodes v1.0 Logo" width="520" />
</p>

<h1 align="center">OpenNodes</h1>

<p align="center">
  <strong>Self-hosted, deterministic visual workflow automation platform and DAG execution engine.</strong><br/>
  Built with crash-safe PostgreSQL journaling, AES-256-GCM envelope secret encryption, SSRF network defense, and an <strong>Unslop</strong>-engineered dark UI.
</p>

<p align="center">
  <a href="https://dmsznv-dot.github.io/opennodes/"><strong>🌐 Open the interactive UI demo on GitHub Pages →</strong></a><br/>
  <sub>The demo is a <strong>simulation</strong> running in your browser: it never calls real services and labels every result as an example. Real runs need your own Docker install.</sub>
</p>

---

## Key Capabilities (M1 Engine Slice + P0 Public Alpha MVP)

- **Visual DAG Editor & Real-Time Cycle Prevention**: Interactive canvas with typed ports (`trigger`, `json`, `string`, `number`, `boolean`, `binary`, `any`), Kahn's algorithm cycle detection (`ERR_CYCLIC_DEPENDENCY_DETECTED`), and a `480px` schema-driven Node Configuration Drawer.
- **Draft vs. Published Immutable Versioning**: Edit draft graphs freely without mutating active running workflows; publish immutable versions verified with permutation-invariant `SHA-256` checksums and one-click rollback.
- **4 Triggers + 6 Graph Primitives + 12 Connectors**:
  - **Triggers**: `Manual`, `Cron` (5-field + IANA timezone), `Incoming Webhook` (`HMAC-SHA256` + `X-Idempotency-Key` deduplication), `Telegram Polling` (`last_update_id + 1` offset persistence).
  - **Primitives**: `IF / Branch`, `Filter`, `Map`, `Durable Delay`, `ForEach`, `Merge`.
  - **Connectors**: `HTTP Request` (SSRF-guarded), `Outgoing Webhook`, `Cron`, `JSON Transform`, `CSV`, `RSS Reader`, `SMTP Email`, `PostgreSQL` (parameterized `$1, $2`), `Telegram Bot`, `Sandboxed Filesystem` (`ALLOWED_FS_ROOT`), `OpenAI Chat`, `Ollama Local LLM`.
- **Zero-Eval AST Expression Engine**: Safe `{{ $trigger.* }}` and `{{ $nodes.<id>.output.* }}` resolution via custom Lexer + Recursive-Descent Parser blocking `__proto__`, `constructor`, and `prototype`.
- **Enterprise Security & Observability**:
  - `AES-256-GCM` envelope encryption for workspace credentials with key rotation.
  - 4-role RBAC (`OWNER`, `ADMIN`, `EDITOR`, `VIEWER`) and one-time `/setup` instance bootstrap.
  - Real-time recursive `[REDACTED]` secret sanitization across logs, DB journals, and SSE streams.

---

## Public demo (GitHub Pages)

The demo in `docs/` follows a **simple-first** flow: *pick a task → connect a service → fill 2–5 clear fields → test → turn on*.

- **Home, Templates, Connections, History** — the graph editor is the second, advanced way in.
- **Readable steps**: actions instead of primitives ("Send a Telegram message"), status chips (*Needs setup / Ready / Error / Disabled*), data from earlier steps inserted as readable chips (`{Step 1: Message text}`) instead of raw `{{ $nodes… }}` expressions.
- **Honest simulation**: “Test” runs in the browser, says what *would* be sent, and fails with a clear reason when a step is not set up. Activation asks for confirmation and lists external actions.
- **RU / EN** switch available everywhere (including the first-run screen), light/dark/system theme, mobile layout with an overlay settings panel.
- **First-run tour** (4 steps, skip/resume/restart) built around a safe template with no external actions.
- **Developer mode** (profile menu) reveals node types/IDs, raw config JSON, graph checksum and manual connections with cycle validation.

Open it locally with any static server, e.g. `python3 -m http.server --directory docs`.

---

## Monorepo Architecture (13 Packages)

```text
opennodes/
├── assets/                 # Official OpenNodes SVG brand lockup & geometric icon mark
├── docs/                   # GitHub Pages UI demo — simulation only, RU/EN, no backend
├── apps/
│   ├── api/                # Control Plane REST API, SSE stream, Webhook ingress, RBAC & /setup
│   ├── worker/             # BullMQ Distributed Worker Daemon & Crash-Safe Resumption Engine
│   └── web/                # React Flow Visual Workflow Editor, 480px Config Drawer & Run Inspector
├── packages/
│   ├── shared/             # Error hierarchy, SSRFGuard (IPv4/IPv6/hex/decimal CIDR blocklist), SafeHttpClient
│   ├── ui/                 # Unslop Design System tokens (Ink/Graphite ramp, Electric Cobalt <2%, 4px grid)
│   ├── workflow-schema/    # Zod graph schemas, Kahn's cycle detector, SHA-256 permutation-invariant checksum
│   ├── db/                 # Drizzle ORM schema (18 PostgreSQL tables), SQL migrations & PGlite test harness
│   ├── auth/               # AES-256-GCM envelope encryption, key rotation, 4-role RBAC & /setup bootstrap
│   ├── observability/      # Structured Pino logger & recursive real-time [REDACTED] secret sanitizer
│   ├── connector-sdk/      # Typed ConnectorDefinition, ConnectorAction & ConnectorTrigger contracts
│   ├── workflow-engine/    # Zero-eval AST Expression Evaluator, 6 Graph Primitives, Topological Scheduler
│   ├── connectors-core/    # 4 Triggers (Manual, Cron, Webhook, Telegram) & 10 Core Connectors
│   └── connectors-ai/      # OpenAI Chat & Ollama Local LLM Connectors
├── infra/                  # Multi-stage Node 22 Alpine Dockerfiles (api, worker, web)
├── tests/                  # 286 E2E tests across Tier 1 (Features), Tier 2 (Boundaries), Tier 3 & Tier 4
└── docker-compose.yml      # 5-service production stack (postgres, redis, api, worker, web) with healthchecks
```

---

## Quick Start

### 1. Build, Typecheck & Run All Tests (Unit + 286 E2E)

```bash
pnpm install
pnpm build
pnpm typecheck
pnpm test
node tests/run-e2e.mjs
```

### 2. Self-Hosted Docker Compose Deployment

```bash
cp .env.example .env
docker compose up -d --build
```
