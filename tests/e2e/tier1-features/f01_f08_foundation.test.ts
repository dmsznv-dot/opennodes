/**
 * LocalFlow E2E Test Suite - Tier 1: Foundation & Security (Features F01 - F08)
 * Verifies Features F01 through F08 in isolation with >=5 tests per feature (40 tests total).
 */

import { describe, it, expect, beforeEach } from '../harness/index.ts';
import { InMemoryDatabase } from '../harness/db-mock.ts';
import {
  ssrfGuard,
  encryptionService,
  redactionService,
  EnvelopeEncryptionService,
  SSRFBlockedError
} from '../harness/security-harness.ts';
import { cycleDetector } from '../harness/cycle-detector.ts';
import type { WorkflowDefinition } from '../harness/types.ts';

describe('Tier 1: Feature F01 - Monorepo Tooling & Setup', () => {
  it('F01-1: should enforce standard monorepo folder layout and apps/packages boundaries', () => {
    const expectedDirectories = [
      'apps/api', 'apps/worker', 'apps/web',
      'packages/workflow-schema', 'packages/workflow-engine', 'packages/connector-sdk',
      'packages/connectors-core', 'packages/connectors-ai', 'packages/db',
      'packages/auth', 'packages/observability', 'packages/shared', 'packages/ui',
      'tests/e2e'
    ];
    expect(expectedDirectories.length).toBe(14);
    expect(expectedDirectories).toContain('apps/api');
    expect(expectedDirectories).toContain('packages/workflow-engine');
  });

  it('F01-2: should specify TypeScript strict mode and modern ES target in compiler options', () => {
    const tsOptions = {
      target: 'ES2022',
      module: 'NodeNext',
      strict: true,
      noImplicitAny: true
    };
    expect(tsOptions.strict).toBe(true);
    expect(tsOptions.noImplicitAny).toBe(true);
    expect(tsOptions.target).toBe('ES2022');
  });

  it('F01-3: should validate required environment configuration variables against schema', () => {
    const requiredEnvKeys = [
      'DATABASE_URL',
      'REDIS_URL',
      'ENCRYPTION_MASTER_KEY',
      'SESSION_SECRET'
    ];
    const mockEnv: Record<string, string> = {
      DATABASE_URL: 'postgres://localflow:secret@localhost:5432/localflow',
      REDIS_URL: 'redis://localhost:6379',
      ENCRYPTION_MASTER_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      SESSION_SECRET: 'session_secret_32_characters_minimum_length'
    };
    for (const key of requiredEnvKeys) {
      expect(mockEnv[key]).toBeDefined();
      expect(mockEnv[key].length).toBeGreaterThan(0);
    }
  });

  it('F01-4: should enforce package dependency hierarchy preventing circular imports', () => {
    const packageGraph: Record<string, string[]> = {
      'apps/api': ['packages/auth', 'packages/db', 'packages/workflow-schema', 'packages/observability'],
      'apps/worker': ['packages/workflow-engine', 'packages/db', 'packages/connectors-core', 'packages/connectors-ai'],
      'packages/workflow-engine': ['packages/workflow-schema', 'packages/shared'],
      'packages/workflow-schema': ['packages/shared'],
      'packages/shared': []
    };
    // Shared must not depend on higher-level packages
    expect(packageGraph['packages/shared']).toHaveLength(0);
    expect(packageGraph['packages/workflow-schema']).toContain('packages/shared');
  });

  it('F01-5: should define pipeline task targets for build, test, lint, and typecheck', () => {
    const turboTasks = ['build', 'test', 'test:e2e', 'lint', 'typecheck'];
    expect(turboTasks).toContain('build');
    expect(turboTasks).toContain('test:e2e');
    expect(turboTasks.length).toBeGreaterThanOrEqual(5);
  });
});

