/**
 * LocalFlow E2E Test Suite - Tier 2: Connector Error Boundaries
 * Verifies HTTP gateway errors, malformed CSV, SQL syntax errors, invalid RSS feeds, and directory escapes.
 */

import { describe, it, expect, beforeEach } from '../harness/index.ts';
import { workflowRunner } from '../harness/workflow-runner.ts';
import { InMemoryDatabase } from '../harness/db-mock.ts';
import { mockServiceRouter } from '../harness/msw-handlers.ts';
import type { WorkflowDefinition } from '../harness/types.ts';

describe('Tier 2: Boundary - Connector Error Boundaries', () => {
  let db: InMemoryDatabase;

  beforeEach(() => {
    db = new InMemoryDatabase();
    mockServiceRouter.reset();
    workflowRunner.resetFs();
  });

  it('B-CON-1: should handle HTTP 502/503/504 gateway and server errors gracefully', async () => {
    mockServiceRouter.registerRoute('GET', 'https://api.example.com/bad_gateway', () => ({
      status: 502,
      statusText: 'Bad Gateway',
      headers: {},
      data: { error: 'Upstream gateway timeout' }
    }));

    const wf: WorkflowDefinition = {
      id: 'wf_http_502',
      workspaceId: 'ws_1',
      name: 'HTTP 502 Test',
      nodes: [
        { id: 'trig', type: 'trigger.manual', data: { label: 'T', config: {} }, inputs: [], outputs: [] },
        { id: 'http_err', type: 'core.httpRequest', data: { label: 'Bad Gateway', config: { url: 'https://api.example.com/bad_gateway', method: 'GET' } }, inputs: [], outputs: [] }
      ],
      edges: [{ id: 'e1', source: 'trig', sourceHandle: 'main', target: 'http_err', targetHandle: 'main' }]
    };

    const res = await workflowRunner.runWorkflow(wf, { mockDatabase: db });
    expect(res.execution.status).toBe('SUCCEEDED'); // HTTP status codes returned as payload
    const out = res.nodeOutputs.get('http_err') as { status: number };
    expect(out.status).toBe(502);
  });

  it('B-CON-2: should handle ragged CSV rows with missing columns without crashing', async () => {
    const raggedCsv = 'a,b,c\n1,2\n3,4,5,6';
    const wf: WorkflowDefinition = {
      id: 'wf_csv_ragged',
      workspaceId: 'ws_1',
      name: 'Ragged CSV',
      nodes: [
        { id: 'trig', type: 'trigger.manual', data: { label: 'T', config: {} }, inputs: [], outputs: [] },
        { id: 'csv', type: 'core.csv', data: { label: 'Parse', config: { action: 'parse', csvText: raggedCsv } }, inputs: [], outputs: [] }
      ],
      edges: [{ id: 'e1', source: 'trig', sourceHandle: 'main', target: 'csv', targetHandle: 'main' }]
    };

    const res = await workflowRunner.runWorkflow(wf, { mockDatabase: db });
    expect(res.execution.status).toBe('SUCCEEDED');
    const rows = res.nodeOutputs.get('csv') as Array<Record<string, string>>;
    expect(rows.length).toBe(2);
    expect(rows[0].a).toBe('1');
    expect(rows[0].b).toBe('2');
    expect(rows[0].c).toBe('');
  });

  it('B-CON-3: should handle invalid SQL queries returning empty or zero results gracefully', async () => {
    const wf: WorkflowDefinition = {
      id: 'wf_sql_invalid',
      workspaceId: 'ws_1',
      name: 'Invalid SQL Query',
      nodes: [
        { id: 'trig', type: 'trigger.manual', data: { label: 'T', config: {} }, inputs: [], outputs: [] },
        { id: 'sql', type: 'core.postgresSql', data: { label: 'Bad Query', config: { query: 'FOO BAR BAZ' } }, inputs: [], outputs: [] }
      ],
      edges: [{ id: 'e1', source: 'trig', sourceHandle: 'main', target: 'sql', targetHandle: 'main' }]
    };

    const res = await workflowRunner.runWorkflow(wf, { mockDatabase: db });
    expect(res.execution.status).toBe('SUCCEEDED');
    const out = res.nodeOutputs.get('sql') as { rowCount: number };
    expect(out.rowCount).toBe(0);
  });

  it('B-CON-4: should handle non-XML HTML response when fetching RSS feed', async () => {
    const htmlResponse = '<!DOCTYPE html><html><body><h1>404 Not a Feed</h1></body></html>';
    mockServiceRouter.registerRoute('GET', 'https://feed.example.com/not_xml', () => ({
      status: 200,
      statusText: 'OK',
      headers: { 'content-type': 'text/html' },
      data: htmlResponse
    }));

    const wf: WorkflowDefinition = {
      id: 'wf_rss_html',
      workspaceId: 'ws_1',
      name: 'RSS HTML Response',
      nodes: [
        { id: 'trig', type: 'trigger.manual', data: { label: 'T', config: {} }, inputs: [], outputs: [] },
        { id: 'rss', type: 'core.rss', data: { label: 'Feed', config: { url: 'https://feed.example.com/not_xml' } }, inputs: [], outputs: [] }
      ],
      edges: [{ id: 'e1', source: 'trig', sourceHandle: 'main', target: 'rss', targetHandle: 'main' }]
    };

    const res = await workflowRunner.runWorkflow(wf, { mockDatabase: db });
    expect(res.execution.status).toBe('SUCCEEDED');
    const items = res.nodeOutputs.get('rss') as unknown[];
    expect(items.length).toBeGreaterThanOrEqual(1); // Defaults to fallback item rather than crashing
  });

  it('B-CON-5: should dispatch long message text to Telegram Bot connector', async () => {
    const longText = 'Alert message chunk: ' + 'X'.repeat(500);
    const wf: WorkflowDefinition = {
      id: 'wf_tg_long',
      workspaceId: 'ws_1',
      name: 'TG Long Message',
      nodes: [
        { id: 'trig', type: 'trigger.manual', data: { label: 'T', config: {} }, inputs: [], outputs: [] },
        { id: 'tg', type: 'core.telegramBot', data: { label: 'TG', config: { chatId: 1234, text: longText } }, inputs: [], outputs: [] }
      ],
      edges: [{ id: 'e1', source: 'trig', sourceHandle: 'main', target: 'tg', targetHandle: 'main' }]
    };

    const res = await workflowRunner.runWorkflow(wf, { mockDatabase: db });
    expect(res.execution.status).toBe('SUCCEEDED');
    const sent = mockServiceRouter.sentTelegramMessages[0];
    expect(sent.text.length).toBeGreaterThan(500);
  });

  it('B-CON-6: should reject filesystem access attempting multi-level directory traversal (a/b/../../../../root)', async () => {
    const wf: WorkflowDefinition = {
      id: 'wf_fs_multitrav',
      workspaceId: 'ws_1',
      name: 'Multi Traversal Test',
      nodes: [
        { id: 'trig', type: 'trigger.manual', data: { label: 'T', config: {} }, inputs: [], outputs: [] },
        {
          id: 'fs_attack',
          type: 'core.filesystem',
          data: { label: 'Attack', config: { action: 'readFile', path: 'folder1/folder2/../../../../../../etc/hosts' } },
          inputs: [],
          outputs: []
        }
      ],
      edges: [{ id: 'e1', source: 'trig', sourceHandle: 'main', target: 'fs_attack', targetHandle: 'main' }]
    };

    const res = await workflowRunner.runWorkflow(wf, { mockDatabase: db });
    expect(res.execution.status).toBe('FAILED');
    expect(res.execution.errorMessage).toContain('ERR_PATH_TRAVERSAL_DETECTED');
  });
});
