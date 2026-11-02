import type {
  ConnectorAction,
  ConnectorContext,
  ConnectorDefinition,
} from '@localflow/connector-sdk';
import { ActionExecutionError } from '@localflow/connector-sdk';

export interface OpenAIChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface OpenAIChatInput {
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  messages: OpenAIChatMessage[];
  temperature?: number;
  maxTokens?: number;
  responseFormat?: { type: 'text' | 'json_object' };
}

export interface OllamaGenerateInput {
  baseUrl?: string;
  model?: string;
  prompt: string;
  system?: string;
  temperature?: number;
  stream?: boolean;
}

// F33: Generic OpenAI-Compatible LLM Connector
export const openAiChatAction: ConnectorAction<OpenAIChatInput, unknown> = {
  name: 'chatCompletion',
  description: 'Call an OpenAI-compatible /v1/chat/completions endpoint.',
  execute: async (input: OpenAIChatInput, ctx: ConnectorContext) => {
    if (!input.messages || input.messages.length === 0) {
      throw new ActionExecutionError(
        'OpenAI chatCompletion requires at least one message',
        'chatCompletion',
        'ai.openai'
      );
    }
    const baseUrl = (input.baseUrl ?? 'https://api.openai.com/v1').replace(/\/+$/, '');
    const apiKey =
      input.apiKey ??
      (ctx.credentials?.apiKey as string | undefined) ??
      'mock_key';

    const resp = await ctx.httpClient.request({
      url: `${baseUrl}/chat/completions`,
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      data: {
        model: input.model ?? 'gpt-4o-mini',
        messages: input.messages,
        temperature: input.temperature ?? 0.2,
        max_tokens: input.maxTokens,
        response_format: input.responseFormat,
      },
    });

    return {
      status: resp.status,
      ...(typeof resp.data === 'object' && resp.data !== null ? resp.data : { data: resp.data }),
    };
  },
};

// F34: Local Ollama Connector
export const ollamaGenerateAction: ConnectorAction<OllamaGenerateInput, unknown> = {
  name: 'generate',
  description: 'Run local LLM inference via Ollama /api/generate.',
  execute: async (input: OllamaGenerateInput, ctx: ConnectorContext) => {
    if (!input.prompt) {
      throw new ActionExecutionError(
        'Ollama generate requires a non-empty prompt',
        'generate',
        'ai.ollama'
      );
    }
    const baseUrl = (input.baseUrl ?? 'http://localhost:11434').replace(/\/+$/, '');
    const resp = await ctx.httpClient.request({
      url: `${baseUrl}/api/generate`,
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      data: {
        model: input.model ?? 'llama3',
        prompt: input.prompt,
        system: input.system,
        stream: input.stream ?? false,
        options:
          input.temperature !== undefined ? { temperature: input.temperature } : undefined,
      },
    });

    return resp.data;
  },
};

export const openAiConnector: ConnectorDefinition = {
  id: 'ai.openai',
  name: 'OpenAI-Compatible LLM',
  description: 'Chat completions with OpenAI or any compatible LLM API.',
  version: '1.0.0',
  category: 'ai',
  credentialType: 'openai',
  actions: {
    chatCompletion: openAiChatAction,
  },
};

export const ollamaConnector: ConnectorDefinition = {
  id: 'ai.ollama',
  name: 'Local Ollama',
  description: 'Local LLM inference using Ollama.',
  version: '1.0.0',
  category: 'ai',
  actions: {
    generate: ollamaGenerateAction,
  },
};

export const AI_CONNECTORS: Record<string, ConnectorDefinition> = {
  'ai.openai': openAiConnector,
  'ai.ollama': ollamaConnector,
};
