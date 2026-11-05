import { ActionExecutionError } from '@localflow/connector-sdk';
import type { NodeExecutor } from '@localflow/workflow-engine';
import { toText } from './text.js';

/** The reviewer's own rules — it judges, it never rewrites. */
export const REVIEW_RULES =
  'You review a text for an automation before it is published. You never rewrite the text. Judge it against the brand voice and the extra rules below, and list concrete problems (quote the words). Write the problems in the language of the text. Reply with JSON only, nothing else: {"score": <0-10, 10 = fully matches>, "issues": ["<problem>", ...]}';

export function reviewSystem(voice: string, criteria: string): string {
  return [
    REVIEW_RULES,
    voice.trim()
      ? `\n${voice.trim()}`
      : '\nNo brand voice is given: judge clarity, mistakes and the extra rules.',
    criteria.trim() ? `\nExtra rules:\n${criteria.trim()}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

/** The model's verdict, read from its reply; null when the reply holds no verdict. */
export function readVerdict(reply: string): { score: number; issues: string[] } | null {
  const m = /\{[\s\S]*\}/.exec(reply);
  if (!m) return null;
  try {
    const v = JSON.parse(m[0]) as { score?: unknown; issues?: unknown };
    const score = Number(v.score);
    if (!Number.isFinite(score)) return null;
    const issues = Array.isArray(v.issues)
      ? v.issues.map((x) => toText(x).trim()).filter(Boolean)
      : [];
    return { score: Math.min(Math.max(score, 0), 10), issues };
  } catch {
    return null;
  }
}

function readVoiceText(v: unknown): string {
  if (v && typeof v === 'object' && typeof (v as { voice?: unknown }).voice === 'string')
    return (v as { voice: string }).voice;
  const text = toText(v).trim();
  return text === '{}' ? '' : text;
}

/**
 * "Check the text against the brand voice": a score and a list of problems, the text
 * itself passed on unchanged. With “stop if it fails” the steps below do not run when the
 * score is under the bar, so a text that misses the voice is never sent.
 */
export function buildReviewExecutor(chat: NodeExecutor): NodeExecutor {
  return {
    async execute(node, config, step) {
      const text = toText(config.text).trim();
      if (!text)
        throw new ActionExecutionError(
          'Text review: there is no text to check — insert it in “Text”.',
          'review',
          'ai.review'
        );
      const voice = readVoiceText(config.voice);
      const bar = Math.min(Math.max(Number(config.passScore) || 7, 0), 10);
      const reply = toText(
        (
          (
            await chat.execute(
              { ...node, type: 'ai.openai' },
              {
                model: config.model,
                system: reviewSystem(voice, toText(config.criteria)),
                prompt: `Text to review:\n---\n${text}\n---\nReply with the JSON only.`,
              },
              step
            )
          ).output as { text?: unknown }
        )?.text
      );
      const verdict = readVerdict(reply);
      if (!verdict)
        throw new ActionExecutionError(
          `Text review: the model did not give a score (it replied: “${reply.slice(0, 200)}”). Try another model.`,
          'review',
          'ai.review'
        );
      const passed = verdict.score >= bar;
      const stop = !passed && (config.stopIfFails === true || config.stopIfFails === 'true');
      const voiceName =
        config.voice && typeof config.voice === 'object'
          ? toText((config.voice as { name?: unknown }).name)
          : '';
      return {
        output: {
          text,
          passed,
          score: verdict.score,
          passScore: bar,
          issues: verdict.issues,
          report: verdict.issues.length ? verdict.issues.map((i) => `• ${i}`).join('\n') : '',
          ...(voiceName ? { voice: voiceName } : {}),
          ...(stop ? { stopped: true } : {}),
        },
        activeOutputs: stop ? [] : ['main'],
      };
    },
  };
}
