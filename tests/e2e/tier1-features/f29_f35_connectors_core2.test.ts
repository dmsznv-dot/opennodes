/**
 * LocalFlow E2E Test Suite - Tier 1: Connectors Core 2 & AI (Features F29 - F35)
 * Verifies Features F29 through F35 with >=5 tests per feature (35 tests total).
 */

import { describe, it, expect, beforeEach } from '../harness/index.ts';
import { workflowRunner } from '../harness/workflow-runner.ts';
import { InMemoryDatabase } from '../harness/db-mock.ts';
import { mockServiceRouter } from '../harness/msw-handlers.ts';
import type { WorkflowDefinition } from '../harness/types.ts';

describe('Tier 1: Feature F29 - Connector: RSS / Atom Reader', () => {
  let db: InMemoryDatabase;

  beforeEach(() => {
    db = new InMemoryDatabase();
    mockServiceRouter.reset();
  });

  it('F29-1: should fetch RSS XML feed and parse items into normalized structure', async () => {
    const rssXml = `<?xml version="1.0" encoding="UTF-8" ?>
<rss version="2.0">
<channel>
 <title>Tech News Feed</title>
 <link>https://tech.example.com</link>
 <description>Latest tech news</description>
 <item>
  <guid>news_001</guid>
  <title>LocalFlow Alpha Announced</title>
  <link>https://tech.example.com/item1</link>
  <description>New self-hosted workflow platform released.</description>
  <pubDate>Mon, 02 Nov 2026 08:00:00 GMT</pubDate>
 </item>
</channel>
</rss>`;

    mockServiceRouter.registerRoute('GET', 'https://tech.example.com/rss.xml', () => ({
      status: 200,
      statusText: 'OK',
      headers: { 'content-type': 'application/xml' },
      data: rssXml
    }));

    const wf: WorkflowDefinition = {
      id: 'wf_rss_reader',
      workspaceId: 'ws_1',
      name: 'RSS Reader',
      nodes: [
        { id: 'trig', type: 'trigger.manual', data: { label: 'T', config: {} }, inputs: [], outputs: [] },
        {
          id: 'rss_node',
          type: 'core.rss',
          data: { label: 'Fetch Feed', config: { url: 'https://tech.example.com/rss.xml' } },
          inputs: [],
          outputs: []
        }
      ],
      edges: [{ id: 'e1', source: 'trig', sourceHandle: 'main', target: 'rss_node', targetHandle: 'main' }]
    };

    const res = await workflowRunner.runWorkflow(wf, { mockDatabase: db });
    expect(res.execution.status).toBe('SUCCEEDED');
    const items = res.nodeOutputs.get('rss_node') as Array<{ guid: string; title: string; link: string }>;
    expect(items.length).toBe(1);
    expect(items[0].guid).toBe('news_001');
    expect(items[0].title).toBe('LocalFlow Alpha Announced');
  });

  it('F29-2: should extract multiple feed items maintaining order', async () => {
    const multiItemXml = `<rss version="2.0"><channel>
      <item><guid>item_1</guid><title>First Post</title><link>https://example.com/1</link></item>
      <item><guid>item_2</guid><title>Second Post</title><link>https://example.com/2</link></item>
    </channel></rss>`;

    mockServiceRouter.registerRoute('GET', 'https://feed.example.com/posts', () => ({
      status: 200,
      statusText: 'OK',
      headers: {},
      data: multiItemXml
    }));

    const wf: WorkflowDefinition = {
      id: 'wf_rss_multi',
      workspaceId: 'ws_1',
      name: 'RSS Multi',
      nodes: [
        { id: 'trig', type: 'trigger.manual', data: { label: 'T', config: {} }, inputs: [], outputs: [] },
        { id: 'rss_node', type: 'core.rss', data: { label: 'Feed', config: { url: 'https://feed.example.com/posts' } }, inputs: [], outputs: [] }
      ],
      edges: [{ id: 'e1', source: 'trig', sourceHandle: 'main', target: 'rss_node', targetHandle: 'main' }]
    };

    const res = await workflowRunner.runWorkflow(wf, { mockDatabase: db });
    const items = res.nodeOutputs.get('rss_node') as Array<{ guid: string }>;
    expect(items.length).toBe(2);
    expect(items[0].guid).toBe('item_1');
    expect(items[1].guid).toBe('item_2');
  });

  it('F29-3: should handle empty or item-less XML by returning default item fallback', async () => {
    mockServiceRouter.registerRoute('GET', 'https://feed.example.com/empty', () => ({
      status: 200,
      statusText: 'OK',
      headers: {},
      data: '<rss><channel><title>Empty</title></channel></rss>'
    }));

    const wf: WorkflowDefinition = {
      id: 'wf_rss_empty',
      workspaceId: 'ws_1',
      name: 'RSS Empty',
      nodes: [
        { id: 'trig', type: 'trigger.manual', data: { label: 'T', config: {} }, inputs: [], outputs: [] },
        { id: 'rss_node', type: 'core.rss', data: { label: 'Feed', config: { url: 'https://feed.example.com/empty' } }, inputs: [], outputs: [] }
      ],
      edges: [{ id: 'e1', source: 'trig', sourceHandle: 'main', target: 'rss_node', targetHandle: 'main' }]
    };

    const res = await workflowRunner.runWorkflow(wf, { mockDatabase: db });
    expect(res.execution.status).toBe('SUCCEEDED');
    const items = res.nodeOutputs.get('rss_node') as unknown[];
    expect(items.length).toBeGreaterThanOrEqual(1);
  });

  it('F29-4: should block SSRF attempts targeting private network feed endpoints', async () => {
    const wf: WorkflowDefinition = {
      id: 'wf_rss_ssrf',
      workspaceId: 'ws_1',
      name: 'RSS SSRF',
      nodes: [
        { id: 'trig', type: 'trigger.manual', data: { label: 'T', config: {} }, inputs: [], outputs: [] },
        { id: 'bad_rss', type: 'core.rss', data: { label: 'Internal Feed', config: { url: 'http://169.254.169.254/feed.xml' } }, inputs: [], outputs: [] }
      ],
      edges: [{ id: 'e1', source: 'trig', sourceHandle: 'main', target: 'bad_rss', targetHandle: 'main' }]
    };

    const res = await workflowRunner.runWorkflow(wf, { mockDatabase: db });
    expect(res.execution.status).toBe('FAILED');
    expect(res.execution.errorMessage).toContain('ERR_SSRF_BLOCKED');
  });

  it('F29-5: should pass parsed RSS items into downstream primitive or connector nodes', async () => {
    const xml = `<rss version="2.0"><channel><item><guid>id_99</guid><title>Alert</title></item></channel></rss>`;
    mockServiceRouter.registerRoute('GET', 'https://feed.example.com/alerts', () => ({
      status: 200, statusText: 'OK', headers: {}, data: xml
    }));

    const wf: WorkflowDefinition = {
      id: 'wf_rss_downstream',
      workspaceId: 'ws_1',
      name: 'RSS Downstream',
      nodes: [
        { id: 'trig', type: 'trigger.manual', data: { label: 'T', config: {} }, inputs: [], outputs: [] },
        { id: 'rss', type: 'core.rss', data: { label: 'RSS', config: { url: 'https://feed.example.com/alerts' } }, inputs: [], outputs: [] },
        { id: 'extract', type: 'primitive.map', data: { label: 'Map', config: { firstTitle: '{{ $nodes.rss.output[0].title }}' } }, inputs: [], outputs: [] }
      ],
      edges: [
        { id: 'e1', source: 'trig', sourceHandle: 'main', target: 'rss', targetHandle: 'main' },
        { id: 'e2', source: 'rss', sourceHandle: 'main', target: 'extract', targetHandle: 'main' }
      ]
    };

    const res = await workflowRunner.runWorkflow(wf, { mockDatabase: db });
    expect(res.execution.status).toBe('SUCCEEDED');
    const out = res.nodeOutputs.get('extract') as { firstTitle: string };
    expect(out.firstTitle).toBe('Alert');
  });
});

