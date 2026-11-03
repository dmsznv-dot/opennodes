import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { LocalFlowApiServer } from '../src/index.js';

/** One stand-in server: an RSS feed at /feed.xml and the Telegram Bot API at /bot<token>/… */
const TOKEN = '777:channel-test';
let feed: Array<{ guid: string; title: string; link: string; image?: string }> = [];
let sent: Array<{ method: string; body: any }> = [];
let failNextSend = false;
const server = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    if (req.url === '/site') {
      res.setHeader('content-type', 'text/html');
      return res.end(
        '<!doctype html><html><head><link rel="alternate" type="application/rss+xml" title="RSS" href="/feed.xml"></head><body>Блог</body></html>'
      );
    }
    if (req.url === '/plain') {
      res.setHeader('content-type', 'text/html');
      return res.end(
        '<!doctype html><html><head><title>Сайт</title></head><body>Нет ленты</body></html>'
      );
    }
    if (req.url === '/feed.xml') {
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
    const m = req.url?.match(/^\/bot([^/]+)\/(\w+)$/);
    res.setHeader('content-type', 'application/json');
    if (!m || m[1] !== TOKEN) {
      res.statusCode = 404;
      return res.end(JSON.stringify({ ok: false, description: 'Not Found' }));
    }
    if (failNextSend) {
      failNextSend = false;
      res.statusCode = 500;
      return res.end(JSON.stringify({ ok: false, description: 'Internal Server Error' }));
    }
    sent.push({ method: m[2]!, body: JSON.parse(raw || '{}') });
    res.end(JSON.stringify({ ok: true, result: { message_id: 100 + sent.length } }));
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
  feed = [];
  sent = [];
  failNextSend = false;
});

const port = (direction: 'input' | 'output') => [
  { id: 'main', name: direction, type: 'any' as const, direction, required: false },
];
const node = (
  id: string,
  type: string,
  config: Record<string, unknown>,
  credentialId?: string
) => ({
  id,
  type,
  data: { label: id, config, ...(credentialId ? { credentialId } : {}) },
  inputs: type.startsWith('trigger.') ? [] : port('input'),
  outputs: port('output'),
});
const chain = (ids: string[]) =>
  ids.slice(1).map((id, i) => ({
    id: `e${i}`,
    source: ids[i]!,
    sourceHandle: 'main',
    target: id,
    targetHandle: 'main',
  }));

async function setup() {
  const api = new LocalFlowApiServer({
    databaseUrl: 'pglite://memory',
    ssrfAllowlist: [host],
    telegramApiBase: `http://${host}`,
    triggerTickMs: 60_000,
  });
  apis.push(api);
  const s = await api.inject<{ workspaceId: string; token: string }>({
    method: 'POST',
    url: '/api/v1/setup',
    body: { email: 'owner@localflow.dev', password: 'StrongPassword123!' },
  });
  const headers = { Authorization: `Bearer ${s.body.token}` };
  const cred = await api.inject<{ id: string }>({
    method: 'POST',
    url: `/api/v1/workspaces/${s.body.workspaceId}/credentials`,
    headers,
    body: { name: 'bot', type: 'telegram', secrets: { botToken: TOKEN } },
  });
  const create = async (nodes: ReturnType<typeof node>[]) => {
    const wf = await api.inject<{ id: string }>({
      method: 'POST',
      url: `/api/v1/workspaces/${s.body.workspaceId}/workflows`,
      headers,
      body: { name: 'channel', nodes, edges: chain(nodes.map((n) => n.id)) },
    });
    const pub = await api.inject({
      method: 'POST',
      url: `/api/v1/workflows/${wf.body.id}/publish`,
      headers,
    });
    expect(pub.statusCode).toBe(201);
    return wf.body.id;
  };
  const run = async (wfId: string) =>
    (
      await api.inject<{ execution: { status: string }; steps: Array<any> }>({
        method: 'POST',
        url: `/api/v1/workflows/${wfId}/execute`,
        headers,
        body: { wait: true },
      })
    ).body;
  const test = async (wfId: string) =>
    (
      await api.inject<{ execution: { status: string }; steps: Array<any> }>({
        method: 'POST',
        url: `/api/v1/workflows/${wfId}/test-run`,
        headers,
        body: {},
      })
    ).body;
  return { api, headers, cred: cred.body.id, create, run, test };
}

const channelFlow = (cred: string) => [
  node('t', 'trigger.manual', {}),
  node('rss', 'core.rss', { feedUrl: `http://${host}/feed.xml`, maxItems: 2, onlyNew: true }),
  node(
    'tg',
    'core.telegramBot',
    {
      chatId: '@my_channel',
      text: '{{ $nodes.rss.output.digest }}',
      imageUrl: '{{ $nodes.rss.output.image }}',
      disablePreview: true,
      // A workflow cannot redirect the bot token elsewhere: this is ignored.
      apiBase: 'http://127.0.0.1:1',
    },
    cred
  ),
];

const step = (r: { steps: any[] }, id: string) => r.steps.find((s) => s.nodeId === id);

