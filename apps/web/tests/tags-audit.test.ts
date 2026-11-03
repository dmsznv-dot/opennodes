/**
 * Audit of everything the data picker offers, for every step and every field that takes
 * data, after several kinds of earlier steps. Each card must have a short readable title in
 * both languages, a valid template, a sample that resolves to real text (no leftover
 * `{{ }}`, "undefined", "[object Object]"), and no twin in its category.
 */
import { describe, it, expect } from 'vitest';
import { ACTIONS } from '../../../docs/catalog.js';
import { tagCategories } from '../../../docs/tags.js';
import { exampleContext, resolveValue, simulate } from '../../../docs/engine.js';
import { parseExpr, splitTemplate } from '../../../docs/tokens.js';

type N = { id: string; action: string; config: Record<string, unknown> };
const graph = (nodes: N[]) => ({
  id: 'g',
  nodes,
  edges: nodes.slice(1).map((n, i) => ({ id: `e${i}`, source: nodes[i]!.id, target: n.id })),
});

/** Earlier steps a field may draw on. */
const CHAINS: Record<string, N[]> = {
  rss: [
    { id: 'trigger', action: 'schedule.every', config: { every: 'daily' } },
    { id: 'rss_1', action: 'rss.read', config: { feedUrl: 'https://x/feed', maxItems: 3 } },
  ],
  rssAiPerItem: [
    { id: 'trigger', action: 'schedule.every', config: { every: 'daily' } },
    { id: 'rss_1', action: 'rss.read', config: { feedUrl: 'https://x/feed', maxItems: 3 } },
    {
      id: 'ai_1',
      action: 'ai.process',
      config: {
        forEach: '{{ $nodes.rss_1.output.items }}',
        input: '{{ $item.title }}',
        instruction: 'x',
      },
    },
  ],
  form: [{ id: 'trigger', action: 'webhook.receive', config: {} }],
  telegram: [
    { id: 'trigger', action: 'telegram.newMessage', config: {} },
    { id: 'ai_1', action: 'ai.reply', config: { prompt: '{{ $trigger.text }}' } },
  ],
};

const targets = Object.entries(ACTIONS as Record<string, any>).filter(
  ([, a]) => !a.planned && a.kind !== 'trigger' && (a.fields ?? []).some((f: any) => f.acceptsData)
);

function cases() {
  const out: Array<{ name: string; a: any; node: any; fieldKey: string; forEach: string }> = [];
  for (const [chainName, chain] of Object.entries(CHAINS)) {
    for (const [id, act] of targets) {
      const node = { id: 'target', action: id, config: {} as Record<string, unknown> };
      const a = graph([...chain, node]);
      const lists = chainName.startsWith('rss')
        ? [
            chainName === 'rss'
              ? '{{ $nodes.rss_1.output.items }}'
              : '{{ $nodes.ai_1.output.items }}',
          ]
        : [];
      for (const f of act.fields.filter((x: any) => x.acceptsData)) {
        for (const forEach of ['', ...(act.forEach ? lists : [])]) {
          out.push({
            name: `${chainName} → ${id}.${f.key}${forEach ? ' (each item)' : ''}`,
            a,
            node,
            fieldKey: f.key,
            forEach,
          });
        }
      }
    }
  }
  return out;
}

/** Example data for every step, as the editor's previews use it. */
function context(a: any, forEach: string) {
  const ctx: any = exampleContext(a);
  const run = simulate(a, [], {});
  for (const s of run.steps) if (s.output) ctx.nodes[s.nodeId] = s.output;
  if (forEach) {
    const list = resolveValue(forEach, ctx);
    ctx.item = Array.isArray(list) ? list[0] : undefined;
  }
  return ctx;
}

describe('data picker audit — every card for every field', () => {
  for (const c of cases()) {
    it(c.name, () => {
      if (c.forEach) c.node.config.forEach = c.forEach;
      else delete c.node.config.forEach;
      const cats = tagCategories(c.a, c.node, { fieldKey: c.fieldKey, forEach: c.forEach });
      const ctx = context(c.a, c.forEach);
      const ids = new Set<string>();
      for (const cat of cats) {
        expect(cat.entries.length, `${cat.id} is empty`).toBeGreaterThan(0);
        expect(ids.has(cat.id), `category ${cat.id} twice`).toBe(false);
        ids.add(cat.id);
        const titles = new Set<string>();
        const templates = new Set<string>();
        for (const e of cat.entries) {
          if (e.i18nKey) continue; // date/run labels come from the dictionary (checked elsewhere)
          const ru = e.title?.ru ?? e.title;
          const en = e.title?.en ?? e.title;
          expect(String(ru).trim(), `${cat.id}/${e.id} RU title`).not.toBe('');
          expect(String(en).trim(), `${cat.id}/${e.id} EN title`).not.toBe('');
          expect(String(ru).length, `${cat.id}/${e.id} title too long: ${ru}`).toBeLessThanOrEqual(
            60
          );
          expect(titles.has(ru), `${cat.id}: two cards called “${ru}”`).toBe(false);
          titles.add(ru);
          if (e.kind === 'custom') continue;
          if (cat.id !== 'fav' && e.kind !== 'snippet') {
            expect(templates.has(e.template), `${cat.id}: same template twice (${e.id})`).toBe(
              false
            );
            templates.add(e.template);
          }
          for (const p of splitTemplate(e.template)) {
            if (p.expr) expect(parseExpr(p.expr), `${e.id}: ${p.expr}`).not.toBeNull();
          }
          if (e.kind === 'snippet') continue;
          const shown = String(resolveValue(e.template, ctx) ?? '');
          expect(shown, `${e.id} sample`).not.toMatch(/\{\{|undefined|\[object Object\]|\bnull\b/);
        }
      }
    });
  }
});
