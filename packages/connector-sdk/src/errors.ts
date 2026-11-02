import { LocalFlowError } from '@localflow/shared';

export class ConnectorError extends LocalFlowError {
  public readonly connectorId?: string;

  constructor(message: string, connectorId?: string, details?: Record<string, unknown>) {
    super(message, 'ERR_CONNECTOR', 500, { ...details, connectorId });
    this.connectorId = connectorId;
  }
}

export class ActionExecutionError extends LocalFlowError {
  public readonly actionName: string;
  public readonly connectorId?: string;

  constructor(
    message: string,
    actionName: string,
    connectorId?: string,
    details?: Record<string, unknown>
  ) {
    super(message, 'ERR_ACTION_EXECUTION', 500, { ...details, actionName, connectorId });
    this.actionName = actionName;
    this.connectorId = connectorId;
  }
}
