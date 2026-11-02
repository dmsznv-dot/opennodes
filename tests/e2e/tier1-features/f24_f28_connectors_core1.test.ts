/**
 * LocalFlow E2E Test Suite - Tier 1: Connectors Core 1 (Features F24 - F28)
 * Verifies Features F24 through F28 with >=5 tests per feature (25 tests total).
 */

import { describe, it, expect, beforeEach } from '../harness/index.ts';
import { workflowRunner } from '../harness/workflow-runner.ts';
import { InMemoryDatabase } from '../harness/db-mock.ts';
import { mockServiceRouter } from '../harness/msw-handlers.ts';
import type { WorkflowDefinition } from '../harness/types.ts';

describe('Tier 1: Feature F24 - Connector: HTTP Request', () => {
  let db: InMemoryDatabase;

  beforeEach(() => {
    db = new InMemoryDatabase();
    mockServiceRouter.reset();
  });

  it('F24-1: should execute HTTP GET request and return status, headers, and data', async () => {
    mockServiceRouter.registerRoute('GET', 'https://api.example.com/items', () => ({
      status: 200,
      statusText: 'OK',
      headers: { 'content-type': 'application/json' },
      data: [{ id: 1, name: 'Widget A' }]
    }));

    const wf: WorkflowDefinition = {
      id: 'wf_http_get',
      workspaceId: 'ws_1',
      name: 'HTTP GET Test',
      nodes: [
        { id: 'trig', type: 'trigger.manual', data: { label: 'T', config: {} }, inputs: [], outputs: [] },
        {
          id: 'http_get',
          type: 'core.httpRequest',
          data: { label: 'Get Items', config: { url: 'https://api.example.com/items', method: 'GET' } },
          inputs: [],
          outputs: []
        }
      ],
      edges: [{ id: 'e1', source: 'trig', sourceHandle: 'main', target: 'http_get', targetHandle: 'main' }]
    };

    const res = await workflowRunner.runWorkflow(wf, { mockDatabase: db });
    expect(res.execution.status).toBe('SUCCEEDED');
    const out = res.nodeOutputs.get('http_get') as { status: number; data: Array<{ id: number; name: string }> };
    expect(out.status).toBe(200);
    expect(out.data[0].name).toBe('Widget A');
  });

  it('F24-2: should execute HTTP POST request with JSON body and custom headers', async () => {
    mockServiceRouter.registerRoute('POST', 'https://api.example.com/orders', (req) => ({
      status: 201,
      statusText: 'Created',
      headers: { 'content-type': 'application/json' },
      data: { orderId: 'ord_999', receivedPayload: req.data }
    }));

    const wf: WorkflowDefinition = {
      id: 'wf_http_post',
      workspaceId: 'ws_1',
      name: 'HTTP POST Test',
      nodes: [
        { id: 'trig', type: 'trigger.manual', data: { label: 'T', config: {} }, inputs: [], outputs: [] },
        {
          id: 'http_post',
          type: 'core.httpRequest',
          data: {
            label: 'Create Order',
            config: {
              url: 'https://api.example.com/orders',
              method: 'POST',
              headers: { 'X-Source': 'LocalFlow' },
              body: { sku: 'SKU-001', qty: 5 }
            }
          },
          inputs: [],
          outputs: []
        }
      ],
      edges: [{ id: 'e1', source: 'trig', sourceHandle: 'main', target: 'http_post', targetHandle: 'main' }]
    };

    const res = await workflowRunner.runWorkflow(wf, { mockDatabase: db });
    expect(res.execution.status).toBe('SUCCEEDED');
    const out = res.nodeOutputs.get('http_post') as { status: number; data: { orderId: string } };
    expect(out.status).toBe(201);
    expect(out.data.orderId).toBe('ord_999');
  });

  it('F24-3: should strictly enforce SSRF defense blocking loopback and private IPs', async () => {
    const wf: WorkflowDefinition = {
      id: 'wf_http_ssrf',
      workspaceId: 'ws_1',
      name: 'HTTP SSRF Test',
      nodes: [
        { id: 'trig', type: 'trigger.manual', data: { label: 'T', config: {} }, inputs: [], outputs: [] },
        {
          id: 'http_blocked',
          type: 'core.httpRequest',
          data: { label: 'SSRF Attack', config: { url: 'http://127.0.0.1:8000/internal', method: 'GET' } },
          inputs: [],
          outputs: []
        }
      ],
      edges: [{ id: 'e1', source: 'trig', sourceHandle: 'main', target: 'http_blocked', targetHandle: 'main' }]
    };

    const res = await workflowRunner.runWorkflow(wf, { mockDatabase: db });
    expect(res.execution.status).toBe('FAILED');
    expect(res.execution.errorMessage).toContain('ERR_SSRF_BLOCKED');
  });

  it('F24-4: should handle HTTP 404 Not Found without crashing engine ungracefully', async () => {
    mockServiceRouter.registerRoute('GET', 'https://api.example.com/missing', () => ({
      status: 404,
      statusText: 'Not Found',
      headers: { 'content-type': 'application/json' },
      data: { error: 'Resource not found' }
    }));

    const wf: WorkflowDefinition = {
      id: 'wf_http_404',
      workspaceId: 'ws_1',
      name: 'HTTP 404 Test',
      nodes: [
        { id: 'trig', type: 'trigger.manual', data: { label: 'T', config: {} }, inputs: [], outputs: [] },
        {
          id: 'http_404',
          type: 'core.httpRequest',
          data: { label: 'Get Missing', config: { url: 'https://api.example.com/missing', method: 'GET' } },
          inputs: [],
          outputs: []
        }
      ],
      edges: [{ id: 'e1', source: 'trig', sourceHandle: 'main', target: 'http_404', targetHandle: 'main' }]
    };

    const res = await workflowRunner.runWorkflow(wf, { mockDatabase: db });
    expect(res.execution.status).toBe('SUCCEEDED');
    const out = res.nodeOutputs.get('http_404') as { status: number };
    expect(out.status).toBe(404);
  });

  it('F24-5: should evaluate dynamic expressions in URL and headers', async () => {
    mockServiceRouter.registerRoute('GET', 'https://api.example.com/users/42', () => ({
      status: 200,
      statusText: 'OK',
      headers: {},
      data: { userId: 42, username: 'tester' }
    }));

    const wf: WorkflowDefinition = {
      id: 'wf_http_dynamic',
      workspaceId: 'ws_1',
      name: 'Dynamic URL HTTP',
      nodes: [
        { id: 'trig', type: 'trigger.manual', data: { label: 'T', config: {} }, inputs: [], outputs: [] },
        { id: 'prep', type: 'primitive.map', data: { label: 'P', config: { targetId: 42 } }, inputs: [], outputs: [] },
        {
          id: 'fetch',
          type: 'core.httpRequest',
          data: { label: 'Fetch', config: { url: 'https://api.example.com/users/{{ $nodes.prep.output.targetId }}', method: 'GET' } },
          inputs: [],
          outputs: []
        }
      ],
      edges: [
        { id: 'e1', source: 'trig', sourceHandle: 'main', target: 'prep', targetHandle: 'main' },
        { id: 'e2', source: 'prep', sourceHandle: 'main', target: 'fetch', targetHandle: 'main' }
      ]
    };

    const res = await workflowRunner.runWorkflow(wf, { mockDatabase: db });
    expect(res.execution.status).toBe('SUCCEEDED');
    const out = res.nodeOutputs.get('fetch') as { data: { userId: number } };
    expect(out.data.userId).toBe(42);
  });
});

