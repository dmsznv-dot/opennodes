import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalFlowApiServer } from '../src/index.js';
import type { ApiConfig } from '../src/config.js';

type Port = { id: string; name: string; type: 'any'; direction: 'input' | 'output' };
const p = (id: string, direction: 'input' | 'output'): Port => ({
  id,
  name: id,
  type: 'any',
  direction,
});
const node = (id: string, type: string, config: Record<string, unknown> = {}, outs = ['main']) => ({
  id,
  type,
  data: { label: id, config },
  inputs: type.startsWith('trigger.') ? [] : [p('main', 'input')],
  outputs: outs.map((o) => p(o, 'output')),
});
const edge = (source: string, target: string, sourceHandle = 'main') => ({
  id: `${source}-${target}`,
  source,
  sourceHandle,
  target,
  targetHandle: 'main',
});

type Exec = { id: string; status: string; metadata?: { resumeAt?: string } };
type Step = { nodeId: string; status: string; outputPayload: any };

const servers: LocalFlowApiServer[] = [];
const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => s.close()));
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

async function boot(config: Partial<ApiConfig> = {}) {
  const api = new LocalFlowApiServer({ databaseUrl: 'pglite://memory', ...config });
  servers.push(api);
  return api;
}

async function owner(api: LocalFlowApiServer) {
  const res = await api.inject<{ workspaceId: string; token: string }>({
    method: 'POST',
    url: '/api/v1/setup',
    body: { email: 'owner@localflow.dev', password: 'StrongPassword123!' },
  });
  return {
    workspaceId: res.body.workspaceId,
    headers: { Authorization: `Bearer ${res.body.token}` },
  };
}

async function login(api: LocalFlowApiServer) {
  const res = await api.inject<{ token: string }>({
    method: 'POST',
    url: '/api/v1/auth/login',
    body: { email: 'owner@localflow.dev', password: 'StrongPassword123!' },
  });
  return { Authorization: `Bearer ${res.body.token}` };
}

async function publish(
  api: LocalFlowApiServer,
  ctx: { workspaceId: string; headers: Record<string, string> },
  nodes: ReturnType<typeof node>[],
  edges: ReturnType<typeof edge>[]
) {
  const wf = await api.inject<{ id: string }>({
    method: 'POST',
    url: `/api/v1/workspaces/${ctx.workspaceId}/workflows`,
    headers: ctx.headers,
    body: { name: 'q', nodes, edges },
  });
  const pub = await api.inject({
    method: 'POST',
    url: `/api/v1/workflows/${wf.body.id}/publish`,
    headers: ctx.headers,
  });
  expect(pub.statusCode).toBe(201);
  return wf.body.id;
}

async function getRun(api: LocalFlowApiServer, headers: Record<string, string>, id: string) {
  const res = await api.inject<{ execution: Exec; steps: Step[] }>({
    method: 'GET',
    url: `/api/v1/executions/${id}`,
    headers,
  });
  return res.body;
}

async function until(
  api: LocalFlowApiServer,
  headers: Record<string, string>,
  id: string,
  status: string,
  timeoutMs = 8_000
) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const run = await getRun(api, headers, id);
    if (run.execution.status === status) return run;
    if (Date.now() > deadline) {
      throw new Error(`run ${id} is ${run.execution.status}, expected ${status}`);
    }
    await new Promise((r) => setTimeout(r, 50));
  }
}

