export interface CancellationToken {
  isCancelled: boolean;
  reason?: string;
  onCancelled(callback: (reason?: string) => void): void;
}

export class SimpleCancellationToken implements CancellationToken {
  private _cancelled = false;
  private _reason?: string;
  private readonly callbacks: Array<(reason?: string) => void> = [];

  get isCancelled(): boolean {
    return this._cancelled;
  }

  get reason(): string | undefined {
    return this._reason;
  }

  cancel(reason = 'User requested cancellation'): void {
    if (this._cancelled) return;
    this._cancelled = true;
    this._reason = reason;
    for (const cb of this.callbacks) {
      cb(reason);
    }
  }

  onCancelled(callback: (reason?: string) => void): void {
    if (this._cancelled) {
      callback(this._reason);
      return;
    }
    this.callbacks.push(callback);
  }
}

export interface ExpressionScope {
  $trigger: unknown;
  trigger: unknown;
  $nodes: Record<string, { input?: unknown; output?: unknown }>;
  steps: Record<string, { input?: unknown; output?: unknown }>;
  nodes: Record<string, { input?: unknown; output?: unknown }>;
  $env: Record<string, string>;
  env: Record<string, string>;
  [key: string]: unknown;
}

export interface ExecutionContextInit {
  executionId: string;
  workflowId: string;
  workflowVersionId: string;
  workspaceId: string;
  triggerPayload?: unknown;
  triggerType?: string;
  idempotencyKey?: string;
  env?: Record<string, string>;
  cancellationToken?: CancellationToken;
  initialNodeOutputs?: ReadonlyMap<string, unknown>;
}

const pad = (n: number) => String(n).padStart(2, '0');
const WEEKDAYS_RU = [
  'воскресенье',
  'понедельник',
  'вторник',
  'среда',
  'четверг',
  'пятница',
  'суббота',
];

/** Date and time pieces for templates, in the server's time zone. */
export function nowParts(d: Date) {
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return {
    iso: d.toISOString(),
    date,
    time,
    dateTime: `${date} ${time}`,
    dateRu: `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`,
    weekday: WEEKDAYS_RU[d.getDay()]!,
    unix: Math.floor(d.getTime() / 1000),
  };
}

export class ExecutionContext {
  readonly executionId: string;
  readonly workflowId: string;
  readonly workflowVersionId: string;
  readonly workspaceId: string;
  readonly triggerPayload: unknown;
  readonly triggerType: string;
  readonly idempotencyKey?: string;
  readonly nodeOutputs = new Map<string, unknown>();
  readonly nodeInputs = new Map<string, unknown>();
  readonly skippedNodes = new Set<string>();
  readonly activePortBranches = new Map<string, Set<string>>();
  readonly env: Record<string, string>;
  readonly cancellationToken?: CancellationToken;

  constructor(init: ExecutionContextInit) {
    this.executionId = init.executionId;
    this.workflowId = init.workflowId;
    this.workflowVersionId = init.workflowVersionId;
    this.workspaceId = init.workspaceId;
    this.triggerPayload = init.triggerPayload ?? {};
    this.triggerType = init.triggerType ?? 'manual';
    this.idempotencyKey = init.idempotencyKey;
    this.env = {
      WORKSPACE_ID: init.workspaceId,
      WORKFLOW_ID: init.workflowId,
      EXECUTION_ID: init.executionId,
      ...(init.env ?? {}),
    };
    this.cancellationToken = init.cancellationToken;

    if (init.initialNodeOutputs) {
      for (const [k, v] of init.initialNodeOutputs.entries()) {
        this.nodeOutputs.set(k, v);
        this.activePortBranches.set(k, new Set(['main', 'true', 'passed', 'done', 'item']));
      }
    }
  }

  getNodeOutput(nodeId: string): unknown | undefined {
    return this.nodeOutputs.get(nodeId);
  }

  setNodeOutput(nodeId: string, output: unknown): void {
    this.nodeOutputs.set(nodeId, output);
  }

  getNodeInput(nodeId: string): unknown | undefined {
    return this.nodeInputs.get(nodeId);
  }

  setNodeInput(nodeId: string, input: unknown): void {
    this.nodeInputs.set(nodeId, input);
  }

  setActivePorts(nodeId: string, ports: string[] | Set<string>): void {
    this.activePortBranches.set(nodeId, new Set(ports));
  }

  getActivePorts(nodeId: string): Set<string> | undefined {
    return this.activePortBranches.get(nodeId);
  }

  markSkipped(nodeId: string): void {
    this.skippedNodes.add(nodeId);
  }

  isSkipped(nodeId: string): boolean {
    return this.skippedNodes.has(nodeId);
  }

  buildExpressionScope(extra?: Record<string, unknown>): ExpressionScope {
    const nodesRecord: Record<string, { input?: unknown; output?: unknown }> = {};
    const allIds = new Set([...this.nodeOutputs.keys(), ...this.nodeInputs.keys()]);
    for (const id of allIds) {
      nodesRecord[id] = {
        input: this.nodeInputs.get(id),
        output: this.nodeOutputs.get(id),
      };
    }

    return {
      $trigger: this.triggerPayload,
      trigger: this.triggerPayload,
      // System values the editor offers next to step data: the moment the step runs
      // (server time zone, TZ) and the run itself.
      $now: nowParts(new Date()),
      $run: { id: this.executionId, workflowId: this.workflowId, triggerType: this.triggerType },
      $nodes: nodesRecord,
      steps: nodesRecord,
      nodes: nodesRecord,
      $env: this.env,
      env: this.env,
      ...(extra ?? {}),
    };
  }
}
