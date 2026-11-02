import type { PrimitiveContext, PrimitiveDefinition, PrimitiveExecutionResult } from './types.js';

export interface FilterConfig {
  items?: unknown[] | unknown;
  predicate?: string | boolean;
}

export function executeFilter(
  config: FilterConfig,
  context: PrimitiveContext
): PrimitiveExecutionResult {
  let rawItems = config?.items;
  if (typeof rawItems === 'string' && rawItems.includes('{{')) {
    rawItems = context.evaluateExpression(rawItems);
  }
  const items: unknown[] = Array.isArray(rawItems)
    ? rawItems
    : rawItems !== undefined && rawItems !== null
      ? [rawItems]
      : [];

  const passed: unknown[] = [];
  const discarded: unknown[] = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    let pass = false;
    if (config?.predicate === undefined) {
      pass = Boolean(item);
    } else if (typeof config.predicate === 'boolean') {
      pass = config.predicate;
    } else if (typeof config.predicate === 'string') {
      const evalRes = context.evaluateExpression(config.predicate, {
        $item: item,
        item,
        $index: i,
        index: i,
      });
      pass = Boolean(evalRes);
    } else {
      pass = Boolean(config.predicate);
    }

    if (pass) {
      passed.push(item);
    } else {
      discarded.push(item);
    }
  }

  const activeHandles = ['passed', 'main'];
  if (discarded.length > 0) {
    activeHandles.push('discarded');
  }

  return {
    output: { passed, discarded, count: passed.length },
    activeHandles,
  };
}

export const filterPrimitive: PrimitiveDefinition<FilterConfig> = {
  type: 'primitive.filter',
  displayName: 'Filter',
  description: 'Filters an array of items based on a predicate expression.',
  inputPorts: [{ id: 'main', name: 'Input', type: 'json', direction: 'input', required: false }],
  outputPorts: [
    { id: 'passed', name: 'Passed', type: 'json', direction: 'output', required: false },
    { id: 'discarded', name: 'Discarded', type: 'json', direction: 'output', required: false },
  ],
  execute: executeFilter,
};
