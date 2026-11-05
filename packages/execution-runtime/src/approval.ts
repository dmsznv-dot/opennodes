import {
  ExecutionSuspendedSignal,
  type ExecutionJournal,
  type IWorkflowQueueManager,
  type JournalExecutionRecord,
  type NodeExecutionResult,
  type NodeExecutor,
} from '@localflow/workflow-engine';
import { toText } from './text.js';

/** How long an approval waits by default, and at most. */
export const APPROVAL_DEFAULT_HOURS = 24;
const APPROVAL_MAX_HOURS = 30 * 24;

export type ApprovalDecision = 'approved' | 'rejected';

/** What a waiting approval step keeps (its output while the run waits). */
export interface ApprovalState {
  approval: true;
  waitingUntil: string;
  title: string;
  content: string;
  /** Asked in a Telegram chat by a separate bot: where the buttons are. */
  // Key names avoid “token” / “credential…”: logs and the journal mask those.
  telegram?: {
    /** The bot's connection id. */
    bot: string;
    chatId: string;
    messageId?: number;
    /** The random tag in the buttons, matching a press to this run. */
    ref: string;
    approvers: string[];
    lang?: 'ru' | 'en';
  };
  decision?: ApprovalDecision;
  decidedAt?: string;
  decidedBy?: string;
}

export function isApprovalState(v: unknown): v is ApprovalState {
  return Boolean(v && typeof v === 'object' && (v as { approval?: unknown }).approval === true);
}

/** What a waiting approval step gives once decided (or timed out); keeps waiting otherwise. */
export function approvalOutcome(state: ApprovalState): NodeExecutionResult {
  const due = Date.parse(state.waitingUntil);
  const base = { title: state.title, content: state.content };
  if (state.decision === 'approved')
    return {
      output: { approved: true, decidedAt: state.decidedAt, decidedBy: state.decidedBy, ...base },
      activeOutputs: ['main'],
    };
  if (state.decision === 'rejected' || Date.now() >= due - 250)
    return {
      output: {
        approved: false,
        reason: state.decision === 'rejected' ? 'rejected' : 'timeout',
        decidedAt: state.decidedAt ?? new Date().toISOString(),
        ...(state.decidedBy ? { decidedBy: state.decidedBy } : {}),
        stopped: true,
        ...base,
      },
      activeOutputs: [],
    };
  // Woken up early with no decision yet: keep waiting.
  throw new ExecutionSuspendedSignal(new Date(due), { ...state });
}

export function approvalHours(config: Record<string, unknown>): number {
  return Math.min(
    Math.max(Number(config.timeoutHours) || APPROVAL_DEFAULT_HOURS, 1 / 3600),
    APPROVAL_MAX_HOURS
  );
}

/** Puts a run whose approval was decided back on the queue, to go on now. */
export async function resumeDecidedRun(
  queue: IWorkflowQueueManager,
  exec: Pick<
    JournalExecutionRecord,
    'id' | 'workflowId' | 'workflowVersionId' | 'workspaceId' | 'triggerType'
  >
): Promise<void> {
  await queue.executionProducer.add(
    'resumeWorkflow',
    {
      executionId: exec.id,
      workflowId: exec.workflowId,
      workflowVersionId: exec.workflowVersionId,
      workspaceId: exec.workspaceId,
      triggerType: exec.triggerType,
      isResume: true,
      enqueuedAt: Date.now(),
    },
    { jobId: `approval_${exec.id}_${Date.now()}`, attempts: 1 }
  );
}

/**
 * "Approval": the run stops and waits for a person — “Approve” goes on, “Reject” (or no
 * answer in time) stops the steps below, so nothing is sent without a yes. The decision
 * is written onto this waiting step (see `decideApproval`) and the run is resumed.
 */
export function buildApprovalExecutors(options: {
  journal: ExecutionJournal;
}): Record<string, NodeExecutor> {
  return {
    'core.approval': {
      async execute(node, config, step) {
        const row = await options.journal.findNodeExecution(step.executionId, node.id);
        const state = row?.outputPayload;
        if (isApprovalState(state) && state.waitingUntil) return approvalOutcome(state);
        const hours = approvalHours(config);
        throw new ExecutionSuspendedSignal(new Date(Date.now() + hours * 3_600_000), {
          approval: true,
          title: toText(config.title).trim() || toText(node.data.label).trim(),
          content: toText(config.content).trim().slice(0, 20_000),
        });
      },
    },
  };
}

/**
 * Records a person's decision on the waiting approval step of a run. Returns false when
 * the run does not wait for an approval (already decided, finished, or another step).
 */
export async function decideApproval(
  journal: ExecutionJournal,
  executionId: string,
  nodeId: string,
  decision: ApprovalDecision,
  decidedBy: string
): Promise<boolean> {
  const row = await journal.findNodeExecution(executionId, nodeId);
  const state = row?.outputPayload;
  if (!row || row.status !== 'PENDING' || !isApprovalState(state) || state.decision) return false;
  await journal.updateNodeExecution(row.id, {
    outputPayload: { ...state, decision, decidedAt: new Date().toISOString(), decidedBy },
  });
  return true;
}
