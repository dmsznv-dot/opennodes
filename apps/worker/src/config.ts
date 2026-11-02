import { z } from 'zod';

export const WorkerConfigSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  DATABASE_URL: z.string().default('postgres://localflow:localflow@localhost:5432/localflow'),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  /** Must match the API's key: the worker decrypts workflow connections. */
  ENCRYPTION_KEY: z
    .string()
    .default('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'),
  SSRF_ALLOWLIST: z.string().default(''),
  ALLOWED_FS_ROOT: z.string().default('/data/allowed'),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(100).default(10),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error']).default('info'),
  WORKER_DRAIN_TIMEOUT_MS: z.coerce.number().int().default(10_000),
  WORKER_HEARTBEAT_INTERVAL_MS: z.coerce.number().int().default(5_000),
  ORPHAN_SCAN_INTERVAL_MS: z.coerce.number().int().default(60_000),
  ORPHAN_THRESHOLD_MS: z.coerce.number().int().default(45_000),
  /** Runs that never finished within this long are failed instead of resumed. */
  HARD_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .default(24 * 3_600_000),
  /** Delays up to this long run inline; longer ones suspend the run (WAITING). */
  INLINE_DELAY_MAX_MS: z.coerce.number().int().min(0).default(5_000),
});

export type WorkerConfig = z.infer<typeof WorkerConfigSchema>;

export function loadWorkerConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  return WorkerConfigSchema.parse(env);
}
