# Milestone 2 Explorer Report: Feature F09 (Safe Expression Evaluator) and Features F14–F19 (6 Graph Orchestration Primitives)

**Author:** Explorer M2-1 (Expression Evaluator & Primitives Explorer)  
**Date:** 2026-11-02  
**Target Package:** `packages/workflow-engine` (`src/expressions/` and `src/primitives/`)

---

## 1. Observation

### 1.1 Specification and Dispatch Directives
From `ORIGINAL_REQUEST.md` (lines 15–17, 43):
> "Implement an independent, deterministic workflow execution engine with durable state persistence in PostgreSQL and a Redis/BullMQ task queue... alongside graph orchestration primitives (Branch/IF, Filter, Map/Transform, Delay, For Each, Merge)"
> "Graph execution properly handles branching (IF), mapping, filtering, loops, and merging."

From `PROJECT.md` (lines 52, 57–62):
> "F09 | Safe Expression Evaluator | AST-based template evaluator (`{{ ... }}`) without `eval()` | M2"
> "F14 | Graph Primitive: Branch / IF | Conditional branching based on boolean expression evaluation | M2"
> "F15 | Graph Primitive: Filter | Discards items not matching criteria from downstream execution | M2"
> "F16 | Graph Primitive: Map / Transform | Object and array transformation using expression mapping | M2"
> "F17 | Graph Primitive: Delay / Wait | Asynchronous execution pausing via BullMQ delayed jobs | M2"
> "F18 | Graph Primitive: For Each | Iterative loop primitive with item and done output handles | M2"
> "F19 | Graph Primitive: Merge | Aggregates outputs from multiple incoming execution branches | M2"

From Dispatch Instructions:
> "Security constraints: Absolutely NO `eval()`, NO `Function()` constructor, NO `vm` module."
> "Defenses: Prototype pollution defense (block access to `__proto__`, `prototype`, `constructor`)."
> "Functionality: Key path traversal (`a.b.c`, `items[0].id`), basic math/comparison support, null/undefined safety."

### 1.2 Existing E2E Test Suite Expectations
Direct inspection of `tests/e2e/tier1-features/f09_f13_engine_core.test.ts` (lines 13–71) reveals exact expectations for F09:
- **F09-1 (Path resolutions & string interpolation):**
  - `'User: {{ $trigger.user.name }} (Role: {{ $trigger.user.role }})'` -> returns `'User: Alice (Role: admin)'` (string).
  - `'{{ $nodes.http_fetch.output.data.rate }}'` -> returns `1.15` (preserving numeric type).
- **F09-2 (Boolean conditions & comparisons without eval()):**
  - `'{{ $trigger.order.amount > 100 }}'` -> `true`.
  - `'{{ $trigger.user.role === "admin" }}'` -> `true`.
  - `'{{ $trigger.user.role === "guest" }}'` -> `false`.
- **F09-3 (Ternary expressions & logical operators):**
  - `'{{ $trigger.order.amount >= 200 ? "VIP" : "Standard" }}'` -> `'VIP'`.
  - `'{{ $trigger.user.role === "admin" && $trigger.order.amount > 50 }}'` -> `true`.
- **F09-4 (Array indices & nested bracket access):**
  - `'{{ $trigger.order.items[0] }}'` -> `'laptop'`.
  - `'{{ $trigger.order.items[1] }}'` -> `'mouse'`.
- **F09-5 (Security blocks code injection & prototype access):**
  - `{{ process.exit(1) }}` -> throws `ExpressionEvaluationError`.
  - `{{ __proto__.polluted = true }}` -> throws `ExpressionEvaluationError`.
  - `{{ constructor.prototype }}` -> throws `ExpressionEvaluationError`.
  - `{{ require("fs") }}` -> throws `ExpressionEvaluationError`.

Direct inspection of `tests/e2e/tier2-boundaries/expression_boundaries.test.ts` (lines 10–86):
- **B-EXP-1 (Deep undefined access):**
  - `{{ $trigger.existing.level1.deep.property }}` -> returns `undefined` safely without throwing `TypeError`.
  - `{{ $trigger.nonExistentRoot.level1 }}` -> returns `undefined`.
- **B-EXP-2 (Syntax variations of prototype pollution):**
  - `{{ __proto__.polluted = 1 }}` -> throws `ExpressionEvaluationError`.
  - `{{ constructor.prototype.polluted = 1 }}` -> throws `ExpressionEvaluationError`.
  - `{{ $trigger.__proto__ }}` -> throws `ExpressionEvaluationError`.
  - `{{ $trigger.constructor }}` -> throws `ExpressionEvaluationError`.
