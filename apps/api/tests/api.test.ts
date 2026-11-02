import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import { LocalFlowApiServer } from '../src/index.js';

describe('@localflow/api — Control Plane REST API, RBAC, Versioning, Vault & Webhooks', () => {
  it('1. serves /health/live and /health/ready endpoints', async () => {
    const api = new LocalFlowApiServer();
    const live = await api.inject<{ status: string }>({ method: 'GET', url: '/health/live' });
    expect(live.statusCode).toBe(200);
    expect(live.body.status).toBe('ok');

    const ready = await api.inject<{ status: string; bootstrapped: boolean }>({
      method: 'GET',
      url: '/health/ready',
    });
    expect(ready.statusCode).toBe(200);
    expect(ready.body.status).toBe('ready');
    expect(ready.body.bootstrapped).toBe(false);
  });

  it('2. bootstraps initial Owner account & workspace on /api/v1/setup and locks repeat calls with 409', async () => {
    const api = new LocalFlowApiServer();
    const first = await api.inject<{
      userId: string;
      workspaceId: string;
      role: string;
      token: string;
    }>({
      method: 'POST',
      url: '/api/v1/setup',
      body: {
        email: 'owner@localflow.dev',
        password: 'StrongPassword123!',
        workspaceName: 'Acme Automation',
      },
    });
    expect(first.statusCode).toBe(201);
    expect(first.body.role).toBe('OWNER');
    expect(first.body.token).toBeTruthy();

    const second = await api.inject<{ code: string }>({
      method: 'POST',
      url: '/api/v1/setup',
      body: {
        email: 'attacker@localflow.dev',
        password: 'StrongPassword123!',
      },
    });
    expect(second.statusCode).toBe(409);
    expect(second.body.code).toBe('ERR_ALREADY_BOOTSTRAPPED');
  });

  it('3. enforces 4-role RBAC (Owner, Admin, Editor, Viewer) across workflow & credential endpoints', async () => {
    const api = new LocalFlowApiServer();
    const setup = await api.inject<{ workspaceId: string; token: string }>({
      method: 'POST',
      url: '/api/v1/setup',
      body: { email: 'owner@localflow.dev', password: 'StrongPassword123!' },
    });
    const { workspaceId } = setup.body;

    const viewer = await api.createTestUser('viewer@localflow.dev', 'ViewerPass123!');
    api.grantWorkspaceRole(workspaceId, viewer.userId, 'VIEWER');

    // Viewer can list workflows (200)
    const viewRes = await api.inject({
      method: 'GET',
      url: `/api/v1/workspaces/${workspaceId}/workflows`,
      headers: { Authorization: `Bearer ${viewer.token}` },
    });
    expect(viewRes.statusCode).toBe(200);

    // Viewer cannot create workflows (403)
    const createRes = await api.inject<{ code: string }>({
      method: 'POST',
      url: `/api/v1/workspaces/${workspaceId}/workflows`,
      headers: { Authorization: `Bearer ${viewer.token}` },
      body: { name: 'Unauthorized Workflow' },
    });
    expect(createRes.statusCode).toBe(403);
    expect(createRes.body.code).toBe('ERR_FORBIDDEN');
  });

  it('4. encrypts credentials at rest with AES-256-GCM and never returns plaintext secrets', async () => {
    const api = new LocalFlowApiServer();
    const setup = await api.inject<{ workspaceId: string; token: string }>({
      method: 'POST',
      url: '/api/v1/setup',
      body: { email: 'owner@localflow.dev', password: 'StrongPassword123!' },
    });
    const { workspaceId, token } = setup.body;

    const rawSecret = 'sk-live-super-secret-token-9999';
    const created = await api.inject<{
      id: string;
      maskedHint: string;
      secrets?: unknown;
    }>({
      method: 'POST',
      url: `/api/v1/workspaces/${workspaceId}/credentials`,
      headers: { Authorization: `Bearer ${token}` },
      body: {
        name: 'OpenAI Production Key',
        type: 'ai.openai',
        secrets: { apiKey: rawSecret },
      },
    });

    expect(created.statusCode).toBe(201);
    expect(created.body.secrets).toBeUndefined();
    expect(created.rawBody).not.toContain(rawSecret);
    expect(created.body.maskedHint).toContain('9999');

    const rawEncrypted = api.getRawEncryptedCredential(created.body.id);
    expect(rawEncrypted).toBeDefined();
    expect(rawEncrypted!.ciphertext).not.toContain(rawSecret);
  });

  it('5. isolates Draft edits from Published immutable versions, blocks cyclic graphs on publish, and executes with SSE events', async () => {
    const api = new LocalFlowApiServer();
    const setup = await api.inject<{ workspaceId: string; token: string }>({
      method: 'POST',
      url: '/api/v1/setup',
      body: { email: 'owner@localflow.dev', password: 'StrongPassword123!' },
    });
    const { workspaceId, token } = setup.body;

    const validNodes = [
      {
        id: 'trig_1',
        type: 'trigger.manual',
        data: { label: 'Manual Start', config: {} },
        position: { x: 0, y: 0 },
        inputs: [],
        outputs: [{ id: 'out', name: 'Output', type: 'json' as const, direction: 'output' as const, required: false }],
      },
      {
        id: 'map_1',
        type: 'primitive.map',
        data: { label: 'Transform Payload', config: { mapping: { greeting: '{{ $trigger.name }}' } } },
        position: { x: 240, y: 0 },
        inputs: [{ id: 'in', name: 'Input', type: 'any' as const, direction: 'input' as const, required: false }],
        outputs: [{ id: 'out', name: 'Output', type: 'any' as const, direction: 'output' as const, required: false }],
      },
    ];
    const validEdges = [
      {
        id: 'e1',
        source: 'trig_1',
        sourceHandle: 'out',
        target: 'map_1',
        targetHandle: 'in',
      },
    ];

    const wfRes = await api.inject<{ id: string }>({
      method: 'POST',
      url: `/api/v1/workspaces/${workspaceId}/workflows`,
      headers: { Authorization: `Bearer ${token}` },
      body: {
        name: 'Customer Onboarding Flow',
        webhookSecret: 'whsec_test_secret',
        nodes: validNodes,
        edges: validEdges,
      },
    });
    const workflowId = wfRes.body.id;

    // Publish v1
    const pub1 = await api.inject<{ version: number; checksum: string }>({
      method: 'POST',
      url: `/api/v1/workflows/${workflowId}/publish`,
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(pub1.statusCode).toBe(201);
    expect(pub1.body.version).toBe(1);
    expect(pub1.body.checksum).toHaveLength(64);

    // Mutate draft to introduce a cycle — active v1 must remain intact
    await api.inject({
      method: 'PUT',
      url: `/api/v1/workflows/${workflowId}/draft`,
      headers: { Authorization: `Bearer ${token}` },
      body: {
        nodes: [
          ...validNodes,
          {
            id: 'map_2',
            type: 'primitive.map',
            data: { label: 'Loop Node', config: {} },
            position: { x: 480, y: 0 },
            inputs: [{ id: 'in', name: 'In', type: 'any', direction: 'input', required: false }],
            outputs: [{ id: 'out', name: 'Out', type: 'any', direction: 'output', required: false }],
          },
        ],
        edges: [
          ...validEdges,
          { id: 'e2', source: 'map_1', sourceHandle: 'out', target: 'map_2', targetHandle: 'in' },
          { id: 'e3', source: 'map_2', sourceHandle: 'out', target: 'map_1', targetHandle: 'in' },
        ],
      },
    });

    // Attempting to publish cyclic draft fails with 422 ERR_CYCLIC_DEPENDENCY_DETECTED
    const badPub = await api.inject<{ code: string }>({
      method: 'POST',
      url: `/api/v1/workflows/${workflowId}/publish`,
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(badPub.statusCode).toBe(422);
    expect(badPub.body.code).toBe('ERR_CYCLIC_DEPENDENCY_DETECTED');

    // Executing workflow still runs immutable v1 and succeeds!
    const execRes = await api.inject<{
      execution: { id: string; status: string };
      steps: Array<{ nodeId: string; status: string; outputData: Record<string, unknown> }>;
    }>({
      method: 'POST',
      url: `/api/v1/workflows/${workflowId}/execute`,
      headers: { Authorization: `Bearer ${token}` },
      body: { payload: { name: 'Alice' } },
    });
    expect(execRes.statusCode).toBe(200);
    expect(execRes.body.execution.status).toBe('SUCCEEDED');

    // Verify SSE event stream
    const sseRes = await api.inject<string>({
      method: 'GET',
      url: `/api/v1/executions/${execRes.body.execution.id}/events`,
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(sseRes.statusCode).toBe(200);
    expect(sseRes.headers['content-type']).toBe('text/event-stream');
    expect(sseRes.rawBody).toContain('event: execution.started');
    expect(sseRes.rawBody).toContain('event: execution.succeeded');

    // Verify Webhook HMAC + Idempotency deduplication
    const webhookBody = { name: 'WebhookUser' };
    const rawJson = JSON.stringify(webhookBody);
    const hmac =
      'sha256=' + crypto.createHmac('sha256', 'whsec_test_secret').update(rawJson).digest('hex');

    const wh1 = await api.inject<{ executionId: string; deduplicated: boolean }>({
      method: 'POST',
      url: `/api/v1/webhooks/${workflowId}`,
      headers: {
        'x-hub-signature-256': hmac,
        'x-idempotency-key': 'idem-key-001',
      },
      body: webhookBody,
    });
    expect(wh1.statusCode).toBe(202);
    expect(wh1.body.deduplicated).toBe(false);

    const wh2 = await api.inject<{ executionId: string; deduplicated: boolean }>({
      method: 'POST',
      url: `/api/v1/webhooks/${workflowId}`,
      headers: {
        'x-hub-signature-256': hmac,
        'x-idempotency-key': 'idem-key-001',
      },
      body: webhookBody,
    });
    expect(wh2.statusCode).toBe(200);
    expect(wh2.body.deduplicated).toBe(true);
    expect(wh2.body.executionId).toBe(wh1.body.executionId);
  });
});
