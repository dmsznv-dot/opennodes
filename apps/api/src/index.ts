export * from './config.js';
export * from './server.js';

import { createLogger } from '@localflow/observability';
import { loadApiConfig } from './config.js';
import { LocalFlowApiServer } from './server.js';

export async function startApiService(): Promise<LocalFlowApiServer> {
  const config = loadApiConfig();
  const logger = createLogger({ level: config.logLevel });
  const server = new LocalFlowApiServer(config);
  const port = await server.listen(config.port, config.host);
  logger.info({ port, host: config.host }, 'LocalFlow API server listening');
  return server;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startApiService().catch((err) => {
    console.error('Fatal error starting LocalFlow API:', err);
    process.exit(1);
  });
}
