## 2026-11-02T10:09:06Z
[Message] timestamp=2026-11-02T10:09:06Z sender=ccb4ebb5-2245-446b-b9ef-513e8e111218 priority=MESSAGE_PRIORITY_HIGH content=You are Explorer M2-3 (Queue, Daemon & Recovery Explorer) for LocalFlow Milestone 2 (Execution Engine & Primitives).
Working Directory: /Users/dmitrysazonov/.gemini/antigravity/scratch/opennodes/.agents/teamwork/explorer_m2_3
Project Root: /Users/dmitrysazonov/.gemini/antigravity/scratch/opennodes

MANDATORY FIRST STEP:
Read the verbatim user request at:
/Users/dmitrysazonov/.gemini/antigravity/scratch/opennodes/.agents/teamwork/ORIGINAL_REQUEST.md
Also read the project architecture, features, and contracts at:
/Users/dmitrysazonov/.gemini/antigravity/scratch/opennodes/PROJECT.md
Also inspect existing tests and harness at:
/Users/dmitrysazonov/.gemini/antigravity/scratch/opennodes/tests/e2e/tier1-features/f09_f13_engine_core.test.ts
/Users/dmitrysazonov/.gemini/antigravity/scratch/opennodes/tests/e2e/harness/in-memory-queue.ts
and existing packages at:
/Users/dmitrysazonov/.gemini/antigravity/scratch/opennodes/packages/workflow-schema
/Users/dmitrysazonov/.gemini/antigravity/scratch/opennodes/packages/db

Your Investigation Scope:
1. Feature F11: BullMQ Task Queue Integration
   - Location: `packages/workflow-engine/src/queue/`
   - Queue setup using BullMQ / Redis connection abstraction (supporting `ioredis` for production and in-memory mock like `ioredis-mock` for self-contained testing).
   - Queue job payloads: workflow execution requests, step execution jobs.
   - Worker concurrency controls, job priority, backoff retries with exponential delay, and dead-letter queue (DLQ) or failed status handling.
2. Feature F13: Worker Restart Crash Recovery
   - Checkpoint-based resumption: when a worker starts up or recovers from a crash, scan for stalled / orphaned executions in `executions` where status is `RUNNING` or `QUEUED` and heartbeat has expired.
   - Idempotency & step checkpointing: avoid duplicating external side-effects by resuming from the last uncompleted or pending node.
3. `apps/worker`: Standalone Worker Application
   - Daemon entry point (`apps/worker/src/index.ts`).
   - Graceful shutdown handling (`SIGINT`, `SIGTERM`), waiting for active tasks to flush or checkpoint.
   - Environment variable configuration (`REDIS_URL`, `DATABASE_URL`, concurrency limits, log levels).

Output Requirements:
- Write a comprehensive, self-contained handoff report to:
  `/Users/dmitrysazonov/.gemini/antigravity/scratch/opennodes/.agents/teamwork/explorer_m2_3/handoff.md`
- Include:
  1. Complete type signatures and interfaces for queue producers, consumers, and worker options.
  2. Crash recovery algorithm and checkpoint resumption strategy.
  3. Architecture and file layout for `apps/worker` and `packages/workflow-engine/src/queue/`.
  4. Analysis of what existing tests (`f09_f13_engine_core.test.ts`) expect for queues and crash recovery.
  5. Unit and integration test plan using in-memory Redis / BullMQ simulation.
- Update `progress.md` with your status.
- Once finished, use `send_message` to notify the orchestrator.