describe('Tier 1: Feature F25 - Connector: Outgoing Webhook', () => {
  let db: InMemoryDatabase;

  beforeEach(() => {
    db = new InMemoryDatabase();
    mockServiceRouter.reset();
  });

  it('F25-1: should dispatch webhook to external endpoint and confirm delivery', async () => {
    mockServiceRouter.registerRoute('POST', 'https://webhook.site/receiver', () => ({
      status: 200,
      statusText: 'OK',
      headers: {},
      data: { success: true }
    }));

    const wf: WorkflowDefinition = {
      id: 'wf_out_webhook',
      workspaceId: 'ws_1',
      name: 'Outgoing Webhook',
      nodes: [
        { id: 'trig', type: 'trigger.manual', data: { label: 'T', config: {} }, inputs: [], outputs: [] },
        {
          id: 'dispatch_hook',
          type: 'core.outgoingWebhook',
          data: {
            label: 'Post Webhook',
            config: {
              url: 'https://webhook.site/receiver',
              payload: { event: 'user_signup', userId: 'usr_777' }
            }
          },
          inputs: [],
          outputs: []
        }
      ],
      edges: [{ id: 'e1', source: 'trig', sourceHandle: 'main', target: 'dispatch_hook', targetHandle: 'main' }]
    };

    const res = await workflowRunner.runWorkflow(wf, { mockDatabase: db });
    expect(res.execution.status).toBe('SUCCEEDED');
    const out = res.nodeOutputs.get('dispatch_hook') as { delivered: boolean; statusCode: number };
    expect(out.delivered).toBe(true);
    expect(out.statusCode).toBe(200);
  });

  it('F25-2: should send custom authorization and event headers with webhook', async () => {
    let capturedHeaders: Record<string, string> = {};
    mockServiceRouter.registerRoute('POST', 'https://webhook.site/custom_headers', (req) => {
      capturedHeaders = req.headers || {};
      return { status: 200, statusText: 'OK', headers: {}, data: { ack: true } };
    });

    const wf: WorkflowDefinition = {
      id: 'wf_hook_headers',
      workspaceId: 'ws_1',
      name: 'Webhook Headers',
      nodes: [
        { id: 'trig', type: 'trigger.manual', data: { label: 'T', config: {} }, inputs: [], outputs: [] },
        {
          id: 'hook_headers',
          type: 'core.outgoingWebhook',
          data: {
            label: 'Post With Headers',
            config: {
              url: 'https://webhook.site/custom_headers',
              headers: { 'X-Signature': 'sha256_mock_sig', 'X-Event-Type': 'invoice.paid' },
              payload: { invoice: 'inv_101' }
            }
          },
          inputs: [],
          outputs: []
        }
      ],
      edges: [{ id: 'e1', source: 'trig', sourceHandle: 'main', target: 'hook_headers', targetHandle: 'main' }]
    };

    const res = await workflowRunner.runWorkflow(wf, { mockDatabase: db });
    expect(res.execution.status).toBe('SUCCEEDED');
    expect(capturedHeaders['X-Signature']).toBe('sha256_mock_sig');
    expect(capturedHeaders['X-Event-Type']).toBe('invoice.paid');
  });

  it('F25-3: should dynamically interpolate payload fields from previous steps', async () => {
    let capturedBody: any = null;
    mockServiceRouter.registerRoute('POST', 'https://webhook.site/dyn_payload', (req) => {
      capturedBody = req.data;
      return { status: 200, statusText: 'OK', headers: {}, data: {} };
    });

    const wf: WorkflowDefinition = {
      id: 'wf_hook_dyn_payload',
      workspaceId: 'ws_1',
      name: 'Webhook Dynamic',
      nodes: [
        { id: 'trig', type: 'trigger.manual', data: { label: 'T', config: {} }, inputs: [], outputs: [] },
        { id: 'calc', type: 'primitive.map', data: { label: 'C', config: { score: 98, rank: 'A' } }, inputs: [], outputs: [] },
        {
          id: 'send_hook',
          type: 'core.outgoingWebhook',
          data: {
            label: 'Send',
            config: {
              url: 'https://webhook.site/dyn_payload',
              payload: {
                studentScore: '{{ $nodes.calc.output.score }}',
                studentRank: '{{ $nodes.calc.output.rank }}'
              }
            }
          },
          inputs: [],
          outputs: []
        }
      ],
      edges: [
        { id: 'e1', source: 'trig', sourceHandle: 'main', target: 'calc', targetHandle: 'main' },
        { id: 'e2', source: 'calc', sourceHandle: 'main', target: 'send_hook', targetHandle: 'main' }
      ]
    };

    const res = await workflowRunner.runWorkflow(wf, { mockDatabase: db });
    expect(res.execution.status).toBe('SUCCEEDED');
    expect(capturedBody).toEqual({ studentScore: 98, studentRank: 'A' });
  });

  it('F25-4: should block outgoing webhooks targeting restricted internal IP addresses', async () => {
    const wf: WorkflowDefinition = {
      id: 'wf_hook_ssrf',
      workspaceId: 'ws_1',
      name: 'Webhook SSRF',
      nodes: [
        { id: 'trig', type: 'trigger.manual', data: { label: 'T', config: {} }, inputs: [], outputs: [] },
        {
          id: 'bad_hook',
          type: 'core.outgoingWebhook',
          data: { label: 'SSRF Hook', config: { url: 'http://192.168.1.100:9999/hook', payload: {} } },
          inputs: [],
          outputs: []
        }
      ],
      edges: [{ id: 'e1', source: 'trig', sourceHandle: 'main', target: 'bad_hook', targetHandle: 'main' }]
    };

    const res = await workflowRunner.runWorkflow(wf, { mockDatabase: db });
    expect(res.execution.status).toBe('FAILED');
    expect(res.execution.errorMessage).toContain('ERR_SSRF_BLOCKED');
  });

  it('F25-5: should report delivered: false when receiver returns HTTP 500 error', async () => {
    mockServiceRouter.registerRoute('POST', 'https://webhook.site/server_error', () => ({
      status: 500,
      statusText: 'Internal Server Error',
      headers: {},
      data: { error: 'downstream crash' }
    }));

    const wf: WorkflowDefinition = {
      id: 'wf_hook_err',
      workspaceId: 'ws_1',
      name: 'Webhook Error',
      nodes: [
        { id: 'trig', type: 'trigger.manual', data: { label: 'T', config: {} }, inputs: [], outputs: [] },
        {
          id: 'err_hook',
          type: 'core.outgoingWebhook',
          data: { label: 'Err Hook', config: { url: 'https://webhook.site/server_error', payload: {} } },
          inputs: [],
          outputs: []
        }
      ],
      edges: [{ id: 'e1', source: 'trig', sourceHandle: 'main', target: 'err_hook', targetHandle: 'main' }]
    };

    const res = await workflowRunner.runWorkflow(wf, { mockDatabase: db });
    expect(res.execution.status).toBe('SUCCEEDED');
    const out = res.nodeOutputs.get('err_hook') as { delivered: boolean; statusCode: number };
    expect(out.delivered).toBe(false);
    expect(out.statusCode).toBe(500);
  });
});

