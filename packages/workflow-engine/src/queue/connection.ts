import { Redis } from 'ioredis';

export interface RedisConnectionOptions {
  url?: string;
  host?: string;
  port?: number;
  password?: string;
  db?: number;
  maxRetriesPerRequest?: null;
  enableReadyCheck?: boolean;
  useInMemoryMock?: boolean;
}

export function createRedisConnection(options: RedisConnectionOptions = {}): Redis | { isMock: true } {
  if (
    options.useInMemoryMock ||
    options.url === 'mock' ||
    process.env.REDIS_URL === 'mock'
  ) {
    return { isMock: true };
  }

  const connUrl = options.url || process.env.REDIS_URL || 'redis://localhost:6379';
  return new Redis(connUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    lazyConnect: true,
  });
}