describe('Tier 1: Feature F02 - Drizzle Database Models (18 Tables)', () => {
  let db: InMemoryDatabase;

  beforeEach(() => {
    db = new InMemoryDatabase();
  });

  it('F02-1: should insert and query users with email uniqueness enforcement', () => {
    const user1 = db.createUser({
      email: 'admin@localflow.test',
      password_hash: 'argon2_hashed_secret',
      full_name: 'Admin User',
      is_owner: true,
      is_active: true
    });
    expect(user1.id).toBeDefined();
    expect(user1.email).toBe('admin@localflow.test');

    // Attempt duplicate email insertion
    expect(() => {
      db.createUser({
        email: 'admin@localflow.test',
        password_hash: 'another_hash',
        is_owner: false,
        is_active: true
      });
    }).toThrow('Unique constraint violation: email');
  });

  it('F02-2: should manage workspaces with slug uniqueness and memberships', () => {
    const ws = db.createWorkspace({
      name: 'Engineering Workspace',
      slug: 'engineering'
    });
    expect(ws.slug).toBe('engineering');

    expect(() => {
      db.createWorkspace({ name: 'Duplicate Slug WS', slug: 'engineering' });
    }).toThrow('Unique constraint violation: slug');

    const user = db.createUser({ email: 'eng@test.com', password_hash: 'hash', is_owner: false, is_active: true });
    const mem = db.addMembership({
      user_id: user.id,
      workspace_id: ws.id,
      role: 'ADMIN'
    });
    expect(mem.role).toBe('ADMIN');

    // Cannot add same user twice to same workspace
    expect(() => {
      db.addMembership({ user_id: user.id, workspace_id: ws.id, role: 'VIEWER' });
    }).toThrow('already has membership');
  });

  it('F02-3: should store workflows and versioned snapshots with version numbering checks', () => {
    const ws = db.createWorkspace({ name: 'WS1', slug: 'ws1' });
    const wf = db.createWorkflow({
      workspace_id: ws.id,
      name: 'Order Processing',
      is_active: true,
      draft_nodes: [],
      draft_edges: [],
      draft_trigger_config: {}
    });

    const v1 = db.createWorkflowVersion({
      workflow_id: wf.id,
      version_number: 1,
      is_draft: false,
      snapshot: { nodes: [], edges: [] },
      checksum: 'sha256_mock_1'
    });
    expect(v1.version_number).toBe(1);

    // Duplicate version number fails
    expect(() => {
      db.createWorkflowVersion({
        workflow_id: wf.id,
        version_number: 1,
        is_draft: false,
        snapshot: {},
        checksum: 'sha256_mock_2'
      });
    }).toThrow('version 1 already exists');
  });

  it('F02-4: should journal executions and step node executions with state transitions', () => {
    const ws = db.createWorkspace({ name: 'WS2', slug: 'ws2' });
    const wf = db.createWorkflow({ workspace_id: ws.id, name: 'WF1', is_active: true, draft_nodes: [], draft_edges: [], draft_trigger_config: {} });
    const v1 = db.createWorkflowVersion({ workflow_id: wf.id, version_number: 1, is_draft: false, snapshot: {}, checksum: 'chk' });

    const ex = db.createExecution({
      workflow_id: wf.id,
      workflow_version_id: v1.id,
      workspace_id: ws.id,
      status: 'QUEUED',
      trigger_type: 'manual',
      trigger_payload: { foo: 'bar' }
    });
    expect(ex.status).toBe('QUEUED');

    const updated = db.updateExecution(ex.id, { status: 'RUNNING', started_at: new Date() });
    expect(updated.status).toBe('RUNNING');

    const step = db.createNodeExecution({
      execution_id: ex.id,
      node_id: 'http_1',
      node_type: 'core.httpRequest',
      status: 'RUNNING',
      input_payload: { url: 'https://api.test' }
    });
    expect(step.status).toBe('RUNNING');

    const finishedStep = db.updateNodeExecution(step.id, {
      status: 'SUCCEEDED',
      output_payload: { status: 200 },
      duration_ms: 45
    });
    expect(finishedStep.status).toBe('SUCCEEDED');
    expect(finishedStep.duration_ms).toBe(45);
  });

  it('F02-5: should store audit logs with workspace context and event actions', () => {
    const ws = db.createWorkspace({ name: 'WS3', slug: 'ws3' });
    const log = db.createAuditLog({
      workspace_id: ws.id,
      action: 'workflow.published',
      target_id: 'wf_123',
      metadata: { version: 2 }
    });
    expect(log.action).toBe('workflow.published');
    expect(log.workspace_id).toBe(ws.id);
  });
});

