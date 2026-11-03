import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import {
  credentials,
  executions,
  memberships,
  nodeExecutions,
  users,
  workflowVersions,
  workflows,
  workspaces,
  type DatabaseInstance,
} from '@localflow/db';
import { AlreadyBootstrappedError, type EncryptedData, type Role } from '@localflow/auth';
import type { WorkflowEdge, WorkflowNode } from '@localflow/workflow-schema';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Path segments come from the URL; anything that is not a UUID simply does not exist. */
export function isUuid(value: string | undefined): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

/** Arbitrary 64-bit key for the advisory lock that serializes first-run setup. */
const BOOTSTRAP_LOCK_KEY = 7_420_011_001;

export interface UserRecord {
  id: string;
  email: string;
  passwordHash: string;
  fullName: string | null;
}

export interface WorkflowVersionSnapshot {
  id: string;
  version: number;
  workflowId: string;
  checksum: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  publishedAt: string;
  publishedBy: string | null;
}

export interface StoredWorkflow {
  id: string;
  workspaceId: string;
  name: string;
  description: string;
  hasWebhookSecret: boolean;
  /** On: triggers start runs and webhooks are accepted. Publishing turns it on. */
  isActive: boolean;
  draft: {
    nodes: WorkflowNode[];
    edges: WorkflowEdge[];
    updatedAt: string;
  };
  activeVersion: number | null;
  versions: WorkflowVersionSnapshot[];
  createdAt: string;
  updatedAt: string;
}

export interface StoredCredential {
  id: string;
  workspaceId: string;
  name: string;
  type: string;
  encryptedPayload: EncryptedData;
  maskedHint: string | null;
  createdAt: Date;
  updatedAt: Date;
}

type Db = any; // Drizzle's pg and PGlite clients share this query surface

function iso(d: Date | string): string {
  return d instanceof Date ? d.toISOString() : new Date(d).toISOString();
}

/**
 * Control-plane persistence for the API: users, workspaces, memberships,
 * credentials and workflows with their immutable published versions.
 * Executions are persisted separately by the engine's DrizzleExecutionJournal.
 */
export class ApiRepository {
  private readonly db: Db;

  constructor(db: DatabaseInstance) {
    this.db = db;
  }

  public async ping(): Promise<boolean> {
    try {
      await this.db.execute(sql`select 1`);
      return true;
    } catch {
      return false;
    }
  }

  // ── Bootstrap & users ────────────────────────────────────────────────

