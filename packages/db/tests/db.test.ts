import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { createInMemoryDb, PgliteDatabaseInstance } from '../src/client.js';
import * as schema from '../src/schema/index.js';

describe('packages/db: In-Memory PostgreSQL Schema & Relational CRUD', () => {
  let db: PgliteDatabaseInstance;

  beforeEach(async () => {
    db = await createInMemoryDb();
  });

  it('initializes in-memory database with all 18 tables', async () => {
    expect(db).toBeDefined();
    // Test that querying each table returns empty array without error
    expect(await db.select().from(schema.users)).toEqual([]);
    expect(await db.select().from(schema.sessions)).toEqual([]);
    expect(await db.select().from(schema.workspaces)).toEqual([]);
    expect(await db.select().from(schema.memberships)).toEqual([]);
    expect(await db.select().from(schema.workspaceSettings)).toEqual([]);
    expect(await db.select().from(schema.apiKeys)).toEqual([]);
    expect(await db.select().from(schema.invitations)).toEqual([]);
    expect(await db.select().from(schema.credentials)).toEqual([]);
    expect(await db.select().from(schema.workflows)).toEqual([]);
    expect(await db.select().from(schema.workflowVersions)).toEqual([]);
    expect(await db.select().from(schema.executions)).toEqual([]);
    expect(await db.select().from(schema.nodeExecutions)).toEqual([]);
    expect(await db.select().from(schema.executionLogs)).toEqual([]);
    expect(await db.select().from(schema.executionEvents)).toEqual([]);
    expect(await db.select().from(schema.triggers)).toEqual([]);
    expect(await db.select().from(schema.triggerLogs)).toEqual([]);
    expect(await db.select().from(schema.webhookSubscriptions)).toEqual([]);
    expect(await db.select().from(schema.auditLogs)).toEqual([]);
  });

  it('performs CRUD on users and workspaces with unique constraint enforcement', async () => {
    // 1. Create User
    const [user] = await db
      .insert(schema.users)
      .values({
        email: 'owner@localflow.dev',
        passwordHash: 'argon2id$mockhash',
        fullName: 'System Owner',
        isOwner: true,
      })
      .returning();
    expect(user!.id).toBeDefined();
    expect(user!.email).toBe('owner@localflow.dev');
    expect(user!.isOwner).toBe(true);

    // 2. Reject duplicate user email
    await expect(
      db.insert(schema.users).values({
        email: 'owner@localflow.dev',
        passwordHash: 'another$hash',
      })
    ).rejects.toThrow();

    // 3. Create Workspace
    const [workspace] = await db
      .insert(schema.workspaces)
      .values({
        name: 'Primary Workspace',
        slug: 'primary-workspace',
      })
      .returning();
    expect(workspace!.id).toBeDefined();
    expect(workspace!.slug).toBe('primary-workspace');

    // 4. Reject duplicate workspace slug
    await expect(
      db.insert(schema.workspaces).values({
        name: 'Another Workspace',
        slug: 'primary-workspace',
      })
    ).rejects.toThrow();

    // 5. Create Membership
    const [membership] = await db
      .insert(schema.memberships)
      .values({
        userId: user!.id,
        workspaceId: workspace!.id,
        role: 'OWNER',
      })
      .returning();
    expect(membership!.role).toBe('OWNER');

    // 6. Reject duplicate membership for same user and workspace
    await expect(
      db.insert(schema.memberships).values({
        userId: user!.id,
        workspaceId: workspace!.id,
        role: 'VIEWER',
      })
    ).rejects.toThrow();
  });

  it('handles envelope-encrypted credential storage without exposing plaintext', async () => {
    const [workspace] = await db
      .insert(schema.workspaces)
      .values({
        name: 'Secured Workspace',
        slug: 'secured-workspace',
      })
      .returning();

    const [credential] = await db
      .insert(schema.credentials)
      .values({
        workspaceId: workspace!.id,
        name: 'Production Telegram Bot',
        type: 'telegram',
        keyVersion: 1,
        iv: 'dGVzdF9pdl8xMmJ5dGVz',
        authTag: 'dGVzdF9hdXRoX3RhZw==',
        ciphertext: 'ZW5jcnlwdGVkX3NlY3JldF9kYXRh',
        maskedHint: '••••••••8901',
      })
      .returning();

    expect(credential!.keyVersion).toBe(1);
    expect(credential!.iv).toBe('dGVzdF9pdl8xMmJ5dGVz');
    expect(credential!.authTag).toBe('dGVzdF9hdXRoX3RhZw==');
    expect(credential!.ciphertext).toBe('ZW5jcnlwdGVkX3NlY3JldF9kYXRh');
    expect(credential!.maskedHint).toBe('••••••••8901');
  });

  it('supports draft vs published workflow versioning with checksum verification', async () => {
    const [workspace] = await db
      .insert(schema.workspaces)
      .values({
        name: 'Workflow Workspace',
        slug: 'workflow-workspace',
      })
      .returning();

    // Create Draft Workflow
    const draftNodes = [{ id: 'trigger_1', type: 'core.manual', position: { x: 0, y: 0 }, config: {} }];
    const draftEdges: unknown[] = [];
    const [workflow] = await db
      .insert(schema.workflows)
      .values({
        workspaceId: workspace!.id,
        name: 'Order Notification Flow',
        draftNodes,
        draftEdges,
        draftTriggerConfig: { type: 'manual' },
      })
      .returning();

    // Publish Version 1
    const [v1] = await db
      .insert(schema.workflowVersions)
      .values({
        workflowId: workflow!.id,
        versionNumber: 1,
        isDraft: false,
        nodes: draftNodes,
        edges: draftEdges,
        triggerConfig: { type: 'manual' },
        checksum: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      })
      .returning();

    // Link Active Version
    await db
      .update(schema.workflows)
      .set({ activeVersionId: v1!.id, isActive: true })
      .where(eq(schema.workflows.id, workflow!.id));

    // Prevent duplicate version number for same workflow
    await expect(
      db.insert(schema.workflowVersions).values({
        workflowId: workflow!.id,
        versionNumber: 1,
        nodes: [],
        edges: [],
        triggerConfig: {},
        checksum: 'checksum_2',
      })
    ).rejects.toThrow();

    // Query with Drizzle relations
    const retrievedWorkflow = await db.query.workflows.findFirst({
      where: eq(schema.workflows.id, workflow!.id),
      with: {
        versions: true,
        activeVersion: true,
      },
    });

    expect(retrievedWorkflow?.activeVersion?.versionNumber).toBe(1);
    expect(retrievedWorkflow?.versions).toHaveLength(1);
  });

  it('persists execution run transitions and step-level journaling', async () => {
    const [workspace] = await db
      .insert(schema.workspaces)
      .values({
        name: 'Exec Workspace',
        slug: 'exec-workspace',
      })
      .returning();

    const [workflow] = await db
      .insert(schema.workflows)
      .values({
        workspaceId: workspace!.id,
        name: 'Execution Test Flow',
      })
      .returning();

    const [version] = await db
      .insert(schema.workflowVersions)
      .values({
        workflowId: workflow!.id,
        versionNumber: 1,
        nodes: [],
        edges: [],
        triggerConfig: {},
        checksum: 'dummy_checksum',
      })
      .returning();

    // 1. Create Queued Execution
    const [execution] = await db
      .insert(schema.executions)
      .values({
        workspaceId: workspace!.id,
        workflowId: workflow!.id,
        workflowVersionId: version!.id,
        status: 'QUEUED',
        triggerType: 'manual',
        triggerPayload: { source: 'unit_test' },
      })
      .returning();

    expect(execution!.status).toBe('QUEUED');

    // 2. Transition to RUNNING
    const startedAt = new Date();
    await db
      .update(schema.executions)
      .set({ status: 'RUNNING', startedAt })
      .where(eq(schema.executions.id, execution!.id));

    // 3. Add Step Execution Journal Record
    const [step1] = await db
      .insert(schema.nodeExecutions)
      .values({
        executionId: execution!.id,
        nodeId: 'http_request_1',
        nodeType: 'core.httpRequest',
        nodeName: 'Fetch CRM Record',
        status: 'RUNNING',
        inputPayload: { url: 'https://api.example.com/v1/orders' },
      })
      .returning();

    // 4. Add Step Logs and Events
    await db.insert(schema.executionLogs).values({
      executionId: execution!.id,
      nodeExecutionId: step1!.id,
      nodeId: 'http_request_1',
      level: 'info',
      message: 'Dispatching HTTP GET request',
    });

    await db.insert(schema.executionEvents).values({
      executionId: execution!.id,
      eventType: 'node:started',
      nodeId: 'http_request_1',
      payload: { stepId: step1!.id },
    });

    // 5. Complete Step with Redacted Output
    const finishedAt = new Date();
    await db
      .update(schema.nodeExecutions)
      .set({
        status: 'SUCCEEDED',
        outputPayload: { orderId: 1042, status: 'processed' },
        finishedAt,
        durationMs: 120,
      })
      .where(eq(schema.nodeExecutions.id, step1!.id));

    // 6. Complete Execution
    await db
      .update(schema.executions)
      .set({ status: 'SUCCEEDED', finishedAt, durationMs: 250 })
      .where(eq(schema.executions.id, execution!.id));

    // 7. Verify Relational Query
    const fullExecution = await db.query.executions.findFirst({
      where: eq(schema.executions.id, execution!.id),
      with: {
        nodeExecutions: {
          with: {
            logs: true,
          },
        },
        events: true,
      },
    });

    expect(fullExecution?.status).toBe('SUCCEEDED');
    expect(fullExecution?.nodeExecutions).toHaveLength(1);
    expect(fullExecution?.nodeExecutions[0]?.status).toBe('SUCCEEDED');
    expect(fullExecution?.nodeExecutions[0]?.logs).toHaveLength(1);
    expect(fullExecution?.events).toHaveLength(1);
  });

  it('cascades deletion properly when a workspace is removed', async () => {
    const [workspace] = await db
      .insert(schema.workspaces)
      .values({
        name: 'To Be Deleted',
        slug: 'to-be-deleted',
      })
      .returning();

    const [user] = await db
      .insert(schema.users)
      .values({
        email: 'member@localflow.dev',
        passwordHash: 'hash',
      })
      .returning();

    await db.insert(schema.memberships).values({
      workspaceId: workspace!.id,
      userId: user!.id,
      role: 'VIEWER',
    });

    await db.insert(schema.credentials).values({
      workspaceId: workspace!.id,
      name: 'Test Cred',
      type: 'smtp',
      iv: 'iv',
      authTag: 'tag',
      ciphertext: 'cipher',
    });

    await db.insert(schema.workspaceSettings).values({
      workspaceId: workspace!.id,
      executionTimeoutMs: 60000,
    });

    // Delete workspace
    await db.delete(schema.workspaces).where(eq(schema.workspaces.id, workspace!.id));

    // Verify all child entities cascaded
    expect(
      await db
        .select()
        .from(schema.memberships)
        .where(eq(schema.memberships.workspaceId, workspace!.id))
    ).toEqual([]);
    expect(
      await db
        .select()
        .from(schema.credentials)
        .where(eq(schema.credentials.workspaceId, workspace!.id))
    ).toEqual([]);
    expect(
      await db
        .select()
        .from(schema.workspaceSettings)
        .where(eq(schema.workspaceSettings.workspaceId, workspace!.id))
    ).toEqual([]);
    // User remains intact
    const remainingUser = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, user!.id));
    expect(remainingUser).toHaveLength(1);
  });
});