- **B-EXP-3 (Large strings):**
  - Interpolates 50,000-character string segments (`Prefix-{{ $trigger.segment }}-...`) yielding 100,000+ chars efficiently.
- **B-EXP-4 (Unicode & Emojis):**
  - Cyrillic (`'Привет, мир!'`), Japanese (`'こんにちは世界'`), Arabic (`'مرحبا بالعالم'`), and Emojis (`'🚀⚡️🛡️'`) preserved cleanly.
- **B-EXP-5 (Multi-condition logic):**
  - `{{ $trigger.score >= 80 && $trigger.status === "active" }}` -> `true`.
  - `{{ $trigger.attempts > 3 || $trigger.verified === false }}` -> `false`.
- **B-EXP-6 (Negative & Decimal numbers):**
  - `{{ $trigger.temperature < $trigger.threshold }}` with `-15.5` and `0` -> `true`.
  - `{{ $trigger.temperature }}` -> `-15.5` (number).

Direct inspection of `tests/e2e/tier1-features/f14_f19_primitives.test.ts` (lines 11–812):
- **Feature F14 (Branch / IF):**
  - Type in tests: `primitive.if` (spec also references `primitive.branchIf`). Both must be supported.
  - Ports: routes execution via output handle `'true'` when condition is truthy, or `'false'` when falsy.
  - Node output: `{ conditionResult: boolean }`.
  - Truthiness: `'valid-user-id'` -> truthy; `0`, `null`, `""` -> falsy. Dynamic expression `{{ $nodes.step_num.output.count > 10 }}` evaluated.
  - Unselected branch is marked `SKIPPED` in workflow execution.
- **Feature F15 (Filter):**
  - Type: `primitive.filter`.
  - Config: `items: [...]`, `predicate: '{{ $item.active }}'` or `'{{ $item >= 50 }}'` or `'{{ $item.startsWith("a") }}'`.
  - Output payload: `{ passed: unknown[], discarded: unknown[], count: number }` (where `count === passed.length`).
  - Output ports: `'passed'` (always active), `'discarded'` (active when discarded items exist).
  - Empty items: `{ passed: [], discarded: [], count: 0 }`.
- **Feature F16 (Map / Transform):**
  - Type: `primitive.map`.
  - Config: `transform: { ... }` or directly keys on `config`.
  - Output payload: transformed object with evaluated expressions, preserving booleans, numbers, nested objects, and arrays.
  - Missing field: `{{ $trigger.nonExistentField }}` resolves to `undefined`.
- **Feature F17 (Delay / Wait):**
  - Type: `primitive.delay`.
  - Config: `delayMs: number`.
  - Output payload: `{ delayedMs: number, resumedAt: string }`.
  - In unit tests/immediate mode: executes timer or resolves immediately if `0`. In worker/BullMQ: pauses and re-enqueues delayed job.
- **Feature F18 (For Each):**
  - Type: `primitive.forEach`.
  - Config: `items: unknown[]`.
  - Output payload: `{ items: Array<{ item: unknown; index: number; processed: boolean }>, total: number }`.
  - Output handles: `'done'`, `'item'`, `'main'`. Preserves item ordering.
- **Feature F19 (Merge):**
  - Type: `primitive.merge`.
  - Execution: synchronizes converging branches. Collects outputs from completed incoming edges: `{ merged: unknown[], count: number }`.
  - Skipped branch tolerance: if an incoming branch was `SKIPPED` (e.g. from an unselected IF branch), merge still succeeds with the completed branch (`count: 1`).
  - Supports 1, 2, 3+ converging branches.

### 1.3 Scope Aliases in Codebase
In `PROJECT.md` line 108–142 and dispatch instructions:
- Expressions use both `$trigger.user.name` and `steps.node_1.output.foo` / `steps.trigger.data.bar`.
- In `workflow-runner.ts` lines 148–158:
  ```typescript
  const buildScope = () => ({
    $trigger: triggerPayload,
    $nodes: nodesObj,
    $env: { WORKSPACE_ID: workflow.workspaceId, APP_ENV: 'test' }
  });
  ```
- Therefore, the scope resolution must seamlessly alias:
  - `$trigger` ↔ `trigger`
  - `$nodes` ↔ `steps` ↔ `nodes`
  - `$env` ↔ `env`
  - `$item` ↔ `item` (in loop/filter contexts)
  - `$index` ↔ `index`

