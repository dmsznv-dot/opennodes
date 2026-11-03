/**
 * Every field of every step does something: each one gets a unique marker, the step runs
 * against local stand-ins (Telegram, an OpenAI-compatible model, Ollama, Discord/Slack
 * webhooks, an HTTP echo, SMTP, an RSS feed) and the marker must turn up in what the step
 * sends out — or, for steps that only work on data, in what it gives the next step.
 * A field whose marker goes nowhere is a field the server silently ignores.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import net from 'node:net';
import type { AddressInfo } from 'node:net';
import { LocalFlowApiServer } from '../src/index.js';
import { ACTIONS, SERVICES } from '../../../docs/catalog.js';

/**
 * Fields whose work leaves no marker in a single run — each with what it does instead.
 * Anything else that leaves no trace is a bug.
 */
const EFFECT_ONLY: Record<string, string> = {
  'telegram.sendMessage.parseMode': '"None" sends no parse_mode (tested in audit.test)',
  'telegram.sendFile.parseMode': 'the same for captions',
  'rss.read.onlyNew': 'off: no memory is read or written (channel.test)',
  'rss.read.rememberTests': 'off: tests leave the memory alone (audit.test)',
  'logic.delay.unit': 'seconds: the run waited 1 s instead of 1 min',
  'text.format.maxLength': 'only for "Cut" (shown only then)',
  'text.format.pattern': 'only for "Find by pattern" (shown only then)',
  'http.request.timeoutMs': 'the request gives up after it (audit.test)',
  'text.format.find': 'replaced away: "MK_replaceWith" stands in its place',
  'ai.process.titleLine': 'per item only: the AI is asked for a title line (audit.test)',
  'rss.read.pageImages': 'off: items without a picture are not looked up (audit.test)',
};
/** A choice other than the default that makes the rest of the fields count. */
const OVERRIDES: Record<string, Record<string, unknown>> = {
  'text.format': { operation: 'replace' },
};

type Seen = { url: string; method: string; headers: http.IncomingHttpHeaders; raw: string };
let seen: Seen[] = [];
let mails: string[] = [];

const web = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    const url = req.url ?? '/';
    seen.push({ url, method: req.method ?? '', headers: req.headers, raw });
    const json = (data: unknown) => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(data));
    };
    if (/^\/bot[^/]+\/\w+$/.test(url)) return json({ ok: true, result: { message_id: 1 } });
    if (url.endsWith('/chat/completions')) {
      const body = JSON.parse(raw);
      const last = body.messages.at(-1).content as string;
      // The classifier must get back one of its categories.
      const cat = last.match(/MkA|Question/)?.[0];
      return json({
        choices: [{ message: { role: 'assistant', content: cat ?? `AI ${last.slice(0, 50)}` } }],
      });
    }
    if (url === '/api/generate') return json({ response: 'ollama', done: true });
    if (url.startsWith('/discord')) return json({ id: '9' });
    if (url === '/feed.xml') {
      res.setHeader('content-type', 'application/rss+xml');
      return res.end(
        '<rss><channel>' +
          [1, 2, 3]
            .map(
              (n) =>
                `<item><title>T${n}</title><link>http://x.test/${n}</link><guid>g${n}</guid></item>`
            )
            .join('') +
          '</channel></rss>'
      );
    }
    if (url.startsWith('/mk/page')) {
      res.setHeader('content-type', 'text/html');
      return res.end('<html><body><article><p>Page text</p></article></body></html>');
    }
    json({ ok: true, echo: url });
  });
});

