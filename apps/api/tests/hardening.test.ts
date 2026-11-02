import { describe, it, expect, afterEach } from 'vitest';
import crypto from 'node:crypto';
import { LocalFlowApiServer } from '../src/index.js';

const servers: LocalFlowApiServer[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => s.close()));
});

const port = (direction: 'input' | 'output') => [
  { id: 'main', name: direction, type: 'any' as const, direction, required: false },
];
const NODES = [
  {
    id: 't',
    type: 'trigger.webhook',
    data: { label: 'Hook', config: {} },
    inputs: [],
    outputs: port('output'),
  },
  {
    id: 'm',
    type: 'primitive.map',
    data: { label: 'Echo', config: { transform: { got: '{{ $trigger.a }}' } } },
    inputs: port('input'),
    outputs: port('output'),
  },
];
const EDGES = [{ id: 'e', source: 't', sourceHandle: 'main', target: 'm', targetHandle: 'main' }];

async function setup(workspaceName = 'Team') {
  const api = new LocalFlowApiServer({ databaseUrl: 'pglite://memory' });
  servers.push(api);
  const res = await api.inject<{ workspaceId: string; token: string; workspaceSlug: string }>({
    method: 'POST',
    url: '/api/v1/setup',
    body: { email: 'owner@localflow.dev', password: 'StrongPassword123!', workspaceName },
  });
  const headers = { Authorization: `Bearer ${res.body.token}` };
  const wf = await api.inject<{ id: string }>({
    method: 'POST',
    url: `/api/v1/workspaces/${res.body.workspaceId}/workflows`,
    headers,
    body: { name: 'w', webhookSecret: 'whsec_raw', nodes: NODES, edges: EDGES },
  });
  return { api, headers, setup: res.body, workflowId: wf.body.id };
}

describe('@localflow/api — input hardening (BUG-09 S-6, S-8, S-9, S-10, S-11)', () => {
  it('S-10/S-9: setup validation errors are 400 with a field; Cyrillic names get a readable slug', async () => {
    const api = new LocalFlowApiServer({ databaseUrl: 'pglite://memory' });
    servers.push(api);
    const bad = await api.inject<{ code: string; details: { field: string } }>({
      method: 'POST',
      url: '/api/v1/setup',
      body: { email: 'bad', password: 'StrongPassword123!' },
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.body.code).toBe('ERR_VALIDATION');
    expect(bad.body.details.field).toBe('email');

    const ok = await api.inject<{ workspaceSlug: string }>({
      method: 'POST',
      url: '/api/v1/setup',
      body: {
        email: 'o@localflow.dev',
        password: 'StrongPassword123!',
        workspaceName: 'Моя команда',
      },
    });
    expect(ok.statusCode).toBe(201);
    expect(ok.body.workspaceSlug).toBe('moya-komanda');
  });

  it('S-6: a malformed draft is rejected and the saved draft is kept', async () => {
    const { api, headers, workflowId, setup: s } = await setup();
    const attempts: unknown[] = ['not json', {}, { nodes: 'x', edges: [] }];
    for (const body of attempts) {
      const res = await api.inject({
        method: 'PUT',
        url: `/api/v1/workflows/${workflowId}/draft`,
        headers,
        body,
      });
      expect(res.statusCode, JSON.stringify(body)).toBe(400);
    }
    const noLabel = await api.inject<{ code: string; message: string }>({
      method: 'PUT',
      url: `/api/v1/workflows/${workflowId}/draft`,
      headers,
      body: { nodes: [{ ...NODES[1], data: { label: '', config: {} } }], edges: [] },
    });
    expect(noLabel.statusCode).toBe(400);
    expect(noLabel.body.message).toContain('nodes.0.data.label');

    const list = await api.inject<{ workflows: Array<{ draft: { nodes: unknown[] } }> }>({
      method: 'GET',
      url: `/api/v1/workspaces/${s.workspaceId}/workflows`,
      headers,
    });
    expect(list.body.workflows[0]!.draft.nodes).toHaveLength(2);
  });

  it('S-8: webhook signatures are checked against the exact bytes received', async () => {
    const { api, headers, workflowId } = await setup();
    await api.inject({ method: 'POST', url: `/api/v1/workflows/${workflowId}/publish`, headers });
    const raw = '{"a":  1 }'; // a sender's own formatting, not JSON.stringify output
    const sig = 'sha256=' + crypto.createHmac('sha256', 'whsec_raw').update(raw).digest('hex');
    const ok = await api.inject<{ status: string }>({
      method: 'POST',
      url: `/api/v1/webhooks/${workflowId}`,
      headers: { 'x-hub-signature-256': sig },
      body: JSON.parse(raw),
      rawBody: raw,
    });
    expect(ok.statusCode).toBe(202);
    expect(ok.body.status).toBe('QUEUED');

    const tampered = await api.inject({
      method: 'POST',
      url: `/api/v1/webhooks/${workflowId}`,
      headers: { 'x-hub-signature-256': sig },
      body: { a: 2 },
      rawBody: '{"a":  2 }',
    });
    expect(tampered.statusCode).toBe(401);
  });

  it('S-11: a finished run cannot be cancelled and keeps its status', async () => {
    const { api, headers, workflowId } = await setup();
    await api.inject({ method: 'POST', url: `/api/v1/workflows/${workflowId}/publish`, headers });
    const run = await api.inject<{ execution: { id: string; status: string } }>({
      method: 'POST',
      url: `/api/v1/workflows/${workflowId}/execute`,
      headers,
      body: { payload: { a: 1 }, wait: true },
    });
    expect(run.body.execution.status).toBe('SUCCEEDED');
    const cancel = await api.inject<{ code: string }>({
      method: 'POST',
      url: `/api/v1/executions/${run.body.execution.id}/cancel`,
      headers,
    });
    expect(cancel.statusCode).toBe(409);
    expect(cancel.body.code).toBe('ERR_EXECUTION_FINISHED');
    const after = await api.inject<{ execution: { status: string } }>({
      method: 'GET',
      url: `/api/v1/executions/${run.body.execution.id}`,
      headers,
    });
    expect(after.body.execution.status).toBe('SUCCEEDED');
  });
});
