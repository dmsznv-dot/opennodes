import type {
  IQueueProducer,
  QueueJob,
  WorkflowDelayJobPayload,
  WorkflowExecutionJobPayload,
} from '@localflow/workflow-engine';

export async function executeDelayJob(
  job: QueueJob<WorkflowDelayJobPayload>,
  executionProducer: IQueueProducer<WorkflowExecutionJobPayload>
): Promise<{ resumed: boolean; executionId: string }> {
  const { executionId, workflowId, nodeId } = job.data;

  await executionProducer.add(
    'resumeWorkflow',
    {
      executionId,
      workflowId,
      workflowVersionId: String(job.data.scopeSnapshot?.workflowVersionId ?? ''),
      workspaceId: String(job.data.scopeSnapshot?.workspaceId ?? ''),
      triggerType: 'delay_resume',
      isResume: true,
      resumeNodeId: nodeId,
      enqueuedAt: Date.now(),
    },
    {
      jobId: `delay_resume_${executionId}_${nodeId}`,
      priority: 1,
    }
  );

  return { resumed: true, executionId };
}
