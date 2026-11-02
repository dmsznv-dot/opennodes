import { describe, it, expect } from 'vitest';
import {
  ConnectorDefinition,
  ConnectorContext,
  SafeHttpClient,
  ConnectorError,
  ActionExecutionError,
  ConnectorManifestSchema,
} from '../src/index.js';

describe('Connector SDK Core Contracts', () => {
  it('validates a ConnectorDefinition with actions', async () => {
    const mockConnector: ConnectorDefinition = {
      id: 'core.echo',
      name: 'Echo Connector',
      description: 'Echoes back input payload',
      version: '1.0.0',
      category: 'core',
      actions: {
        echo: {
          name: 'echo',
          description: 'Echoes input',
          async execute(input: { message: string }, _ctx: ConnectorContext) {
            return { reply: input.message };
          },
        },
      },
    };

    const mockCtx: ConnectorContext = {
      workspaceId: 'ws_test_1',
      logger: {
        info: () => {},
        warn: () => {},
        error: () => {},
        debug: () => {},
      },
      httpClient: new SafeHttpClient(),
    };

    const result = await mockConnector.actions.echo.execute({ message: 'hello world' }, mockCtx);
    expect(result).toEqual({ reply: 'hello world' });
  });

  it('validates ConnectorManifest schema', () => {
    const manifest = {
      id: 'core.httpRequest',
      name: 'HTTP Request',
      description: 'Performs external HTTP requests with SSRF protection',
      version: '1.0.0',
      category: 'core',
      actions: {
        request: {
          name: 'request',
          displayName: 'HTTP Request',
          inputs: [
            {
              id: 'input',
              name: 'Request Options',
              type: 'json',
              direction: 'input',
            },
          ],
          outputs: [
            {
              id: 'output',
              name: 'Response Data',
              type: 'json',
              direction: 'output',
            },
          ],
        },
      },
    };

    const parsed = ConnectorManifestSchema.parse(manifest);
    expect(parsed.id).toBe('core.httpRequest');
    expect(parsed.actions.request?.displayName).toBe('HTTP Request');
  });

  it('validates ConnectorManifest schema with triggers', () => {
    const manifest = {
      id: 'integrations.telegram',
      name: 'Telegram',
      description: 'Telegram bot actions and webhook triggers',
      version: '1.0.0',
      category: 'integrations',
      triggers: {
        message: {
          name: 'message',
          displayName: 'On Incoming Message',
          type: 'telegram',
          description: 'Triggers when a message is received by the bot',
          outputs: [
            {
              id: 'message',
              name: 'Message Payload',
              type: 'json',
              direction: 'output',
            },
          ],
        },
      },
      actions: {},
    };

    const parsed = ConnectorManifestSchema.parse(manifest);
    expect(parsed.id).toBe('integrations.telegram');
    expect(parsed.triggers.message?.displayName).toBe('On Incoming Message');
    expect(parsed.triggers.message?.type).toBe('telegram');
    expect(parsed.triggers.message?.outputs).toHaveLength(1);
    expect(parsed.triggers.message?.outputs[0]?.id).toBe('message');
  });

  it('instantiates ConnectorError and ActionExecutionError', () => {
    const connErr = new ConnectorError('Connector init failure', 'core.telegram');
    expect(connErr.code).toBe('ERR_CONNECTOR');
    expect(connErr.connectorId).toBe('core.telegram');

    const actErr = new ActionExecutionError('Request timeout', 'send', 'core.http');
    expect(actErr.code).toBe('ERR_ACTION_EXECUTION');
    expect(actErr.actionName).toBe('send');
    expect(actErr.connectorId).toBe('core.http');
  });
});
