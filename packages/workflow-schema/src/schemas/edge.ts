import { z } from 'zod';

export const WorkflowEdgeSchema = z.object({
  id: z.string().min(1, 'Edge ID cannot be empty'),
  source: z.string().min(1, 'Source node ID cannot be empty'),
  sourceHandle: z.string().min(1, 'Source handle ID cannot be empty'),
  target: z.string().min(1, 'Target node ID cannot be empty'),
  targetHandle: z.string().min(1, 'Target handle ID cannot be empty'),
  /** Absent in 1.0 snapshots; infer legacy context links from their source node. */
  kind: z.enum(['data', 'context']).optional(),
});