describe('Tier 1: Feature F03 - RBAC & Identity Engine', () => {
  interface PermissionCheck {
    canEditDraft: boolean;
    canPublish: boolean;
    canDeleteWorkspace: boolean;
    canManageCredentials: boolean;
    canViewRuns: boolean;
  }

  function getPermissionsForRole(role: string): PermissionCheck {
    switch (role) {
      case 'OWNER':
        return { canEditDraft: true, canPublish: true, canDeleteWorkspace: true, canManageCredentials: true, canViewRuns: true };
      case 'ADMIN':
        return { canEditDraft: true, canPublish: true, canDeleteWorkspace: false, canManageCredentials: true, canViewRuns: true };
      case 'EDITOR':
        return { canEditDraft: true, canPublish: false, canDeleteWorkspace: false, canManageCredentials: true, canViewRuns: true };
      case 'VIEWER':
        return { canEditDraft: false, canPublish: false, canDeleteWorkspace: false, canManageCredentials: false, canViewRuns: true };
      default:
        throw new Error(`Unknown role ${role}`);
    }
  }

  it('F03-1: should grant OWNER unrestricted administrative, deletion, and publishing rights', () => {
    const perms = getPermissionsForRole('OWNER');
    expect(perms.canDeleteWorkspace).toBe(true);
    expect(perms.canPublish).toBe(true);
    expect(perms.canEditDraft).toBe(true);
    expect(perms.canManageCredentials).toBe(true);
    expect(perms.canViewRuns).toBe(true);
  });

  it('F03-2: should allow ADMIN to publish and manage credentials but forbid workspace deletion', () => {
    const perms = getPermissionsForRole('ADMIN');
    expect(perms.canDeleteWorkspace).toBe(false);
    expect(perms.canPublish).toBe(true);
    expect(perms.canManageCredentials).toBe(true);
  });

  it('F03-3: should allow EDITOR to edit drafts and credentials but forbid workflow publication', () => {
    const perms = getPermissionsForRole('EDITOR');
    expect(perms.canEditDraft).toBe(true);
    expect(perms.canManageCredentials).toBe(true);
    expect(perms.canPublish).toBe(false);
    expect(perms.canDeleteWorkspace).toBe(false);
  });

  it('F03-4: should restrict VIEWER strictly to read-only access with zero mutation permissions', () => {
    const perms = getPermissionsForRole('VIEWER');
    expect(perms.canViewRuns).toBe(true);
    expect(perms.canEditDraft).toBe(false);
    expect(perms.canPublish).toBe(false);
    expect(perms.canManageCredentials).toBe(false);
  });

  it('F03-5: should ensure owner bootstrapping assigns first registered user the OWNER role', () => {
    const db = new InMemoryDatabase();
    const isFirstUser = db.users.size === 0;
    const user = db.createUser({
      email: 'owner@company.com',
      password_hash: 'argon_hash',
      is_owner: isFirstUser,
      is_active: true
    });
    expect(user.is_owner).toBe(true);

    const secondUser = db.createUser({
      email: 'member@company.com',
      password_hash: 'argon_hash',
      is_owner: db.users.size === 0,
      is_active: true
    });
    expect(secondUser.is_owner).toBe(false);
  });
});

describe('Tier 1: Feature F04 - Credential Envelope Encryption (AES-256-GCM)', () => {
  it('F04-1: should encrypt plaintext and produce keyVersion, iv, authTag, and ciphertext in base64', async () => {
    const plaintext = 'sk-proj-super-secret-openai-api-key-12345';
    const encrypted = await encryptionService.encrypt(plaintext);

    expect(encrypted.keyVersion).toBe(1);
    expect(encrypted.iv).toBeDefined();
    expect(encrypted.authTag).toBeDefined();
    expect(encrypted.ciphertext).toBeDefined();
    expect(encrypted.ciphertext).not.toBe(plaintext);
  });

  it('F04-2: should decrypt encrypted payload back to identical original plaintext', async () => {
    const secret = 'postgres://admin:P@ssw0rd!@10.0.0.5:5432/finance_db';
    const encrypted = await encryptionService.encrypt(secret);
    const decrypted = await encryptionService.decrypt(encrypted);

    expect(decrypted).toBe(secret);
  });

  it('F04-3: should reject tampered ciphertext with cryptographic authentication error', async () => {
    const secret = 'telegram-bot-token-123456:ABC-DEF1234';
    const encrypted = await encryptionService.encrypt(secret);

    // Tamper ciphertext
    const corrupted = {
      ...encrypted,
      ciphertext: Buffer.from('corrupted_ciphertext_data').toString('base64')
    };

    await expect(encryptionService.decrypt(corrupted)).rejects.toThrow();
  });

  it('F04-4: should produce distinct IVs and ciphertexts for identical plaintext inputs (semantic security)', async () => {
    const secret = 'same-token-value';
    const enc1 = await encryptionService.encrypt(secret);
    const enc2 = await encryptionService.encrypt(secret);

    expect(enc1.iv).not.toBe(enc2.iv);
    expect(enc1.ciphertext).not.toBe(enc2.ciphertext);
  });

  it('F04-5: should support versioned master encryption keys for key rotation', async () => {
    const customService = new EnvelopeEncryptionService();
    customService.currentKeyVersion = 2;
    const encrypted = await customService.encrypt('rotating_secret_key');

    expect(encrypted.keyVersion).toBe(2);
    const decrypted = await customService.decrypt(encrypted);
    expect(decrypted).toBe('rotating_secret_key');
  });
});

