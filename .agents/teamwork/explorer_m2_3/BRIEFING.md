# BRIEFING — 2026-11-02T10:14:45Z

## Mission
Investigate and design F11 (BullMQ Task Queue Integration), F13 (Worker Restart Crash Recovery), and `apps/worker` Standalone Worker Application for LocalFlow Milestone 2.

## 🔒 My Identity
- Archetype: explorer
- Roles: [investigation, synthesis]
- Working directory: /Users/dmitrysazonov/.gemini/antigravity/scratch/opennodes/.agents/teamwork/explorer_m2_3
- Original parent: ccb4ebb5-2245-446b-b9ef-513e8e111218
- Milestone: M2 (Execution Engine & Primitives)

## 🔒 Key Constraints
- Read-only investigation — do NOT implement
- Scope: F11 (BullMQ Task Queue Integration), F13 (Worker Restart Crash Recovery), `apps/worker` daemon architecture
- Output handoff report to `.agents/teamwork/explorer_m2_3/handoff.md`
- Maintain progress heartbeat in `progress.md`

## Current Parent
- Conversation ID: ccb4ebb5-2245-446b-b9ef-513e8e111218
- Updated: not yet

## Investigation State
- **Explored paths**:
  - `ORIGINAL_REQUEST.md`, `PROJECT.md`, `TEST_READY.md`
  - E2E test suites: `tests/e2e/tier1-features/f09_f13_engine_core.test.ts`, `tests/e2e/tier2-boundaries/execution_recovery_boundaries.test.ts`, `tests/e2e/tier3-combinations/durable_pipeline_combinations.test.ts`
  - Harness implementations: `tests/e2e/harness/redis-mock.ts`, `db-mock.ts`, `workflow-runner.ts`, `types.ts`
  - Existing packages: `@localflow/db` (`executions.ts`, `client.ts`), `@localflow/workflow-schema`, `@localflow/observability`, `@localflow/shared`
- **Key findings**:
  - `workflow-execution` and `workflow-delays` queues are the two core BullMQ queues.
  - Test suites (`f09_f13`, `tier2`, `tier3`) verify lock expiration (30s), stalled job detection, DLQ routing after max attempts, exponential backoff, and idempotent resumption.
  - Resumption loads cached `SUCCEEDED` outputs into memory and skips executing already completed side-effects.
  - Worker daemon in `apps/worker` requires graceful shutdown (`SIGINT`/`SIGTERM`), boot-time orphan execution scanning, and typed configuration via Zod.
- **Unexplored areas**: None within scope.

## Key Decisions Made
- Architecture separates queue layer into an abstract provider pattern (`IQueueProducer`, `IQueueConsumer`, `IWorkflowQueueManager`) supporting both live BullMQ/ioredis and an in-memory queue adapter matching `InMemoryQueue` for 100% test isolation without requiring external Redis.
- Crash recovery algorithm uses PostgreSQL `executions` table query for status `RUNNING`/`QUEUED` with expired heartbeats, reconstructing `nodeOutputs` from `node_executions` where `status = 'SUCCEEDED'`.
- Standalone worker daemon (`apps/worker`) coordinates boot-time crash recovery scan before launching queue consumers, handles `SIGTERM`/`SIGINT` with a configurable drain timeout, and cleanly disconnects database pools and Redis connections.

## Artifact Index
- handoff.md — Comprehensive handoff report for Queue, Daemon & Crash Recovery
- progress.md — Liveness heartbeat
- DISPATCH.md — Incoming messages log
