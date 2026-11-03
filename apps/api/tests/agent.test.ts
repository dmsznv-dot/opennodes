import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { LocalFlowApiServer } from '../src/index.js';

/**
 * One stand-in server: an OpenAI-compatible model at /v1/chat/completions that plays a
 * script, and an MCP server (Streamable HTTP) at /mcp offering Google-Docs-like tools.
 */
type ModelReply = {
  content?: string;
  tool_calls?: Array<{ id: string; name: string; args: unknown }>;
};
let script: ModelReply[] = [];
let modelRequests: any[] = [];
let mcpRequests: Array<{ method: string; headers: http.IncomingHttpHeaders; params: any }> = [];
let mcpStatus = 200;
const docs: Array<{ title: string; text: string }> = [];

const TOOLS = [
  {
    name: 'docs.create_document',
    description: 'Create a Google Doc',
    inputSchema: {
      type: 'object',
      properties: { title: { type: 'string' }, text: { type: 'string' } },
      required: ['title'],
    },
  },
  { name: 'delete_everything', description: 'Danger', inputSchema: { type: 'object' } },
];

const server = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    const body = raw ? JSON.parse(raw) : {};
    if (req.url === '/v1/chat/completions') {
      modelRequests.push(body);
      const next = script.shift() ?? { content: 'done' };
      res.setHeader('content-type', 'application/json');
      return res.end(
        JSON.stringify({
          choices: [
            {
              message: {
                role: 'assistant',
                content: next.content ?? null,
                ...(next.tool_calls && {
                  tool_calls: next.tool_calls.map((c) => ({
                    id: c.id,
                    type: 'function',
                    function: { name: c.name, arguments: JSON.stringify(c.args) },
                  })),
                }),
              },
            },
          ],
        })
      );
    }
    if (req.url === '/mcp') {
      mcpRequests.push({ method: body.method, headers: req.headers, params: body.params });
      if (mcpStatus !== 200) {
        res.statusCode = mcpStatus;
        return res.end();
      }
      if (body.id === undefined) {
        res.statusCode = 202; // notification
        return res.end();
      }
      let result: unknown;
      if (body.method === 'initialize') {
        res.setHeader('mcp-session-id', 'sess-42');
        result = {
          protocolVersion: '2025-06-18',
          capabilities: { tools: {} },
          serverInfo: { name: 'fake-docs', version: '1' },
        };
      } else if (body.method === 'tools/list') {
        result = { tools: TOOLS };
      } else if (body.method === 'tools/call') {
        const { name, arguments: args } = body.params;
        if (name === 'docs.create_document' && args.title) {
          docs.push({ title: args.title, text: args.text ?? '' });
          result = {
            content: [{ type: 'text', text: `Created "${args.title}" (id doc-${docs.length})` }],
          };
        } else {
          result = { isError: true, content: [{ type: 'text', text: 'title is required' }] };
        }
      }
      // Answer tool calls as an SSE stream, everything else as plain JSON.
      if (body.method === 'tools/call') {
        res.setHeader('content-type', 'text/event-stream');
        return res.end(
          `: ping\n\nevent: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: body.id, result })}\n\n`
        );
      }
      res.setHeader('content-type', 'application/json');
      return res.end(JSON.stringify({ jsonrpc: '2.0', id: body.id, result }));
    }
    res.statusCode = 404;
    res.end();
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
  script = [];
  modelRequests = [];
  mcpRequests = [];
  mcpStatus = 200;
  docs.length = 0;
});

const port = (direction: 'input' | 'output') => [
  { id: 'main', name: direction, type: 'any' as const, direction, required: false },
];

async function setup(allowlist = [host]) {
  const api = new LocalFlowApiServer({ databaseUrl: 'pglite://memory', ssrfAllowlist: allowlist });
  apis.push(api);
  const s = await api.inject<{ workspaceId: string; token: string }>({
    method: 'POST',
    url: '/api/v1/setup',
    body: { email: 'owner@localflow.dev', password: 'StrongPassword123!' },
  });
  const ws = s.body.workspaceId;
  const headers = { Authorization: `Bearer ${s.body.token}` };
  const connect = async (type: string, secrets: Record<string, string>) =>
    (
      await api.inject<{ id: string }>({
        method: 'POST',
        url: `/api/v1/workspaces/${ws}/credentials`,
        headers,
        body: { name: type, type, secrets },
      })
    ).body.id;
  const ai = await connect('openai-compatible', {
    baseUrl: `http://${host}/v1`,
    defaultModel: 'gpt-test',
  });
  const mcp = await connect('mcp', { url: `http://${host}/mcp`, token: 'mcp-secret-token' });
  const runAgent = async (config: Record<string, unknown>) => {
    const wf = await api.inject<{ id: string }>({
      method: 'POST',
      url: `/api/v1/workspaces/${ws}/workflows`,
      headers,
      body: {
        name: 'agent',
        nodes: [
          {
            id: 't',
            type: 'trigger.manual',
            data: { label: 't', config: {} },
            inputs: [],
            outputs: port('output'),
          },
          {
            id: 'agent',
            type: 'ai.agent',
            data: { label: 'agent', config: { servers: [mcp], ...config }, credentialId: ai },
            inputs: port('input'),
            outputs: port('output'),
          },
        ],
        edges: [
          { id: 'e', source: 't', sourceHandle: 'main', target: 'agent', targetHandle: 'main' },
        ],
      },
    });
    await api.inject({ method: 'POST', url: `/api/v1/workflows/${wf.body.id}/publish`, headers });
    const res = await api.inject<{
      execution: { status: string; errorMessage?: string };
      steps: any[];
    }>({
      method: 'POST',
      url: `/api/v1/workflows/${wf.body.id}/execute`,
      headers,
      body: { payload: { text: 'Итоги: всё готово' }, wait: true },
    });
    return { ...res.body, agent: res.body.steps.find((st) => st.nodeId === 'agent') };
  };
  return { api, ws, headers, ai, mcp, runAgent };
}