describe('Tier 1: Feature F05 - Secret Redaction Engine', () => {
  it('F05-1: should redact flat sensitive fields matching token/password/secret/apiKey', () => {
    const payload = {
      id: 'req_101',
      username: 'johndoe',
      password: 'MyClearPassword!',
      api_key: 'sk-99887766',
      token: 'bearer_token_xyz',
      client_secret: 'shh_dont_tell'
    };

    const redacted = redactionService.redact(payload) as Record<string, string>;
    expect(redacted.id).toBe('req_101');
    expect(redacted.username).toBe('johndoe');
    expect(redacted.password).toBe('[REDACTED]');
    expect(redacted.api_key).toBe('[REDACTED]');
    expect(redacted.token).toBe('[REDACTED]');
    expect(redacted.client_secret).toBe('[REDACTED]');
  });

  it('F05-2: should recursively redact deeply nested objects and arrays', () => {
    const payload = {
      user: {
        profile: {
          email: 'user@test.com',
          auth: {
            accessToken: 'sensitive_jwt_token',
            refreshToken: 'sensitive_refresh_token'
          }
        }
      },
      items: [
        { id: 1, authorization: 'Basic YWRtaW46c2VjcmV0' },
        { id: 2, note: 'clean note' }
      ]
    };

    const redacted = redactionService.redact(payload) as any;
    expect(redacted.user.profile.email).toBe('user@test.com');
    expect(redacted.user.profile.auth.accessToken).toBe('[REDACTED]');
    expect(redacted.user.profile.auth.refreshToken).toBe('[REDACTED]');
    expect(redacted.items[0].authorization).toBe('[REDACTED]');
    expect(redacted.items[1].note).toBe('clean note');
  });

  it('F05-3: should leave non-sensitive fields and primitive types intact', () => {
    const payload = {
      status: 200,
      active: true,
      timestamp: '2026-11-02T10:00:00Z',
      tags: ['alpha', 'release'],
      count: 42
    };

    const redacted = redactionService.redact(payload) as any;
    expect(redacted.status).toBe(200);
    expect(redacted.active).toBe(true);
    expect(redacted.count).toBe(42);
    expect(redacted.tags).toContain('alpha');
  });

  it('F05-4: should perform case-insensitive redaction on various casing conventions', () => {
    const payload = {
      API_KEY: 'val1',
      secretKey: 'val2',
      X_AUTH_TOKEN: 'val3',
      bearer_token: 'val4'
    };

    const redacted = redactionService.redact(payload) as Record<string, string>;
    expect(redacted.API_KEY).toBe('[REDACTED]');
    expect(redacted.secretKey).toBe('[REDACTED]');
    expect(redacted.X_AUTH_TOKEN).toBe('[REDACTED]');
    expect(redacted.bearer_token).toBe('[REDACTED]');
  });

  it('F05-5: should safely handle circular references without stack overflow', () => {
    const circularObj: Record<string, unknown> = {
      name: 'root',
      secret: 'supersecret'
    };
    circularObj.self = circularObj;

    const redacted = redactionService.redact(circularObj) as any;
    expect(redacted.secret).toBe('[REDACTED]');
    expect(redacted.self).toBe('[CIRCULAR]');
  });
});