describe('@localflow/api — runs go through the queue and the worker (S-3)', () => {
  it('queues a run and returns at once; the worker completes it', async () => {
    const api = await boot();
    const ctx = await owner(api);
    const wfId = await publish(
      api,
      ctx,
      [
        node('t', 'trigger.manual'),
        node('m', 'primitive.map', { transform: { v: '{{ $trigger.v }}' } }),
      ],
      [edge('t', 'm')]
    );
    const res = await api.inject<{ execution: Exec }>({
      method: 'POST',
      url: `/api/v1/workflows/${wfId}/execute`,
      headers: ctx.headers,
      body: { payload: { v: 42 } },
    });
    expect(res.statusCode).toBe(202);
    expect(res.body.execution.status).toBe('QUEUED');
    const done = await until(api, ctx.headers, res.body.execution.id, 'SUCCEEDED');
    expect(done.steps.find((s) => s.nodeId === 'm')!.outputPayload).toEqual({ v: 42 });
  });

  it('suspends on a long delay (WAITING), then resumes on the right branch without duplicate steps', async () => {
    const api = await boot({ inlineDelayMaxMs: 0 });
    const ctx = await owner(api);
    const wfId = await publish(
      api,
      ctx,
      [
        node('t', 'trigger.manual'),
        node('if', 'primitive.branchIf', { condition: '{{ $trigger.go }}' }, ['true', 'false']),
        node('wait', 'primitive.delay', { delayMs: 400 }),
        node('yes', 'primitive.map', { transform: { name: '{{ $trigger.name }}' } }),
        node('no', 'primitive.map', { transform: { never: true } }),
      ],
      [edge('t', 'if'), edge('if', 'wait', 'true'), edge('wait', 'yes'), edge('if', 'no', 'false')]
    );
    const started = Date.now();
    const res = await api.inject<{ execution: Exec; steps: Step[] }>({
      method: 'POST',
      url: `/api/v1/workflows/${wfId}/execute`,
      headers: ctx.headers,
      body: { payload: { go: true, name: 'Аня' }, wait: true },
    });
    expect(res.statusCode).toBe(200);
    expect(res.body.execution.status).toBe('WAITING');
    expect(res.body.execution.metadata?.resumeAt).toBeTruthy();
    const waiting = res.body.steps.find((s) => s.nodeId === 'wait')!;
    expect(waiting.status).toBe('PENDING');
    expect(waiting.outputPayload.waitingUntil).toBeTruthy();

    const done = await until(api, ctx.headers, res.body.execution.id, 'SUCCEEDED');
    expect(Date.now() - started).toBeGreaterThanOrEqual(350);
    const byNode = Object.fromEntries(done.steps.map((s) => [s.nodeId, s]));
    expect(done.steps).toHaveLength(5); // one row per step, none duplicated by the resume
    expect(byNode.wait!.status).toBe('SUCCEEDED');
    expect(byNode.yes!.status).toBe('SUCCEEDED');
    expect(byNode.yes!.outputPayload).toEqual({ name: 'Аня' }); // trigger restored on resume
    expect(byNode.no!.status).toBe('SKIPPED');
  });

  it('cancels a waiting run; it is never resumed', async () => {
    const api = await boot({ inlineDelayMaxMs: 0 });
    const ctx = await owner(api);
    const wfId = await publish(
      api,
      ctx,
      [
        node('t', 'trigger.manual'),
        node('wait', 'primitive.delay', { delayMs: 300 }),
        node('m', 'primitive.map', { transform: { ran: true } }),
      ],
      [edge('t', 'wait'), edge('wait', 'm')]
    );
    const res = await api.inject<{ execution: Exec }>({
      method: 'POST',
      url: `/api/v1/workflows/${wfId}/execute`,
      headers: ctx.headers,
      body: { wait: true },
    });
    expect(res.body.execution.status).toBe('WAITING');
    const cancel = await api.inject<{ execution: Exec }>({
      method: 'POST',
      url: `/api/v1/executions/${res.body.execution.id}/cancel`,
      headers: ctx.headers,
    });
    expect(cancel.statusCode).toBe(200);
    await new Promise((r) => setTimeout(r, 700)); // past the resume time
    const after = await getRun(api, ctx.headers, res.body.execution.id);
    expect(after.execution.status).toBe('CANCELLED');
    expect(after.steps.find((s) => s.nodeId === 'm')).toBeUndefined();
  });

  it('stops a running run between steps when it is cancelled from another request', async () => {
    const api = await boot({ heartbeatMs: 100 });
    const ctx = await owner(api);
    const wfId = await publish(
      api,
      ctx,
      [
        node('t', 'trigger.manual'),
        node('wait', 'primitive.delay', { delayMs: 3_000 }),
        node('m', 'primitive.map', { transform: { ran: true } }),
      ],
      [edge('t', 'wait'), edge('wait', 'm')]
    );
    const res = await api.inject<{ execution: Exec }>({
      method: 'POST',
      url: `/api/v1/workflows/${wfId}/execute`,
      headers: ctx.headers,
      body: {},
    });
    await until(api, ctx.headers, res.body.execution.id, 'RUNNING');
    const t0 = Date.now();
    await api.inject({
      method: 'POST',
      url: `/api/v1/executions/${res.body.execution.id}/cancel`,
      headers: ctx.headers,
    });
    const after = await until(api, ctx.headers, res.body.execution.id, 'CANCELLED');
    await new Promise((r) => setTimeout(r, 300));
    const settled = await getRun(api, ctx.headers, res.body.execution.id);
    expect(settled.execution.status).toBe('CANCELLED');
    expect(Date.now() - t0).toBeLessThan(2_500); // did not sit out the 3 s delay
    expect(after.steps.find((s) => s.nodeId === 'm')).toBeUndefined();
  });

  it('resumes a waiting run after the API restarts (the in-process timer was lost)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'opennodes-queue-'));
    dirs.push(dir);
    const config = {
      databaseUrl: `pglite://${dir}`,
      inlineDelayMaxMs: 0,
      recoveryStaleMs: 200,
      recoveryIntervalMs: 200,
    };
    const a = await boot(config);
    const ctx = await owner(a);
    const wfId = await publish(
      a,
      ctx,
      [
        node('t', 'trigger.manual'),
        node('wait', 'primitive.delay', { delayMs: 300 }),
        node('m', 'primitive.map', { transform: { ran: true } }),
      ],
      [edge('t', 'wait'), edge('wait', 'm')]
    );
    const res = await a.inject<{ execution: Exec }>({
      method: 'POST',
      url: `/api/v1/workflows/${wfId}/execute`,
      headers: ctx.headers,
      body: { wait: true },
    });
    expect(res.body.execution.status).toBe('WAITING');
    await a.close();
    servers.splice(servers.indexOf(a), 1);

    const b = await boot(config);
    await b.ready();
    const headers = await login(b);
    const done = await until(b, headers, res.body.execution.id, 'SUCCEEDED');
    expect(done.steps.find((s) => s.nodeId === 'm')!.outputPayload).toEqual({ ran: true });
    expect(done.steps).toHaveLength(3);
  });
});

