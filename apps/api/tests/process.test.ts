import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { LocalFlowApiServer } from '../src/index.js';

/** An article site and an OpenAI-compatible model that echoes what it was asked. */
let modelRequests: any[] = [];
const server = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    if (req.url === '/v1/chat/completions') {
      const body = JSON.parse(raw);
      modelRequests.push(body);
      // A reviewer gets a verdict: low for officialese, high otherwise; “BROKEN” gets prose.
      const sys = String(body.messages[0]?.content ?? '');
      if (sys.startsWith('You review a text')) {
        const text = String(body.messages.at(-1).content);
        const content = text.includes('BROKEN')
          ? 'Looks fine to me.'
          : text.includes('осуществляется')
            ? 'Вот оценка: {"score": 3, "issues": ["«осуществляется» — канцелярит"]}'
            : '{"score": 9, "issues": []}';
        res.setHeader('content-type', 'application/json');
        return res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content } }] }));
      }
      res.setHeader('content-type', 'application/json');
      return res.end(
        JSON.stringify({
          choices: [
            {
              message: {
                role: 'assistant',
                content: `ECHO ${body.messages.at(-1).content.length}`,
              },
            },
          ],
        })
      );
    }
    if (req.url === '/articles/one') {
      res.setHeader('content-type', 'text/html; charset=utf-8');
      return res.end(`<!doctype html><html><head><title>Статья один</title>
        <script>var tracking = "SECRET_SCRIPT";</script><style>.x{}</style></head>
        <body><nav>Меню · О нас · Контакты</nav>
        <article><h1>Фото как объект</h1><p>Фотограф Алекс работает с отпечатками &laquo;руками&raquo;.</p>
        <p>Он сканирует, режет и склеивает снимки.</p></article>
        <footer>© Сайт</footer></body></html>`);
    }
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

const apis: LocalFlowApiServer[] = [];
afterEach(async () => {
  await Promise.all(apis.splice(0).map((a) => a.close()));
  modelRequests = [];
});

const port = (direction: 'input' | 'output') => [
  { id: 'main', name: direction, type: 'any' as const, direction, required: false },
];

async function runProcess(
  config: Record<string, unknown>,
  voice?: Record<string, unknown>,
  extra: {
    prompt?: Record<string, unknown>;
    payload?: Record<string, unknown>;
    type?: string;
    after?: boolean;
  } = {}
) {
  const api = new LocalFlowApiServer({ databaseUrl: 'pglite://memory', ssrfAllowlist: [host] });
  apis.push(api);
  const s = await api.inject<{ workspaceId: string; token: string }>({
    method: 'POST',
    url: '/api/v1/setup',
    body: { email: 'owner@localflow.dev', password: 'StrongPassword123!' },
  });
  const headers = { Authorization: `Bearer ${s.body.token}` };
  const ai = await api.inject<{ id: string }>({
    method: 'POST',
    url: `/api/v1/workspaces/${s.body.workspaceId}/credentials`,
    headers,
    body: {
      name: 'ai',
      type: 'openai-compatible',
      secrets: { baseUrl: `http://${host}/v1`, defaultModel: 'm' },
    },
  });
  const wf = await api.inject<{ id: string }>({
    method: 'POST',
    url: `/api/v1/workspaces/${s.body.workspaceId}/workflows`,
    headers,
    body: {
      name: 'p',
      nodes: [
        {
          id: 't',
          type: 'trigger.manual',
          data: { label: 't', config: {} },
          inputs: [],
          outputs: port('output'),
        },
        {
          id: 'p',
          type: extra.type ?? 'ai.process',
          data: { label: 'p', config, credentialId: ai.body.id },
          inputs: port('input'),
          outputs: port('output'),
        },
        // A brand voice: a context step with no step before it, linked to the AI step.
        ...(voice
          ? [
              {
                id: 'v',
                type: 'context.voice',
                data: { label: 'v', config: voice },
                inputs: port('input'),
                outputs: port('output'),
              },
            ]
          : []),
        // A step after the checked one, to see whether the flow went on.
        ...(extra.after
          ? [
              {
                id: 'next',
                type: 'primitive.map',
                data: { label: 'next', config: { transform: { went: true } } },
                inputs: port('input'),
                outputs: port('output'),
              },
            ]
          : []),
        // A Prompt Template: also a context step, linked to the AI step.
        ...(extra.prompt
          ? [
              {
                id: 'tpl',
                type: 'context.prompt',
                data: { label: 'tpl', config: extra.prompt },
                inputs: port('input'),
                outputs: port('output'),
              },
            ]
          : []),
      ],
      edges: [
        { id: 'e', source: 't', sourceHandle: 'main', target: 'p', targetHandle: 'main' },
        ...(extra.after
          ? [{ id: 'ea', source: 'p', sourceHandle: 'main', target: 'next', targetHandle: 'main' }]
          : []),
        ...(voice
          ? [{ id: 'ev', source: 'v', sourceHandle: 'main', target: 'p', targetHandle: 'main' }]
          : []),
        ...(extra.prompt
          ? [
              { id: 'et', source: 't', sourceHandle: 'main', target: 'tpl', targetHandle: 'main' },
              { id: 'ep', source: 'tpl', sourceHandle: 'main', target: 'p', targetHandle: 'main' },
            ]
          : []),
      ],
    },
  });
  const res = await api.inject<{ execution: { status: string }; steps: any[] }>({
    method: 'POST',
    url: `/api/v1/workflows/${wf.body.id}/test-run`,
    headers,
    body: { payload: extra.payload ?? { list: `Фото как объект — http://${host}/articles/one` } },
  });
  return { ...res.body, step: res.body.steps.find((st) => st.nodeId === 'p') };
}

