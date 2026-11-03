import { describe, it, expect, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { LocalFlowApiServer } from '../src/index.js';

/** Endpoints the web app needs beyond the original API (S-14) and the editor's steps. */
const servers: LocalFlowApiServer[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => s.close()));
});

const port = (direction: 'input' | 'output') => [
  { id: 'main', name: direction, type: 'any' as const, direction, required: false },
];
const node = (
  id: string,
  type: string,
  config: Record<string, unknown> = {},
  extra: Record<string, unknown> = {}
) => ({
  id,
  type,
  data: { label: id, config, ...extra },
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
  const api = new LocalFlowApiServer({ databaseUrl: 'pglite://memory' });
  servers.push(api);
  const res = await api.inject<{ workspaceId: string; token: string }>({
    method: 'POST',
    url: '/api/v1/setup',
    body: {
      email: 'owner@localflow.dev',
      password: 'StrongPassword123!',
      workspaceName: 'Моя команда',
    },
  });
  const headers = { Authorization: `Bearer ${res.body.token}` };
  const call = <T = any>(method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, body?: unknown) =>
    api.inject<T>({ method, url, headers, body });
  return { api, headers, call, workspaceId: res.body.workspaceId, token: res.body.token };
}

describe('@localflow/api — endpoints for the web app', () => {
  it('tells the app who is signed in, and signs out', async () => {
    const t = await setup();
    const me = await t.call('GET', '/api/v1/me');
    expect(me.statusCode).toBe(200);
    expect(me.body.user.email).toBe('owner@localflow.dev');
    expect(me.body.workspaces).toEqual([
      { id: t.workspaceId, name: 'Моя команда', slug: 'moya-komanda', role: 'OWNER' },
    ]);
    expect((await t.call('POST', '/api/v1/auth/logout')).statusCode).toBe(200);
    expect((await t.call('GET', '/api/v1/me')).statusCode).toBe(401);
  });

  it('lists only the steps this server can run', async () => {
    const t = await setup();
    const res = await t.call('GET', '/api/v1/catalog');
    expect(res.body.nodeTypes).toEqual(
      expect.arrayContaining([
        'trigger.cron',
        'trigger.telegram',
        'ai.openai',
        'ai.classify',
        'logic.condition',
        'text.compose',
        'primitive.delay',
        'core.telegramBot',
      ])
    );
    expect(res.body.nodeTypes).toContain('core.smtp');
    expect(res.body.nodeTypes).not.toContain('core.postgresSql');
    expect(res.body.notImplemented).toEqual(['core.postgresSql']);
  });

  it('creates with a client id, renames, reads, turns off and on, deletes', async () => {
    const t = await setup();
    const id = randomUUID();
    const nodes = [node('t', 'trigger.webhook')];
    const created = await t.call('POST', `/api/v1/workspaces/${t.workspaceId}/workflows`, {
      id,
      name: 'Заявки',
      nodes,
      edges: [],
    });
    expect(created.statusCode).toBe(201);
    expect(created.body.id).toBe(id);
    const dup = await t.call('POST', `/api/v1/workspaces/${t.workspaceId}/workflows`, {
      id,
      name: 'x',
      nodes,
      edges: [],
    });
    expect(dup.statusCode).toBe(409);

    await t.call('PUT', `/api/v1/workflows/${id}/draft`, {
      name: 'Заявки с сайта',
      nodes,
      edges: [],
    });
    const read = await t.call('GET', `/api/v1/workflows/${id}`);
    expect(read.body).toMatchObject({
      name: 'Заявки с сайта',
      isActive: false,
      activeVersion: null,
    });

    // Turning on needs a published version; publishing turns it on.
    expect(
      (await t.call('PUT', `/api/v1/workflows/${id}/active`, { active: true })).statusCode
    ).toBe(400);
    expect((await t.call('POST', `/api/v1/workflows/${id}/publish`)).statusCode).toBe(201);
    expect((await t.call('GET', `/api/v1/workflows/${id}`)).body.isActive).toBe(true);
    const hook = () =>
      t.api.inject({ method: 'POST', url: `/api/v1/webhooks/${id}`, body: { a: 1 } });
    expect((await hook()).statusCode).toBe(202);

    // Off: webhooks are refused until it is turned on again.
    await t.call('PUT', `/api/v1/workflows/${id}/active`, { active: false });
    const off = await hook();
    expect(off.statusCode).toBe(409);
    expect((off.body as { code: string }).code).toBe('ERR_WORKFLOW_INACTIVE');
    await t.call('PUT', `/api/v1/workflows/${id}/active`, { active: true });
    expect((await hook()).statusCode).toBe(202);

    // Deleting removes the workflow with its versions and history.
    expect((await t.call('DELETE', `/api/v1/workflows/${id}`)).statusCode).toBe(200);
    expect((await t.call('GET', `/api/v1/workflows/${id}`)).statusCode).toBe(404);
    const runs = await t.call('GET', `/api/v1/workspaces/${t.workspaceId}/executions`);
    expect(runs.body.executions).toEqual([]);
  });

  it('lists runs with their steps, newest first, per workflow', async () => {
    const t = await setup();
    const create = async (name: string) => {
      const wf = await t.call('POST', `/api/v1/workspaces/${t.workspaceId}/workflows`, {
        name,
        nodes: [
          node('t', 'trigger.manual'),
          node('c', 'text.compose', { template: 'Привет, {{ $trigger.text }}' }),
        ],
        edges: chain(['t', 'c']),
      });
      await t.call('POST', `/api/v1/workflows/${wf.body.id}/publish`);
      return wf.body.id as string;
    };
    const a = await create('a');
    const b = await create('b');
    await t.call('POST', `/api/v1/workflows/${a}/execute`, {
      payload: { text: 'мир' },
      wait: true,
    });
    await t.call('POST', `/api/v1/workflows/${b}/execute`, { payload: { text: 'b' }, wait: true });

    const all = await t.call('GET', `/api/v1/workspaces/${t.workspaceId}/executions`);
    expect(all.body.executions.map((r: any) => r.workflowId)).toEqual([b, a]);
    const onlyA = await t.call(
      'GET',
      `/api/v1/workspaces/${t.workspaceId}/executions?workflowId=${a}`
    );
    expect(onlyA.body.executions).toHaveLength(1);
    const run = onlyA.body.executions[0];
    expect(run.status).toBe('SUCCEEDED');
    expect(run.steps.map((s: any) => [s.nodeId, s.status])).toEqual([
      ['t', 'SUCCEEDED'],
      ['c', 'SUCCEEDED'],
    ]);
    expect(run.steps[1].outputPayload).toEqual({ text: 'Привет, мир' });
  });

  it('test-runs the draft with real steps without recording it', async () => {
    const t = await setup();
    const nodes = [
      node('t', 'trigger.manual'),
      node('if', 'logic.condition', {
        left: '{{ $trigger.text }}',
        operator: 'contains',
        right: 'срочно',
      }),
      node('off', 'text.compose', { template: 'выключен' }, { disabled: true }),
      node('say', 'text.compose', { template: 'Важно: {{ $trigger.text }}' }),
    ];
    const wf = await t.call('POST', `/api/v1/workspaces/${t.workspaceId}/workflows`, {
      name: 'test',
      nodes,
      edges: chain(['t', 'if', 'off', 'say']),
    });
    const test = (payload: unknown, extra: Record<string, unknown> = {}) =>
      t.call('POST', `/api/v1/workflows/${wf.body.id}/test-run`, { payload, ...extra });

    const pass = await test({ text: 'Это срочно!' });
    expect(pass.statusCode).toBe(200);
    expect(pass.body.execution.status).toBe('SUCCEEDED');
    const by = Object.fromEntries(pass.body.steps.map((s: any) => [s.nodeId, s]));
    expect(by.if.outputPayload.passed).toBe(true);
    expect(by.off).toMatchObject({ status: 'SKIPPED', outputPayload: { disabled: true } });
    expect(by.say.outputPayload).toEqual({ text: 'Важно: Это срочно!' }); // flow went past the switched-off step

    const stop = await test({ text: 'обычное' });
    const by2 = Object.fromEntries(stop.body.steps.map((s: any) => [s.nodeId, s]));
    expect(by2.if.outputPayload.passed).toBe(false);
    expect(by2.say.status).toBe('SKIPPED');
    expect(stop.body.execution.status).toBe('SUCCEEDED');

    // Only up to one step; and a graph sent by the editor wins over the saved draft.
    const until = await test({ text: 'срочно' }, { untilNodeId: 'if' });
    expect(until.body.steps.map((s: any) => s.nodeId)).toEqual(['t', 'if']);
    const sent = await test(
      { text: 'x' },
      {
        nodes: [
          node('t', 'trigger.manual'),
          node('c', 'text.compose', { template: 'из редактора' }),
        ],
        edges: chain(['t', 'c']),
      }
    );
    expect(sent.body.steps[1].outputPayload).toEqual({ text: 'из редактора' });

    const history = await t.call('GET', `/api/v1/workspaces/${t.workspaceId}/executions`);
    expect(history.body.executions).toEqual([]); // tests are not recorded
  });

  it('runs the editor delay as amount + unit', async () => {
    const t = await setup();
    const wf = await t.call('POST', `/api/v1/workspaces/${t.workspaceId}/workflows`, {
      name: 'd',
      nodes: [
        node('t', 'trigger.manual'),
        node('d', 'primitive.delay', { amount: 0.2, unit: 'seconds' }),
      ],
      edges: chain(['t', 'd']),
    });
    const started = Date.now();
    const res = await t.call('POST', `/api/v1/workflows/${wf.body.id}/test-run`, {});
    expect(res.body.execution.status).toBe('SUCCEEDED');
    expect(Date.now() - started).toBeGreaterThanOrEqual(190);
  });

  it('deletes and checks connections', async () => {
    const t = await setup();
    const created = await t.call('POST', `/api/v1/workspaces/${t.workspaceId}/credentials`, {
      name: 'SMTP',
      type: 'smtp',
      secrets: { password: 'x' },
    });
    const check = await t.call(
      'GET',
      `/api/v1/workspaces/${t.workspaceId}/credentials/${created.body.id}/check`
    );
    expect(check.body.ok).toBe(true);
    expect(check.body.message).toMatch(/cannot be checked/);
    const bad = await t.call('POST', `/api/v1/workspaces/${t.workspaceId}/credentials`, {
      name: 'tg',
      type: 'telegram',
      secrets: {},
    });
    const tg = await t.call(
      'GET',
      `/api/v1/workspaces/${t.workspaceId}/credentials/${bad.body.id}/check`
    );
    expect(tg.body).toEqual({ ok: false, message: 'The connection has no bot token.' });

    expect(
      (await t.call('DELETE', `/api/v1/workspaces/${t.workspaceId}/credentials/${created.body.id}`))
        .statusCode
    ).toBe(200);
    const list = await t.call('GET', `/api/v1/workspaces/${t.workspaceId}/credentials`);
    expect(list.body.credentials.map((c: any) => c.id)).toEqual([bad.body.id]);
    expect(
      (await t.call('DELETE', `/api/v1/workspaces/${t.workspaceId}/credentials/${created.body.id}`))
        .statusCode
    ).toBe(404);
  });
});
