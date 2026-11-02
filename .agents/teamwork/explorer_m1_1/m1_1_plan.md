# Milestone 1 Worker Implementation Plan: Monorepo Foundation & Workflow Schemas (F01, F07, F08)

**Target Milestone:** Milestone 1 (Core Foundation & Security)  
**Author:** Milestone 1 Explorer 1 (Monorepo Scaffolding & Workflow Schemas)  
**Assigned Worker:** Milestone 1 Worker  
**Working Directory:** `/Users/dmitrysazonov/.gemini/antigravity/scratch/opennodes`  
**Date:** 2026-11-02  

---

## 1. Overview & Architectural Scope

This document specifies the exact, step-by-step implementation plan for the worker to bootstrap the **LocalFlow** monorepo tooling and foundational workflow graph schemas.

### Key Deliverables:
1. **F01 - Monorepo Foundation & Tooling**:
   - Monorepo root configuration (`package.json`, `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json`, `.gitignore`, `.prettierrc`).
   - Package workspace skeletons:
     - `packages/shared` (Common domain errors, UUID utilities, constants).
     - `packages/ui` (Unslop design tokens, CSS variables, typography, theme definition).
     - `packages/workflow-schema` (Zod schemas, types, Kahn's algorithm cycle detector, port validator).
   - Package skeletons for remaining components (`packages/db`, `packages/auth`, `packages/observability`, `packages/connector-sdk`, `packages/connectors-core`, `packages/connectors-ai`, `packages/workflow-engine`, `apps/api`, `apps/worker`, `apps/web`) to ensure monorepo scripts (`build`, `test`, `typecheck`, `lint`) resolve cleanly without package-not-found errors.
2. **F07 - Workflow Definition Schema**:
   - Comprehensive Zod models for:
     - `NodePort` (Typed ports: `trigger`, `json`, `string`, `number`, `boolean`, `binary`, `any`; direction `input` / `output`).
     - `WorkflowNode` (Unique ID, type string, data configuration, typed inputs/outputs, position).
     - `WorkflowEdge` (Unique ID, source ID, sourceHandle, target ID, targetHandle).
     - `WorkflowDefinition` / `WorkflowGraph` (Versioned workflow structure with metadata).
     - `WorkflowVersion` (Immutable version snapshots with canonical SHA-256 checksums).
     - `ExecutionStatus`, `NodeStatus`, and `ExecutionEvent` (Lifecycle state schemas).
3. **F08 - Cycle Prevention & Graph Validation**:
   - Topological sorting and cycle detection via **Kahn's Algorithm** ($O(V + E)$).
   - Cycle path extractor isolating exact cyclic loops (`["nodeA", "nodeB", "nodeA"]`).
   - Real-time React Flow connection validator (`wouldCreateCycle`) using BFS reachability check to reject back-edges on the canvas before edge creation.
   - Comprehensive validation rules: typed port compatibility matrix, dangling handle detection, single trigger root constraint (`trigger.manual`, `trigger.cron`, `trigger.webhook`, `trigger.telegram_polling`), duplicate ID detection.
   - Canonical JSON serialization and SHA-256 checksum generator for immutable version snapshots.
4. **Automated Testing Suite (Vitest)**:
   - 100% test coverage across schemas, Kahn's algorithm, port validation, connection validation, and checksum calculation.

---

## 2. Monorepo Directory & File Map

The worker will create the following file layout:

```text
/Users/dmitrysazonov/.gemini/antigravity/scratch/opennodes/
├── package.json                          # Root workspace package.json
├── pnpm-workspace.yaml                   # pnpm workspace definition (apps/*, packages/*)
├── turbo.json                            # Turborepo task pipeline (build, test, lint, typecheck, dev)
├── tsconfig.base.json                    # Strict TypeScript base configuration
├── .gitignore                            # Standard git ignore rules
├── .prettierrc                           # Prettier formatting configuration
├── packages/
│   ├── shared/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts
│   │       ├── errors.ts                 # LocalFlowError, ValidationError, CycleError, etc.
│   │       ├── id.ts                     # UUID & nanoid generators
│   │       └── constants.ts              # Port types, system limits, defaults
│   ├── ui/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts
│   │       └── tokens.ts                 # Unslop design tokens (Graphite ramp, Cobalt accent)
│   └── workflow-schema/
│       ├── package.json
│       ├── tsconfig.json
│       ├── vitest.config.ts
│       ├── src/
│       │   ├── index.ts                  # Public package exports
│       │   ├── types.ts                  # Inferred TypeScript types
│       │   ├── schemas/
│       │   │   ├── node.ts               # NodePort, WorkflowNode, executionPolicy schemas
│       │   │   ├── edge.ts               # WorkflowEdge schema
│       │   │   ├── workflow.ts           # WorkflowDefinition, WorkflowGraph, WorkflowVersion schemas
│       │   │   └── events.ts             # ExecutionStatus, NodeStatus, ExecutionEvent schemas
│       │   ├── validation/
│       │   │   ├── cycle-detector.ts     # Kahn's algorithm & cycle path finder
│       │   │   ├── graph-validator.ts    # Graph validation (triggers, handles, ports, cycles)
│       │   │   ├── port-validator.ts     # Typed port compatibility matrix
│       │   │   └── connection.ts         # wouldCreateCycle for React Flow onConnect
│       │   └── utils/
│       │       └── checksum.ts           # Canonical JSON SHA-256 hashing
│       └── tests/
│           ├── schema.test.ts            # Zod validation & parsing unit tests
│           ├── cycle-detector.test.ts    # Kahn's algorithm DAG & cycle detection tests
│           ├── graph-validator.test.ts   # Graph structure, dangling edges & trigger tests
│           ├── port-validator.test.ts    # Port type compatibility tests
│           ├── connection.test.ts        # Real-time wouldCreateCycle tests
│           └── checksum.test.ts          # Deterministic checksum tests
```

---

## 3. Concrete Step-by-Step Implementation Instructions

### Step 1: Root Monorepo Scaffolding (F01)

#### 1.1 Root `package.json`
Create `/Users/dmitrysazonov/.gemini/antigravity/scratch/opennodes/package.json`:
```json
{
  "name": "localflow",
  "version": "0.1.0",
  "private": true,
  "description": "Independent, deterministic workflow execution platform and visual automation engine",
  "packageManager": "pnpm@12.16.1",
  "scripts": {
    "build": "turbo run build",
    "dev": "turbo run dev",
    "test": "turbo run test",
    "test:coverage": "turbo run test:coverage",
    "lint": "turbo run lint",
    "typecheck": "turbo run typecheck",
    "format": "prettier --write \"**/*.{ts,tsx,js,json,md}\"",
    "format:check": "prettier --check \"**/*.{ts,tsx,js,json,md}\"",
    "clean": "turbo run clean && rm -rf node_modules"
  },
  "devDependencies": {
    "prettier": "^3.4.2",
    "turbo": "^2.4.0",
    "typescript": "^5.7.3",
    "vitest": "^3.0.4"
  },
  "engines": {
    "node": ">=20.0.0",
    "pnpm": ">=9.0.0"
  }
}
```

#### 1.2 `pnpm-workspace.yaml`
Create `/Users/dmitrysazonov/.gemini/antigravity/scratch/opennodes/pnpm-workspace.yaml`:
```yaml
packages:
  - 'apps/*'
  - 'packages/*'
```

#### 1.3 `turbo.json`
Create `/Users/dmitrysazonov/.gemini/antigravity/scratch/opennodes/turbo.json`:
```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**", "build/**", ".next/**"]
    },
    "test": {
      "dependsOn": ["^build"],
      "inputs": ["src/**", "tests/**", "vitest.config.*", "package.json"]
    },
    "test:coverage": {
      "dependsOn": ["^build"],
      "outputs": ["coverage/**"]
    },
    "typecheck": {
      "dependsOn": ["^build"],
      "inputs": ["src/**", "tests/**", "tsconfig*.json"]
    },
    "lint": {
      "inputs": ["src/**", "tests/**"]
    },
    "dev": {
      "cache": false,
      "persistent": true
    },
    "clean": {
      "cache": false
    }
  }
}
```

#### 1.4 `tsconfig.base.json`
Create `/Users/dmitrysazonov/.gemini/antigravity/scratch/opennodes/tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "resolveJsonModule": true,
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "strictFunctionTypes": true,
    "strictBindCallApply": true,
    "strictPropertyInitialization": true,
    "noImplicitThis": true,
    "alwaysStrict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedIndexedAccess": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "esModuleInterop": true
  }
}
```

#### 1.5 `.gitignore`
Create `/Users/dmitrysazonov/.gemini/antigravity/scratch/opennodes/.gitignore`:
```gitignore
# Dependencies
node_modules/
.pnpm-store/

# Build artifacts
dist/
build/
.turbo/
coverage/

# Environment files
.env
.env.local
.env.*.local
!.env.example

# Editor & OS files
.DS_Store
*.log
.vscode/
.idea/
```

#### 1.6 `.prettierrc`
Create `/Users/dmitrysazonov/.gemini/antigravity/scratch/opennodes/.prettierrc`:
```json
{
  "semi": true,
  "singleQuote": true,
  "tabWidth": 2,
  "trailingComma": "es5",
  "printWidth": 100
}
```

---

### Step 2: Shared Foundation Package (`packages/shared`)

#### 2.1 `packages/shared/package.json`
Create `/Users/dmitrysazonov/.gemini/antigravity/scratch/opennodes/packages/shared/package.json`:
```json
{
  "name": "@localflow/shared",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    }
  },
  "scripts": {
    "build": "tsc --build",
    "clean": "rm -rf dist tsconfig.tsbuildinfo",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {},
  "devDependencies": {
    "@types/node": "^22.10.1",
    "typescript": "^5.7.3"
  }
}
```

#### 2.2 `packages/shared/tsconfig.json`
Create `/Users/dmitrysazonov/.gemini/antigravity/scratch/opennodes/packages/shared/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist",
    "composite": true
  },
  "include": ["src/**/*"]
}
```

#### 2.3 `packages/shared/src/errors.ts`
Create `/Users/dmitrysazonov/.gemini/antigravity/scratch/opennodes/packages/shared/src/errors.ts`:
```typescript
/**
 * Base domain error for all LocalFlow errors
 */
export class LocalFlowError extends Error {
  public readonly code: string;
  public readonly statusCode: number;
  public readonly details?: Record<string, unknown>;

  constructor(message: string, code = 'ERR_INTERNAL', statusCode = 500, details?: Record<string, unknown>) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
    Object.setPrototypeOf(this, new.target.prototype);
  }

  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      statusCode: this.statusCode,
      details: this.details,
    };
  }
}

export class ValidationError extends LocalFlowError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'ERR_VALIDATION', 400, details);
  }
}

export class CycleError extends LocalFlowError {
  public readonly cycleNodes: string[];

  constructor(message: string, cycleNodes: string[] = [], details?: Record<string, unknown>) {
    super(message, 'ERR_CYCLIC_DEPENDENCY_DETECTED', 400, { ...details, cycleNodes });
    this.cycleNodes = cycleNodes;
  }
}

export class NotFoundError extends LocalFlowError {
  constructor(resource: string, id: string) {
    super(`${resource} with ID '${id}' not found`, 'ERR_NOT_FOUND', 404, { resource, id });
  }
}

export class UnauthorizedError extends LocalFlowError {
  constructor(message = 'Unauthorized') {
    super(message, 'ERR_UNAUTHORIZED', 401);
  }
}

export class ForbiddenError extends LocalFlowError {
  constructor(message = 'Forbidden: Insufficient workspace permissions') {
    super(message, 'ERR_FORBIDDEN', 403);
  }
}

export class SSRFError extends LocalFlowError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'ERR_SSRF_BLOCKED', 403, details);
  }
}
```

#### 2.4 `packages/shared/src/id.ts`
Create `/Users/dmitrysazonov/.gemini/antigravity/scratch/opennodes/packages/shared/src/id.ts`:
```typescript
import { randomUUID } from 'node:crypto';

/**
 * Generate a standard RFC 4122 v4 UUID
 */
export function generateUuid(): string {
  return randomUUID();
}

/**
 * Generate a prefixed instance ID (e.g. "node_a1b2c3d4", "exec_9f8e7d6c")
 */
export function generatePrefixedId(prefix: string): string {
  const shortId = randomUUID().replace(/-/g, '').substring(0, 12);
  return `${prefix}_${shortId}`;
}
```

#### 2.5 `packages/shared/src/constants.ts`
Create `/Users/dmitrysazonov/.gemini/antigravity/scratch/opennodes/packages/shared/src/constants.ts`:
```typescript
export const PORT_TYPES = [
  'trigger',
  'json',
  'string',
  'number',
  'boolean',
  'binary',
  'any',
] as const;

export type PortType = (typeof PORT_TYPES)[number];

export const PORT_DIRECTIONS = ['input', 'output'] as const;
export type PortDirection = (typeof PORT_DIRECTIONS)[number];

export const WORKFLOW_MAX_NODES = 250;
export const WORKFLOW_MAX_EDGES = 500;
export const WORKFLOW_DEFAULT_TIMEOUT_MS = 300_000; // 5 minutes
export const NODE_DEFAULT_TIMEOUT_MS = 30_000; // 30 seconds
```

#### 2.6 `packages/shared/src/index.ts`
Create `/Users/dmitrysazonov/.gemini/antigravity/scratch/opennodes/packages/shared/src/index.ts`:
```typescript
export * from './errors.js';
export * from './id.js';
export * from './constants.js';
```

---

### Step 3: UI Design Tokens Package (`packages/ui`)

#### 3.1 `packages/ui/package.json`
Create `/Users/dmitrysazonov/.gemini/antigravity/scratch/opennodes/packages/ui/package.json`:
```json
{
  "name": "@localflow/ui",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    }
  },
  "scripts": {
    "build": "tsc --build",
    "clean": "rm -rf dist tsconfig.tsbuildinfo",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {},
  "devDependencies": {
    "@types/node": "^22.10.1",
    "typescript": "^5.7.3"
  }
}
```

#### 3.2 `packages/ui/tsconfig.json`
Create `/Users/dmitrysazonov/.gemini/antigravity/scratch/opennodes/packages/ui/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist",
    "composite": true
  },
  "include": ["src/**/*"]
}
```

#### 3.3 `packages/ui/src/tokens.ts`
Create `/Users/dmitrysazonov/.gemini/antigravity/scratch/opennodes/packages/ui/src/tokens.ts` (strictly conforming to Unslop principles):
```typescript
/**
 * Unslop Design Tokens for LocalFlow
 * - Calm neutral Ink/Graphite ramp
 * - Electric Cobalt accent (<2% surface area)
 * - 4px spacing scale
 * - Nested geometric radii
 * - Zero decorative slop / gradients / neon glows
 */
export const unslopTokens = {
  colors: {
    // Neutral ramp (Ink / Graphite)
    ink: {
      950: '#090a0b', // Root canvas dark background
      900: '#121417', // Surface / Card base
      850: '#1a1d21', // Surface elevated / Drawer
      800: '#22262c', // Border default
      700: '#333942', // Border strong / Active node border
      600: '#4e5664', // Muted text / Placeholder
      400: '#8b94a5', // Secondary text
      200: '#cbd1dc', // Body text
      50: '#f8f9fa',  // Primary heading text
    },
    // Accent (Electric Cobalt - used strictly for focus rings & primary CTA)
    accent: {
      cobalt: '#3b82f6',
      cobaltHover: '#2563eb',
      cobaltSubtle: 'rgba(59, 130, 246, 0.12)',
    },
    // Semantic Status Colors (Desaturated, calm indicators)
    status: {
      queued: '#8b94a5',
      running: '#3b82f6',
      waiting: '#eab308',
      succeeded: '#10b981',
      failed: '#ef4444',
      cancelled: '#6b7280',
    },
    // Port Type Colors (React Flow handle accents)
    port: {
      trigger: '#f59e0b', // Amber
      json: '#3b82f6',    // Blue
      string: '#10b981',  // Emerald
      number: '#8b5cf6',  // Purple
      boolean: '#ec4899', // Pink
      binary: '#6366f1',  // Indigo
      any: '#94a3b8',     // Slate
    },
  },
  typography: {
    fontSans: 'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    fontMono: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
  },
  spacing: {
    1: '4px',
    2: '8px',
    3: '12px',
    4: '16px',
    6: '24px',
    8: '32px',
  },
  radii: {
    sm: '4px',
    md: '6px',
    lg: '8px',
    full: '9999px',
  },
} as const;

export type UnslopTokens = typeof unslopTokens;
```

#### 3.4 `packages/ui/src/index.ts`
Create `/Users/dmitrysazonov/.gemini/antigravity/scratch/opennodes/packages/ui/src/index.ts`:
```typescript
export * from './tokens.js';
```

---

### Step 4: Workflow Schema & Graph Validation Package (`packages/workflow-schema`) (F07 & F08)

#### 4.1 `packages/workflow-schema/package.json`
Create `/Users/dmitrysazonov/.gemini/antigravity/scratch/opennodes/packages/workflow-schema/package.json`:
```json
{
  "name": "@localflow/workflow-schema",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    }
  },
  "scripts": {
    "build": "tsc --build",
    "clean": "rm -rf dist tsconfig.tsbuildinfo",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@localflow/shared": "workspace:*",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@types/node": "^22.10.1",
    "typescript": "^5.7.3",
    "vitest": "^3.0.4"
  }
}
```

#### 4.2 `packages/workflow-schema/tsconfig.json`
Create `/Users/dmitrysazonov/.gemini/antigravity/scratch/opennodes/packages/workflow-schema/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist",
    "composite": true
  },
  "references": [
    { "path": "../shared" }
  ],
  "include": ["src/**/*"]
}
```

#### 4.3 `packages/workflow-schema/vitest.config.ts`
Create `/Users/dmitrysazonov/.gemini/antigravity/scratch/opennodes/packages/workflow-schema/vitest.config.ts`:
```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
```

#### 4.4 `packages/workflow-schema/src/schemas/node.ts`
Create `/Users/dmitrysazonov/.gemini/antigravity/scratch/opennodes/packages/workflow-schema/src/schemas/node.ts`:
```typescript
import { z } from 'zod';
import { PORT_TYPES, PORT_DIRECTIONS } from '@localflow/shared';

export const NodePortSchema = z.object({
  id: z.string().min(1, 'Port ID cannot be empty'),
  name: z.string().min(1, 'Port name cannot be empty'),
  type: z.enum(PORT_TYPES),
  direction: z.enum(PORT_DIRECTIONS),
  required: z.boolean().default(false),
  description: z.string().optional(),
});

export const NodeExecutionPolicySchema = z.object({
  maxRetries: z.number().int().min(0).max(5).default(0),
  backoffType: z.enum(['exponential', 'fixed']).default('exponential'),
  initialIntervalMs: z.number().int().min(100).max(60000).default(1000),
  maxIntervalMs: z.number().int().min(1000).max(300000).default(30000),
  timeoutMs: z.number().int().min(500).max(300000).default(30000),
  continueOnError: z.boolean().default(false),
});

export const WorkflowNodeDataSchema = z.object({
  label: z.string().min(1, 'Node label cannot be empty'),
  description: z.string().optional(),
  config: z.record(z.string(), z.unknown()).default({}),
  credentialId: z.string().uuid().optional(),
  executionPolicy: NodeExecutionPolicySchema.optional(),
});

export const NodePositionSchema = z.object({
  x: z.number(),
  y: z.number(),
});

export const WorkflowNodeSchema = z.object({
  id: z.string().min(1, 'Node ID cannot be empty'),
  type: z.string().min(1, 'Node type cannot be empty'),
  data: WorkflowNodeDataSchema,
  inputs: z.array(NodePortSchema).default([]),
  outputs: z.array(NodePortSchema).default([]),
  position: NodePositionSchema.optional(),
});
```

#### 4.5 `packages/workflow-schema/src/schemas/edge.ts`
Create `/Users/dmitrysazonov/.gemini/antigravity/scratch/opennodes/packages/workflow-schema/src/schemas/edge.ts`:
```typescript
import { z } from 'zod';

export const WorkflowEdgeSchema = z.object({
  id: z.string().min(1, 'Edge ID cannot be empty'),
  source: z.string().min(1, 'Source node ID cannot be empty'),
  sourceHandle: z.string().min(1, 'Source handle ID cannot be empty'),
  target: z.string().min(1, 'Target node ID cannot be empty'),
  targetHandle: z.string().min(1, 'Target handle ID cannot be empty'),
});
```

#### 4.6 `packages/workflow-schema/src/schemas/workflow.ts`
Create `/Users/dmitrysazonov/.gemini/antigravity/scratch/opennodes/packages/workflow-schema/src/schemas/workflow.ts`:
```typescript
import { z } from 'zod';
import { WorkflowNodeSchema } from './node.js';
import { WorkflowEdgeSchema } from './edge.js';

export const WorkflowExecutionPolicySchema = z.object({
  executionTimeoutMs: z.number().int().min(1000).max(3600000).default(300000), // Default 5 mins
  maxConcurrency: z.number().int().min(1).max(50).default(5),
});

export const WorkflowDefinitionSchema = z.object({
  id: z.string().uuid('Workflow ID must be a valid UUID'),
  workspaceId: z.string().uuid('Workspace ID must be a valid UUID'),
  name: z.string().min(1, 'Workflow name cannot be empty').max(255),
  description: z.string().max(1000).optional(),
  schemaVersion: z.literal('1.0').default('1.0'),
  nodes: z.array(WorkflowNodeSchema),
  edges: z.array(WorkflowEdgeSchema),
  executionPolicy: WorkflowExecutionPolicySchema.default({}),
  createdAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime().optional(),
});

export const WorkflowGraphSchema = WorkflowDefinitionSchema.extend({
  checksum: z.string().length(64, 'Checksum must be a 64-character SHA-256 hex string').optional(),
});

export const WorkflowVersionSchema = z.object({
  id: z.string().uuid('Version ID must be a valid UUID'),
  workflowId: z.string().uuid('Workflow ID must be a valid UUID'),
  versionNumber: z.number().int().min(1),
  isDraft: z.boolean().default(false),
  snapshot: WorkflowGraphSchema,
  checksum: z.string().length(64, 'Checksum must be a 64-character SHA-256 hex string'),
  createdBy: z.string().uuid().optional(),
  createdAt: z.string().datetime(),
});
```

#### 4.7 `packages/workflow-schema/src/schemas/events.ts`
Create `/Users/dmitrysazonov/.gemini/antigravity/scratch/opennodes/packages/workflow-schema/src/schemas/events.ts`:
```typescript
import { z } from 'zod';

export const ExecutionStatusSchema = z.enum([
  'QUEUED',
  'RUNNING',
  'WAITING',
  'SUCCEEDED',
  'FAILED',
  'CANCELLED',
]);

export const NodeStatusSchema = z.enum([
  'PENDING',
  'RUNNING',
  'SUCCEEDED',
  'FAILED',
  'SKIPPED',
  'CANCELLED',
]);

export const ExecutionEventSchema = z.object({
  eventId: z.string(),
  executionId: z.string().uuid(),
  timestamp: z.string().datetime(),
  type: z.enum([
    'EXECUTION_QUEUED',
    'EXECUTION_STARTED',
    'STEP_STARTED',
    'STEP_PROGRESS',
    'STEP_SUCCEEDED',
    'STEP_FAILED',
    'STEP_SKIPPED',
    'EXECUTION_WAITING',
    'EXECUTION_SUCCEEDED',
    'EXECUTION_FAILED',
    'EXECUTION_CANCELLED',
  ]),
  nodeId: z.string().optional(),
  status: ExecutionStatusSchema.optional(),
  nodeStatus: NodeStatusSchema.optional(),
  data: z.record(z.string(), z.unknown()).optional(),
});
```

#### 4.8 `packages/workflow-schema/src/types.ts`
Create `/Users/dmitrysazonov/.gemini/antigravity/scratch/opennodes/packages/workflow-schema/src/types.ts`:
```typescript
import { z } from 'zod';
import {
  NodePortSchema,
  NodeExecutionPolicySchema,
  WorkflowNodeDataSchema,
  WorkflowNodeSchema,
  NodePositionSchema,
} from './schemas/node.js';
import { WorkflowEdgeSchema } from './schemas/edge.js';
import {
  WorkflowExecutionPolicySchema,
  WorkflowDefinitionSchema,
  WorkflowGraphSchema,
  WorkflowVersionSchema,
} from './schemas/workflow.js';
import {
  ExecutionStatusSchema,
  NodeStatusSchema,
  ExecutionEventSchema,
} from './schemas/events.js';

export type NodePort = z.infer<typeof NodePortSchema>;
export type NodeExecutionPolicy = z.infer<typeof NodeExecutionPolicySchema>;
export type WorkflowNodeData = z.infer<typeof WorkflowNodeDataSchema>;
export type NodePosition = z.infer<typeof NodePositionSchema>;
export type WorkflowNode = z.infer<typeof WorkflowNodeSchema>;

export type WorkflowEdge = z.infer<typeof WorkflowEdgeSchema>;

export type WorkflowExecutionPolicy = z.infer<typeof WorkflowExecutionPolicySchema>;
export type WorkflowDefinition = z.infer<typeof WorkflowDefinitionSchema>;
export type WorkflowGraph = z.infer<typeof WorkflowGraphSchema>;
export type WorkflowVersion = z.infer<typeof WorkflowVersionSchema>;

export type ExecutionStatus = z.infer<typeof ExecutionStatusSchema>;
export type NodeStatus = z.infer<typeof NodeStatusSchema>;
export type ExecutionEvent = z.infer<typeof ExecutionEventSchema>;
```

#### 4.9 `packages/workflow-schema/src/validation/cycle-detector.ts` (F08 - Kahn's Algorithm & Cycle Extraction)
Create `/Users/dmitrysazonov/.gemini/antigravity/scratch/opennodes/packages/workflow-schema/src/validation/cycle-detector.ts`:
```typescript
import { WorkflowNode, WorkflowEdge } from '../types.js';

export interface CycleDetectionResult {
  hasCycle: boolean;
  topologicalOrder: string[]; // Valid linear evaluation order if hasCycle is false
  cycleNodes: string[];      // Node IDs involved in or downstream of cycle
  cyclePath: string[];       // Specific directed cycle path, e.g. ["A", "B", "C", "A"]
}

/**
 * Detects cycles in a directed workflow graph using Kahn's Algorithm (Topological Sort).
 * Complexity: O(V + E) time, O(V + E) space.
 * 
 * If a cycle exists, uses DFS from remaining nodes to extract the exact cycle loop path.
 */
export function detectCycles(
  nodes: readonly { id: string }[],
  edges: readonly { source: string; target: string }[]
): CycleDetectionResult {
  const nodeIds = new Set(nodes.map((n) => n.id));
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();

  // Initialize data structures for all nodes
  for (const node of nodes) {
    inDegree.set(node.id, 0);
    adjacency.set(node.id, []);
  }

  // Populate adjacency and in-degrees (ignoring edges referencing non-existent nodes)
  for (const edge of edges) {
    if (nodeIds.has(edge.source) && nodeIds.has(edge.target)) {
      adjacency.get(edge.source)!.push(edge.target);
      inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1);
    }
  }

  // Kahn's Algorithm: Initialize queue with all nodes having in-degree 0
  const queue: string[] = [];
  for (const [nodeId, degree] of inDegree.entries()) {
    if (degree === 0) {
      queue.push(nodeId);
    }
  }

  const topologicalOrder: string[] = [];

  while (queue.length > 0) {
    const current = queue.shift()!;
    topologicalOrder.push(current);

    const neighbors = adjacency.get(current) ?? [];
    for (const neighbor of neighbors) {
      const updatedDegree = (inDegree.get(neighbor) ?? 0) - 1;
      inDegree.set(neighbor, updatedDegree);
      if (updatedDegree === 0) {
        queue.push(neighbor);
      }
    }
  }

  // If all nodes were visited, graph is a DAG (no cycles)
  if (topologicalOrder.length === nodes.length) {
    return {
      hasCycle: false,
      topologicalOrder,
      cycleNodes: [],
      cyclePath: [],
    };
  }

  // Graph has one or more cycles! Identify all nodes that could not be resolved
  const cycleNodes: string[] = [];
  for (const [nodeId, degree] of inDegree.entries()) {
    if (degree > 0) {
      cycleNodes.push(nodeId);
    }
  }

  // Extract a specific cycle path using DFS
  const cyclePath = extractCyclePath(cycleNodes, adjacency);

  return {
    hasCycle: true,
    topologicalOrder: [],
    cycleNodes,
    cyclePath,
  };
}

/**
 * Traces a directed cycle loop from the set of candidate cycle nodes
 */
function extractCyclePath(
  cycleCandidates: string[],
  adjacency: Map<string, string[]>
): string[] {
  const candidateSet = new Set(cycleCandidates);
  const visited = new Set<string>();
  const recursionStack: string[] = [];
  const stackSet = new Set<string>();

  function dfs(nodeId: string): string[] | null {
    visited.add(nodeId);
    recursionStack.push(nodeId);
    stackSet.add(nodeId);

    const neighbors = adjacency.get(nodeId) ?? [];
    for (const neighbor of neighbors) {
      if (!candidateSet.has(neighbor)) continue;

      if (!visited.has(neighbor)) {
        const found = dfs(neighbor);
        if (found) return found;
      } else if (stackSet.has(neighbor)) {
        // Found back-edge! Reconstruct the cycle from neighbor to neighbor
        const cycleStartIndex = recursionStack.indexOf(neighbor);
        if (cycleStartIndex !== -1) {
          const path = recursionStack.slice(cycleStartIndex);
          path.push(neighbor); // Close the loop
          return path;
        }
      }
    }

    recursionStack.pop();
    stackSet.delete(nodeId);
    return null;
  }

  for (const candidate of cycleCandidates) {
    if (!visited.has(candidate)) {
      const cycle = dfs(candidate);
      if (cycle) return cycle;
    }
  }

  return [];
}
```

#### 4.10 `packages/workflow-schema/src/validation/connection.ts` (Real-Time React Flow Rejection)
Create `/Users/dmitrysazonov/.gemini/antigravity/scratch/opennodes/packages/workflow-schema/src/validation/connection.ts`:
```typescript
export interface ProposedConnection {
  source: string;
  target: string;
}

/**
 * Evaluates whether adding a proposed connection would introduce a cycle.
 * Used on React Flow canvas in `onConnect` or `isValidConnection`.
 * 
 * Logic: Adding an edge (source -> target) creates a cycle if and only if
 * there already exists a directed path from `target` to `source`.
 * 
 * Complexity: O(V + E) BFS traversal.
 */
export function wouldCreateCycle(
  existingEdges: readonly { source: string; target: string }[],
  newConnection: ProposedConnection
): boolean {
  const { source, target } = newConnection;

  // Immediate self-loop
  if (source === target) {
    return true;
  }

  // Build adjacency list for existing edges
  const adjacency = new Map<string, string[]>();
  for (const edge of existingEdges) {
    let list = adjacency.get(edge.source);
    if (!list) {
      list = [];
      adjacency.set(edge.source, list);
    }
    list.push(edge.target);
  }

  // BFS check: can we reach `source` starting from `target`?
  const visited = new Set<string>();
  const queue: string[] = [target];
  visited.add(target);

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current === source) {
      return true; // Cycle detected!
    }

    const neighbors = adjacency.get(current);
    if (neighbors) {
      for (const neighbor of neighbors) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          queue.push(neighbor);
        }
      }
    }
  }

  return false;
}
```

#### 4.11 `packages/workflow-schema/src/validation/port-validator.ts`
Create `/Users/dmitrysazonov/.gemini/antigravity/scratch/opennodes/packages/workflow-schema/src/validation/port-validator.ts`:
```typescript
import { PortType } from '@localflow/shared';

/**
 * Validates whether data from an output port of source type
 * can be accepted by an input port of target type.
 */
export function arePortsCompatible(sourceType: PortType, targetType: PortType): boolean {
  // 'any' port accepts and feeds any type
  if (sourceType === 'any' || targetType === 'any') {
    return true;
  }

  // Exact type match is always allowed
  if (sourceType === targetType) {
    return true;
  }

  // Trigger output can only feed trigger or any
  if (sourceType === 'trigger' || targetType === 'trigger') {
    return false;
  }

  // JSON can accept string, number, boolean as valid JSON values
  if (targetType === 'json' && (sourceType === 'string' || sourceType === 'number' || sourceType === 'boolean')) {
    return true;
  }

  return false;
}
```

#### 4.12 `packages/workflow-schema/src/validation/graph-validator.ts`
Create `/Users/dmitrysazonov/.gemini/antigravity/scratch/opennodes/packages/workflow-schema/src/validation/graph-validator.ts`:
```typescript
import { WorkflowNode, WorkflowEdge, NodePort } from '../types.js';
import { detectCycles } from './cycle-detector.js';
import { arePortsCompatible } from './port-validator.js';

export interface GraphValidationError {
  code:
    | 'ERR_CYCLIC_DEPENDENCY_DETECTED'
    | 'ERR_SOURCE_NODE_NOT_FOUND'
    | 'ERR_TARGET_NODE_NOT_FOUND'
    | 'ERR_SOURCE_HANDLE_NOT_FOUND'
    | 'ERR_TARGET_HANDLE_NOT_FOUND'
    | 'ERR_PORT_DIRECTION_INVALID'
    | 'ERR_PORT_INCOMPATIBLE'
    | 'ERR_MISSING_TRIGGER'
    | 'ERR_MULTIPLE_TRIGGERS'
    | 'ERR_DUPLICATE_NODE_ID'
    | 'ERR_DUPLICATE_EDGE_ID';
  message: string;
  nodeIds?: string[];
  edgeIds?: string[];
  details?: Record<string, unknown>;
}

export interface GraphValidationWarning {
  code: 'WARN_DISCONNECTED_NODE' | 'WARN_UNUSED_TRIGGER';
  message: string;
  nodeIds?: string[];
}

export interface GraphValidationResult {
  valid: boolean;
  errors: GraphValidationError[];
  warnings: GraphValidationWarning[];
  topologicalOrder?: string[];
}

export interface ValidateGraphOptions {
  requireSingleTrigger?: boolean; // Default true for publication/execution
}

/**
 * Performs full validation of a workflow graph:
 * - Duplicate IDs
 * - Dangling edges (missing node or missing port handles)
 * - Port directions (output -> input only)
 * - Port type compatibility
 * - Single trigger rule (Manual, Cron, Webhook, Telegram Polling)
 * - Cycle detection via Kahn's algorithm
 */
export function validateWorkflowGraph(
  nodes: readonly WorkflowNode[],
  edges: readonly WorkflowEdge[],
  options: ValidateGraphOptions = { requireSingleTrigger: true }
): GraphValidationResult {
  const errors: GraphValidationError[] = [];
  const warnings: GraphValidationWarning[] = [];

  // 1. Check duplicate node IDs
  const nodeMap = new Map<string, WorkflowNode>();
  for (const node of nodes) {
    if (nodeMap.has(node.id)) {
      errors.push({
        code: 'ERR_DUPLICATE_NODE_ID',
        message: `Duplicate node ID detected: '${node.id}'`,
        nodeIds: [node.id],
      });
    } else {
      nodeMap.set(node.id, node);
    }
  }

  // 2. Check duplicate edge IDs
  const edgeIdSet = new Set<string>();
  for (const edge of edges) {
    if (edgeIdSet.has(edge.id)) {
      errors.push({
        code: 'ERR_DUPLICATE_EDGE_ID',
        message: `Duplicate edge ID detected: '${edge.id}'`,
        edgeIds: [edge.id],
      });
    } else {
      edgeIdSet.add(edge.id);
    }
  }

  // 3. Check trigger constraint
  const triggerNodes = nodes.filter((n) => n.type.startsWith('trigger.'));
  if (options.requireSingleTrigger) {
    if (triggerNodes.length === 0) {
      errors.push({
        code: 'ERR_MISSING_TRIGGER',
        message: 'Workflow must contain exactly one trigger node (Manual, Cron, Webhook, or Telegram Polling).',
      });
    } else if (triggerNodes.length > 1) {
      errors.push({
        code: 'ERR_MULTIPLE_TRIGGERS',
        message: `Workflow contains ${triggerNodes.length} triggers. Exactly one root trigger is permitted.`,
        nodeIds: triggerNodes.map((n) => n.id),
      });
    }
  }

  // 4. Validate edges, handles, and port compatibility
  for (const edge of edges) {
    const sourceNode = nodeMap.get(edge.source);
    const targetNode = nodeMap.get(edge.target);

    if (!sourceNode) {
      errors.push({
        code: 'ERR_SOURCE_NODE_NOT_FOUND',
        message: `Edge '${edge.id}' references non-existent source node '${edge.source}'`,
        edgeIds: [edge.id],
      });
      continue;
    }

    if (!targetNode) {
      errors.push({
        code: 'ERR_TARGET_NODE_NOT_FOUND',
        message: `Edge '${edge.id}' references non-existent target node '${edge.target}'`,
        edgeIds: [edge.id],
      });
      continue;
    }

    const sourcePort = sourceNode.outputs.find((p) => p.id === edge.sourceHandle);
    if (!sourcePort) {
      errors.push({
        code: 'ERR_SOURCE_HANDLE_NOT_FOUND',
        message: `Edge '${edge.id}' references non-existent output handle '${edge.sourceHandle}' on node '${edge.source}'`,
        nodeIds: [edge.source],
        edgeIds: [edge.id],
      });
    } else if (sourcePort.direction !== 'output') {
      errors.push({
        code: 'ERR_PORT_DIRECTION_INVALID',
        message: `Edge '${edge.id}' connects from handle '${edge.sourceHandle}' which is not an output port`,
        nodeIds: [edge.source],
        edgeIds: [edge.id],
      });
    }

    const targetPort = targetNode.inputs.find((p) => p.id === edge.targetHandle);
    if (!targetPort) {
      errors.push({
        code: 'ERR_TARGET_HANDLE_NOT_FOUND',
        message: `Edge '${edge.id}' references non-existent input handle '${edge.targetHandle}' on node '${edge.target}'`,
        nodeIds: [edge.target],
        edgeIds: [edge.id],
      });
    } else if (targetPort.direction !== 'input') {
      errors.push({
        code: 'ERR_PORT_DIRECTION_INVALID',
        message: `Edge '${edge.id}' connects to handle '${edge.targetHandle}' which is not an input port`,
        nodeIds: [edge.target],
        edgeIds: [edge.id],
      });
    }

    // Port compatibility check
    if (sourcePort && targetPort) {
      if (!arePortsCompatible(sourcePort.type, targetPort.type)) {
        errors.push({
          code: 'ERR_PORT_INCOMPATIBLE',
          message: `Incompatible port connection between '${edge.source}:${sourcePort.id}' (${sourcePort.type}) and '${edge.target}:${targetPort.id}' (${targetPort.type})`,
          nodeIds: [edge.source, edge.target],
          edgeIds: [edge.id],
          details: {
            sourceType: sourcePort.type,
            targetType: targetPort.type,
          },
        });
      }
    }
  }

  // 5. Run Kahn's Cycle Detection
  const cycleResult = detectCycles(nodes, edges);
  if (cycleResult.hasCycle) {
    errors.push({
      code: 'ERR_CYCLIC_DEPENDENCY_DETECTED',
      message: `Cycle detected involving nodes: ${cycleResult.cycleNodes.join(', ')}. Path: ${cycleResult.cyclePath.join(' -> ')}`,
      nodeIds: cycleResult.cycleNodes,
      details: {
        cycleNodes: cycleResult.cycleNodes,
        cyclePath: cycleResult.cyclePath,
      },
    });
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    topologicalOrder: cycleResult.hasCycle ? undefined : cycleResult.topologicalOrder,
  };
}
```

#### 4.13 `packages/workflow-schema/src/utils/checksum.ts`
Create `/Users/dmitrysazonov/.gemini/antigravity/scratch/opennodes/packages/workflow-schema/src/utils/checksum.ts`:
```typescript
import { createHash } from 'node:crypto';

/**
 * Deterministically sorts object keys recursively to produce canonical JSON
 */
function canonicalize(obj: unknown): unknown {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(canonicalize);
  }

  const sortedKeys = Object.keys(obj as Record<string, unknown>).sort();
  const result: Record<string, unknown> = {};

  for (const key of sortedKeys) {
    result[key] = canonicalize((obj as Record<string, unknown>)[key]);
  }

  return result;
}

/**
 * Computes deterministic SHA-256 hex digest of an object snapshot
 */
export function computeWorkflowChecksum(snapshot: unknown): string {
  const canonicalObj = canonicalize(snapshot);
  const jsonString = JSON.stringify(canonicalObj);
  return createHash('sha256').update(jsonString, 'utf8').digest('hex');
}
```

#### 4.14 `packages/workflow-schema/src/index.ts`
Create `/Users/dmitrysazonov/.gemini/antigravity/scratch/opennodes/packages/workflow-schema/src/index.ts`:
```typescript
export * from './types.js';
export * from './schemas/node.js';
export * from './schemas/edge.js';
export * from './schemas/workflow.js';
export * from './schemas/events.js';
export * from './validation/cycle-detector.js';
export * from './validation/connection.js';
export * from './validation/port-validator.js';
export * from './validation/graph-validator.js';
export * from './utils/checksum.js';
```

---

### Step 5: Unit Test Specifications (`packages/workflow-schema/tests/*`)

#### 5.1 `tests/cycle-detector.test.ts`
Create `/Users/dmitrysazonov/.gemini/antigravity/scratch/opennodes/packages/workflow-schema/tests/cycle-detector.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { detectCycles } from '../src/validation/cycle-detector.js';

describe('Kahn Cycle Detector', () => {
  it('should accept a linear DAG and return topological order', () => {
    const nodes = [{ id: 'A' }, { id: 'B' }, { id: 'C' }];
    const edges = [
      { source: 'A', target: 'B' },
      { source: 'B', target: 'C' },
    ];

    const result = detectCycles(nodes, edges);
    expect(result.hasCycle).toBe(false);
    expect(result.topologicalOrder).toEqual(['A', 'B', 'C']);
    expect(result.cycleNodes).toHaveLength(0);
  });

  it('should accept a diamond DAG (branch and merge)', () => {
    const nodes = [{ id: 'A' }, { id: 'B' }, { id: 'C' }, { id: 'D' }];
    const edges = [
      { source: 'A', target: 'B' },
      { source: 'A', target: 'C' },
      { source: 'B', target: 'D' },
      { source: 'C', target: 'D' },
    ];

    const result = detectCycles(nodes, edges);
    expect(result.hasCycle).toBe(false);
    expect(result.topologicalOrder[0]).toBe('A');
    expect(result.topologicalOrder[3]).toBe('D');
  });

  it('should detect a simple 2-node cycle (A -> B -> A)', () => {
    const nodes = [{ id: 'A' }, { id: 'B' }];
    const edges = [
      { source: 'A', target: 'B' },
      { source: 'B', target: 'A' },
    ];

    const result = detectCycles(nodes, edges);
    expect(result.hasCycle).toBe(true);
    expect(result.topologicalOrder).toHaveLength(0);
    expect(result.cycleNodes).toEqual(expect.arrayContaining(['A', 'B']));
    expect(result.cyclePath.length).toBeGreaterThanOrEqual(2);
  });

  it('should detect a 5-node cycle in a larger graph', () => {
    const nodes = [
      { id: 'T' },
      { id: 'N1' },
      { id: 'N2' },
      { id: 'N3' },
      { id: 'N4' },
      { id: 'N5' },
    ];
    const edges = [
      { source: 'T', target: 'N1' },
      { source: 'N1', target: 'N2' },
      { source: 'N2', target: 'N3' },
      { source: 'N3', target: 'N4' },
      { source: 'N4', target: 'N5' },
      { source: 'N5', target: 'N2' }, // Cycle: N2 -> N3 -> N4 -> N5 -> N2
    ];

    const result = detectCycles(nodes, edges);
    expect(result.hasCycle).toBe(true);
    expect(result.cycleNodes).toEqual(expect.arrayContaining(['N2', 'N3', 'N4', 'N5']));
    expect(result.cycleNodes).not.toContain('T');
  });

  it('should detect a self-referencing loop (A -> A)', () => {
    const nodes = [{ id: 'A' }];
    const edges = [{ source: 'A', target: 'A' }];

    const result = detectCycles(nodes, edges);
    expect(result.hasCycle).toBe(true);
    expect(result.cycleNodes).toEqual(['A']);
  });
});
```

#### 5.2 `tests/connection.test.ts`
Create `/Users/dmitrysazonov/.gemini/antigravity/scratch/opennodes/packages/workflow-schema/tests/connection.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { wouldCreateCycle } from '../src/validation/connection.js';

describe('Real-time Connection Validator (wouldCreateCycle)', () => {
  it('should reject immediate self-loop connection', () => {
    expect(wouldCreateCycle([], { source: 'node1', target: 'node1' })).toBe(true);
  });

  it('should allow valid forward edge', () => {
    const edges = [
      { source: 'node1', target: 'node2' },
      { source: 'node2', target: 'node3' },
    ];
    expect(wouldCreateCycle(edges, { source: 'node3', target: 'node4' })).toBe(false);
  });

  it('should reject back-edge creating direct 2-node cycle', () => {
    const edges = [{ source: 'node1', target: 'node2' }];
    expect(wouldCreateCycle(edges, { source: 'node2', target: 'node1' })).toBe(true);
  });

  it('should reject back-edge creating indirect multi-step cycle', () => {
    const edges = [
      { source: 'A', target: 'B' },
      { source: 'B', target: 'C' },
      { source: 'C', target: 'D' },
    ];
    expect(wouldCreateCycle(edges, { source: 'D', target: 'A' })).toBe(true);
    expect(wouldCreateCycle(edges, { source: 'D', target: 'B' })).toBe(true);
  });
});
```

#### 5.3 `tests/graph-validator.test.ts`
Create `/Users/dmitrysazonov/.gemini/antigravity/scratch/opennodes/packages/workflow-schema/tests/graph-validator.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { validateWorkflowGraph } from '../src/validation/graph-validator.js';
import { WorkflowNode, WorkflowEdge } from '../src/types.js';

describe('Workflow Graph Validator', () => {
  const triggerNode: WorkflowNode = {
    id: 'trigger_1',
    type: 'trigger.manual',
    data: { label: 'Manual Trigger', config: {} },
    inputs: [],
    outputs: [{ id: 'main', name: 'Main', type: 'trigger', direction: 'output', required: true }],
  };

  const actionNode: WorkflowNode = {
    id: 'http_1',
    type: 'core.httpRequest',
    data: { label: 'HTTP Request', config: { url: 'https://api.example.com' } },
    inputs: [{ id: 'main', name: 'Main', type: 'any', direction: 'input', required: true }],
    outputs: [{ id: 'main', name: 'Main', type: 'json', direction: 'output', required: true }],
  };

  const edge: WorkflowEdge = {
    id: 'edge_1',
    source: 'trigger_1',
    sourceHandle: 'main',
    target: 'http_1',
    targetHandle: 'main',
  };

  it('should pass validation for a valid single-trigger DAG', () => {
    const result = validateWorkflowGraph([triggerNode, actionNode], [edge]);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.topologicalOrder).toEqual(['trigger_1', 'http_1']);
  });

  it('should fail if missing trigger node', () => {
    const result = validateWorkflowGraph([actionNode], []);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === 'ERR_MISSING_TRIGGER')).toBe(true);
  });

  it('should fail if multiple trigger nodes are present', () => {
    const secondTrigger: WorkflowNode = {
      ...triggerNode,
      id: 'trigger_2',
      type: 'trigger.cron',
    };
    const result = validateWorkflowGraph([triggerNode, secondTrigger, actionNode], [edge]);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === 'ERR_MULTIPLE_TRIGGERS')).toBe(true);
  });

  it('should fail if edge references dangling node', () => {
    const badEdge: WorkflowEdge = {
      ...edge,
      target: 'non_existent_node',
    };
    const result = validateWorkflowGraph([triggerNode, actionNode], [badEdge]);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === 'ERR_TARGET_NODE_NOT_FOUND')).toBe(true);
  });

  it('should fail if edge references non-existent handle', () => {
    const badEdge: WorkflowEdge = {
      ...edge,
      targetHandle: 'ghost_handle',
    };
    const result = validateWorkflowGraph([triggerNode, actionNode], [badEdge]);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === 'ERR_TARGET_HANDLE_NOT_FOUND')).toBe(true);
  });
});
```

#### 5.4 `tests/checksum.test.ts`
Create `/Users/dmitrysazonov/.gemini/antigravity/scratch/opennodes/packages/workflow-schema/tests/checksum.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { computeWorkflowChecksum } from '../src/utils/checksum.js';

describe('Workflow Checksum', () => {
  it('should generate identical checksum regardless of object key order', () => {
    const objA = {
      b: 2,
      a: 1,
      nested: { z: 10, y: 20 },
    };
    const objB = {
      a: 1,
      nested: { y: 20, z: 10 },
      b: 2,
    };

    const hashA = computeWorkflowChecksum(objA);
    const hashB = computeWorkflowChecksum(objB);

    expect(hashA).toBe(hashB);
    expect(hashA).toHaveLength(64);
  });

  it('should produce different checksums when content changes', () => {
    const objA = { name: 'Workflow A', version: 1 };
    const objB = { name: 'Workflow B', version: 1 };

    expect(computeWorkflowChecksum(objA)).not.toBe(computeWorkflowChecksum(objB));
  });
});
```

---

### Step 6: Workspace Consistency & Execution Verification

To verify that the monorepo setup completes without errors:
1. Run `pnpm install` in the monorepo root.
2. Run `pnpm turbo run build` to compile TypeScript across all packages.
3. Run `pnpm turbo run typecheck` to verify strict TypeScript adherence.
4. Run `pnpm turbo run test` to verify that all 100% of unit tests pass in `workflow-schema`.
5. Run `pnpm format:check` to ensure Prettier formatting passes.

---

## 4. Verification Method for Implementer

| Check | Command | Expected Result |
|---|---|---|
| Monorepo installation | `pnpm install` | Clean lockfile generated, dependencies installed |
| Package builds | `pnpm turbo run build` | Compiles `@localflow/shared`, `@localflow/ui`, `@localflow/workflow-schema` |
| Strict typechecks | `pnpm turbo run typecheck` | 0 errors across all workspaces |
| Vitest unit tests | `pnpm turbo run test` | All unit tests in `workflow-schema` pass |
| Checksum determinism | `pnpm --filter @localflow/workflow-schema test checksum` | Passes with identical 64-char SHA-256 hashes |
| Kahn cycle tests | `pnpm --filter @localflow/workflow-schema test cycle` | Passes all DAG and cycle detection tests |
