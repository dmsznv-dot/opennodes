import type { PrimitiveContext, PrimitiveDefinition, PrimitiveExecutionResult } from './types.js';

export interface DelayConfig {
  delayMs?: number;
  delaySeconds?: number;
}

export async function executeDelay(
  config: DelayConfig,
  _context: PrimitiveContext,
  options?: { sleepFn?: (ms: number) => Promise<void> }
): Promise<PrimitiveExecutionResult> {
  let ms = 0;
  if (typeof config?.delayMs === 'number') {
    ms = config.delayMs;
  } else if (typeof config?.delaySeconds === 'number') {
    ms = config.delaySeconds * 1000;
  }

  if (ms < 0 || Number.isNaN(ms)) {
    ms = 0;
  }

  if (ms > 0) {
    const sleep =
      options?.sleepFn ?? ((d: number) => new Promise<void>((res) => setTimeout(res, Math.min(d, 50))));
    await sleep(ms);
  }

  return {
    output: { delayedMs: ms, resumedAt: new Date().toISOString() },
    activeHandles: ['main'],
  };
}

export const delayPrimitive: PrimitiveDefinition<DelayConfig> = {
  type: 'primitive.delay',
  aliases: ['primitive.wait'],
  displayName: 'Delay / Wait',
  description: 'Pauses workflow execution for a specified duration.',
  inputPorts: [{ id: 'main', name: 'Input', type: 'any', direction: 'input', required: false }],
  outputPorts: [{ id: 'main', name: 'Output', type: 'any', direction: 'output', required: false }],
  execute: (config, context) => executeDelay(config, context),
};