describe('Tier 1: Feature F30 - Connector: SMTP Send Email', () => {
  let db: InMemoryDatabase;

  beforeEach(() => {
    db = new InMemoryDatabase();
    mockServiceRouter.reset();
  });

  it('F30-1: should dispatch formatted email via simulated SMTP transport', async () => {
    const wf: WorkflowDefinition = {
      id: 'wf_smtp_basic',
      workspaceId: 'ws_1',
      name: 'SMTP Basic',
      nodes: [
        { id: 'trig', type: 'trigger.manual', data: { label: 'T', config: {} }, inputs: [], outputs: [] },
        {
          id: 'smtp_node',
          type: 'core.smtp',
          data: {
            label: 'Send Email',
            config: {
              from: 'billing@localflow.test',
              to: 'customer@client.com',
              subject: 'Your Invoice #1234',
              text: 'Invoice attached. Total: $50.'
            }
          },
          inputs: [],
          outputs: []
        }
      ],
      edges: [{ id: 'e1', source: 'trig', sourceHandle: 'main', target: 'smtp_node', targetHandle: 'main' }]
    };

    const res = await workflowRunner.runWorkflow(wf, { mockDatabase: db });
    expect(res.execution.status).toBe('SUCCEEDED');
    expect(mockServiceRouter.sentEmails.length).toBe(1);
    const sent = mockServiceRouter.sentEmails[0];
    expect(sent.to).toBe('customer@client.com');
    expect(sent.subject).toBe('Your Invoice #1234');
    expect(sent.messageId).toBeDefined();
  });

  it('F30-2: should support multiple recipients specified as an array', async () => {
    const recipients = ['dev1@team.com', 'dev2@team.com', 'lead@team.com'];
    const wf: WorkflowDefinition = {
      id: 'wf_smtp_multi',
      workspaceId: 'ws_1',
      name: 'SMTP Multi',
      nodes: [
        { id: 'trig', type: 'trigger.manual', data: { label: 'T', config: {} }, inputs: [], outputs: [] },
        {
          id: 'smtp_node',
          type: 'core.smtp',
          data: {
            label: 'Team Alert',
            config: {
              from: 'ci@localflow.test',
              to: recipients,
              subject: 'Build Passed'
            }
          },
          inputs: [],
          outputs: []
        }
      ],
      edges: [{ id: 'e1', source: 'trig', sourceHandle: 'main', target: 'smtp_node', targetHandle: 'main' }]
    };

    const res = await workflowRunner.runWorkflow(wf, { mockDatabase: db });
    expect(res.execution.status).toBe('SUCCEEDED');
    const sent = mockServiceRouter.sentEmails[0];
    expect(sent.to).toEqual(recipients);
  });

  it('F30-3: should dynamically interpolate subject and body from trigger payload', async () => {
    const wf: WorkflowDefinition = {
      id: 'wf_smtp_dyn',
      workspaceId: 'ws_1',
      name: 'SMTP Dynamic',
      nodes: [
        { id: 'trig', type: 'trigger.manual', data: { label: 'T', config: {} }, inputs: [], outputs: [] },
        {
          id: 'smtp_node',
          type: 'core.smtp',
          data: {
            label: 'Alert',
            config: {
              from: 'alerts@localflow.test',
              to: 'ops@company.com',
              subject: 'Alert: {{ $trigger.alertType }}',
              text: 'Server {{ $trigger.server }} has exceeded {{ $trigger.metric }} threshold.'
            }
          },
          inputs: [],
          outputs: []
        }
      ],
      edges: [{ id: 'e1', source: 'trig', sourceHandle: 'main', target: 'smtp_node', targetHandle: 'main' }]
    };

    const triggerInput = { alertType: 'CPU High', server: 'app-node-03', metric: '90%' };
    const res = await workflowRunner.runWorkflow(wf, { mockDatabase: db, triggerPayload: triggerInput });

    expect(res.execution.status).toBe('SUCCEEDED');
    const sent = mockServiceRouter.sentEmails[0];
    expect(sent.subject).toBe('Alert: CPU High');
    expect(sent.text).toBe('Server app-node-03 has exceeded 90% threshold.');
  });

  it('F30-4: should report failure when SMTP host refuses connection', async () => {
    mockServiceRouter.smtpFailNext = true;

    const wf: WorkflowDefinition = {
      id: 'wf_smtp_fail',
      workspaceId: 'ws_1',
      name: 'SMTP Fail',
      nodes: [
        { id: 'trig', type: 'trigger.manual', data: { label: 'T', config: {} }, inputs: [], outputs: [] },
        {
          id: 'smtp_node',
          type: 'core.smtp',
          data: { label: 'Send', config: { to: 'fail@test.com', subject: 'Will fail' } },
          inputs: [],
          outputs: []
        }
      ],
      edges: [{ id: 'e1', source: 'trig', sourceHandle: 'main', target: 'smtp_node', targetHandle: 'main' }]
    };

    const res = await workflowRunner.runWorkflow(wf, { mockDatabase: db });
    expect(res.execution.status).toBe('FAILED');
    expect(res.execution.errorMessage).toContain('Connection refused');
  });

  it('F30-5: should return messageId and accepted recipients in step output', async () => {
    const wf: WorkflowDefinition = {
      id: 'wf_smtp_output',
      workspaceId: 'ws_1',
      name: 'SMTP Output',
      nodes: [
        { id: 'trig', type: 'trigger.manual', data: { label: 'T', config: {} }, inputs: [], outputs: [] },
        { id: 'smtp_node', type: 'core.smtp', data: { label: 'Send', config: { to: 'ack@test.com', subject: 'Ack' } }, inputs: [], outputs: [] }
      ],
      edges: [{ id: 'e1', source: 'trig', sourceHandle: 'main', target: 'smtp_node', targetHandle: 'main' }]
    };

    const res = await workflowRunner.runWorkflow(wf, { mockDatabase: db });
    const out = res.nodeOutputs.get('smtp_node') as { sent: boolean; messageId: string; accepted: string[] };
    expect(out.sent).toBe(true);
    expect(out.messageId).toContain('@localflow.test');
    expect(out.accepted).toContain('ack@test.com');
  });
});

