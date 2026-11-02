import { z } from 'zod';

export const WorkerConfigSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  DATABASE_URL: z
    .string()
    .default('postgres://localflow:localflow@localhost:5432/localflow'),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(100).default(10),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error']).default('info'),
  WORKER_DRAIN_TIMEOUT_MS: z.coerce.number().int().default(10_000),
  WORKER_HEARTBEAT_INTERVAL_MS: z.coerce.number().int().default(15_000),
  ORPHAN_SCAN_INTERVAL_MS: z.coerce.number().int().default(60_000),
  ORPHAN_THRESHOLD_MS: z.coerce.number().int().default(45_000),
  HARD_TIMEOUT_MS: z.coerce.number().int().default(300_000),
});

export type WorkerConfig = z.infer<typeof WorkerConfigSchema>;

export function loadWorkerConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  return WorkerConfigSchema.parse(env);
}
