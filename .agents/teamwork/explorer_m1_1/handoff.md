# Handoff Report: Milestone 1 Explorer 1 (Monorepo Scaffolding & Workflow Schemas)

**Date:** 2026-11-02T08:46:00Z  
**Author:** Milestone 1 Explorer 1  
**Working Directory:** `/Users/dmitrysazonov/.gemini/antigravity/scratch/opennodes/.agents/teamwork/explorer_m1_1`  
**Target Recipient:** Milestone 1 Worker / Milestone 1 Sub-Orchestrator  

---

## 1. Observation

1. **System & Environment State**:
   - Tool `run_command` (`node -v && pnpm -v && npm -v`) returned:
     ```text
     v24.21.0
     12.16.1
     12.2.0
     ```
   - Tool `list_dir` on `/Users/dmitrysazonov/.gemini/antigravity/scratch/opennodes` showed only `.agents` directory and `PROJECT.md`. The project workspace root is completely uninitialized.

2. **Interface Contracts & Requirements**:
   - `PROJECT.md` lines 106–143 specified the schema contracts:
     - `NodePort` with `type: 'trigger' | 'json' | 'string' | 'number' | 'boolean' | 'binary' | 'any'` and `direction: 'input' | 'output'`.
     - `WorkflowNode` with `id`, `type`, `data: { label, config, credentialId? }`, `inputs`, `outputs`.
     - `WorkflowEdge` with `id`, `source`, `sourceHandle`, `target`, `targetHandle`.
     - `WorkflowDefinition` with `id`, `workspaceId`, `name`, `nodes`, `edges`.
   - `PROJECT.md` lines 201–237 outlined the monorepo layout:
     - Root: `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json`.
     - Packages: `workflow-schema`, `shared`, `ui`, `db`, `auth`, `observability`, `connector-sdk`, `connectors-core`, `connectors-ai`, `workflow-engine`.
     - Apps: `api`, `worker`, `web`.
   - `survey_spec.md` lines 301–314 specified graph validation rules:
     - Kahn's algorithm or Tarjan's SCC for topological sorting and cycle prevention.
     - Error code `ERR_CYCLIC_DEPENDENCY_DETECTED` on cycle.
     - Typed port compatibility validation.
     - Single root trigger constraint: exactly one trigger node (`trigger.manual`, `trigger.cron`, `trigger.webhook`, `trigger.telegram_polling`).
   - `ORIGINAL_REQUEST.md` line 55 specified:
     - "Monorepo linting and TypeScript strict typechecks complete without errors."
   - `ORIGINAL_REQUEST.md` lines 21–23 & 39 specified adherence to **Unslop** UI principles (calm neutral Graphite/Ink palette, Cobalt accent <2%, disciplined spacing, zero slop/gradients).

