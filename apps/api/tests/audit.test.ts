/**
 * Audit: how steps hand data to each other. Every scenario runs real executors against
 * local stand-ins (Telegram Bot API, an OpenAI-compatible model, Ollama, an RSS feed, a
 * JSON API and a webhook receiver). Tests that fail here expose bugs on purpose.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { LocalFlowApiServer } from '../src/index.js';
// The editor's catalog: every runnable step, its fields and the output keys it offers.
import { ACTIONS } from '../../../docs/catalog.js';

// ── Stand-in services ────────────────────────────────────────────────────────

const TOKEN = '888:audit-token';
type Sent = { method: string; body: any };
let tgSent: Sent[] = [];
let modelRequests: any[] = [];
let modelReply: (body: any) => string = (b) => `AI: ${b.messages.at(-1).content}`;
let ollamaRequests: any[] = [];
let hookBodies: Array<{ headers: http.IncomingHttpHeaders; raw: string }> = [];
let echoRequests: Array<{ method: string; headers: http.IncomingHttpHeaders; raw: string }> = [];
let jsonResponse: unknown = { ok: true };
let feed: Array<{ guid: string; title: string; link: string; image?: string }> = [];

const TG_TAGS =
  /^<\/?(b|strong|i|em|u|ins|s|strike|del|a|code|pre|span|tg-spoiler|tg-emoji|blockquote)\b[^>]*>/i;
/** What Telegram says about HTML text it cannot parse (per the Bot API rules). */
function tgHtmlProblem(text: string): string | undefined {
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '<' && !TG_TAGS.test(text.slice(i))) {
      return `Bad Request: can't parse entities: Unsupported start tag at byte offset ${i}`;
    }
    if (text[i] === '&' && !/^&(lt|gt|amp|quot|#\d+|#x[0-9a-f]+);/i.test(text.slice(i))) {
      return `Bad Request: can't parse entities: Character '&' is reserved at byte offset ${i}`;
    }
  }
  return undefined;
}

function telegram(method: string, body: any): { status: number; json: any } {
  const text = method === 'sendMessage' ? body.text : body.caption;
  const limit = method === 'sendMessage' ? 4096 : 1024;
  if (typeof text === 'string' && text.length > limit) {
    return {
      status: 400,
      json: {
        ok: false,
        error_code: 400,
        description:
          method === 'sendMessage'
            ? 'Bad Request: message is too long'
            : 'Bad Request: message caption is too long',
      },
    };
  }
  if (body.parse_mode === 'HTML' && typeof text === 'string') {
    const problem = tgHtmlProblem(text);
    if (problem) return { status: 400, json: { ok: false, error_code: 400, description: problem } };
  }
  tgSent.push({ method, body });
  return { status: 200, json: { ok: true, result: { message_id: 500 + tgSent.length } } };
}

const server = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    const url = req.url ?? '/';
    const json = (status: number, data: unknown) => {
      res.statusCode = status;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(data));
    };
    const tg = url.match(/^\/bot([^/]+)\/(\w+)$/);
    if (tg) {
      if (tg[1] !== TOKEN) return json(404, { ok: false, description: 'Not Found' });
      const r = telegram(tg[2]!, JSON.parse(raw || '{}'));
      return json(r.status, r.json);
    }
    if (url === '/v1/chat/completions') {
      const body = JSON.parse(raw);
      modelRequests.push(body);
      return json(200, {
        id: 'cmpl-1',
        choices: [{ index: 0, message: { role: 'assistant', content: modelReply(body) } }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      });
    }
    if (url === '/api/generate') {
      const body = JSON.parse(raw);
      ollamaRequests.push(body);
      return json(200, { model: body.model, response: `OLLAMA: ${body.prompt}`, done: true });
    }
    if (url === '/feed.xml') {
      res.setHeader('content-type', 'application/rss+xml');
      return res.end(
        `<rss><channel>${feed
          .map(
            (i) =>
              `<item><title><![CDATA[${i.title}]]></title><link>${i.link}</link><guid>${i.guid}</guid>` +
              (i.image ? `<enclosure url="${i.image}" type="image/jpeg" length="1"/>` : '') +
              '</item>'
          )
          .join('')}</channel></rss>`
      );
    }
    if (url === '/json') return json(200, jsonResponse);
    if (url === '/echo') {
      echoRequests.push({ method: req.method ?? '', headers: req.headers, raw });
      return json(200, { method: req.method, received: raw ? JSON.parse(raw) : null });
    }
    if (url === '/slow') {
      return setTimeout(() => json(200, { slow: true }), 1500);
    }
    if (url === '/text') {
      res.setHeader('content-type', 'text/plain');
      return res.end('plain words');
    }
    if (url === '/hook') {
      hookBodies.push({ headers: req.headers, raw });
      res.statusCode = 204;
      return res.end();
    }
    if (url === '/notfound') return json(404, { error: 'nope' });
    res.statusCode = 404;
    res.end('not found');
  });
});

let host = '';
beforeAll(async () => {
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  host = `127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

function reset() {
  tgSent = [];
  modelRequests = [];
  modelReply = (b) => `AI: ${b.messages.at(-1).content}`;
  ollamaRequests = [];
  hookBodies = [];
  echoRequests = [];
  jsonResponse = { ok: true };
  feed = [];
}

// ── Graph helpers ────────────────────────────────────────────────────────────

const port = (direction: 'input' | 'output') => [
  { id: 'main', name: direction, type: 'any' as const, direction, required: false },
];
type N = ReturnType<typeof node>;
function node(
  id: string,
  type: string,
  config: Record<string, unknown> = {},
  extra: { cred?: 'tg' | 'ai'; disabled?: boolean } = {}
) {
  return {
    id,
    type,
    data: {
      label: id,
      config,
      ...(extra.cred ? { credentialId: extra.cred } : {}),
      ...(extra.disabled ? { disabled: true } : {}),
    },
    inputs: type.startsWith('trigger.') ? [] : port('input'),
    outputs: port('output'),
  };
}
const edge = (source: string, target: string, i: number | string) => ({
  id: `e_${i}_${source}_${target}`,
  source,
  sourceHandle: 'main',
  target,
  targetHandle: 'main',
});
const chain = (ids: string[]) => ids.slice(1).map((id, i) => edge(ids[i]!, id, i));

interface Ctx {
  api: LocalFlowApiServer;
  headers: Record<string, string>;
  wsId: string;
  creds: { tg: string; ai: string };
  scratchWf: string;
}

async function boot(extra: Record<string, unknown> = {}): Promise<Ctx> {
  const api = new LocalFlowApiServer({
    databaseUrl: 'pglite://memory',
    ssrfAllowlist: [host],
    telegramApiBase: `http://${host}`,
    triggerTickMs: 60_000,
    ...extra,
  } as any);
  const s = await api.inject<{ workspaceId: string; token: string }>({
    method: 'POST',
    url: '/api/v1/setup',
    body: { email: 'owner@localflow.dev', password: 'StrongPassword123!' },
  });
  const headers = { Authorization: `Bearer ${s.body.token}` };
  const cred = async (name: string, type: string, secrets: Record<string, unknown>) =>
    (
      await api.inject<{ id: string }>({
        method: 'POST',
        url: `/api/v1/workspaces/${s.body.workspaceId}/credentials`,
        headers,
        body: { name, type, secrets },
      })
    ).body.id;
  const creds = {
    tg: await cred('bot', 'telegram', { botToken: TOKEN }),
    ai: await cred('ai', 'openai-compatible', {
      baseUrl: `http://${host}/v1`,
      defaultModel: 'local-model',
    }),
  };
  const ctx: Ctx = { api, headers, wsId: s.body.workspaceId, creds, scratchWf: '' };
  ctx.scratchWf = await createWf(ctx, [node('t', 'trigger.manual')], []);
  return ctx;
}

