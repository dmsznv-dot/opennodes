import type { PrimitiveContext, PrimitiveDefinition, PrimitiveExecutionResult } from './types.js';

export interface MergeConfig {
  mode?: 'array' | 'object' | 'first';
}

export function executeMerge(
  config: MergeConfig,
  context: PrimitiveContext
): PrimitiveExecutionResult {
  const incomingEdges = context.incomingEdges ?? [];
  const incomingOutputs: unknown[] = [];

  for (const edge of incomingEdges) {
    if (context.nodeOutputs.has(edge.source)) {
      incomingOutputs.push(context.nodeOutputs.get(edge.source));
    }
  }

  if (config?.mode === 'first') {
    return {
      output: { merged: incomingOutputs[0] ?? null, count: incomingOutputs.length },
      activeHandles: ['main'],
    };
  }

  if (config?.mode === 'object') {
    const mergedObj: Record<string, unknown> = {};
    for (const item of incomingOutputs) {
      if (item && typeof item === 'object' && !Array.isArray(item)) {
        Object.assign(mergedObj, item);
      }
    }
    return {
      output: { merged: mergedObj, count: incomingOutputs.length },
      activeHandles: ['main'],
    };
  }

  return {
    output: { merged: incomingOutputs, count: incomingOutputs.length },
    activeHandles: ['main'],
  };
}

export const mergePrimitive: PrimitiveDefinition<MergeConfig> = {
  type: 'primitive.merge',
  displayName: 'Merge',
  description: 'Aggregates outputs from multiple converging workflow branches.',
  inputPorts: [{ id: 'main', name: 'Input', type: 'any', direction: 'input', required: false }],
  outputPorts: [{ id: 'main', name: 'Output', type: 'json', direction: 'output', required: false }],
  execute: executeMerge,
};
