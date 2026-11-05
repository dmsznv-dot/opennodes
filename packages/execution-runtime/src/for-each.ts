import { ActionExecutionError } from '@localflow/connector-sdk';
import { ExpressionEvaluator, type NodeExecutor } from '@localflow/workflow-engine';
import { toText } from './text.js';
import { shortText } from './connectors.js';

/** At most this many items per run, whatever the step says: a feed must not flood a channel. */
export const FOR_EACH_MAX = 50;
const FOR_EACH_DEFAULT = 10;

/** Step types that can repeat for each item of a list (a message per feed item, …). */
export const FOR_EACH_TYPES = [
  'core.telegramBot',
  'telegram.sendFile',
  'core.smtp',
  'slack.sendMessage',
  'discord.sendMessage',
  'core.outgoingWebhook',
  'core.httpRequest',
  'ai.openai',
  'ai.ollama',
  'ai.process',
  'ai.review',
  'ai.classify',
  'text.compose',
  'text.format',
];

/** Messengers limit how fast a bot may post into one chat. */
const PAUSE_MS: Record<string, number> = {
  'core.telegramBot': 1_500,
  'telegram.sendFile': 1_500,
  'slack.sendMessage': 1_000,
  'discord.sendMessage': 1_000,
  'core.smtp': 500,
};

const evaluator = new ExpressionEvaluator();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** What one repetition "gave": the text of an AI answer, a composed text, a message id… */
function mainValue(output: unknown): unknown {
  if (!isObject(output)) return output;
  for (const key of ['text', 'result', 'category', 'messageId', 'status']) {
    if (output[key] !== undefined && output[key] !== null) return output[key];
  }
  return '';
}

/**
 * An answer split into its first line and the rest — an AI step asked to “translate” or
 * “rewrite” usually puts the new title first. A one-line answer is all body.
 */
export function splitResult(text: string): { resultTitle: string; resultBody: string } {
  const lines = text.split('\n');
  const i = lines.findIndex((l) => l.trim());
  const rest =
    i < 0
      ? ''
      : lines
          .slice(i + 1)
          .join('\n')
          .trim();
  const first = i < 0 ? '' : lines[i]!.trim();
  if (!rest || first.length > 200) return { resultTitle: '', resultBody: text.trim() };
  const title = first
    .replace(/^#{1,6}\s+/, '')
    .replace(/^\*\*(.+)\*\*$/, '$1')
    .replace(/^__(.+)__$/, '$1')
    .replace(/^(заголовок|title)\s*:\s*/i, '')
    .trim();
  return { resultTitle: title, resultBody: rest };
}

/**
 * An item after a step worked on it: the item's own fields, the step's `result`, and what a
 * post needs — `postTitle` (the step's title line, else the item's own title) and
 * `postText` (the step's text without that title line). A next step keeps going per item
 * with everything in one place: the picture and link of the item, the words of the step.
 */
export function postFields(item: unknown, result: string): Record<string, unknown> {
  const base = isObject(item) ? item : { value: item };
  const parts = splitResult(result);
  const postText = parts.resultTitle ? parts.resultBody : result;
  return {
    ...base,
    result,
    ...parts,
    postTitle: parts.resultTitle || String(base.postTitle ?? base.title ?? ''),
    postText,
    postSummary: shortText(postText),
  };
}

function asList(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string' && value.trim().startsWith('[')) {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      /* not a list */
    }
  }
  return [];
}

/**
 * "For each item": with `forEach` set to a list (e.g. the items of an RSS step), the step
 * runs once per item — its fields are worked out again for every item, with `$item` (and
 * `$index`) pointing at it. The output keeps every result: `items` are the list's items
 * with a `result` each (so a next step can go on per item), `results` / `text` are all
 * results as one text. Without `forEach` the step runs once, as before.
 */
export function withForEach(
  inner: NodeExecutor,
  nodeType: string,
  options: { pauseMs?: number } = {}
): NodeExecutor {
  const pause = options.pauseMs ?? PAUSE_MS[nodeType] ?? 0;
  return {
    async execute(node, config, step) {
      const raw = node.data.config ?? {};
      const source = raw.forEach;
      if (source === undefined || source === null || String(source).trim() === '') {
        return inner.execute(node, config, step);
      }
      const all = asList(config.forEach);
      const limit = Math.min(
        Math.max(Number(config.forEachLimit) || FOR_EACH_DEFAULT, 1),
        FOR_EACH_MAX
      );
      const items = all.slice(0, limit);
      const { forEach: _f, forEachLimit: _l, ...template } = raw;
      const outputs: unknown[] = [];
      // Items the step itself held back (a review that failed with “stop”): they do not go on.
      const held = new Set<number>();

      for (const [i, item] of items.entries()) {
        if (step.cancellationToken?.isCancelled) break;
        if (i && pause) await sleep(pause);
        const scope = {
          ...(step.expressionScope as Record<string, unknown>),
          $item: item,
          item,
          $index: i,
          index: i,
        };
        const perItem = {
          ...(evaluator.evaluateObject(template, scope) as Record<string, unknown>),
          // Steps may answer differently per item (an AI step puts a title line first).
          __forEach: true,
        };
        try {
          const res = await inner.execute(
            { ...node, data: { ...node.data, config: template } },
            perItem,
            { ...step, expressionScope: scope as unknown as typeof step.expressionScope }
          );
          outputs.push(res.output);
          if (Array.isArray(res.activeOutputs) && res.activeOutputs.length === 0) held.add(i);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          throw new ActionExecutionError(
            `Item ${i + 1} of ${items.length}: ${message}${i ? ` (${i} done before it)` : ''}`,
            'forEach',
            nodeType
          );
        }
      }

      const results = outputs.map((o) => toText(mainValue(o)));
      const going = (_: unknown, i: number) => !held.has(i);
      const passed = items
        .slice(0, outputs.length)
        .map((item, i) => postFields(item, results[i] ?? ''));
      const allHeld = outputs.length > 0 && held.size === outputs.length;
      return {
        output: {
          count: outputs.length - held.size,
          total: all.length,
          skipped: all.length - items.length,
          items: passed.filter(going),
          results: results.filter(going).join('\n\n'),
          text: results.filter(going).join('\n\n'),
          outputs,
          ...(held.size
            ? { held: held.size, heldItems: passed.filter((_, i) => held.has(i)) }
            : {}),
          ...(allHeld ? { stopped: true } : {}),
        },
        activeOutputs: allHeld ? [] : ['main'],
      };
    },
  };
}
