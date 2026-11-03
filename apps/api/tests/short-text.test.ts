/**
 * “First sentences” never cut a text in the middle: whole sentences, about the length
 * asked for, no “…”. The editor (docs/catalog.js) and the server give the same result.
 */
import { describe, it, expect } from 'vitest';
import { sentences, shortText } from '../../../packages/execution-runtime/src/connectors.js';
import { postFields } from '../../../docs/catalog.js';

const FISH =
  'Студия Beam из Провиденса и Кембриджа выпустила 200-страничный журнал «Eating the Whole Fish», который объединяет кулинарную книгу, культурный архив и научное исследование. ' +
  'Проект начался с вопроса Кейт Мэсьюри из некоммерческой организации Eating with the Ecosystem: как больше людей могут готовить рыбу целиком? ' +
  'Журнал собирает голоса поваров, рыбаков и учёных. Тираж — 2.5 тыс. экземпляров, т. е. каждый номер на счету.';

const TEXTS: Record<string, string> = {
  'the post from the screenshot': FISH,
  'English with e.g. and Dr.': `Dr. Smith says the design is calm, e.g. muted colours and soft type. ${'The studio worked for two years on it. '.repeat(10)}`,
  'one very long sentence': `${'очень длинное предложение без точки и '.repeat(20)}конец.`,
  'a short text': 'Короткий текст.',
  paragraphs:
    'Первый абзац здесь.\n\nВторой абзац «В кавычках». Третий — с вопросом? Да! Ещё одно предложение тут.',
  'no punctuation at all': 'просто слова без знаков препинания '.repeat(15).trim(),
};

describe('first sentences — never cut', () => {
  for (const [name, text] of Object.entries(TEXTS)) {
    it(name, () => {
      const all = sentences(text);
      const short = shortText(text);
      // Made of whole sentences from the start of the text.
      const flat = short.replace(/\s+/g, ' ');
      const n = all.findIndex((_, i) => all.slice(0, i + 1).join(' ') === flat);
      expect(n, `“${short}” is not whole sentences`).toBeGreaterThanOrEqual(0);
      expect(short.endsWith('…') && !text.includes('…')).toBe(false);
      // About the length: more only when the first sentence alone is longer.
      if (n > 0) expect(short.length).toBeLessThanOrEqual(280 * 1.25);
      // The editor gives the same (an AI answer: a title line, then this text).
      expect(postFields({}, `Заголовок\n\n${text}`).postSummary).toBe(short);
    });
  }

  it('numbers, abbreviations and quotes stay inside their sentence', () => {
    expect(sentences(FISH)).toEqual([
      'Студия Beam из Провиденса и Кембриджа выпустила 200-страничный журнал «Eating the Whole Fish», который объединяет кулинарную книгу, культурный архив и научное исследование.',
      'Проект начался с вопроса Кейт Мэсьюри из некоммерческой организации Eating with the Ecosystem: как больше людей могут готовить рыбу целиком?',
      'Журнал собирает голоса поваров, рыбаков и учёных.',
      'Тираж — 2.5 тыс. экземпляров, т. е. каждый номер на счету.',
    ]);
    expect(shortText(FISH)).toBe(sentences(FISH).slice(0, 2).join(' '));
  });

  it('paragraphs and line breaks stay', () => {
    expect(shortText('Первый абзац.\n\nВторой абзац.', 280)).toBe('Первый абзац.\n\nВторой абзац.');
    expect(shortText('Раз.\nДва.\nТри.', 6)).toBe('Раз.');
  });

  it('a short text comes back as it is', () => {
    expect(shortText('Короткий текст.')).toBe('Короткий текст.');
  });
});
