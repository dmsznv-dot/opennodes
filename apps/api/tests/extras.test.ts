import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import http from 'node:http';
import net from 'node:net';
import type { AddressInfo } from 'node:net';
import { LocalFlowApiServer } from '../src/index.js';

/** Webhook receiver for Discord/Slack and a minimal SMTP server (no TLS, allowlisted). */
let hooks: Array<{ url: string; body: any }> = [];
let mails: Array<{ from: string; to: string[]; data: string; auth: string }> = [];
const web = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    hooks.push({ url: req.url ?? '', body: JSON.parse(raw || '{}') });
    res.setHeader('content-type', 'application/json');
    if (req.url?.startsWith('/discord')) return res.end(JSON.stringify({ id: '777' }));
    res.end('ok');
  });
});
const smtp = net.createServer((socket) => {
  const mail = { from: '', to: [] as string[], data: '', auth: '' };
  let inData = false;
  let buf = '';
  socket.write('220 fake ESMTP\r\n');
  socket.on('data', (chunk) => {
    buf += chunk.toString();
    let i: number;
    while ((i = buf.indexOf('\r\n')) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 2);
      if (inData) {
        if (line === '.') {
          inData = false;
          mails.push({ ...mail });
          socket.write('250 queued\r\n');
        } else mail.data += `${line}\n`;
        continue;
      }
      if (/^EHLO/i.test(line)) socket.write('250-fake\r\n250 AUTH PLAIN\r\n');
      else if (/^AUTH PLAIN/i.test(line)) {
        mail.auth = Buffer.from(line.split(' ')[2]!, 'base64').toString();
        socket.write('235 ok\r\n');
      } else if (/^MAIL FROM:/i.test(line)) {
        mail.from = line.slice(10);
        socket.write('250 ok\r\n');
      } else if (/^RCPT TO:/i.test(line)) {
        mail.to.push(line.slice(8));
        socket.write('250 ok\r\n');
      } else if (/^DATA/i.test(line)) {
        inData = true;
        socket.write('354 go\r\n');
      } else if (/^QUIT/i.test(line)) {
        socket.end('221 bye\r\n');
      } else socket.write('500 ?\r\n');
    }
  });
});
let host = '';
let smtpPort = 0;
beforeAll(async () => {
  await new Promise<void>((r) => web.listen(0, '127.0.0.1', r));
  await new Promise<void>((r) => smtp.listen(0, '127.0.0.1', r));
  host = `127.0.0.1:${(web.address() as AddressInfo).port}`;
  smtpPort = (smtp.address() as AddressInfo).port;
});
afterAll(async () => {
  await new Promise<void>((r) => web.close(() => r()));
  await new Promise<void>((r) => smtp.close(() => r()));
});

