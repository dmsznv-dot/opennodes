/**
 * LocalFlow E2E Test Suite - Tier 4: Scenario 5 - Lead Enrichment & Multi-Channel CRM Pipeline
 * Full Real-World Application Scenario:
 * Inbound Webhook -> Postgres Duplicate Check -> OpenAI Lead Scoring -> JSON Parse -> IF (VIP / Standard) -> Multi-Channel Alert & SMTP
 */

import { describe, it, expect, beforeEach } from '../harness/index.ts';
import { WorkflowRunner } from '../harness/workflow-runner.ts';
import { InMemoryDatabase } from '../harness/db-mock.ts';
import { mockServiceRouter } from '../harness/msw-handlers.ts';
import type { WorkflowDefinition } from '../harness/types.ts';

describe('Tier 4: Scenario 5 - Inbound Lead Enrichment & Multi-Channel Routing', () => {
  const runner = new WorkflowRunner();
  let db: InMemoryDatabase;

  beforeEach(() => {
    db = new InMemoryDatabase();
    mockServiceRouter.reset();
  });

  it('S5-1: should ingest inbound lead, classify value with OpenAI, and route VIP lead to Telegram & Executive Welcome Email', async () => {
    const workflow: WorkflowDefinition = {
      id: 'wf_scenario_lead_crm',
      workspaceId: 'ws_prod_scenarios',
      name: 'Autonomous Lead Enrichment & Smart CRM Dispatcher',
      version: 1,
      nodes: [
        {
          id: 'node_webhook',
          type: 'trigger.webhook',
          name: 'Inbound Contact Form',
          position: { x: 0, y: 0 },
          data: { config: { path: '/crm/lead' } }
        },
        {
          id: 'node_sql_check',
          type: 'core.postgresSql',
          name: 'Check Lead Exists in Database',
          position: { x: 200, y: 0 },
          data: {
            config: {
              query: 'SELECT * FROM users'
            }
          }
        },
        {
          id: 'node_openai_score',
          type: 'ai.openai',
          name: 'Score Lead Quality with GPT-4',
          position: { x: 400, y: 0 },
          data: {
            config: {
              apiKey: 'sk-crm-openai-key',
              model: 'gpt-4o-mini',
              messages: [
                { role: 'system', content: 'Score this enterprise sales lead from 0 to 100. Output JSON.' },
                { role: 'user', content: 'Lead Company: {{ $trigger.company }}, Employees: {{ $trigger.employees }}. Return json' }
              ],
              responseFormat: { type: 'json_object' }
            }
          }
        },
        {
          id: 'node_json',
          type: 'core.jsonTransform',
          name: 'Parse Lead Score JSON',
          position: { x: 600, y: 0 },
          data: {
            config: {
              mode: 'parse',
              data: '{{ $nodes.node_openai_score.output.choices[0].message.content }}'
            }
          }
        },
        {
          id: 'node_if_vip',
          type: 'primitive.if',
          name: 'Is VIP Enterprise Lead',
          position: { x: 800, y: 0 },
          data: {
            config: {
              condition: '{{ $nodes.node_json.output.confidence > 0.8 }}'
            }
          }
        },
        {
          id: 'node_telegram_vip',
          type: 'core.telegramBot',
          name: 'Alert VP of Sales Immediately',
          position: { x: 1000, y: -50 },
          data: {
            config: {
              botToken: 'bot123456:SalesAlertBot',
              chatId: '@enterprise_leads',
              text: '💰 <b>VIP INBOUND LEAD</b>: {{ $trigger.company }} ({{ $trigger.contactName }}) - Score: 95/100',
              parseMode: 'HTML'
            }
          }
        },
        {
          id: 'node_smtp_vip',
          type: 'core.smtp',
          name: 'Send CEO Personal Welcome Email',
          position: { x: 1200, y: -50 },
          data: {
            config: {
              from: 'founder@localflow.test',
              to: '{{ $trigger.email }}',
              subject: 'Welcome to LocalFlow, {{ $trigger.contactName }}!',
              text: 'Hi {{ $trigger.contactName }}, I noticed you registered {{ $trigger.company }}. I would love to connect directly.'
            }
          }
        },
        {
          id: 'node_smtp_standard',
          type: 'core.smtp',
          name: 'Send Automated Nurture Email',
          position: { x: 1000, y: 100 },
          data: {
            config: {
              from: 'welcome@localflow.test',
              to: '{{ $trigger.email }}',
              subject: 'Getting started with LocalFlow',
              text: 'Welcome to LocalFlow! Check out our documentation.'
            }
          }
        }
      ],
      edges: [
        { id: 'e1', source: 'node_webhook', target: 'node_sql_check', sourceHandle: 'main', targetHandle: 'main' },
        { id: 'e2', source: 'node_sql_check', target: 'node_openai_score', sourceHandle: 'main', targetHandle: 'main' },
        { id: 'e3', source: 'node_openai_score', target: 'node_json', sourceHandle: 'main', targetHandle: 'main' },
        { id: 'e4', source: 'node_json', target: 'node_if_vip', sourceHandle: 'main', targetHandle: 'main' },
        { id: 'e5', source: 'node_if_vip', target: 'node_telegram_vip', sourceHandle: 'true', targetHandle: 'main' },
        { id: 'e6', source: 'node_telegram_vip', target: 'node_smtp_vip', sourceHandle: 'main', targetHandle: 'main' },
        { id: 'e7', source: 'node_if_vip', target: 'node_smtp_standard', sourceHandle: 'false', targetHandle: 'main' }
      ]
    };

    const leadPayload = {
      company: 'Global Fintech Corp',
      employees: 5000,
      contactName: 'Sarah Connor',
      email: 'sarah@globalfintech.test',
      revenue: '$500M'
    };

    const result = await runner.runWorkflow(workflow, {
      triggerPayload: leadPayload,
      mockDatabase: db
    });

    expect(result.execution.status).toBe('SUCCEEDED');

    // True branch was taken (confidence > 0.8)
    expect(result.skippedNodes.has('node_smtp_standard')).toBe(true);

    // Telegram VIP alert sent
    const tgOut = result.nodeOutputs.get('node_telegram_vip') as { ok: boolean; result: { text: string } };
    expect(tgOut.ok).toBe(true);
    expect(tgOut.result.text.includes('VIP INBOUND LEAD')).toBe(true);

    // Personal CEO email sent
    const smtpOut = result.nodeOutputs.get('node_smtp_vip') as { sent: boolean };
    expect(smtpOut.sent).toBe(true);

    const sentEmails = mockServiceRouter.getSentEmails();
    expect(sentEmails.length).toBe(1);
    expect(sentEmails[0].to).toBe('sarah@globalfintech.test');
    expect(sentEmails[0].from).toBe('founder@localflow.test');
    expect(sentEmails[0].subject).toBe('Welcome to LocalFlow, Sarah Connor!');
  });
});
