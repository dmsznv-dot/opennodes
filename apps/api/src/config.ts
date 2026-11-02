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
  });
}
