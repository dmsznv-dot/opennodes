/**
 * LocalFlow E2E Test Suite - Tier 4: Scenario 2 - Stripe Webhook to SQL & Customer Receipt
 * Full Real-World Application Scenario:
 * Payment Webhook -> Event Verification -> Database Ledger Record -> Customer Receipt Email
 */

import { describe, it, expect, beforeEach } from '../harness/index.ts';
import { WorkflowRunner } from '../harness/workflow-runner.ts';
import { InMemoryDatabase } from '../harness/db-mock.ts';
import { mockServiceRouter } from '../harness/msw-handlers.ts';
import type { WorkflowDefinition } from '../harness/types.ts';

describe('Tier 4: Scenario 2 - Webhook Payment to SQL Ledger & Receipt Email', () => {
  const runner = new WorkflowRunner();
  let db: InMemoryDatabase;

  beforeEach(() => {
    db = new InMemoryDatabase();
    mockServiceRouter.reset();
  });

  it('S2-1: should process Stripe charge.succeeded webhook, record transaction to Postgres, and send customer receipt email', async () => {
    const workflow: WorkflowDefinition = {
      id: 'wf_scenario_payment_ledger',
      workspaceId: 'ws_prod_scenarios',
      name: 'Stripe Payment Processor & Receipt Dispatcher',
      version: 1,
      nodes: [
        {
          id: 'node_webhook',
          type: 'trigger.webhook',
          name: 'Stripe Webhook Listener',
          position: { x: 0, y: 0 },
          data: { config: { path: '/webhooks/stripe' } }
        },
        {
          id: 'node_if',
          type: 'primitive.if',
          name: 'Is Payment Succeeded',
          position: { x: 200, y: 0 },
          data: {
            config: {
              condition: '{{ $trigger.event === "charge.succeeded" }}'
            }
          }
        },
        {
          id: 'node_sql',
          type: 'core.postgresSql',
          name: 'Insert Ledger Entry',
          position: { x: 400, y: -50 },
          data: {
            config: {
              query: 'INSERT INTO transactions (charge_id, amount, customer_email, currency) VALUES ($1, $2, $3, $4)',
              params: [
                '{{ $trigger.data.id }}',
                '{{ $trigger.data.amount }}',
                '{{ $trigger.data.customerEmail }}',
                '{{ $trigger.data.currency }}'
              ]
            }
          }
        },
        {
          id: 'node_map',
          type: 'primitive.map',
          name: 'Format Customer Receipt',
          position: { x: 600, y: -50 },
          data: {
            config: {
              subject: 'Receipt for your payment of ${{ $trigger.data.amount }} {{ $trigger.data.currency }}',
              recipient: '{{ $trigger.data.customerEmail }}',
              receiptBody: 'Thank you for your business! Your transaction ID is {{ $trigger.data.id }}.'
            }
          }
        },
        {
          id: 'node_smtp',
          type: 'core.smtp',
          name: 'Send Receipt Email',
          position: { x: 800, y: -50 },
          data: {
            config: {
              from: 'billing@localflow.test',
              to: '{{ $nodes.node_map.output.recipient }}',
              subject: '{{ $nodes.node_map.output.subject }}',
              text: '{{ $nodes.node_map.output.receiptBody }}'
            }
          }
        },
        {
          id: 'node_map_ignored',
          type: 'primitive.map',
          name: 'Ignored Non-Charge Event',
          position: { x: 400, y: 100 },
          data: { config: { action: 'ignored' } }
        }
      ],
      edges: [
        { id: 'e1', source: 'node_webhook', target: 'node_if', sourceHandle: 'main', targetHandle: 'main' },
        { id: 'e2', source: 'node_if', target: 'node_sql', sourceHandle: 'true', targetHandle: 'main' },
        { id: 'e3', source: 'node_sql', target: 'node_map', sourceHandle: 'main', targetHandle: 'main' },
        { id: 'e4', source: 'node_map', target: 'node_smtp', sourceHandle: 'main', targetHandle: 'main' },
        { id: 'e5', source: 'node_if', target: 'node_map_ignored', sourceHandle: 'false', targetHandle: 'main' }
      ]
    };

    const stripeWebhookPayload = {
      event: 'charge.succeeded',
      data: {
        id: 'ch_3MvY8m2eZvKYlo2C0VvR79Kk',
        amount: 149.0,
        currency: 'USD',
        customerEmail: 'customer@acme-corp.test',
        livemode: false
      }
    };

    const result = await runner.runWorkflow(workflow, {
      triggerPayload: stripeWebhookPayload,
      mockDatabase: db
    });

    expect(result.execution.status).toBe('SUCCEEDED');
    expect(result.skippedNodes.has('node_map_ignored')).toBe(true);

    // Verify SQL insert
    const sqlOut = result.nodeOutputs.get('node_sql') as { rowCount: number };
    expect(sqlOut.rowCount).toBe(1);

    // Verify formatted map
    const mapOut = result.nodeOutputs.get('node_map') as { recipient: string; subject: string; receiptBody: string };
    expect(mapOut.recipient).toBe('customer@acme-corp.test');
    expect(mapOut.subject).toBe('Receipt for your payment of $149 USD');
    expect(mapOut.receiptBody.includes('ch_3MvY8m2eZvKYlo2C0VvR79Kk')).toBe(true);

    // Verify Email sent
    const smtpOut = result.nodeOutputs.get('node_smtp') as { sent: boolean; messageId: string };
    expect(smtpOut.sent).toBe(true);

    const sentEmails = mockServiceRouter.getSentEmails();
    expect(sentEmails.length).toBe(1);
    expect(sentEmails[0].to).toBe('customer@acme-corp.test');
    expect(sentEmails[0].subject).toBe('Receipt for your payment of $149 USD');
  });
});
