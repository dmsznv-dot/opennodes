import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalFlowApiServer } from '../src/index.js';

const OWNER = { email: 'owner@localflow.dev', password: 'StrongPassword123!' };
const port = (type: 'input' | 'output') => [
  { id: 'main', name: type, type: 'any' as const, direction: type, required: false },
];
const NODES = [
  {
    id: 'trig',
    type: 'trigger.manual',
    data: { label: 'Start', config: {} },
    inputs: [],
    outputs: port('output'),
  },
  {
    id: 'map',
    type: 'primitive.map',
    data: { label: 'Greet', config: { transform: { greeting: 'Hi {{ $trigger.name }}' } } },
    inputs: port('input'),
    outputs: port('output'),
  },
];
const EDGES = [
  { id: 'e1', source: 'trig', sourceHandle: 'main', target: 'map', targetHandle: 'main' },
];

const dirs: string[] = [];
const servers: LocalFlowApiServer[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => s.close()));
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function boot(databaseUrl: string): LocalFlowApiServer {
  const api = new LocalFlowApiServer({ databaseUrl });
  servers.push(api);
  return api;
}
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

describe('@localflow/api — state survives a restart (BUG-09 / S-1)', () => {
  it('keeps owner, sessions, workflows, versions, credentials and run history; setup stays locked', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'opennodes-api-'));
    dirs.push(dir);
    const url = `pglite://${dir}`;

    // ── first process ──
    const a = boot(url);
    const setup = await a.inject<{ workspaceId: string; token: string }>({
      method: 'POST',
      url: '/api/v1/setup',
      body: { ...OWNER, workspaceName: 'Persisted' },
    });
    expect(setup.statusCode).toBe(201);
    const { workspaceId, token } = setup.body;

    const cred = await a.inject<{ id: string }>({
      method: 'POST',
      url: `/api/v1/workspaces/${workspaceId}/credentials`,
      headers: auth(token),
      body: { name: 'TG', type: 'telegram', secrets: { botToken: '123:secret-XYZ' } },
    });
    const wf = await a.inject<{ id: string }>({
      method: 'POST',
      url: `/api/v1/workspaces/${workspaceId}/workflows`,
      headers: auth(token),
      body: { name: 'Greeter', webhookSecret: 'whsec_persist', nodes: NODES, edges: EDGES },
    });
    expect(wf.body).not.toHaveProperty('webhookSecret');
    await a.inject({
      method: 'POST',
      url: `/api/v1/workflows/${wf.body.id}/publish`,
      headers: auth(token),
    });
    const run = await a.inject<{ execution: { id: string; status: string } }>({
      method: 'POST',
      url: `/api/v1/workflows/${wf.body.id}/execute`,
      headers: auth(token),
      body: { payload: { name: 'Аня' }, wait: true },
    });
    expect(run.body.execution.status).toBe('SUCCEEDED');
    await a.close();

    // ── second process, same database ──
    const b = boot(url);
    const status = await b.inject<{ bootstrapped: boolean }>({
      method: 'GET',
      url: '/api/v1/setup/status',
    });
    expect(status.body.bootstrapped).toBe(true);

    const hijack = await b.inject({
      method: 'POST',
      url: '/api/v1/setup',
      body: { email: 'attacker@localflow.dev', password: 'StrongPassword123!' },
    });
    expect(hijack.statusCode).toBe(409);

    const login = await b.inject({ method: 'POST', url: '/api/v1/auth/login', body: OWNER });
    expect(login.statusCode).toBe(200);

    const list = await b.inject<{
      workflows: Array<{ id: string; activeVersion: number; draft: { nodes: unknown[] } }>;
    }>({
      method: 'GET',
      url: `/api/v1/workspaces/${workspaceId}/workflows`,
      headers: auth(token), // session issued before the restart
    });
    expect(list.statusCode).toBe(200);
    expect(list.body.workflows).toHaveLength(1);
    expect(list.body.workflows[0]!.activeVersion).toBe(1);
    expect(list.body.workflows[0]!.draft.nodes).toHaveLength(2);

    const creds = await b.inject<{ credentials: Array<{ id: string }> }>({
      method: 'GET',
      url: `/api/v1/workspaces/${workspaceId}/credentials`,
      headers: auth(token),
    });
    expect(creds.body.credentials.map((c) => c.id)).toEqual([cred.body.id]);
    expect(creds.rawBody).not.toContain('secret-XYZ');

    const exec = await b.inject<{
      execution: { status: string };
      steps: Array<{ nodeId: string; outputPayload: { greeting: string } }>;
    }>({
      method: 'GET',
      url: `/api/v1/executions/${run.body.execution.id}`,
      headers: auth(token),
    });
    expect(exec.statusCode).toBe(200);
    expect(exec.body.execution.status).toBe('SUCCEEDED');
    expect(exec.body.steps.map((s) => s.nodeId)).toEqual(['trig', 'map']);
    expect(exec.body.steps[1]!.outputPayload.greeting).toBe('Hi Аня');

    const events = await b.inject<string>({
      method: 'GET',
      url: `/api/v1/executions/${run.body.execution.id}/events`,
      headers: auth(token),
    });
    expect(events.rawBody).toContain('event: execution.succeeded');

    // Webhook secret was stored encrypted and still verifies after restart
    const bad = await b.inject({
      method: 'POST',
      url: `/api/v1/webhooks/${wf.body.id}`,
      headers: { 'x-hub-signature-256': 'sha256=00' },
      body: { a: 1 },
    });
    expect(bad.statusCode).toBe(401);
  });

  it('lets exactly one of two concurrent first-run setups win', async () => {
    const api = boot('pglite://memory');
    const results = await Promise.all(
      ['a@localflow.dev', 'b@localflow.dev'].map((email) =>
        api.inject({
          method: 'POST',
          url: '/api/v1/setup',
          body: { email, password: 'StrongPassword123!' },
        })
      )
    );
    expect(results.map((r) => r.statusCode).sort()).toEqual([201, 409]);
  });

  it('does not stream a run’s events to users outside its workspace, and treats junk ids as not found', async () => {
    const api = boot('pglite://memory');
    const setup = await api.inject<{ workspaceId: string; token: string }>({
      method: 'POST',
      url: '/api/v1/setup',
      body: OWNER,
    });
    const { workspaceId, token } = setup.body;
    const wf = await api.inject<{ id: string }>({
      method: 'POST',
      url: `/api/v1/workspaces/${workspaceId}/workflows`,
      headers: auth(token),
      body: { name: 'W', nodes: NODES, edges: EDGES },
    });
    await api.inject({
      method: 'POST',
      url: `/api/v1/workflows/${wf.body.id}/publish`,
      headers: auth(token),
    });
    const run = await api.inject<{ execution: { id: string } }>({
      method: 'POST',
      url: `/api/v1/workflows/${wf.body.id}/execute`,
      headers: auth(token),
      body: { wait: true },
    });

    const stranger = await api.createTestUser('stranger@localflow.dev', 'StrongPassword123!');
    const sse = await api.inject({
      method: 'GET',
      url: `/api/v1/executions/${run.body.execution.id}/events`,
      headers: auth(stranger.token),
    });
    expect(sse.statusCode).toBe(403);

    for (const url of [
      '/api/v1/workspaces/ws_other/workflows',
      '/api/v1/workflows/not-a-uuid/publish',
      '/api/v1/executions/not-a-uuid',
    ]) {
      const res = await api.inject({
        method: url.endsWith('publish') ? 'POST' : 'GET',
        url,
        headers: auth(token),
      });
      expect([403, 404], url).toContain(res.statusCode);
    }
  });
});