describe('@localflow/api — AI: process data by instruction', () => {
  it('sends the instruction and the data, and with "read the links" the article text without page chrome', async () => {
    const res = await runProcess({
      input: '{{ $trigger.list }}',
      instruction: 'Сделай саммари и переведи на русский',
      readLinks: true,
    });
    expect(res.execution.status).toBe('SUCCEEDED');
    const messages = modelRequests[0].messages;
    expect(messages[0].role).toBe('system');
    const prompt: string = messages[1].content;
    expect(prompt).toContain('Instruction:\nСделай саммари и переведи на русский');
    expect(prompt).toContain(`Data:\nФото как объект — http://${host}/articles/one`);
    expect(prompt).toContain(
      'Фото как объект\nФотограф Алекс работает с отпечатками «руками».\nОн сканирует, режет и склеивает снимки.'
    );
    expect(prompt).not.toMatch(/SECRET_SCRIPT|Меню|© Сайт/);
    expect(res.step.outputPayload.text).toMatch(/^ECHO \d+$/);
    expect(res.step.outputPayload.sources).toEqual([
      {
        url: `http://${host}/articles/one`,
        ok: true,
        title: 'Статья один',
        chars: expect.any(Number),
      },
    ]);
  });

  it('notes pages it could not open instead of failing, and reads nothing when the option is off', async () => {
    const res = await runProcess({
      input: `Две ссылки: http://${host}/missing и http://10.0.0.1/private.`,
      instruction: 'Перескажи',
      readLinks: true,
    });
    expect(res.execution.status).toBe('SUCCEEDED');
    expect(res.step.outputPayload.sources).toEqual([
      { url: `http://${host}/missing`, ok: false, error: 'HTTP 404' },
      { url: 'http://10.0.0.1/private', ok: false, error: expect.stringMatching(/blocked|SSRF/i) },
    ]);
    expect(modelRequests[0].messages[1].content).toContain('(could not open the page: HTTP 404)');

    const off = await runProcess({
      input: `http://${host}/articles/one`,
      instruction: 'Перескажи',
    });
    expect(off.step.outputPayload.sources).toEqual([]);
    expect(modelRequests.at(-1).messages[1].content).not.toContain('Text of the linked pages');
  });

  it('asks for an instruction', async () => {
    const res = await runProcess({ input: 'x' });
    expect(res.execution.status).toBe('FAILED');
    expect(res.step.errorMessage).toMatch(/write what to do/);
  });
});

