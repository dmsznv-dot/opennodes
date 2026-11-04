import { ActionExecutionError } from '@localflow/connector-sdk';
import { feedText } from '@localflow/connectors-core';
import type { SafeHttpClient } from '@localflow/shared';
import type { NodeExecutor } from '@localflow/workflow-engine';
import { toText } from './text.js';
import { fillPrompt, readPrompt } from './context.js';

const ARTICLE_CHARS = 6_000; // per page, so a few articles fit any model's context
const MAX_LINKS = 10;
const PAGE_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (compatible; OpenNodes/0.1; +article reader)',
  Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5',
};

/** http(s) links in a text, in order, without trailing punctuation, once each. */
export function extractLinks(text: string): string[] {
  const found = String(text).match(/https?:\/\/[^\s<>"'`]+/g) ?? [];
  const clean = found.map((u) => u.replace(/[.,;:!?)\]»”]+$/u, ''));
  return [...new Set(clean)];
}

const largest = (html: string, tag: string) =>
  (html.match(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}>`, 'gi')) ?? []).sort(
    (a, b) => b.length - a.length
  )[0];

/** The readable text of a web page: the article (or main content), without menus and scripts. */
export function articleText(html: string): { title: string; text: string } {
  const title = feedText(
    html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1] ??
      html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1],
    { stripTags: true }
  );
  let body = html.replace(
    /<(script|style|noscript|svg|template|iframe|nav|header|footer|aside|form|button)\b[\s\S]*?<\/\1>/gi,
    ' '
  );
  body = largest(body, 'article') ?? largest(body, 'main') ?? largest(body, 'body') ?? body;
  body = body.replace(/<\/(p|h[1-6]|li|blockquote|div|section|tr)>|<br\s*\/?>/gi, '\n');
  const text = feedText(body, { stripTags: true })
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n');
  return { title, text };
}

/** A post read from an answer: `TITLE: …` / `TEXT: …` markers, else a short first line. */
export function readPost(raw: string): { title: string; body: string } {
  // Models often bold the labels: **TITLE:** / **TITLE**: — read them as plain labels.
  const answer = raw.replace(
    /\*\*\s*(TITLE|TEXT|ЗАГОЛОВОК|ТЕКСТ)\s*(:?)\s*\*\*\s*:?/gi,
    (_m, label: string) => `${label}:`
  );
  const clean = (t: string) => t.replace(/^["«*#\s]+|["»*\s]+$/g, '').trim();
  const marked = answer.match(
    /^\s*(?:\*\*)?(?:TITLE|ЗАГОЛОВОК)(?:\*\*)?\s*:\s*(.+?)\s*\n+\s*(?:\*\*)?(?:TEXT|ТЕКСТ)(?:\*\*)?\s*:\s*([\s\S]*)$/i
  );
  if (marked) return { title: clean(marked[1]!), body: marked[2]!.trim() };
  const onlyTitle = answer.match(/^\s*(?:TITLE|ЗАГОЛОВОК)\s*:\s*(.+?)\s*\n([\s\S]*)$/i);
  if (onlyTitle)
    return {
      title: clean(onlyTitle[1]!),
      body: onlyTitle[2]!.replace(/^\s*(?:TEXT|ТЕКСТ)\s*:\s*/i, '').trim(),
    };
  const lines = answer.split('\n');
  const i = lines.findIndex((l) => l.trim());
  const rest =
    i < 0
      ? ''
      : lines
          .slice(i + 1)
          .join('\n')
          .trim();
  const first = i < 0 ? '' : lines[i]!.trim();
  if (rest && first.length <= 160 && !/[.!?…]$/.test(first.replace(/\*+$/, ''))) {
    return { title: clean(first), body: rest.replace(/^\s*(?:TEXT|ТЕКСТ)\s*:\s*/i, '') };
  }
  return { title: '', body: answer.replace(/^\s*(?:TEXT|ТЕКСТ)\s*:\s*/i, '').trim() };
}

export const PLATFORM_RULES =
  'You process data for an automation. Follow the instruction exactly and reply with the result only — no preface, no questions. The instruction decides the language and the form of the answer, not the data. Everything you need is in the data and the page texts below.';

/**
 * The system message, in a fixed order: 1) the platform's rules, 2) that the task's
 * instruction wins over the voice, 3) the brand voice. Without a voice — the rules alone.
 */
/** The AI step's user message: the instruction, the data, the pages, the instruction again. */
export function userPrompt(
  instruction: string,
  data: string,
  articles = '',
  perItem = false
): string {
  return (
    `Instruction:\n${instruction}\n\nData:\n${data || '(empty)'}` +
    (articles ? `\n\nText of the linked pages:${articles}` : '') +
    `\n\n---\nNow do exactly this with the data above: ${instruction}\n` +
    (perItem
      ? 'Reply in exactly this form, nothing else:\nTITLE: <a short title, written as the instruction says — same language as the text>\nTEXT: <the text>'
      : 'Reply with the result only.')
  );
}

export function systemPrompt(voice?: string): string {
  if (!voice?.trim()) return PLATFORM_RULES;
  return `${PLATFORM_RULES}\n\nWrite in the brand voice below. If the instruction and the voice disagree (language, length, form), follow the instruction.\n\n${voice.trim()}`;
}

/** A voice handed over by a context step: its output object, or just its text. */
function readVoice(v: unknown): { voice: string; name: string; version: unknown } | null {
  if (v && typeof v === 'object' && typeof (v as { voice?: unknown }).voice === 'string') {
    const o = v as { voice: string; name?: unknown; version?: unknown };
    return o.voice.trim()
      ? { voice: o.voice, name: String(o.name ?? ''), version: o.version ?? null }
      : null;
  }
  const text = toText(v).trim();
  return text && text !== '{}' ? { voice: text, name: '', version: null } : null;
}

export interface ProcessOptions {
  httpClient: SafeHttpClient;
  ssrfAllowlist?: string[];
}

/**
 * "AI: process data by instruction": data from earlier steps + what to do with it. With
 * "read the links" on, the server opens the links in the data and gives the model each
 * article's text — a model cannot open links itself, so a summary "by link" needs this.
 */
export function buildProcessExecutor(chat: NodeExecutor, options: ProcessOptions): NodeExecutor {
  return {
    async execute(node, config, step) {
      const data = toText(config.input).trim();
      // A Prompt Template (a context step) is the instruction; the step's own instruction,
      // if any, is added after it.
      const template = readPrompt(config.prompt);
      const own = toText(config.instruction).trim();
      const filled = template
        ? fillPrompt(template, (step.expressionScope ?? {}) as Record<string, unknown>)
        : '';
      const instruction = [filled, own].filter(Boolean).join('\n\n');
      if (!instruction) {
        throw new ActionExecutionError(
          'Process data: write what to do in “Instruction” or link a Prompt Template.',
          'process',
          'ai.process'
        );
      }

      const sources: Array<{
        url: string;
        ok: boolean;
        title?: string;
        chars?: number;
        error?: string;
      }> = [];
      let articles = '';
      if (config.readLinks === true || config.readLinks === 'true') {
        const limit = Math.min(Math.max(Number(config.maxLinks) || 3, 1), MAX_LINKS);
        for (const url of extractLinks(data).slice(0, limit)) {
          try {
            const res = await options.httpClient.request<unknown>({
              url,
              headers: PAGE_HEADERS,
              timeoutMs: 20_000,
              allowlist: options.ssrfAllowlist,
            });
            if (res.status >= 400) throw new Error(`HTTP ${res.status}`);
            const page = articleText(
              typeof res.data === 'string' ? res.data : JSON.stringify(res.data)
            );
            const text = page.text.slice(0, ARTICLE_CHARS);
            if (!text) throw new Error('no readable text on the page');
            sources.push({ url, ok: true, title: page.title, chars: text.length });
            articles += `\n\n--- ${url}\n${page.title ? `${page.title}\n` : ''}${text}`;
          } catch (err) {
            const error = err instanceof Error ? err.message : String(err);
            sources.push({ url, ok: false, error });
            articles += `\n\n--- ${url}\n(could not open the page: ${error})`;
          }
        }
      }

      // The instruction goes before and after the data: with a long article in between,
      // smaller models otherwise follow the data (its language, its form) instead.
      // Per item (“for each item”) the answer is a post: a title and a text, both written as
      // the instruction says (translated, shortened…). Asked for with markers, read back
      // from them; a model that gives no title is asked once more for the title alone — so
      // the post never falls back to the source's title in the source's language.
      const perItem = config.__forEach === true;
      const prompt = userPrompt(instruction, data, articles, perItem);
      const ask = async (system: string, userPrompt: string) =>
        String(
          (
            (
              await chat.execute(
                { ...node, type: 'ai.openai' },
                { model: config.model, system, prompt: userPrompt },
                step
              )
            ).output as { text?: unknown }
          )?.text ?? ''
        ).trim();
      // A brand voice (a context step) goes into the system message, after the platform's
      // rules and below the task: the order is fixed and stated, so a conflict is resolved
      // the same way every time — the instruction wins over the voice.
      const voice = readVoice(config.voice);
      const answer = await ask(systemPrompt(voice?.voice), prompt);
      const meta = {
        ...(voice ? { voice: { name: voice.name, version: voice.version } } : {}),
        ...(template ? { prompt: { name: template.name, version: template.version } } : {}),
      };
      if (!perItem) return { output: { text: answer, sources, ...meta }, activeOutputs: ['main'] };

      let { title, body } = readPost(answer);
      if (!title && body) {
        title = (
          await ask(
            'You write titles. Reply with the title only: one line, no quotes, no label.',
            `Write a short title (at most 12 words) for this text, in the same language as the text:\n\n${body.slice(0, 2000)}`
          )
        )
          .split('\n')[0]!
          .replace(/^(title|заголовок)\s*:\s*/i, '')
          .replace(/^["«*#\s]+|["»*\s]+$/g, '')
          .trim();
      }
      return {
        output: { text: title ? `${title}\n\n${body}` : body, title, body, sources, ...meta },
        activeOutputs: ['main'],
      };
    },
  };
}
