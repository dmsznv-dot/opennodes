/**
 * LocalFlow E2E Test Suite - MSW / Simulated API Handlers
 * Mocks external HTTP APIs: OpenAI, Ollama, Telegram Bot, SMTP, and generic HTTP endpoints.
 * Operates purely in-memory with zero network overhead.
 */

import type { HttpRequestOptions, HttpResponse } from './types.ts';

export interface DispatchedEmail {
  from: string;
  to: string | string[];
  cc?: string | string[];
  bcc?: string | string[];
  subject: string;
  text?: string;
  html?: string;
  messageId: string;
  sentAt: Date;
}

export interface DispatchedTelegramMessage {
  botToken: string;
  chatId: string | number;
  text: string;
  parseMode?: string;
  messageId: number;
  sentAt: Date;
}

export class MockServiceRouter {
  private customRoutes = new Map<string, (req: HttpRequestOptions) => Promise<HttpResponse> | HttpResponse>();
  
  // Inspection logs for test assertions
  public sentEmails: DispatchedEmail[] = [];
  public sentTelegramMessages: DispatchedTelegramMessage[] = [];
  public openAiRequests: Array<{ model: string; messages: unknown[]; responseFormat?: unknown }> = [];
  public ollamaRequests: Array<{ model: string; prompt?: string; messages?: unknown[] }> = [];
  public httpCallLog: HttpRequestOptions[] = [];

  private telegramMessageCounter = 1000;
  private emailCounter = 5000;

  // Configuration toggles for error injection
  public telegramRateLimitEnabled = false;
  public smtpFailNext = false;
  public openAiFailNext = false;
  public ollamaConnectionRefused = false;

  reset(): void {
    this.customRoutes.clear();
    this.sentEmails = [];
    this.sentTelegramMessages = [];
    this.openAiRequests = [];
    this.ollamaRequests = [];
    this.httpCallLog = [];
    this.telegramMessageCounter = 1000;
    this.emailCounter = 5000;
    this.telegramRateLimitEnabled = false;
    this.smtpFailNext = false;
    this.openAiFailNext = false;
    this.ollamaConnectionRefused = false;
  }

  getSentEmails(): DispatchedEmail[] {
    return this.sentEmails;
  }

  getSentTelegramMessages(): DispatchedTelegramMessage[] {
    return this.sentTelegramMessages;
  }

  registerRoute(method: string, urlPattern: string, handler: (req: HttpRequestOptions) => Promise<HttpResponse> | HttpResponse): void {
    this.customRoutes.set(`${method.toUpperCase()} ${urlPattern}`, handler);
  }

