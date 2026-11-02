import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { sql } from 'drizzle-orm';
import { LocalFlowApiServer } from '../src/index.js';
import type { ApiConfig } from '../src/config.js';

/** Stand-in for api.telegram.org: serves queued updates by offset, like getUpdates. */
const BOT_TOKEN = '123456:TEST-token';
let updates: Array<Record<string, unknown>> = [];
let offsets: number[] = [];
let answerConflict = false;
const telegram = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  res.setHeader('content-type', 'application/json');
  if (url.pathname !== `/bot${BOT_TOKEN}/getUpdates`) {
    res.statusCode = 401;
    return res.end(JSON.stringify({ ok: false, error_code: 401, description: 'Unauthorized' }));
  }
  if (answerConflict) {
    res.statusCode = 409;
    return res.end(
      JSON.stringify({ ok: false, error_code: 409, description: 'Conflict: webhook is active' })
    );
  }
  const offset = Number(url.searchParams.get('offset') ?? 0);
  offsets.push(offset);
  // Like Telegram: asking with an offset confirms (drops) every earlier update.
  updates = updates.filter((u) => (u.update_id as number) >= offset);
  res.end(JSON.stringify({ ok: true, result: updates }));
});
let telegramHost = '';
let nextUpdateId = 1000;
const say = (text: string, opts: { sentAt?: number; from?: string } = {}) =>
  updates.push({
    update_id: nextUpdateId++,
    message: {
      message_id: nextUpdateId,
      date: Math.floor((opts.sentAt ?? Date.now()) / 1000),
      text,
      chat: { id: 4242, type: 'private' },
      from: { id: 7, first_name: opts.from ?? 'Анна', username: 'anna' },
    },
  });

beforeAll(async () => {
  await new Promise<void>((r) => telegram.listen(0, '127.0.0.1', r));
  telegramHost = `127.0.0.1:${(telegram.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => telegram.close(() => r())));

const servers: LocalFlowApiServer[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => s.close()));
  updates = [];
  offsets = [];
  answerConflict = false;
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

type Run = { id: string; status: string; triggerType: string; workflowId: string };
type TriggerStatus = {
  type: string;
  enabled: boolean;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastExecutionId: string | null;
  schedule?: { cron: string; timezone: string };
  telegram?: { commands: string[]; lastError: string | null };
};

async function setup(config: Partial<ApiConfig> = {}) {
  const api = new LocalFlowApiServer({
    databaseUrl: 'pglite://memory',
    ssrfAllowlist: [telegramHost],
    triggerTickMs: 100,
    telegramApiBase: `http://${telegramHost}`,
    telegramPollTimeoutSec: 0,
    telegramMinPollIntervalMs: 50,
    telegramRetryMs: 100,
    ...config,
  });
  servers.push(api);
  const res = await api.inject<{ workspaceId: string; token: string }>({
    method: 'POST',
    url: '/api/v1/setup',
    body: { email: 'owner@localflow.dev', password: 'StrongPassword123!' },
  });
  const { workspaceId, token } = res.body;
  const headers = { Authorization: `Bearer ${token}` };
  const db = (await api.database()) as any;

  const connect = async (type: string, secrets: Record<string, string>) =>
    (
      await api.inject<{ id: string }>({
        method: 'POST',
        url: `/api/v1/workspaces/${workspaceId}/credentials`,
        headers,
        body: { name: type, type, secrets },
      })
    ).body.id;

  const publish = async (nodes: ReturnType<typeof node>[]) => {
    const wf = await api.inject<{ id: string }>({
      method: 'POST',
      url: `/api/v1/workspaces/${workspaceId}/workflows`,
      headers,
      body: { name: 'w', nodes, edges: chain(nodes.map((n) => n.id)) },
    });
    const pub = await api.inject<{ code?: string; message?: string; details?: any }>({
      method: 'POST',
      url: `/api/v1/workflows/${wf.body.id}/publish`,
      headers,
    });
    return { id: wf.body.id, pub };
  };

  const triggersOf = async (workflowId: string) =>
    (
      await api.inject<{ triggers: TriggerStatus[] }>({
        method: 'GET',
        url: `/api/v1/workflows/${workflowId}/triggers`,
        headers,
      })
    ).body.triggers;

  const runsOf = async (workflowId: string): Promise<Run[]> =>
    (
      await db.execute(
        sql`select id, status, trigger_type as "triggerType", workflow_id as "workflowId"
            from executions where workflow_id = ${workflowId} order by created_at`
      )
    ).rows;

  const getRun = async (id: string) =>
    (
      await api.inject<{ execution: { status: string }; steps: any[] }>({
        method: 'GET',
        url: `/api/v1/executions/${id}`,
        headers,
      })
    ).body;

  /** Moves the schedule's next run `msAgo` into the past, as if the time had come. */
  const makeDue = (workflowId: string, msAgo: number) =>
    db.execute(
      sql`update triggers set next_trigger_at = now() - (${msAgo} * interval '1 millisecond')
          where workflow_id = ${workflowId}`
    );

  return { api, db, headers, connect, publish, triggersOf, runsOf, getRun, makeDue };
}

