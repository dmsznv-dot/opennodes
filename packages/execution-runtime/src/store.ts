import { and, eq, inArray, lt, or, sql } from 'drizzle-orm';
import {
  credentials,
  executions,
  workflowVersions,
  workflows,
  type DatabaseInstance,
} from '@localflow/db';
import type { EncryptionService } from '@localflow/auth';
import type { CancellationToken, JournalExecutionRecord } from '@localflow/workflow-engine';
import type { WorkflowDefinition, WorkflowEdge, WorkflowNode } from '@localflow/workflow-schema';
import type { CredentialResolver } from './connectors.js';

type Db = any; // Drizzle's pg and PGlite clients share this query surface

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Decrypts a step's connection, refusing connections of other workspaces. */
export function createCredentialResolver(
  db: DatabaseInstance,
  encryption: EncryptionService
): CredentialResolver {
  return async (credentialId, workspaceId) => {
    const rows = UUID_RE.test(credentialId)
      ? await (db as Db).select().from(credentials).where(eq(credentials.id, credentialId)).limit(1)
      : [];
    const cred = rows[0];
    if (!cred || cred.workspaceId !== workspaceId) {
      throw new Error(`Connection '${credentialId}' was not found in this workspace.`);
    }
    const secrets = await encryption.decryptJson<Record<string, unknown>>(
      {
        keyVersion: cred.keyVersion,
        iv: cred.iv,
        authTag: cred.authTag,
        ciphertext: cred.ciphertext,
      },
      workspaceId
    );
    return { type: cred.type, secrets };
  };
}

/** The immutable published graph a run executes. */
export async function loadPublishedDefinition(
  db: DatabaseInstance,
  workflowVersionId: string
): Promise<WorkflowDefinition | undefined> {
  if (!UUID_RE.test(workflowVersionId)) return undefined;
  const [version] = await (db as Db)
    .select()
    .from(workflowVersions)
    .where(eq(workflowVersions.id, workflowVersionId))
    .limit(1);
  if (!version) return undefined;
  const [wf] = await (db as Db)
    .select({ name: workflows.name, workspaceId: workflows.workspaceId })
    .from(workflows)
    .where(eq(workflows.id, version.workflowId))
    .limit(1);
  if (!wf) return undefined;
  return {
    id: version.workflowId,
    workspaceId: wf.workspaceId,
    name: wf.name,
    schemaVersion: '1.0',
    nodes: version.nodes as WorkflowNode[],
    edges: version.edges as WorkflowEdge[],
    executionPolicy: { executionTimeoutMs: 300_000, maxConcurrency: 10 },
  };
}

/**
 * Atomically takes a run for this worker: QUEUED or WAITING runs, or a RUNNING run
 * whose worker stopped heartbeating before `staleBefore`. Returns undefined when the
 * run is already taken, finished or cancelled — so a job delivered twice runs once.
 */
export async function claimExecution(
  db: DatabaseInstance,
  executionId: string,
  staleBefore: Date
): Promise<JournalExecutionRecord | undefined> {
  if (!UUID_RE.test(executionId)) return undefined;
  const rows = await (db as Db)
    .update(executions)
    .set({ status: 'RUNNING', updatedAt: new Date() })
    .where(
      and(
        eq(executions.id, executionId),
        or(
          inArray(executions.status, ['QUEUED', 'WAITING']),
          and(eq(executions.status, 'RUNNING'), lt(executions.updatedAt, staleBefore))
        )
      )
    )
    .returning();
  return rows[0];
}

/** Marks a run that cannot start (e.g. its version vanished) as failed. */
export async function failExecution(
  db: DatabaseInstance,
  executionId: string,
  message: string
): Promise<void> {
  await (db as Db)
    .update(executions)
    .set({ status: 'FAILED', errorMessage: message, finishedAt: new Date(), updatedAt: new Date() })
    .where(eq(executions.id, executionId));
}

/**
 * Cancellation across processes: the API marks a run CANCELLED in the database and
 * the worker notices on its next heartbeat. The same query bumps `updated_at`, which
 * tells crash recovery that this run still has a live worker.
 */
export class DbCancellationToken implements CancellationToken {
  private cancelled = false;
  private cancelReason?: string;
  private readonly callbacks: Array<(reason?: string) => void> = [];
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly db: DatabaseInstance,
    private readonly executionId: string
  ) {}

  get isCancelled(): boolean {
    return this.cancelled;
  }

  get reason(): string | undefined {
    return this.cancelReason;
  }

  onCancelled(callback: (reason?: string) => void): void {
    if (this.cancelled) callback(this.cancelReason);
    else this.callbacks.push(callback);
  }

  start(intervalMs: number): void {
    this.timer = setInterval(() => void this.beat(), intervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  private async beat(): Promise<void> {
    try {
      const [row] = await (this.db as Db)
        .update(executions)
        .set({ updatedAt: sql`now()` })
        .where(eq(executions.id, this.executionId))
        .returning({ status: executions.status });
      if (row?.status === 'CANCELLED' && !this.cancelled) {
        this.cancelled = true;
        this.cancelReason = 'Cancelled by a user';
        for (const cb of this.callbacks.splice(0)) cb(this.cancelReason);
      }
    } catch {
      // A missed heartbeat is retried on the next tick.
    }
  }
}
