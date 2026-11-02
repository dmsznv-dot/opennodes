/**
 * LocalFlow E2E Test Suite - Tier 3: Primitives to Connectors Combinations
 * Exercises pairwise & chain combinations between execution primitives
 * and foundational connectors (HTTP, Postgres SQL, Filesystem, CSV, RSS, SMTP, Telegram).
 */

import { describe, it, expect } from '../harness/index.ts';
import { WorkflowRunner } from '../harness/workflow-runner.ts';
import { InMemoryDatabase } from '../harness/db-mock.ts';
import type { WorkflowDefinition } from '../harness/types.ts';

describe('Tier 3: Combination - Primitives to Connectors', () => {
  const runner = new WorkflowRunner();

  it('T3-PC-1: Cron trigger -> For Each batch -> HTTP mock call -> Merge outputs -> SQL insert', async () => {
    const db = new InMemoryDatabase();
    const workflow: WorkflowDefinition = {
      id: 'wf_t3_pc_1',
      workspaceId: 'ws_tier3',
      name: 'Batch HTTP Sync to Postgres',
      version: 1,
      nodes: [
        {
          id: 'node_cron',
          type: 'trigger.cron',
          name: 'Hourly Cron',
          position: { x: 0, y: 0 },
          data: { config: { cron: '0 * * * *' } }
        },
        {
          id: 'node_foreach',
          type: 'primitive.forEach',
          name: 'Iterate Endpoints',
          position: { x: 150, y: 0 },
          data: {
            config: {
              items: ['users', 'metrics']
            }
          }
        },
        {
          id: 'node_http',
          type: 'core.httpRequest',
          name: 'Fetch External API',
          position: { x: 300, y: 0 },
          data: {
            config: {
              url: 'https://api.github.com/zen',
              method: 'GET'
            }
          }
        },
        {
          id: 'node_sql',
          type: 'core.postgresSql',
          name: 'Store in Postgres',
          position: { x: 450, y: 0 },
          data: {
            config: {
              query: 'INSERT INTO sync_logs (status, body) VALUES ($1, $2)',
              params: ['{{ $nodes.node_http.output.status }}', '{{ $nodes.node_http.output.data }}']
            }
          }
        }
      ],
      edges: [
        { id: 'e1', source: 'node_cron', target: 'node_foreach', sourceHandle: 'main', targetHandle: 'main' },
        { id: 'e2', source: 'node_foreach', target: 'node_http', sourceHandle: 'done', targetHandle: 'main' },
        { id: 'e3', source: 'node_http', target: 'node_sql', sourceHandle: 'main', targetHandle: 'main' }
      ]
    };

    const result = await runner.runWorkflow(workflow, { mockDatabase: db });
    expect(result.execution.status).toBe('SUCCEEDED');

    const httpOut = result.nodeOutputs.get('node_http') as { status: number; data: string };
    expect(httpOut.status).toBe(200);

    const sqlOut = result.nodeOutputs.get('node_sql') as { rowCount: number };
    expect(sqlOut.rowCount).toBe(1);
  });

  it('T3-PC-2: Postgres SQL query -> Filter users -> Map to email format -> SMTP dispatch', async () => {
    const db = new InMemoryDatabase();
    // Pre-populate users in mock DB
    db.createUser({
      email: 'admin@company.test',
      password_hash: 'hash1',
      display_name: 'Admin User',
      system_role: 'ADMIN'
    });
    db.createUser({
      email: 'guest@company.test',
      password_hash: 'hash2',
      display_name: 'Guest User',
      system_role: 'VIEWER'
    });

    const workflow: WorkflowDefinition = {
      id: 'wf_t3_pc_2',
      workspaceId: 'ws_tier3',
      name: 'SQL to Filter to Email Dispatch',
      version: 1,
      nodes: [
        {
          id: 'node_trigger',
          type: 'trigger.manual',
          name: 'Manual Start',
          position: { x: 0, y: 0 },
          data: { config: {} }
        },
        {
          id: 'node_sql',
          type: 'core.postgresSql',
          name: 'Query Users',
          position: { x: 150, y: 0 },
          data: {
            config: {
              query: 'SELECT * FROM users'
            }
          }
        },
        {
          id: 'node_filter',
          type: 'primitive.filter',
          name: 'Filter Admins',
          position: { x: 300, y: 0 },
          data: {
            config: {
              items: '{{ $nodes.node_sql.output.rows }}',
              predicate: '{{ $item.email === "admin@company.test" }}'
            }
          }
        },
        {
          id: 'node_map',
          type: 'primitive.map',
          name: 'Prepare Email Data',
          position: { x: 450, y: 0 },
          data: {
            config: {
              recipient: '{{ $nodes.node_filter.output.passed[0].email }}',
              adminCount: '{{ $nodes.node_filter.output.count }}'
            }
          }
        },
        {
          id: 'node_smtp',
          type: 'core.smtp',
          name: 'Send Admin Notification',
          position: { x: 600, y: 0 },
          data: {
            config: {
              from: 'security@company.test',
              to: '{{ $nodes.node_map.output.recipient }}',
              subject: 'Admin Status Notice',
              text: 'System health check completed. Active admins: {{ $nodes.node_map.output.adminCount }}'
            }
          }
        }
      ],
      edges: [
        { id: 'e1', source: 'node_trigger', target: 'node_sql', sourceHandle: 'main', targetHandle: 'main' },
        { id: 'e2', source: 'node_sql', target: 'node_filter', sourceHandle: 'main', targetHandle: 'main' },
        { id: 'e3', source: 'node_filter', target: 'node_map', sourceHandle: 'passed', targetHandle: 'main' },
        { id: 'e4', source: 'node_map', target: 'node_smtp', sourceHandle: 'main', targetHandle: 'main' }
      ]
    };

    const result = await runner.runWorkflow(workflow, { mockDatabase: db });
    expect(result.execution.status).toBe('SUCCEEDED');

    const filterOut = result.nodeOutputs.get('node_filter') as { count: number; passed: any[] };
    expect(filterOut.count).toBe(1);
    expect(filterOut.passed[0].email).toBe('admin@company.test');

    const smtpOut = result.nodeOutputs.get('node_smtp') as { sent: boolean; messageId: string };
    expect(smtpOut.sent).toBe(true);
    expect(typeof smtpOut.messageId).toBe('string');
  });

  it('T3-PC-3: CSV data parse -> Filter high priority rows -> Filesystem writeFile', async () => {
    const db = new InMemoryDatabase();
    runner.resetFs();

    const csvContent = 'id,name,priority\n101,Disk Full,HIGH\n102,Typo in Docs,LOW\n103,Memory Leak,HIGH';

    const workflow: WorkflowDefinition = {
      id: 'wf_t3_pc_3',
      workspaceId: 'ws_tier3',
      name: 'CSV to Filter to Filesystem Export',
      version: 1,
      nodes: [
        {
          id: 'node_trigger',
          type: 'trigger.manual',
          name: 'Manual Trigger',
          position: { x: 0, y: 0 },
          data: { config: {} }
        },
        {
          id: 'node_csv',
          type: 'core.csv',
          name: 'Parse Incident CSV',
          position: { x: 150, y: 0 },
          data: {
            config: {
              action: 'parse',
              csvText: csvContent
            }
          }
        },
        {
          id: 'node_filter',
          type: 'primitive.filter',
          name: 'Filter High Priority',
          position: { x: 300, y: 0 },
          data: {
            config: {
              items: '{{ $nodes.node_csv.output }}',
              predicate: '{{ $item.priority === "HIGH" }}'
            }
          }
        },
        {
          id: 'node_fs_write',
          type: 'core.filesystem',
          name: 'Save High Priority Log',
          position: { x: 450, y: 0 },
          data: {
            config: {
              action: 'writeFile',
              path: 'high-priority.json',
              content: '{{ $nodes.node_filter.output.passed }}'
            }
          }
        }
      ],
      edges: [
        { id: 'e1', source: 'node_trigger', target: 'node_csv', sourceHandle: 'main', targetHandle: 'main' },
        { id: 'e2', source: 'node_csv', target: 'node_filter', sourceHandle: 'main', targetHandle: 'main' },
        { id: 'e3', source: 'node_filter', target: 'node_fs_write', sourceHandle: 'passed', targetHandle: 'main' }
      ]
    };

    const result = await runner.runWorkflow(workflow, {
      mockDatabase: db,
      allowedFsRoot: '/data/allowed'
    });
    expect(result.execution.status).toBe('SUCCEEDED');

    const filterOut = result.nodeOutputs.get('node_filter') as { count: number; passed: any[] };
    expect(filterOut.count).toBe(2);

    const fsOut = result.nodeOutputs.get('node_fs_write') as { written: boolean; path: string };
    expect(fsOut.written).toBe(true);
    expect(fsOut.path).toBe('/data/allowed/high-priority.json');
  });

  it('T3-PC-4: Filesystem readFile -> CSV Parse -> Map row transformation -> Outgoing Webhook POST', async () => {
    const db = new InMemoryDatabase();
    runner.resetFs();

    // Prepare a file in mock filesystem first via writeFile
    const initialWorkflow: WorkflowDefinition = {
      id: 'wf_setup_fs',
      workspaceId: 'ws_tier3',
      name: 'Setup Seed File',
      version: 1,
      nodes: [
        {
          id: 't',
          type: 'trigger.manual',
          name: 'T',
          position: { x: 0, y: 0 },
          data: { config: {} }
        },
        {
          id: 'write_seed',
          type: 'core.filesystem',
          name: 'Write Seed',
          position: { x: 150, y: 0 },
          data: {
            config: {
              action: 'writeFile',
              path: 'contacts.csv',
              content: 'email,name\npartner@corp.test,Partner Co'
            }
          }
        }
      ],
      edges: [{ id: 'e1', source: 't', target: 'write_seed', sourceHandle: 'main', targetHandle: 'main' }]
    };
    await runner.runWorkflow(initialWorkflow, { mockDatabase: db, allowedFsRoot: '/data/allowed' });

    // Pipeline: Read -> CSV Parse -> Map -> Webhook POST
    const workflow: WorkflowDefinition = {
      id: 'wf_t3_pc_4',
      workspaceId: 'ws_tier3',
      name: 'Filesystem to CSV to Webhook',
      version: 1,
      nodes: [
        {
          id: 'node_trigger',
          type: 'trigger.manual',
          name: 'Start Read',
          position: { x: 0, y: 0 },
          data: { config: {} }
        },
        {
          id: 'node_fs_read',
          type: 'core.filesystem',
          name: 'Read Seed CSV',
          position: { x: 150, y: 0 },
          data: {
            config: {
              action: 'readFile',
              path: 'contacts.csv'
            }
          }
        },
        {
          id: 'node_csv_parse',
          type: 'core.csv',
          name: 'Parse CSV',
          position: { x: 300, y: 0 },
          data: {
            config: {
              action: 'parse',
              csvText: '{{ $nodes.node_fs_read.output.content }}'
            }
          }
        },
        {
          id: 'node_map',
          type: 'primitive.map',
          name: 'Format Payload',
          position: { x: 450, y: 0 },
          data: {
            config: {
              contactEmail: '{{ $nodes.node_csv_parse.output[0].email }}',
              source: 'filesystem-sync'
            }
          }
        },
        {
          id: 'node_webhook_out',
          type: 'core.outgoingWebhook',
          name: 'Send Webhook',
          position: { x: 600, y: 0 },
          data: {
            config: {
              url: 'https://httpbin.org/post',
              payload: {
                target: '{{ $nodes.node_map.output.contactEmail }}',
                source: '{{ $nodes.node_map.output.source }}'
              }
            }
          }
        }
      ],
      edges: [
        { id: 'e1', source: 'node_trigger', target: 'node_fs_read', sourceHandle: 'main', targetHandle: 'main' },
        { id: 'e2', source: 'node_fs_read', target: 'node_csv_parse', sourceHandle: 'main', targetHandle: 'main' },
        { id: 'e3', source: 'node_csv_parse', target: 'node_map', sourceHandle: 'main', targetHandle: 'main' },
        { id: 'e4', source: 'node_map', target: 'node_webhook_out', sourceHandle: 'main', targetHandle: 'main' }
      ]
    };

    const result = await runner.runWorkflow(workflow, {
      mockDatabase: db,
      allowedFsRoot: '/data/allowed'
    });
    expect(result.execution.status).toBe('SUCCEEDED');

    const webhookOut = result.nodeOutputs.get('node_webhook_out') as { delivered: boolean; statusCode: number };
    expect(webhookOut.delivered).toBe(true);
    expect(webhookOut.statusCode).toBe(200);
  });

  it('T3-PC-5: RSS Feed Reader -> Filter articles matching query -> Telegram Bot notification', async () => {
    const db = new InMemoryDatabase();
    const workflow: WorkflowDefinition = {
      id: 'wf_t3_pc_5',
      workspaceId: 'ws_tier3',
      name: 'RSS to Telegram News Bot',
      version: 1,
      nodes: [
        {
          id: 'node_cron',
          type: 'trigger.cron',
          name: 'Daily Morning',
          position: { x: 0, y: 0 },
          data: { config: { cron: '0 8 * * *' } }
        },
        {
          id: 'node_rss',
          type: 'core.rss',
          name: 'Fetch Tech News',
          position: { x: 150, y: 0 },
          data: {
            config: {
              url: 'https://news.ycombinator.com/rss'
            }
          }
        },
        {
          id: 'node_filter',
          type: 'primitive.filter',
          name: 'Filter AI Articles',
          position: { x: 300, y: 0 },
          data: {
            config: {
              items: '{{ $nodes.node_rss.output }}',
              predicate: '{{ $item.title.includes("LocalFlow") || $item.title.includes("TypeScript") }}'
            }
          }
        },
        {
          id: 'node_telegram',
          type: 'core.telegramBot',
          name: 'Notify Telegram Channel',
          position: { x: 450, y: 0 },
          data: {
            config: {
              botToken: 'bot123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11',
              chatId: '@tech_updates',
              text: 'Found {{ $nodes.node_filter.output.count }} relevant article(s)',
              parseMode: 'HTML'
            }
          }
        }
      ],
      edges: [
        { id: 'e1', source: 'node_cron', target: 'node_rss', sourceHandle: 'main', targetHandle: 'main' },
        { id: 'e2', source: 'node_rss', target: 'node_filter', sourceHandle: 'main', targetHandle: 'main' },
        { id: 'e3', source: 'node_filter', target: 'node_telegram', sourceHandle: 'passed', targetHandle: 'main' }
      ]
    };

    const result = await runner.runWorkflow(workflow, { mockDatabase: db });
    expect(result.execution.status).toBe('SUCCEEDED');

    const rssOut = result.nodeOutputs.get('node_rss') as any[];
    expect(rssOut.length).toBeGreaterThan(0);

    const tgOut = result.nodeOutputs.get('node_telegram') as { ok: boolean; result: { message_id: number } };
    expect(tgOut.ok).toBe(true);
    expect(tgOut.result.message_id).toBe(1001);
  });

  it('T3-PC-6: HTTP GET with conditional status check branching to Telegram Bot error alert', async () => {
    const db = new InMemoryDatabase();
    const workflow: WorkflowDefinition = {
      id: 'wf_t3_pc_6',
      workspaceId: 'ws_tier3',
      name: 'HTTP Health Check & Telegram Alert',
      version: 1,
      nodes: [
        {
          id: 'node_trigger',
          type: 'trigger.manual',
          name: 'Trigger Ping',
          position: { x: 0, y: 0 },
          data: { config: {} }
        },
        {
          id: 'node_http',
          type: 'core.httpRequest',
          name: 'Check Server Status',
          position: { x: 150, y: 0 },
          data: {
            config: {
              url: 'https://httpbin.org/status/200',
              method: 'GET'
            }
          }
        },
        {
          id: 'node_if',
          type: 'primitive.if',
          name: 'Is Server Healthy',
          position: { x: 300, y: 0 },
          data: {
            config: {
              condition: '{{ $nodes.node_http.output.status === 200 }}'
            }
          }
        },
        {
          id: 'node_tg_ok',
          type: 'core.telegramBot',
          name: 'Healthy Alert',
          position: { x: 450, y: -50 },
          data: {
            config: {
              botToken: 'bot123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11',
              chatId: '12345678',
              text: 'Server is healthy: HTTP 200 OK'
            }
          }
        },
        {
          id: 'node_tg_err',
          type: 'core.telegramBot',
          name: 'Failure Alert',
          position: { x: 450, y: 50 },
          data: {
            config: {
              botToken: 'bot123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11',
              chatId: '12345678',
              text: 'Server DOWN!'
            }
          }
        }
      ],
      edges: [
        { id: 'e1', source: 'node_trigger', target: 'node_http', sourceHandle: 'main', targetHandle: 'main' },
        { id: 'e2', source: 'node_http', target: 'node_if', sourceHandle: 'main', targetHandle: 'main' },
        { id: 'e3', source: 'node_if', target: 'node_tg_ok', sourceHandle: 'true', targetHandle: 'main' },
        { id: 'e4', source: 'node_if', target: 'node_tg_err', sourceHandle: 'false', targetHandle: 'main' }
      ]
    };

    const result = await runner.runWorkflow(workflow, { mockDatabase: db });
    expect(result.execution.status).toBe('SUCCEEDED');
    expect(result.skippedNodes.has('node_tg_err')).toBe(true);

    const tgOut = result.nodeOutputs.get('node_tg_ok') as { ok: boolean; result: { text: string } };
    expect(tgOut.ok).toBe(true);
    expect(tgOut.result.text).toBe('Server is healthy: HTTP 200 OK');
  });
});
