/**
 * LocalFlow E2E Test Suite - Tier 4: Scenario 1 - RSS to Telegram Intelligence Bot
 * Full Real-World Application Scenario:
 * Scheduled RSS Feed Reader -> Keyword Filter -> OpenAI Summarizer -> Telegram Channel Broadcast
 */

import { describe, it, expect, beforeEach } from '../harness/index.ts';
import { WorkflowRunner } from '../harness/workflow-runner.ts';
import { InMemoryDatabase } from '../harness/db-mock.ts';
import { mockServiceRouter } from '../harness/msw-handlers.ts';
import type { WorkflowDefinition } from '../harness/types.ts';

describe('Tier 4: Scenario 1 - RSS Feed to Telegram Intelligence Bot', () => {
  const runner = new WorkflowRunner();
  let db: InMemoryDatabase;

  beforeEach(() => {
    db = new InMemoryDatabase();
    mockServiceRouter.reset();
  });

  it('S1-1: should periodically fetch RSS articles, filter tech keywords, summarize with OpenAI, and post to Telegram', async () => {
    const workflow: WorkflowDefinition = {
      id: 'wf_scenario_rss_telegram',
      workspaceId: 'ws_prod_scenarios',
      name: 'RSS Tech News Intelligence Digest',
      version: 1,
      nodes: [
        {
          id: 'node_cron',
          type: 'trigger.cron',
          name: 'Morning Digest Schedule',
          position: { x: 0, y: 100 },
          data: { config: { cron: '0 8 * * *', timezone: 'UTC' } }
        },
        {
          id: 'node_rss',
          type: 'core.rss',
          name: 'Fetch Tech Feed',
          position: { x: 200, y: 100 },
          data: {
            config: {
              url: 'https://news.ycombinator.com/rss'
            }
          }
        },
        {
          id: 'node_filter',
          type: 'primitive.filter',
          name: 'Filter LocalFlow Topics',
          position: { x: 400, y: 100 },
          data: {
            config: {
              items: '{{ $nodes.node_rss.output }}',
              predicate: '{{ $item.title.includes("LocalFlow") || $item.description.includes("platform") }}'
            }
          }
        },
        {
          id: 'node_openai',
          type: 'ai.openai',
          name: 'OpenAI Executive Summary',
          position: { x: 600, y: 100 },
          data: {
            config: {
              apiKey: 'sk-mock-openai-key',
              model: 'gpt-4o-mini',
              messages: [
                { role: 'system', content: 'Generate a short newsletter digest for the article. Return json.' },
                { role: 'user', content: 'Summarize: {{ $nodes.node_filter.output.passed[0].title }} - {{ $nodes.node_filter.output.passed[0].description }}' }
              ],
              responseFormat: { type: 'json_object' }
            }
          }
        },
        {
          id: 'node_json',
          type: 'core.jsonTransform',
          name: 'Parse AI Digest JSON',
          position: { x: 800, y: 100 },
          data: {
            config: {
              mode: 'parse',
              data: '{{ $nodes.node_openai.output.choices[0].message.content }}'
            }
          }
        },
        {
          id: 'node_telegram',
          type: 'core.telegramBot',
          name: 'Broadcast to Telegram Channel',
          position: { x: 1000, y: 100 },
          data: {
            config: {
              botToken: 'bot987654:XYZ-DigestBotToken123',
              chatId: '@tech_digest_feed',
              text: '🚨 <b>Tech Digest</b>: {{ $nodes.node_json.output.summary }}\nSentiment: {{ $nodes.node_json.output.sentiment }}',
              parseMode: 'HTML'
            }
          }
        }
      ],
      edges: [
        { id: 'e1', source: 'node_cron', target: 'node_rss', sourceHandle: 'main', targetHandle: 'main' },
        { id: 'e2', source: 'node_rss', target: 'node_filter', sourceHandle: 'main', targetHandle: 'main' },
        { id: 'e3', source: 'node_filter', target: 'node_openai', sourceHandle: 'passed', targetHandle: 'main' },
        { id: 'e4', source: 'node_openai', target: 'node_json', sourceHandle: 'main', targetHandle: 'main' },
        { id: 'e5', source: 'node_json', target: 'node_telegram', sourceHandle: 'main', targetHandle: 'main' }
      ]
    };

    const result = await runner.runWorkflow(workflow, { mockDatabase: db });

    // Assert full pipeline completion
    expect(result.execution.status).toBe('SUCCEEDED');
    expect(result.stepRecords.length).toBe(6);

    // Verify filter matched articles
    const filterOut = result.nodeOutputs.get('node_filter') as { count: number; passed: any[] };
    expect(filterOut.count).toBeGreaterThan(0);
    expect(filterOut.passed[0].title).toBe('LocalFlow v1.0 Released');

    // Verify OpenAI structured output
    const jsonOut = result.nodeOutputs.get('node_json') as { status: string; summary: string; sentiment: string };
    expect(jsonOut.status).toBe('success');
    expect(jsonOut.sentiment).toBe('positive');

    // Verify Telegram post
    const tgOut = result.nodeOutputs.get('node_telegram') as { ok: boolean; result: { chat: { id: string }; text: string } };
    expect(tgOut.ok).toBe(true);
    expect(tgOut.result.chat.id).toBe('@tech_digest_feed');
    expect(tgOut.result.text.includes('Tech Digest')).toBe(true);

    // Verify step execution journaling in DB
    const stepLogs = db.findNodeExecutions(result.execution.id);
    expect(stepLogs.length).toBe(6);
    expect(stepLogs.every(s => s.status === 'SUCCEEDED')).toBe(true);
  });
});
