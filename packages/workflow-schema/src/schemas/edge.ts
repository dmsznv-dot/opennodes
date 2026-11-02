import { z } from 'zod';

export const WorkflowEdgeSchema = z.object({
  id: z.string().min(1, 'Edge ID cannot be empty'),
  source: z.string().min(1, 'Source node ID cannot be empty'),
  sourceHandle: z.string().min(1, 'Source handle ID cannot be empty'),
  target: z.string().min(1, 'Target node ID cannot be empty'),
  targetHandle: z.string().min(1, 'Target handle ID cannot be empty'),
});