describe('@localflow/api — Approval: the run waits for a person', () => {
  async function start(timeoutHours?: number) {
    const api = await boot();
    const ctx = await owner(api);
    const wfId = await publish(
      api,
      ctx,
      [
        node('t', 'trigger.manual'),
        node('ok', 'core.approval', {
          title: 'Пост в канал',
          content: 'Текст: {{ $trigger.text }}',
          ...(timeoutHours ? { timeoutHours } : {}),
        }),
        node('send', 'primitive.map', { transform: { sent: '{{ $trigger.text }}' } }),
      ],
      [edge('t', 'ok'), edge('ok', 'send')]
    );
    const res = await api.inject<{ execution: Exec; steps: Step[] }>({
      method: 'POST',
      url: `/api/v1/workflows/${wfId}/execute`,
      headers: ctx.headers,
      body: { payload: { text: 'Привет' }, wait: true },
    });
    return { api, ctx, res };
  }
  const decide = (
    api: LocalFlowApiServer,
    headers: Record<string, string>,
    id: string,
    decision: string
  ) =>
    api.inject<{ code?: string }>({
      method: 'POST',
      url: `/api/v1/executions/${id}/approval`,
      headers,
      body: { decision },
    });

  it('waits with what to approve; “approve” runs the steps below', async () => {
    const { api, ctx, res } = await start();
    expect(res.body.execution.status).toBe('WAITING');
    const waiting = res.body.steps.find((s) => s.nodeId === 'ok')!;
    expect(waiting.outputPayload).toMatchObject({
      approval: true,
      title: 'Пост в канал',
      content: 'Текст: Привет',
    });
    expect(res.body.steps.find((s) => s.nodeId === 'send')).toBeUndefined();

    expect((await decide(api, ctx.headers, res.body.execution.id, 'approved')).statusCode).toBe(
      202
    );
    const done = await until(api, ctx.headers, res.body.execution.id, 'SUCCEEDED');
    const byNode = Object.fromEntries(done.steps.map((s) => [s.nodeId, s]));
    expect(byNode.ok!.outputPayload).toMatchObject({ approved: true, content: 'Текст: Привет' });
    expect(byNode.send!.outputPayload).toEqual({ sent: 'Привет' });
    expect(done.steps).toHaveLength(3);
    // Decided once: a second answer is refused.
    expect((await decide(api, ctx.headers, res.body.execution.id, 'rejected')).statusCode).toBe(
      409
    );
  });

  it('“reject” stops the steps below — nothing is sent', async () => {
    const { api, ctx, res } = await start();
    await decide(api, ctx.headers, res.body.execution.id, 'rejected');
    const done = await until(api, ctx.headers, res.body.execution.id, 'SUCCEEDED');
    const byNode = Object.fromEntries(done.steps.map((s) => [s.nodeId, s]));
    expect(byNode.ok!.outputPayload).toMatchObject({ approved: false, reason: 'rejected' });
    expect(byNode.send?.status ?? 'SKIPPED').toBe('SKIPPED');
  });

  it('no answer in time counts as “no”', async () => {
    const { api, ctx, res } = await start(0.0001); // ~0.4 s
    const done = await until(api, ctx.headers, res.body.execution.id, 'SUCCEEDED');
    const byNode = Object.fromEntries(done.steps.map((s) => [s.nodeId, s]));
    expect(byNode.ok!.outputPayload).toMatchObject({ approved: false, reason: 'timeout' });
    expect(byNode.send?.status ?? 'SKIPPED').toBe('SKIPPED');
  });

  it('refuses a wrong answer and a run that does not wait for one', async () => {
    const { api, ctx, res } = await start();
    expect((await decide(api, ctx.headers, res.body.execution.id, 'maybe')).statusCode).toBe(400);
    const other = await decide(
      api,
      ctx.headers,
      '00000000-0000-4000-8000-000000000000',
      'approved'
    );
    expect(other.statusCode).toBe(404);
  });
});