const smtp = net.createServer((socket) => {
  let inData = false;
  let data = '';
  let buf = '';
  socket.write('220 fake\r\n');
  socket.on('data', (chunk) => {
    buf += chunk.toString();
    let i: number;
    while ((i = buf.indexOf('\r\n')) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 2);
      if (inData) {
        if (line === '.') {
          inData = false;
          mails.push(data);
          socket.write('250 queued\r\n');
        } else data += `${line}\n`;
        continue;
      }
      if (/^EHLO/i.test(line)) socket.write('250-fake\r\n250 AUTH PLAIN\r\n');
      else if (/^(AUTH|MAIL|RCPT)/i.test(line)) {
        data += `${line}\n`;
        socket.write(/^AUTH/i.test(line) ? '235 ok\r\n' : '250 ok\r\n');
      } else if (/^DATA/i.test(line)) {
        inData = true;
        socket.write('354 go\r\n');
      } else if (/^QUIT/i.test(line)) socket.end('221 bye\r\n');
      else socket.write('500 ?\r\n');
    }
  });
});

let host = '';
let smtpPort = 0;
let api: LocalFlowApiServer;
let headers: Record<string, string>;
let wsId = '';
let scratch = '';
const creds: Record<string, string> = {};

beforeAll(async () => {
  await new Promise<void>((r) => web.listen(0, '127.0.0.1', r));
  await new Promise<void>((r) => smtp.listen(0, '127.0.0.1', r));
  host = `127.0.0.1:${(web.address() as AddressInfo).port}`;
  smtpPort = (smtp.address() as AddressInfo).port;
  api = new LocalFlowApiServer({
    databaseUrl: 'pglite://memory',
    ssrfAllowlist: [host, `127.0.0.1:${smtpPort}`],
    telegramApiBase: `http://${host}`,
    forEachPauseMs: 0,
  } as any);
  const s = await api.inject<{ workspaceId: string; token: string }>({
    method: 'POST',
    url: '/api/v1/setup',
    body: { email: 'owner@localflow.dev', password: 'StrongPassword123!' },
  });
  headers = { Authorization: `Bearer ${s.body.token}` };
  wsId = s.body.workspaceId;
  const connect = async (service: string, type: string, secrets: Record<string, string>) => {
    creds[service] = (
      await api.inject<{ id: string }>({
        method: 'POST',
        url: `/api/v1/workspaces/${wsId}/credentials`,
        headers,
        body: { name: type, type, secrets },
      })
    ).body.id;
  };
  await connect('telegram', 'telegram', { botToken: '1:tok' });
  // No default model on the connection: the step's own choice must be what is sent.
  await connect('ai', 'openai-compatible', { baseUrl: `http://${host}/v1` });
  await connect('ollama', 'openai-compatible', { baseUrl: `http://${host}/v1` });
  await connect('discord', 'discord', { webhookUrl: `http://${host}/discord/h` });
  await connect('slack', 'slack', { webhookUrl: `http://${host}/slack/h` });
  await connect('email', 'smtp', {
    host: '127.0.0.1',
    port: String(smtpPort),
    user: 'me@x.test',
    password: 'p',
    from: 'me@x.test',
  });
  scratch = (
    await api.inject<{ id: string }>({
      method: 'POST',
      url: `/api/v1/workspaces/${wsId}/workflows`,
      headers,
      body: { name: 'fields', nodes: [], edges: [] },
    })
  ).body.id;
});
afterAll(async () => {
  await api.close();
  await new Promise<void>((r) => web.close(() => r()));
  await new Promise<void>((r) => smtp.close(() => r()));
});

const port = (direction: 'input' | 'output') => [
  { id: 'main', name: direction, type: 'any' as const, direction, required: false },
];

const NUMBERS: Record<string, number> = {
  temperature: 0.37,
  maxTokens: 77,
  maxLinks: 1,
  timeoutMs: 4321,
  maxLength: 3,
  amount: 1,
  maxItems: 2,
  maxSteps: 3,
};