/** Puts real credential ids in place of the 'tg' / 'ai' placeholders. */
function withCreds(ctx: Ctx, nodes: N[]): N[] {
  return nodes.map((n) => {
    const c = (n.data as { credentialId?: string }).credentialId;
    return c === 'tg' || c === 'ai' ? { ...n, data: { ...n.data, credentialId: ctx.creds[c] } } : n;
  });
}

async function createWf(ctx: Ctx, nodes: N[], edges: ReturnType<typeof edge>[]) {
  const wf = await ctx.api.inject<{ id: string }>({
    method: 'POST',
    url: `/api/v1/workspaces/${ctx.wsId}/workflows`,
    headers: ctx.headers,
    body: { name: `audit ${Math.random()}`, nodes: withCreds(ctx, nodes), edges },
  });
  expect(wf.statusCode).toBe(201);
  return wf.body.id;
}

async function publish(ctx: Ctx, nodes: N[], edges = chain(nodes.map((n) => n.id))) {
  const id = await createWf(ctx, nodes, edges);
  const pub = await ctx.api.inject({
    method: 'POST',
    url: `/api/v1/workflows/${id}/publish`,
    headers: ctx.headers,
  });
  expect(pub.statusCode).toBe(201);
  return id;
}

type Step = {
  nodeId: string;
  status: string;
  inputPayload: any;
  outputPayload: any;
  errorMessage: string | null;
};
type RunResult = {
  execution: { id: string; status: string; errorMessage?: string | null };
  steps: Step[];
  step: (id: string) => Step;
};
const withStep = (body: any): RunResult => ({
  ...body,
  step: (id: string) => {
    const s = body.steps.find((x: Step) => x.nodeId === id);
    if (!s) throw new Error(`no step ${id}: ${JSON.stringify(body)}`);
    return s;
  },
});

/** The editor's "Test": real steps, nothing recorded. */
async function testRun(
  ctx: Ctx,
  nodes: N[],
  payload: unknown = {},
  edges = chain(nodes.map((n) => n.id))
): Promise<RunResult> {
  const res = await ctx.api.inject<any>({
    method: 'POST',
    url: `/api/v1/workflows/${ctx.scratchWf}/test-run`,
    headers: ctx.headers,
    body: { nodes: withCreds(ctx, nodes), edges, payload },
  });
  expect(res.statusCode, JSON.stringify(res.body)).toBe(200);
  return withStep(res.body);
}

/** A real, recorded run of the published version. */
async function execute(ctx: Ctx, wfId: string, payload: unknown = {}): Promise<RunResult> {
  const res = await ctx.api.inject<any>({
    method: 'POST',
    url: `/api/v1/workflows/${wfId}/execute`,
    headers: ctx.headers,
    body: { payload, wait: true, waitTimeoutMs: 20_000 },
  });
  return withStep(res.body);
}

async function waitSettled(ctx: Ctx, executionId: string, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const res = await ctx.api.inject<any>({
      method: 'GET',
      url: `/api/v1/executions/${executionId}`,
      headers: ctx.headers,
    });
    const st = res.body.execution?.status;
    if (['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(st) || Date.now() > deadline) {
      return withStep(res.body);
    }
    await new Promise((r) => setTimeout(r, 150));
  }
}

const trig = (cfg: Record<string, unknown> = {}) => node('t', 'trigger.manual', cfg);
const compose = (id: string, template: string, extra = {}) =>
  node(id, 'text.compose', { template }, extra);
const tgSend = (id: string, cfg: Record<string, unknown>, extra = {}) =>
  node(id, 'core.telegramBot', { chatId: '@chan', ...cfg }, { cred: 'tg', ...extra });

// ═════════════════════════════════════════════════════════════════════════════

describe('audit — every catalog output key is in the real step output', () => {
  let ctx: Ctx;
  beforeAll(async () => {
    ctx = await boot();
  }, 30_000);
  afterAll(() => ctx.api.close());

  const outputsOf = (type: string) =>
    (Object.values(ACTIONS) as any[])
      .find((a) => a.type === type)
      ?.outputs?.map((o: any) => o.key) ?? [];

  const cases: Array<[string, () => N, Record<string, unknown>?]> = [
    [
      'ai.openai',
      () =>
        node(
          's',
          'ai.openai',
          { prompt: 'Hi', model: 'gpt-4o-mini', temperature: 0.7 },
          { cred: 'ai' }
        ),
    ],
    [
      'ai.classify',
      () =>
        node(
          's',
          'ai.classify',
          { text: 'Where is my order?', categories: 'Question, Spam' },
          { cred: 'ai' }
        ),
    ],
    [
      'ai.process',
      () => node('s', 'ai.process', { input: 'data', instruction: 'summarize' }, { cred: 'ai' }),
    ],
    [
      'ai.ollama',
      () => node('s', 'ai.ollama', { prompt: 'Hi', model: 'llama3', baseUrl: `http://${host}` }),
    ],
    ['core.telegramBot', () => tgSend('s', { text: 'hello' })],
    [
      'telegram.sendFile',
      () =>
        node(
          's',
          'telegram.sendFile',
          { chatId: '@c', fileUrl: 'https://x.test/a.png', kind: 'photo', caption: 'c' },
          { cred: 'tg' }
        ),
    ],
    [
      'core.rss',
      () =>
        node('s', 'core.rss', { feedUrl: `http://${host}/feed.xml`, maxItems: 5, onlyNew: true }),
    ],
    ['text.compose', () => compose('s', 'x')],
    [
      'core.httpRequest',
      () => node('s', 'core.httpRequest', { url: `http://${host}/json`, method: 'GET' }),
    ],
    [
      'core.outgoingWebhook',
      () => node('s', 'core.outgoingWebhook', { url: `http://${host}/hook`, payload: { a: 1 } }),
    ],
  ];

  for (const [type, make] of cases) {
    it(`${type}: outputs ${outputsOf(type).join(', ') || '(none)'}`, async () => {
      reset();
      feed = [
        { guid: 'g1', title: 'One', link: 'https://x.test/1', image: 'https://x.test/1.jpg' },
      ];
      const res = await testRun(ctx, [trig(), make()]);
      expect(res.execution.status, JSON.stringify(res.steps)).toBe('SUCCEEDED');
      const out = res.step('s').outputPayload;
      for (const key of outputsOf(type)) {
        expect(out, `${type} lacks "${key}"`).toHaveProperty(key);
        expect(out[key], `${type}.${key} is empty`).not.toBeNull();
      }
    });
  }

  it('every catalog step with a type is one this server can run', async () => {
    const res = await ctx.api.inject<{ nodeTypes: string[]; notImplemented: string[] }>({
      method: 'GET',
      url: '/api/v1/catalog',
      headers: ctx.headers,
    });
    const runnable = new Set(res.body.nodeTypes);
    const notImpl = new Set(res.body.notImplemented);
    const missing = (Object.values(ACTIONS) as any[])
      .map((a) => a.type)
      .filter((t) => t && !runnable.has(t) && !notImpl.has(t));
    expect(missing).toEqual([]);
  });

  it('trigger keys reach $trigger: manual text, cron firedAt, webhook form fields', async () => {
    reset();
    const res = await testRun(
      ctx,
      [
        trig(),
        compose(
          'c',
          '{{ $trigger.text }}|{{ $trigger.firedAt }}|{{ $trigger.name }}|{{ $trigger.budget }}'
        ),
      ],
      { text: 'hi', firedAt: '2026-11-02T09:00:00Z', name: 'Ivan', budget: 1500 }
    );
    expect(res.step('c').outputPayload.text).toBe('hi|2026-11-02T09:00:00Z|Ivan|1500');
  });
});

