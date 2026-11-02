import { NodePort } from '@localflow/workflow-schema';
import { ConnectorContext } from './context.js';

export interface ConnectorAction<TInput = unknown, TOutput = unknown> {
  name: string;
  description?: string;
  inputs?: NodePort[];
  outputs?: NodePort[];
  execute(input: TInput, ctx: ConnectorContext): Promise<TOutput>;
}

export interface ConnectorTrigger<TConfig = unknown, TOutput = unknown> {
  name: string;
  type: 'manual' | 'cron' | 'webhook' | 'telegram' | string;
  description?: string;
  outputs?: NodePort[];
}

export interface ConnectorDefinition {
  id: string;
  name: string;
  description: string;
  version: string;
  icon?: string;
  category: 'core' | 'ai' | 'integrations' | 'utilities';
  credentialType?: string;
  actions: Record<string, ConnectorAction<any, any>>;
  triggers?: Record<string, ConnectorTrigger<any, any>>;
}
