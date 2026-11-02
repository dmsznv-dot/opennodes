import { describe, it, expect } from 'vitest';
import { createInMemoryDb } from '@localflow/db';
import { createLogger } from '@localflow/observability';
import {
  InMemoryQueueManager,
  CrashRecoveryService,
} from '@localflow/workflow-engine';
import { loadWorkerConfig, WorkerDaemon } from '../src/index.js';

describe('@localflow/worker', () => {
  it('boots WorkerDaemon, performs startup crash scan, and shuts down cleanly', async () => {
    const db = await createInMemoryDb();
    const queueManager = new InMemoryQueueManager();
    const logger = createLogger({ level: 'error' });
    const recoveryService = new CrashRecoveryService(
      db,
      queueManager.executionProducer,
      logger
    );
    const config = loadWorkerConfig({
      NODE_ENV: 'test',
      REDIS_URL: 'mock',
      ORPHAN_SCAN_INTERVAL_MS: '60000',
      WORKER_DRAIN_TIMEOUT_MS: '500',
    });

    const daemon = new WorkerDaemon(
      config,
      db,
      queueManager,
      recoveryService,
      logger
    );

    await daemon.start();
    expect(daemon.running).toBe(true);

    await daemon.shutdown();
    expect(daemon.running).toBe(false);
  });
});
