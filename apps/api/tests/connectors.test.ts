import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { LocalFlowApiServer } from '../src/index.js';

/** Stand-in for LM Studio / llama.cpp / Ollama `/v1`: records requests, answers like OpenAI. */
const received: Array<{ url: string; headers: http.IncomingHttpHeaders; body: any }> = [];
let failNext = false;
const modelServer = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    received.push({ url: req.url ?? '', headers: req.headers, body: raw ? JSON.parse(raw) : null });
    res.setHeader('content-type', 'application/json');
    if (failNext) {
      failNext = false;
      res.statusCode = 500;
      return res.end(JSON.stringify({ error: { message: 'model failed to load' } }));
    }
    if (req.url === '/v1/models') {
      return res.end(
        JSON.stringify({ data: [{ id: 'qwen2.5-7b-instruct-q4_k_m' }, { id: 'llama-3.2-3b' }] })
      );
    }
    const prompt = JSON.parse(raw).messages.at(-1).content;
    res.end(
      JSON.stringify({
        id: 'chatcmpl-1',
        choices: [{ index: 0, message: { role: 'assistant', content: `echo: ${prompt}` } }],
      })
    );
  });
});
let host = '';

beforeAll(async () => {
  await new Promise<void>((r) => modelServer.listen(0, '127.0.0.1', r));
  host = `127.0.0.1:${(modelServer.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => modelServer.close(() => r())));

const servers: LocalFlowApiServer[] = [];
afterEach(async () => {
  received.length = 0;
  await Promise.all(servers.splice(0).map((s) => s.close()));
});

const port = (direction: 'input' | 'output') => [
  { id: 'main', name: direction, type: 'any' as const, direction, required: false },
];
const node = (
  id: string,
  type: string,
  config: Record<string, unknown> = {},
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

async function setup(allowlist: string[] = []) {
  const api = new LocalFlowApiServer({ databaseUrl: 'pglite://memory', ssrfAllowlist: allowlist });
  servers.push(api);
  const res = await api.inject<{ workspaceId: string; token: string }>({
    method: 'POST',
    url: '/api/v1/setup',
    body: { email: 'owner@localflow.dev', password: 'StrongPassword123!' },
  });
  const { workspaceId, token } = res.body;
  const headers = { Authorization: `Bearer ${token}` };
  const connect = async (type: string, secrets: Record<string, string>) =>
    (
      await api.inject<{ id: string }>({
        method: 'POST',
        url: `/api/v1/workspaces/${workspaceId}/credentials`,
        headers,
        body: { name: type, type, secrets },
      })
    ).body.id;
  const run = async (nodes: ReturnType<typeof node>[], payload: Record<string, unknown> = {}) => {
    const wf = await api.inject<{ id: string }>({
      method: 'POST',
      url: `/api/v1/workspaces/${workspaceId}/workflows`,
      headers,
      body: { name: 'w', nodes, edges: chain(nodes.map((n) => n.id)) },
    });
    const pub = await api.inject({
      method: 'POST',
      url: `/api/v1/workflows/${wf.body.id}/publish`,
      headers,
    });
    expect(pub.statusCode).toBe(201);
    const res = await api.inject<{
      execution: { status: string; errorMessage?: string };
      steps: Array<{ nodeId: string; status: string; errorMessage?: string; outputPayload: any }>;
    }>({
      method: 'POST',
      url: `/api/v1/workflows/${wf.body.id}/execute`,
      headers,
      body: { payload, wait: true },
    });
    return res.body;
  };
  return { api, workspaceId, headers, connect, run };
}

describe('@localflow/api — honest connector execution (S-2)', () => {
  it('fails a Telegram step without a connection instead of reporting success', async () => {
    const { run } = await setup();
    const res = await run([
      node('t', 'trigger.manual'),
      node('tg', 'core.telegramBot', { chatId: '1', text: 'hi', botToken: 'plain-config-token' }),
    ]);
    expect(res.execution.status).toBe('FAILED');
    const tg = res.steps.find((s) => s.nodeId === 'tg')!;
    expect(tg.status).toBe('FAILED');
    expect(tg.errorMessage).toMatch(/no connection selected/);
  });

  it('fails steps of unknown types and of connectors that are not implemented', async () => {
    const { run } = await setup();
    const unknown = await run([node('t', 'trigger.manual'), node('x', 'core.doesNotExist')]);
    expect(unknown.execution.status).toBe('FAILED');
    expect(unknown.steps.find((s) => s.nodeId === 'x')!.errorMessage).toMatch(/No executor/);

    const pg = await run([
      node('t', 'trigger.manual'),
      node('db', 'core.postgresSql', { query: 'select 1' }),
    ]);
    expect(pg.execution.status).toBe('FAILED');
    expect(pg.steps.find((s) => s.nodeId === 'db')!.errorMessage).toMatch(/not implemented/);
  });
});

describe('@localflow/api — local models via an OpenAI-compatible server', () => {
  it('runs a prompt against the model server from the connection and passes text on', async () => {
    const { run, connect } = await setup([host]);
    const cred = await connect('openai-compatible', {
      baseUrl: `http://${host}/v1`,
      defaultModel: 'qwen2.5-7b-instruct-q4_k_m',
    });
    const res = await run(
      [
        node('t', 'trigger.manual'),
        node(
          'ai',
          'ai.openai',
          { prompt: 'Summarize: {{ $trigger.q }}', system: 'Be brief.', apiKey: 'leaked?' },
          cred
        ),
        node('out', 'primitive.map', { transform: { reply: '{{ $nodes.ai.output.text }}' } }),
      ],
      { q: 'Привет' }
    );
    expect(res.execution.status).toBe('SUCCEEDED');
    expect(res.steps.find((s) => s.nodeId === 'out')!.outputPayload).toEqual({
      reply: 'echo: Summarize: Привет',
    });

    const call = received.find((r) => r.url === '/v1/chat/completions')!;
    expect(call.body.model).toBe('qwen2.5-7b-instruct-q4_k_m');
    expect(call.body.messages).toEqual([
      { role: 'system', content: 'Be brief.' },
      { role: 'user', content: 'Summarize: Привет' },
    ]);
    // No key in the connection: none is sent, and the one in plain config is ignored.
    expect(call.headers.authorization).toBeUndefined();
  });

  it('lists the models the server has loaded (connection check)', async () => {
    const { api, connect, workspaceId, headers } = await setup([host]);
    const cred = await connect('openai-compatible', { baseUrl: `http://${host}/v1` });
    const res = await api.inject<{ ok: boolean; models: string[] }>({
      method: 'GET',
      url: `/api/v1/workspaces/${workspaceId}/credentials/${cred}/models`,
      headers,
    });
    expect(res.statusCode).toBe(200);
    expect(res.body.models).toEqual(['qwen2.5-7b-instruct-q4_k_m', 'llama-3.2-3b']);
  });

  it('explains SSRF_ALLOWLIST when the local server is not allowed, and fails on HTTP errors', async () => {
    const blocked = await setup([]);
    const cred = await blocked.connect('openai-compatible', { baseUrl: `http://${host}/v1` });
    const res = await blocked.run([
      node('t', 'trigger.manual'),
      node('ai', 'ai.openai', { prompt: 'hi', model: 'm' }, cred),
    ]);
    expect(res.execution.status).toBe('FAILED');
    expect(res.steps.find((s) => s.nodeId === 'ai')!.errorMessage).toContain(
      `add "${host}" to SSRF_ALLOWLIST`
    );
    expect(received).toHaveLength(0);

    const allowed = await setup([host]);
    const cred2 = await allowed.connect('openai-compatible', { baseUrl: `http://${host}/v1` });
    failNext = true;
    const res2 = await allowed.run([
      node('t', 'trigger.manual'),
      node('ai', 'ai.openai', { prompt: 'hi', model: 'm' }, cred2),
    ]);
    expect(res2.execution.status).toBe('FAILED');
    expect(res2.steps.find((s) => s.nodeId === 'ai')!.errorMessage).toMatch(
      /HTTP 500 — model failed to load/
    );
  });
});
