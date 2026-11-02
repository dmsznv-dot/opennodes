import type { ExecutionJournal } from '../persistence/execution-journal.js';

export interface ResumptionState {
  cachedOutputs: Map<string, unknown>;
  completedNodeIds: Set<string>;
  interruptedNodeIds: Set<string>;
  /** Output handles each completed node activated (from its node:finished event). */
  completedNodePorts: Map<string, string[]>;
}

export async function buildResumptionState(
  executionId: string,
  journal: ExecutionJournal
): Promise<ResumptionState> {
  const steps = await journal.findNodeExecutions(executionId);

  const cachedOutputs = new Map<string, unknown>();
  const completedNodeIds = new Set<string>();
  const interruptedNodeIds = new Set<string>();

  for (const step of steps) {
    if (step.status === 'SUCCEEDED') {
      completedNodeIds.add(step.nodeId);
      if (step.outputPayload !== null && step.outputPayload !== undefined) {
        cachedOutputs.set(step.nodeId, step.outputPayload);
      }
    } else if (step.status === 'RUNNING') {
      interruptedNodeIds.add(step.nodeId);
      await journal.updateNodeExecution(step.id, {
        status: 'PENDING',
        retryCount: step.retryCount + 1,
      });
    }
  }

  const completedNodePorts = new Map<string, string[]>();
  for (const evt of await journal.findEvents(executionId)) {
    const handles = evt.payload?.activeHandles;
    if (
      evt.eventType === 'node:finished' &&
      evt.nodeId &&
      evt.payload?.status === 'SUCCEEDED' &&
      Array.isArray(handles)
    ) {
      completedNodePorts.set(evt.nodeId, handles.map(String));
    }
  }

  return { cachedOutputs, completedNodeIds, interruptedNodeIds, completedNodePorts };
}