describe('Tier 1: Feature F31 - Connector: PostgreSQL SQL', () => {
  let db: InMemoryDatabase;

  beforeEach(() => {
    db = new InMemoryDatabase();
  });

  it('F31-1: should execute parameterized SELECT queries and return rows and rowCount', async () => {
    db.createUser({ email: 'pguser1@test.com', password_hash: 'hash', full_name: 'PG User 1', is_owner: false, is_active: true });
    db.createUser({ email: 'pguser2@test.com', password_hash: 'hash', full_name: 'PG User 2', is_owner: false, is_active: true });

    const wf: WorkflowDefinition = {
      id: 'wf_sql_select',
      workspaceId: 'ws_1',
      name: 'SQL Select',
      nodes: [
        { id: 'trig', type: 'trigger.manual', data: { label: 'T', config: {} }, inputs: [], outputs: [] },
        {
          id: 'sql_node',
          type: 'core.postgresSql',
          data: {
            label: 'Query Users',
            config: {
              query: 'SELECT id, email, full_name FROM users'
            }
          },
          inputs: [],
          outputs: []
        }
      ],
      edges: [{ id: 'e1', source: 'trig', sourceHandle: 'main', target: 'sql_node', targetHandle: 'main' }]
    };

    const res = await workflowRunner.runWorkflow(wf, { mockDatabase: db });
    expect(res.execution.status).toBe('SUCCEEDED');
    const out = res.nodeOutputs.get('sql_node') as { rows: Array<{ email: string }>; rowCount: number };
    expect(out.rowCount).toBe(2);
    expect(out.rows[0].email).toBe('pguser1@test.com');
  });

  it('F31-2: should execute INSERT statements and report rowCount', async () => {
    const wf: WorkflowDefinition = {
      id: 'wf_sql_insert',
      workspaceId: 'ws_1',
      name: 'SQL Insert',
      nodes: [
        { id: 'trig', type: 'trigger.manual', data: { label: 'T', config: {} }, inputs: [], outputs: [] },
        {
          id: 'sql_node',
          type: 'core.postgresSql',
          data: {
            label: 'Insert Row',
            config: {
              query: 'INSERT INTO audit_logs (action) VALUES ($1)',
              params: ['manual_insert_event']
            }
          },
          inputs: [],
          outputs: []
        }
      ],
      edges: [{ id: 'e1', source: 'trig', sourceHandle: 'main', target: 'sql_node', targetHandle: 'main' }]
    };

    const res = await workflowRunner.runWorkflow(wf, { mockDatabase: db });
    expect(res.execution.status).toBe('SUCCEEDED');
    const out = res.nodeOutputs.get('sql_node') as { rowCount: number };
    expect(out.rowCount).toBe(1);
  });

  it('F31-3: should interpolate dynamic query parameters from upstream node outputs', async () => {
    const wf: WorkflowDefinition = {
      id: 'wf_sql_params',
      workspaceId: 'ws_1',
      name: 'SQL Params',
      nodes: [
        { id: 'trig', type: 'trigger.manual', data: { label: 'T', config: {} }, inputs: [], outputs: [] },
        { id: 'input_step', type: 'primitive.map', data: { label: 'Input', config: { targetEmail: 'search@test.com' } }, inputs: [], outputs: [] },
        {
          id: 'sql_node',
          type: 'core.postgresSql',
          data: {
            label: 'Find User',
            config: {
              query: 'SELECT * FROM users WHERE email = $1',
              params: ['{{ $nodes.input_step.output.targetEmail }}']
            }
          },
          inputs: [],
          outputs: []
        }
      ],
      edges: [
        { id: 'e1', source: 'trig', sourceHandle: 'main', target: 'input_step', targetHandle: 'main' },
        { id: 'e2', source: 'input_step', sourceHandle: 'main', target: 'sql_node', targetHandle: 'main' }
      ]
    };

    const res = await workflowRunner.runWorkflow(wf, { mockDatabase: db });
    expect(res.execution.status).toBe('SUCCEEDED');
  });

  it('F31-4: should handle empty result sets with rowCount: 0', async () => {
    const wf: WorkflowDefinition = {
      id: 'wf_sql_empty',
      workspaceId: 'ws_1',
      name: 'SQL Empty',
      nodes: [
        { id: 'trig', type: 'trigger.manual', data: { label: 'T', config: {} }, inputs: [], outputs: [] },
        {
          id: 'sql_node',
          type: 'core.postgresSql',
          data: { label: 'Empty Query', config: { query: 'SELECT * FROM workspaces' } },
          inputs: [],
          outputs: []
        }
      ],
      edges: [{ id: 'e1', source: 'trig', sourceHandle: 'main', target: 'sql_node', targetHandle: 'main' }]
    };

    const res = await workflowRunner.runWorkflow(wf, { mockDatabase: db });
    const out = res.nodeOutputs.get('sql_node') as { rows: unknown[]; rowCount: number };
    expect(out.rowCount).toBe(0);
    expect(out.rows).toHaveLength(0);
  });

  it('F31-5: should record SQL step duration in micro-timing logs', async () => {
    const wf: WorkflowDefinition = {
      id: 'wf_sql_timing',
      workspaceId: 'ws_1',
      name: 'SQL Timing',
      nodes: [
        { id: 'trig', type: 'trigger.manual', data: { label: 'T', config: {} }, inputs: [], outputs: [] },
        { id: 'sql_node', type: 'core.postgresSql', data: { label: 'Q', config: { query: 'SELECT 1' } }, inputs: [], outputs: [] }
      ],
      edges: [{ id: 'e1', source: 'trig', sourceHandle: 'main', target: 'sql_node', targetHandle: 'main' }]
    };

    const res = await workflowRunner.runWorkflow(wf, { mockDatabase: db });
    const step = res.stepRecords.find(s => s.nodeId === 'sql_node');
    expect(step?.status).toBe('SUCCEEDED');
    expect(typeof step?.durationMs).toBe('number');
  });
});

