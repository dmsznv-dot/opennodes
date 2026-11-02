import { z } from 'zod';

export const ExecutionStatusSchema = z.enum([
  'QUEUED',
  'RUNNING',
  'WAITING',
  'SUCCEEDED',
  'FAILED',
  'CANCELLED',
]);

export const NodeStatusSchema = z.enum([
  'PENDING',
  'RUNNING',
  'SUCCEEDED',
  'FAILED',
  'SKIPPED',
  'CANCELLED',
]);

export const ExecutionEventSchema = z.object({
  eventId: z.string(),
  executionId: z.string(),
  timestamp: z.string().datetime().optional(),
  type: z.string(),
  nodeId: z.string().optional(),
  status: ExecutionStatusSchema.optional(),
  nodeStatus: NodeStatusSchema.optional(),
  data: z.record(z.string(), z.unknown()).optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
});
