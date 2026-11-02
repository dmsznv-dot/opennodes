import type { PrimitiveContext, PrimitiveDefinition, PrimitiveExecutionResult } from './types.js';

export interface BranchIfConfig {
  condition?: unknown;
}

export function executeBranchIf(
  config: BranchIfConfig,
  context: PrimitiveContext
): PrimitiveExecutionResult {
  let rawCondition = config?.condition;
  if (typeof rawCondition === 'string' && rawCondition.includes('{{')) {
    rawCondition = context.evaluateExpression(rawCondition);
  }
  const isTruthy = Boolean(rawCondition);
  return {
    output: { conditionResult: isTruthy },
    activeHandles: isTruthy ? ['true'] : ['false'],
  };
}

export const branchIfPrimitive: PrimitiveDefinition<BranchIfConfig> = {
  type: 'primitive.branchIf',
  aliases: ['primitive.if'],
  displayName: 'Branch / IF',
  description: 'Routes workflow execution based on a boolean condition expression.',
  inputPorts: [{ id: 'main', name: 'Input', type: 'any', direction: 'input', required: false }],
  outputPorts: [
    { id: 'true', name: 'True', type: 'any', direction: 'output', required: false },
    { id: 'false', name: 'False', type: 'any', direction: 'output', required: false },
  ],
  execute: executeBranchIf,
};