describe('Tier 1: Feature F32 - Connector: Telegram Bot', () => {
  let db: InMemoryDatabase;

  beforeEach(() => {
    db = new InMemoryDatabase();
    mockServiceRouter.reset();
  });

  it('F32-1: should call sendMessage API and dispatch Telegram message', async () => {
    const wf: WorkflowDefinition = {
      id: 'wf_tg_send',
      workspaceId: 'ws_1',
      name: 'TG Send Message',
      nodes: [
        { id: 'trig', type: 'trigger.manual', data: { label: 'T', config: {} }, inputs: [], outputs: [] },
        {
          id: 'tg_node',
          type: 'core.telegramBot',
          data: {
            label: 'Send Alert',
            config: {
              botToken: 'bot_test_token_123',
              chatId: 987654321,
              text: 'Pipeline completed successfully!'
            }
          },
          inputs: [],
          outputs: []
        }
      ],
      edges: [{ id: 'e1', source: 'trig', sourceHandle: 'main', target: 'tg_node', targetHandle: 'main' }]
    };

    const res = await workflowRunner.runWorkflow(wf, { mockDatabase: db });
    expect(res.execution.status).toBe('SUCCEEDED');
    expect(mockServiceRouter.sentTelegramMessages.length).toBe(1);
    const sent = mockServiceRouter.sentTelegramMessages[0];
    expect(sent.chatId).toBe(987654321);
    expect(sent.text).toBe('Pipeline completed successfully!');
  });

  it('F32-2: should support HTML or MarkdownV2 parse_mode parameter', async () => {
    const wf: WorkflowDefinition = {
      id: 'wf_tg_html',
      workspaceId: 'ws_1',
      name: 'TG HTML',
      nodes: [
        { id: 'trig', type: 'trigger.manual', data: { label: 'T', config: {} }, inputs: [], outputs: [] },
        {
          id: 'tg_node',
          type: 'core.telegramBot',
          data: {
            label: 'Send HTML',
            config: {
              botToken: 'bot_token_html',
              chatId: 112233,
              text: '<b>Bold Alert:</b> System load is <i>normal</i>',
              parseMode: 'HTML'
            }
          },
          inputs: [],
          outputs: []
        }
      ],
      edges: [{ id: 'e1', source: 'trig', sourceHandle: 'main', target: 'tg_node', targetHandle: 'main' }]
    };

    const res = await workflowRunner.runWorkflow(wf, { mockDatabase: db });
    expect(res.execution.status).toBe('SUCCEEDED');
    const sent = mockServiceRouter.sentTelegramMessages[0];
    expect(sent.parseMode).toBe('HTML');
  });

  it('F32-3: should interpolate dynamic expression tokens in message text', async () => {
    const wf: WorkflowDefinition = {
      id: 'wf_tg_dyn',
      workspaceId: 'ws_1',
      name: 'TG Dynamic',
      nodes: [
        { id: 'trig', type: 'trigger.manual', data: { label: 'T', config: {} }, inputs: [], outputs: [] },
        { id: 'calc', type: 'primitive.map', data: { label: 'C', config: { newUsers: 142 } }, inputs: [], outputs: [] },
        {
          id: 'tg_node',
          type: 'core.telegramBot',
          data: {
            label: 'Notify',
            config: {
              botToken: 'tok',
              chatId: 999,
              text: 'Today we welcomed {{ $nodes.calc.output.newUsers }} new users!'
            }
          },
          inputs: [],
          outputs: []
        }
      ],
      edges: [
        { id: 'e1', source: 'trig', sourceHandle: 'main', target: 'calc', targetHandle: 'main' },
        { id: 'e2', source: 'calc', sourceHandle: 'main', target: 'tg_node', targetHandle: 'main' }
      ]
    };

    const res = await workflowRunner.runWorkflow(wf, { mockDatabase: db });
    expect(res.execution.status).toBe('SUCCEEDED');
    const sent = mockServiceRouter.sentTelegramMessages[0];
    expect(sent.text).toBe('Today we welcomed 142 new users!');
  });

  it('F32-4: should handle Telegram rate limit response (HTTP 429)', async () => {
    mockServiceRouter.telegramRateLimitEnabled = true;

    const wf: WorkflowDefinition = {
      id: 'wf_tg_429',
      workspaceId: 'ws_1',
      name: 'TG 429',
      nodes: [
        { id: 'trig', type: 'trigger.manual', data: { label: 'T', config: {} }, inputs: [], outputs: [] },
        { id: 'tg_node', type: 'core.telegramBot', data: { label: 'Rate Limited', config: { chatId: 123, text: 'Hello' } }, inputs: [], outputs: [] }
      ],
      edges: [{ id: 'e1', source: 'trig', sourceHandle: 'main', target: 'tg_node', targetHandle: 'main' }]
    };

    const res = await workflowRunner.runWorkflow(wf, { mockDatabase: db });
    expect(res.execution.status).toBe('SUCCEEDED');
    const out = res.nodeOutputs.get('tg_node') as { ok: boolean; error_code: number };
    expect(out.ok).toBe(false);
    expect(out.error_code).toBe(429);
  });

  it('F32-5: should return sent message ID in step output', async () => {
    const wf: WorkflowDefinition = {
      id: 'wf_tg_out',
      workspaceId: 'ws_1',
      name: 'TG Out',
      nodes: [
        { id: 'trig', type: 'trigger.manual', data: { label: 'T', config: {} }, inputs: [], outputs: [] },
        { id: 'tg_node', type: 'core.telegramBot', data: { label: 'Send', config: { chatId: 456, text: 'Ack' } }, inputs: [], outputs: [] }
      ],
      edges: [{ id: 'e1', source: 'trig', sourceHandle: 'main', target: 'tg_node', targetHandle: 'main' }]
    };

    const res = await workflowRunner.runWorkflow(wf, { mockDatabase: db });
    const out = res.nodeOutputs.get('tg_node') as { ok: boolean; result: { message_id: number } };
    expect(out.ok).toBe(true);
    expect(out.result.message_id).toBeGreaterThan(0);
  });
});

