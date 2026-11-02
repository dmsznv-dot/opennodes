/**
 * LocalFlow E2E Test Suite - Tier 4: Scenario 4 - Server Health Monitor & AI Diagnostics
 * Full Real-World Application Scenario:
 * Cron Health Check -> HTTP Ping -> Status Evaluation (IF) -> Ollama Local Diagnosis -> Telegram Alert
 */

import { describe, it, expect, beforeEach } from '../harness/index.ts';
import { WorkflowRunner } from '../harness/workflow-runner.ts';
import { InMemoryDatabase } from '../harness/db-mock.ts';
import { mockServiceRouter } from '../harness/msw-handlers.ts';
import type { WorkflowDefinition } from '../harness/types.ts';

describe('Tier 4: Scenario 4 - Server Health Monitor & AI Diagnostic Bot', () => {
  const runner = new WorkflowRunner();
  let db: InMemoryDatabase;

  beforeEach(() => {
    db = new InMemoryDatabase();
    mockServiceRouter.reset();
  });

  it('S4-1: should detect healthy server status and route to silent heartbeat log', async () => {
    const workflow: WorkflowDefinition = {
      id: 'wf_scenario_server_monitor',
      workspaceId: 'ws_prod_scenarios',
      name: 'Server Health Monitor & Autonomous Diagnostic Bot',
      version: 1,
      nodes: [
        {
          id: 'node_cron',
          type: 'trigger.cron',
          name: 'Periodic Health Ping',
          position: { x: 0, y: 0 },
          data: { config: { cron: '*/5 * * * *' } }
        },
        {
          id: 'node_http',
          type: 'core.httpRequest',
          name: 'Ping Production Health Endpoint',
          position: { x: 200, y: 0 },
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
          name: 'Is Server Down or Degraded',
          position: { x: 400, y: 0 },
          data: {
            config: {
              condition: '{{ $nodes.node_http.output.status !== 200 }}'
            }
          }
        },
        {
          id: 'node_ollama',
          type: 'ai.ollama',
          name: 'Triage Server Failure Diagnostic',
          position: { x: 600, y: -50 },
          data: {
            config: {
              baseUrl: 'http://localhost:11434',
              model: 'llama3:8b',
              prompt: 'Diagnose incident: HTTP status {{ $nodes.node_http.output.status }}'
            }
          }
        },
        {
          id: 'node_telegram',
          type: 'core.telegramBot',
          name: 'Alert DevOps SRE Channel',
          position: { x: 800, y: -50 },
          data: {
            config: {
              botToken: 'bot123456:SRE-AlertBot-Token',
              chatId: '@sre_oncall',
              text: '🚨 INCIDENT: {{ $nodes.node_ollama.output.response }}'
            }
          }
        },
        {
          id: 'node_sql_log',
          type: 'core.postgresSql',
          name: 'Log Clean Heartbeat to Postgres',
          position: { x: 600, y: 100 },
          data: {
            config: {
              query: 'INSERT INTO audit_logs (action, details) VALUES ($1, $2)',
              params: ['SERVER_PING_OK', 'Status 200 OK']
            }
          }
        }
      ],
      edges: [
        { id: 'e1', source: 'node_cron', target: 'node_http', sourceHandle: 'main', targetHandle: 'main' },
        { id: 'e2', source: 'node_http', target: 'node_if', sourceHandle: 'main', targetHandle: 'main' },
        { id: 'e3', source: 'node_if', target: 'node_ollama', sourceHandle: 'true', targetHandle: 'main' },
        { id: 'e4', source: 'node_ollama', target: 'node_telegram', sourceHandle: 'main', targetHandle: 'main' },
        { id: 'e5', source: 'node_if', target: 'node_sql_log', sourceHandle: 'false', targetHandle: 'main' }
      ]
    };

    const result = await runner.runWorkflow(workflow, { mockDatabase: db });

    expect(result.execution.status).toBe('SUCCEEDED');
    // Verify server is healthy: status 200
    const httpOut = result.nodeOutputs.get('node_http') as { status: number };
    expect(httpOut.status).toBe(200);

    // False branch taken: SRE alert was SKIPPED, heartbeat was logged
    expect(result.skippedNodes.has('node_ollama')).toBe(true);
    expect(result.skippedNodes.has('node_telegram')).toBe(true);

    const sqlOut = result.nodeOutputs.get('node_sql_log') as { rowCount: number };
    expect(sqlOut.rowCount).toBe(1);
  });

  it('S4-2: should trigger Ollama diagnostic and Telegram alert when server endpoint fails', async () => {
    // Configure mock route for server returning 503 Service Unavailable
    mockServiceRouter.registerRoute('GET', 'https://api.internal-service.local/health', () => ({
      status: 503,
      statusText: 'Service Unavailable',
      headers: { 'content-type': 'application/json' },
      data: { error: 'Database connection pool exhausted', activeConnections: 100, maxConnections: 100 }
    }));

    const workflow: WorkflowDefinition = {
      id: 'wf_scenario_server_failure',
      workspaceId: 'ws_prod_scenarios',
      name: 'Server Outage Escalation Pipeline',
      version: 1,
      nodes: [
        {
          id: 'node_trigger',
          type: 'trigger.manual',
          name: 'Manual Health Check',
          position: { x: 0, y: 0 },
          data: { config: {} }
        },
        {
          id: 'node_http',
          type: 'core.httpRequest',
          name: 'Ping Failing Endpoint',
          position: { x: 200, y: 0 },
          data: {
            config: {
              url: 'https://api.internal-service.local/health',
              method: 'GET'
            }
          }
        },
        {
          id: 'node_if',
          type: 'primitive.if',
          name: 'Check If Failed',
          position: { x: 400, y: 0 },
          data: {
            config: {
              condition: '{{ $nodes.node_http.output.status !== 200 }}'
            }
          }
        },
        {
          id: 'node_ollama',
          type: 'ai.ollama',
          name: 'Diagnose Incident with Llama',
          position: { x: 600, y: 0 },
          data: {
            config: {
              baseUrl: 'http://localhost:11434',
              model: 'llama3:8b',
              prompt: 'Diagnose incident: Server returned HTTP {{ $nodes.node_http.output.status }}'
            }
          }
        },
        {
          id: 'node_telegram',
          type: 'core.telegramBot',
          name: 'Broadcast Incident Alert',
          position: { x: 800, y: 0 },
          data: {
            config: {
              botToken: 'bot123456:SRE-AlertBot-Token',
              chatId: '@sre_oncall',
              text: '🔥 <b>CRITICAL OUTAGE</b>: {{ $nodes.node_ollama.output.response }}'
            }
          }
        }
      ],
      edges: [
        { id: 'e1', source: 'node_trigger', target: 'node_http', sourceHandle: 'main', targetHandle: 'main' },
        { id: 'e2', source: 'node_http', target: 'node_if', sourceHandle: 'main', targetHandle: 'main' },
        { id: 'e3', source: 'node_if', target: 'node_ollama', sourceHandle: 'true', targetHandle: 'main' },
        { id: 'e4', source: 'node_ollama', target: 'node_telegram', sourceHandle: 'main', targetHandle: 'main' }
      ]
    };

    const result = await runner.runWorkflow(workflow, { mockDatabase: db });

    expect(result.execution.status).toBe('SUCCEEDED');
    const httpOut = result.nodeOutputs.get('node_http') as { status: number };
    expect(httpOut.status).toBe(503);

    // Ollama diagnostic executed
    const ollamaOut = result.nodeOutputs.get('node_ollama') as { response: string };
    expect(ollamaOut.response.includes('HTTP 503')).toBe(true);

    // Telegram SRE alert dispatched
    const tgOut = result.nodeOutputs.get('node_telegram') as { ok: boolean; result: { text: string } };
    expect(tgOut.ok).toBe(true);
    expect(tgOut.result.text.includes('CRITICAL OUTAGE')).toBe(true);

    const sentTg = mockServiceRouter.getSentTelegramMessages();
    expect(sentTg.length).toBe(1);
    expect(sentTg[0].chatId).toBe('@sre_oncall');
  });
});
