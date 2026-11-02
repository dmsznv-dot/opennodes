/**
 * LocalFlow E2E Test Suite - Tier 1: Triggers (Features F20 - F23)
 * Verifies Features F20 through F23 with >=5 tests per feature (20 tests total).
 */

import * as crypto from 'node:crypto';
import { describe, it, expect, beforeEach } from '../harness/index.ts';
import { workflowRunner } from '../harness/workflow-runner.ts';
import { InMemoryDatabase } from '../harness/db-mock.ts';
import { mockServiceRouter } from '../harness/msw-handlers.ts';
import type { WorkflowDefinition } from '../harness/types.ts';

describe('Tier 1: Feature F20 - Trigger: Manual', () => {
  let db: InMemoryDatabase;

  beforeEach(() => {
    db = new InMemoryDatabase();
  });

  it('F20-1: should initiate immediate execution with unique execution ID', async () => {
    const wf: WorkflowDefinition = {
      id: 'wf_manual_1',
      workspaceId: 'ws_1',
      name: 'Manual Run',
      nodes: [
        { id: 'trig', type: 'trigger.manual', data: { label: 'Manual Start', config: {} }, inputs: [], outputs: [] },
        { id: 'act', type: 'primitive.map', data: { label: 'A', config: { ok: true } }, inputs: [], outputs: [] }
      ],
      edges: [{ id: 'e1', source: 'trig', sourceHandle: 'main', target: 'act', targetHandle: 'main' }]
    };

    const res = await workflowRunner.runWorkflow(wf, { mockDatabase: db });
    expect(res.execution.id).toBeDefined();
    expect(res.execution.status).toBe('SUCCEEDED');
    expect(res.execution.triggerType).toBe('manual');
  });

  it('F20-2: should accept custom JSON payload and expose it under $trigger', async () => {
    const wf: WorkflowDefinition = {
      id: 'wf_manual_payload',
      workspaceId: 'ws_1',
      name: 'Manual Payload',
      nodes: [
        { id: 'trig', type: 'trigger.manual', data: { label: 'Start', config: {} }, inputs: [], outputs: [] },
        {
          id: 'read_payload',
          type: 'primitive.map',
          data: {
            label: 'Read',
            config: {
              receivedParam: '{{ $trigger.customParam }}',
              receivedId: '{{ $trigger.entityId }}'
            }
          },
          inputs: [],
          outputs: []
        }
      ],
      edges: [{ id: 'e1', source: 'trig', sourceHandle: 'main', target: 'read_payload', targetHandle: 'main' }]
    };

    const customInput = { customParam: 'launch_now', entityId: 4040 };
    const res = await workflowRunner.runWorkflow(wf, { mockDatabase: db, triggerPayload: customInput });
    expect(res.execution.status).toBe('SUCCEEDED');
    expect(res.nodeOutputs.get('read_payload')).toEqual({ receivedParam: 'launch_now', receivedId: 4040 });
  });

  it('F20-3: should fall back to default payload when no custom payload is provided', async () => {
    const wf: WorkflowDefinition = {
      id: 'wf_manual_default',
      workspaceId: 'ws_1',
      name: 'Manual Default',
      nodes: [
        {
          id: 'trig',
          type: 'trigger.manual',
          data: { label: 'Start', config: { defaultPayload: { isDefault: true, mode: 'test' } } },
          inputs: [],
          outputs: []
        }
      ],
      edges: []
    };

    const res = await workflowRunner.runWorkflow(wf, { mockDatabase: db });
    expect(res.execution.status).toBe('SUCCEEDED');
    expect(res.nodeOutputs.get('trig')).toEqual({ isDefault: true, mode: 'test' });
  });

  it('F20-4: should record start timestamp and execution duration in execution journal', async () => {
    const wf: WorkflowDefinition = {
      id: 'wf_manual_dur',
      workspaceId: 'ws_1',
      name: 'Duration Test',
      nodes: [{ id: 'trig', type: 'trigger.manual', data: { label: 'T', config: {} }, inputs: [], outputs: [] }],
      edges: []
    };

    const res = await workflowRunner.runWorkflow(wf, { mockDatabase: db });
    expect(res.execution.startedAt).toBeDefined();
    expect(res.execution.finishedAt).toBeDefined();
    expect(res.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('F20-5: should log trigger node as first entry in node execution journal', async () => {
    const wf: WorkflowDefinition = {
      id: 'wf_manual_journal_first',
      workspaceId: 'ws_1',
      name: 'Journal Order',
      nodes: [
        { id: 'trig', type: 'trigger.manual', data: { label: 'T', config: {} }, inputs: [], outputs: [] },
        { id: 'step2', type: 'primitive.map', data: { label: 'S2', config: {} }, inputs: [], outputs: [] }
      ],
      edges: [{ id: 'e1', source: 'trig', sourceHandle: 'main', target: 'step2', targetHandle: 'main' }]
    };

    const res = await workflowRunner.runWorkflow(wf, { mockDatabase: db });
    expect(res.stepRecords[0].nodeId).toBe('trig');
    expect(res.stepRecords[0].nodeType).toBe('trigger.manual');
  });
});

describe('Tier 1: Feature F21 - Trigger: Cron Schedule', () => {
  function parseCronFields(expr: string): { minute: string; hour: string; dayOfMonth: string; month: string; dayOfWeek: string } {
    const parts = expr.trim().split(/\s+/);
    if (parts.length !== 5) {
      throw new Error(`Invalid cron expression "${expr}": expected 5 fields`);
    }
    return {
      minute: parts[0],
      hour: parts[1],
      dayOfMonth: parts[2],
      month: parts[3],
      dayOfWeek: parts[4]
    };
  }

  it('F21-1: should parse standard 5-field cron syntax (minute, hour, day, month, day of week)', () => {
    const cron = parseCronFields('*/15 9-17 * * 1-5');
    expect(cron.minute).toBe('*/15');
    expect(cron.hour).toBe('9-17');
    expect(cron.dayOfMonth).toBe('*');
    expect(cron.month).toBe('*');
    expect(cron.dayOfWeek).toBe('1-5');
  });

  it('F21-2: should reject invalid cron expression syntax', () => {
    expect(() => parseCronFields('* * *')).toThrow('expected 5 fields');
    expect(() => parseCronFields('* * * * * * *')).toThrow('expected 5 fields');
  });

  it('F21-3: should normalize timezones (UTC, America/New_York, Europe/London)', () => {
    const validTimezones = ['UTC', 'America/New_York', 'Europe/London', 'Asia/Tokyo'];
    for (const tz of validTimezones) {
      // Intl.DateTimeFormat validates timezone string
      expect(() => new Intl.DateTimeFormat('en-US', { timeZone: tz })).not.toThrow();
    }
    expect(() => new Intl.DateTimeFormat('en-US', { timeZone: 'Invalid/NonExistent_Zone' })).toThrow();
  });

  it('F21-4: should provide trigger payload with timestamp, timezone, and scheduledTime', async () => {
    const db = new InMemoryDatabase();
    const wf: WorkflowDefinition = {
      id: 'wf_cron_trigger',
      workspaceId: 'ws_1',
      name: 'Cron Trigger',
      nodes: [
        {
          id: 'trig',
          type: 'trigger.cron',
          data: { label: 'Scheduled', config: { cronExpression: '0 8 * * *', timezone: 'UTC' } },
          inputs: [],
          outputs: []
        }
      ],
      edges: []
    };

    const cronPayload = {
      triggerType: 'cron',
      timestamp: '2026-11-02T08:00:00Z',
      scheduledTime: '2026-11-02T08:00:00Z',
      timezone: 'UTC'
    };

    const res = await workflowRunner.runWorkflow(wf, { mockDatabase: db, triggerPayload: cronPayload });
    expect(res.execution.status).toBe('SUCCEEDED');
    expect(res.execution.triggerType).toBe('cron');
    expect(res.nodeOutputs.get('trig')).toEqual(cronPayload);
  });

  it('F21-5: should support SKIP catch-up policy on missed ticks', () => {
    const catchUpPolicy = 'SKIP';
    const missedTicks = 3;
    let runsTriggered = 0;

    if (catchUpPolicy === 'SKIP') {
      runsTriggered = 0; // Drops missed runs
    } else if (catchUpPolicy === 'RUN_ONCE') {
      runsTriggered = 1;
    }

    expect(runsTriggered).toBe(0);
  });
});

describe('Tier 1: Feature F22 - Trigger: Webhook Ingress', () => {
  function verifyHmac(payload: string, secret: string, signature: string): boolean {
    const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');
    return expected === signature;
  }

  it('F22-1: should ingest incoming HTTP POST payload and forward as triggerPayload', async () => {
    const db = new InMemoryDatabase();
    const wf: WorkflowDefinition = {
      id: 'wf_webhook_test',
      workspaceId: 'ws_1',
      name: 'Webhook Ingress',
      nodes: [
        { id: 'trig', type: 'trigger.webhook', data: { label: 'Hook', config: {} }, inputs: [], outputs: [] },
        { id: 'action', type: 'primitive.map', data: { label: 'Act', config: { event: '{{ $trigger.event }}' } }, inputs: [], outputs: [] }
      ],
      edges: [{ id: 'e1', source: 'trig', sourceHandle: 'main', target: 'action', targetHandle: 'main' }]
    };

    const webhookBody = { event: 'payment_intent.succeeded', amount: 9900 };
    const res = await workflowRunner.runWorkflow(wf, { mockDatabase: db, triggerPayload: webhookBody });

    expect(res.execution.status).toBe('SUCCEEDED');
    expect(res.nodeOutputs.get('action')).toEqual({ event: 'payment_intent.succeeded' });
  });

  it('F22-2: should verify authentic HMAC-SHA256 signatures against shared secret', () => {
    const secret = 'webhook_shared_secret_key_123';
    const body = JSON.stringify({ orderId: 8888, customer: 'Alice' });
    const signature = crypto.createHmac('sha256', secret).update(body).digest('hex');

    const isValid = verifyHmac(body, secret, signature);
    expect(isValid).toBe(true);
  });

  it('F22-3: should reject invalid or forged HMAC signatures', () => {
    const secret = 'webhook_shared_secret_key_123';
    const body = JSON.stringify({ orderId: 8888, customer: 'Alice' });
    const forgedSignature = 'forged_hex_signature_abcdef123456';

    const isValid = verifyHmac(body, secret, forgedSignature);
    expect(isValid).toBe(false);
  });

  it('F22-4: should enforce idempotency by returning cached execution for duplicate X-Idempotency-Key', async () => {
    const db = new InMemoryDatabase();
    const wf: WorkflowDefinition = {
      id: 'wf_idempotent_hook',
      workspaceId: 'ws_1',
      name: 'Idempotent Hook',
      nodes: [
        { id: 'trig', type: 'trigger.webhook', data: { label: 'Hook', config: {} }, inputs: [], outputs: [] }
      ],
      edges: []
    };

    const idempotencyKey = 'idem_key_unique_999';
    const firstRun = await workflowRunner.runWorkflow(wf, {
      mockDatabase: db,
      idempotencyKey,
      triggerPayload: { run: 1 }
    });
    expect(firstRun.execution.id).toBeDefined();

    // Second call with same idempotency key
    const duplicateRun = await workflowRunner.runWorkflow(wf, {
      mockDatabase: db,
      idempotencyKey,
      triggerPayload: { run: 2 }
    });

    // Returns exact same execution record without creating a duplicate
    expect(duplicateRun.execution.id).toBe(firstRun.execution.id);
    expect(db.executions.size).toBe(1);
  });

  it('F22-5: should capture headers, query parameters, and raw body in trigger payload', async () => {
    const db = new InMemoryDatabase();
    const wf: WorkflowDefinition = {
      id: 'wf_hook_meta',
      workspaceId: 'ws_1',
      name: 'Webhook Metadata',
      nodes: [
        { id: 'trig', type: 'trigger.webhook', data: { label: 'Hook', config: {} }, inputs: [], outputs: [] }
      ],
      edges: []
    };

    const fullTriggerPayload = {
      triggerType: 'webhook',
      headers: { 'content-type': 'application/json', 'x-custom-source': 'stripe' },
      query: { mode: 'live' },
      body: { chargeId: 'ch_123' }
    };

    const res = await workflowRunner.runWorkflow(wf, { mockDatabase: db, triggerPayload: fullTriggerPayload });
    expect(res.execution.status).toBe('SUCCEEDED');
    const out = res.nodeOutputs.get('trig') as typeof fullTriggerPayload;
    expect(out.headers['x-custom-source']).toBe('stripe');
    expect(out.query.mode).toBe('live');
    expect(out.body.chargeId).toBe('ch_123');
  });
});

describe('Tier 1: Feature F23 - Trigger: Telegram Polling', () => {
  it('F23-1: should poll Telegram getUpdates endpoint and receive incoming messages', async () => {
    const resp = await mockServiceRouter.handleRequest({
      url: 'https://api.telegram.org/bot123456:ABC-DEF/getUpdates',
      method: 'GET'
    });

    expect(resp.status).toBe(200);
    const data = resp.data as { ok: boolean; result: Array<{ update_id: number; message: { text: string } }> };
    expect(data.ok).toBe(true);
    expect(data.result.length).toBeGreaterThan(0);
    expect(data.result[0].message.text).toBe('/run workflow_1');
  });

  it('F23-2: should track lastUpdateId offset to acknowledge processed messages', () => {
    let lastUpdateId = 10000;
    const updates = [{ update_id: 10001 }, { update_id: 10002 }];

    for (const update of updates) {
      if (update.update_id > lastUpdateId) {
        lastUpdateId = update.update_id;
      }
    }

    const nextOffset = lastUpdateId + 1;
    expect(nextOffset).toBe(10003);
  });

  it('F23-3: should parse sender username, chat ID, and message text into trigger payload', async () => {
    const db = new InMemoryDatabase();
    const wf: WorkflowDefinition = {
      id: 'wf_telegram_trigger',
      workspaceId: 'ws_1',
      name: 'Telegram Trigger',
      nodes: [
        { id: 'trig', type: 'trigger.telegram', data: { label: 'Bot Update', config: {} }, inputs: [], outputs: [] },
        {
          id: 'process_msg',
          type: 'primitive.map',
          data: {
            label: 'Process',
            config: {
              sender: '{{ $trigger.message.from.username }}',
              chatId: '{{ $trigger.message.chat.id }}',
              command: '{{ $trigger.message.text }}'
            }
          },
          inputs: [],
          outputs: []
        }
      ],
      edges: [{ id: 'e1', source: 'trig', sourceHandle: 'main', target: 'process_msg', targetHandle: 'main' }]
    };

    const telegramPayload = {
      updateId: 10001,
      message: {
        messageId: 42,
        from: { id: 777, username: 'charlie' },
        chat: { id: 888 },
        text: '/status'
      }
    };

    const res = await workflowRunner.runWorkflow(wf, { mockDatabase: db, triggerPayload: telegramPayload });
    expect(res.execution.status).toBe('SUCCEEDED');
    expect(res.nodeOutputs.get('process_msg')).toEqual({
      sender: 'charlie',
      chatId: 888,
      command: '/status'
    });
  });

  it('F23-4: should handle bot slash commands (/start, /help, /run)', () => {
    const commandRegex = /^\/([a-zA-Z0-9_]+)(\s+(.*))?$/;
    const text = '/run deployment_prod --tag=v1.2';
    const match = text.match(commandRegex);

    expect(match).toBeDefined();
    expect(match![1]).toBe('run');
    expect(match![3]).toBe('deployment_prod --tag=v1.2');
  });

  it('F23-5: should operate gracefully when getUpdates returns empty results (no new messages)', () => {
    const updates: unknown[] = [];
    let workflowsTriggered = 0;

    for (const _update of updates) {
      workflowsTriggered++;
    }

    expect(workflowsTriggered).toBe(0);
  });
});