// ═════════════════════════════════════════════════════════════════════════════

describe('audit — chains of steps (recorded runs)', () => {
  let ctx: Ctx;
  beforeAll(async () => {
    ctx = await boot();
  }, 30_000);
  afterAll(() => ctx.api.close());

  it('manual → compose → condition(true) → delay 1 s → AI → Telegram → HTTP → webhook: each step gets the previous data', async () => {
    reset();
    const wf = await publish(ctx, [
      trig(),
      compose('c', 'Lead: {{ $trigger.text }} ({{ $trigger.n }})'),
      node('if', 'logic.condition', {
        left: '{{ $nodes.c.output.text }}',
        operator: 'contains',
        right: 'lead',
      }),
      node('d', 'primitive.delay', { amount: 1, unit: 'seconds' }),
      node(
        'ai',
        'ai.openai',
        {
          prompt: 'Answer: {{ $nodes.c.output.text }}',
          model: 'gpt-4o-mini',
          temperature: 0.7,
          maxTokens: 50,
        },
        { cred: 'ai' }
      ),
      tgSend('tg', { text: '{{ $nodes.ai.output.text }}' }),
      node('http', 'core.httpRequest', {
        url: `http://${host}/echo`,
        method: 'POST',
        body: {
          messageId: '{{ $nodes.tg.output.messageId }}',
          text: '{{ $nodes.ai.output.text }}',
        },
      }),
      node('wh', 'core.outgoingWebhook', {
        url: `http://${host}/hook`,
        payload: {
          status: '{{ $nodes.http.output.status }}',
          echoed: '{{ $nodes.http.output.body.received.text }}',
        },
      }),
    ]);
    const res = await execute(ctx, wf, { text: 'Анна 👋', n: 3 });
    expect(res.execution.status, JSON.stringify(res.steps)).toBe('SUCCEEDED');
    expect(res.step('d').outputPayload.delayedMs).toBe(1000);
    expect(modelRequests[0].messages.at(-1).content).toBe('Answer: Lead: Анна 👋 (3)');
    expect(modelRequests[0].temperature).toBe(0.7);
    expect(modelRequests[0].max_tokens).toBe(50);
    expect(tgSent[0]!.body.text).toBe('AI: Answer: Lead: Анна 👋 (3)');
    expect(JSON.parse(echoRequests[0]!.raw)).toEqual({
      messageId: 501,
      text: 'AI: Answer: Lead: Анна 👋 (3)',
    });
    expect(JSON.parse(hookBodies[0]!.raw)).toEqual({
      status: 200,
      echoed: 'AI: Answer: Lead: Анна 👋 (3)',
    });
  });

  it('condition false: the steps below are SKIPPED, nothing is sent, the run succeeds', async () => {
    reset();
    const wf = await publish(ctx, [
      trig(),
      node('if', 'logic.condition', {
        left: '{{ $trigger.text }}',
        operator: 'equals',
        right: 'yes',
      }),
      tgSend('tg', { text: 'never' }),
      compose('after', 'after'),
    ]);
    const res = await execute(ctx, wf, { text: 'no' });
    expect(res.execution.status).toBe('SUCCEEDED');
    expect(res.step('if').outputPayload.passed).toBe(false);
    expect(res.step('tg').status).toBe('SKIPPED');
    expect(res.step('after').status).toBe('SKIPPED');
    expect(tgSent).toEqual([]);
  });

  it('RSS → AI process → Telegram photo: the feed reaches the model and the post', async () => {
    reset();
    feed = [
      { guid: 'a', title: 'Первая', link: `http://${host}/a`, image: 'https://x.test/a.jpg' },
      { guid: 'b', title: 'Вторая', link: `http://${host}/b` },
    ];
    const wf = await publish(ctx, [
      trig(),
      node('rss', 'core.rss', { feedUrl: `http://${host}/feed.xml`, maxItems: 2, onlyNew: true }),
      node(
        'p',
        'ai.process',
        { input: '{{ $nodes.rss.output.digest }}', instruction: 'Make a post' },
        { cred: 'ai' }
      ),
      tgSend('tg', {
        text: '{{ $nodes.p.output.text }}',
        imageUrl: '{{ $nodes.rss.output.image }}',
      }),
    ]);
    const res = await execute(ctx, wf);
    expect(res.execution.status, JSON.stringify(res.steps)).toBe('SUCCEEDED');
    expect(modelRequests[0].messages.at(-1).content).toContain(
      `Первая — http://${host}/a\nВторая — http://${host}/b`
    );
    expect(tgSent[0]!.method).toBe('sendPhoto');
    expect(tgSent[0]!.body.photo).toBe('https://x.test/a.jpg');
    // Second run: nothing new → the steps below stop, no empty post.
    const again = await execute(ctx, wf);
    expect(again.execution.status).toBe('SUCCEEDED');
    expect(again.step('p').status).toBe('SKIPPED');
    expect(tgSent).toHaveLength(1);
  });

  it('classify → condition on the category → Telegram', async () => {
    reset();
    modelReply = () => 'Complaint.';
    const wf = await publish(ctx, [
      trig(),
      node(
        'cl',
        'ai.classify',
        { text: '{{ $trigger.text }}', categories: 'Question, Complaint, Order' },
        { cred: 'ai' }
      ),
      node('if', 'logic.condition', {
        left: '{{ $nodes.cl.output.category }}',
        operator: 'equals',
        right: 'complaint',
      }),
      tgSend('tg', { text: 'Complaint from {{ $trigger.name }}: {{ $trigger.text }}' }),
    ]);
    const res = await execute(ctx, wf, { text: 'Bad service', name: 'Bob' });
    expect(res.execution.status).toBe('SUCCEEDED');
    expect(res.step('cl').outputPayload.category).toBe('Complaint');
    expect(tgSent[0]!.body.text).toBe('Complaint from Bob: Bad service');
  });

  it('webhook trigger (JSON) → compose → Telegram: nested fields and arrays', async () => {
    reset();
    const wf = await publish(ctx, [
      node('t', 'trigger.webhook', { path: '/hooks/lead' }),
      compose(
        'c',
        '{{ $trigger.name }} <{{ $trigger.contact.email }}> {{ $trigger.tags[1] }} {{ $trigger["first-name"] }}'
      ),
      tgSend('tg', { text: '{{ $nodes.c.output.text }}' }),
    ]);
    const wh = await ctx.api.inject<{ executionId: string }>({
      method: 'POST',
      url: `/api/v1/webhooks/${wf}`,
      body: { name: 'Ivan', contact: { email: 'i@x.test' }, tags: ['a', 'b'], 'first-name': 'Iv' },
    });
    expect(wh.statusCode).toBe(202);
    const res = await waitSettled(ctx, wh.body.executionId);
    expect(res.execution.status, JSON.stringify(res.steps)).toBe('SUCCEEDED');
    expect(tgSent[0]!.body.text).toBe('Ivan <i@x.test> b Iv');
  });

  it('webhook trigger receiving an HTML form (application/x-www-form-urlencoded): $trigger.name is the form field', async () => {
    reset();
    const wf = await publish(ctx, [
      node('t', 'trigger.webhook', { path: '/hooks/lead' }),
      compose('c', 'Name={{ $trigger.name }} Email={{ $trigger.email }}'),
    ]);
    const listenPort = await ctx.api.listen(0, '127.0.0.1');
    try {
      const r = await fetch(`http://127.0.0.1:${listenPort}/api/v1/webhooks/${wf}`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: 'name=Ivan&email=ivan%40example.com',
      });
      expect(r.status).toBe(202);
      const { executionId } = (await r.json()) as { executionId: string };
      const res = await waitSettled(ctx, executionId);
      expect(res.execution.status).toBe('SUCCEEDED');
      expect(res.step('c').outputPayload.text).toBe('Name=Ivan Email=ivan@example.com');
    } finally {
      await (ctx.api as any).httpServer?.close();
      (ctx.api as any).httpServer = undefined;
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════

describe('audit — expression values crossing steps', () => {
  let ctx: Ctx;
  beforeAll(async () => {
    ctx = await boot();
  }, 30_000);
  afterAll(() => ctx.api.close());

  const payload = {
    n: 42,
    zero: 0,
    flag: true,
    no: false,
    nil: null,
    obj: { a: 1, b: 'x' },
    list: ['a', 'b'],
    uni: 'Привет 👋🏽 世界',
    quotes: `He said "hi" and 'bye' \\ back`,
    lines: 'line1\nline2\r\nline3',
  };

  it('text.compose embeds every value type as text (objects/arrays as JSON, null/missing as empty)', async () => {
    const res = await testRun(
      ctx,
      [
        trig(),
        compose(
          'c',
          'n={{ $trigger.n }} z={{ $trigger.zero }} f={{ $trigger.flag }} no={{ $trigger.no }} nil={{ $trigger.nil }} miss={{ $trigger.nope }} deep={{ $trigger.nope.deeper }} obj={{ $trigger.obj }} list={{ $trigger.list }} u={{ $trigger.uni }} q={{ $trigger.quotes }}'
        ),
        compose('whole', '{{ $trigger.obj }}'),
        compose('lines', '{{ $trigger.lines }}'),
      ],
      payload
    );
    expect(res.execution.status).toBe('SUCCEEDED');
    expect(res.step('c').outputPayload.text).toBe(
      `n=42 z=0 f=true no=false nil= miss= deep= obj={"a":1,"b":"x"} list=["a","b"] u=Привет 👋🏽 世界 q=He said "hi" and 'bye' \\ back`
    );
    expect(res.step('whole').outputPayload.text).toBe('{"a":1,"b":"x"}');
    expect(res.step('lines').outputPayload.text).toBe('line1\nline2\r\nline3');
  });

  it('JSON fields keep value types: number, boolean, null, object stay typed; text around an expression makes a string', async () => {
    reset();
    const res = await testRun(
      ctx,
      [
        trig(),
        node('http', 'core.httpRequest', {
          url: `http://${host}/echo`,
          method: 'POST',
          body: {
            n: '{{ $trigger.n }}',
            flag: '{{ $trigger.flag }}',
            nil: '{{ $trigger.nil }}',
            obj: '{{ $trigger.obj }}',
            id: 'id-{{ $trigger.n }}',
            nested: { list: '{{ $trigger.list }}' },
          },
        }),
      ],
      payload
    );
    expect(res.execution.status).toBe('SUCCEEDED');
    expect(JSON.parse(echoRequests[0]!.raw)).toEqual({
      n: 42,
      flag: true,
      nil: null,
      obj: { a: 1, b: 'x' },
      id: 'id-42',
      nested: { list: ['a', 'b'] },
    });
    expect(res.step('http').outputPayload.data.received.n).toBe(42);
  });

  it('the recorded HTTP step result shows the response under "body" (the catalog key), not "[CIRCULAR]"', async () => {
    jsonResponse = { ok: true, items: [1, 2] };
    const res = await testRun(ctx, [
      trig(),
      node('http', 'core.httpRequest', { url: `http://${host}/json`, method: 'GET' }),
    ]);
    expect(res.execution.status).toBe('SUCCEEDED');
    expect(res.step('http').outputPayload.body).toEqual({ ok: true, items: [1, 2] });
  });

  it('a shared value is not shown as "[CIRCULAR]" in a recorded run either (same response object in two keys)', async () => {
    jsonResponse = { ok: true };
    const wf = await publish(ctx, [
      trig(),
      node('http', 'core.httpRequest', { url: `http://${host}/json`, method: 'GET' }),
    ]);
    const res = await execute(ctx, wf);
    expect(res.execution.status).toBe('SUCCEEDED');
    expect(res.step('http').outputPayload.body).toEqual({ ok: true });
  });

  it('unicode, emoji, quotes, backslashes and newlines arrive intact at a webhook and at Telegram', async () => {
    reset();
    const res = await testRun(
      ctx,
      [
        trig(),
        node('wh', 'core.outgoingWebhook', {
          url: `http://${host}/hook`,
          payload: {
            u: '{{ $trigger.uni }}',
            q: '{{ $trigger.quotes }}',
            l: '{{ $trigger.lines }}',
            mix: '«{{ $trigger.quotes }}»',
          },
        }),
        tgSend('tg', { text: '{{ $trigger.uni }}\n{{ $trigger.quotes }}\n{{ $trigger.lines }}' }),
      ],
      payload
    );
    expect(res.execution.status).toBe('SUCCEEDED');
    expect(JSON.parse(hookBodies[0]!.raw)).toEqual({
      u: payload.uni,
      q: payload.quotes,
      l: payload.lines,
      mix: `«${payload.quotes}»`,
    });
    expect(hookBodies[0]!.headers['content-type']).toBe('application/json');
    expect(tgSent[0]!.body.text).toBe(`${payload.uni}\n${payload.quotes}\n${payload.lines}`);
  });

  it('a Telegram text that is only {{ object }} is sent as JSON, like text.compose does — not "[object Object]"', async () => {
    reset();
    const res = await testRun(
      ctx,
      [
        trig(),
        tgSend('obj', { text: '{{ $trigger.obj }}' }),
        tgSend('arr', { text: '{{ $trigger.list }}' }),
      ],
      payload
    );
    expect(res.execution.status).toBe('SUCCEEDED');
    expect(tgSent.map((s) => s.body.text)).toEqual(['{"a":1,"b":"x"}', '["a","b"]']);
  });

  it('AI prompt that is only a number ({{ $trigger.n }}) is sent to the model', async () => {
    reset();
    const res = await testRun(
      ctx,
      [
        trig(),
        node(
          'ai',
          'ai.openai',
          { prompt: '{{ $trigger.n }}', model: 'gpt-4o-mini' },
          { cred: 'ai' }
        ),
      ],
      payload
    );
    expect(res.execution.status, res.step('ai').errorMessage ?? '').toBe('SUCCEEDED');
    expect(modelRequests[0]?.messages.at(-1).content).toBe('42');
  });

  it("AI prompt that is only another step's count ({{ $nodes.rss.output.count }}) works", async () => {
    reset();
    feed = [{ guid: '1', title: 'T', link: 'https://x.test/1' }];
    const res = await testRun(ctx, [
      trig(),
      node('rss', 'core.rss', { feedUrl: `http://${host}/feed.xml`, maxItems: 5 }),
      node(
        'ai',
        'ai.openai',
        { prompt: '{{ $nodes.rss.output.count }}', model: 'gpt-4o-mini' },
        { cred: 'ai' }
      ),
    ]);
    expect(res.execution.status, res.step('ai').errorMessage ?? '').toBe('SUCCEEDED');
  });

  it('AI process with structured data ({{ $nodes.rss.output.items }}) gives the model the items, not "[object Object]"', async () => {
    reset();
    feed = [
      { guid: '1', title: 'Alpha', link: 'https://x.test/1' },
      { guid: '2', title: 'Beta', link: 'https://x.test/2' },
    ];
    const res = await testRun(ctx, [
      trig(),
      node('rss', 'core.rss', { feedUrl: `http://${host}/feed.xml`, maxItems: 5 }),
      node(
        'p',
        'ai.process',
        { input: '{{ $nodes.rss.output.items }}', instruction: 'Summarize' },
        { cred: 'ai' }
      ),
    ]);
    expect(res.execution.status).toBe('SUCCEEDED');
    const sent = modelRequests[0].messages.at(-1).content as string;
    expect(sent).not.toContain('[object Object]');
    expect(sent).toContain('Alpha');
  });

  it('AI classify of an object ({{ $trigger.obj }}) sends its content, not "[object Object]"', async () => {
    reset();
    const res = await testRun(
      ctx,
      [
        trig(),
        node(
          'cl',
          'ai.classify',
          { text: '{{ $trigger.obj }}', categories: 'A, B' },
          { cred: 'ai' }
        ),
      ],
      payload
    );
    expect(res.execution.status).toBe('SUCCEEDED');
    expect(modelRequests[0].messages.at(-1).content).not.toContain('[object Object]');
  });

  it('data is never evaluated twice: a "{{ … }}" inside user data stays literal down the chain', async () => {
    reset();
    const res = await testRun(
      ctx,
      [
        trig(),
        compose('a', 'Got: {{ $trigger.text }}'),
        tgSend('tg', { text: '{{ $nodes.a.output.text }}' }),
      ],
      { text: '{{ $env.WORKSPACE_ID }}' }
    );
    expect(res.execution.status).toBe('SUCCEEDED');
    expect(tgSent[0]!.body.text).toBe('Got: {{ $env.WORKSPACE_ID }}');
  });

  it('a step two hops back and the trigger are both reachable', async () => {
    reset();
    const res = await testRun(
      ctx,
      [
        trig(),
        compose('a', 'A[{{ $trigger.n }}]'),
        compose('b', 'B[{{ $nodes.a.output.text }}]'),
        compose('c', '{{ $nodes.a.output.text }} {{ $nodes.b.output.text }} {{ $trigger.uni }}'),
      ],
      payload
    );
    expect(res.step('c').outputPayload.text).toBe(`A[42] B[A[42]] ${payload.uni}`);
  });

  it('missing step / missing key → empty text, the run continues', async () => {
    const res = await testRun(ctx, [
      trig(),
      compose('c', '[{{ $nodes.ghost.output.text }}][{{ $nodes.t.output.nope }}]'),
    ]);
    expect(res.execution.status).toBe('SUCCEEDED');
    expect(res.step('c').outputPayload.text).toBe('[][]');
  });

  it('paths: [index], .index, ["key with-dash"], .length', async () => {
    jsonResponse = { items: [{ name: 'first' }, { name: 'second' }], 'x-y': 'dash' };
    const res = await testRun(ctx, [
      trig(),
      node('http', 'core.httpRequest', { url: `http://${host}/json`, method: 'GET' }),
      compose(
        'c',
        '{{ $nodes.http.output.body.items[1].name }}|{{ $nodes.http.output.body.items.0.name }}|{{ $nodes.http.output.body["x-y"] }}|{{ $nodes.http.output.body.items.length }}'
      ),
    ]);
    expect(res.execution.status, JSON.stringify(res.steps)).toBe('SUCCEEDED');
    expect(res.step('c').outputPayload.text).toBe('second|first|dash|2');
  });

  it('a Cyrillic form field name works in an expression ({{ $trigger.имя }})', async () => {
    const res = await testRun(ctx, [trig(), compose('c', 'Имя: {{ $trigger.имя }}')], {
      имя: 'Иван',
    });
    expect(res.execution.status, res.step('c').errorMessage ?? '').toBe('SUCCEEDED');
    expect(res.step('c').outputPayload.text).toBe('Имя: Иван');
  });

  it('Cyrillic field via bracket notation ({{ $trigger["имя"] }}) works', async () => {
    const res = await testRun(ctx, [trig(), compose('c', 'Имя: {{ $trigger["имя"] }}')], {
      имя: 'Иван',
    });
    expect(res.step('c').outputPayload.text).toBe('Имя: Иван');
  });
});

// ═════════════════════════════════════════════════════════════════════════════

describe('audit — disabled steps, branches and joins', () => {
  let ctx: Ctx;
  beforeAll(async () => {
    ctx = await boot();
  }, 30_000);
  afterAll(() => ctx.api.close());

  it('a disabled step in the middle is passed over; references to it become empty', async () => {
    reset();
    const res = await testRun(ctx, [
      trig(),
      compose('a', 'A'),
      compose('off', 'OFF', { disabled: true }),
      tgSend('tg', { text: '<{{ $nodes.off.output.text }}>{{ $nodes.a.output.text }}' }),
    ]);
    expect(res.execution.status).toBe('SUCCEEDED');
    expect(res.step('off').status).toBe('SKIPPED');
    expect(res.step('off').outputPayload).toEqual({ disabled: true });
    expect(tgSent[0]!.body.text).toBe('<>A');
  });

  it('a disabled false condition does not stop the flow', async () => {
    reset();
    const res = await testRun(ctx, [
      trig(),
      node(
        'if',
        'logic.condition',
        { left: 'a', operator: 'equals', right: 'b' },
        { disabled: true }
      ),
      tgSend('tg', { text: 'went on' }),
    ]);
    expect(res.step('tg').status).toBe('SUCCEEDED');
  });

  it('a disabled Telegram step sends nothing and the next step still runs', async () => {
    reset();
    const res = await testRun(ctx, [
      trig(),
      tgSend('tg', { text: 'x' }, { disabled: true }),
      compose('after', 'id={{ $nodes.tg.output.messageId }}'),
    ]);
    expect(tgSent).toEqual([]);
    expect(res.step('after').outputPayload.text).toBe('id=');
  });

  it('branch then join: the join runs once, after both branches, with both outputs', async () => {
    reset();
    const nodes = [
      trig(),
      compose('left', 'L{{ $trigger.n }}'),
      compose('right', 'R{{ $trigger.n }}'),
      compose('join', '{{ $nodes.left.output.text }}+{{ $nodes.right.output.text }}'),
    ];
    const edges = [
      edge('t', 'left', 1),
      edge('t', 'right', 2),
      edge('left', 'join', 3),
      edge('right', 'join', 4),
    ];
    const res = await testRun(ctx, nodes, { n: 1 }, edges);
    expect(res.execution.status).toBe('SUCCEEDED');
    expect(res.steps.filter((s) => s.nodeId === 'join')).toHaveLength(1);
    expect(res.step('join').outputPayload.text).toBe('L1+R1');
  });

  it('branch with a false condition then join: the join still runs (any incoming branch is enough)', async () => {
    reset();
    const nodes = [
      trig(),
      node('yes', 'logic.condition', { left: 'x', operator: 'notEmpty' }),
      node('no', 'logic.condition', { left: '', operator: 'notEmpty' }),
      compose('a', 'A'),
      compose('b', 'B'),
      compose('join', '[{{ $nodes.a.output.text }}][{{ $nodes.b.output.text }}]'),
    ];
    const edges = [
      edge('t', 'yes', 1),
      edge('t', 'no', 2),
      edge('yes', 'a', 3),
      edge('no', 'b', 4),
      edge('a', 'join', 5),
      edge('b', 'join', 6),
    ];
    const res = await testRun(ctx, nodes, {}, edges);
    expect(res.step('b').status).toBe('SKIPPED');
    expect(res.step('join').status).toBe('SUCCEEDED');
    expect(res.step('join').outputPayload.text).toBe('[A][]');
  });
});

// ═════════════════════════════════════════════════════════════════════════════

describe('audit — condition operators', () => {
  let ctx: Ctx;
  beforeAll(async () => {
    ctx = await boot();
  }, 30_000);
  afterAll(() => ctx.api.close());

  const check = async (
    left: string,
    operator: string,
    right: string | undefined,
    payload: unknown
  ) => {
    const res = await testRun(
      ctx,
      [
        trig(),
        node('if', 'logic.condition', { left, operator, ...(right !== undefined && { right }) }),
      ],
      payload
    );
    expect(res.execution.status).toBe('SUCCEEDED');
    return res.step('if').outputPayload.passed as boolean;
  };

  it('equals ignores case/spaces; gte compares numbers given as numbers or text; contains is case-insensitive', async () => {
    expect(await check('{{ $trigger.s }}', 'equals', 'yes', { s: '  YES ' })).toBe(true);
    expect(await check('{{ $trigger.n }}', 'gte', '1000', { n: 1500 })).toBe(true);
    expect(await check('{{ $trigger.n }}', 'gte', '1000', { n: '999' })).toBe(false);
    expect(await check('{{ $trigger.n }}', 'gte', '1000', { n: 'abc' })).toBe(false);
    expect(await check('{{ $trigger.flag }}', 'equals', 'true', { flag: true })).toBe(true);
    expect(await check('{{ $trigger.s }}', 'contains', 'ПРИВЕТ', { s: 'ну привет!' })).toBe(true);
  });

  it('notEmpty: missing / null / blank are empty', async () => {
    expect(await check('{{ $trigger.nope }}', 'notEmpty', undefined, {})).toBe(false);
    expect(await check('{{ $trigger.nil }}', 'notEmpty', undefined, { nil: null })).toBe(false);
    expect(await check('{{ $trigger.s }}', 'notEmpty', undefined, { s: '   ' })).toBe(false);
  });

  it('notEmpty: an empty list (e.g. RSS items with nothing in the feed) is empty', async () => {
    expect(await check('{{ $trigger.items }}', 'notEmpty', undefined, { items: [] })).toBe(false);
    expect(await check('{{ $trigger.obj }}', 'notEmpty', undefined, { obj: {} })).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════

describe('audit — Telegram formatting and limits', () => {
  let ctx: Ctx;
  beforeAll(async () => {
    ctx = await boot();
  }, 30_000);
  afterAll(() => ctx.api.close());

  it('an AI answer longer than 4096 characters is still delivered (Telegram limit)', async () => {
    reset();
    modelReply = () => 'Long answer. '.repeat(400); // 5200 characters
    const res = await testRun(ctx, [
      trig(),
      node(
        'ai',
        'ai.openai',
        { prompt: 'Write a long text', model: 'gpt-4o-mini' },
        { cred: 'ai' }
      ),
      tgSend('tg', { text: '{{ $nodes.ai.output.text }}' }),
    ]);
    expect(res.step('tg').errorMessage).toBeNull();
    expect(res.execution.status).toBe('SUCCEEDED');
    expect(tgSent.length).toBeGreaterThanOrEqual(2);
    expect(
      tgSent
        .map((s) => s.body.text)
        .join('')
        .replace(/\s/g, '')
    ).toBe('Long answer. '.repeat(400).replace(/\s/g, ''));
  });

  it('HTML mode: an RSS title with "<" and "&" inserted into a template is escaped, the post goes out', async () => {
    reset();
    feed = [{ guid: '1', title: 'Q&amp;A: why 2 &lt; 3', link: 'https://x.test/1?a=1&amp;b=2' }];
    const res = await testRun(ctx, [
      trig(),
      node('rss', 'core.rss', { feedUrl: `http://${host}/feed.xml`, maxItems: 1 }),
      tgSend('tg', {
        text: '<b>{{ $nodes.rss.output.titles }}</b>\n<a href="{{ $nodes.rss.output.link }}">read</a>',
        parseMode: 'HTML',
      }),
    ]);
    expect(res.step('rss').outputPayload.titles).toBe('Q&A: why 2 < 3');
    expect(res.step('tg').errorMessage).toBeNull();
    expect(tgSent[0]?.body.text).toBe(
      '<b>Q&amp;A: why 2 &lt; 3</b>\n<a href="https://x.test/1?a=1&amp;b=2">read</a>'
    );
  });

  it('HTML mode with markup typed by the user (no data) passes through unchanged', async () => {
    reset();
    const res = await testRun(ctx, [
      trig(),
      tgSend('tg', { text: '<b>Hi</b> &amp; <i>bye</i>', parseMode: 'HTML' }),
    ]);
    expect(res.execution.status).toBe('SUCCEEDED');
    expect(tgSent[0]!.body).toMatchObject({
      text: '<b>Hi</b> &amp; <i>bye</i>',
      parse_mode: 'HTML',
    });
  });

  it('a caption over 1024 characters: photo first, then the text as its own message', async () => {
    reset();
    const long = 'x'.repeat(1500);
    const res = await testRun(
      ctx,
      [trig(), tgSend('tg', { text: '{{ $trigger.long }}', imageUrl: 'https://x.test/p.jpg' })],
      { long }
    );
    expect(res.execution.status).toBe('SUCCEEDED');
    expect(tgSent.map((s) => s.method)).toEqual(['sendPhoto', 'sendMessage']);
    expect(tgSent[0]!.body.caption).toBeUndefined();
    expect(tgSent[1]!.body.text).toBe(long);
  });

  it('send file: document kind, caption from data, numeric chat id from the trigger', async () => {
    reset();
    const res = await testRun(
      ctx,
      [
        trig(),
        node(
          'f',
          'telegram.sendFile',
          {
            chatId: '{{ $trigger.chatId }}',
            fileUrl: '{{ $trigger.url }}',
            kind: 'document',
            caption: 'Report for {{ $trigger.name }}',
          },
          { cred: 'tg' }
        ),
      ],
      { chatId: 123456789, url: 'https://x.test/r.pdf', name: 'Анна' }
    );
    expect(res.execution.status).toBe('SUCCEEDED');
    expect(tgSent[0]).toEqual({
      method: 'sendDocument',
      body: { chat_id: 123456789, document: 'https://x.test/r.pdf', caption: 'Report for Анна' },
    });
    expect(res.step('f').outputPayload.messageId).toBe(501);
  });

  it('Telegram error is a step failure with the reason, the steps below are not run', async () => {
    reset();
    const res = await testRun(ctx, [
      trig(),
      tgSend('tg', { text: '<oops>', parseMode: 'HTML' }),
      compose('after', 'x'),
    ]);
    expect(res.execution.status).toBe('FAILED');
    expect(res.step('tg').errorMessage).toContain("can't parse entities");
    expect(res.steps.find((s) => s.nodeId === 'after')?.status ?? 'NOT RUN').not.toBe('SUCCEEDED');
  });
});

// ═════════════════════════════════════════════════════════════════════════════

describe('audit — HTTP, webhook, AI and delay details', () => {
  let ctx: Ctx;
  beforeAll(async () => {
    ctx = await boot();
  }, 30_000);
  afterAll(() => ctx.api.close());

  it('HTTP request: the step\'s "Timeout, ms" field is honoured', async () => {
    const res = await testRun(ctx, [
      trig(),
      node('http', 'core.httpRequest', {
        url: `http://${host}/slow`,
        method: 'GET',
        timeoutMs: 300,
      }),
    ]);
    // The server answers after 1.5 s; a 300 ms timeout must fail the step.
    expect(res.execution.status).toBe('FAILED');
  });

  it('HTTP request: 404 is data (status 404), text bodies stay text', async () => {
    const res = await testRun(ctx, [
      trig(),
      node('nf', 'core.httpRequest', { url: `http://${host}/notfound`, method: 'GET' }),
      node('txt', 'core.httpRequest', { url: `http://${host}/text`, method: 'GET' }),
      compose(
        'c',
        '{{ $nodes.nf.output.status }} {{ $nodes.nf.output.body.error }} {{ $nodes.txt.output.body }}'
      ),
    ]);
    expect(res.execution.status).toBe('SUCCEEDED');
    expect(res.step('c').outputPayload.text).toBe('404 nope plain words');
  });

  it('HTTP request: headers from data reach the server', async () => {
    reset();
    const res = await testRun(
      ctx,
      [
        trig(),
        node('http', 'core.httpRequest', {
          url: `http://${host}/echo`,
          method: 'POST',
          headers: { 'X-Lead': '{{ $trigger.id }}' },
          body: { a: 1 },
        }),
      ],
      { id: 77 }
    );
    expect(res.execution.status).toBe('SUCCEEDED');
    expect(echoRequests[0]!.headers['x-lead']).toBe('77');
  });

  it('outgoing webhook: status key is the HTTP status', async () => {
    reset();
    const res = await testRun(ctx, [
      trig(),
      node('wh', 'core.outgoingWebhook', { url: `http://${host}/hook`, payload: { x: 1 } }),
    ]);
    expect(res.step('wh').outputPayload).toMatchObject({ status: 204, delivered: true });
  });

  it('AI: the connection default model is used when the step has none; process passes data and instruction', async () => {
    reset();
    const res = await testRun(
      ctx,
      [
        trig(),
        node('ai', 'ai.openai', { prompt: 'Q: {{ $trigger.q }}' }, { cred: 'ai' }),
        node(
          'p',
          'ai.process',
          { input: '{{ $nodes.ai.output.text }}', instruction: 'Translate' },
          { cred: 'ai' }
        ),
      ],
      { q: 'why?' }
    );
    expect(res.execution.status).toBe('SUCCEEDED');
    expect(modelRequests[0].model).toBe('local-model');
    expect(modelRequests[1].messages.at(-1).content).toContain(
      'Instruction:\nTranslate\n\nData:\nAI: Q: why?'
    );
    expect(res.step('p').outputPayload.text).toContain('AI: Instruction:');
  });

  it('AI classify: an answer "not spam" is classified as "Not spam", not "Spam"', async () => {
    reset();
    modelReply = () => 'This message is not spam.';
    const res = await testRun(ctx, [
      trig(),
      node('cl', 'ai.classify', { text: 'hello', categories: 'Spam, Not spam' }, { cred: 'ai' }),
    ]);
    expect(res.step('cl').outputPayload.category).toBe('Not spam');
  });

  it('Ollama: prompt from data, text output', async () => {
    reset();
    const res = await testRun(
      ctx,
      [
        trig(),
        node('o', 'ai.ollama', {
          prompt: 'Say {{ $trigger.w }}',
          model: 'llama3',
          baseUrl: `http://${host}`,
        }),
        compose('c', '{{ $nodes.o.output.text }}'),
      ],
      { w: 'hi' }
    );
    expect(res.execution.status).toBe('SUCCEEDED');
    expect(res.step('c').outputPayload.text).toBe('OLLAMA: Say hi');
  });

  it('delay: amount + unit from data, short waits run inline', async () => {
    const res = await testRun(
      ctx,
      [
        trig(),
        node('d', 'primitive.delay', { amount: '{{ $trigger.s }}', unit: 'seconds' }),
        compose('c', 'after'),
      ],
      { s: 0.2 }
    );
    expect(res.execution.status).toBe('SUCCEEDED');
    expect(res.step('d').outputPayload.delayedMs).toBe(200);
  });

  it('delay: a long wait in a test stops with WAITING and the steps below do not run', async () => {
    reset();
    const res = await testRun(ctx, [
      trig(),
      node('d', 'primitive.delay', { amount: 2, unit: 'hours' }),
      tgSend('tg', { text: 'later' }),
    ]);
    expect(res.execution.status).toBe('WAITING');
    expect(tgSent).toEqual([]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════

describe('audit — data after a long delay (run suspended and resumed)', () => {
  let ctx: Ctx;
  beforeAll(async () => {
    // Every delay suspends the run and resumes it from the queue.
    ctx = await boot({ inlineDelayMaxMs: 0 });
  }, 30_000);
  afterAll(() => ctx.api.close());

  it('plain values from before the delay reach the steps after it', async () => {
    reset();
    const wf = await publish(ctx, [
      trig(),
      compose('a', 'Hello {{ $trigger.name }}'),
      node('d', 'primitive.delay', { amount: 1, unit: 'seconds' }),
      tgSend('tg', { text: '{{ $nodes.a.output.text }} / {{ $trigger.name }}' }),
    ]);
    const first = await execute(ctx, wf, { name: 'Анна' });
    expect(first.execution.status).toBe('WAITING');
    const res = await waitSettled(ctx, first.execution.id);
    expect(res.execution.status, JSON.stringify(res.steps)).toBe('SUCCEEDED');
    expect(tgSent[0]!.body.text).toBe('Hello Анна / Анна');
  });

  it('HTTP response "body" (the catalog key) still has its fields after the delay', async () => {
    reset();
    jsonResponse = { name: 'n', id: 7 };
    const wf = await publish(ctx, [
      trig(),
      node('http', 'core.httpRequest', { url: `http://${host}/json`, method: 'GET' }),
      node('d', 'primitive.delay', { amount: 1, unit: 'seconds' }),
      compose('c', '{{ $nodes.http.output.body.name }}/{{ $nodes.http.output.body.id }}'),
    ]);
    const first = await execute(ctx, wf);
    const res = await waitSettled(ctx, first.execution.id);
    expect(res.execution.status, JSON.stringify(res.steps)).toBe('SUCCEEDED');
    expect(res.step('c').outputPayload.text).toBe('n/7');
  });

  it('API response fields named like secrets (access_token, key) are still the real values after the delay', async () => {
    reset();
    jsonResponse = { access_token: 'abc123', key: 'K-1', name: 'n' };
    const wf = await publish(ctx, [
      trig(),
      node('http', 'core.httpRequest', { url: `http://${host}/json`, method: 'GET' }),
      node('d', 'primitive.delay', { amount: 1, unit: 'seconds' }),
      node('use', 'core.httpRequest', {
        url: `http://${host}/echo`,
        method: 'POST',
        body: {
          // `data` is the raw response (not hit by the "[CIRCULAR]" problem of `body`).
          token: '{{ $nodes.http.output.data.access_token }}',
          key: '{{ $nodes.http.output.data.key }}',
          name: '{{ $nodes.http.output.data.name }}',
        },
      }),
    ]);
    const first = await execute(ctx, wf);
    const res = await waitSettled(ctx, first.execution.id);
    expect(res.execution.status, JSON.stringify(res.steps)).toBe('SUCCEEDED');
    expect(JSON.parse(echoRequests[0]!.raw)).toEqual({ token: 'abc123', key: 'K-1', name: 'n' });
  });

  it('an AI answer that mentions "Bearer …" or an sk-… string reaches the step after the delay unchanged', async () => {
    reset();
    const answer =
      'Use the header "Authorization: Bearer abcdef123456" with key sk-abcdefghijklmnopqrstuvwxyz';
    modelReply = () => answer;
    const wf = await publish(ctx, [
      trig(),
      node('ai', 'ai.openai', { prompt: 'How do I call the API?' }, { cred: 'ai' }),
      node('d', 'primitive.delay', { amount: 1, unit: 'seconds' }),
      tgSend('tg', { text: '{{ $nodes.ai.output.text }}' }),
    ]);
    const first = await execute(ctx, wf);
    const res = await waitSettled(ctx, first.execution.id);
    expect(res.execution.status, JSON.stringify(res.steps)).toBe('SUCCEEDED');
    expect(tgSent[0]!.body.text).toBe(answer);
  });

  it('without a delay the same chain passes the values (control)', async () => {
    reset();
    jsonResponse = { access_token: 'abc123', key: 'K-1', name: 'n' };
    const wf = await publish(ctx, [
      trig(),
      node('http', 'core.httpRequest', { url: `http://${host}/json`, method: 'GET' }),
      node('use', 'core.httpRequest', {
        url: `http://${host}/echo`,
        method: 'POST',
        body: {
          token: '{{ $nodes.http.output.body.access_token }}',
          key: '{{ $nodes.http.output.body.key }}',
        },
      }),
    ]);
    const res = await execute(ctx, wf);
    expect(res.execution.status).toBe('SUCCEEDED');
    expect(JSON.parse(echoRequests[0]!.raw)).toEqual({ token: 'abc123', key: 'K-1' });
  });

  it('a false condition before a delayed branch keeps its branch stopped after the resume', async () => {
    reset();
    const nodes = [
      trig(),
      node('no', 'logic.condition', { left: 'a', operator: 'equals', right: 'b' }),
      tgSend('never', { text: 'never' }),
      node('d', 'primitive.delay', { amount: 1, unit: 'seconds' }),
      tgSend('later', { text: 'later' }),
    ];
    const edges = [
      edge('t', 'no', 1),
      edge('no', 'never', 2),
      edge('t', 'd', 3),
      edge('d', 'later', 4),
    ];
    const id = await createWf(ctx, nodes, edges);
    await ctx.api.inject({
      method: 'POST',
      url: `/api/v1/workflows/${id}/publish`,
      headers: ctx.headers,
    });
    const first = await execute(ctx, id);
    const res = await waitSettled(ctx, first.execution.id);
    expect(res.execution.status).toBe('SUCCEEDED');
    expect(tgSent.map((s) => s.body.text)).toEqual(['later']);
  });
});
