import { ActionExecutionError } from '@localflow/connector-sdk';
import type { SafeHttpClient } from '@localflow/shared';
import type { NodeExecutor } from '@localflow/workflow-engine';
import type { CredentialResolver } from './connectors.js';
import { toText } from './text.js';
import { McpClient, McpError, type McpTool } from './mcp-client.js';

/** Connection types an agent can think with (OpenAI-style chat completions with tools). */
const CHAT_TYPES = ['openai', 'ai.openai', 'openai-compatible'];
export const MCP_CREDENTIAL_TYPE = 'mcp';

const MAX_STEPS = 20;
const RESULT_CHARS = 8_000; // what the model gets back from one tool call
const LOG_CHARS = 1_000; // what the run history keeps of it

export interface AgentOptions {
  httpClient: SafeHttpClient;
  resolveCredential: CredentialResolver;
  ssrfAllowlist?: string[];
}

export interface AgentToolCall {
  server: string;
  tool: string;
  arguments: unknown;
  ok: boolean;
  result: string;
}

const fail = (message: string): never => {
  throw new ActionExecutionError(`AI agent: ${message}`, 'agent', 'ai.agent');
};

const list = (v: unknown): string[] =>
  (Array.isArray(v) ? v : String(v ?? '').split(/[\s,]+/))
    .map((x) => String(x).trim())
    .filter(Boolean);

/** OpenAI function names allow [a-zA-Z0-9_-]{1,64}; MCP tool names may not fit. */
const fnName = (i: number, tool: string) =>
  `s${i}__${tool.replace(/[^a-zA-Z0-9_-]/g, '_')}`.slice(0, 64);

/**
 * "AI agent": a chat model that may call the tools of the MCP servers chosen on the step
 * (Google Docs, Notion, GitHub, …) until it has an answer. Every tool call is kept in the
 * step's output, so the run history shows exactly what the agent did.
 */
export function buildAgentExecutor(options: AgentOptions): NodeExecutor {
  return {
    async execute(node, config, step) {
      const prompt = toText(config.prompt).trim();
      if (!prompt) fail('write the task in “Task”.');
      const credentialId = node.data.credentialId;
      if (!credentialId) fail('no AI connection selected for this step.');
      const chat = await options.resolveCredential(credentialId!, step.workspaceId);
      if (!CHAT_TYPES.includes(chat.type)) {
        fail(`the connection "${chat.type}" cannot call tools; choose an OpenAI-compatible one.`);
      }
      const baseUrl = String(chat.secrets.baseUrl ?? 'https://api.openai.com/v1').replace(
        /\/+$/,
        ''
      );
      const model = String(config.model || chat.secrets.defaultModel || '').trim();
      if (!model) fail('choose a model (on the step or as the connection default).');

      // Tools of every chosen MCP server, under names the model can call.
      const servers = list(config.servers);
      if (!servers.length) fail('choose at least one MCP server.');
      const allowed = new Set(list(config.allowedTools));
      const tools: Array<{ fn: string; server: string; client: McpClient; tool: McpTool }> = [];
      for (const [i, id] of servers.entries()) {
        const cred = await options.resolveCredential(id, step.workspaceId);
        if (cred.type !== MCP_CREDENTIAL_TYPE) fail(`connection ${id} is not an MCP server.`);
        const client = new McpClient(
          {
            url: String(cred.secrets.url ?? ''),
            token: (cred.secrets.token as string) || undefined,
          },
          options.httpClient,
          options.ssrfAllowlist
        );
        const label = String(cred.secrets.name ?? new URL(String(cred.secrets.url)).host);
        let serverTools: McpTool[];
        try {
          serverTools = await client.listTools();
        } catch (err) {
          fail(`MCP server ${label}: ${err instanceof Error ? err.message : String(err)}`);
        }
        for (const tool of serverTools!) {
          if (allowed.size && !allowed.has(tool.name)) continue;
          tools.push({ fn: fnName(i, tool.name), server: label, client, tool });
        }
      }
      if (!tools.length) fail('the chosen MCP servers offer no tools (or none are allowed).');

      const maxSteps = Math.min(Math.max(Number(config.maxSteps) || 6, 1), MAX_STEPS);
      const messages: Array<Record<string, unknown>> = [
        {
          role: 'system',
          content:
            String(config.system ?? '').trim() ||
            'You are an automation agent. Use the tools to complete the task, then reply with a short summary of what you did.',
        },
        { role: 'user', content: prompt },
      ];
      const calls: AgentToolCall[] = [];
      const http = options.httpClient;

      for (let turn = 0; turn < maxSteps; turn++) {
        const res = await http.request<any>({
          url: `${baseUrl}/chat/completions`,
          method: 'POST',
          headers: chat.secrets.apiKey ? { Authorization: `Bearer ${chat.secrets.apiKey}` } : {},
          data: {
            model,
            messages,
            tools: tools.map((t) => ({
              type: 'function',
              function: {
                name: t.fn,
                description: (t.tool.description ?? t.tool.name).slice(0, 1024),
                parameters: t.tool.inputSchema ?? { type: 'object', properties: {} },
              },
            })),
            tool_choice: 'auto',
          },
          timeoutMs: 120_000,
          allowlist: options.ssrfAllowlist,
        });
        if (res.status >= 400) {
          const detail = res.data?.error?.message ?? res.data?.message ?? '';
          fail(`the model answered HTTP ${res.status}${detail ? ` — ${detail}` : ''}.`);
        }
        const message = res.data?.choices?.[0]?.message;
        if (!message) fail('the model returned no message.');
        const toolCalls: any[] = message.tool_calls ?? [];
        if (!toolCalls.length) {
          return {
            output: { text: String(message.content ?? ''), toolCalls: calls, steps: turn + 1 },
            activeOutputs: ['main'],
          };
        }
        messages.push({
          role: 'assistant',
          content: message.content ?? null,
          tool_calls: toolCalls,
        });
        for (const call of toolCalls) {
          const target = tools.find((t) => t.fn === call.function?.name);
          let args: Record<string, unknown> = {};
          let content: string;
          let ok = false;
          try {
            args = JSON.parse(call.function?.arguments || '{}');
            if (!target) throw new McpError(`unknown tool ${call.function?.name}`);
            const out = await target.client.callTool(target.tool.name, args);
            ok = !out.isError;
            content = out.text || JSON.stringify(out.structured ?? '');
          } catch (err) {
            content = `Error: ${err instanceof Error ? err.message : String(err)}`;
          }
          calls.push({
            server: target?.server ?? '?',
            tool: target?.tool.name ?? String(call.function?.name),
            arguments: args,
            ok,
            result: content.slice(0, LOG_CHARS),
          });
          messages.push({
            role: 'tool',
            tool_call_id: call.id,
            content: content.slice(0, RESULT_CHARS),
          });
        }
      }
      fail(
        `stopped after ${maxSteps} steps without a final answer (${calls.length} tool calls). Raise “Max steps” or simplify the task.`
      );
      return undefined as never;
    },
  };
}

/** "Check connection" for an MCP server: the tools it offers. */
export async function listMcpTools(
  secrets: Record<string, unknown>,
  http: SafeHttpClient,
  allowlist: string[] = []
): Promise<McpTool[]> {
  const client = new McpClient(
    { url: String(secrets.url ?? ''), token: (secrets.token as string) || undefined },
    http,
    allowlist,
    15_000
  );
  return client.listTools();
}
