import type { NodeExecutor } from '@localflow/workflow-engine';
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
  };
}
