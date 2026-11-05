import { z } from 'zod';

export const ApiConfigSchema = z.object({
  port: z.coerce.number().int().min(1).max(65535).default(4000),
  host: z.string().default('0.0.0.0'),
  databaseUrl: z.string().default('postgres://localflow:localflow@localhost:5432/localflow'),
  redisUrl: z.string().default('redis://localhost:6379'),
  encryptionKey: z
    .string()
    .default('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'),
  sessionSecret: z.string().min(16).default('localflow-default-session-secret-32-chars'),
  allowedFsRoot: z.string().default('/tmp/localflow-allowed'),
  logLevel: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  /** Hosts connectors may reach despite the SSRF policy, e.g. `ollama:11434`. */
  ssrfAllowlist: z.array(z.string()).default([]),
  /**
   * `queue`: runs are queued in Redis and executed by the worker process (Docker).
   * `embedded`: no Redis — the API runs an in-process queue and worker (local, tests).
   */
  executionMode: z.enum(['queue', 'embedded']).default('embedded'),
  workerConcurrency: z.coerce.number().int().min(1).max(100).default(4),
  /** Delays up to this long run inline; longer ones suspend the run (WAITING). */
  inlineDelayMaxMs: z.coerce.number().int().min(0).default(5_000),
  /** Pause between posts of a “for each item” step; unset = per service (Telegram 1.5 s). */
  forEachPauseMs: z.coerce.number().int().min(0).optional(),
  heartbeatMs: z.coerce.number().int().min(50).default(5_000),
  recoveryStaleMs: z.coerce.number().int().min(100).default(45_000),
  recoveryIntervalMs: z.coerce.number().int().min(100).default(60_000),
  /** How often due schedules are checked (embedded mode; the worker has its own). */
  triggerTickMs: z.coerce.number().int().min(50).default(5_000),
  /** How often presses on Telegram approval buttons are read. */
  approvalPollMs: z.coerce.number().int().min(50).default(3_000),
  telegramApiBase: z.string().url().default('https://api.telegram.org'),
  telegramPollTimeoutSec: z.coerce.number().int().min(0).max(50).default(25),
  telegramMinPollIntervalMs: z.coerce.number().int().min(0).default(1_000),
  telegramRetryMs: z.coerce.number().int().min(0).default(5_000),
  /** Mark session cookies `Secure` (HTTPS only). Also on when a proxy sends X-Forwarded-Proto: https. */
  cookieSecure: z.boolean().default(false),
  /** Finished runs older than this many days are deleted (hourly); 0 keeps them. */
  runRetentionDays: z.coerce.number().int().min(0).default(90),
});

export type ApiConfig = z.infer<typeof ApiConfigSchema>;

export function loadApiConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  return ApiConfigSchema.parse({
    port: env.PORT ?? env.API_PORT ?? 4000,
    host: env.HOST ?? '0.0.0.0',
    databaseUrl: env.DATABASE_URL,
    redisUrl: env.REDIS_URL,
    encryptionKey: env.ENCRYPTION_KEY ?? env.ENCRYPTION_MASTER_KEY,
    sessionSecret: env.SESSION_SECRET,
    allowedFsRoot: env.ALLOWED_FS_ROOT,
    logLevel: env.LOG_LEVEL ?? 'info',
    executionMode: env.EXECUTION_MODE,
    workerConcurrency: env.WORKER_CONCURRENCY,
    inlineDelayMaxMs: env.INLINE_DELAY_MAX_MS,
    triggerTickMs: env.TRIGGER_TICK_MS,
    approvalPollMs: env.APPROVAL_POLL_MS,
    telegramApiBase: env.TELEGRAM_API_BASE,
    cookieSecure: env.COOKIE_SECURE === 'true',
    runRetentionDays: env.RUN_RETENTION_DAYS,
    ssrfAllowlist: (env.SSRF_ALLOWLIST ?? '')
      .split(',')
      .map((h) => h.trim())
      .filter(Boolean),
  });
}
