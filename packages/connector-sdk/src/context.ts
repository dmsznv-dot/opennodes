import { SafeHttpClient } from '@localflow/shared';

export interface ConnectorLogger {
  info(msg: string, ...args: unknown[]): void;
  warn(msg: string, ...args: unknown[]): void;
  error(msg: string, ...args: unknown[]): void;
  debug(msg: string, ...args: unknown[]): void;
}

export interface ConnectorContext {
  workspaceId: string;
  credentials?: Record<string, unknown>;
  logger: ConnectorLogger;
  httpClient: SafeHttpClient;
  fsRoot?: string;
}