---

## 2. Logic Chain

1. **Safety Constraint & Engine Decoupling:**
   Because dynamic evaluation (`eval()`, `new Function()`, `vm`) is strictly forbidden, expression evaluation must be performed by a deterministic AST lexer + recursive-descent / Pratt parser + tree evaluator.
2. **Dual-Mode Delimiter Handling:**
   Expressions wrapped entirely in `^{{\s*(.+?)\s*}}$` represent typed expressions where the returned value must preserve native JS types (`number`, `boolean`, `object`, `array`). In contrast, mixed strings (`Prefix-{{ val }}-Suffix`) represent text templates where each `{{ expr }}` is interpolated to a string (or empty string for `null`/`undefined`).
3. **Defense-in-Depth against Prototype Pollution:**
   Attack vectors such as `__proto__`, `constructor`, and `prototype` must be defended at three distinct barriers:
   - *Token/Lexer barrier:* Reject forbidden identifiers statically during token scanning.
   - *AST/Parser barrier:* Reject member access tokens matching forbidden names.
   - *Evaluator/Runtime barrier:* When accessing properties on objects, verify that the property does not originate from `Object.prototype`, and restrict method invocations to a strict whitelist of safe primitive methods (e.g., `String.prototype.startsWith`).
4. **Resilient Keypath Traversal:**
   `a.b.c.d` and `a[0].b` must never throw `TypeError: Cannot read properties of undefined`. When encountering `null` or `undefined` along an access path, evaluation must short-circuit and safely yield `undefined`.
5. **Primitive Modularity and Port Routing:**
   Each of the 6 primitives must be an isolated, functional unit conforming to a standard `PrimitiveDefinition` interface. Each primitive must return not only its computed `output` payload, but also an array of `activeHandles` (e.g., `['true']` vs `['false']` for `BranchIf`, `['passed', 'discarded']` for `Filter`, `['done', 'item']` for `ForEach`). This allows the DAG engine (F10) to determine which downstream branches remain active and which branches must be marked `SKIPPED`.
6. **Convergence and Partial Skip Semantics for Merge:**
   `primitive.merge` must examine incoming edges and collect outputs strictly from completed predecessor nodes. If an upstream branch was skipped by an IF condition, `merge` must not fail or hang; it aggregates only the successful predecessor outputs.

---

## 3. Caveats

1. **Delay in BullMQ vs In-Memory Engine:**
   In local unit tests and in-memory execution, `primitive.delay` should execute using an async timer (`setTimeout`) or immediate resolution for testing. In the distributed BullMQ worker (`apps/worker`), delays exceeding worker lock thresholds should transition the execution to `WAITING` and schedule a delayed queue job. The primitive execution interface should accept an optional delay strategy/handler to support both environments transparently.
2. **Loop Iteration Graph Representation:**
   `primitive.forEach` in the current E2E harness acts as a batch iteration primitive that produces `{ items: [...], total: N }` while activating handles `'done'` and `'item'`. Full cycle loop-back in the visual canvas is prevented by cycle detection (F08); iterations in LocalFlow DAGs are modeled as batch/map-style fan-out or sequential iterator nodes without cyclic back-edges.
3. **Primitive Type Naming:**
   The PRD and dispatch specify `primitive.branchIf`, while the existing E2E test suite specifies `primitive.if`. To ensure complete backward and forward compatibility, `primitive.branchIf` must register both `'primitive.branchIf'` and `'primitive.if'` as valid type identifiers.

---

## 4. Conclusion & Technical Specifications

### 4.1 Type Signatures and Interfaces

