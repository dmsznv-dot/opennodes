/**
 * The editor's “how the post will look” must show what Telegram will show: the same
 * Markdown read the same way by the preview (docs/markdown.js, DOM) and by the server
 * (telegram-markdown.ts, Telegram HTML). Line breaks, blank lines and indents included.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { markdownToTelegramHtml } from '../../../packages/connectors-core/src/telegram-markdown.js';
import { splitTelegramText } from '../../../packages/connectors-core/src/connectors.js';

// A minimal DOM, enough for docs/dom.js `h()`: elements, text nodes, attributes.
class FakeNode {
  childNodes: FakeNode[] = [];
  appendChild(c: FakeNode) {
    this.childNodes.push(c);
    return c;
  }
}
class FakeText extends FakeNode {
  constructor(public textContent: string) {
    super();
  }
}
class FakeEl extends FakeNode {
  attrs: Record<string, string> = {};
  className = '';
  style = {};
  dataset = {};
  constructor(public tagName: string) {
    super();
  }
  setAttribute(k: string, v: string) {
    this.attrs[k] = v;
  }
  addEventListener() {}
}

let markdownNodes: (md: string) => Array<FakeNode | string>;
beforeAll(async () => {
  (globalThis as any).Node = FakeNode;
  (globalThis as any).document = {
    createElement: (t: string) => new FakeEl(t),
    createTextNode: (t: string) => new FakeText(t),
    documentElement: {},
  };
  ({ markdownNodes } = (await import('../../../docs/markdown.js')) as any);
});

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/** The preview as Telegram HTML: <br> is a line break, links keep only their address. */
function html(nodes: Array<FakeNode | string>): string {
  return nodes
    .flat(Infinity as 1)
    .map((n) => {
      if (typeof n === 'string') return esc(n);
      if (n instanceof FakeText) return esc(n.textContent);
      const el = n as FakeEl;
      const tag = el.tagName.toLowerCase();
      if (tag === 'br') return '\n';
      const inner = html(el.childNodes);
      // A bare address: Telegram makes it a link by itself, the preview shows it as one.
      if (tag === 'a' && inner === esc(el.attrs.href)) return inner;
      return tag === 'a' ? `<a href="${el.attrs.href}">${inner}</a>` : `<${tag}>${inner}</${tag}>`;
    })
    .join('');
}

const CASES: Array<[string, string]> = [
  ['title and text', '**Заголовок**\n\nТекст статьи.'],
  ['blank lines kept', 'Первый абзац.\n\n\nВторой после двух пустых строк.'],
  ['indent kept', 'Список:\n    с отступом\n  и ещё'],
  ['bullets', '- раз\n- два\n* три'],
  ['numbered list stays', '1. раз\n2. два'],
  ['heading', '## Итоги дня\nТекст'],
  ['quote over lines', '> первая строка\n> вторая\nпосле'],
  ['link with words', '[Читать далее](https://example.com/a?b=1)'],
  ['bare link', 'Источник: https://example.com/x_y.'],
  ['italic and bold', '**жирный** и *курсив* и _тоже_ и ~~нет~~'],
  ['snake_case untouched', 'файл my_file_name и 2*3*4'],
  ['code', 'Команда `npm i` и\n```\nблок\n  кода\n```'],
  ['special characters', 'Q&A: 2 < 3 > 1'],
  [
    'AI answer',
    'Air создала агента.\n\nПо словам CEO, «идея — за человеком».\n\nСтатья спонсорская.',
  ],
  ['trailing spaces and line', 'строка  \nследующая\n'],
];

describe('post preview = what Telegram shows', () => {
  for (const [name, md] of CASES) {
    it(name, () => {
      expect(html(markdownNodes(md))).toBe(markdownToTelegramHtml(md));
    });
  }
});

describe('Telegram formatting keeps the layout', () => {
  it('blank lines between paragraphs stay as they are', () => {
    expect(markdownToTelegramHtml('А\n\nБ\n\n\nВ')).toBe('А\n\nБ\n\n\nВ');
  });

  it('indents at the start of a line stay', () => {
    expect(markdownToTelegramHtml('  отступ\n    больше')).toBe('  отступ\n    больше');
  });

  it('Windows line breaks do not leave stray characters before tags', () => {
    expect(markdownToTelegramHtml('**Т**\r\n\r\nтекст')).toBe('<b>Т</b>\r\n\r\nтекст');
  });

  it('a long post is cut at paragraphs, and every part is valid on its own', () => {
    const para = (n: number) => `**Пункт ${n}**\n${'слово '.repeat(120).trim()}`;
    const text = Array.from({ length: 12 }, (_, i) => para(i + 1)).join('\n\n');
    const parts = splitTelegramText(text, 3500);
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) {
      const out = markdownToTelegramHtml(p);
      expect(out.split('<b>').length, p.slice(0, 40)).toBe(out.split('</b>').length);
      expect(p.startsWith('**Пункт')).toBe(true); // cut between paragraphs, not inside one
    }
  });
});
