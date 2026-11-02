/**
 * LocalFlow E2E Test Suite - Tier 3: AI Pipeline Combinations
 * Exercises pairwise & chain combinations between triggers, AI connectors (OpenAI, Ollama),
 * transformation primitives, and notification sinks (Telegram, SMTP, Database).
 */

import { describe, it, expect, beforeEach } from '../harness/index.ts';
import { WorkflowRunner } from '../harness/workflow-runner.ts';
import { InMemoryDatabase } from '../harness/db-mock.ts';
import { mockServiceRouter } from '../harness/msw-handlers.ts';
import { redactionService } from '../harness/security-harness.ts';
import type { WorkflowDefinition } from '../harness/types.ts';

describe('Tier 3: Combination - AI Pipeline Combinations', () => {
  const runner = new WorkflowRunner();
  let db: InMemoryDatabase;

  beforeEach(() => {
    db = new InMemoryDatabase();
    mockServiceRouter.reset();
  });

  it('T3-AI-1: Webhook customer inquiry -> OpenAI LLM summarization -> JSON Transform -> Telegram Bot notification', async () => {
    const workflow: WorkflowDefinition = {
      id: 'wf_t3_ai_1',
      workspaceId: 'ws_tier3',
      name: 'Customer Support AI Summarizer & Telegram Alert',
      version: 1,
      nodes: [
        {
          id: 'node_webhook',
          type: 'trigger.webhook',
          name: 'Inbound Customer Ticket',
          position: { x: 0, y: 0 },
          data: { config: { path: '/support/ticket' } }
        },
        {
          id: 'node_openai',
          type: 'ai.openai',
          name: 'Analyze Sentiment & Summarize',
          position: { x: 150, y: 0 },
          data: {
            config: {
              apiKey: 'sk-test-mock-key',
              model: 'gpt-4o-mini',
              messages: [
                { role: 'system', content: 'You are a customer support triage assistant. Output JSON.' },
                { role: 'user', content: 'Customer issue: {{ $trigger.message }}. Please return json' }
              ],
              responseFormat: { type: 'json_object' }
            }
          }
        },
        {
          id: 'node_json',
          type: 'core.jsonTransform',
          name: 'Parse AI JSON Response',
          position: { x: 300, y: 0 },
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
          name: 'Notify On-Call Channel',
          position: { x: 450, y: 0 },
          data: {
            config: {
              botToken: 'bot123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11',
              chatId: '@support_alerts',
              text: 'New Ticket ({{ $nodes.node_json.output.sentiment }}): {{ $nodes.node_json.output.summary }}'
            }
          }
        }
      ],
      edges: [
        { id: 'e1', source: 'node_webhook', target: 'node_openai', sourceHandle: 'main', targetHandle: 'main' },
        { id: 'e2', source: 'node_openai', target: 'node_json', sourceHandle: 'main', targetHandle: 'main' },
        { id: 'e3', source: 'node_json', target: 'node_telegram', sourceHandle: 'main', targetHandle: 'main' }
      ]
    };

    const triggerPayload = {
      ticketId: 'TCK-552',
      customer: 'Alice',
      message: 'Payment failed at checkout with error 402 card declined'
    };

    const result = await runner.runWorkflow(workflow, { triggerPayload, mockDatabase: db });
    expect(result.execution.status).toBe('SUCCEEDED');

    const openAiOut = result.nodeOutputs.get('node_openai') as { status: number; choices: any[] };
    expect(openAiOut.status).toBe(200);
    expect(openAiOut.choices.length).toBeGreaterThan(0);

    const jsonOut = result.nodeOutputs.get('node_json') as { status: string; sentiment: string; summary: string };
    expect(jsonOut.status).toBe('success');
    expect(jsonOut.sentiment).toBe('positive');

    const tgOut = result.nodeOutputs.get('node_telegram') as { ok: boolean; result: { text: string } };
    expect(tgOut.ok).toBe(true);
    expect(tgOut.result.text.includes('New Ticket (positive):')).toBe(true);
  });

  it('T3-AI-2: Webhook -> Ollama local model inference -> JSON extract -> Postgres audit record', async () => {
    const workflow: WorkflowDefinition = {
      id: 'wf_t3_ai_2',
      workspaceId: 'ws_tier3',
      name: 'Local Ollama Classification to Database',
      version: 1,
      nodes: [
        {
          id: 'node_webhook',
          type: 'trigger.webhook',
          name: 'Incoming Document',
          position: { x: 0, y: 0 },
          data: { config: {} }
        },
        {
          id: 'node_ollama',
          type: 'ai.ollama',
          name: 'Classify with Llama3',
          position: { x: 150, y: 0 },
          data: {
            config: {
              baseUrl: 'http://localhost:11434',
              model: 'llama3:8b',
              prompt: 'Classify category for: {{ $trigger.documentTitle }}'
            }
          }
        },
        {
          id: 'node_sql',
          type: 'core.postgresSql',
          name: 'Store Inference Audit',
          position: { x: 300, y: 0 },
          data: {
            config: {
              query: 'INSERT INTO audit_logs (action, details) VALUES ($1, $2)',
              params: ['AI_CLASSIFICATION', '{{ $nodes.node_ollama.output.response }}']
            }
          }
        }
      ],
      edges: [
        { id: 'e1', source: 'node_webhook', target: 'node_ollama', sourceHandle: 'main', targetHandle: 'main' },
        { id: 'e2', source: 'node_ollama', target: 'node_sql', sourceHandle: 'main', targetHandle: 'main' }
      ]
    };

    const payload = { documentTitle: 'Q3 Financial Earnings Report' };
    const result = await runner.runWorkflow(workflow, { triggerPayload: payload, mockDatabase: db });

    expect(result.execution.status).toBe('SUCCEEDED');
    const ollamaOut = result.nodeOutputs.get('node_ollama') as { model: string; response: string; done: boolean };
    expect(ollamaOut.done).toBe(true);
    expect(ollamaOut.response.includes('Q3 Financial Earnings Report')).toBe(true);

    const sqlOut = result.nodeOutputs.get('node_sql') as { rowCount: number };
    expect(sqlOut.rowCount).toBe(1);
  });

  it('T3-AI-3: Redaction in AI pipeline: sensitive tokens in trigger are redacted before logging to DB', async () => {
    const sensitivePayload = {
      user: 'admin',
      apiKey: 'sk-prod-999888777sensitive',
      passwordHash: 'secret-hash-1234',
      prompt: 'Check system configuration status'
    };

    // Redaction service should cleanse sensitive keys
    const cleansed = redactionService.redact(sensitivePayload) as Record<string, unknown>;
    expect(cleansed.apiKey).toBe('[REDACTED]');
    expect(cleansed.passwordHash).toBe('[REDACTED]');
    expect(cleansed.user).toBe('admin');

    const workflow: WorkflowDefinition = {
      id: 'wf_t3_ai_3',
      workspaceId: 'ws_tier3',
      name: 'Safe Redacted AI Pipeline',
      version: 1,
      nodes: [
        {
          id: 'node_trigger',
          type: 'trigger.manual',
          name: 'Manual Run',
          position: { x: 0, y: 0 },
          data: { config: {} }
        },
        {
          id: 'node_openai',
          type: 'ai.openai',
          name: 'Execute Safe Prompt',
          position: { x: 150, y: 0 },
          data: {
            config: {
              apiKey: 'sk-test-mock-key',
              model: 'gpt-4o-mini',
              messages: [{ role: 'user', content: '{{ $trigger.prompt }}' }]
            }
          }
        }
      ],
      edges: [{ id: 'e1', source: 'node_trigger', target: 'node_openai', sourceHandle: 'main', targetHandle: 'main' }]
    };

    const result = await runner.runWorkflow(workflow, {
      triggerPayload: sensitivePayload,
      mockDatabase: db
    });

    expect(result.execution.status).toBe('SUCCEEDED');
    // Verify stored execution payload in DB is redacted
    const execInDb = db.executions.get(result.execution.id)!;
    const dbPayload = execInDb.trigger_payload as Record<string, unknown>;
    expect(dbPayload.apiKey).toBe('[REDACTED]');
    expect(dbPayload.passwordHash).toBe('[REDACTED]');
  });

  it('T3-AI-4: Multi-stage AI reasoning: Webhook -> First LLM prompt -> Second LLM critique -> SMTP dispatch', async () => {
    const workflow: WorkflowDefinition = {
      id: 'wf_t3_ai_4',
      workspaceId: 'ws_tier3',
      name: 'Multi-stage AI Generation & Critique',
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
          id: 'node_llm_draft',
          type: 'ai.openai',
          name: 'Draft Email',
          position: { x: 150, y: 0 },
          data: {
            config: {
              apiKey: 'sk-test-key',
              model: 'gpt-4o-mini',
              messages: [
                { role: 'user', content: 'Write a draft update for: {{ $trigger.topic }}' }
              ]
            }
          }
        },
        {
          id: 'node_llm_critique',
          type: 'ai.openai',
          name: 'Critique & Refine',
          position: { x: 300, y: 0 },
          data: {
            config: {
              apiKey: 'sk-test-key',
              model: 'gpt-4o',
              messages: [
                { role: 'system', content: 'Review and improve the draft for conciseness.' },
                { role: 'user', content: 'Draft to refine: {{ $nodes.node_llm_draft.output.choices[0].message.content }}' }
              ]
            }
          }
        },
        {
          id: 'node_smtp',
          type: 'core.smtp',
          name: 'Send Polished Email',
          position: { x: 450, y: 0 },
          data: {
            config: {
              from: 'ai-assistant@company.test',
              to: 'team@company.test',
              subject: 'Polished Update: {{ $trigger.topic }}',
              text: '{{ $nodes.node_llm_critique.output.choices[0].message.content }}'
            }
          }
        }
      ],
      edges: [
        { id: 'e1', source: 'node_trigger', target: 'node_llm_draft', sourceHandle: 'main', targetHandle: 'main' },
        { id: 'e2', source: 'node_llm_draft', target: 'node_llm_critique', sourceHandle: 'main', targetHandle: 'main' },
        { id: 'e3', source: 'node_llm_critique', target: 'node_smtp', sourceHandle: 'main', targetHandle: 'main' }
      ]
    };

    const result = await runner.runWorkflow(workflow, {
      triggerPayload: { topic: 'Sprint 42 Achievements' },
      mockDatabase: db
    });

    expect(result.execution.status).toBe('SUCCEEDED');
    expect(result.stepRecords.length).toBe(4);

    const critiqueOut = result.nodeOutputs.get('node_llm_critique') as { choices: any[] };
    expect(critiqueOut.choices.length).toBeGreaterThan(0);

    const smtpOut = result.nodeOutputs.get('node_smtp') as { sent: boolean; messageId: string };
    expect(smtpOut.sent).toBe(true);
  });

  it('T3-AI-5: Dynamic temperature and prompt templating from Webhook metadata', async () => {
    const workflow: WorkflowDefinition = {
      id: 'wf_t3_ai_5',
      workspaceId: 'ws_tier3',
      name: 'Dynamic Prompt Templating',
      version: 1,
      nodes: [
        {
          id: 'node_trigger',
          type: 'trigger.webhook',
          name: 'Webhook Event',
          position: { x: 0, y: 0 },
          data: { config: {} }
        },
        {
          id: 'node_openai',
          type: 'ai.openai',
          name: 'OpenAI Call',
          position: { x: 150, y: 0 },
          data: {
            config: {
              apiKey: 'sk-test-key',
              model: '{{ $trigger.preferredModel }}',
              messages: [
                { role: 'user', content: 'Hello {{ $trigger.author }}, summarize: {{ $trigger.text }}' }
              ]
            }
          }
        }
      ],
      edges: [
        { id: 'e1', source: 'node_trigger', target: 'node_openai', sourceHandle: 'main', targetHandle: 'main' }
      ]
    };

    const triggerPayload = {
      preferredModel: 'gpt-4o',
      author: 'Developer',
      text: 'Release checklist item complete'
    };

    const result = await runner.runWorkflow(workflow, { triggerPayload, mockDatabase: db });
    expect(result.execution.status).toBe('SUCCEEDED');

    const openAiOut = result.nodeOutputs.get('node_openai') as { model: string; choices: any[] };
    expect(openAiOut.model).toBe('gpt-4o');
    expect(openAiOut.choices[0].message.content.includes('Developer')).toBe(true);
  });

  it('T3-AI-6: AI classification branching: Webhook -> OpenAI -> IF (URGENT / ROUTINE) -> Telegram for Urgent', async () => {
    const workflow: WorkflowDefinition = {
      id: 'wf_t3_ai_6',
      workspaceId: 'ws_tier3',
      name: 'AI Priority Classifier & Smart Route',
      version: 1,
      nodes: [
        {
          id: 'node_trigger',
          type: 'trigger.webhook',
          name: 'Incoming Ticket',
          position: { x: 0, y: 0 },
          data: { config: {} }
        },
        {
          id: 'node_openai',
          type: 'ai.openai',
          name: 'Classify Priority',
          position: { x: 150, y: 0 },
          data: {
            config: {
              apiKey: 'sk-test-key',
              model: 'gpt-4o-mini',
              messages: [{ role: 'user', content: 'Is this issue URGENT? Return json' }],
              responseFormat: { type: 'json_object' }
            }
          }
        },
        {
          id: 'node_json',
          type: 'core.jsonTransform',
          name: 'Parse Classification',
          position: { x: 300, y: 0 },
          data: {
            config: {
              mode: 'parse',
              data: '{{ $nodes.node_openai.output.choices[0].message.content }}'
            }
          }
        },
        {
          id: 'node_if',
          type: 'primitive.if',
          name: 'Is Urgent Priority',
          position: { x: 450, y: 0 },
          data: {
            config: {
              condition: '{{ $nodes.node_json.output.status === "success" }}'
            }
          }
        },
        {
          id: 'node_tg_urgent',
          type: 'core.telegramBot',
          name: 'Telegram Urgent Alert',
          position: { x: 600, y: -50 },
          data: {
            config: {
              botToken: 'bot123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11',
              chatId: '12345678',
              text: 'URGENT Alert: {{ $nodes.node_json.output.summary }}'
            }
          }
        },
        {
          id: 'node_sql_routine',
          type: 'core.postgresSql',
          name: 'Store Routine Record',
          position: { x: 600, y: 50 },
          data: {
            config: {
              query: 'INSERT INTO routine_queue (summary) VALUES ($1)',
              params: ['{{ $nodes.node_json.output.summary }}']
            }
          }
        }
      ],
      edges: [
        { id: 'e1', source: 'node_trigger', target: 'node_openai', sourceHandle: 'main', targetHandle: 'main' },
        { id: 'e2', source: 'node_openai', target: 'node_json', sourceHandle: 'main', targetHandle: 'main' },
        { id: 'e3', source: 'node_json', target: 'node_if', sourceHandle: 'main', targetHandle: 'main' },
        { id: 'e4', source: 'node_if', target: 'node_tg_urgent', sourceHandle: 'true', targetHandle: 'main' },
        { id: 'e5', source: 'node_if', target: 'node_sql_routine', sourceHandle: 'false', targetHandle: 'main' }
      ]
    };

    const result = await runner.runWorkflow(workflow, {
      triggerPayload: { incident: 'Production database latency spike' },
      mockDatabase: db
    });

    expect(result.execution.status).toBe('SUCCEEDED');
    expect(result.skippedNodes.has('node_sql_routine')).toBe(true);

    const tgOut = result.nodeOutputs.get('node_tg_urgent') as { ok: boolean; result: { text: string } };
    expect(tgOut.ok).toBe(true);
    expect(tgOut.result.text.includes('URGENT Alert:')).toBe(true);
  });
});
