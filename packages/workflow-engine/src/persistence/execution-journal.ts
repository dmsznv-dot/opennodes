import type { ExecutionStatus, NodeStatus } from '@localflow/workflow-schema';

export interface CreateExecutionParams {
  id?: string;
  workspaceId: string;
  workflowId: string;
  workflowVersionId: string;
  status: ExecutionStatus;
  triggerType: string;
  triggerPayload?: unknown;
  idempotencyKey?: string;
  startedAt?: Date;
  metadata?: Record<string, unknown>;
}

export interface UpdateExecutionParams {
  status?: ExecutionStatus;
  startedAt?: Date;
  finishedAt?: Date;
  durationMs?: number;
  errorMessage?: string;
  errorNodeId?: string;
  retryCount?: number;
  metadata?: Record<string, unknown>;
}

export interface CreateNodeExecutionParams {
  id?: string;
  executionId: string;
  nodeId: string;
  nodeType: string;
  nodeName?: string;
  status: NodeStatus;
  retryCount?: number;
  inputPayload?: unknown;
  outputPayload?: unknown;
  startedAt?: Date;
  finishedAt?: Date;
  durationMs?: number;
}

export interface UpdateNodeExecutionParams {
  status?: NodeStatus;
  outputPayload?: unknown;
  errorDetails?: Record<string, unknown>;
  errorMessage?: string;
  finishedAt?: Date;
  durationMs?: number;
  retryCount?: number;
}

export interface CreateLogParams {
  executionId: string;
  nodeExecutionId?: string;
  nodeId?: string;
  level: 'trace' | 'debug' | 'info' | 'warn' | 'error';
  message: string;
  metadata?: Record<string, unknown>;
}

export interface CreateEventParams {
  executionId: string;
  eventType: string;
  nodeId?: string;
  payload?: Record<string, unknown>;
}

export interface JournalExecutionRecord {
  id: string;
  workspaceId: string;
  workflowId: string;
  workflowVersionId: string;
  status: ExecutionStatus;
  triggerType: string;
  triggerPayload?: unknown;
  idempotencyKey?: string | null;
  startedAt?: Date | null;
  finishedAt?: Date | null;
  durationMs?: number | null;
  errorMessage?: string | null;
  errorNodeId?: string | null;
  retryCount: number;
  metadata?: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface JournalNodeExecutionRecord {
  id: string;
  executionId: string;
  nodeId: string;
  nodeType: string;
  nodeName?: string | null;
  status: NodeStatus;
  retryCount: number;
  inputPayload?: unknown;
  outputPayload?: unknown;
  errorDetails?: Record<string, unknown> | null;
  errorMessage?: string | null;
  startedAt?: Date | null;
  finishedAt?: Date | null;
  durationMs?: number | null;
  createdAt: Date;
  updatedAt?: Date;
}

export interface JournalEventRecord {
  id: string;
  executionId: string;
  eventType: string;
  nodeId?: string | null;
  payload?: Record<string, unknown> | null;
  createdAt: Date;
}

export interface ExecutionJournal {
  findExecutionById(executionId: string): Promise<JournalExecutionRecord | undefined>;
  findExecutionByIdempotencyKey(
    workspaceId: string,
    workflowId: string,
    idempotencyKey: string
  ): Promise<JournalExecutionRecord | undefined>;
  createExecution(params: CreateExecutionParams): Promise<JournalExecutionRecord>;
  updateExecution(
    executionId: string,
    params: UpdateExecutionParams
  ): Promise<JournalExecutionRecord>;

  findNodeExecutions(executionId: string): Promise<JournalNodeExecutionRecord[]>;
  findNodeExecution(
    executionId: string,
    nodeId: string
  ): Promise<JournalNodeExecutionRecord | undefined>;
  createNodeExecution(params: CreateNodeExecutionParams): Promise<JournalNodeExecutionRecord>;
  updateNodeExecution(
    id: string,
    params: UpdateNodeExecutionParams
  ): Promise<JournalNodeExecutionRecord>;

  createLog(params: CreateLogParams): Promise<void>;
  createEvent(params: CreateEventParams): Promise<void>;
  findEvents(executionId: string): Promise<JournalEventRecord[]>;
}
