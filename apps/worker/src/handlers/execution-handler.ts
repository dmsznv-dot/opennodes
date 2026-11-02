import { eq } from 'drizzle-orm';
import { workflowVersions, type DatabaseInstance } from '@localflow/db';
import type { WorkflowDefinition } from '@localflow/workflow-schema';
import {
  WorkflowEngine,
  DrizzleExecutionJournal,
  buildResumptionState,
  type QueueJob,
  type WorkflowExecutionJobPayload,
} from '@localflow/workflow-engine';

export async function executeWorkflowJob(
  job: QueueJob<WorkflowExecutionJobPayload>,
  db: DatabaseInstance,
  engine?: WorkflowEngine
): Promise<{ status: string; executionId: string }> {
  const journal = new DrizzleExecutionJournal(db);
  const runner = engine ?? new WorkflowEngine({ journal });

  const {
    executionId,
    workflowId,
    workflowVersionId,
    workspaceId,
    triggerType,
    triggerPayload,
    idempotencyKey,
    isResume,
  } = job.data;

  // Load workflow version definition from DB
  const rows = await (db as any)
    .select()
    .from(workflowVersions)
    .where(eq(workflowVersions.id, workflowVersionId))
    .limit(1);

  const versionRow = rows[0];
  const definition: WorkflowDefinition = versionRow?.definition
    ? (versionRow.definition as WorkflowDefinition)
    : {
        id: workflowId,
        workspaceId,
        name: 'Workflow',
        schemaVersion: '1.0',
        nodes: [],
        edges: [],
        executionPolicy: { executionTimeoutMs: 300_000, maxConcurrency: 5 },
      };

  if (isResume) {
    const resumeState = await buildResumptionState(executionId, journal);
    const result = await runner.executeWorkflow(definition, {
      executionId,
      resumeFromExecutionId: executionId,
      workflowVersionId,
      triggerType,
      triggerPayload,
      idempotencyKey,
      journal,
      cachedNodeOutputs: resumeState.cachedOutputs,
      completedNodeIds: resumeState.completedNodeIds,
    });
    return { status: result.execution.status, executionId: result.execution.id };
  }

  const result = await runner.executeWorkflow(definition, {
    executionId,
    workflowVersionId,
    triggerType,
    triggerPayload,
    idempotencyKey,
    journal,
  });

  return { status: result.execution.status, executionId: result.execution.id };
}
