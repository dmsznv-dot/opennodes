import type { PrimitiveContext, PrimitiveDefinition, PrimitiveExecutionResult } from './types.js';

export interface ForEachConfig {
  items?: unknown[] | unknown;
}

export function executeForEach(
  config: ForEachConfig,
  context: PrimitiveContext
): PrimitiveExecutionResult {
  let rawItems = config?.items;
  if (typeof rawItems === 'string' && rawItems.includes('{{')) {
    rawItems = context.evaluateExpression(rawItems);
  }
  const items = Array.isArray(rawItems) ? rawItems : [];

  const processedItems = items.map((item, index) => ({
    item,
    index,
    processed: true,
  }));

  return {
    output: { items: processedItems, total: items.length },
    activeHandles: ['main', 'done', 'item'],
  };
}

export const forEachPrimitive: PrimitiveDefinition<ForEachConfig> = {
  type: 'primitive.forEach',
  displayName: 'For Each',
  description: 'Iterates sequentially over a collection of items.',
  inputPorts: [{ id: 'main', name: 'Input', type: 'json', direction: 'input', required: false }],
  outputPorts: [
    { id: 'item', name: 'Item', type: 'any', direction: 'output', required: false },
    { id: 'done', name: 'Done', type: 'json', direction: 'output', required: false },
    { id: 'main', name: 'Main', type: 'json', direction: 'output', required: false },
  ],
  execute: executeForEach,
};
