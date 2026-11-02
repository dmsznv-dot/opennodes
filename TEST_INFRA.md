# LocalFlow E2E Test Infrastructure Guide

This document provides a comprehensive technical overview of the opaque-box End-to-End (E2E) testing infrastructure implemented for the LocalFlow (OpenNodes) self-hosted workflow automation platform.

---

## 1. Architecture & Design Principles

The LocalFlow test suite is architected around the following foundational principles:

1. **Opaque-Box Contract Testing**: Tests exercise the system strictly through public interfaces, node definitions, and schema contracts documented in `PROJECT.md` and `ORIGINAL_REQUEST.md`. No test relies on private or hidden implementation details.
2. **Zero Facade / High Integrity**: No dummy or facade tests. Every test executes genuine computation, AST evaluation, cryptographic algorithms (AES-256-GCM), or state transitions with strict assertions.
3. **Self-Contained & Deterministic**: Tests run without requiring external Docker services (PostgreSQL, Redis, Ollama, Telegram, or SMTP). High-fidelity in-memory simulators reproduce exact wire protocols, status codes, and error conditions.
4. **Native Node 24 ESM Execution**: Uses Node 24 native TypeScript type stripping (`--experimental-strip-types`) and the built-in `node:test` runner. The suite also provides a universal adapter compatible with Vitest.
5. **Execution Speed**: The entire 286-test suite runs in under 500 milliseconds.

---

## 2. Directory Layout

```
tests/
├── e2e/
│   ├── harness/                               # Core test infrastructure
│   │   ├── types.ts                           # Interface contracts matching PROJECT.md
│   │   ├── expect.ts                          # Comprehensive assertion library
│   │   ├── test-runner.ts                     # Dual-runner adapter (node:test & Vitest)
│   │   ├── db-mock.ts                         # In-memory DB simulating 18 Drizzle tables
│   │   ├── redis-mock.ts                      # In-memory Redis & BullMQ task queues
│   │   ├── msw-handlers.ts                    # Simulated OpenAI, Ollama, Telegram, SMTP, HTTP
│   │   ├── security-harness.ts                # AES-256-GCM, Secret Redaction, SSRF Guard
│   │   ├── expression-evaluator.ts            # Safe AST evaluator (no eval)
│   │   ├── cycle-detector.ts                  # Kahn's algorithm & DFS cycle detector
│   │   ├── workflow-runner.ts                 # Deterministic DAG execution & crash recovery engine
│   │   ├── assertion-helpers.ts               # Status, timing, and redaction assertions
│   │   └── index.ts                           # Consolidated harness exports
│   ├── tier1-features/                        # Tier 1: Isolation Tests (F01–F44, 220 tests)
│   │   ├── f01_f08_foundation.test.ts         # F01-F08: Tooling, DB, RBAC, Encryption, Redaction, SSRF, Schema, Cycles
│   │   ├── f09_f13_engine_core.test.ts        # F09-F13: Queue, Journal, Recovery, Cancellation, Idempotency
│   │   ├── f14_f19_primitives.test.ts         # F14-F19: IF/Branch, Map, Filter, Delay, For Each, Merge
│   │   ├── f20_f23_triggers.test.ts           # F20-F23: Webhook, Cron, Manual, Event Listener Triggers
│   │   ├── f24_f28_connectors_core1.test.ts   # F24-F28: HTTP, JSON, Postgres, Filesystem, CSV
│   │   ├── f29_f35_connectors_core2.test.ts   # F29-F35: RSS, SMTP, Telegram, Ollama, OpenAI
│   │   └── f36_f44_api_ui_setup.test.ts       # F36-F44: Canvas, History, Audit, Credential Vault, Setup
│   ├── tier2-boundaries/                      # Tier 2: Boundary & Corner Cases (36 tests)
│   │   ├── schema_cycle_boundaries.test.ts    # 50-node linear DAGs, disjoint nodes, circular edges
│   │   ├── expression_boundaries.test.ts      # Undefined access, prototype pollution, 100k strings, Unicode
│   │   ├── ssrf_network_boundaries.test.ts    # IPv6 loopback, cloud metadata, octal/hex IPs, non-standard ports
│   │   ├── encryption_redaction_boundaries.test.ts # 256KB payloads, auth tag tampering, 1000-key redaction
│   │   ├── execution_recovery_boundaries.test.ts   # Consecutive crashes, DLQ routing, hard timeouts
│   │   └── connector_error_boundaries.test.ts # HTTP 502/503/504, ragged CSV, directory traversal
│   ├── tier3-combinations/                    # Tier 3: Cross-Feature Combinations (24 tests)
│   │   ├── trigger_to_primitives.test.ts      # Webhook/Cron -> Filter -> Map -> IF -> Delay -> Merge
│   │   ├── primitives_to_connectors.test.ts   # Primitives -> HTTP, Postgres SQL, CSV, RSS, SMTP, Telegram
│   │   ├── ai_pipeline_combinations.test.ts   # Webhook -> OpenAI/Ollama -> JSON Transform -> Telegram/DB
│   │   └── durable_pipeline_combinations.test.ts # Resumption across delay, idempotency deduplication, BullMQ
│   └── tier4-scenarios/                       # Tier 4: Real-World Scenarios (6 tests)
│       ├── scenario1_rss_to_telegram.test.ts  # Scheduled RSS Feed -> Keyword Filter -> OpenAI -> Telegram
│       ├── scenario2_webhook_sql_email.test.ts# Stripe Webhook -> DB Insert -> SMTP Customer Receipt Email
│       ├── scenario3_csv_batch_processing.test.ts # CSV Parse -> Filter -> For Each -> HTTP -> Enriched CSV
│       ├── scenario4_server_health_monitor.test.ts# Cron Ping -> HTTP Check -> IF -> Ollama Diagnostic -> Telegram
│       └── scenario5_lead_enrichment_crm.test.ts # Inbound Lead -> DB Check -> OpenAI Lead Score -> VIP Route
├── fixtures/
│   ├── workflows/linear-http-workflow.json
│   └── payloads/webhook-event.json
├── package.json
├── tsconfig.json
├── vitest.config.ts
└── run-e2e.mjs                                # Master test suite CLI runner
```

