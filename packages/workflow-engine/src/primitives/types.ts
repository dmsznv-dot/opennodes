import type { NodePort, WorkflowEdge } from '@localflow/workflow-schema';

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
  execute(
    config: TConfig,
    context: PrimitiveContext
  ): Promise<PrimitiveExecutionResult> | PrimitiveExecutionResult;
}
