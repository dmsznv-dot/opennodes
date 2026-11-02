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
