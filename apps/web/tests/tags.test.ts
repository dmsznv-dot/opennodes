import { describe, it, expect } from 'vitest';
import { ACTIONS, TEMPLATES, feedSummary } from '../../../docs/catalog.js';
import { tagCategories, listChoices } from '../../../docs/tags.js';
import { parseExpr, splitTemplate } from '../../../docs/tokens.js';

type Node = { id: string; action: string; config: Record<string, unknown> };
const fromTemplate = (id: string) => {
  const tpl = TEMPLATES.find((t: { id: string }) => t.id === id);
  return {
    id: 'a',
    nodes: tpl.nodes.map((n: Node) => ({ ...n, config: { ...n.config } })),
    edges: tpl.edges.map(([source, target]: [string, string], i: number) => ({
      id: `e${i}`,
      source,
      target,
    })),
  };
};

/** Every `{{ … }}` in a block is a value the editor and the server understand. */
function expectValidTemplate(template: string) {
  for (const part of splitTemplate(template)) {
    if (part.expr) expect(parseExpr(part.expr), part.expr).not.toBeNull();
  }
}

describe('data picker — ready-made blocks', () => {
  const a = fromTemplate('rss_ai_channel');
  const tg = a.nodes.find((n: Node) => n.id === 'tg_1');

  it('a post per item: the title + text, + link, + picture ladder comes first', () => {
    const cats = tagCategories(a, tg, { fieldKey: 'text', forEach: tg.config.forEach });
    const posts = cats.find((c: { id: string }) => c.id === 'posts.item');
    expect(posts.entries.length).toBeGreaterThanOrEqual(20);
    const top = posts.entries.filter((e: { group: string }) => e.group === 'top');
    expect(top.map((e: { title: { ru: string } }) => e.title.ru).slice(0, 3)).toEqual([
      'Заголовок + результат',
      'Заголовок + результат + ссылка',
      'Заголовок + результат + ссылка + картинка',
    ]);
    // A block with a picture fills the step's picture field with the item's picture.
    expect(top[2].extra).toEqual({ imageUrl: '{{ $item.image }}' });
    const item = cats.find((c: { id: string }) => c.id === 'item');
    expect(item.entries.map((e: { expr: string }) => e.expr)).toContain('$item.result');
  });

  it('every block of every category is a valid template', () => {
    for (const forEach of [tg.config.forEach, '']) {
      for (const c of tagCategories(a, tg, { fieldKey: 'text', forEach })) {
        for (const e of c.entries) {
          expectValidTemplate(e.template);
          for (const v of Object.values(e.extra ?? {})) expectValidTemplate(String(v));
        }
      }
    }
  });

  it('lists to repeat for: the RSS items and the AI step’s items with their result', () => {
    expect(listChoices(a, tg).map((c: { expr: string }) => c.expr)).toEqual([
      '{{ $nodes.ai_1.output.items }}',
      '{{ $nodes.rss_1.output.items }}',
    ]);
  });

  it('without “for each item” an RSS step offers first-item and all-items blocks', () => {
    const cats = tagCategories(a, tg, { fieldKey: 'text', forEach: '' });
    const rss = cats.find((c: { id: string }) => c.id === 'step.rss_1');
    expect(rss.entries.length).toBeGreaterThanOrEqual(40);
    expect(rss.entries.some((e: { id: string }) => e.id === 'all.digest')).toBe(true);
    expect(cats.some((c: { id: string }) => c.id === 'posts.item')).toBe(false);
  });

  it('every step that takes data has something to offer in each of its fields', () => {
    for (const [id, act] of Object.entries(ACTIONS as Record<string, any>)) {
      if (act.planned || act.kind === 'trigger') continue;
      for (const f of act.fields ?? []) {
        if (!f.acceptsData) continue;
        const g = {
          id: 'g',
          nodes: [
            { id: 'trigger', action: 'manual.run', config: {} },
            { id: 'rss_1', action: 'rss.read', config: {} },
            { id: 'x', action: id, config: {} },
          ],
          edges: [
            { id: 'e1', source: 'trigger', target: 'rss_1' },
            { id: 'e2', source: 'rss_1', target: 'x' },
          ],
        };
        const cats = tagCategories(g, g.nodes[2], { fieldKey: f.key, forEach: '' });
        const total = cats.reduce(
          (n: number, c: { entries: unknown[] }) => n + c.entries.length,
          0
        );
        expect(total, `${id}.${f.key}`).toBeGreaterThanOrEqual(20);
      }
    }
  });

  it('the demo RSS step gives the same fields as the server', () => {
    const out = feedSummary([
      {
        title: 'A',
        text: 'x '.repeat(200),
        link: 'https://e/1',
        image: 'https://e/1.jpg',
        pubDate: '2026-11-03T10:00:00Z',
      },
    ]);
    expect(Object.keys(out).sort()).toEqual(
      [
        'items',
        'count',
        'titles',
        'numbered',
        'bullets',
        'digest',
        'titleLinks',
        'posts',
        'postsShort',
        'postsWithLinks',
        'texts',
        'links',
        'images',
        'firstTitle',
        'firstText',
        'firstSummary',
        'firstDate',
        'link',
        'image',
      ].sort()
    );
    expect(out.items[0].summary.length).toBeLessThanOrEqual(280);
    for (const o of ACTIONS['rss.read'].outputs) expect(out, o.key).toHaveProperty(o.key);
  });
});
