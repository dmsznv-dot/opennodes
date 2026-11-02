# Dispatch: Milestone 1 Worker (Core Foundation & Security)

## Objective
Implement the complete codebase for Milestone 1 (Features F01 through F08) of LocalFlow:
1. Root monorepo tooling: `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json`, `.prettierrc`, `.gitignore`.
2. Packages:
   - `@localflow/shared`: ID generators, constants, domain error classes (`LocalFlowError`, `ValidationError`, `CycleError`, `SSRFError`).
   - `@localflow/ui`: Design tokens (Ink/Graphite ramp, Electric Cobalt accent, 4px grid, nested radii, port colors).
   - `@localflow/workflow-schema`: Zod schemas for `NodePort`, `WorkflowNode`, `WorkflowEdge`, `WorkflowDefinition`, `WorkflowVersion` with SHA-256 canonical checksums; Kahn's algorithm topological sorter and cycle detector; BFS reachability `wouldCreateCycle()`; graph validator.
   - `@localflow/db`: Drizzle ORM schema for all 18 PostgreSQL tables, bidirectional relations, PGlite (`@electric-sql/pglite`) in-memory mock adapter for Dockerless tests, migrations runner, schema sync.
   - `@localflow/auth`: AES-256-GCM envelope encryption with CSPRNG IV and key versioning, 4-tier RBAC policy engine with 18 permissions, one-time owner bootstrap lock, bcrypt/scrypt password hashers.
   - `@localflow/observability`: 4-layer recursive secret redaction engine with circular reference handling, Pino structured logger serializers.
   - `@localflow/connector-sdk`: Standardized connector types, `ConnectorContext`, `SafeHttpClient` with multi-tier SSRF protection (CIDR blocklist, obfuscated IP normalization, socket-level IP pinning, redirect guard).

## Inputs & Blueprints
- Master Project Architecture & Feature Inventory: `/Users/dmitrysazonov/.gemini/antigravity/scratch/opennodes/PROJECT.md`
- ORIGINAL_REQUEST.md: `/Users/dmitrysazonov/.gemini/antigravity/scratch/opennodes/.agents/teamwork/ORIGINAL_REQUEST.md`
- Explorer M1-1 Plan (Scaffolding & Schemas): `/Users/dmitrysazonov/.gemini/antigravity/scratch/opennodes/.agents/teamwork/explorer_m1_1/m1_1_plan.md`
- Explorer M1-2 Plan (Database & PGlite): `/Users/dmitrysazonov/.gemini/antigravity/scratch/opennodes/.agents/teamwork/explorer_m1_2/m1_2_plan.md`
- Explorer M1-3 Plan (Security, Encryption, SSRF): `/Users/dmitrysazonov/.gemini/antigravity/scratch/opennodes/.agents/teamwork/explorer_m1_3/m1_3_plan.md`

## File Ownership
You exclusively own:
- Root config files (`package.json`, `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json`, etc.)
- `packages/shared/*`
- `packages/ui/*`
- `packages/workflow-schema/*`
- `packages/db/*`
- `packages/auth/*`
- `packages/observability/*`
- `packages/connector-sdk/*`
Do NOT edit files in `tests/e2e/` (owned by E2E Testing Track).

## Mandatory Integrity Warning
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

## Verification Requirements
You MUST run:
1. `pnpm install`
2. `pnpm run build`
3. `pnpm run typecheck`
4. `pnpm run test` (all unit test suites in `packages/*` must pass with 100% success)
Document all commands and verification outputs in your handoff report.

## Deliverables
- Working implementation across all packages.
- Handoff report at `/Users/dmitrysazonov/.gemini/antigravity/scratch/opennodes/.agents/teamwork/worker_m1/handoff.md`.
- Send completion message to parent upon finishing.
## 2026-11-02T08:48:27Z
You are the Milestone 1 Worker for LocalFlow.
Your Working Directory: /Users/dmitrysazonov/.gemini/antigravity/scratch/opennodes/.agents/teamwork/worker_m1
Project Root: /Users/dmitrysazonov/.gemini/antigravity/scratch/opennodes
Original Request Path: /Users/dmitrysazonov/.gemini/antigravity/scratch/opennodes/.agents/teamwork/ORIGINAL_REQUEST.md
Your Dispatch file: /Users/dmitrysazonov/.gemini/antigravity/scratch/opennodes/.agents/teamwork/worker_m1/DISPATCH.md

Read ORIGINAL_REQUEST.md and DISPATCH.md first.
You are implementing Milestone 1 (Features F01 through F08):
- Root monorepo tooling (package.json, pnpm-workspace.yaml, turbo.json, tsconfig.base.json).
- @localflow/shared
- @localflow/ui
- @localflow/workflow-schema (Zod schemas, Kahn's cycle detector, BFS reachability wouldCreateCycle)
- @localflow/db (Drizzle ORM schema for 18 tables, PGlite in-memory mock adapter, relations, migrations)
- @localflow/auth (AES-256-GCM envelope encryption, 4-tier RBAC engine, one-time owner bootstrap, password hashing)
- @localflow/observability (recursive secret redaction engine, Pino serializers)
- @localflow/connector-sdk (SSRF defense engine with socket IP pinning)

Follow the detailed plans authored by the explorers:
- /Users/dmitrysazonov/.gemini/antigravity/scratch/opennodes/.agents/teamwork/explorer_m1_1/m1_1_plan.md
- /Users/dmitrysazonov/.gemini/antigravity/scratch/opennodes/.agents/teamwork/explorer_m1_2/m1_2_plan.md
- /Users/dmitrysazonov/.gemini/antigravity/scratch/opennodes/.agents/teamwork/explorer_m1_3/m1_3_plan.md

File Ownership:
You exclusively own: root configs, packages/shared, packages/ui, packages/workflow-schema, packages/db, packages/auth, packages/observability, packages/connector-sdk.
Do NOT edit tests/e2e/ (owned by E2E Testing Track).

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

Verification Requirements:
You MUST run:
1. pnpm install
2. pnpm run build
3. pnpm run typecheck
4. pnpm run test (all unit tests in packages/* must pass)
Record command outputs in your handoff report.

Write your handoff report to /Users/dmitrysazonov/.gemini/antigravity/scratch/opennodes/.agents/teamwork/worker_m1/handoff.md and notify parent when complete.
