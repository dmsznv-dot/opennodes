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

const escapers: Record<string, (s: string) => string> = {
  HTML: (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
  Markdown: (s) => s.replace(/([_*`[])/g, '\\$1'),
  MarkdownV2: (s) => s.replace(/([_*[\]()~`>#+\-=|{}.!\\])/g, '\\$1'),
};

const evaluator = new ExpressionEvaluator();

/**
 * Renders a template for Telegram's HTML/Markdown mode: the markup typed in the step stays,
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