#### Expression Evaluator Types (`packages/workflow-engine/src/expressions/types.ts`)
```typescript
import { LocalFlowError } from '@localflow/shared';

export interface EvaluationScope {
  $trigger?: unknown;
  trigger?: unknown;
  $nodes?: Record<string, { input?: unknown; output?: unknown }>;
  steps?: Record<string, { input?: unknown; output?: unknown }>;
  nodes?: Record<string, { input?: unknown; output?: unknown }>;
  $env?: Record<string, string>;
  env?: Record<string, string>;
  $item?: unknown;
  item?: unknown;
  $index?: number;
  index?: number;
  [key: string]: unknown;
}

export class ExpressionEvaluationError extends LocalFlowError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'ERR_EXPRESSION_EVALUATION', 400, details);
    this.name = 'ExpressionEvaluationError';
  }
}

export type ASTNodeType =
  | 'Literal'
  | 'Identifier'
  | 'MemberExpression'
  | 'CallExpression'
  | 'UnaryExpression'
  | 'BinaryExpression'
  | 'LogicalExpression'
  | 'ConditionalExpression'
  | 'ArrayExpression';

export interface ASTBaseNode {
  type: ASTNodeType;
}

export interface LiteralNode extends ASTBaseNode {
  type: 'Literal';
  value: string | number | boolean | null | undefined;
  raw: string;
}

export interface IdentifierNode extends ASTBaseNode {
  type: 'Identifier';
  name: string;
}

export interface MemberExpressionNode extends ASTBaseNode {
  type: 'MemberExpression';
  object: ASTNode;
  property: ASTNode;
  computed: boolean; // true for a[b], false for a.b
  optional: boolean; // true for a?.b
}

export interface CallExpressionNode extends ASTBaseNode {
  type: 'CallExpression';
  callee: MemberExpressionNode | IdentifierNode;
  arguments: ASTNode[];
}

export interface UnaryExpressionNode extends ASTBaseNode {
  type: 'UnaryExpression';
  operator: '!' | '-' | '+';
  argument: ASTNode;
}

export interface BinaryExpressionNode extends ASTBaseNode {
  type: 'BinaryExpression';
  operator: '+' | '-' | '*' | '/' | '%' | '===' | '!==' | '==' | '!=' | '<' | '<=' | '>' | '>=';
  left: ASTNode;
  right: ASTNode;
}

export interface LogicalExpressionNode extends ASTBaseNode {
  type: 'LogicalExpression';
  operator: '&&' | '||' | '??';
  left: ASTNode;
  right: ASTNode;
}

export interface ConditionalExpressionNode extends ASTBaseNode {
  type: 'ConditionalExpression';
  test: ASTNode;
  consequent: ASTNode;
  alternate: ASTNode;
}

export interface ArrayExpressionNode extends ASTBaseNode {
  type: 'ArrayExpression';
  elements: ASTNode[];
}

export type ASTNode =
  | LiteralNode
  | IdentifierNode
  | MemberExpressionNode
  | CallExpressionNode
  | UnaryExpressionNode
  | BinaryExpressionNode
  | LogicalExpressionNode
  | ConditionalExpressionNode
  | ArrayExpressionNode;

export interface IExpressionEvaluator {
  evaluate(expression: string, scope: EvaluationScope): unknown;
  evaluateObject<T>(target: T, scope: EvaluationScope): T;
  parse(expressionString: string): ASTNode;
}
```

#### Primitives Types (`packages/workflow-engine/src/primitives/types.ts`)
```typescript
import { NodePort, WorkflowEdge } from '@localflow/workflow-schema';

export interface PrimitiveContext {
  executionId: string;
  nodeId: string;
  workspaceId: string;
  nodeOutputs: ReadonlyMap<string, unknown>;
  incomingEdges: WorkflowEdge[];
  evaluateExpression: (expr: string, localScope?: Record<string, unknown>) => unknown;
  logger?: {
    debug(message: string, meta?: Record<string, unknown>): void;
    info(message: string, meta?: Record<string, unknown>): void;
    warn(message: string, meta?: Record<string, unknown>): void;
    error(message: string, meta?: Record<string, unknown>): void;
  };
}

export interface PrimitiveExecutionResult {
  output: unknown;
  activeHandles: string[];
  metadata?: Record<string, unknown>;
}

export interface PrimitiveDefinition<TConfig = Record<string, unknown>> {
  type: string;
  aliases?: string[];
  displayName: string;
  description: string;
  inputPorts: NodePort[];
  outputPorts: NodePort[];
  execute(config: TConfig, context: PrimitiveContext): Promise<PrimitiveExecutionResult> | PrimitiveExecutionResult;
}
```

---

### 4.2 Concrete Implementation Specifications for All 6 Primitives

#### 1. `primitive.branchIf` (Feature F14, Aliases: `primitive.if`)
- **Ports Definition:**
  - Inputs: `[{ id: 'main', name: 'Input', type: 'any', direction: 'input' }]`
  - Outputs:
    - `[{ id: 'true', name: 'True', type: 'any', direction: 'output' }, { id: 'false', name: 'False', type: 'any', direction: 'output' }]`