describe('@localflow/api — brand voice (context step)', () => {
  const VOICE = {
    name: 'Канал о дизайне',
    language: 'русский',
    tone: 'экспертный, без пафоса',
    avoid: 'канцелярит',
    examples: 'Первый пример.\n---\nВторой пример.',
    emoji: 'none',
    presetId: 'vp_1',
    presetVersion: 3,
  };

  it('puts the voice into the system message after the platform rules, and reports which voice', async () => {
    const res = await runProcess(
      { input: '{{ $trigger.list }}', instruction: 'Перескажи', voice: '{{ $nodes.v.output }}' },
      VOICE
    );
    expect(res.execution.status).toBe('SUCCEEDED');
    // The voice step itself calls nothing: one model request, from the AI step.
    expect(modelRequests).toHaveLength(1);
    const system: string = modelRequests[0].messages[0].content;
    const rules = system.indexOf('You process data for an automation.');
    const conflict = system.indexOf('If the instruction and the voice disagree');
    const voice = system.indexOf('Brand voice “Канал о дизайне”:');
    expect(rules).toBe(0);
    expect(conflict).toBeGreaterThan(rules);
    expect(voice).toBeGreaterThan(conflict);
    expect(system).toContain('- Language of the answer: русский');
    expect(system).toContain('- Never use: канцелярит');
    expect(system).toContain('- Emoji: no emoji');
    expect(system).toContain('---\nПервый пример.\n---\nВторой пример.\n---');
    // The voice never goes into the task message.
    expect(modelRequests[0].messages[1].content).not.toContain('Brand voice');
    expect(res.step.outputPayload.voice).toEqual({ name: 'Канал о дизайне', version: 3 });
    const v = res.steps.find((st) => st.nodeId === 'v');
    expect(v.outputPayload.voice).toBe(system.slice(voice));
  });

  it('a voice over the limit goes in without its last examples, and says how many', async () => {
    const examples = Array.from(
      { length: 6 },
      (_, i) => `Пример ${i + 1}. ${'слово '.repeat(250)}`
    ).join('\n---\n');
    const res = await runProcess(
      { input: 'x', instruction: 'Перескажи', voice: '{{ $nodes.v.output }}' },
      { ...VOICE, examples }
    );
    expect(res.execution.status).toBe('SUCCEEDED');
    const system: string = modelRequests[0].messages[0].content;
    expect(system).toContain('Пример 1.');
    expect(system).not.toContain('Пример 6.');
    expect(system).toContain('- Never use: канцелярит');
    const v = res.steps.find((st) => st.nodeId === 'v');
    expect(v.outputPayload.droppedExamples).toBeGreaterThan(0);
    expect(v.outputPayload.voice.length).toBeLessThanOrEqual(6000);
  });

  it('without a voice the AI step sends the same system message as before', async () => {
    const res = await runProcess({ input: '{{ $trigger.list }}', instruction: 'Перескажи' });
    expect(res.execution.status).toBe('SUCCEEDED');
    const system: string = modelRequests[0].messages[0].content;
    expect(system).not.toContain('Brand voice');
    expect(system).not.toContain('If the instruction and the voice disagree');
    expect(res.step.outputPayload.voice).toBeUndefined();
  });
});