  public async isBootstrapped(): Promise<boolean> {
    const rows = await this.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.isOwner, true))
      .limit(1);
    return rows.length > 0;
  }

  /**
   * Creates the owner, the first workspace and the OWNER membership atomically.
   * The advisory lock + re-check makes concurrent first-run requests safe:
   * exactly one wins, the rest get AlreadyBootstrappedError.
   */
  public async createOwnerAndWorkspace(input: {
    email: string;
    passwordHash: string;
    fullName?: string;
    workspaceName: string;
    workspaceSlug: string;
  }): Promise<{ userId: string; workspaceId: string; workspaceSlug: string }> {
    return this.db.transaction(async (tx: Db) => {
      await tx.execute(sql`select pg_advisory_xact_lock(${BOOTSTRAP_LOCK_KEY})`);
      const owners = await tx
        .select({ id: users.id })
        .from(users)
        .where(eq(users.isOwner, true))
        .limit(1);
      if (owners.length > 0) throw new AlreadyBootstrappedError();

      const userId = randomUUID();
      const workspaceId = randomUUID();
      await tx.insert(users).values({
        id: userId,
        email: input.email,
        passwordHash: input.passwordHash,
        fullName: input.fullName ?? null,
        isOwner: true,
      });
      await tx
        .insert(workspaces)
        .values({ id: workspaceId, name: input.workspaceName, slug: input.workspaceSlug });
      await tx.insert(memberships).values({ userId, workspaceId, role: 'OWNER' });
      return { userId, workspaceId, workspaceSlug: input.workspaceSlug };
    });
  }

  public async listWorkspaceSlugs(): Promise<string[]> {
    const rows = await this.db.select({ slug: workspaces.slug }).from(workspaces);
    return rows.map((r: Db) => r.slug);
  }

  public async findUserByEmail(email: string): Promise<UserRecord | undefined> {
    const rows = await this.db.select().from(users).where(eq(users.email, email)).limit(1);
    return rows[0];
  }

  public async createUser(email: string, passwordHash: string): Promise<string> {
    const id = randomUUID();
    await this.db.insert(users).values({ id, email, passwordHash });
    return id;
  }

  // ── Memberships ──────────────────────────────────────────────────────

  public async getRole(workspaceId: string, userId: string): Promise<Role | undefined> {
    if (!isUuid(workspaceId) || !isUuid(userId)) return undefined;
    const rows = await this.db
      .select({ role: memberships.role })
      .from(memberships)
      .where(and(eq(memberships.workspaceId, workspaceId), eq(memberships.userId, userId)))
      .limit(1);
    return rows[0]?.role;
  }

  public async upsertMembership(workspaceId: string, userId: string, role: Role): Promise<void> {
    await this.db
      .insert(memberships)
      .values({ workspaceId, userId, role })
      .onConflictDoUpdate({
        target: [memberships.userId, memberships.workspaceId],
        set: { role, updatedAt: new Date() },
      });
  }

  // ── Credentials ──────────────────────────────────────────────────────

  public async createCredential(input: {
    workspaceId: string;
    name: string;
    type: string;
    encrypted: EncryptedData;
    maskedHint: string;
    createdBy: string;
  }): Promise<StoredCredential> {
    const [row] = await this.db
      .insert(credentials)
      .values({
        id: randomUUID(),
        workspaceId: input.workspaceId,
        name: input.name,
        type: input.type,
        keyVersion: input.encrypted.keyVersion,
        iv: input.encrypted.iv,
        authTag: input.encrypted.authTag,
        ciphertext: input.encrypted.ciphertext,
        maskedHint: input.maskedHint,
        createdBy: input.createdBy,
      })
      .returning();
    return this.toCredential(row);
  }

  public async listCredentials(workspaceId: string): Promise<StoredCredential[]> {
    const rows = await this.db
      .select()
      .from(credentials)
      .where(eq(credentials.workspaceId, workspaceId))
      .orderBy(asc(credentials.createdAt));
    return rows.map((r: Db) => this.toCredential(r));
  }

  public async findCredential(credentialId: string): Promise<StoredCredential | undefined> {
    if (!isUuid(credentialId)) return undefined;
    const rows = await this.db
      .select()
      .from(credentials)
      .where(eq(credentials.id, credentialId))
      .limit(1);
    return rows[0] ? this.toCredential(rows[0]) : undefined;
  }

  private toCredential(row: Db): StoredCredential {
    return {
      id: row.id,
      workspaceId: row.workspaceId,
      name: row.name,
      type: row.type,
      encryptedPayload: {
        keyVersion: row.keyVersion,
        iv: row.iv,
        authTag: row.authTag,
        ciphertext: row.ciphertext,
      },
      maskedHint: row.maskedHint,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  // ── Workflows & versions ─────────────────────────────────────────────

  public async createWorkflow(input: {
    id?: string;
    workspaceId: string;
    name: string;
    description: string;
    nodes: WorkflowNode[];
    edges: WorkflowEdge[];
    webhookSecretEncrypted?: EncryptedData;
    createdBy: string;
  }): Promise<StoredWorkflow> {
    const [row] = await this.db
      .insert(workflows)
      .values({
        id: input.id ?? randomUUID(),
        workspaceId: input.workspaceId,
        name: input.name,
        description: input.description,
        draftNodes: input.nodes,
        draftEdges: input.edges,
        webhookSecretEncrypted: input.webhookSecretEncrypted ?? null,
        createdBy: input.createdBy,
      })
      .returning();
    return this.toWorkflow(row, []);
  }

  public async findWorkflow(workflowId: string): Promise<StoredWorkflow | undefined> {
    if (!isUuid(workflowId)) return undefined;
    const rows = await this.db
      .select()
      .from(workflows)
      .where(eq(workflows.id, workflowId))
      .limit(1);
    if (!rows[0]) return undefined;
    const versions = await this.db
      .select()
      .from(workflowVersions)
      .where(eq(workflowVersions.workflowId, workflowId))
      .orderBy(asc(workflowVersions.versionNumber));
    return this.toWorkflow(rows[0], versions);
  }

  public async listWorkflows(workspaceId: string): Promise<StoredWorkflow[]> {
    const rows = await this.db
      .select()
      .from(workflows)
      .where(eq(workflows.workspaceId, workspaceId))
      .orderBy(asc(workflows.createdAt));
    if (rows.length === 0) return [];
    const versions = await this.db
      .select()
      .from(workflowVersions)
      .where(
        inArray(
          workflowVersions.workflowId,
          rows.map((r: Db) => r.id)
        )
      )
      .orderBy(asc(workflowVersions.versionNumber));
    return rows.map((r: Db) =>
      this.toWorkflow(
        r,
        versions.filter((v: Db) => v.workflowId === r.id)
      )
    );
  }

  public async getWebhookSecret(workflowId: string): Promise<EncryptedData | null> {
    const rows = await this.db
      .select({ secret: workflows.webhookSecretEncrypted })
      .from(workflows)
      .where(eq(workflows.id, workflowId))
      .limit(1);
    return rows[0]?.secret ?? null;
  }

  public async setWebhookSecret(workflowId: string, encrypted: EncryptedData): Promise<void> {
    await this.db
      .update(workflows)
      .set({ webhookSecretEncrypted: encrypted })
      .where(eq(workflows.id, workflowId));
  }

  public async updateDraft(
    workflowId: string,
    nodes: WorkflowNode[],
    edges: WorkflowEdge[],
    name?: string
  ): Promise<StoredWorkflow> {
    await this.db
      .update(workflows)
      .set({ draftNodes: nodes, draftEdges: edges, ...(name && { name }), updatedAt: new Date() })
      .where(eq(workflows.id, workflowId));
    return (await this.findWorkflow(workflowId))!;
  }

  public async setWorkflowActive(workflowId: string, active: boolean): Promise<void> {
    await this.db
      .update(workflows)
      .set({ isActive: active, updatedAt: new Date() })
      .where(eq(workflows.id, workflowId));
  }

  /** Deletes the workflow with its versions, triggers and run history. */
  public async deleteWorkflow(workflowId: string): Promise<void> {
    await this.db.transaction(async (tx: Db) => {
      // Runs reference versions (restrict), so they go first; steps and logs cascade.
      await tx.delete(executions).where(eq(executions.workflowId, workflowId));
      await tx.update(workflows).set({ activeVersionId: null }).where(eq(workflows.id, workflowId));
      await tx.delete(workflowVersions).where(eq(workflowVersions.workflowId, workflowId));
      await tx.delete(workflows).where(eq(workflows.id, workflowId));
    });
  }

  public async deleteCredential(credentialId: string): Promise<void> {
    await this.db.delete(credentials).where(eq(credentials.id, credentialId));
  }

  /** The signed-in user and the workspaces they belong to. */
  public async getProfile(userId: string): Promise<{
    user: { id: string; email: string; fullName: string | null };
    workspaces: Array<{ id: string; name: string; slug: string; role: Role }>;
  }> {
    const [user] = await this.db
      .select({ id: users.id, email: users.email, fullName: users.fullName })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    const rows = await this.db
      .select({
        id: workspaces.id,
        name: workspaces.name,
        slug: workspaces.slug,
        role: memberships.role,
      })
      .from(memberships)
      .innerJoin(workspaces, eq(workspaces.id, memberships.workspaceId))
      .where(eq(memberships.userId, userId))
      .orderBy(asc(workspaces.createdAt));
    return { user, workspaces: rows };
  }

  /** Recent runs of a workspace (optionally one workflow), newest first, with their steps. */
  public async listRunsWithSteps(
    workspaceId: string,
    options: { workflowId?: string; limit?: number } = {}
  ): Promise<Array<Record<string, unknown> & { steps: unknown[] }>> {
    const runs = await this.db
      .select()
      .from(executions)
      .where(
        and(
          eq(executions.workspaceId, workspaceId),
          ...(options.workflowId ? [eq(executions.workflowId, options.workflowId)] : [])
        )
      )
      .orderBy(desc(executions.createdAt))
      .limit(Math.min(Math.max(options.limit ?? 30, 1), 100));
    if (!runs.length) return [];
    const steps = await this.db
      .select()
      .from(nodeExecutions)
      .where(
        inArray(
          nodeExecutions.executionId,
          runs.map((r: Db) => r.id)
        )
      )
      .orderBy(asc(nodeExecutions.createdAt));
    return runs.map((r: Db) => ({
      ...r,
      steps: steps
        .filter((st: Db) => st.executionId === r.id)
        .map(({ outputSealed: _sealed, ...st }: Db) => st),
    }));
  }

  /** Appends the next immutable version and makes it active, in one transaction. */
  public async publishVersion(input: {
    workflowId: string;
    nodes: WorkflowNode[];
    edges: WorkflowEdge[];
    checksum: string;
    publishedBy: string;
  }): Promise<WorkflowVersionSnapshot> {
    return this.db.transaction(async (tx: Db) => {
      // Lock the workflow row so concurrent publishes get distinct version numbers.
      await tx.execute(sql`select id from workflows where id = ${input.workflowId} for update`);
      const [{ max }] = await tx
        .select({ max: sql<number | null>`max(${workflowVersions.versionNumber})` })
        .from(workflowVersions)
        .where(eq(workflowVersions.workflowId, input.workflowId));
      const versionNumber = Number(max ?? 0) + 1;
      const credentialRefs = [
        ...new Set(
          input.nodes
            .map((n) => n.data?.credentialId)
            .filter((id): id is string => typeof id === 'string')
        ),
      ];
      const [row] = await tx
        .insert(workflowVersions)
        .values({
          id: randomUUID(),
          workflowId: input.workflowId,
          versionNumber,
          nodes: input.nodes,
          edges: input.edges,
          triggerConfig: {},
          credentialReferences: credentialRefs,
          checksum: input.checksum,
          createdBy: input.publishedBy,
        })
        .returning();
      await tx
        .update(workflows)
        .set({ activeVersionId: row.id, isActive: true, updatedAt: row.createdAt })
        .where(eq(workflows.id, input.workflowId));
      return this.toVersion(row);
    });
  }

  public async setActiveVersion(workflowId: string, versionId: string): Promise<void> {
    await this.db
      .update(workflows)
      .set({ activeVersionId: versionId, updatedAt: new Date() })
      .where(eq(workflows.id, workflowId));
  }

  public async findVersionById(versionId: string): Promise<WorkflowVersionSnapshot | undefined> {
    if (!isUuid(versionId)) return undefined;
    const rows = await this.db
      .select()
      .from(workflowVersions)
      .where(eq(workflowVersions.id, versionId))
      .limit(1);
    return rows[0] ? this.toVersion(rows[0]) : undefined;
  }

  public async listExecutions(workflowId: string, limit = 50): Promise<unknown[]> {
    return this.db
      .select()
      .from(executions)
      .where(eq(executions.workflowId, workflowId))
      .orderBy(desc(executions.createdAt))
      .limit(limit);
  }

  private toVersion(row: Db): WorkflowVersionSnapshot {
    return {
      id: row.id,
      version: row.versionNumber,
      workflowId: row.workflowId,
      checksum: row.checksum,
      nodes: row.nodes,
      edges: row.edges,
      publishedAt: iso(row.createdAt),
      publishedBy: row.createdBy,
    };
  }

  private toWorkflow(row: Db, versionRows: Db[]): StoredWorkflow {
    const versions = versionRows.map((v) => this.toVersion(v));
    const active = versions.find((v) => v.id === row.activeVersionId);
    return {
      id: row.id,
      workspaceId: row.workspaceId,
      name: row.name,
      description: row.description ?? '',
      hasWebhookSecret: row.webhookSecretEncrypted != null,
      isActive: row.isActive,
      draft: {
        nodes: row.draftNodes,
        edges: row.draftEdges,
        updatedAt: iso(row.updatedAt),
      },
      activeVersion: active?.version ?? null,
      versions,
      createdAt: iso(row.createdAt),
      updatedAt: iso(row.updatedAt),
    };
  }
}