async function eventually<T>(fn: () => Promise<T>, ok: (v: T) => boolean, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const v = await fn();
    if (ok(v)) return v;
    if (Date.now() > deadline) throw new Error(`condition not met: ${JSON.stringify(v)}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

describe('@localflow/api — schedule trigger', () => {
  it('registers the schedule on publish and starts a run when it is due', async () => {
    const t = await setup();
    const { id, pub } = await t.publish([
      node('t', 'trigger.cron', { every: 'daily', time: '09:00', timezone: 'Europe/Moscow' }),
      node('m', 'primitive.map', { transform: { at: '{{ $trigger.scheduledAt }}' } }),
    ]);
    expect(pub.statusCode).toBe(201);
    const [trig] = await t.triggersOf(id);
    expect(trig!.schedule).toEqual({
      cron: '0 9 * * *',
      timezone: 'Europe/Moscow',
      catchUp: 'skip',
    });
    expect(new Date(trig!.nextRunAt!).getUTCHours()).toBe(6); // 09:00 Moscow
    expect(await t.runsOf(id)).toHaveLength(0);

    await t.makeDue(id, 1_000);
    const [run] = await eventually(
      () => t.runsOf(id),
      (r) => r.length === 1 && r[0]!.status === 'SUCCEEDED'
    );
    expect(run!.triggerType).toBe('cron');
    const done = await t.getRun(run!.id);
    expect(done.steps.find((s) => s.nodeId === 'm').outputPayload.at).toMatch(/^\d{4}-/);

    // The schedule moved on to the next day and does not fire again.
    const [after] = await t.triggersOf(id);
    expect(new Date(after!.nextRunAt!).getTime()).toBeGreaterThan(Date.now());
    expect(after!.lastRunAt).toBeTruthy();
    expect(after!.lastExecutionId).toBe(run!.id);
    await new Promise((r) => setTimeout(r, 400));
    expect(await t.runsOf(id)).toHaveLength(1);
  });

  it('refuses to publish a schedule that cannot work', async () => {
    const t = await setup();
    const bad = await t.publish([node('t', 'trigger.cron', { cron: '0 25 * * *' })]);
    expect(bad.pub.statusCode).toBe(422);
    expect(bad.pub.body.code).toBe('ERR_TRIGGER_INVALID');
    expect(bad.pub.body.message).toMatch(/hour "25" must be 0-23/);
    const tz = await t.publish([node('t', 'trigger.cron', { timezone: 'Mars/Olympus' })]);
    expect(tz.pub.statusCode).toBe(422);
    expect(tz.pub.body.message).toMatch(/Unknown time zone/);
    const never = await t.publish([node('t', 'trigger.cron', { cron: '0 0 30 2 *' })]);
    expect(never.pub.body.message).toMatch(/never fires/);
  });

  it('skips a run missed while nothing was running, unless catch-up is "once"', async () => {
    const t = await setup({ triggerTickMs: 60_000 }); // ticks only when the test asks
    const skip = await t.publish([node('t', 'trigger.cron', { cron: '0 * * * *' })]);
    const once = await t.publish([
      node('t', 'trigger.cron', { cron: '0 * * * *', catchUp: 'once' }),
    ]);
    await t.makeDue(skip.id, 10 * 60_000); // e.g. the server was down for 10 minutes
    await t.makeDue(once.id, 10 * 60_000);
    await t.api.tickTriggers();

    expect(await t.runsOf(skip.id)).toHaveLength(0);
    expect(await t.runsOf(once.id)).toHaveLength(1);
    const logs = (
      await t.db.execute(sql`select l.status, l.error_message as "errorMessage"
        from trigger_logs l join triggers g on g.id = l.trigger_id
        where g.workflow_id = ${skip.id}`)
    ).rows;
    expect(logs).toEqual([{ status: 'ignored', errorMessage: expect.stringMatching(/skipped/) }]);
    for (const wf of [skip.id, once.id]) {
      const [trig] = await t.triggersOf(wf);
      expect(new Date(trig!.nextRunAt!).getTime()).toBeGreaterThan(Date.now());
    }
  });

  it('pauses and resumes a schedule; resuming does not replay what was missed', async () => {
    const t = await setup({ triggerTickMs: 60_000 });
    const { id } = await t.publish([node('t', 'trigger.cron', { every: 'hourly' })]);
    const pause = await t.api.inject<{ triggers: TriggerStatus[] }>({
      method: 'PUT',
      url: `/api/v1/workflows/${id}/triggers`,
      headers: t.headers,
      body: { enabled: false },
    });
    expect(pause.statusCode).toBe(200);
    expect(pause.body.triggers[0]).toMatchObject({ enabled: false, nextRunAt: null });
    await t.makeDue(id, 1_000);
    await t.api.tickTriggers();
    expect(await t.runsOf(id)).toHaveLength(0);

    const resume = await t.api.inject<{ triggers: TriggerStatus[] }>({
      method: 'PUT',
      url: `/api/v1/workflows/${id}/triggers`,
      headers: t.headers,
      body: { enabled: true },
    });
    expect(resume.body.triggers[0]!.enabled).toBe(true);
    expect(new Date(resume.body.triggers[0]!.nextRunAt!).getTime()).toBeGreaterThan(Date.now());
    await t.api.tickTriggers();
    expect(await t.runsOf(id)).toHaveLength(0);

    const bad = await t.api.inject({
      method: 'PUT',
      url: `/api/v1/workflows/${id}/triggers`,
      headers: t.headers,
      body: { enabled: 'yes' },
    });
    expect(bad.statusCode).toBe(400);
  });

  it('removes the schedule when a manual version goes live, and restores it on rollback', async () => {
    const t = await setup({ triggerTickMs: 60_000 });
    const { id } = await t.publish([node('t', 'trigger.cron', { every: 'hourly' })]);
    await t.api.inject({
      method: 'PUT',
      url: `/api/v1/workflows/${id}/draft`,
      headers: t.headers,
      body: { nodes: [node('t', 'trigger.manual')], edges: [] },
    });
    await t.api.inject({
      method: 'POST',
      url: `/api/v1/workflows/${id}/publish`,
      headers: t.headers,
    });
    expect(await t.triggersOf(id)).toEqual([]);

    const back = await t.api.inject({
      method: 'POST',
      url: `/api/v1/workflows/${id}/rollback`,
      headers: t.headers,
      body: { version: 1 },
    });
    expect(back.statusCode).toBe(200);
    const [trig] = await t.triggersOf(id);
    expect(trig!.schedule!.cron).toBe('0 * * * *');
  });
});

describe('@localflow/api — Telegram trigger', () => {
  it('starts one run per new message, filters commands and skips history', async () => {
    const t = await setup();
    const cred = await t.connect('telegram', { botToken: BOT_TOKEN });
    say('/start old', { sentAt: Date.now() - 3_600_000 }); // before the trigger existed
    const { id, pub } = await t.publish([
      node('t', 'trigger.telegram', { onlyCommands: '/start, /ask' }, cred),
      node('m', 'primitive.map', {
        transform: {
          who: '{{ $trigger.fromName }}',
          q: '{{ $trigger.args }}',
          chat: '{{ $trigger.chatId }}',
        },
      }),
    ]);
    expect(pub.statusCode).toBe(201);

    say('/ask когда открыты?');
    say('просто текст'); // not a listed command
    say('/start@MyBot');
    const runs = await eventually(
      () => t.runsOf(id),
      (r) => r.length === 2 && r.every((x) => x.status === 'SUCCEEDED')
    );
    expect(runs.every((r) => r.triggerType === 'telegram')).toBe(true);
    const outputs = await Promise.all(
      runs.map(
        async (r) => (await t.getRun(r.id)).steps.find((s) => s.nodeId === 'm').outputPayload
      )
    );
    expect(outputs).toEqual(
      expect.arrayContaining([
        { who: 'Анна', q: 'когда открыты?', chat: '4242' },
        { who: 'Анна', q: '', chat: '4242' },
      ])
    );

    // Updates were acknowledged: the next poll asks past them and nothing runs twice.
    await eventually(
      async () => offsets.at(-1),
      (o) => o === nextUpdateId
    );
    await new Promise((r) => setTimeout(r, 300));
    expect(await t.runsOf(id)).toHaveLength(2);
    const [trig] = await t.triggersOf(id);
    expect(trig!.telegram).toMatchObject({ commands: ['start', 'ask'], lastError: null });
  });

  it('reports why polling fails instead of failing silently', async () => {
    const t = await setup();
    const cred = await t.connect('telegram', { botToken: BOT_TOKEN });
    answerConflict = true;
    const { id } = await t.publish([node('t', 'trigger.telegram', {}, cred)]);
    const [trig] = await eventually(
      () => t.triggersOf(id),
      (tr) => !!tr[0]?.telegram?.lastError
    );
    expect(trig!.telegram!.lastError).toMatch(/409.*deleteWebhook/);

    const wrong = await t.connect('telegram', { botToken: '999:wrong' });
    const second = await t.publish([node('t', 'trigger.telegram', {}, wrong)]);
    const [trig2] = await eventually(
      () => t.triggersOf(second.id),
      (tr) => !!tr[0]?.telegram?.lastError
    );
    expect(trig2!.telegram!.lastError).toMatch(/rejected the bot token/);
    expect(trig2!.telegram!.lastError).not.toContain('999:wrong');
  });

  it('refuses to publish without a Telegram bot connection', async () => {
    const t = await setup();
    const none = await t.publish([node('t', 'trigger.telegram')]);
    expect(none.pub.statusCode).toBe(422);
    expect(none.pub.body.details).toMatchObject({ field: 'credentialId' });
    const llm = await t.connect('openai-compatible', { baseUrl: 'http://localhost:1234/v1' });
    const wrongType = await t.publish([node('t', 'trigger.telegram', {}, llm)]);
    expect(wrongType.pub.statusCode).toBe(422);
    expect(wrongType.pub.body.message).toMatch(/not a Telegram bot/);
  });
});
