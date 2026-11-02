import pino, { type Logger, type LoggerOptions } from 'pino';
import { redact } from '../redaction/redactor.js';

export interface AppLoggerConfig {
  level?: string;
  pretty?: boolean;
}

export function createLogger(config: AppLoggerConfig = {}): Logger {
  const isPretty = config.pretty ?? (process.env.NODE_ENV !== 'production' && !process.env.CI);
  const level = config.level ?? process.env.LOG_LEVEL ?? 'info';

  const options: LoggerOptions = {
    level,
    serializers: {
      req: (req: any) => {
        if (!req) return req;
        const sanitizedHeaders = { ...req.headers };
        for (const h of [
          'authorization',
          'cookie',
          'set-cookie',
          'proxy-authorization',
          'x-api-key',
          'x-auth-token',
        ]) {
          if (sanitizedHeaders[h]) sanitizedHeaders[h] = '[REDACTED]';
        }
        return {
          method: req.method,
          url: req.url,
          headers: sanitizedHeaders,
          remoteAddress: req.socket?.remoteAddress,
        };
      },
      err: (err: any) => {
        if (!err) return err;
        return redact(err);
      },
    },
    formatters: {
      log: (obj: Record<string, unknown>) => {
        return redact(obj) as Record<string, unknown>;
      },
    },
  };

  if (isPretty) {
    return pino({
      ...options,
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
        },
      },
    });
  }

  return pino(options);
}
