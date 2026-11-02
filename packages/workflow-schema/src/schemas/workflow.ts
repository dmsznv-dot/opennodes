import { z } from 'zod';
import { WorkflowNodeSchema } from './node.js';
import { WorkflowEdgeSchema } from './edge.js';

export const WorkflowExecutionPolicySchema = z.object({
  executionTimeoutMs: z.number().int().min(1000).max(3600000).default(300000), // Default 5 mins
  maxConcurrency: z.number().int().min(1).max(50).default(5),
  timeoutMs: z.number().int().optional(),
  maxRetries: z.number().int().optional(),
  backoffMs: z.number().int().optional(),
});

export const WorkflowDefinitionSchema = z.object({
  id: z.string().min(1, 'Workflow ID cannot be empty'),
  workspaceId: z.string().min(1, 'Workspace ID cannot be empty'),
  name: z.string().min(1, 'Workflow name cannot be empty').max(255),
  description: z.string().max(1000).optional(),
  schemaVersion: z.literal('1.0').default('1.0'),
  nodes: z.array(WorkflowNodeSchema),
  edges: z.array(WorkflowEdgeSchema),
  triggerConfig: z.record(z.string(), z.unknown()).optional(),
  executionPolicy: WorkflowExecutionPolicySchema.default({}),
  createdAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime().optional(),
});

export const WorkflowGraphSchema = WorkflowDefinitionSchema.extend({
  checksum: z.string().length(64, 'Checksum must be a 64-character SHA-256 hex string').optional(),
});

export const WorkflowVersionSchema = z.object({
  id: z.string().min(1, 'Version ID cannot be empty'),
  workflowId: z.string().min(1, 'Workflow ID cannot be empty'),
  versionNumber: z.number().int().min(1),
  isDraft: z.boolean().default(false),
  snapshot: WorkflowGraphSchema,
  checksum: z.string().length(64, 'Checksum must be a 64-character SHA-256 hex string'),
  createdBy: z.string().optional(),
  createdAt: z.string().datetime().optional(),
});
