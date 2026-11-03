import { ExpressionEvaluator } from '@localflow/workflow-engine';

/**
 * A value as text for a message, prompt or email. A field holding only `{{ expr }}` keeps
 * the value's type (a list, a number…); `String()` would give "[object Object]" or "a,b".
 */
export function toText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  // Compact JSON, the same as "Compose text" gives for the same value.
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/** Text fields of each step type, turned into text before the step runs. */
export const TEXT_FIELDS: Record<string, string[]> = {
  'core.telegramBot': ['text'],
  'ai.openai': ['prompt', 'system'],
  'ai.ollama': ['prompt', 'system'],
  'core.smtp': ['to', 'subject', 'body', 'text'],
};

export function textFields(type: string, input: Record<string, unknown>): void {
  for (const key of TEXT_FIELDS[type] ?? []) {
    if (input[key] !== undefined && typeof input[key] !== 'string') input[key] = toText(input[key]);
  }
}

// Markdown is not escaped: it is converted to HTML as a whole (data from an AI step keeps
// its **bold**), and the converter escapes everything else, so data cannot break a post.
const escapers: Record<string, (s: string) => string> = {
  HTML: (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
  MarkdownV2: (s) => s.replace(/([_*[\]()~`>#+\-=|{}.!\\])/g, '\\$1'),
};

const evaluator = new ExpressionEvaluator();

/**
 * Renders a template for Telegram's HTML/MarkdownV2 mode: the markup typed in the step stays,
 * while data inserted into it is escaped — an RSS title "Q&A: 2 < 3" must not break the post.
 */
export function renderForParseMode(
  template: string,
  parseMode: unknown,
  scope: Record<string, unknown>
): string | undefined {
  const escape = escapers[String(parseMode ?? '')];
  if (!escape || !template.includes('{{')) return undefined;
  return template.replace(/\{\{\s*[\s\S]+?\s*\}\}/g, (m) =>
    escape(toText(evaluator.evaluate(m, scope)))
  );
}

/** Markdown as Slack mrkdwn: *bold*, _italic_, ~struck~, <url|text>. */
export function markdownToSlack(md: string): string {
  return String(md)
    .replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, '<$2|$1>')
    .replace(/^#{1,6}\s+(.+)$/gm, '*$1*')
    .replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, '*$1*')
    .replace(/~~(?=\S)([\s\S]*?\S)~~/g, '~$1~')
    .replace(/^(\s*)[-*+]\s+/gm, '$1• ');
}

/** Markdown as plain text (a plain-text email): markers go, links keep their address. */
export function markdownToPlain(md: string): string {
  return String(md)
    .replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, '$1 ($2)')
    .replace(/^#{1,6}\s+(.+)$/gm, '$1')
    .replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, '$1')
    .replace(/__(?=\S)([\s\S]*?\S)__/g, '$1')
    .replace(/~~(?=\S)([\s\S]*?\S)~~/g, '$1')
    .replace(/(^|[^\w*])\*(?=[^\s*])([^*\n]*?[^\s*])\*(?![\w*])/g, '$1$2')
    .replace(/^(\s*)[-*+]\s+/gm, '$1• ');
}