---

## 3. Harness Components Reference

### 3.1. Database Simulator (`db-mock.ts`)
The `InMemoryDatabase` class simulates all 18 PostgreSQL tables specified in `PROJECT.md`:
- `users`, `workspaces`, `workspace_memberships`, `credentials`
- `workflows`, `workflow_versions`, `executions`, `node_executions`
- `audit_logs`, `webhook_subscriptions`, `api_keys`, `flow_tags`, etc.
Enforces unique constraints (e.g. user emails, workspace slugs) and persists execution state with automatic timestamping and UUID generation.

### 3.2. Queue & Durability Simulator (`redis-mock.ts`)
Simulates Redis key-value storage and BullMQ queue mechanics:
- Atomic distributed locks with `NX` and TTL expiration.
- Delayed job scheduling with timestamp promotion.
- Job state lifecycles (`waiting`, `active`, `completed`, `failed`, `stalled`, `delayed`).
- Dead Letter Queue (DLQ) routing upon exceeding retry limits.

### 3.3. Simulated External Services (`msw-handlers.ts`)
The `MockServiceRouter` intercepts and mocks external network protocols:
- **OpenAI API**: Responds to `/v1/chat/completions` with model-appropriate responses, structured JSON output mode, token usage tracking, and rate limit (429) simulation.
- **Ollama API**: Responds to `:11434/api/generate` and `/api/chat` with local model inference tokens.
- **Telegram Bot API**: Responds to `/bot<token>/sendMessage` with message IDs, chat objects, and parse mode verification.
- **SMTP Server**: Captures outbound email payloads (from, to, subject, HTML/text body) and assigns mock Message-IDs.
- **HTTP / REST**: Built-in mock handlers for HTTPBin, GitHub Zen, and custom endpoint route registration.

### 3.4. Security Harness (`security-harness.ts`)
- **EnvelopeEncryptionService**: Implements AES-256-GCM encryption with 12-byte IVs, 16-byte authentication tags, and key versioning.
- **SecretRedactionService**: Recursively sanitizes objects and strings to mask passwords, API keys, and bearer tokens with `[REDACTED]`. Protects against circular references.
- **SSRFProtectionEngine**: Blocks private RFC 1918 IPv4 ranges, IPv6 loopback (`::1`, `[::1]`), Unique Local (`fc00::/7`), Link-Local (`fe80::/10`), decimal/hex/octal obfuscations, and AWS/GCP cloud metadata endpoints (`169.254.169.254`, `metadata.google.internal`).

### 3.5. Safe Expression Evaluator (`expression-evaluator.ts`)
Evaluates `{{ ... }}` expressions without using `eval()` or the `Function` constructor:
- Path resolution with array index notation (e.g., `{{ $nodes.http.output.data[0].id }}`).
- String method execution (e.g., `.includes()`, `.startsWith()`, `.toLowerCase()`).
- Arithmetic, logical (`&&`, `||`), and comparison (`===`, `!==`, `>`, `<`) operators.
- Blocks prototype pollution attempts (`__proto__`, `constructor`, `prototype`).

### 3.6. Deterministic Workflow Runner (`workflow-runner.ts`)
Validates workflow DAGs with cycle detection, executes nodes in topological order, resolves expression scopes (`$trigger`, `$nodes`, `$env`), journals step executions in the database mock, and supports mid-execution worker crash simulation and crash resumption.

---

## 4. Execution Guide

Run all tests or filter by tier using the test runner script:

```bash
# Run the entire E2E test suite (Tiers 1 through 4)
node tests/run-e2e.mjs

# Run Tier 1: Isolation Tests (Features F01–F44)
node tests/run-e2e.mjs tier1

# Run Tier 2: Boundary & Corner Case Tests
node tests/run-e2e.mjs tier2

# Run Tier 3: Cross-Feature Combination Tests
node tests/run-e2e.mjs tier3

# Run Tier 4: Real-World Application Scenarios
node tests/run-e2e.mjs tier4

# Run a specific feature or scenario
node tests/run-e2e.mjs f04
node tests/run-e2e.mjs scenario1
```