- **Config Schema:**
  ```typescript
  export interface BranchIfConfig {
    condition: unknown; // boolean, string template, number, or truthy/falsy value
  }
  ```
- **Algorithm:**
  ```typescript
  export function executeBranchIf(config: BranchIfConfig, context: PrimitiveContext): PrimitiveExecutionResult {
    let rawCondition = config.condition;
    if (typeof rawCondition === 'string') {
      rawCondition = context.evaluateExpression(rawCondition);
    }
    const isTruthy = Boolean(rawCondition);
    return {
      output: { conditionResult: isTruthy },
      activeHandles: isTruthy ? ['true'] : ['false']
    };
  }
  ```
- **Edge Cases Handled:**
  - Non-empty strings (`"valid-user-id"`) and non-zero numbers evaluate to `true`.
  - Empty strings (`""`), `0`, `null`, `undefined` evaluate to `false`.
  - Missing condition defaults to `false`.

#### 2. `primitive.filter` (Feature F15)
- **Ports Definition:**
  - Inputs: `[{ id: 'main', name: 'Input', type: 'json', direction: 'input' }]`
  - Outputs:
    - `[{ id: 'passed', name: 'Passed', type: 'json', direction: 'output' }, { id: 'discarded', name: 'Discarded', type: 'json', direction: 'output' }]`
- **Config Schema:**
  ```typescript
  export interface FilterConfig {
    items: unknown[] | unknown;
    predicate?: string | boolean;
  }
  ```
- **Algorithm:**
  ```typescript
  export function executeFilter(config: FilterConfig, context: PrimitiveContext): PrimitiveExecutionResult {
    const rawItems = config.items;
    const items = Array.isArray(rawItems)
      ? rawItems
      : (rawItems !== undefined && rawItems !== null ? [rawItems] : []);

    const passed: unknown[] = [];
    const discarded: unknown[] = [];

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      let pass = false;
      if (config.predicate === undefined) {
        pass = Boolean(item);
      } else if (typeof config.predicate === 'boolean') {
        pass = config.predicate;
      } else if (typeof config.predicate === 'string') {
        const evalRes = context.evaluateExpression(config.predicate, { $item: item, item, $index: i, index: i });
        pass = Boolean(evalRes);
      } else {
        pass = Boolean(config.predicate);
      }

      if (pass) {
        passed.push(item);
      } else {
        discarded.push(item);
      }
    }

    const activeHandles = ['passed'];
    if (discarded.length > 0) {
      activeHandles.push('discarded');
    }

    return {
      output: { passed, discarded, count: passed.length },
      activeHandles
    };
  }
  ```
- **Edge Cases Handled:**
  - Empty array input yields `{ passed: [], discarded: [], count: 0 }` without error.
  - All items passing yields `discarded: []` and count equal to item length.
  - All items failing yields `passed: []`, `count: 0`, pipeline continues safely.
  - Single item (non-array) is safely coerced to single-element array.

#### 3. `primitive.map` (Feature F16)
- **Ports Definition:**
  - Inputs: `[{ id: 'main', name: 'Input', type: 'any', direction: 'input' }]`
  - Outputs: `[{ id: 'main', name: 'Output', type: 'any', direction: 'output' }]`
- **Config Schema:**
  ```typescript
  export interface MapConfig {
    transform?: unknown;
    [key: string]: unknown;
  }
  ```
- **Algorithm:**
  ```typescript
  export function executeMap(config: MapConfig, context: PrimitiveContext): PrimitiveExecutionResult {
    // If transform key is defined, that is the payload target; otherwise the evaluated config is the target.
    const output = config.transform !== undefined ? config.transform : config;
    return {
      output,
      activeHandles: ['main']
    };
  }
  ```
- **Edge Cases Handled:**
  - Missing properties in expression interpolations resolve to `undefined` (in raw objects) or empty string (in templates).
  - Deep structures, arrays, numbers, and booleans are preserved without unintentional stringification.
  - Mathematical and logical expressions within transform properties evaluate to calculated values.

#### 4. `primitive.delay` (Feature F17)
- **Ports Definition:**
  - Inputs: `[{ id: 'main', name: 'Input', type: 'any', direction: 'input' }]`
  - Outputs: `[{ id: 'main', name: 'Output', type: 'any', direction: 'output' }]`
- **Config Schema:**
  ```typescript
  export interface DelayConfig {
    delayMs?: number;
    delaySeconds?: number;
  }
  ```
