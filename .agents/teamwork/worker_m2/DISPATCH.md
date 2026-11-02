## 2026-11-02T10:17:38Z
You are Worker M2 (Milestone 2 Implementation Worker) for LocalFlow.
Working Directory: /Users/dmitrysazonov/.gemini/antigravity/scratch/opennodes/.agents/teamwork/worker_m2
Project Root: /Users/dmitrysazonov/.gemini/antigravity/scratch/opennodes

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

MANDATORY FIRST STEPS:
1. Read the verbatim user request at:
   /Users/dmitrysazonov/.gemini/antigravity/scratch/opennodes/.agents/teamwork/ORIGINAL_REQUEST.md
2. Read the master project architecture and contracts at:
   /Users/dmitrysazonov/.gemini/antigravity/scratch/opennodes/PROJECT.md
3. Read the three Explorer handoff reports which contain complete designs, interfaces, and specifications:
   - Explorer M2-1 (Expressions & Primitives): /Users/dmitrysazonov/.gemini/antigravity/scratch/opennodes/.agents/teamwork/explorer_m2_1/handoff.md
   - Explorer M2-2 (DAG Engine & State Persistence): /Users/dmitrysazonov/.gemini/antigravity/scratch/opennodes/.agents/teamwork/explorer_m2_2/handoff.md
   - Explorer M2-3 (BullMQ Queue, Daemon & Crash Recovery): /Users/dmitrysazonov/.gemini/antigravity/scratch/opennodes/.agents/teamwork/explorer_m2_3/handoff.md
4. Inspect existing E2E tests:
   - /Users/dmitrysazonov/.gemini/antigravity/scratch/opennodes/tests/e2e/tier1-features/f09_f13_engine_core.test.ts
   - /Users/dmitrysazonov/.gemini/antigravity/scratch/opennodes/tests/e2e/tier1-features/f14_f19_primitives.test.ts
   - /Users/dmitrysazonov/.gemini/antigravity/scratch/opennodes/tests/e2e/tier2-boundaries/execution_recovery_boundaries.test.ts
   - /Users/dmitrysazonov/.gemini/antigravity/scratch/opennodes/tests/e2e/tier2-boundaries/expression_boundaries.test.ts
   - /Users/dmitrysazonov/.gemini/antigravity/scratch/opennodes/tests/e2e/tier3-combinations/durable_pipeline_combinations.test.ts
   - /Users/dmitrysazonov/.gemini/antigravity/scratch/opennodes/tests/e2e/harness/in-memory-engine.ts

Your Exclusive Write Ownership:
- `packages/workflow-engine/**`
- `apps/worker/**`
- Monorepo package/workspace configuration files as strictly needed to link dependencies.

Your Deliverables:
1. Implement `packages/workflow-engine`:
   - `src/expressions/`: Safe AST / recursive-descent expression evaluator (zero eval/Function/vm). Multi-tier prototype pollution protection (`__proto__`, `prototype`, `constructor`). Support both typed expressions (`{{ $trigger.order.amount > 100 }}`) and template strings (`'Hello {{ $trigger.user.name }}'`). Scope resolution for `$trigger`/`trigger`, `$nodes`/`steps`, `$item`/`item`. Path traversal, comparisons, arithmetic, ternary, and whitelisted safe string/array methods. Export `ExpressionEvaluationError`.
   - `src/primitives/`: All 6 graph orchestration primitives:
     - `primitive.branchIf` / `primitive.if` (F14): evaluates condition, emits `{ conditionResult: boolean }`, returns active handle `'true'` or `'false'`.
     - `primitive.filter` (F15): filters items/array, emits `{ passed, discarded, count }`, active handles `'passed'`, `'discarded'`.
     - `primitive.map` (F16): transforms object/array according to mapping config.
     - `primitive.delay` (F17): delays execution; supports unit test immediate resolution or BullMQ rescheduling.
     - `primitive.forEach` (F18): iterative loop emitting `{ items, total }`; handles `'item'`, `'done'`.
     - `primitive.merge` (F19): aggregates multiple upstream branches into `{ merged }`, tolerating skipped incoming branches.
   - `src/engine/`: `WorkflowEngine` deterministic DAG execution runner. Node lifecycle (`QUEUED -> RUNNING -> SUCCEEDED | FAILED | SKIPPED | CANCELLED`), edge dependency resolution, cascading `SKIPPED` status for unselected branch outputs, step execution context, cancellation, error policies (`STOP_ON_FAILURE` vs `CONTINUE_ON_FAILURE`).
   - `src/persistence/`: `ExecutionJournal` interface and Drizzle implementation (`DrizzleExecutionJournal`) persisting to `executions` and `node_executions` tables with automatic secret redaction via `@localflow/observability`.
   - `src/queue/`: BullMQ task queue abstraction (`IWorkflowQueueManager`, `IQueueProducer`, `IQueueConsumer`) supporting live Redis and in-memory test simulation (`InMemoryQueueProvider`), job deduplication, exponential backoff retries, 30s lock duration with renewals, DLQ routing.
   - `src/recovery/`: Checkpoint-based crash recovery scanner. Resumes interrupted executions from last pending/uncompleted node without duplicating completed external side-effects (reuses cached output payloads). Enforces 300s execution timeout (`ERR_EXECUTION_TIMEOUT`).
   - Comprehensive unit test suites under `packages/workflow-engine/tests/`.

2. Implement `apps/worker`:
   - Standalone worker daemon package (`package.json`, `tsconfig.json`).
   - `src/config.ts`: Zod-validated environment config (`DATABASE_URL`, `REDIS_URL`, `WORKER_CONCURRENCY`, `STALLED_INTERVAL_MS`, `LOG_LEVEL`).
   - `src/daemon.ts` & `src/index.ts`: Worker daemon that runs orphan recovery scan at startup, starts queue consumer with `WorkflowEngine`, runs periodic recovery scan, and handles graceful shutdown on `SIGINT`/`SIGTERM` with 10s drain timeout.

3. Monorepo Verification:
   Execute and ensure 100% pass for all of the following commands:
   - `pnpm turbo run build --force`
   - `pnpm turbo run typecheck --force`
   - `pnpm turbo run test --force`
   - `node tests/run-e2e.mjs f09_f13`
   - `node tests/run-e2e.mjs f14_f19`
   - `node tests/run-e2e.mjs execution_recovery_boundaries`
   - `node tests/run-e2e.mjs expression_boundaries`
   - `node tests/run-e2e.mjs durable_pipeline_combinations`
   - `node tests/run-e2e.mjs` (Full 286-test E2E suite)

4. Write comprehensive handoff report to:
   `/Users/dmitrysazonov/.gemini/antigravity/scratch/opennodes/.agents/teamwork/worker_m2/handoff.md`
   Following the Handoff Protocol (Observation, Logic Chain, Caveats, Conclusion, Verification Method with command outputs).
5. Update `progress.md` with your status, and notify the orchestrator using `send_message`.
