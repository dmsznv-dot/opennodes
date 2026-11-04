import { describe, it, expect } from 'vitest';
import { ACTIONS, TEMPLATES, feedSummary, splitResult, postFields } from '../../../docs/catalog.js';
import { tagCategories, listChoices, choiceFor } from '../../../docs/tags.js';
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

  it('a post per item: plain fields first, then a few posts of words only', () => {
    const cats = tagCategories(a, tg, { fieldKey: 'text', forEach: tg.config.forEach });
    // Like a mapping panel: the item's fields come before any ready-made combination.
    expect(cats.map((c: { id: string }) => c.id).slice(0, 2)).toEqual(['item', 'posts.item']);
    const item = cats[0];
    expect(item.entries.map((e: { expr: string }) => e.expr).slice(0, 5)).toEqual([
      '$item.postTitle',
      '$item.postText',
      '$item.postSummary',
      '$item.image',
      '$item.link',
    ]);
    // Every field says where it comes from: the AI or the article.
    expect(item.entries.map((e: { title: { ru: string } }) => e.title.ru)).toEqual([
      'Заголовок от ИИ',
      'Текст от ИИ — целиком',
      'Текст от ИИ — первые предложения',
      'Картинка статьи',
      'Ссылка на статью',
      'Заголовок статьи',
      'Текст статьи — целиком',
      'Текст статьи — первые предложения',
      'Дата публикации статьи',
      'Ответ ИИ как есть (заголовок и текст вместе)',
    ]);
    const posts = cats[1];
    expect(posts.entries.length).toBeGreaterThanOrEqual(2);
    expect(posts.entries.length).toBeLessThanOrEqual(4);
    // The picture and the link are separate colored tags, never inside a post.
    for (const e of posts.entries) {
      expect(e.extra, e.id).toBeUndefined();
      expect(e.template, e.id).not.toMatch(/\.(image|link)\b/);
    }
    // No emoji copies of the same post.
    expect(posts.entries.some((e: { template: string }) => /[📰🔥👉]/u.test(e.template))).toBe(
      false
    );
    expect(posts.entries.map((e: { title: { ru: string } }) => e.title.ru)).toEqual([
      'Заголовок + текст',
      'Заголовок + дата + текст',
      'Заголовок жирным',
    ]);
    // After an AI step: its title and text.
    expect(posts.entries[0].template).toBe('**{{ $item.postTitle }}**\n\n{{ $item.postText }}');
    expect(posts.aiToggle).toMatchObject({ on: true, step: '3' });
    // AI posts come full or short, like the article's own.
    expect(posts.shortToggle).toEqual({ on: false });
    const aiShort = tagCategories(a, tg, {
      fieldKey: 'text',
      forEach: tg.config.forEach,
      short: true,
    })[1];
    expect(aiShort.entries[0].template).toBe(
      '**{{ $item.postTitle }}**\n\n{{ $item.postSummary }}'
    );
    // A step that ran per item shows no technical keys, even after a real run.
    const seen = tagCategories(a, tg, {
      fieldKey: 'text',
      forEach: tg.config.forEach,
      seenKeys: { ai_1: ['items', 'outputs', 'total', 'skipped', 'results', 'text', 'count'] },
    });
    const ai = seen.find((c: { id: string }) => c.id === 'step.ai_1');
    expect(ai.entries.map((e: { expr: string }) => e.expr)).toEqual([
      '$nodes.ai_1.output.text',
      '$nodes.ai_1.output.count',
    ]);
    // “From the item”: its own title and text, full or short.
    const own = tagCategories(a, tg, {
      fieldKey: 'text',
      forEach: tg.config.forEach,
      useAi: false,
    })[1];
    expect(own.entries[0].template).toBe('**{{ $item.title }}**\n\n{{ $item.text }}');
    expect(own.shortToggle).toEqual({ on: false });
    const short = tagCategories(a, tg, {
      fieldKey: 'text',
      forEach: tg.config.forEach,
      useAi: false,
      short: true,
    })[1];
    expect(short.entries[0].template).toBe('**{{ $item.title }}**\n\n{{ $item.summary }}');
  });

  it('the picture field opens on pictures — one each, not the list of all of them', () => {
    const cats = tagCategories(a, tg, { fieldKey: 'imageUrl', forEach: tg.config.forEach });
    expect(cats[0].id).toBe('fit');
    expect(cats[0].entries.map((e: { expr: string }) => e.expr)).toEqual(['$item.image']);
    const none = tagCategories(a, tg, { fieldKey: 'imageUrl', forEach: '' });
    expect(none[0].entries.map((e: { expr: string }) => e.expr)).toEqual([
      '$nodes.rss_1.output.image',
    ]);
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

  it('one list per source: the RSS items, carrying what the AI step added', () => {
    const choices = listChoices(a, tg);
    expect(choices.map((c: { expr: string }) => c.expr)).toEqual([
      '{{ $nodes.ai_1.output.items }}',
    ]);
    expect(choices[0].label.ru).toMatch(/^из шага 2 \(.+\) \+ результат шага 3$/);
    // The AI step itself repeats for the raw items.
    const ai = a.nodes.find((n: Node) => n.id === 'ai_1');
    expect(listChoices(a, ai).map((c: { expr: string }) => c.expr)).toEqual([
      '{{ $nodes.rss_1.output.items }}',
    ]);
  });

  it('without “for each item” an RSS step offers first-item and all-items blocks', () => {
    const cats = tagCategories(a, tg, { fieldKey: 'text', forEach: '' });
    const rss = cats.find((c: { id: string }) => c.id === 'step.rss_1');
    expect(rss.entries.length).toBeGreaterThanOrEqual(20);
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
    // One long sentence without a full stop: kept whole, never cut.
    expect(out.items[0].summary).toBe(out.items[0].text);
    for (const o of ACTIONS['rss.read'].outputs) expect(out, o.key).toHaveProperty(o.key);
  });

  it('a post saved for the raw items moves up to the items with the AI result', () => {
    const raw = '{{ $nodes.rss_1.output.items }}';
    expect(choiceFor(a, tg, raw)?.expr).toBe('{{ $nodes.ai_1.output.items }}');
    // Per item, “first item: …” data would repeat the first article in every post.
    const cats = tagCategories(a, tg, { fieldKey: 'text', forEach: tg.config.forEach });
    const rss = cats.find((c: { id: string }) => c.id === 'step.rss_1');
    expect(rss.entries.some((e: { expr?: string }) => e.expr === '$nodes.rss_1.output.image')).toBe(
      false
    );
  });

  it('after an AI step a post has a title even when the AI gave only text', () => {
    const item = { title: 'Original', link: 'https://e/1', image: 'https://e/1.jpg' };
    expect(postFields(item, 'Заголовок\n\nТекст.')).toMatchObject({
      postTitle: 'Заголовок',
      postText: 'Текст.',
      image: 'https://e/1.jpg',
    });
    expect(postFields(item, 'Только текст.')).toMatchObject({
      postTitle: 'Original',
      postText: 'Только текст.',
    });
  });

  it('links with your own words hide the address behind them', () => {
    const cats = tagCategories(a, tg, { fieldKey: 'text', forEach: tg.config.forEach });
    const links = cats.find((c: { id: string }) => c.id === 'links');
    const templates = links.entries.map((e: { template: string }) => e.template);
    expect(templates.length).toBeGreaterThanOrEqual(5);
    for (const tpl of templates)
      expect(tpl).toMatch(/^\[[^\]]+\]\(\{\{ \$(item\.link|nodes\.rss_1\.output\.link) \}\}\)$/);
    expect(templates.filter((x: string) => x.includes('$item.link'))).toHaveLength(5);
  });

  it('favourites are kept by step kind, so they work in every automation', () => {
    const cats = tagCategories(a, tg, { fieldKey: 'text', forEach: '' });
    const rss = cats.find((c: { id: string }) => c.id === 'step.rss_1');
    expect(rss.entries.every((e: { fav: string }) => !e.fav.includes('rss_1'))).toBe(true);
  });

  it('an AI answer splits into its title line and the text', () => {
    expect(splitResult('**Новый заголовок**\n\nПересказ.')).toEqual({
      resultTitle: 'Новый заголовок',
      resultBody: 'Пересказ.',
    });
    expect(splitResult('Одной строкой.')).toEqual({
      resultTitle: '',
      resultBody: 'Одной строкой.',
    });
  });
});

describe('add-step menu — names say what a step is', () => {
  it('every step has a condition and a result in both languages', () => {
    for (const [id, act] of Object.entries(ACTIONS as Record<string, any>)) {
      for (const key of ['needs', 'gives']) {
        expect(String(act[key]?.ru ?? '').trim(), `${id}.${key} RU`).not.toBe('');
        expect(String(act[key]?.en ?? '').trim(), `${id}.${key} EN`).not.toBe('');
      }
    }
  });

  it('a start is named as an event, an action starts with a verb', () => {
    for (const [id, act] of Object.entries(ACTIONS as Record<string, any>)) {
      const ru = act.name.ru as string;
      if (act.kind === 'trigger') {
        expect(ru, id).toMatch(/^(Ручной запуск|По расписанию|Входящ)/);
      } else if (act.kind === 'action') {
        expect(ru, id).toMatch(
          /^(Отправить|Получить|Обработать|Задать|Определить|Выполнить|Добавить|Сохранить|Создать)/
        );
      }
    }
  });
});