- **Algorithm:**
  ```typescript
  export async function executeDelay(
    config: DelayConfig,
    context: PrimitiveContext,
    options?: { sleepFn?: (ms: number) => Promise<void> }
  ): Promise<PrimitiveExecutionResult> {
    let ms = 0;
    if (typeof config.delayMs === 'number') {
      ms = config.delayMs;
    } else if (typeof config.delaySeconds === 'number') {
      ms = config.delaySeconds * 1000;
    }

    if (ms < 0) ms = 0;

    if (ms > 0) {
      const sleep = options?.sleepFn ?? ((d: number) => new Promise(res => setTimeout(res, d)));
      await sleep(ms);
    }

    return {
      output: { delayedMs: ms, resumedAt: new Date().toISOString() },
      activeHandles: ['main']
    };
  }
  ```
- **Edge Cases Handled:**
  - Zero or negative delay resolves immediately (0 ms).
  - Timestamp ISO string is generated upon completion.
  - Clean cancellation support if aborted during wait.

#### 5. `primitive.forEach` (Feature F18)
- **Ports Definition:**
  - Inputs: `[{ id: 'main', name: 'Input', type: 'json', direction: 'input' }]`
  - Outputs:
    - `[{ id: 'item', name: 'Item', type: 'any', direction: 'output' }, { id: 'done', name: 'Done', type: 'json', direction: 'output' }, { id: 'main', name: 'Main', type: 'json', direction: 'output' }]`
- **Config Schema:**
  ```typescript
  export interface ForEachConfig {
    items: unknown[];
  }
  ```
- **Algorithm:**
  ```typescript
  export function executeForEach(config: ForEachConfig, context: PrimitiveContext): PrimitiveExecutionResult {
    const rawItems = config.items;
    const items = Array.isArray(rawItems) ? rawItems : [];

    const processedItems = items.map((item, index) => ({
      item,
      index,
      processed: true
    }));

    return {
      output: { items: processedItems, total: items.length },
      activeHandles: ['main', 'done', 'item']
    };
  }
  ```
- **Edge Cases Handled:**
  - Empty array returns `{ items: [], total: 0 }`.
  - Preserves exact element ordering with index `0 ... N-1`.
  - Supports downstream steps connecting to either `'done'` or `'main'` handles.

#### 6. `primitive.merge` (Feature F19)
- **Ports Definition:**
  - Inputs: `[{ id: 'main', name: 'Input', type: 'any', direction: 'input' }]`
  - Outputs: `[{ id: 'main', name: 'Output', type: 'json', direction: 'output' }]`
- **Config Schema:**
  ```typescript
  export interface MergeConfig {
    mode?: 'array' | 'object' | 'first';
  }
  ```
- **Algorithm:**
  ```typescript
  export function executeMerge(config: MergeConfig, context: PrimitiveContext): PrimitiveExecutionResult {
    const incomingEdges = context.incomingEdges;
    const incomingOutputs: unknown[] = [];

    for (const edge of incomingEdges) {
      if (context.nodeOutputs.has(edge.source)) {
        incomingOutputs.push(context.nodeOutputs.get(edge.source));
      }
    }

    return {
      output: { merged: incomingOutputs, count: incomingOutputs.length },
      activeHandles: ['main']
    };
  }
  ```
- **Edge Cases Handled:**
  - Handles single incoming branch as well as 2, 3+ converging branches.
  - Automatically ignores incoming edges from branches that were `SKIPPED` (e.g. from an IF branch).
  - Downstream steps receive synchronized `{ merged: [...], count: N }`.

---

### 4.3 Prototype Pollution Defenses & Security Guarantees

1. **Forbidden Identifier Token Blocklist:**
   ```typescript
   export const FORBIDDEN_IDENTIFIERS = new Set([
     '__proto__',
     'constructor',
     'prototype',
     '__defineGetter__',
     '__defineSetter__',
     '__lookupGetter__',
     '__lookupSetter__',
     'process',
     'global',
     'globalThis',
     'window',
     'require',
     'import',
     'Function',
     'eval',
     'Object',
     'Reflect'
   ]);
   ```
2. **Lexer Level Enforcement:**
   When tokenizing any expression, if an identifier or string property token matches any item in `FORBIDDEN_IDENTIFIERS`, the tokenizer immediately aborts with:
   `throw new ExpressionEvaluationError(`Access to forbidden identifier "${token}" is blocked`);`
