import { createPgDb } from '@localflow/db';
import { createLogger } from '@localflow/observability';
import {
  BullMQQueueManager,
  CrashRecoveryService,
} from '@localflow/workflow-engine';
import { loadWorkerConfig } from './config.js';
import { WorkerDaemon } from './worker-daemon.js';

export * from './config.js';
export * from './worker-daemon.js';
export * from './handlers/execution-handler.js';
export * from './handlers/delay-handler.js';

export async function startWorkerProcess(): Promise<WorkerDaemon> {
  const config = loadWorkerConfig();
  const logger = createLogger({ level: config.LOG_LEVEL });
  const db = createPgDb({ connectionString: config.DATABASE_URL });
  const queueManager = new BullMQQueueManager({ url: config.REDIS_URL });
  const recoveryService = new CrashRecoveryService(
    db,
    queueManager.executionProducer,
    logger
  );

  const daemon = new WorkerDaemon(
    config,
    db,
    queueManager,
    recoveryService,
    logger
  );

  const handleSignal = async (signal: string) => {
    logger.info({ signal }, 'Received termination signal');
    try {
      await daemon.shutdown();
      process.exit(0);
    } catch (err) {
      logger.error({ err }, 'Error during shutdown');
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => void handleSignal('SIGTERM'));
  process.on('SIGINT', () => void handleSignal('SIGINT'));

  await daemon.start();
  return daemon;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startWorkerProcess().catch((err) => {
    console.error('Fatal worker startup error:', err);
    process.exit(1);
  });
}