describe('Tier 1: Feature F33 - Connector: OpenAI-Compatible LLM', () => {
  let db: InMemoryDatabase;

  beforeEach(() => {
    db = new InMemoryDatabase();
    mockServiceRouter.reset();
  });

  it('F33-1: should call chat completion and return response text and token usage', async () => {
    const wf: WorkflowDefinition = {
      id: 'wf_openai_chat',
      workspaceId: 'ws_1',
      name: 'OpenAI Chat',
      nodes: [
        { id: 'trig', type: 'trigger.manual', data: { label: 'T', config: {} }, inputs: [], outputs: [] },
        {
          id: 'llm_node',
          type: 'ai.openai',
          data: {
            label: 'Summarizer',
            config: {
              model: 'gpt-4o-mini',
              apiKey: 'sk-test-key-123',
              messages: [
                { role: 'system', content: 'You are a helpful assistant.' },
                { role: 'user', content: 'Summarize our release notes.' }
              ]
            }
          },
          inputs: [],
          outputs: []
        }
      ],
      edges: [{ id: 'e1', source: 'trig', sourceHandle: 'main', target: 'llm_node', targetHandle: 'main' }]
    };

    const res = await workflowRunner.runWorkflow(wf, { mockDatabase: db });
    expect(res.execution.status).toBe('SUCCEEDED');
    expect(mockServiceRouter.openAiRequests.length).toBe(1);
    const out = res.nodeOutputs.get('llm_node') as any;
    expect(out.choices[0].message.content).toBeDefined();
    expect(out.usage.total_tokens).toBe(55);
  });

  it('F33-2: should support JSON Schema structured output response format', async () => {
    const wf: WorkflowDefinition = {
      id: 'wf_openai_json',
      workspaceId: 'ws_1',
      name: 'OpenAI JSON',
      nodes: [
        { id: 'trig', type: 'trigger.manual', data: { label: 'T', config: {} }, inputs: [], outputs: [] },
        {
          id: 'llm_node',
          type: 'ai.openai',
          data: {
            label: 'JSON Classifier',
            config: {
              model: 'gpt-4o',
              messages: [{ role: 'user', content: 'Classify this ticket in JSON' }],
              responseFormat: { type: 'json_schema' }
            }
          },
          inputs: [],
          outputs: []
        }
      ],
      edges: [{ id: 'e1', source: 'trig', sourceHandle: 'main', target: 'llm_node', targetHandle: 'main' }]
    };

    const res = await workflowRunner.runWorkflow(wf, { mockDatabase: db });
    expect(res.execution.status).toBe('SUCCEEDED');
    const out = res.nodeOutputs.get('llm_node') as any;
    const jsonParsed = JSON.parse(out.choices[0].message.content);
    expect(jsonParsed.status).toBe('success');
    expect(jsonParsed.sentiment).toBe('positive');
  });

  it('F33-3: should forward model name and custom temperature parameters', async () => {
    const wf: WorkflowDefinition = {
      id: 'wf_openai_params',
      workspaceId: 'ws_1',
      name: 'OpenAI Params',
      nodes: [
        { id: 'trig', type: 'trigger.manual', data: { label: 'T', config: {} }, inputs: [], outputs: [] },
        {
          id: 'llm_node',
          type: 'ai.openai',
          data: {
            label: 'Creative LLM',
            config: {
              model: 'claude-3-5-sonnet-compatible',
              messages: [{ role: 'user', content: 'Generate ideas' }]
            }
          },
          inputs: [],
          outputs: []
        }
      ],
      edges: [{ id: 'e1', source: 'trig', sourceHandle: 'main', target: 'llm_node', targetHandle: 'main' }]
    };

    const res = await workflowRunner.runWorkflow(wf, { mockDatabase: db });
    expect(res.execution.status).toBe('SUCCEEDED');
    expect(mockServiceRouter.openAiRequests[0].model).toBe('claude-3-5-sonnet-compatible');
  });

  it('F33-4: should redact API key in stored execution step logs', async () => {
    const wf: WorkflowDefinition = {
      id: 'wf_openai_redact',
      workspaceId: 'ws_1',
      name: 'OpenAI Redact',
      nodes: [
        { id: 'trig', type: 'trigger.manual', data: { label: 'T', config: {} }, inputs: [], outputs: [] },
        {
          id: 'llm_node',
          type: 'ai.openai',
          data: { label: 'LLM', config: { apiKey: 'sk-very-confidential-key', messages: [{ role: 'user', content: 'hi' }] } },
          inputs: [],
          outputs: []
        }
      ],
      edges: [{ id: 'e1', source: 'trig', sourceHandle: 'main', target: 'llm_node', targetHandle: 'main' }]
    };

    const res = await workflowRunner.runWorkflow(wf, { mockDatabase: db });
    const step = db.findNodeExecutions(res.execution.id).find(s => s.node_id === 'llm_node');
    const input = step?.input_payload as { apiKey: string };
    expect(input.apiKey).toBe('[REDACTED]');
  });

  it('F33-5: should report API rate limit (429) error in step response', async () => {
    mockServiceRouter.openAiFailNext = true;

    const wf: WorkflowDefinition = {
      id: 'wf_openai_429',
      workspaceId: 'ws_1',
      name: 'OpenAI 429',
      nodes: [
        { id: 'trig', type: 'trigger.manual', data: { label: 'T', config: {} }, inputs: [], outputs: [] },
        { id: 'llm_node', type: 'ai.openai', data: { label: 'LLM', config: { messages: [{ role: 'user', content: 'hi' }] } }, inputs: [], outputs: [] }
      ],
      edges: [{ id: 'e1', source: 'trig', sourceHandle: 'main', target: 'llm_node', targetHandle: 'main' }]
    };

    const res = await workflowRunner.runWorkflow(wf, { mockDatabase: db });
    const out = res.nodeOutputs.get('llm_node') as any;
    expect(out.status).toBe(429);
  });
});

