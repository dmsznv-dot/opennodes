import { describe, it, expect } from 'vitest';
import {
  AI_CONNECTORS,
  openAiChatAction,
  ollamaGenerateAction,
} from '../src/index.js';
import type { ConnectorContext } from '@localflow/connector-sdk';

describe('@localflow/connectors-ai', () => {
  const mockCtx: ConnectorContext = {
    workspaceId: 'ws-1',
    credentials: { apiKey: 'sk-test-key' },
    logger: {
      info: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {},
    },
    httpClient: {
      request: async (opts: any) => ({
        status: 200,
        statusText: 'OK',
        headers: {},
        data: {
          echoUrl: opts.url,
          model: opts.data?.model,
          choices: [{ message: { role: 'assistant', content: 'Summary OK' } }],
          response: 'Ollama local response',
        },
      }),
    } as any,
  };

  it('registers ai.openai and ai.ollama connectors', () => {
    expect(Object.keys(AI_CONNECTORS)).toEqual(['ai.openai', 'ai.ollama']);
  });

  it('executes OpenAI-compatible chatCompletion (F33)', async () => {
    const res = (await openAiChatAction.execute(
      {
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: 'Hello' }],
      },
      mockCtx
    )) as any;

    expect(res.status).toBe(200);
    expect(res.choices[0].message.content).toBe('Summary OK');
  });

  it('executes local Ollama generate action (F34)', async () => {
    const res = (await ollamaGenerateAction.execute(
      {
        model: 'llama3',
        prompt: 'Diagnose server load',
      },
      mockCtx
    )) as any;

    expect(res.response).toBe('Ollama local response');
  });
});
