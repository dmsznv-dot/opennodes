import { redact } from '@localflow/observability';
import { unslopTokens } from '@localflow/ui';

export type StepStatus =
  | 'QUEUED'
  | 'RUNNING'
  | 'WAITING'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'SKIPPED'
  | 'CANCELLED';

export interface RawExecutionStepLog {
  nodeId: string;
  nodeName: string;
  status: StepStatus;
  attempt: number;
  startedAt: string;
  completedAt?: string;
  durationMs: number;
  inputPayload: Record<string, unknown>;
  outputPayload?: Record<string, unknown>;
  errorMessage?: string;
}

export interface InspectorStepViewModel {
  nodeId: string;
  nodeName: string;
  status: StepStatus;
  statusColorHex: string;
  attemptBadge: string;
  tabularDurationLabel: string;
  sanitizedInputJson: string;
  sanitizedOutputJson: string;
  errorDiagnostic: string | null;
}

/**
 * Execution Run Inspector UI Controller
 * Formats step statuses, tabular micro-timings, root-cause error banners,
 * and enforces `[REDACTED]` secret masking on all input/output payloads before display.
 */
export class RunInspectorController {
  public static getStatusColor(status: StepStatus): string {
    switch (status) {
      case 'QUEUED':
        return unslopTokens.colors.status.queued;
      case 'RUNNING':
        return unslopTokens.colors.status.running;
      case 'WAITING':
        return unslopTokens.colors.status.waiting;
      case 'SUCCEEDED':
        return unslopTokens.colors.status.succeeded;
      case 'FAILED':
        return unslopTokens.colors.status.failed;
      case 'CANCELLED':
      case 'SKIPPED':
        return unslopTokens.colors.status.cancelled;
    }
  }

  public static formatTabularDuration(durationMs: number): string {
    if (durationMs < 1000) {
      return `${Math.max(0, Math.round(durationMs))}ms`;
    }
    return `${(durationMs / 1000).toFixed(2)}s`;
  }

  public static formatStepForDisplay(step: RawExecutionStepLog): InspectorStepViewModel {
    const safeInput = redact(step.inputPayload ?? {});
    const safeOutput = redact(step.outputPayload ?? {});

    return {
      nodeId: step.nodeId,
      nodeName: step.nodeName,
      status: step.status,
      statusColorHex: this.getStatusColor(step.status),
      attemptBadge: `Attempt #${step.attempt}`,
      tabularDurationLabel: this.formatTabularDuration(step.durationMs),
      sanitizedInputJson: JSON.stringify(safeInput, null, 2),
      sanitizedOutputJson: JSON.stringify(safeOutput, null, 2),
      errorDiagnostic: step.status === 'FAILED' ? (step.errorMessage ?? 'Step execution failed') : null,
    };
  }
}