describe('Tier 1: Feature F26 - Connector: Cron / Timer', () => {
  let db: InMemoryDatabase;

  beforeEach(() => {
    db = new InMemoryDatabase();
  });

  it('F26-1: should execute inline timing tick action with current ISO timestamp', async () => {
    const wf: WorkflowDefinition = {
      id: 'wf_cron_action',
      workspaceId: 'ws_1',
      name: 'Cron Action',
      nodes: [
        { id: 'trig', type: 'trigger.manual', data: { label: 'T', config: {} }, inputs: [], outputs: [] },
        { id: 'timer_node', type: 'core.cron', data: { label: 'Timer Tick', config: { timezone: 'UTC' } }, inputs: [], outputs: [] }
      ],
      edges: [{ id: 'e1', source: 'trig', sourceHandle: 'main', target: 'timer_node', targetHandle: 'main' }]
    };

    const res = await workflowRunner.runWorkflow(wf, { mockDatabase: db });
    expect(res.execution.status).toBe('SUCCEEDED');
    const out = res.nodeOutputs.get('timer_node') as { tick: string; timezone: string };
    expect(out.tick).toBeDefined();
    expect(out.timezone).toBe('UTC');
  });

  it('F26-2: should support custom configured timezone strings', async () => {
    const wf: WorkflowDefinition = {
      id: 'wf_cron_tz',
      workspaceId: 'ws_1',
      name: 'Cron TZ',
      nodes: [
        { id: 'trig', type: 'trigger.manual', data: { label: 'T', config: {} }, inputs: [], outputs: [] },
        { id: 'timer_node', type: 'core.cron', data: { label: 'Timer NY', config: { timezone: 'America/New_York' } }, inputs: [], outputs: [] }
      ],
      edges: [{ id: 'e1', source: 'trig', sourceHandle: 'main', target: 'timer_node', targetHandle: 'main' }]
    };

    const res = await workflowRunner.runWorkflow(wf, { mockDatabase: db });
    const out = res.nodeOutputs.get('timer_node') as { timezone: string };
    expect(out.timezone).toBe('America/New_York');
  });

  it('F26-3: should record timer step in execution journal with duration', async () => {
    const wf: WorkflowDefinition = {
      id: 'wf_cron_journal',
      workspaceId: 'ws_1',
      name: 'Cron Journal',
      nodes: [
        { id: 'trig', type: 'trigger.manual', data: { label: 'T', config: {} }, inputs: [], outputs: [] },
        { id: 'timer_node', type: 'core.cron', data: { label: 'Timer', config: {} }, inputs: [], outputs: [] }
      ],
      edges: [{ id: 'e1', source: 'trig', sourceHandle: 'main', target: 'timer_node', targetHandle: 'main' }]
    };

    const res = await workflowRunner.runWorkflow(wf, { mockDatabase: db });
    const step = res.stepRecords.find(s => s.nodeId === 'timer_node');
    expect(step?.status).toBe('SUCCEEDED');
    expect(step?.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('F26-4: should forward tick timestamp to downstream consumer nodes', async () => {
    const wf: WorkflowDefinition = {
      id: 'wf_cron_forward',
      workspaceId: 'ws_1',
      name: 'Cron Forward',
      nodes: [
        { id: 'trig', type: 'trigger.manual', data: { label: 'T', config: {} }, inputs: [], outputs: [] },
        { id: 'timer_node', type: 'core.cron', data: { label: 'Timer', config: {} }, inputs: [], outputs: [] },
        { id: 'consumer', type: 'primitive.map', data: { label: 'Consumer', config: { capturedTick: '{{ $nodes.timer_node.output.tick }}' } }, inputs: [], outputs: [] }
      ],
      edges: [
        { id: 'e1', source: 'trig', sourceHandle: 'main', target: 'timer_node', targetHandle: 'main' },
        { id: 'e2', source: 'timer_node', sourceHandle: 'main', target: 'consumer', targetHandle: 'main' }
      ]
    };

    const res = await workflowRunner.runWorkflow(wf, { mockDatabase: db });
    expect(res.execution.status).toBe('SUCCEEDED');
    const out = res.nodeOutputs.get('consumer') as { capturedTick: string };
    expect(out.capturedTick).toBeDefined();
    expect(out.capturedTick.length).toBeGreaterThan(10);
  });

  it('F26-5: should default to UTC timezone when timezone is not specified', async () => {
    const wf: WorkflowDefinition = {
      id: 'wf_cron_default_tz',
      workspaceId: 'ws_1',
      name: 'Default TZ',
      nodes: [
        { id: 'trig', type: 'trigger.manual', data: { label: 'T', config: {} }, inputs: [], outputs: [] },
        { id: 'timer_node', type: 'core.cron', data: { label: 'Timer', config: {} }, inputs: [], outputs: [] }
      ],
      edges: [{ id: 'e1', source: 'trig', sourceHandle: 'main', target: 'timer_node', targetHandle: 'main' }]
    };

    const res = await workflowRunner.runWorkflow(wf, { mockDatabase: db });
    const out = res.nodeOutputs.get('timer_node') as { timezone: string };
    expect(out.timezone).toBe('UTC');
  });
});

describe('Tier 1: Feature F27 - Connector: JSON Transform', () => {
  let db: InMemoryDatabase;

  beforeEach(() => {
    db = new InMemoryDatabase();
  });

  it('F27-1: should parse valid JSON string into structured object', async () => {
    const wf: WorkflowDefinition = {
      id: 'wf_json_parse',
      workspaceId: 'ws_1',
      name: 'JSON Parse Test',
      nodes: [
        { id: 'trig', type: 'trigger.manual', data: { label: 'T', config: {} }, inputs: [], outputs: [] },
        {
          id: 'json_node',
          type: 'core.jsonTransform',
          data: {
            label: 'Parse JSON',
            config: { mode: 'parse', data: '{"user":"alice","roles":["admin","editor"]}' }
          },
          inputs: [],
          outputs: []
        }
      ],
      edges: [{ id: 'e1', source: 'trig', sourceHandle: 'main', target: 'json_node', targetHandle: 'main' }]
    };

    const res = await workflowRunner.runWorkflow(wf, { mockDatabase: db });
    expect(res.execution.status).toBe('SUCCEEDED');
    const out = res.nodeOutputs.get('json_node') as { user: string; roles: string[] };
    expect(out.user).toBe('alice');
    expect(out.roles).toEqual(['admin', 'editor']);
  });

  it('F27-2: should stringify structured object into valid JSON string', async () => {
    const wf: WorkflowDefinition = {
      id: 'wf_json_stringify',
      workspaceId: 'ws_1',
      name: 'JSON Stringify Test',
      nodes: [
        { id: 'trig', type: 'trigger.manual', data: { label: 'T', config: {} }, inputs: [], outputs: [] },
        {
          id: 'json_node',
          type: 'core.jsonTransform',
          data: {
            label: 'Stringify',
            config: { mode: 'stringify', data: { alpha: 1, beta: true } }
          },
          inputs: [],
          outputs: []
        }
      ],
      edges: [{ id: 'e1', source: 'trig', sourceHandle: 'main', target: 'json_node', targetHandle: 'main' }]
    };

    const res = await workflowRunner.runWorkflow(wf, { mockDatabase: db });
    expect(res.execution.status).toBe('SUCCEEDED');
    const out = res.nodeOutputs.get('json_node') as string;
    expect(out).toBe('{"alpha":1,"beta":true}');
  });

  it('F27-3: should extract sub-objects using expression evaluation', async () => {
    const wf: WorkflowDefinition = {
      id: 'wf_json_extract',
      workspaceId: 'ws_1',
      name: 'JSON Extract Test',
      nodes: [
        { id: 'trig', type: 'trigger.manual', data: { label: 'T', config: {} }, inputs: [], outputs: [] },
        { id: 'source', type: 'primitive.map', data: { label: 'S', config: { catalog: { products: [{ id: 'p1', price: 99 }] } } }, inputs: [], outputs: [] },
        {
          id: 'json_extract',
          type: 'core.jsonTransform',
          data: {
            label: 'Extract Products',
            config: { mode: 'extract', expression: '{{ $nodes.source.output.catalog.products[0].price }}' }
          },
          inputs: [],
          outputs: []
        }
      ],
      edges: [
        { id: 'e1', source: 'trig', sourceHandle: 'main', target: 'source', targetHandle: 'main' },
        { id: 'e2', source: 'source', sourceHandle: 'main', target: 'json_extract', targetHandle: 'main' }
      ]
    };

    const res = await workflowRunner.runWorkflow(wf, { mockDatabase: db });
    expect(res.execution.status).toBe('SUCCEEDED');
    expect(res.nodeOutputs.get('json_extract')).toBe(99);
  });

  it('F27-4: should fail execution cleanly on malformed JSON string parsing', async () => {
    const wf: WorkflowDefinition = {
      id: 'wf_json_bad',
      workspaceId: 'ws_1',
      name: 'Bad JSON Parse',
      nodes: [
        { id: 'trig', type: 'trigger.manual', data: { label: 'T', config: {} }, inputs: [], outputs: [] },
        {
          id: 'json_bad',
          type: 'core.jsonTransform',
          data: { label: 'Bad JSON', config: { mode: 'parse', data: '{"unclosed_json": ' } },
          inputs: [],
          outputs: []
        }
      ],
      edges: [{ id: 'e1', source: 'trig', sourceHandle: 'main', target: 'json_bad', targetHandle: 'main' }]
    };

    const res = await workflowRunner.runWorkflow(wf, { mockDatabase: db });
    expect(res.execution.status).toBe('FAILED');
    expect(res.stepRecords.find(s => s.nodeId === 'json_bad')?.status).toBe('FAILED');
  });

  it('F27-5: should support template remap mode', async () => {
    const wf: WorkflowDefinition = {
      id: 'wf_json_remap',
      workspaceId: 'ws_1',
      name: 'JSON Remap',
      nodes: [
        { id: 'trig', type: 'trigger.manual', data: { label: 'T', config: {} }, inputs: [], outputs: [] },
        {
          id: 'json_node',
          type: 'core.jsonTransform',
          data: {
            label: 'Remap',
            config: {
              template: {
                transformed: true,
                constantCode: 'LOCAL_FLOW_2026'
              }
            }
          },
          inputs: [],
          outputs: []
        }
      ],
      edges: [{ id: 'e1', source: 'trig', sourceHandle: 'main', target: 'json_node', targetHandle: 'main' }]
    };

    const res = await workflowRunner.runWorkflow(wf, { mockDatabase: db });
    expect(res.execution.status).toBe('SUCCEEDED');
    expect(res.nodeOutputs.get('json_node')).toEqual({ transformed: true, constantCode: 'LOCAL_FLOW_2026' });
  });
});

describe('Tier 1: Feature F28 - Connector: CSV Parser / Generator', () => {
  let db: InMemoryDatabase;

  beforeEach(() => {
    db = new InMemoryDatabase();
  });

  it('F28-1: should parse CSV string with headers into array of JSON objects', async () => {
    const rawCsv = 'name,email,role\nAlice,alice@test.com,admin\nBob,bob@test.com,member';
    const wf: WorkflowDefinition = {
      id: 'wf_csv_parse',
      workspaceId: 'ws_1',
      name: 'CSV Parse Test',
      nodes: [
        { id: 'trig', type: 'trigger.manual', data: { label: 'T', config: {} }, inputs: [], outputs: [] },
        {
          id: 'csv_node',
          type: 'core.csv',
          data: { label: 'Parse CSV', config: { action: 'parse', csvText: rawCsv } },
          inputs: [],
          outputs: []
        }
      ],
      edges: [{ id: 'e1', source: 'trig', sourceHandle: 'main', target: 'csv_node', targetHandle: 'main' }]
    };

    const res = await workflowRunner.runWorkflow(wf, { mockDatabase: db });
    expect(res.execution.status).toBe('SUCCEEDED');
    const rows = res.nodeOutputs.get('csv_node') as Array<Record<string, string>>;
    expect(rows.length).toBe(2);
    expect(rows[0]).toEqual({ name: 'Alice', email: 'alice@test.com', role: 'admin' });
    expect(rows[1]).toEqual({ name: 'Bob', email: 'bob@test.com', role: 'member' });
  });

  it('F28-2: should generate formatted CSV string from array of JSON objects', async () => {
    const objects = [
      { id: '1', product: 'Keyboard', price: '75' },
      { id: '2', product: 'Monitor', price: '250' }
    ];

    const wf: WorkflowDefinition = {
      id: 'wf_csv_gen',
      workspaceId: 'ws_1',
      name: 'CSV Gen Test',
      nodes: [
        { id: 'trig', type: 'trigger.manual', data: { label: 'T', config: {} }, inputs: [], outputs: [] },
        {
          id: 'csv_node',
          type: 'core.csv',
          data: { label: 'Generate CSV', config: { action: 'generate', data: objects } },
          inputs: [],
          outputs: []
        }
      ],
      edges: [{ id: 'e1', source: 'trig', sourceHandle: 'main', target: 'csv_node', targetHandle: 'main' }]
    };

    const res = await workflowRunner.runWorkflow(wf, { mockDatabase: db });
    expect(res.execution.status).toBe('SUCCEEDED');
    const csvString = res.nodeOutputs.get('csv_node') as string;
    expect(csvString).toContain('id,product,price');
    expect(csvString).toContain('1,Keyboard,75');
    expect(csvString).toContain('2,Monitor,250');
  });

  it('F28-3: should encapsulate fields containing commas inside quotes during generation', async () => {
    const objects = [
      { company: 'Acme, Inc.', location: 'Springfield' }
    ];

    const wf: WorkflowDefinition = {
      id: 'wf_csv_quotes',
      workspaceId: 'ws_1',
      name: 'CSV Quotes Test',
      nodes: [
        { id: 'trig', type: 'trigger.manual', data: { label: 'T', config: {} }, inputs: [], outputs: [] },
        {
          id: 'csv_node',
          type: 'core.csv',
          data: { label: 'Generate CSV', config: { action: 'generate', data: objects } },
          inputs: [],
          outputs: []
        }
      ],
      edges: [{ id: 'e1', source: 'trig', sourceHandle: 'main', target: 'csv_node', targetHandle: 'main' }]
    };

    const res = await workflowRunner.runWorkflow(wf, { mockDatabase: db });
    const csvString = res.nodeOutputs.get('csv_node') as string;
    expect(csvString).toContain('"Acme, Inc.",Springfield');
  });

  it('F28-4: should handle empty CSV input by returning empty array', async () => {
    const wf: WorkflowDefinition = {
      id: 'wf_csv_empty',
      workspaceId: 'ws_1',
      name: 'CSV Empty Test',
      nodes: [
        { id: 'trig', type: 'trigger.manual', data: { label: 'T', config: {} }, inputs: [], outputs: [] },
        {
          id: 'csv_node',
          type: 'core.csv',
          data: { label: 'Parse Empty', config: { action: 'parse', csvText: '' } },
          inputs: [],
          outputs: []
        }
      ],
      edges: [{ id: 'e1', source: 'trig', sourceHandle: 'main', target: 'csv_node', targetHandle: 'main' }]
    };

    const res = await workflowRunner.runWorkflow(wf, { mockDatabase: db });
    expect(res.execution.status).toBe('SUCCEEDED');
    const out = res.nodeOutputs.get('csv_node') as unknown[];
    expect(out).toHaveLength(0);
  });

  it('F28-5: should strip enclosing quotes from field values during parse', async () => {
    const rawCsv = 'title,genre\n"The Matrix","Sci-Fi"\n"Inception","Thriller"';
    const wf: WorkflowDefinition = {
      id: 'wf_csv_strip_quotes',
      workspaceId: 'ws_1',
      name: 'CSV Strip Quotes',
      nodes: [
        { id: 'trig', type: 'trigger.manual', data: { label: 'T', config: {} }, inputs: [], outputs: [] },
        {
          id: 'csv_node',
          type: 'core.csv',
          data: { label: 'Parse', config: { action: 'parse', csvText: rawCsv } },
          inputs: [],
          outputs: []
        }
      ],
      edges: [{ id: 'e1', source: 'trig', sourceHandle: 'main', target: 'csv_node', targetHandle: 'main' }]
    };

    const res = await workflowRunner.runWorkflow(wf, { mockDatabase: db });
    const rows = res.nodeOutputs.get('csv_node') as Array<{ title: string; genre: string }>;
    expect(rows[0].title).toBe('The Matrix');
    expect(rows[0].genre).toBe('Sci-Fi');
  });
});
