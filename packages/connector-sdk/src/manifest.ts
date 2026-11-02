import { z } from 'zod';
import { NodePortSchema } from '@localflow/workflow-schema';

export const ConnectorActionManifestSchema = z.object({
  name: z.string().min(1),
  displayName: z.string().min(1),
  description: z.string().optional(),
  inputs: z.array(NodePortSchema).default([]),
  outputs: z.array(NodePortSchema).default([]),
});

export const ConnectorTriggerManifestSchema = z.object({
  name: z.string().min(1),
  displayName: z.string().optional(),
  type: z.string().default('webhook'),
  description: z.string().optional(),
  inputs: z.array(NodePortSchema).optional().default([]),
  outputs: z.array(NodePortSchema).default([]),
});

export const ConnectorManifestSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  version: z.string().default('1.0.0'),
  icon: z.string().optional(),
  category: z.enum(['core', 'ai', 'integrations', 'utilities']),
  credentialType: z.string().optional(),
  actions: z.record(z.string(), ConnectorActionManifestSchema).default({}),
  triggers: z.record(z.string(), ConnectorTriggerManifestSchema).default({}),
});

export type ConnectorManifest = z.infer<typeof ConnectorManifestSchema>;
export type ConnectorActionManifest = z.infer<typeof ConnectorActionManifestSchema>;
export type ConnectorTriggerManifest = z.infer<typeof ConnectorTriggerManifestSchema>;