const apis: LocalFlowApiServer[] = [];
afterEach(async () => {
  await Promise.all(apis.splice(0).map((a) => a.close()));
  hooks = [];
  mails = [];
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

async function setup(extraAllow: string[] = []) {
  const api = new LocalFlowApiServer({
    databaseUrl: 'pglite://memory',
    ssrfAllowlist: [host, ...extraAllow],
  });
  apis.push(api);
  const s = await api.inject<{ workspaceId: string; token: string }>({
    method: 'POST',
    url: '/api/v1/setup',
    body: { email: 'owner@localflow.dev', password: 'StrongPassword123!' },
  });
  const headers = { Authorization: `Bearer ${s.body.token}` };
  const connect = async (type: string, secrets: Record<string, string>) =>
    (
      await api.inject<{ id: string }>({
        method: 'POST',
        url: `/api/v1/workspaces/${s.body.workspaceId}/credentials`,
        headers,
        body: { name: type, type, secrets },
      })
    ).body.id;
  const run = async (nodes: ReturnType<typeof node>[], payload: Record<string, unknown> = {}) => {
    const wf = await api.inject<{ id: string }>({
      method: 'POST',
      url: `/api/v1/workspaces/${s.body.workspaceId}/workflows`,
      headers,
      body: {
        name: 'x',
        nodes,
        edges: nodes.slice(1).map((n, i) => ({
          id: `e${i}`,
          source: nodes[i]!.id,
          sourceHandle: 'main',
          target: n.id,
          targetHandle: 'main',
        })),
      },
    });
    await api.inject({ method: 'POST', url: `/api/v1/workflows/${wf.body.id}/publish`, headers });
    const res = await api.inject<{ execution: { status: string }; steps: any[] }>({
      method: 'POST',
      url: `/api/v1/workflows/${wf.body.id}/execute`,
      headers,
      body: { payload, wait: true },
    });
    return { ...res.body, step: (id: string) => res.body.steps.find((st) => st.nodeId === id) };
  };
  return { connect, run };
}

describe('@localflow/api — new steps and template values', () => {
  it('Text: process — strip HTML, cut to a limit, replace, pull out links', async () => {
    const t = await setup();
    const html = '<p>Привет, <b>мир</b> &amp; друзья</p><p>Читать: https://a.example/x.</p>';
    const res = await t.run(
      [
        node('t', 'trigger.manual', {}),
        node('strip', 'text.format', { input: '{{ $trigger.html }}', operation: 'stripHtml' }),
        node('cut', 'text.format', {
          input: '{{ $nodes.strip.output.result }}',
          operation: 'truncate',
          maxLength: 20,
        }),
        node('links', 'text.format', { input: '{{ $trigger.html }}', operation: 'extractLinks' }),
        node('swap', 'text.format', {
          input: '{{ $nodes.strip.output.result }}',
          operation: 'replace',
          find: 'мир',
          replaceWith: 'всем',
        }),
      ],
      { html }
    );
    expect(res.execution.status).toBe('SUCCEEDED');
    expect(res.step('strip').outputPayload.result).toBe(
      'Привет, мир & друзья\nЧитать: https://a.example/x.'
    );
    // One sentence: kept whole — a text is never cut in the middle.
    expect(res.step('cut').outputPayload.result).toBe(
      'Привет, мир & друзья\nЧитать: https://a.example/x.'
    );
    expect(res.step('links').outputPayload.result).toBe('https://a.example/x');
    expect(res.step('swap').outputPayload.result).toMatch(/^Привет, всем & друзья/);
  });

  it('chip formats and system values work in a real run', async () => {
    const t = await setup();
    const res = await t.run(
      [
        node('t', 'trigger.manual', {}),
        node('c', 'text.compose', {
          template:
            '{{ $trigger.name.toUpperCase() }}|{{ $trigger.long.slice(0, 5) }}|{{ $now.date }}|{{ $run.triggerType }}',
        }),
      ],
      { name: 'аня', long: 'abcdefghij' }
    );
    const [upper, first, date, how] = res.step('c').outputPayload.text.split('|');
    expect([upper, first, how]).toEqual(['АНЯ', 'abcde', 'manual']);
    expect(date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('Discord and Slack: posts through the connection webhook, never showing its address', async () => {
    const t = await setup();
    const discord = await t.connect('discord', {
      webhookUrl: `http://${host}/discord/hook-secret`,
    });
    const slack = await t.connect('slack', { webhookUrl: `http://${host}/slack/hook-secret` });
    const res = await t.run([
      node('t', 'trigger.manual', {}),
      node(
        'd',
        'discord.sendMessage',
        { text: 'Привет', imageUrl: 'https://a.example/p.jpg', username: 'Бот' },
        discord
      ),
      node('s', 'slack.sendMessage', { text: 'Hello' }, slack),
    ]);
    expect(res.execution.status).toBe('SUCCEEDED');
    expect(hooks[0]).toEqual({
      url: '/discord/hook-secret?wait=true',
      body: {
        content: 'Привет',
        username: 'Бот',
        embeds: [{ image: { url: 'https://a.example/p.jpg' } }],
      },
    });
    expect(hooks[1]).toEqual({ url: '/slack/hook-secret', body: { text: 'Hello' } });
    expect(res.step('d').outputPayload.messageId).toBe('777');
    expect(JSON.stringify(res)).not.toContain('hook-secret');
  });

  it('Email: sends over SMTP with auth, UTF-8 subject and base64 body', async () => {
    const t = await setup([`127.0.0.1:${smtpPort}`]);
    const mailbox = await t.connect('smtp', {
      host: '127.0.0.1',
      port: String(smtpPort),
      user: 'me@example.com',
      password: 'app-pass',
      from: 'Робот <me@example.com>',
    });
    const res = await t.run(
      [
        node('t', 'trigger.manual', {}),
        node(
          'mail',
          'core.smtp',
          {
            to: 'a@example.com, b@example.com',
            subject: 'Дайджест',
            body: 'Текст {{ $trigger.n }}',
          },
          mailbox
        ),
      ],
      { n: 42 }
    );
    expect(res.execution.status).toBe('SUCCEEDED');
    expect(mails).toHaveLength(1);
    const m = mails[0]!;
    expect(m.from).toBe('<me@example.com>');
    expect(m.to).toEqual(['<a@example.com>', '<b@example.com>']);
    expect(m.auth).toBe('\0me@example.com\0app-pass');
    expect(m.data).toContain(`Subject: =?UTF-8?B?${Buffer.from('Дайджест').toString('base64')}?=`);
    const body = m.data.split('\n\n')[1]!.replace(/\s/g, '');
    expect(Buffer.from(body, 'base64').toString()).toBe('Текст 42');
    expect(res.step('mail').outputPayload).toMatchObject({
      ok: true,
      accepted: ['a@example.com', 'b@example.com'],
    });
  });

  it('Email: refuses to send a password unencrypted to a server that is not allowlisted', async () => {
    const t = await setup(); // the SMTP port is not allowlisted: it is a local address
    const mailbox = await t.connect('smtp', {
      host: '127.0.0.1',
      port: String(smtpPort),
      user: 'me@example.com',
      password: 'app-pass',
    });
    const res = await t.run([
      node('t', 'trigger.manual', {}),
      node('mail', 'core.smtp', { to: 'a@example.com', subject: 's', body: 'b' }, mailbox),
    ]);
    expect(res.execution.status).toBe('FAILED');
    expect(res.step('mail').errorMessage).toMatch(/SSRF/);
    expect(mails).toHaveLength(0);
  });
});
