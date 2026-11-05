import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { LocalFlowApiServer } from '../src/index.js';

/** A Telegram Bot API stand-in: records what the bots call; button presses are queued. */
const TOKEN = '111:APPROVAL';
let calls: Array<{ method: string; body: any }> = [];
let presses: any[] = [];
let nextUpdate = 1;
const server = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    const method = req.url!.split('/').pop()!;
    const body = raw ? JSON.parse(raw) : {};
    calls.push({ method, body });
    res.setHeader('content-type', 'application/json');
    if (method === 'getUpdates') {
      const result = presses.filter((u) => u.update_id >= (body.offset ?? 0));
      return res.end(JSON.stringify({ ok: true, result }));
    }
    if (method === 'sendMessage')
      return res.end(JSON.stringify({ ok: true, result: { message_id: 77 } }));
    res.end(JSON.stringify({ ok: true, result: true }));
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
  calls = [];
  presses = [];
});

const port = (direction: 'input' | 'output') => [
  { id: 'main', name: direction, type: 'any' as const, direction, required: false },
];

async function start(config: Record<string, unknown>) {
  const api = new LocalFlowApiServer({
    databaseUrl: 'pglite://memory',
    ssrfAllowlist: [host],
    telegramApiBase: `http://${host}`,
    approvalPollMs: 100,
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
    body: { name: 'approvals bot', type: 'telegram', secrets: { botToken: TOKEN } },
  });
  const wf = await api.inject<{ id: string }>({
    method: 'POST',
    url: `/api/v1/workspaces/${s.body.workspaceId}/workflows`,
    headers,
    body: {
      name: 'a',
      nodes: [
        {
          id: 't',
          type: 'trigger.manual',
          data: { label: 't', config: {} },
          inputs: [],
          outputs: port('output'),
        },
        {
          id: 'ok',
          type: 'telegram.approval',
          data: {
            label: 'ok',
            config: {
              chatId: '@approvals',
              title: 'Пост',
              content: '**{{ $trigger.text }}**',
              ...config,
            },
            credentialId: cred.body.id,
          },
          inputs: port('input'),
          outputs: port('output'),
        },
        {
          id: 'send',
          type: 'primitive.map',
          data: { label: 'send', config: { transform: { sent: true } } },
          inputs: port('input'),
          outputs: port('output'),
        },
      ],
      edges: [
        { id: 'e1', source: 't', sourceHandle: 'main', target: 'ok', targetHandle: 'main' },
        { id: 'e2', source: 'ok', sourceHandle: 'main', target: 'send', targetHandle: 'main' },
      ],
    },
  });
  await api.inject({ method: 'POST', url: `/api/v1/workflows/${wf.body.id}/publish`, headers });
  const run = await api.inject<{ execution: { id: string; status: string }; steps: any[] }>({
    method: 'POST',
    url: `/api/v1/workflows/${wf.body.id}/execute`,
    headers,
    body: { payload: { text: 'Привет' }, wait: true },
  });
  return { api, headers, run: run.body };
}

const press = (yes: boolean, token: string, username = 'editor') =>
  presses.push({
    update_id: nextUpdate++,
    callback_query: {
      id: `cq${nextUpdate}`,
      data: `ap:${yes ? 'y' : 'n'}:${token}`,
      from: { id: 5, username },
    },
  });

async function until(
  api: LocalFlowApiServer,
  headers: Record<string, string>,
  id: string,
  status: string
) {
  const deadline = Date.now() + 8_000;
  for (;;) {
    const r = await api.inject<{ execution: { status: string }; steps: any[] }>({
      method: 'GET',
      url: `/api/v1/executions/${id}`,
      headers,
    });
    if (r.body.execution.status === status) return r.body;
    if (Date.now() > deadline)
      throw new Error(
        `still ${r.body.execution.status} ${JSON.stringify(calls.map((c) => c.method))} ${JSON.stringify(r.body.steps.map((s: any) => [s.nodeId, s.status, s.outputPayload]))}`
      );
    await new Promise((r) => setTimeout(r, 50));
  }
}

describe('@localflow/api — approval in Telegram by a separate bot', () => {
  it('posts the preview with two buttons; “Approve” in the chat runs the steps below', async () => {
    const { api, headers, run } = await start({});
    expect(run.execution.status).toBe('WAITING');
    const sent = calls.find((c) => c.method === 'sendMessage')!;
    expect(sent.body.chat_id).toBe('@approvals');
    expect(sent.body.text).toContain('<b>Пост</b>');
    expect(sent.body.text).toContain('<b>Привет</b>');
    const buttons = sent.body.reply_markup.inline_keyboard[0];
    expect(buttons.map((b: any) => b.callback_data.slice(0, 5))).toEqual(['ap:y:', 'ap:n:']);
    const token = buttons[0].callback_data.slice(5);
    // The bot token never lands in what the run keeps.
    const waiting = run.steps.find((s) => s.nodeId === 'ok');
    expect(JSON.stringify(waiting.outputPayload)).not.toContain(TOKEN);

    press(true, token);
    const done = await until(api, headers, run.execution.id, 'SUCCEEDED');
    const ok = done.steps.find((s) => s.nodeId === 'ok');
    expect(ok.outputPayload).toMatchObject({ approved: true, decidedBy: '@editor' });
    expect(done.steps.find((s) => s.nodeId === 'send').status).toBe('SUCCEEDED');
    expect(calls.some((c) => c.method === 'answerCallbackQuery')).toBe(true);
    // The buttons go, and the chat is told the outcome.
    expect(
      calls.some((c) => c.method === 'editMessageReplyMarkup' && c.body.message_id === 77)
    ).toBe(true);
    expect(calls.filter((c) => c.method === 'sendMessage').at(-1)!.body.text).toMatch(
      /Утверждено — @editor/
    );
  });

  it('only the listed approvers can decide; “Reject” stops the steps below', async () => {
    const { api, headers, run } = await start({ approvers: '@boss' });
    const token = calls
      .find((c) => c.method === 'sendMessage')!
      .body.reply_markup.inline_keyboard[0][0].callback_data.slice(5);
    press(true, token, 'stranger');
    await new Promise((r) => setTimeout(r, 400));
    const still = await until(api, headers, run.execution.id, 'WAITING');
    expect(still.execution.status).toBe('WAITING');
    expect(calls.find((c) => c.method === 'answerCallbackQuery')!.body.text).toMatch(
      /нет в списке/
    );

    press(false, token, 'Boss');
    const done = await until(api, headers, run.execution.id, 'SUCCEEDED');
    expect(done.steps.find((s) => s.nodeId === 'ok').outputPayload).toMatchObject({
      approved: false,
      reason: 'rejected',
    });
    expect(done.steps.find((s) => s.nodeId === 'send')?.status ?? 'SKIPPED').toBe('SKIPPED');
  });

  it('a decision in History closes the Telegram request too', async () => {
    const { api, headers, run } = await start({});
    const res = await api.inject({
      method: 'POST',
      url: `/api/v1/executions/${run.execution.id}/approval`,
      headers,
      body: { decision: 'approved' },
    });
    expect(res.statusCode).toBe(202);
    await until(api, headers, run.execution.id, 'SUCCEEDED');
    expect(calls.some((c) => c.method === 'editMessageReplyMarkup')).toBe(true);
  });
});
