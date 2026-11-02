import { LocalFlowError } from '@localflow/shared';

export class EngineError extends LocalFlowError {
  constructor(message: string, code = 'ERR_ENGINE_EXECUTION', statusCode = 500, details?: Record<string, unknown>) {
    super(message, code, statusCode, details);
    this.name = 'EngineError';
  }
}

export class StepExecutionError extends EngineError {
  constructor(
    public readonly nodeId: string,
    message: string,
    code = 'ERR_STEP_EXECUTION',
    details?: Record<string, unknown>
  ) {
    super(message, code, 500, { ...details, nodeId });
    this.name = 'StepExecutionError';
  }
}

export class ExecutionTimeoutError extends EngineError {
  constructor(executionId: string, timeoutMs: number) {
    super(
      `ERR_EXECUTION_TIMEOUT: Workflow execution "${executionId}" exceeded timeout of ${timeoutMs}ms`,
      'ERR_EXECUTION_TIMEOUT',
      408,
      { executionId, timeoutMs }
    );
    this.name = 'ExecutionTimeoutError';
  }
}

export class CycleDetectedError extends EngineError {
  constructor(public readonly cycleNodes: string[], public readonly cyclePath: string[]) {
    super(
      `ERR_WORKFLOW_CYCLE_DETECTED: Workflow graph contains a cycle involving nodes: ${cycleNodes.join(' -> ')}`,
      'ERR_WORKFLOW_CYCLE_DETECTED',
      400,
      { cycleNodes, cyclePath }
    );
    this.name = 'CycleDetectedError';
  }
}

export class UnknownNodeTypeError extends EngineError {
  constructor(nodeType: string) {
    super(
      `No executor is registered for node type "${nodeType}", so this step cannot run.`,
      'ERR_UNKNOWN_NODE_TYPE',
      422,
      { nodeType }
    );
    this.name = 'UnknownNodeTypeError';
  }
}

/**
 * Thrown by a step to pause the run until `resumeAt` (e.g. a long delay). The engine
 * marks the step PENDING and the execution WAITING instead of failing; the runtime
 * re-enqueues the run, and on resume the step runs again and can complete.
 */
export class ExecutionSuspendedSignal extends Error {
  constructor(public readonly resumeAt: Date) {
    super(`Execution suspended until ${resumeAt.toISOString()}`);
    this.name = 'ExecutionSuspendedSignal';
  }
}