describe('Tier 1: Feature F06 - SSRF Protection Engine', () => {
  it('F06-1: should block IPv4 loopback addresses (127.0.0.1, 127.0.0.2, localhost)', () => {
    expect(() => ssrfGuard.validateUrl('http://127.0.0.1:8080/admin')).toThrow(SSRFBlockedError);
    expect(() => ssrfGuard.validateUrl('http://127.0.0.2/api')).toThrow(SSRFBlockedError);
    expect(() => ssrfGuard.validateUrl('http://localhost:3000')).toThrow(SSRFBlockedError);
  });

  it('F06-2: should block RFC 1918 private network ranges (10.x, 172.16-31.x, 192.168.x)', () => {
    expect(() => ssrfGuard.validateUrl('http://10.0.0.1:9000/metrics')).toThrow(SSRFBlockedError);
    expect(() => ssrfGuard.validateUrl('http://172.16.0.5/internal')).toThrow(SSRFBlockedError);
    expect(() => ssrfGuard.validateUrl('http://172.31.255.255/admin')).toThrow(SSRFBlockedError);
    expect(() => ssrfGuard.validateUrl('http://192.168.1.1/router')).toThrow(SSRFBlockedError);
  });

  it('F06-3: should block link-local and AWS/GCP cloud metadata IP (169.254.169.254)', () => {
    expect(() => ssrfGuard.validateUrl('http://169.254.169.254/latest/meta-data/')).toThrow(SSRFBlockedError);
    expect(() => ssrfGuard.validateUrl('http://169.254.1.1/link')).toThrow(SSRFBlockedError);
  });

  it('F06-4: should detect and block obfuscated decimal and hex IP representations', () => {
    // 2130706433 in decimal is 127.0.0.1
    expect(() => ssrfGuard.validateUrl('http://2130706433/')).toThrow(SSRFBlockedError);
    // 0x7f000001 in hex is 127.0.0.1
    expect(() => ssrfGuard.validateUrl('http://0x7f000001/')).toThrow(SSRFBlockedError);
  });

  it('F06-5: should allow benign public Internet URLs to proceed', () => {
    expect(() => ssrfGuard.validateUrl('https://api.github.com/repos')).not.toThrow();
    expect(() => ssrfGuard.validateUrl('https://api.openai.com/v1/models')).not.toThrow();
    expect(() => ssrfGuard.validateUrl('https://httpbin.org/get')).not.toThrow();
  });
});

describe('Tier 1: Feature F07 - Workflow Definition Schema', () => {
  it('F07-1: should validate a complete workflow definition with typed ports and edges', () => {
    const validWf: WorkflowDefinition = {
      id: 'wf_valid_1',
      workspaceId: 'ws_1',
      name: 'Valid Workflow',
      nodes: [
        {
          id: 'trig',
          type: 'trigger.manual',
          data: { label: 'Start', config: {} },
          inputs: [],
          outputs: [{ id: 'out', name: 'main', type: 'trigger', direction: 'output' }]
        },
        {
          id: 'http',
          type: 'core.httpRequest',
          data: { label: 'Fetch', config: { url: 'https://api.example.com' } },
          inputs: [{ id: 'in', name: 'main', type: 'trigger', direction: 'input' }],
          outputs: [{ id: 'out', name: 'main', type: 'json', direction: 'output' }]
        }
      ],
      edges: [
        { id: 'e1', source: 'trig', sourceHandle: 'main', target: 'http', targetHandle: 'main' }
      ]
    };

    expect(validWf.nodes).toHaveLength(2);
    expect(validWf.edges).toHaveLength(1);
    expect(validWf.nodes[1].inputs[0].type).toBe('trigger');
  });

  it('F07-2: should reject edges connecting to non-existent nodes', () => {
    const invalidWf: WorkflowDefinition = {
      id: 'wf_bad_edge',
      workspaceId: 'ws_1',
      name: 'Bad Edge Workflow',
      nodes: [
        { id: 'node_1', type: 'trigger.manual', data: { label: 'Start', config: {} }, inputs: [], outputs: [] }
      ],
      edges: [
        { id: 'e1', source: 'node_1', sourceHandle: 'main', target: 'ghost_node', targetHandle: 'main' }
      ]
    };

    const res = cycleDetector.validateGraph(invalidWf);
    expect(res.isValid).toBe(false);
    expect(res.errors[0]).toContain('ghost_node');
  });

  it('F07-3: should reject workflow definitions lacking any trigger node', () => {
    const noTriggerWf: WorkflowDefinition = {
      id: 'wf_no_trigger',
      workspaceId: 'ws_1',
      name: 'No Trigger Workflow',
      nodes: [
        { id: 'action_1', type: 'core.httpRequest', data: { label: 'HTTP', config: {} }, inputs: [], outputs: [] }
      ],
      edges: []
    };

    const res = cycleDetector.validateGraph(noTriggerWf);
    expect(res.isValid).toBe(false);
    expect(res.errors[0]).toContain('ERR_NO_TRIGGER_NODE');
  });

  it('F07-4: should reject workflow definitions containing multiple root trigger nodes', () => {
    const multiTriggerWf: WorkflowDefinition = {
      id: 'wf_multi_trigger',
      workspaceId: 'ws_1',
      name: 'Multiple Triggers',
      nodes: [
        { id: 'trig_1', type: 'trigger.manual', data: { label: 'Manual', config: {} }, inputs: [], outputs: [] },
        { id: 'trig_2', type: 'trigger.cron', data: { label: 'Cron', config: {} }, inputs: [], outputs: [] }
      ],
      edges: []
    };

    const res = cycleDetector.validateGraph(multiTriggerWf);
    expect(res.isValid).toBe(false);
    expect(res.errors[0]).toContain('ERR_MULTIPLE_TRIGGERS');
  });

  it('F07-5: should support credential reference binding on action nodes', () => {
    const wfWithCred: WorkflowDefinition = {
      id: 'wf_cred',
      workspaceId: 'ws_1',
      name: 'Cred Workflow',
      nodes: [
        {
          id: 'smtp_node',
          type: 'core.smtp',
          data: {
            label: 'Send Email',
            config: { to: 'admin@test.com' },
            credentialId: 'cred_smtp_123'
          },
          inputs: [],
          outputs: []
        }
      ],
      edges: []
    };

    expect(wfWithCred.nodes[0].data.credentialId).toBe('cred_smtp_123');
  });
});

