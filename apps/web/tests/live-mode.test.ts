import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  WorkflowNodeSchema,
  WorkflowEdgeSchema,
  validateWorkflowGraph,
} from '@localflow/workflow-schema';
// The editor is plain ESM without a build step; test its live-mode mapping directly.
// @ts-expect-error — untyped JS module
import { toEngineGraph, fromEngineGraph } from '../../../docs/live.js';
// @ts-expect-error — untyped JS module
import { ACTIONS, TEMPLATES } from '../../../docs/catalog.js';
// @ts-expect-error — untyped JS module
import { __DICT_FOR_TESTS, __LIVE_DICT_FOR_TESTS } from '../../../docs/i18n.js';
import { createWebServer } from '../src/server.js';

type EditorNode = {
  id: string;
  action: string;
  label: string;
  config: Record<string, unknown>;
  connectionId: string | null;
  disabled: boolean;
};

function fromTemplate(tpl: { nodes: Array<{ id: string; action: string }>; edges: string[][] }) {
  return {
    nodes: tpl.nodes.map((n): EditorNode => ({
      id: n.id,
      action: n.action,
      label: '',
      config: { x: 1 },
      connectionId: null,
      disabled: false,
    })),
    edges: tpl.edges.map(([source, target], i) => ({ id: `e${i + 1}`, source, target })),
  };
}

describe('live mode — editor graph ⇄ engine graph', () => {
  it('every runnable editor step has its own node type, so a saved graph reads back the same', () => {
    const types = Object.values(ACTIONS as Record<string, { type?: string }>)
      .map((a) => a.type)
      .filter(Boolean);
    expect(new Set(types).size).toBe(types.length);
  });

  it('every template becomes a valid engine graph and survives the round trip', () => {
    for (const tpl of TEMPLATES) {
      if (tpl.nodes.some((n: { action: string }) => !ACTIONS[n.action]?.type)) continue; // planned
      const editor = fromTemplate(tpl);
      editor.nodes[1] && Object.assign(editor.nodes[1], { label: 'Мой шаг', disabled: true });
      const graph = toEngineGraph(editor);
      for (const n of graph.nodes) expect(WorkflowNodeSchema.safeParse(n).success).toBe(true);
      for (const e of graph.edges) expect(WorkflowEdgeSchema.safeParse(e).success).toBe(true);
      const check = validateWorkflowGraph(graph.nodes, graph.edges, { requireSingleTrigger: true });
      expect(check.errors, tpl.id).toEqual([]);
      expect(fromEngineGraph(graph.nodes, graph.edges), tpl.id).toEqual(editor);
    }
  });

  it('has every live-mode text in both languages', () => {
    const ru = Object.keys(__LIVE_DICT_FOR_TESTS.ru).sort();
    const en = Object.keys(__LIVE_DICT_FOR_TESTS.en).sort();
    expect(ru).toEqual(en);
    // Overrides only replace existing keys or add live-only ones; none is empty.
    for (const lang of ['ru', 'en'] as const) {
      for (const [k, v] of Object.entries(__LIVE_DICT_FOR_TESTS[lang])) {
        expect(String(v).trim(), k).not.toBe('');
      }
    }
    expect(__DICT_FOR_TESTS.ru['run.simulated']).toBeTruthy();
  });
});

describe('web server', () => {
  const root = mkdtempSync(join(tmpdir(), 'opennodes-web-'));
  writeFileSync(join(root, 'index.html'), '<!doctype html><title>OpenNodes</title>');
  writeFileSync(join(root, 'app.js'), 'export {};');
  writeFileSync(join(root, '.env'), 'SECRET=1');
  writeFileSync(join(root, '..', 'outside.txt'), 'outside');

  let api: http.Server;
  let web: http.Server;
  let base = '';
  const seen: Array<{ method?: string; url?: string; auth?: string; body: string }> = [];

  beforeAll(async () => {
    api = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        seen.push({ method: req.method, url: req.url, auth: req.headers.authorization, body });
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ ok: true }));
      });
    });
    await new Promise<void>((r) => api.listen(0, '127.0.0.1', r));
    web = createWebServer({
      root,
      apiUrl: `http://127.0.0.1:${(api.address() as AddressInfo).port}`,
    });
    await new Promise<void>((r) => web.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(web.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    await new Promise<void>((r) => web.close(() => r()));
    await new Promise<void>((r) => api.close(() => r()));
  });

  it('serves the editor and switches it to the API via /config.js', async () => {
    const index = await fetch(`${base}/`);
    expect(index.status).toBe(200);
    expect(index.headers.get('content-type')).toMatch(/text\/html/);
    expect(index.headers.get('content-security-policy')).toMatch(/default-src 'self'/);
    expect((await fetch(`${base}/app.js`)).headers.get('content-type')).toMatch(/javascript/);
    expect(await (await fetch(`${base}/config.js`)).text()).toContain("api: '/api/v1'");
  });

  it('forwards /api with method, headers and body to the API', async () => {
    const res = await fetch(`${base}/api/v1/workflows/x/draft?y=1`, {
      method: 'PUT',
      headers: { authorization: 'Bearer t', 'content-type': 'application/json' },
      body: JSON.stringify({ a: 'б' }),
    });
    expect(res.status).toBe(200);
    expect(seen.at(-1)).toEqual({
      method: 'PUT',
      url: '/api/v1/workflows/x/draft?y=1',
      auth: 'Bearer t',
      body: '{"a":"б"}',
    });
  });

  it('does not serve dotfiles or anything outside its folder', async () => {
    expect((await fetch(`${base}/.env`)).status).toBe(404);
    expect((await fetch(`${base}/..%2Foutside.txt`)).status).toBe(404);
    expect((await fetch(`${base}/%2e%2e/outside.txt`)).status).toBe(404);
    expect((await fetch(`${base}/missing.js`)).status).toBe(404);
  });

  it('explains when the API is down instead of hanging', async () => {
    const lonely = createWebServer({ root, apiUrl: 'http://127.0.0.1:1' });
    await new Promise<void>((r) => lonely.listen(0, '127.0.0.1', r));
    const port = (lonely.address() as AddressInfo).port;
    const res = await fetch(`http://127.0.0.1:${port}/api/v1/me`);
    expect(res.status).toBe(502);
    expect((await res.json()).code).toBe('ERR_API_UNREACHABLE');
    await new Promise<void>((r) => lonely.close(() => r()));
  });
});
