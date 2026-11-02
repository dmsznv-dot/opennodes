/**
 * LocalFlow E2E Test Suite - Core Type Contracts
 * Strictly derived from PROJECT.md and ORIGINAL_REQUEST.md Interface Contracts.
 */

export type PortDataType = 'trigger' | 'json' | 'string' | 'number' | 'boolean' | 'binary' | 'any';

export interface NodePort {
  id: string;
  name: string;
  type: PortDataType;
  direction: 'input' | 'output';
}

export interface WorkflowNode {
  id: string;
  type: string;
  data: {
    label: string;
    config: Record<string, unknown>;
    credentialId?: string;
  };
  inputs: NodePort[];
  outputs: NodePort[];
  position?: { x: number; y: number };
}

export interface WorkflowEdge {
  id: string;
  source: string;
  sourceHandle: string;
  target: string;
  targetHandle: string;
}

export interface WorkflowDefinition {
  id: string;
  workspaceId: string;
  name: string;
  description?: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  triggerConfig?: Record<string, unknown>;
  executionPolicy?: {
    timeoutMs?: number;
    maxRetries?: number;
    backoffMs?: number;
  };
}

export type ExecutionStatus = 'QUEUED' | 'RUNNING' | 'WAITING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED';

export type NodeExecutionStatus = 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'SKIPPED' | 'CANCELLED';

export interface StepExecutionRecord {
  id: string;
  executionId: string;
  nodeId: string;
  nodeType: string;
  status: NodeExecutionStatus;
  startedAt?: Date;
  completedAt?: Date;
  durationMs?: number;
  inputPayload?: unknown;
  outputPayload?: unknown;
  errorMessage?: string;
  errorDetails?: {
    message: string;
    code?: string;
    stack?: string;
  };
  retryCount: number;
}

export interface WorkflowExecutionRecord {
  id: string;
  workflowId: string;
  workflowVersionId: string;
  workspaceId: string;
  status: ExecutionStatus;
  triggerType: 'manual' | 'cron' | 'webhook' | 'telegram' | string;
  triggerPayload?: unknown;
  idempotencyKey?: string;
  startedAt?: Date;
  finishedAt?: Date;
  durationMs?: number;
  errorMessage?: string;
  errorNodeId?: string;
  retryCount?: number;
}

export type UserRole = 'OWNER' | 'ADMIN' | 'EDITOR' | 'VIEWER';

export interface EncryptedData {
  keyVersion: number;
  iv: string;       // base64
  authTag: string;  // base64
  ciphertext: string; // base64
}

export interface EncryptionService {
  encrypt(plaintext: string): Promise<EncryptedData>;
  decrypt(data: EncryptedData): Promise<string>;
}

export interface RedactionService {
  redact(obj: unknown): unknown;
}

export interface ConnectorContext {
  workspaceId: string;
  credentials?: Record<string, unknown>;
  logger: {
    info(msg: string, ...args: unknown[]): void;
    warn(msg: string, ...args: unknown[]): void;
    error(msg: string, ...args: unknown[]): void;
    debug(msg: string, ...args: unknown[]): void;
  };
  httpClient: {
    request(options: HttpRequestOptions): Promise<HttpResponse>;
  };
  fsRoot?: string;
}

export interface HttpRequestOptions {
  url: string;
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD';
  headers?: Record<string, string>;
  params?: Record<string, string | number | boolean>;
  data?: unknown;
  timeoutMs?: number;
}

export interface HttpResponse<T = unknown> {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  data: T;
}

export interface ConnectorAction<TInput = unknown, TOutput = unknown> {
  name: string;
  execute(input: TInput, ctx: ConnectorContext): Promise<TOutput>;
}

export interface ExecutionContext {
  executionId: string;
  workspaceId: string;
  workflowId: string;
  triggerPayload: unknown;
  nodeOutputs: Map<string, unknown>;
  nodeInputs: Map<string, unknown>;
  env: Record<string, string>;
}