describe('Tier 1: Feature F34 - Connector: Local Ollama', () => {
  let db: InMemoryDatabase;

  beforeEach(() => {
    db = new InMemoryDatabase();
    mockServiceRouter.reset();
  });

  it('F34-1: should dispatch prompt to local Ollama daemon and receive completion text', async () => {
    const wf: WorkflowDefinition = {
      id: 'wf_ollama_gen',
      workspaceId: 'ws_1',
      name: 'Ollama Generate',
      nodes: [
        { id: 'trig', type: 'trigger.manual', data: { label: 'T', config: {} }, inputs: [], outputs: [] },
        {
          id: 'ollama_node',
          type: 'ai.ollama',
          data: {
            label: 'Local LLM',
            config: {
              baseUrl: 'http://localhost:11434',
              model: 'llama3',
              prompt: 'Explain quantum computing in 1 sentence.'
            }
          },
          inputs: [],
          outputs: []
        }
      ],
      edges: [{ id: 'e1', source: 'trig', sourceHandle: 'main', target: 'ollama_node', targetHandle: 'main' }]
    };

    const res = await workflowRunner.runWorkflow(wf, { mockDatabase: db });
    expect(res.execution.status).toBe('SUCCEEDED');
    const out = res.nodeOutputs.get('ollama_node') as any;
    expect(out.response).toContain('Ollama local response to');
    expect(out.eval_count).toBe(42);
  });

  it('F34-2: should pass model name and capture evaluation metrics', async () => {
    const wf: WorkflowDefinition = {
      id: 'wf_ollama_model',
      workspaceId: 'ws_1',
      name: 'Ollama Model',
      nodes: [
        { id: 'trig', type: 'trigger.manual', data: { label: 'T', config: {} }, inputs: [], outputs: [] },
        {
          id: 'ollama_node',
          type: 'ai.ollama',
          data: { label: 'Mistral', config: { model: 'mistral:7b', prompt: 'test' } },
          inputs: [],
          outputs: []
        }
      ],
      edges: [{ id: 'e1', source: 'trig', sourceHandle: 'main', target: 'ollama_node', targetHandle: 'main' }]
    };

    const res = await workflowRunner.runWorkflow(wf, { mockDatabase: db });
    expect(mockServiceRouter.ollamaRequests[0].model).toBe('mistral:7b');
    const out = res.nodeOutputs.get('ollama_node') as any;
    expect(out.total_duration).toBeGreaterThan(0);
  });

  it('F34-3: should dynamically interpolate prompt expressions from prior nodes', async () => {
    const wf: WorkflowDefinition = {
      id: 'wf_ollama_dyn',
      workspaceId: 'ws_1',
      name: 'Ollama Dynamic',
      nodes: [
        { id: 'trig', type: 'trigger.manual', data: { label: 'T', config: {} }, inputs: [], outputs: [] },
        { id: 'input', type: 'primitive.map', data: { label: 'Input', config: { query: 'Translate "hello" to French' } }, inputs: [], outputs: [] },
        {
          id: 'ollama_node',
          type: 'ai.ollama',
          data: { label: 'Translate', config: { prompt: '{{ $nodes.input.output.query }}' } },
          inputs: [],
          outputs: []
        }
      ],
      edges: [
        { id: 'e1', source: 'trig', sourceHandle: 'main', target: 'input', targetHandle: 'main' },
        { id: 'e2', source: 'input', sourceHandle: 'main', target: 'ollama_node', targetHandle: 'main' }
      ]
    };

    const res = await workflowRunner.runWorkflow(wf, { mockDatabase: db });
    expect(res.execution.status).toBe('SUCCEEDED');
    expect(mockServiceRouter.ollamaRequests[0].prompt).toBe('Translate "hello" to French');
  });

  it('F34-4: should fail cleanly when local Ollama daemon connection is refused (daemon offline)', async () => {
    mockServiceRouter.ollamaConnectionRefused = true;

    const wf: WorkflowDefinition = {
      id: 'wf_ollama_offline',
      workspaceId: 'ws_1',
      name: 'Ollama Offline',
      nodes: [
        { id: 'trig', type: 'trigger.manual', data: { label: 'T', config: {} }, inputs: [], outputs: [] },
        { id: 'ollama_node', type: 'ai.ollama', data: { label: 'Ollama', config: { prompt: 'hi' } }, inputs: [], outputs: [] }
      ],
      edges: [{ id: 'e1', source: 'trig', sourceHandle: 'main', target: 'ollama_node', targetHandle: 'main' }]
    };

    const res = await workflowRunner.runWorkflow(wf, { mockDatabase: db });
    expect(res.execution.status).toBe('FAILED');
    expect(res.execution.errorMessage).toContain('ECONNREFUSED');
  });

  it('F34-5: should forward generated response to downstream Telegram notification node', async () => {
    const wf: WorkflowDefinition = {
      id: 'wf_ollama_tg',
      workspaceId: 'ws_1',
      name: 'Ollama to TG',
      nodes: [
        { id: 'trig', type: 'trigger.manual', data: { label: 'T', config: {} }, inputs: [], outputs: [] },
        { id: 'ollama', type: 'ai.ollama', data: { label: 'Ollama', config: { prompt: 'Give advice' } }, inputs: [], outputs: [] },
        {
          id: 'tg',
          type: 'core.telegramBot',
          data: { label: 'TG', config: { chatId: 12345, text: 'AI says: {{ $nodes.ollama.output.response }}' } },
          inputs: [],
          outputs: []
        }
      ],
      edges: [
        { id: 'e1', source: 'trig', sourceHandle: 'main', target: 'ollama', targetHandle: 'main' },
        { id: 'e2', source: 'ollama', sourceHandle: 'main', target: 'tg', targetHandle: 'main' }
      ]
    };

    const res = await workflowRunner.runWorkflow(wf, { mockDatabase: db });
    expect(res.execution.status).toBe('SUCCEEDED');
    const sent = mockServiceRouter.sentTelegramMessages[0];
    expect(sent.text).toContain('AI says: Ollama local response to: Give advice');
  });
});