describe('@localflow/api — RSS → Telegram channel', () => {
  it('posts each feed item once, skips the backlog, and stops cleanly when nothing is new', async () => {
    const t = await setup();
    feed = [
      {
        guid: 'a',
        title: 'Первая & важная',
        link: 'https://n.example/a',
        image: 'https://n.example/a.jpg',
      },
      { guid: 'b', title: 'Вторая', link: 'https://n.example/b' },
      { guid: 'c', title: 'Старая', link: 'https://n.example/c' },
    ];
    const wf = await t.create(channelFlow(t.cred));

    const first = await t.run(wf);
    expect(first.execution.status).toBe('SUCCEEDED');
    expect(step(first, 'rss').outputPayload).toMatchObject({
      count: 2,
      titles: 'Первая & важная\nВторая',
      link: 'https://n.example/a',
      image: 'https://n.example/a.jpg',
      stopped: false,
    });
    expect(sent).toEqual([
      {
        method: 'sendPhoto',
        body: {
          chat_id: '@my_channel',
          photo: 'https://n.example/a.jpg',
          // Sent as Telegram HTML: "&" is escaped, the reader sees it as typed.
          caption: 'Первая &amp; важная — https://n.example/a\nВторая — https://n.example/b',
          parse_mode: 'HTML',
        },
      },
    ]);
    expect(step(first, 'tg').outputPayload.messageId).toBe(101);

    // Nothing new (the third, older item was backlog): the post step does not run.
    const second = await t.run(wf);
    expect(second.execution.status).toBe('SUCCEEDED');
    expect(step(second, 'rss').outputPayload).toMatchObject({ count: 0, stopped: true });
    expect(step(second, 'tg').status).toBe('SKIPPED');
    expect(sent).toHaveLength(1);

    // A new item: posted as text, with link previews switched off.
    feed.unshift({ guid: 'd', title: 'Свежая', link: 'https://n.example/d' });
    const third = await t.run(wf);
    expect(third.execution.status).toBe('SUCCEEDED');
    expect(sent.at(-1)).toEqual({
      method: 'sendMessage',
      body: {
        chat_id: '@my_channel',
        text: 'Свежая — https://n.example/d',
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true },
      },
    });
  });

  it('gives items back when the post fails, so the next run retries them', async () => {
    const t = await setup();
    feed = [{ guid: 'x', title: 'Новость', link: 'https://n.example/x' }];
    const wf = await t.create(channelFlow(t.cred));
    failNextSend = true;
    const failed = await t.run(wf);
    expect(failed.execution.status).toBe('FAILED');
    expect(sent).toHaveLength(0);

    const retry = await t.run(wf);
    expect(retry.execution.status).toBe('SUCCEEDED');
    expect(sent.map((s) => s.body.text)).toEqual(['Новость — https://n.example/x']);
  });

  it('a test from the editor reads new items without using them up', async () => {
    const t = await setup();
    feed = [{ guid: 'y', title: 'Тест', link: 'https://n.example/y' }];
    const wf = await t.create(channelFlow(t.cred));
    const tested = await t.test(wf);
    expect(step(tested, 'rss').outputPayload.count).toBe(1);
    const real = await t.run(wf);
    expect(step(real, 'rss').outputPayload.count).toBe(1); // still new for the real run
  });

  it('sends a document by link; a caption over 1024 characters follows as its own message', async () => {
    const t = await setup();
    const caption = 'Отчёт. '.repeat(200); // ~1400 characters
    const wf = await t.create([
      node('t', 'trigger.manual', {}),
      node(
        'file',
        'telegram.sendFile',
        { chatId: '-1001234', fileUrl: 'https://n.example/report.pdf', kind: 'document', caption },
        t.cred
      ),
    ]);
    const res = await t.run(wf);
    expect(res.execution.status).toBe('SUCCEEDED');
    expect(sent.map((s) => s.method)).toEqual(['sendDocument', 'sendMessage']);
    expect(sent[0]!.body).toEqual({
      chat_id: '-1001234',
      document: 'https://n.example/report.pdf',
    });
    expect(sent[1]!.body.text).toBe(caption);
    expect(step(res, 'file').outputPayload.messageId).toBe(102);
  });

  it('finds the feed of a site address, and explains a web page that has none', async () => {
    const t = await setup();
    feed = [{ guid: 'p', title: 'Пост', link: 'https://n.example/p' }];
    const flow = (url: string) => [
      node('t', 'trigger.manual', {}),
      node('rss', 'core.rss', { feedUrl: url, maxItems: 5, onlyNew: true }),
    ];
    const site = await t.run(await t.create(flow(`http://${host}/site`)));
    expect(site.execution.status).toBe('SUCCEEDED');
    expect(step(site, 'rss').outputPayload).toMatchObject({
      count: 1,
      titles: 'Пост',
      feedCount: 1,
    });

    const page = await t.run(await t.create(flow(`http://${host}/plain`)));
    expect(page.execution.status).toBe('FAILED');
    expect(step(page, 'rss').errorMessage).toMatch(/is a web page, not an RSS or Atom feed/);

    feed = [];
    const empty = await t.run(await t.create(flow(`http://${host}/feed.xml`)));
    expect(step(empty, 'rss').outputPayload).toMatchObject({
      count: 0,
      stopped: true,
      feedCount: 0,
    });
  });
});
