import type { PrimitiveContext, PrimitiveDefinition, PrimitiveExecutionResult } from './types.js';

export interface MapConfig {
  transform?: unknown;
  [key: string]: unknown;
}

function deepEvaluateValue(val: unknown, context: PrimitiveContext): unknown {
  if (typeof val === 'string') {
    return val.includes('{{') ? context.evaluateExpression(val) : val;
  }
  if (Array.isArray(val)) {
    return val.map((item) => deepEvaluateValue(item, context));
  }
  if (val !== null && typeof val === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
      out[k] = deepEvaluateValue(v, context);
    }
    return out;
  }
  return val;
}

export function executeMap(
  config: MapConfig,
  context: PrimitiveContext
): PrimitiveExecutionResult {
  const target = config?.transform !== undefined ? config.transform : config;
  const output = deepEvaluateValue(target, context);
  return {
    output,
    activeHandles: ['main'],
  };
}

export const mapPrimitive: PrimitiveDefinition<MapConfig> = {
  type: 'primitive.map',
  aliases: ['primitive.transform'],
  displayName: 'Map / Transform',
  description: 'Transforms objects and arrays using template expressions.',
  inputPorts: [{ id: 'main', name: 'Input', type: 'any', direction: 'input', required: false }],
  outputPorts: [{ id: 'main', name: 'Output', type: 'any', direction: 'output', required: false }],
  execute: executeMap,
};
