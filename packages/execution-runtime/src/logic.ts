import type { NodeExecutor } from '@localflow/workflow-engine';

/** Comparisons offered by the editor's "Continue only if" step. */
export const CONDITION_OPERATORS = ['contains', 'equals', 'gte', 'notEmpty'] as const;

function asText(v: unknown): string {
  if (v === null || v === undefined) return '';
  return typeof v === 'object' ? JSON.stringify(v) : String(v);
}

export function evaluateCondition(left: unknown, operator: string, right: unknown): boolean {
  switch (operator) {
    case 'contains':
      return asText(left).toLowerCase().includes(asText(right).toLowerCase());
    case 'equals':
      return asText(left).trim().toLowerCase() === asText(right).trim().toLowerCase();
    case 'gte': {
      const a = Number(asText(left).replace(',', '.'));
      const b = Number(asText(right).replace(',', '.'));
      return Number.isFinite(a) && Number.isFinite(b) && a >= b;
    }
    case 'notEmpty':
      // An empty list or object counts as empty too.
      if (Array.isArray(left)) return left.length > 0;
      if (left && typeof left === 'object') return Object.keys(left).length > 0;
      return asText(left).trim() !== '';
    default:
      throw new Error(
        `Unknown comparison "${operator}". Use one of: ${CONDITION_OPERATORS.join(', ')}.`
      );
  }
}

/**
 * Small steps of the editor that have no packaged primitive with the same meaning:
 * `logic.condition` stops the flow below it unless the condition holds, and
 * `text.compose` turns a template into `{ text }`.
 */
export function buildLogicExecutors(): Record<string, NodeExecutor> {
  return {
    'logic.condition': {
      async execute(_node, config) {
        const operator = String(config.operator ?? 'contains');
        const passed = evaluateCondition(config.left, operator, config.right);
        return {
          output: { passed, left: config.left, operator, right: config.right ?? null },
          // No active output: the steps below are skipped, the run still succeeds.
          activeOutputs: passed ? ['main'] : [],
        };
      },
    },
    'text.compose': {
      async execute(_node, config) {
        return { output: { text: asText(config.template) }, activeOutputs: ['main'] };
      },
    },
  };
}