3. **Runtime Property Access Guard:**
   Before reading `obj[prop]`:
   - If `typeof prop !== 'string' && typeof prop !== 'number'`, reject.
   - If `FORBIDDEN_IDENTIFIERS.has(String(prop))`, throw `ExpressionEvaluationError`.
   - Prevent climbing into `Object.prototype` methods (e.g. `obj.toString.constructor`).
4. **Whitelisted Safe Primitive Methods:**
   Only explicitly enumerated read-only methods on primitive types are executable:
   - **String:** `startsWith`, `endsWith`, `includes`, `indexOf`, `lastIndexOf`, `toLowerCase`, `toUpperCase`, `trim`, `trimStart`, `trimEnd`, `slice`, `substring`, `replace`, `replaceAll`, `split`, `charAt`, `concat`, `padStart`, `padEnd`, `repeat`.
   - **Array:** `includes`, `indexOf`, `lastIndexOf`, `slice`, `concat`, `join`, `reverse`, `flat`.
   - **Number:** `toFixed`, `toPrecision`, `toString`.
   Any method invocation outside this whitelist or on non-primitive objects is rejected.
5. **No Sandbox Escape:**
   By completely avoiding `eval`, `new Function`, and `node:vm`, escape attacks (such as `this.constructor.constructor('return process')()`) are impossible because AST evaluation is performed strictly by interpreter dispatch in user-space TypeScript.

---

### 4.4 File Layout in `packages/workflow-engine`

```
packages/workflow-engine/
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── src/
│   ├── index.ts
│   ├── expressions/
│   │   ├── types.ts          # AST nodes, scope interfaces, error classes
│   │   ├── errors.ts         # ExpressionEvaluationError class
│   │   ├── lexer.ts          # Zero-dependency lexical scanner
│   │   ├── parser.ts         # Recursive descent AST parser
│   │   ├── builtins.ts       # Whitelisted primitive prototype methods
│   │   ├── evaluator.ts      # AST interpreter & template string interpolator
│   │   └── index.ts          # Public expression evaluator exports
│   └── primitives/
│       ├── types.ts          # PrimitiveDefinition, PrimitiveContext, PrimitiveExecutionResult
│       ├── registry.ts       # PrimitiveRegistry with alias resolution
│       ├── branch-if.ts      # primitive.branchIf (alias: primitive.if)
│       ├── filter.ts         # primitive.filter
│       ├── map.ts            # primitive.map
│       ├── delay.ts          # primitive.delay
│       ├── for-each.ts       # primitive.forEach
│       ├── merge.ts          # primitive.merge
│       └── index.ts          # Public primitives registry and definitions export
└── tests/
    ├── expressions/
    │   ├── lexer.test.ts
    │   ├── parser.test.ts
    │   ├── evaluator.test.ts
    │   ├── security.test.ts
    │   └── boundaries.test.ts
    └── primitives/
        ├── branch-if.test.ts
        ├── filter.test.ts
        ├── map.test.ts
        ├── delay.test.ts
        ├── for-each.test.ts
        ├── merge.test.ts
        └── registry.test.ts
```

---

### 4.5 Unit Test Plan

#### Expression Evaluator Unit Tests (`tests/expressions/`)
1. **`lexer.test.ts` & `parser.test.ts`:**
   - Parse numbers: integers, decimals, negative numbers (`-15.5`, `0`, `100`).
   - Parse strings: single quotes, double quotes, escape sequences (`\n`, `\"`, `\'`).
   - Parse binary operators: arithmetic (`+`, `-`, `*`, `/`, `%`), comparisons (`===`, `!==`, `>`, `<`, `>=`, `<=`), logical (`&&`, `||`, `??`).
   - Parse unary operators: `!`, `-`, `+`.
   - Parse ternary operator: `a ? b : c`.
   - Parse member access: dot notation `a.b.c`, bracket notation `a[0]`, optional chaining `a?.b`.
   - Parse method calls: `a.startsWith("foo")`, `items.slice(1, 3)`.
2. **`evaluator.test.ts`:**
   - Single expression returning typed values (boolean, number, array, object).
   - Multi-token string template interpolation (`User {{ $trigger.name }} (Score: {{ $trigger.score }})`).
   - Deep undefined property access returning `undefined` without throwing.
   - Large string interpolation (100,000+ chars) performance test.
   - Full Unicode, Asian characters, Cyrillic, and Emoji preservation.
   - Recursive object/array evaluation via `evaluateObject()`.
