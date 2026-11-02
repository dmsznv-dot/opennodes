import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import {
  createInMemoryDb,
  executions,
  triggers,
  workflowVersions,
  workflows,
  workspaces,
} from '@localflow/db';
import {
  ExecutionRuntime,
  LocalQueueManager,
  TriggerScheduler,
  claimExecution,
  parseDelayMs,
} from '../src/index.js';

async function seedRun(status: string) {
  const db = await createInMemoryDb();
  const ws = randomUUID();
  const wf = randomUUID();
  const ver = randomUUID();
  const exec = randomUUID();
  const d = db as any;
  await d.insert(workspaces).values({ id: ws, name: 'W', slug: `w-${ws.slice(0, 6)}` });
  await d.insert(workflows).values({ id: wf, workspaceId: ws, name: 'F' });
  await d.insert(workflowVersions).values({
    id: ver,
    workflowId: wf,
    versionNumber: 1,
    nodes: [],
    edges: [],
    triggerConfig: {},
    checksum: '0'.repeat(64),
  });
  await d.insert(executions).values({
    id: exec,
    workspaceId: ws,
    workflowId: wf,
    workflowVersionId: ver,
    status,
    triggerType: 'manual',
  });
  return { db, exec };
}

describe('@localflow/execution-runtime', () => {
  it('claims a queued run exactly once, so a job delivered twice runs once', async () => {
    const { db, exec } = await seedRun('QUEUED');
    const past = new Date(Date.now() - 60_000);
    const [a, b] = await Promise.all([
      claimExecution(db, exec, past),
      claimExecution(db, exec, past),
    ]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
    expect((a ?? b)!.status).toBe('RUNNING');
  });

  it('re-claims a RUNNING run only after its worker stopped heartbeating; never a finished one', async () => {
    const { db, exec } = await seedRun('RUNNING');
    expect(await claimExecution(db, exec, new Date(Date.now() - 60_000))).toBeUndefined();
    await (db as any).execute(
      sql`update executions set updated_at = now() - interval '2 minutes' where id = ${exec}`
    );
    expect(await claimExecution(db, exec, new Date(Date.now() - 60_000))).toBeDefined();

    for (const status of ['SUCCEEDED', 'FAILED', 'CANCELLED']) {
      const run = await seedRun(status);
      expect(await claimExecution(run.db, run.exec, new Date())).toBeUndefined();
    }
    expect(await claimExecution(db, 'not-a-uuid', new Date())).toBeUndefined();
  });

  it('parses delay durations and rejects nonsense', () => {
    expect(parseDelayMs({ delayMs: 250 })).toBe(250);
    expect(parseDelayMs({ delaySeconds: '1.5' })).toBe(1500);
    expect(parseDelayMs({ delayMinutes: 2 })).toBe(120_000);
    expect(parseDelayMs({ delayHours: 1 })).toBe(3_600_000);
    expect(parseDelayMs({ delayDays: 1 })).toBe(86_400_000);
    expect(parseDelayMs({})).toBe(0);
    expect(() => parseDelayMs({ delaySeconds: -1 })).toThrow(/non-negative/);
    expect(() => parseDelayMs({ delayMinutes: 'soon' })).toThrow(/non-negative/);
    expect(() => parseDelayMs({ delayDays: 400 })).toThrow(/365 days/);
  });

  it('the in-process queue really runs jobs, honours delays and concurrency', async () => {
    const queue = new LocalQueueManager();
    const seen: Array<{ id: string; at: number }> = [];
    let active = 0;
    let peak = 0;
    const consumer = queue.createExecutionConsumer(
      async (job) => {
        active++;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 30));
        seen.push({ id: job.data.executionId, at: Date.now() });
        active--;
      },
      { concurrency: 2 }
    );
    await consumer.start();
    const t0 = Date.now();
    const job = (executionId: string) => ({
      executionId,
      workflowId: 'w',
      workflowVersionId: 'v',
      workspaceId: 's',
      triggerType: 'manual',
      enqueuedAt: Date.now(),
    });
    await queue.executionProducer.add('run', job('late'), { delay: 200 });
    for (const id of ['a', 'b', 'c', 'd']) await queue.executionProducer.add('run', job(id));
    await new Promise((r) => setTimeout(r, 400));
    expect(seen.map((s) => s.id).sort()).toEqual(['a', 'b', 'c', 'd', 'late']);
    expect(seen.find((s) => s.id === 'late')!.at - t0).toBeGreaterThanOrEqual(190);
    expect(peak).toBe(2);
    await queue.closeAll();
  });

  it('two schedulers racing over one due schedule start exactly one run', async () => {
    const { db } = await seedRun('SUCCEEDED');
    const d = db as any;
    const [{ workspaceId, workflowId, workflowVersionId }] = await d
      .select({
        workspaceId: executions.workspaceId,
        workflowId: executions.workflowId,
        workflowVersionId: executions.workflowVersionId,
      })
      .from(executions);
    await d.insert(triggers).values({
      workspaceId,
      workflowId,
      type: 'cron',
      name: 'every minute',
      config: {
        kind: 'cron',
        nodeId: 't',
        cron: '* * * * *',
        timezone: 'UTC',
        catchUp: 'skip',
        workflowVersionId,
      },
      nextTriggerAt: new Date(Date.now() - 1_000),
    });
    const runtime = new ExecutionRuntime({ db, encryptionKey: '0'.repeat(64) });
    const queue = new LocalQueueManager(); // nobody consumes: we only count queued runs
    const make = () => new TriggerScheduler({ db, runtime, queue, tickMs: 60_000 });
    const a = make();
    const b = make();
    await Promise.all([a.start(), b.start(), a.tick(), b.tick()]);
    await Promise.all([a.stop(), b.stop()]);
    const queued = await d
      .select()
      .from(executions)
      .where(sql`trigger_type = 'cron'`);
    expect(queued).toHaveLength(1);
    expect(queued[0].status).toBe('QUEUED');
    expect(queued[0].idempotencyKey).toMatch(/^cron:/);
    await queue.closeAll();
  });
});
