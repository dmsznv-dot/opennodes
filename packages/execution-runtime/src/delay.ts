import {
  ExecutionSuspendedSignal,
  type ExecutionJournal,
  type NodeExecutor,
} from '@localflow/workflow-engine';

/** Longest single wait (setTimeout and practical sanity limit). */
const MAX_DELAY_MS = 365 * 24 * 60 * 60 * 1000;

const UNITS: Array<[key: string, ms: number]> = [
  ['delayMs', 1],
  ['delaySeconds', 1000],
  ['delayMinutes', 60_000],
  ['delayHours', 3_600_000],
  ['delayDays', 86_400_000],
];

export function parseDelayMs(config: Record<string, unknown>): number {
  for (const [key, unit] of UNITS) {
    const raw = config[key];
    if (raw === undefined || raw === null || raw === '') continue;
    const n = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isFinite(n) || n < 0) {
      throw new Error(`Delay "${key}" must be a non-negative number, got ${JSON.stringify(raw)}.`);
    }
    const ms = n * unit;
    if (ms > MAX_DELAY_MS) throw new Error('Delay cannot be longer than 365 days.');
    return ms;
  }
  return 0;
}

export interface DelayExecutorOptions {
  journal: ExecutionJournal;
  /**
   * Waits up to this long happen in the worker; longer ones suspend the run (status
   * WAITING), free the worker and resume from the queue — surviving restarts.
   */
  inlineMaxMs: number;
}

/**
 * Real delays. The packaged `primitive.delay` sleeps at most 50 ms whatever the
 * configured duration, so "wait 2 hours" used to continue immediately.
 */
export function buildDelayExecutors(options: DelayExecutorOptions): Record<string, NodeExecutor> {
  const executor: NodeExecutor = {
    async execute(node, config, step) {
      const ms = parseDelayMs(config);
      const row = await options.journal.findNodeExecution(step.executionId, node.id);
      const waitingUntil = (row?.outputPayload as { waitingUntil?: string } | null | undefined)
        ?.waitingUntil;

      if (waitingUntil) {
        const due = Date.parse(waitingUntil);
        if (Date.now() < due - 250) throw new ExecutionSuspendedSignal(new Date(due));
        return {
          output: { delayedMs: ms, resumedAt: new Date().toISOString() },
          activeOutputs: ['main'],
        };
      }

      if (ms > options.inlineMaxMs) {
        throw new ExecutionSuspendedSignal(new Date(Date.now() + ms));
      }

      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, ms);
        step.cancellationToken?.onCancelled(() => {
          clearTimeout(timer);
          resolve();
        });
      });
      return {
        output: { delayedMs: ms, resumedAt: new Date().toISOString() },
        activeOutputs: ['main'],
      };
    },
  };
  return { 'primitive.delay': executor, 'primitive.wait': executor };
}