describe('@localflow/api — Prompt Template (context step)', () => {
  it('fills the template with data and adds the step’s own instruction after it', async () => {
    const res = await runProcess(
      {
        input: '{{ $trigger.list }}',
        instruction: 'Без эмодзи.',
        prompt: '{{ $nodes.tpl.output }}',
      },
      undefined,
      {
        prompt: {
          name: 'Пересказ',
          template: 'Перескажи «{{ $trigger.title }}» коротко.',
          presetVersion: 2,
        },
        payload: { list: 'текст', title: 'Статья' },
      }
    );
    expect(res.execution.status).toBe('SUCCEEDED');
    const prompt: string = modelRequests[0].messages[1].content;
    expect(prompt).toContain('Instruction:\nПерескажи «Статья» коротко.\n\nБез эмодзи.');
    expect(res.step.outputPayload.prompt).toEqual({ name: 'Пересказ', version: 2 });
    const tpl = res.steps.find((st) => st.nodeId === 'tpl');
    // The template step passes the text on unfilled; it calls nothing itself.
    expect(tpl.outputPayload.template).toBe('Перескажи «{{ $trigger.title }}» коротко.');
    expect(modelRequests).toHaveLength(1);
  });

  it('fills the template for every item when the AI step goes item by item', async () => {
    const res = await runProcess(
      {
        input: '{{ $item.text }}',
        prompt: '{{ $nodes.tpl.output }}',
        forEach: '{{ $trigger.items }}',
      },
      undefined,
      {
        prompt: { name: 'По записи', template: 'Заголовок: {{ $item.title }}. Перескажи.' },
        payload: {
          items: [
            { title: 'Первая', text: 'a' },
            { title: 'Вторая', text: 'b' },
          ],
        },
      }
    );
    expect(res.execution.status).toBe('SUCCEEDED');
    const asked = modelRequests
      .map((r) => r.messages[1].content as string)
      .filter((p) => p.startsWith('Instruction:'));
    expect(asked[0]).toContain('Заголовок: Первая. Перескажи.');
    expect(asked.some((p) => p.includes('Заголовок: Вторая. Перескажи.'))).toBe(true);
  });

  it('a variable with no data is an error that names it, not an empty instruction', async () => {
    const res = await runProcess({ input: 'x', prompt: '{{ $nodes.tpl.output }}' }, undefined, {
      prompt: { name: 'По записи', template: 'Перескажи {{ $item.title }}' },
    });
    expect(res.execution.status).toBe('FAILED');
    expect(res.step.errorMessage).toMatch(
      /Prompt Template “По записи”: no data for \{\{ \$item\.title \}\}.*for each item/
    );
    expect(modelRequests).toHaveLength(0);
  });

  it('without a template and without an instruction the AI step asks for one', async () => {
    const res = await runProcess({ input: 'x' });
    expect(res.execution.status).toBe('FAILED');
    expect(res.step.errorMessage).toMatch(/Instruction.*Prompt Template/);
  });
});

describe('@localflow/api — Text review (checks a text against the brand voice)', () => {
  const VOICE = { name: 'Канал о дизайне', avoid: 'канцелярит' };
  const review = (text: string, more: Record<string, unknown> = {}) =>
    runProcess({ text, voice: '{{ $nodes.v.output }}', ...more }, VOICE, {
      type: 'ai.review',
      after: true,
    });

  it('gives a score and the problems, passes the text on unchanged, and sends the voice', async () => {
    const res = await review('Доставка осуществляется в течение дня.');
    expect(res.execution.status).toBe('SUCCEEDED');
    expect(res.step.outputPayload).toMatchObject({
      text: 'Доставка осуществляется в течение дня.',
      passed: false,
      score: 3,
      passScore: 7,
      issues: ['«осуществляется» — канцелярит'],
      voice: 'Канал о дизайне',
    });
    const system: string = modelRequests[0].messages[0].content;
    expect(system).toContain('You never rewrite the text');
    expect(system).toContain('- Never use: канцелярит');
    // Without “stop if it fails” the flow goes on.
    expect(res.steps.find((s) => s.nodeId === 'next')?.status).toBe('SUCCEEDED');
  });

  it('“stop if it fails” holds the steps below for a weak text, not for a good one', async () => {
    const weak = await review('Доставка осуществляется в течение дня.', { stopIfFails: true });
    expect(weak.step.outputPayload.stopped).toBe(true);
    expect(weak.steps.find((s) => s.nodeId === 'next')?.status ?? 'SKIPPED').toBe('SKIPPED');
    modelRequests = [];
    const good = await review('Привезём сегодня.', { stopIfFails: true });
    expect(good.step.outputPayload).toMatchObject({ passed: true, score: 9 });
    expect(good.steps.find((s) => s.nodeId === 'next')?.status).toBe('SUCCEEDED');
  });

  it('a reply without a score is an error, not a silent pass', async () => {
    const res = await review('BROKEN text');
    expect(res.execution.status).toBe('FAILED');
    expect(res.step.errorMessage).toMatch(/did not give a score/);
  });
});
