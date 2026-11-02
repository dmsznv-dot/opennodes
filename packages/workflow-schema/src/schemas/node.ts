import { z } from 'zod';
import { PORT_TYPES, PORT_DIRECTIONS } from '@localflow/shared';

export const NodePortSchema = z.object({
  id: z.string().min(1, 'Port ID cannot be empty'),
  name: z.string().min(1, 'Port name cannot be empty'),
  type: z.enum(PORT_TYPES),
  direction: z.enum(PORT_DIRECTIONS),
  required: z.boolean().default(false),
  description: z.string().optional(),
});

export const NodeExecutionPolicySchema = z.object({
  maxRetries: z.number().int().min(0).max(5).default(0),
  backoffType: z.enum(['exponential', 'fixed']).default('exponential'),
  initialIntervalMs: z.number().int().min(100).max(60000).default(1000),
  maxIntervalMs: z.number().int().min(1000).max(300000).default(30000),
  timeoutMs: z.number().int().min(500).max(300000).default(30000),
  continueOnError: z.boolean().default(false),
});

export const WorkflowNodeDataSchema = z.object({
  label: z.string().min(1, 'Node label cannot be empty'),
  description: z.string().optional(),
  config: z.record(z.string(), z.unknown()).default({}),
  credentialId: z.string().uuid().optional(),
  /** A switched-off step: the engine passes over it and the flow continues. */
  disabled: z.boolean().optional(),
  executionPolicy: NodeExecutionPolicySchema.optional(),
});

export const NodePositionSchema = z.object({
  x: z.number(),
  y: z.number(),
});

export const WorkflowNodeSchema = z.object({
  id: z.string().min(1, 'Node ID cannot be empty'),
  type: z.string().min(1, 'Node type cannot be empty'),
  data: WorkflowNodeDataSchema,
  inputs: z.array(NodePortSchema).default([]),
  outputs: z.array(NodePortSchema).default([]),
  position: NodePositionSchema.optional(),
});