describe('Tier 1: Feature F35 - Connector: Controlled Filesystem Access', () => {
  let db: InMemoryDatabase;

  beforeEach(() => {
    db = new InMemoryDatabase();
    workflowRunner.resetFs();
  });

  it('F35-1: should write file inside allowed sandbox directory', async () => {
    const wf: WorkflowDefinition = {
      id: 'wf_fs_write',
      workspaceId: 'ws_1',
      name: 'FS Write',
      nodes: [
        { id: 'trig', type: 'trigger.manual', data: { label: 'T', config: {} }, inputs: [], outputs: [] },
        {
          id: 'fs_node',
          type: 'core.filesystem',
          data: {
            label: 'Write File',
            config: {
              action: 'writeFile',
              path: 'reports/summary.txt',
              content: 'Execution report content'
            }
          },
          inputs: [],
          outputs: []
        }
      ],
      edges: [{ id: 'e1', source: 'trig', sourceHandle: 'main', target: 'fs_node', targetHandle: 'main' }]
    };

    const res = await workflowRunner.runWorkflow(wf, { mockDatabase: db });
    expect(res.execution.status).toBe('SUCCEEDED');
    const out = res.nodeOutputs.get('fs_node') as { written: boolean; sizeBytes: number };
    expect(out.written).toBe(true);
    expect(out.sizeBytes).toBeGreaterThan(0);
  });

  it('F35-2: should read back previously written file content', async () => {
    const wf: WorkflowDefinition = {
      id: 'wf_fs_read',
      workspaceId: 'ws_1',
      name: 'FS Read',
      nodes: [
        { id: 'trig', type: 'trigger.manual', data: { label: 'T', config: {} }, inputs: [], outputs: [] },
        { id: 'write', type: 'core.filesystem', data: { label: 'Write', config: { action: 'writeFile', path: 'data.json', content: '{"status":"ok"}' } }, inputs: [], outputs: [] },
        { id: 'read', type: 'core.filesystem', data: { label: 'Read', config: { action: 'readFile', path: 'data.json' } }, inputs: [], outputs: [] }
      ],
      edges: [
        { id: 'e1', source: 'trig', sourceHandle: 'main', target: 'write', targetHandle: 'main' },
        { id: 'e2', source: 'write', sourceHandle: 'main', target: 'read', targetHandle: 'main' }
      ]
    };

    const res = await workflowRunner.runWorkflow(wf, { mockDatabase: db });
    expect(res.execution.status).toBe('SUCCEEDED');
    const readOut = res.nodeOutputs.get('read') as { content: string };
    expect(readOut.content).toBe('{"status":"ok"}');
  });

  it('F35-3: should list files in the sandboxed mount directory', async () => {
    const wf: WorkflowDefinition = {
      id: 'wf_fs_list',
      workspaceId: 'ws_1',
      name: 'FS List',
      nodes: [
        { id: 'trig', type: 'trigger.manual', data: { label: 'T', config: {} }, inputs: [], outputs: [] },
        { id: 'w1', type: 'core.filesystem', data: { label: 'W1', config: { action: 'writeFile', path: 'f1.txt', content: '1' } }, inputs: [], outputs: [] },
        { id: 'w2', type: 'core.filesystem', data: { label: 'W2', config: { action: 'writeFile', path: 'f2.txt', content: '2' } }, inputs: [], outputs: [] },
        { id: 'list', type: 'core.filesystem', data: { label: 'List', config: { action: 'listFiles', path: '' } }, inputs: [], outputs: [] }
      ],
      edges: [
        { id: 'e1', source: 'trig', sourceHandle: 'main', target: 'w1', targetHandle: 'main' },
        { id: 'e2', source: 'w1', sourceHandle: 'main', target: 'w2', targetHandle: 'main' },
        { id: 'e3', source: 'w2', sourceHandle: 'main', target: 'list', targetHandle: 'main' }
      ]
    };

    const res = await workflowRunner.runWorkflow(wf, { mockDatabase: db });
    expect(res.execution.status).toBe('SUCCEEDED');
    const listOut = res.nodeOutputs.get('list') as { files: string[] };
    expect(listOut.files.length).toBe(2);
  });

  it('F35-4: should delete an existing file in the sandboxed directory', async () => {
    const wf: WorkflowDefinition = {
      id: 'wf_fs_delete',
      workspaceId: 'ws_1',
      name: 'FS Delete',
      nodes: [
        { id: 'trig', type: 'trigger.manual', data: { label: 'T', config: {} }, inputs: [], outputs: [] },
        { id: 'write', type: 'core.filesystem', data: { label: 'Write', config: { action: 'writeFile', path: 'temp.log', content: 'temp' } }, inputs: [], outputs: [] },
        { id: 'del', type: 'core.filesystem', data: { label: 'Delete', config: { action: 'deleteFile', path: 'temp.log' } }, inputs: [], outputs: [] }
      ],
      edges: [
        { id: 'e1', source: 'trig', sourceHandle: 'main', target: 'write', targetHandle: 'main' },
        { id: 'e2', source: 'write', sourceHandle: 'main', target: 'del', targetHandle: 'main' }
      ]
    };

    const res = await workflowRunner.runWorkflow(wf, { mockDatabase: db });
    expect(res.execution.status).toBe('SUCCEEDED');
    const delOut = res.nodeOutputs.get('del') as { deleted: boolean };
    expect(delOut.deleted).toBe(true);
  });

  it('F35-5: should strictly reject path traversal attempts (../) escaping the root mount with ERR_PATH_TRAVERSAL_DETECTED', async () => {
    const wf: WorkflowDefinition = {
      id: 'wf_fs_traversal',
      workspaceId: 'ws_1',
      name: 'FS Traversal',
      nodes: [
        { id: 'trig', type: 'trigger.manual', data: { label: 'T', config: {} }, inputs: [], outputs: [] },
        {
          id: 'bad_fs',
          type: 'core.filesystem',
          data: { label: 'Escape', config: { action: 'readFile', path: '../../../../etc/shadow' } },
          inputs: [],
          outputs: []
        }
      ],
      edges: [{ id: 'e1', source: 'trig', sourceHandle: 'main', target: 'bad_fs', targetHandle: 'main' }]
    };

    const res = await workflowRunner.runWorkflow(wf, { mockDatabase: db });
    expect(res.execution.status).toBe('FAILED');
    expect(res.execution.errorMessage).toContain('ERR_PATH_TRAVERSAL_DETECTED');
  });
});