  async handleRequest(options: HttpRequestOptions): Promise<HttpResponse> {
    this.httpCallLog.push({ ...options });
    const method = (options.method || 'GET').toUpperCase();
    const url = options.url;

    // Check custom routes first
    for (const [routeKey, handler] of this.customRoutes.entries()) {
      const [rMethod, rPattern] = routeKey.split(' ');
      if (rMethod === method && (url === rPattern || url.includes(rPattern))) {
        return handler(options);
      }
    }

    // 1. OpenAI Chat Completions Mock
    if (url.includes('api.openai.com/v1/chat/completions')) {
      if (this.openAiFailNext) {
        this.openAiFailNext = false;
        return {
          status: 429,
          statusText: 'Too Many Requests',
          headers: { 'content-type': 'application/json' },
          data: { error: { message: 'Rate limit exceeded', type: 'requests', code: 'rate_limit_exceeded' } }
        };
      }

      const body = options.data as { model: string; messages: Array<{ role: string; content: string }>; response_format?: unknown };
      const model = body?.model || 'gpt-4o-mini';
      const messages = body?.messages || [];
      this.openAiRequests.push({ model, messages, responseFormat: body?.response_format });

      const lastUserMessage = messages.filter(m => m.role === 'user').pop()?.content || '';
      
      // If structured json output requested
      let content = `Simulated completion for model ${model}: Response to "${lastUserMessage}"`;
      if (body?.response_format || lastUserMessage.toLowerCase().includes('json')) {
        content = JSON.stringify({
          status: 'success',
          summary: `Summary of: ${lastUserMessage.slice(0, 50)}`,
          sentiment: 'positive',
          confidence: 0.95,
          tags: ['automated', 'test']
        });
      }

      return {
        status: 200,
        statusText: 'OK',
        headers: { 'content-type': 'application/json' },
        data: {
          id: `chatcmpl-${Date.now()}`,
          object: 'chat.completion',
          created: Math.floor(Date.now() / 1000),
          model,
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content
              },
              finish_reason: 'stop'
            }
          ],
          usage: {
            prompt_tokens: 25,
            completion_tokens: 30,
            total_tokens: 55
          }
        }
      };
    }

    // 2. Ollama LLM Mock
    if (url.includes(':11434/api/generate') || url.includes(':11434/api/chat')) {
      if (this.ollamaConnectionRefused) {
        throw new Error('connect ECONNREFUSED 127.0.0.1:11434');
      }

      const body = options.data as { model: string; prompt?: string; messages?: Array<{ role: string; content: string }>; stream?: boolean };
      this.ollamaRequests.push({ model: body?.model || 'llama3', prompt: body?.prompt, messages: body?.messages });

      const promptText = body?.prompt || body?.messages?.[body.messages.length - 1]?.content || '';
      return {
        status: 200,
        statusText: 'OK',
        headers: { 'content-type': 'application/json' },
        data: {
          model: body?.model || 'llama3',
          created_at: new Date().toISOString(),
          response: `Ollama local response to: ${promptText}`,
          message: { role: 'assistant', content: `Ollama local chat response to: ${promptText}` },
          done: true,
          total_duration: 1200000000,
          eval_count: 42
        }
      };
    }

    // 3. Telegram Bot API Mock
    const telegramMatch = url.match(/api\.telegram\.org\/bot([^/]+)\/([a-zA-Z]+)/);
    if (telegramMatch) {
      const [, botToken, action] = telegramMatch;
      
      if (this.telegramRateLimitEnabled) {
        this.telegramRateLimitEnabled = false;
        return {
          status: 429,
          statusText: 'Too Many Requests',
          headers: { 'retry-after': '5' },
          data: { ok: false, error_code: 429, description: 'Too Many Requests: retry after 5' }
        };
      }

      if (action === 'sendMessage') {
        const body = options.data as { chat_id: string | number; text: string; parse_mode?: string };
        const msgId = ++this.telegramMessageCounter;
        this.sentTelegramMessages.push({
          botToken,
          chatId: body.chat_id,
          text: body.text,
          parseMode: body.parse_mode,
          messageId: msgId,
          sentAt: new Date()
        });

        return {
          status: 200,
          statusText: 'OK',
          headers: { 'content-type': 'application/json' },
          data: {
            ok: true,
            result: {
              message_id: msgId,
              from: { id: 1234567, is_bot: true, first_name: 'LocalFlowBot', username: 'localflow_bot' },
              chat: { id: body.chat_id, type: 'private' },
              date: Math.floor(Date.now() / 1000),
              text: body.text
            }
          }
        };
      }

      if (action === 'getUpdates') {
        return {
          status: 200,
          statusText: 'OK',
          headers: { 'content-type': 'application/json' },
          data: {
            ok: true,
            result: [
              {
                update_id: 10001,
                message: {
                  message_id: 99,
                  from: { id: 8888, is_bot: false, first_name: 'Alice', username: 'alice' },
                  chat: { id: 8888, type: 'private' },
                  date: Math.floor(Date.now() / 1000),
                  text: '/run workflow_1'
                }
              }
            ]
          }
        };
      }
    }

    // 4. Default Fallback for external HTTP endpoints
    return {
      status: 200,
      statusText: 'OK',
      headers: { 'content-type': 'application/json' },
      data: {
        success: true,
        receivedUrl: url,
        receivedMethod: method,
        timestamp: new Date().toISOString()
      }
    };
  }

  // SMTP Simulation
  async sendEmail(mail: Omit<DispatchedEmail, 'messageId' | 'sentAt'>): Promise<{ messageId: string; accepted: string[] }> {
    if (this.smtpFailNext) {
      this.smtpFailNext = false;
      throw new Error('SMTP Error: Connection refused by host');
    }

    const messageId = `<msg-${++this.emailCounter}@localflow.test>`;
    const record: DispatchedEmail = {
      ...mail,
      messageId,
      sentAt: new Date()
    };
    this.sentEmails.push(record);

    const toArr = Array.isArray(mail.to) ? mail.to : [mail.to];
    return {
      messageId,
      accepted: toArr
    };
  }
}

export const mockServiceRouter = new MockServiceRouter();
