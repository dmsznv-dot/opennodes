# Milestone 1 Fix Plan: @localflow/workflow-schema

## 1. Problem Statement & Scope

As identified by Challenger 1 (`challenger_m1_1/handoff.md`), there are three critical defects in `@localflow/workflow-schema`:

1. **`computeWorkflowChecksum` permutation invariance**:
   - `canonicalize` recursively sorts object keys, but leaves arrays in their input order.
   - When nodes or edges arrays are permuted (e.g. React Flow canvas reordering, JSON reordering), `computeWorkflowChecksum` yields different SHA-256 hashes for topologically and semantically identical workflows.
   - Requirement: Permuted node and edge orderings must yield the exact same SHA-256 checksum.

2. **`detectCycles` phantom cycle bug on duplicate node IDs**:
   - In `detectCycles`, Kahn's algorithm compares `topologicalOrder.length === nodes.length`.
   - When a graph contains duplicate node IDs (e.g. `[{ id: 'A' }, { id: 'A' }]`) and no edges, `inDegree` has 1 entry, `topologicalOrder.length` reaches 1, but `nodes.length` is 2.
   - Kahn's algorithm erroneously concludes that a cycle exists (`hasCycle: true`), reporting an empty cycle list (`cycleNodes: []`, `cyclePath: []`).
   - In `validateWorkflowGraph`, this causes a false positive `ERR_CYCLIC_DEPENDENCY_DETECTED` error on duplicate node IDs.
   - Requirement: Compare `topologicalOrder.length === inDegree.size` (the unique node count processed by Kahn's algorithm).

3. **`validateWorkflowGraph` null-coalescing on `n.type`**:
   - `validateWorkflowGraph` inspects `n.type.startsWith('trigger.') || n.type.startsWith('trigger_')` without checking whether `n.type` is defined.
   - If an invalid/malformed node object lacks a `type` property (or `type` is undefined/null), it throws an uncaught `TypeError: Cannot read properties of undefined (reading 'startsWith')` instead of returning structured validation errors.
   - Requirement: Use null-coalescing/optional chaining: `n.type?.startsWith(...)`.

---

## 2. Investigation & Technical Analysis

### Issue 1: `computeWorkflowChecksum` in `src/utils/checksum.ts`
- Currently:
  ```typescript
  function canonicalize(obj: unknown): unknown {
    if (obj === null || typeof obj !== 'object') {
      return obj;
    }

    if (Array.isArray(obj)) {
      return obj.map(canonicalize);
    }
    // ...
  ```
- If `obj` is an object containing `nodes` or `edges` arrays (or if the input array itself contains items with an `id` or objects):
  - When serializing a workflow snapshot, `nodes` is an array of nodes (each having `id: string`), and `edges` is an array of edges (each having `id: string`).
  - More generally, what should be sorted?
  - Let's check how `computeWorkflowChecksum` is called across the codebase!
  - Let's search across the workspace for `computeWorkflowChecksum`.

### Issue 2: `detectCycles` in `src/validation/cycle-detector.ts`
- Line 18: `const nodeIds = new Set(nodes.map((n) => n.id));`
- Line 23:
  ```typescript
  for (const node of nodes) {
    inDegree.set(node.id, 0);
    adjacency.set(node.id, []);
  }
  ```
- If duplicate nodes are passed, `inDegree.size === nodeIds.size`.
- In Kahn's algorithm:
  ```typescript
  if (topologicalOrder.length === nodes.length) {
  ```
  Since `queue` only contains unique node IDs from `inDegree.entries()`, `topologicalOrder` can have at most `inDegree.size` elements!
  Comparing `topologicalOrder.length === nodes.length` is an invariant bug whenever `nodes` has duplicates.
  Changing this to `topologicalOrder.length === inDegree.size` guarantees that topological sort succeeded if all unique nodes were placed in topological order.

### Issue 3: `validateWorkflowGraph` in `src/validation/graph-validator.ts`
- Line 87-89:
  ```typescript
  const triggerNodes = nodes.filter(
    (n) => n.type.startsWith('trigger.') || n.type.startsWith('trigger_')
  );
  ```
  If `n` or `n.type` is undefined or not a string, calling `.startsWith` throws.
  By changing to:
  ```typescript
  const triggerNodes = nodes.filter(
    (n) => typeof n?.type === 'string' && (n.type.startsWith('trigger.') || n.type.startsWith('trigger_'))
  );
  ```
  or `typeof n.type === 'string' && (n.type.startsWith('trigger.') || n.type.startsWith('trigger_'))` or `Boolean(n.type?.startsWith('trigger.') || n.type?.startsWith('trigger_'))`.

---

## 3. Detailed Steps & Deliverables

1. Search the workspace to see where and how `computeWorkflowChecksum` is used and what types of objects are passed to it.
2. Formulate the exact, robust implementation of `canonicalize` / `computeWorkflowChecksum` to ensure permutation invariance for nodes and edges (and arrays of identifiable objects / sorted arrays).
3. Formulate the exact fix for `detectCycles` in `cycle-detector.ts`.
4. Formulate the exact fix for `validateWorkflowGraph` in `graph-validator.ts`.
5. Formulate new Vitest tests in `checksum.test.ts`, `cycle-detector.test.ts`, and `graph-validator.test.ts`.
6. Document verification commands and output in `handoff.md`.
