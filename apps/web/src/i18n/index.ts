import { MESSAGES, type Locale, type MessageKey } from './messages.js';

export { MESSAGES, type Locale, type MessageKey };

export const SUPPORTED_LOCALES: readonly Locale[] = ['ru', 'en'];
export const DEFAULT_LOCALE: Locale = 'en';

export type Translator = (key: MessageKey, params?: Record<string, string | number>) => string;

/**
 * Picks the first supported locale from browser-style preferences (`navigator.languages`),
 * e.g. `['ru-RU', 'en']` → `ru`.
 */
export function detectLocale(preferred: readonly string[] = []): Locale {
  for (const tag of preferred) {
    const base = tag.toLowerCase().split('-')[0];
    const match = SUPPORTED_LOCALES.find((l) => l === base);
    if (match) return match;
  }
  return DEFAULT_LOCALE;
}

export function createTranslator(locale: Locale = DEFAULT_LOCALE): Translator {
  const dict: Record<string, string> = MESSAGES[locale] ?? MESSAGES[DEFAULT_LOCALE];
  const fallback: Record<string, string> = MESSAGES[DEFAULT_LOCALE];
  return (key, params = {}) => {
    const template = dict[key] ?? fallback[key] ?? key;
    return template.replace(/\{(\w+)\}/g, (m, name: string) =>
      name in params ? String(params[name]) : m
    );
  };
}
