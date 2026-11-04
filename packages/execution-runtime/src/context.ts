import { ActionExecutionError } from '@localflow/connector-sdk';
import { ExpressionEvaluator, type NodeExecutor } from '@localflow/workflow-engine';
import { toText } from './text.js';

/**
 * Context steps: settings that AI steps use, not actions. A context step makes no
 * external call and has no side effect; it only turns its fields into a block of text the
 * AI step puts into its request. The editor builds the same text for its preview
 * (docs/catalog.js `voiceText`), so what the person sees is what the model gets.
 */

const line = (label: string, value: unknown) => {
  const v = toText(value).trim();
  return v ? `- ${label}: ${v}` : '';
};

const EMOJI: Record<string, string> = {
  none: 'no emoji',
  few: 'one or two emoji at most',
  ok: 'emoji are fine where they help',
};

/** A brand voice as rules for the model: who we write for, how, what never to do, examples. */
export function voiceText(config: Record<string, unknown>): string {
  const name = toText(config.name).trim() || 'Brand voice';
  const examples = toText(config.examples)
    .split(/\n\s*---+\s*\n|\n{3,}/)
    .map((x) => x.trim())
    .filter(Boolean);
  const rules = [
    line('Language of the answer', config.language),
    line('Audience', config.audience),
    line('Character', config.tone),
    line('Write like this', config.writeLike),
    line('Never use', config.avoid),
    line('Length', config.length),
    line('Terms to use', config.terms),
    line('Call to action', config.cta),
    config.emoji && EMOJI[String(config.emoji)] ? `- Emoji: ${EMOJI[String(config.emoji)]}` : '',
  ].filter(Boolean);
  return [
    `Brand voice “${name}”:`,
    ...rules,
    ...(examples.length
      ? ['Examples of texts written in this voice:', ...examples.map((e) => `---\n${e}`), '---']
      : []),
  ].join('\n');
}

const evaluator = new ExpressionEvaluator();
const VAR_RE = /\{\{\s*([\s\S]+?)\s*\}\}/g;

/** The data a template variable comes from: `$item`, `$trigger` or `$nodes.<id>`. */
function variableRoot(expr: string): string | null {
  const m = /^(\$nodes\.[\w-]+|\$item|\$trigger|\$index)\b/.exec(expr.trim());
  return m ? m[1]! : null;
}

/** A Prompt Template as the context step passes it on: the text with its variables unfilled. */
export interface PromptRef {
  template: string;
  name: string;
  version: unknown;
}

export function readPrompt(v: unknown): PromptRef | null {
  // Plain text (an expression that gave a string) is a template without a name.
  if (typeof v === 'string') return v.trim() ? { template: v, name: '', version: null } : null;
  if (!v || typeof v !== 'object') return null;
  const o = v as Partial<PromptRef>;
  return typeof o.template === 'string' && o.template.trim()
    ? { template: o.template, name: String(o.name ?? ''), version: o.version ?? null }
    : null;
}

/**
 * Fill a template's variables where it is used — in the AI step, so “for each item” fills
 * them for every item. A variable whose step (or item) is not there is an error that names
 * it; a field that is simply empty in one item stays empty.
 */
export function fillPrompt(p: PromptRef, scope: Record<string, unknown>): string {
  for (const m of p.template.matchAll(VAR_RE)) {
    const root = variableRoot(m[1]!);
    if (root && evaluator.evaluate(`{{ ${root} }}`, scope) === undefined) {
      throw new ActionExecutionError(
        `Prompt Template “${p.name || 'template'}”: no data for {{ ${m[1]} }} — ${
          root === '$item'
            ? 'it uses the data of each item; set “for each item” on this AI step'
            : 'the step it comes from is not before this one or has not run'
        }.`,
        'prompt',
        'context.prompt'
      );
    }
  }
  return toText(evaluator.evaluate(p.template, scope)).trim();
}

export function buildContextExecutors(): Record<string, NodeExecutor> {
  return {
    'context.voice': {
      async execute(_node, config) {
        const voice = voiceText(config);
        return {
          output: {
            voice,
            name: toText(config.name).trim(),
            version: config.presetVersion ?? null,
            chars: voice.length,
          },
          activeOutputs: ['main'],
        };
      },
    },
    // The template is passed on as written: its variables are filled in the AI step that
    // uses it (once, or for every item), not here.
    'context.prompt': {
      async execute(node) {
        const raw = (node.data.config ?? {}) as Record<string, unknown>;
        const template = toText(raw.template).trim();
        if (!template)
          throw new ActionExecutionError(
            'Prompt Template: write the instruction in “Template”.',
            'prompt',
            'context.prompt'
          );
        return {
          output: {
            template,
            name: toText(raw.name).trim(),
            description: toText(raw.description).trim(),
            version: raw.presetVersion ?? null,
            variables: [...template.matchAll(VAR_RE)].map((m) => m[1]),
          },
          activeOutputs: ['main'],
        };
      },
    },
  };
}
