import type { WorkflowNode } from '@localflow/workflow-schema';
import type { SafeHttpClient } from '@localflow/shared';
import type { CancellationToken, ExpressionScope } from './execution-context.js';

export interface StepLogger {
  info(message: string, metadata?: Record<string, unknown>): void;
  warn(message: string, metadata?: Record<string, unknown>): void;
  error(message: string, metadata?: Record<string, unknown>): void;
  debug(message: string, metadata?: Record<string, unknown>): void;
}

export interface StepExecutionContext {
  readonly executionId: string;
  readonly workspaceId: string;
  readonly workflowId: string;
  readonly nodeId: string;
  readonly nodeType: string;
  readonly credentials?: Record<string, unknown>;
  readonly fsRoot?: string;
  readonly logger: StepLogger;
  readonly httpClient?: SafeHttpClient;
  readonly expressionScope: ExpressionScope;
  readonly cancellationToken?: CancellationToken;
}

export interface NodeExecutionResult {
  output: unknown;
  activeOutputs?: string[];
}

export interface NodeExecutor {
  execute(
    node: WorkflowNode,
    evaluatedConfig: Record<string, unknown>,
    context: StepExecutionContext
  ): Promise<NodeExecutionResult> | NodeExecutionResult;
}