3. **`security.test.ts`:**
   - Block `__proto__` across all syntax forms (`__proto__.polluted = 1`, `a.__proto__`, `a['__proto__']`).
   - Block `constructor` and `constructor.prototype`.
   - Block `process.exit(1)`, `require('fs')`, `import('node:fs')`.
   - Block prototype pollution attempts via method calls.
   - Verify `ExpressionEvaluationError` is thrown with error code `'ERR_EXPRESSION_EVALUATION'`.

#### Primitives Unit Tests (`tests/primitives/`)
1. **`branch-if.test.ts`:**
   - Evaluate boolean true -> active handle `['true']`, output `{ conditionResult: true }`.
   - Evaluate boolean false -> active handle `['false']`, output `{ conditionResult: false }`.
   - Truthy values (non-empty string, number > 0) -> `true`.
   - Falsy values (`""`, `0`, `null`, `undefined`) -> `false`.
   - Support both type names `primitive.branchIf` and `primitive.if`.
2. **`filter.test.ts`:**
   - Filter with predicate expression (`$item >= 50`) -> correct passed and discarded arrays.
   - Empty input array -> `{ passed: [], discarded: [], count: 0 }`.
   - All pass -> `discarded` is empty, count matches total.
   - All fail -> `passed` is empty, count is 0.
   - Active handles: `['passed']` and `['discarded']` when applicable.
3. **`map.test.ts`:**
   - Transform config into new payload using template expressions.
   - Preserves types (numbers, booleans, nested objects, arrays).
   - Missing fields evaluate cleanly without crashing.
   - Mathematical expressions in mapping values.
4. **`delay.test.ts`:**
   - Execute configured delay duration in milliseconds.
   - Zero delay resolves immediately without blocking.
   - Generates valid `resumedAt` ISO timestamp.
5. **`for-each.test.ts`:**
   - Iterates array elements, producing `{ items: [{ item, index, processed: true }], total }`.
   - Preserves input order across all items.
   - Handles empty array cleanly (`total: 0`).
   - Activates handles `['main', 'done', 'item']`.
6. **`merge.test.ts`:**
   - Merges outputs from multiple active incoming branches into `{ merged: [...], count }`.
   - Ignores incoming branches that were `SKIPPED`.
   - Handles single incoming branch.
   - Supports 3+ converging branches.
7. **`registry.test.ts`:**
   - Lookup by type name or alias.
   - Correct input/output port definitions for visual canvas.

---

## 5. Verification Method

### 5.1 Verification Commands
Once the implementation is completed by the Builder agent, verify using:
```bash
# 1. Run unit tests in packages/workflow-engine
cd /Users/dmitrysazonov/.gemini/antigravity/scratch/opennodes
pnpm --filter @localflow/workflow-engine test

# 2. Run E2E tests for Features F09-F13 and F14-F19
pnpm --filter @localflow/e2e test tests/e2e/tier1-features/f09_f13_engine_core.test.ts
pnpm --filter @localflow/e2e test tests/e2e/tier1-features/f14_f19_primitives.test.ts

# 3. Run Tier 2 expression boundaries test
pnpm --filter @localflow/e2e test tests/e2e/tier2-boundaries/expression_boundaries.test.ts

# 4. Monorepo TypeScript strict typecheck
pnpm typecheck
```

### 5.2 Specific Files to Inspect
1. `packages/workflow-engine/src/expressions/evaluator.ts` — verify NO `eval`, NO `Function`, NO `vm`.
2. `packages/workflow-engine/src/expressions/lexer.ts` — verify prototype pollution token blocklist.
3. `packages/workflow-engine/src/primitives/registry.ts` — verify registration of all 6 primitives plus aliases.
4. `packages/workflow-engine/src/primitives/branch-if.ts` — verify `activeHandles` routing (`true` / `false`).
5. `packages/workflow-engine/src/primitives/merge.ts` — verify handling of skipped branches.

### 5.3 Invalidation Conditions
- Any usage of `eval()`, `new Function()`, or `vm.runInContext()` in `packages/workflow-engine`.
- Allowing access to `__proto__`, `constructor`, or `prototype` without raising `ExpressionEvaluationError`.
- `BranchIf` failing to route unselected paths as `SKIPPED`.
- `Merge` failing when an upstream branch was skipped by an IF node.
- Inability to evaluate Mustache syntax `{{ $nodes.node_1.output.foo }}` or `{{ steps.node_1.output.foo }}`.
