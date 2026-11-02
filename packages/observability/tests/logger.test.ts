import { describe, it, expect } from 'vitest';
import { createLogger } from '../src/index.js';

describe('Pino Structured Logger with Redaction', () => {
  it('creates a logger instance with configured level', () => {
    const logger = createLogger({ level: 'debug', pretty: false });
    expect(logger).toBeDefined();
    expect(logger.level).toBe('debug');
  });

  it('serializes requests and masks authorization and cookie headers', () => {
    const logger = createLogger({ pretty: false });
    const reqSerializer = (logger as any)[Symbol.for('pino.serializers')]?.req;

    if (reqSerializer) {
      const mockReq = {
        method: 'POST',
        url: '/api/v1/auth',
        headers: {
          authorization: 'Bearer secret-jwt-token',
          cookie: 'session_id=12345',
          'content-type': 'application/json',
        },
        socket: { remoteAddress: '10.0.0.1' },
      };

      const serialized = reqSerializer(mockReq);
      expect(serialized.headers.authorization).toBe('[REDACTED]');
      expect(serialized.headers.cookie).toBe('[REDACTED]');
      expect(serialized.headers['content-type']).toBe('application/json');
    }
  });
});