/** A value for a field that is recognisable wherever it ends up. */
function marker(key: string, f: any): unknown {
  if (f.type === 'number') return NUMBERS[key] ?? 7;
  if (f.type === 'boolean') return !(f.default ?? false);
  if (f.type === 'select') {
    const other = f.options.find((o: any) => o.value !== (f.default ?? '') && o.value);
    return (other ?? f.options[0]).value;
  }
  if (f.type === 'json') return { [`mk_${key}`]: `MK_${key}` };
  if (/url$/i.test(key))
    return key === 'feedUrl' ? `http://${host}/feed.xml` : `http://${host}/mk/${key}`;
  if (key === 'chatId') return '@mk_chat';
  if (key === 'to') return 'mk_to@x.test';
  if (key === 'categories') return 'MkA, MkB';
  if (key === 'model') return `mk-model`;
  if (key === 'pattern') return 'MK_(\\w+)';
  if (key === 'input' || key === 'text' || key === 'template')
    return `MK_${key} MK_find http://${host}/mk/page <b>x</b>`;
  return `MK_${key}`;
}

/** What shows that a field worked: the marker itself, or a sign of its effect. */
function evidence(key: string, value: unknown): string {
  if (typeof value === 'number') return String(value);
  if (typeof value === 'object') return `MK_${key}`;
  if (typeof value === 'string' && value.startsWith(`http://${host}/mk/`)) return `/mk/${key}`;
  if (typeof value === 'string' && value.startsWith(`http://${host}/feed`)) return '/feed.xml';
  if (typeof value === 'string' && value.startsWith(`MK_${key} `)) return `MK_${key}`;
  return String(value);
}

describe('every field of every step is used', () => {
  const report: string[] = [];
  afterAll(() => console.log(`\n${report.join('\n')}\n`));

  for (const [id, act] of Object.entries(ACTIONS as Record<string, any>)) {
    if (act.planned || act.kind === 'trigger' || !act.type) continue;
    if (['postgres.query', 'ai.agent'].includes(id)) continue; // not run here (see their own tests)
    it(id, async () => {
      seen = [];
      mails = [];
      const config: Record<string, unknown> = {};
      for (const f of act.fields ?? []) config[f.key] = marker(f.key, f);
      Object.assign(config, OVERRIDES[id] ?? {});
      // Steps of services without an account get no connection — as in the editor.
      const service = SERVICES[act.service]?.auth === false ? '' : act.service;
      const res = await api.inject<any>({
        method: 'POST',
        url: `/api/v1/workflows/${scratch}/test-run`,
        headers,
        body: {
          nodes: [
            {
              id: 't',
              type: 'trigger.manual',
              data: { label: 't', config: {} },
              inputs: [],
              outputs: port('output'),
            },
            {
              id: 's',
              type: act.type,
              data: {
                label: 's',
                config,
                ...(creds[service] ? { credentialId: creds[service] } : {}),
              },
              inputs: port('input'),
              outputs: port('output'),
            },
          ],
          edges: [
            { id: 'e', source: 't', sourceHandle: 'main', target: 's', targetHandle: 'main' },
          ],
          payload: {},
        },
      });
      const step = res.body.steps?.find((x: any) => x.nodeId === 's');
      const outside = JSON.stringify({
        requests: seen.map((r) => ({
          url: r.url,
          method: r.method,
          headers: r.headers,
          raw: r.raw,
        })),
        // Mail bodies travel base64-encoded.
        mails: mails.map((m) => {
          const body = m.split('\n\n').slice(1).join('').replace(/\s/g, '');
          return `${m}\n${Buffer.from(body, 'base64').toString()}`;
        }),
        output: step?.outputPayload,
      });
      const ignored = (act.fields ?? [])
        .filter((f: any) => !outside.includes(evidence(f.key, config[f.key])))
        .filter((f: any) => !EFFECT_ONLY[`${id}.${f.key}`])
        .map((f: any) => `${f.key}=${JSON.stringify(config[f.key])}`);
      report.push(
        `${step?.status === 'FAILED' ? '✗' : ignored.length ? '?' : '✓'} ${id}: ${
          step?.status ?? res.statusCode
        }${step?.errorMessage ? ` (${step.errorMessage})` : ''}${ignored.length ? ` — no trace of: ${ignored.join(', ')}` : ''}`
      );
      expect(res.statusCode).toBe(200);
      expect(step?.status, step?.errorMessage ?? '').toBe('SUCCEEDED');
      expect(ignored, `${id}: fields with no effect`).toEqual([]);
    });
  }
});
