import { ActionExecutionError } from '@localflow/connector-sdk';
import { feedText } from '@localflow/connectors-core';
import type { SafeHttpClient } from '@localflow/shared';
import type { NodeExecutor } from '@localflow/workflow-engine';
import { toText } from './text.js';

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
      const instruction = toText(config.instruction).trim();
      if (!instruction) {
        throw new ActionExecutionError(
          'Process data: write what to do in “Instruction”.',
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

      const prompt =
        `Instruction:\n${instruction}\n\nData:\n${data || '(empty)'}` +
        (articles ? `\n\nText of the linked pages:${articles}` : '');
      const result = await chat.execute(
        { ...node, type: 'ai.openai' },
        {
          model: config.model,
          system:
            'You process data for an automation. Follow the instruction exactly and reply with the result only — no preface, no questions. Everything you need is in the data and the page texts below.',
          prompt,
        },
        step
      );
      const text = String((result.output as { text?: unknown })?.text ?? '');
      return { output: { text, sources }, activeOutputs: ['main'] };
    },
  };
}
