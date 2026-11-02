import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
// The GitHub Pages demo is plain ESM without a build step; test its engine directly.
// @ts-expect-error — untyped JS module
import * as engine from '../../../docs/engine.js';
// @ts-expect-error — untyped JS module
import { ACTIONS, TEMPLATES } from '../../../docs/catalog.js';
// @ts-expect-error — untyped JS module
import { __DICT_FOR_TESTS } from '../../../docs/i18n.js';

const DOCS_DIR = join(__dirname, '../../../docs');

const pick = (v: unknown): unknown =>
  v && typeof v === 'object' && 'en' in v && 'ru' in v ? (v as { en: unknown }).en : v;

/** Mirrors app.js createFromTemplate: field defaults + template config, EN locale. */
function fromTemplate(id: string) {
  const tpl = TEMPLATES.find((x: { id: string }) => x.id === id);
  return {
    id: 'wf_test',
    name: 'Test',
    nodes: tpl.nodes.map((n: { id: string; action: string; config: Record<string, unknown> }) => ({
      id: n.id,
      action: n.action,
      label: '',
      config: {
        ...Object.fromEntries(
          (ACTIONS[n.action].fields ?? [])
            .filter((f: { default?: unknown }) => f.default !== undefined)
            .map((f: { key: string; default: unknown }) => [f.key, pick(f.default)])
        ),
        ...Object.fromEntries(Object.entries(n.config).map(([k, v]) => [k, pick(v)])),
      },
      connectionId: null,
      disabled: false,
    })),
    edges: tpl.edges.map(([source, target]: [string, string], i: number) => ({
      id: `e${i}`,
      source,
      target,
    })),
    nodeErrors: {},
  };
}

describe('docs/ public demo — UX audit v1', () => {
  it('BUG-01: simulation never reports success for a step that is not set up', () => {
    const a = fromTemplate('tg_ai_reply');
    const run = engine.simulate(a, []);
    expect(run.kind).toBe('simulation');
    expect(run.result).toBe('failed');
    const failed = run.steps.find((s: { status: string }) => s.status === 'failed');
    expect(failed.error.key).toBe('err.noConnection');
    expect(run.steps.some((s: { status: string }) => s.status === 'notReached')).toBe(true);

    const conns = [
      { id: 'c_tg', service: 'telegram', name: 'TG' },
      { id: 'c_ai', service: 'ai', name: 'AI' },
    ];
    a.nodes.forEach((n: { action: string; connectionId: string | null }) => {
      n.connectionId =
        ACTIONS[n.action].service === 'telegram'
          ? 'c_tg'
          : ACTIONS[n.action].service === 'ai'
            ? 'c_ai'
            : null;
    });
    const ok = engine.simulate(a, conns);
    expect(ok.result).toBe('ok');
    const send = ok.steps.find((s: { nodeId: string }) => s.nodeId === 'tg_1');
    expect(send.output.simulated).toBe(true);
    expect(JSON.stringify(send.input)).toContain('[REDACTED]');
    expect(JSON.stringify(send.input)).not.toContain('not-a-real-secret');
  });

  it('BUG-02/03: demo fields keep types and only enforce schema-required values', () => {
    const num = { key: 'n', type: 'number', required: false };
    const bool = { key: 'b', type: 'boolean', required: true };
    const json = { key: 'j', type: 'json', required: false };
    expect(engine.parseFieldInput(num, '0')).toEqual({ ok: true, value: 0 });
    expect(engine.parseFieldInput(num, '')).toEqual({ ok: true, omitted: true });
    expect(engine.parseFieldInput(num, 'abc')).toMatchObject({ ok: false, code: 'number' });
    expect(engine.parseFieldInput(bool, false)).toEqual({ ok: true, value: false });
    expect(engine.parseFieldInput(json, '[]')).toEqual({ ok: true, value: [] });
    expect(engine.parseFieldInput(json, '{}')).toEqual({ ok: true, value: {} });
    expect(engine.parseFieldInput(json, '{')).toMatchObject({ ok: false, code: 'json' });
    expect(engine.parseFieldInput({ key: 's', type: 'text', required: true }, ' ')).toMatchObject({
      ok: false,
      code: 'required',
    });
    expect(engine.parseFieldInput(num, '{{ $trigger.count }}')).toEqual({
      ok: true,
      value: '{{ $trigger.count }}',
    });
  });

  it('BUG-05: real connection attempts are validated for cycles', () => {
    const a = fromTemplate('rss_digest');
    expect(engine.validateDag(a.nodes, a.edges).valid).toBe(true);
    const res = engine.validateDag(a.nodes, [
      ...a.edges,
      { id: 'x', source: 'mail_1', target: 'rss_1' },
    ]);
    expect(res.valid).toBe(false);
    expect(res.code).toBe('ERR_CYCLIC_DEPENDENCY_DETECTED');
  });

  it('readable data chips round-trip to engine expressions', () => {
    const a = fromTemplate('tg_ai_reply');
    const stored = a.nodes.find((n: { id: string }) => n.id === 'tg_1').config.text;
    const shown = engine.toHuman(a, stored);
    expect(shown).not.toContain('$nodes');
    expect(engine.fromHuman(a, shown)).toEqual({ value: stored, bad: [] });
    expect(engine.fromHuman(a, '{Step 9: Nope}').bad).toHaveLength(1);
  });

  it('BUG-06: demo never renders through innerHTML / insertAdjacentHTML', () => {
    for (const file of readdirSync(DOCS_DIR).filter((f) => f.endsWith('.js'))) {
      const src = readFileSync(join(DOCS_DIR, file), 'utf8');
      expect(src, file).not.toMatch(
        /\.innerHTML\s*=|outerHTML\s*=|insertAdjacentHTML|document\.write/
      );
    }
  });

  it('BUG-07: RU and EN dictionaries have the same keys', () => {
    expect(Object.keys(__DICT_FOR_TESTS.ru).sort()).toEqual(
      Object.keys(__DICT_FOR_TESTS.en).sort()
    );
  });
});