3. **Peer Explorer Division of Responsibilities**:
   - Explorer 1 (self): F01 (Monorepo tooling, skeletons), F07 (Workflow schema), F08 (Cycle prevention, Kahn's algorithm, Vitest suite).
   - Explorer 2: F02 (Drizzle PostgreSQL schema for 18 tables, in-memory DB mock adapter, migrations).
   - Explorer 3: F03-F06 (Envelope encryption, RBAC, secret redaction, SSRF defense engine).

---

## 2. Logic Chain

1. **Monorepo Architecture (Observation 1, 2)**:
   - Because the project root contains no initial build files, we must construct the root configuration (`package.json`, `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json`, `.prettierrc`, `.gitignore`) first.
   - To support Turborepo 2.4 and pnpm 12 workspaces, the packages must be declared under `packages/*` and `apps/*`.
   - To prevent compiler errors in cross-workspace references, packages must export ES Modules with TypeScript declarations (`dist/index.js`, `dist/index.d.ts`) and use project references in `tsconfig.json`.

2. **Package Separation & Scoping (Observation 2)**:
   - `@localflow/shared` provides root domain error classes (`LocalFlowError`, `ValidationError`, `CycleError`, `SSRFError`), ID generators, and fundamental constants (`PORT_TYPES`).
   - `@localflow/ui` defines Unslop design tokens (`ink`, `accent.cobalt`, `status`, `port`, `spacing`, `radii`) without UI bloat.
   - `@localflow/workflow-schema` houses the canonical Zod schemas, inferred TypeScript types, graph validation engines, and checksum utility.

3. **Schema Design & Invariance (Observation 2)**:
   - In accordance with ADR-005 (Snapshot Immutability), executions run against published snapshots stored in PostgreSQL `workflow_versions`.
   - Therefore, `WorkflowGraphSchema` and `WorkflowVersionSchema` require a deterministic SHA-256 `checksum`. A recursive key-sorting canonical JSON serializer ensures that two structurally identical definitions always produce identical SHA-256 digests.

4. **Cycle Detection & Real-time Canvas Validation (Observation 2)**:
   - Kahn's algorithm computes in-degrees and enqueues nodes with `inDegree === 0`. If `topologicalOrder.length < nodes.length`, a cycle exists.
   - For real-time canvas edge dragging in React Flow (`onConnect`), running full Kahn's algorithm on every frame is unnecessarily heavy. A targeted BFS reachability check `wouldCreateCycle(edges, { source, target })` determines in $O(V + E)$ if `target` can reach `source`, immediately preventing users from connecting cyclic back-edges.
   - When a cycle is detected during full graph validation, a DFS cycle-path extractor reconstructs the exact directed loop path (e.g. `["nodeA", "nodeB", "nodeA"]`) for clear error reporting.

5. **Graph Validation Rules (Observation 2)**:
   - `validateWorkflowGraph()` enforces:
     1. Uniqueness of node and edge IDs (`ERR_DUPLICATE_NODE_ID`, `ERR_DUPLICATE_EDGE_ID`).
     2. Dangling edge references (`ERR_SOURCE_NODE_NOT_FOUND`, `ERR_TARGET_NODE_NOT_FOUND`, `ERR_SOURCE_HANDLE_NOT_FOUND`, `ERR_TARGET_HANDLE_NOT_FOUND`).
     3. Port direction correctness (`ERR_PORT_DIRECTION_INVALID`).
     4. Port type compatibility via `arePortsCompatible()` (`ERR_PORT_INCOMPATIBLE`).
     5. Single root trigger constraint (`ERR_MISSING_TRIGGER`, `ERR_MULTIPLE_TRIGGERS`).
     6. Directed cycle absence (`ERR_CYCLIC_DEPENDENCY_DETECTED`).

---

## 3. Caveats

1. **Loop Primitives (`For Each`)**:
   - In LocalFlow, the `For Each` primitive (`primitive.forEach`) provides `item` (loop body) and `done` (subsequent flow) output handles. In LocalFlow DAG semantics, iterations are processed internally or via bounded sub-flows. If an edge connects from a downstream node back to an upstream node without encapsulation, it constitutes a directed cycle and will be flagged by Kahn's algorithm.
2. **Dynamic Connector Types**:
   - Node types are validated as strings (e.g. `trigger.manual`, `core.httpRequest`, `ai.openai`) rather than a hard-coded closed enum to allow dynamic community connectors and extensible plugins without breaking schema validation.
3. **Draft Workflows with Loose Validation**:
   - On the web canvas draft mode, workflows may be temporarily incomplete (e.g., 0 triggers, disconnected nodes). `validateWorkflowGraph()` accepts `options.requireSingleTrigger = false` for loose draft validation, while publication requires strict validation (`requireSingleTrigger = true`).

---

## 4. Conclusion

The implementation plan in `m1_1_plan.md` provides an exhaustive, unambiguous blueprint for the Milestone 1 Worker. The monorepo setup uses standard modern tooling (pnpm, Turborepo 2.4, strict TypeScript), strict Zod schemas with TypeScript inference, $O(V+E)$ Kahn's algorithm for batch cycle detection and topological sorting, and BFS reachability for real-time React Flow connection checks.

---

## 5. Verification Method

### Concrete Verification Commands
The worker and sentinel can independently verify the implementation by running:

```bash
cd /Users/dmitrysazonov/.gemini/antigravity/scratch/opennodes

# 1. Install dependencies
pnpm install

# 2. Compile all packages
pnpm turbo run build

# 3. Strict TypeScript type check
pnpm turbo run typecheck

# 4. Run Vitest unit tests in workflow-schema
pnpm turbo run test

# 5. Targeted test execution
pnpm --filter @localflow/workflow-schema test cycle
pnpm --filter @localflow/workflow-schema test graph
pnpm --filter @localflow/workflow-schema test checksum
pnpm --filter @localflow/workflow-schema test connection
```

### Invalidation Conditions
- Any TypeScript compilation or typecheck error (`tsc --noEmit` fails).
- Failure of Kahn's algorithm to detect a known cycle (e.g., `A -> B -> A`).
- Failure of `wouldCreateCycle` to reject a back-edge.
- Inconsistent SHA-256 checksum generated for equivalent objects with perturbed key insertion orders.
- Missing or malformed package exports in `@localflow/shared`, `@localflow/ui`, or `@localflow/workflow-schema`.