describe('@localflow/api — AI agent with MCP tools', () => {
  it('lets the model call an MCP tool, then returns its answer with a record of the calls', async () => {
    const t = await setup();
    script = [
      {
        tool_calls: [
          {
            id: 'c1',
            name: 's0__docs_create_document',
            args: { title: 'Итоги дня', text: 'всё готово' },
          },
        ],
      },
      { content: 'Создал документ «Итоги дня».' },
    ];
    const res = await t.runAgent({ prompt: 'Запиши в документ: {{ $trigger.text }}' });
    expect(res.execution.status).toBe('SUCCEEDED');
    expect(docs).toEqual([{ title: 'Итоги дня', text: 'всё готово' }]);
    expect(res.agent.outputPayload).toMatchObject({
      text: 'Создал документ «Итоги дня».',
      steps: 2,
      toolCalls: [
        {
          server: host,
          tool: 'docs.create_document',
          arguments: { title: 'Итоги дня', text: 'всё готово' },
          ok: true,
          result: 'Created "Итоги дня" (id doc-1)',
        },
      ],
    });

    // The model saw the task (with data filled in) and the tools under callable names.
    expect(modelRequests[0].model).toBe('gpt-test');
    expect(modelRequests[0].messages.at(-1)).toEqual({
      role: 'user',
      content: 'Запиши в документ: Итоги: всё готово',
    });
    expect(modelRequests[0].tools.map((x: any) => x.function.name)).toEqual([
      's0__docs_create_document',
      's0__delete_everything',
    ]);
    // …and got the tool result back before answering.
    expect(modelRequests[1].messages.at(-1)).toEqual({
      role: 'tool',
      tool_call_id: 'c1',
      content: 'Created "Итоги дня" (id doc-1)',
    });

    // MCP: handshake once, one session, the token on every request.
    expect(mcpRequests.map((r) => r.method)).toEqual([
      'initialize',
      'notifications/initialized',
      'tools/list',
      'tools/call',
    ]);
    expect(mcpRequests.slice(1).every((r) => r.headers['mcp-session-id'] === 'sess-42')).toBe(true);
    expect(mcpRequests.every((r) => r.headers.authorization === 'Bearer mcp-secret-token')).toBe(
      true
    );
  });

  it('offers only allowed tools, passes tool errors back to the model, and keeps them in the record', async () => {
    const t = await setup();
    script = [
      { tool_calls: [{ id: 'c1', name: 's0__docs_create_document', args: {} }] },
      { content: 'Не получилось: нет названия.' },
    ];
    const res = await t.runAgent({ prompt: 'x', allowedTools: 'docs.create_document' });
    expect(res.execution.status).toBe('SUCCEEDED');
    expect(modelRequests[0].tools.map((x: any) => x.function.name)).toEqual([
      's0__docs_create_document',
    ]);
    expect(res.agent.outputPayload.toolCalls[0]).toMatchObject({
      ok: false,
      result: 'title is required',
    });
  });

  it('stops after the step limit instead of looping forever', async () => {
    const t = await setup();
    script = Array.from({ length: 5 }, (_, i) => ({
      tool_calls: [{ id: `c${i}`, name: 's0__docs_create_document', args: { title: `d${i}` } }],
    }));
    const res = await t.runAgent({ prompt: 'x', maxSteps: 2 });
    expect(res.execution.status).toBe('FAILED');
    expect(res.agent.errorMessage).toMatch(
      /stopped after 2 steps without a final answer \(2 tool calls\)/
    );
    expect(docs).toHaveLength(2);
  });

  it('explains MCP access errors and the SSRF policy; never shows the token', async () => {
    const t = await setup();
    mcpStatus = 401;
    const denied = await t.runAgent({ prompt: 'x' });
    expect(denied.execution.status).toBe('FAILED');
    expect(denied.agent.errorMessage).toMatch(/refused access \(HTTP 401\); check the token/);
    expect(JSON.stringify(denied)).not.toContain('mcp-secret-token');

    const blocked = await setup([`127.0.0.1:1`, `${host.split(':')[0]}:9`]); // model and MCP not allowed
    const res = await blocked.runAgent({ prompt: 'x' });
    expect(res.execution.status).toBe('FAILED');
    expect(res.agent.errorMessage).toMatch(/blocked|SSRF/i);
  });

  it('“Check connection” lists the tools of an MCP server', async () => {
    const t = await setup();
    const res = await t.api.inject<{ ok: boolean; message: string; tools: string[] }>({
      method: 'GET',
      url: `/api/v1/workspaces/${t.ws}/credentials/${t.mcp}/check`,
      headers: t.headers,
    });
    expect(res.body).toEqual({
      ok: true,
      message: '2 tools: docs.create_document, delete_everything',
      tools: ['docs.create_document', 'delete_everything'],
    });
  });
});