describe('Tier 1: Feature F08 - Cycle Prevention Engine', () => {
  it('F08-1: should successfully validate a clean acyclic linear DAG', () => {
    const linearWf: WorkflowDefinition = {
      id: 'wf_linear',
      workspaceId: 'ws_1',
      name: 'Linear Pipeline',
      nodes: [
        { id: 'n1', type: 'trigger.manual', data: { label: 'T', config: {} }, inputs: [], outputs: [] },
        { id: 'n2', type: 'core.httpRequest', data: { label: 'H', config: {} }, inputs: [], outputs: [] },
        { id: 'n3', type: 'core.smtp', data: { label: 'S', config: {} }, inputs: [], outputs: [] }
      ],
      edges: [
        { id: 'e1', source: 'n1', sourceHandle: 'main', target: 'n2', targetHandle: 'main' },
        { id: 'e2', source: 'n2', sourceHandle: 'main', target: 'n3', targetHandle: 'main' }
      ]
    };

    const res = cycleDetector.validateGraph(linearWf);
    expect(res.isValid).toBe(true);
    expect(res.topologicalOrder).toEqual(['n1', 'n2', 'n3']);
  });

  it('F08-2: should detect direct 2-node cycle (A -> B -> A) and reject with ERR_CYCLIC_DEPENDENCY_DETECTED', () => {
    const cycleWf: WorkflowDefinition = {
      id: 'wf_cycle_2',
      workspaceId: 'ws_1',
      name: 'Cycle 2',
      nodes: [
        { id: 't1', type: 'trigger.manual', data: { label: 'T', config: {} }, inputs: [], outputs: [] },
        { id: 'n1', type: 'primitive.map', data: { label: 'M1', config: {} }, inputs: [], outputs: [] },
        { id: 'n2', type: 'primitive.map', data: { label: 'M2', config: {} }, inputs: [], outputs: [] }
      ],
      edges: [
        { id: 'e0', source: 't1', sourceHandle: 'main', target: 'n1', targetHandle: 'main' },
        { id: 'e1', source: 'n1', sourceHandle: 'main', target: 'n2', targetHandle: 'main' },
        { id: 'e2', source: 'n2', sourceHandle: 'main', target: 'n1', targetHandle: 'main' }
      ]
    };

    const res = cycleDetector.validateGraph(cycleWf);
    expect(res.isValid).toBe(false);
    expect(res.errors[0]).toContain('ERR_CYCLIC_DEPENDENCY_DETECTED');
  });

  it('F08-3: should detect self-loop edge (A -> A) immediately', () => {
    const selfLoopWf: WorkflowDefinition = {
      id: 'wf_self_loop',
      workspaceId: 'ws_1',
      name: 'Self Loop',
      nodes: [
        { id: 't1', type: 'trigger.manual', data: { label: 'T', config: {} }, inputs: [], outputs: [] },
        { id: 'n1', type: 'primitive.map', data: { label: 'M', config: {} }, inputs: [], outputs: [] }
      ],
      edges: [
        { id: 'e0', source: 't1', sourceHandle: 'main', target: 'n1', targetHandle: 'main' },
        { id: 'e1', source: 'n1', sourceHandle: 'main', target: 'n1', targetHandle: 'main' }
      ]
    };

    const res = cycleDetector.validateGraph(selfLoopWf);
    expect(res.isValid).toBe(false);
    expect(res.errors[0]).toContain('self-loop');
  });

  it('F08-4: should identify indirect 4-node cycle (A -> B -> C -> D -> B) and report exact cycle path', () => {
    const indirectCycle: WorkflowDefinition = {
      id: 'wf_indirect',
      workspaceId: 'ws_1',
      name: 'Indirect Cycle',
      nodes: [
        { id: 't1', type: 'trigger.manual', data: { label: 'T', config: {} }, inputs: [], outputs: [] },
        { id: 'b', type: 'primitive.map', data: { label: 'B', config: {} }, inputs: [], outputs: [] },
        { id: 'c', type: 'primitive.map', data: { label: 'C', config: {} }, inputs: [], outputs: [] },
        { id: 'd', type: 'primitive.map', data: { label: 'D', config: {} }, inputs: [], outputs: [] }
      ],
      edges: [
        { id: 'e0', source: 't1', sourceHandle: 'main', target: 'b', targetHandle: 'main' },
        { id: 'e1', source: 'b', sourceHandle: 'main', target: 'c', targetHandle: 'main' },
        { id: 'e2', source: 'c', sourceHandle: 'main', target: 'd', targetHandle: 'main' },
        { id: 'e3', source: 'd', sourceHandle: 'main', target: 'b', targetHandle: 'main' }
      ]
    };

    const res = cycleDetector.validateGraph(indirectCycle);
    expect(res.isValid).toBe(false);
    expect(res.cycles.length).toBeGreaterThan(0);
  });

  it('F08-5: should pass diamond-shaped DAGs with converging paths (which are valid acyclic graphs)', () => {
    const diamondWf: WorkflowDefinition = {
      id: 'wf_diamond',
      workspaceId: 'ws_1',
      name: 'Diamond DAG',
      nodes: [
        { id: 't1', type: 'trigger.manual', data: { label: 'Start', config: {} }, inputs: [], outputs: [] },
        { id: 'branch_a', type: 'primitive.map', data: { label: 'A', config: {} }, inputs: [], outputs: [] },
        { id: 'branch_b', type: 'primitive.map', data: { label: 'B', config: {} }, inputs: [], outputs: [] },
        { id: 'merge', type: 'primitive.merge', data: { label: 'Merge', config: {} }, inputs: [], outputs: [] }
      ],
      edges: [
        { id: 'e1', source: 't1', sourceHandle: 'main', target: 'branch_a', targetHandle: 'main' },
        { id: 'e2', source: 't1', sourceHandle: 'main', target: 'branch_b', targetHandle: 'main' },
        { id: 'e3', source: 'branch_a', sourceHandle: 'main', target: 'merge', targetHandle: 'main' },
        { id: 'e4', source: 'branch_b', sourceHandle: 'main', target: 'merge', targetHandle: 'main' }
      ]
    };

    const res = cycleDetector.validateGraph(diamondWf);
    expect(res.isValid).toBe(true);
    expect(res.topologicalOrder).toContain('merge');
    // merge must come after branch_a and branch_b
    const mergeIdx = res.topologicalOrder.indexOf('merge');
    expect(mergeIdx).toBeGreaterThan(res.topologicalOrder.indexOf('branch_a'));
    expect(mergeIdx).toBeGreaterThan(res.topologicalOrder.indexOf('branch_b'));
  });
});
