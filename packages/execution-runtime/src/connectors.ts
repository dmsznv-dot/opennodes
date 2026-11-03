import {
  SsrfBlockedError,
  type HttpRequestOptions,
  type HttpResponse,
  type SafeHttpClient,
} from '@localflow/shared';
import {
  ActionExecutionError,
  type ConnectorContext,
  type ConnectorDefinition,
} from '@localflow/connector-sdk';
import { CORE_CONNECTORS } from '@localflow/connectors-core';
import { AI_CONNECTORS } from '@localflow/connectors-ai';
import { buildProcessExecutor } from './process.js';
import { renderForParseMode, textFields, toText } from './text.js';
import type { NodeExecutor, StepExecutionContext } from '@localflow/workflow-engine';

/** Returns the decrypted secrets of a credential that belongs to `workspaceId`. */
export type CredentialResolver = (
  credentialId: string,
  workspaceId: string
) => Promise<{ type: string; secrets: Record<string, unknown> }>;

export interface ConnectorRuntimeOptions {
  httpClient: SafeHttpClient;
  resolveCredential: CredentialResolver;
  /** Hosts that may be reached despite the SSRF policy (e.g. a local Ollama). */
  ssrfAllowlist?: string[];
  /** Telegram Bot API base for sending (tests, a local Bot API server). */
  telegramApiBase?: string;
}

/**
 * Connectors whose package implementation does not talk to the real service yet.
 * They fail loudly instead of returning fabricated success (BUG-01 / S-2).
 */
const NOT_IMPLEMENTED: Record<string, string> = {
  'core.postgresSql': 'Running SQL against an external PostgreSQL is not implemented yet.',
};

/**
 * Connection type for a self-hosted model server speaking the OpenAI API:
 * LM Studio, Ollama (`/v1`), llama.cpp `llama-server`, Jan, vLLM, LocalAI.
 * Secrets: `baseUrl` (required), `apiKey` (optional), `defaultModel` (optional).
 */
export const LOCAL_LLM_CREDENTIAL_TYPE = 'openai-compatible';

interface CredentialPolicy {
  /** Connection types this connector accepts. */
  types: string[];
  /** Config keys that would hold a secret in plain workflow JSON; always dropped. */
  configSecretKeys: string[];
  /** Why the step cannot run with this input/connection, or undefined when it can. */
  check(
    input: Record<string, unknown>,
    secrets: Record<string, unknown> | undefined
  ): string | undefined;
}

const CREDENTIAL_POLICY: Record<string, CredentialPolicy> = {
  'core.telegramBot': {
    types: ['telegram', 'core.telegramBot'],
    // apiBase is set by the server, never by a workflow (it would receive the token).
    configSecretKeys: ['botToken', 'apiBase'],
    check: (_input, secrets) =>
      !secrets
        ? 'no connection selected for this step. Add a Telegram bot connection and select it.'
        : !secrets.botToken
          ? 'the selected connection has no "botToken".'
          : undefined,
  },
  'ai.openai': {
    types: ['openai', 'ai.openai', LOCAL_LLM_CREDENTIAL_TYPE],
    configSecretKeys: ['apiKey'],
    check: (input, secrets) =>
      secrets?.apiKey || secrets?.baseUrl || input.baseUrl
        ? undefined
        : 'no connection selected. Add an OpenAI key, or a local model server (LM Studio, Ollama, llama.cpp) as an "openai-compatible" connection.',
  },
  'ai.ollama': {
    types: ['ollama', 'ai.ollama', LOCAL_LLM_CREDENTIAL_TYPE],
    configSecretKeys: [],
    check: () => undefined,
  },
};

/**
 * Connectors whose HTTP status is their result: the user branches on `status` and
 * a 4xx/5xx is data, not a failure. Every other connector fails the step on 4xx/5xx.
 */
const STATUS_IS_OUTPUT = new Set(['core.httpRequest']);

function describeHttpError(data: unknown): string {
  let body = data;
  if (typeof data === 'string') {
    try {
      body = JSON.parse(data);
    } catch {
      return data.slice(0, 200);
    }
  }
  if (body && typeof body === 'object') {
    const b = body as Record<string, any>;
    const msg = b.description ?? b.error?.message ?? b.error ?? b.message;
    if (typeof msg === 'string') return msg.slice(0, 200);
  }
  return '';
}

/**
 * Per-step HTTP client: applies the SSRF allowlist and, unless the connector's
 * status is its output, turns 4xx/5xx into a step failure. The error never echoes
 * the request URL, which for Telegram contains the bot token.
 */
/**
 * How long a step waits for its service. The HTTP client's 10 s default suits APIs, but a
 * language model often needs longer to write an answer, and a local one longer still.
 */
const STEP_TIMEOUT_MS: Record<string, number> = {
  'ai.openai': 120_000,
  'ai.ollama': 300_000,
  'core.rss': 30_000,
};

function stepHttpClient(
  base: SafeHttpClient,
  connector: ConnectorDefinition,
  allowlist: string[] | undefined
): SafeHttpClient {
  return {
    request: async <T>(options: HttpRequestOptions): Promise<HttpResponse<T>> => {
      let res: HttpResponse<T>;
      const timeoutMs = options.timeoutMs ?? STEP_TIMEOUT_MS[connector.id];
      try {
        res = await base.request<T>({
          ...options,
          ...(timeoutMs && { timeoutMs }),
          allowlist: [...(options.allowlist ?? []), ...(allowlist ?? [])],
        });
      } catch (err) {
        if (err instanceof Error && /timed out/i.test(err.message)) {
          const seconds = Math.round((timeoutMs ?? 10_000) / 1000);
          throw new ActionExecutionError(
            `${connector.name}: no answer within ${seconds} s. The service or model is busy or slow — try again, or pick a faster model.`,
            Object.keys(connector.actions)[0] ?? connector.id,
            connector.id
          );
        }
        if (err instanceof SsrfBlockedError) {
          let target = 'this host';
          try {
            target = new URL(options.url).host;
          } catch {
            /* keep generic */
          }
          throw new ActionExecutionError(
            `${connector.name}: ${target} is a private/local address and is blocked by the SSRF policy. ` +
              `If it is your own model server, add "${target}" to SSRF_ALLOWLIST.`,
            Object.keys(connector.actions)[0] ?? connector.id,
            connector.id
          );
        }
        throw err;
      }
      if (res.status >= 400 && !STATUS_IS_OUTPUT.has(connector.id)) {
        const detail = describeHttpError(res.data);
        throw new ActionExecutionError(
          `${connector.name}: the service answered HTTP ${res.status}${detail ? ` — ${detail}` : ''}`,
          Object.keys(connector.actions)[0] ?? connector.id,
          connector.id,
          { httpStatus: res.status }
        );
      }
      return res;
    },
  } as unknown as SafeHttpClient;
}

function fail(connector: ConnectorDefinition, message: string, code: string): never {
  const err = new ActionExecutionError(
    message,
    Object.keys(connector.actions)[0] ?? connector.id,
    connector.id
  );
  (err as { code: string }).code = code;
  throw err;
}

function connectorExecutor(
  connector: ConnectorDefinition,
  options: ConnectorRuntimeOptions
): NodeExecutor {
  return {
    async execute(node, evaluatedConfig, step: StepExecutionContext) {
      const notImplemented = NOT_IMPLEMENTED[connector.id];
      if (notImplemented) {
        fail(
          connector,
          `${connector.name}: ${notImplemented} The step was not run, nothing was sent.`,
          'ERR_CONNECTOR_NOT_IMPLEMENTED'
        );
      }

      const actionNames = Object.keys(connector.actions);
      const actionName =
        actionNames.length === 1 ? actionNames[0]! : String(evaluatedConfig.operation ?? '');
      const action = connector.actions[actionName];
      if (!action) {
        fail(
          connector,
          `${connector.name}: choose an operation (${actionNames.join(', ')}).`,
          'ERR_CONNECTOR_OPERATION'
        );
      }

      const input: Record<string, unknown> = { ...evaluatedConfig };
      const policy = CREDENTIAL_POLICY[connector.id];
      // Secrets only come from the encrypted vault, never from plain workflow config.
      for (const key of policy?.configSecretKeys ?? []) delete input[key];

      let credentials: Record<string, unknown> | undefined;
      const credentialId = node.data.credentialId;
      if (credentialId) {
        const cred = await options.resolveCredential(credentialId, step.workspaceId);
        const accepted = policy?.types ?? [connector.credentialType, connector.id];
        if (!accepted.includes(cred.type)) {
          fail(
            connector,
            `${connector.name}: the selected connection is of type "${cred.type}", expected one of: ${accepted.filter(Boolean).join(', ')}.`,
            'ERR_CREDENTIAL_TYPE_MISMATCH'
          );
        }
        credentials = cred.secrets;
      }
      const problem = policy?.check(input, credentials);
      if (problem) fail(connector, `${connector.name}: ${problem}`, 'ERR_CREDENTIAL_MISSING');

      if (connector.id === 'ai.openai' || connector.id === 'ai.ollama') {
        // The connection decides which server is called; the step picks the model.
        if (typeof credentials?.baseUrl === 'string') input.baseUrl = credentials.baseUrl;
        if (input.model === undefined && typeof credentials?.defaultModel === 'string') {
          input.model = credentials.defaultModel;
        }
      }
      textFields(connector.id, input);
      if (connector.id === 'core.telegramBot') {
        // Data inserted into HTML/Markdown text is escaped; the step's own markup stays.
        const raw = node.data.config?.text ?? node.data.config?.caption;
        const escaped =
          typeof raw === 'string'
            ? renderForParseMode(
                raw,
                input.parseMode,
                step.expressionScope as Record<string, unknown>
              )
            : undefined;
        if (escaped !== undefined) input.text = escaped;
      }
      if (connector.id === 'core.rss' && input.url === undefined) input.url = input.feedUrl;
      if (connector.id === 'core.telegramBot' && options.telegramApiBase) {
        input.apiBase = options.telegramApiBase;
      }
      if (connector.id === 'ai.openai' && !input.messages && typeof input.prompt === 'string') {
        input.messages = [
          ...(typeof input.system === 'string' && input.system
            ? [{ role: 'system', content: input.system }]
            : []),
          { role: 'user', content: input.prompt },
        ];
      }

      const log =
        (level: 'info' | 'warn' | 'error' | 'debug') =>
        (msg: string, ...args: unknown[]) =>
          step.logger[level](msg, args.length ? { args } : undefined);
      const ctx: ConnectorContext = {
        workspaceId: step.workspaceId,
        credentials,
        logger: { info: log('info'), warn: log('warn'), error: log('error'), debug: log('debug') },
        httpClient: stepHttpClient(options.httpClient, connector, options.ssrfAllowlist),
        fsRoot: step.fsRoot,
      };

      const output = await action.execute(input, ctx);

      // Telegram can report a failure inside a 200 body.
      if (
        connector.id === 'core.telegramBot' &&
        output &&
        typeof output === 'object' &&
        (output as { ok?: unknown }).ok === false
      ) {
        fail(
          connector,
          `${connector.name}: ${describeHttpError(output) || 'the API rejected the request'}`,
          'ERR_ACTION_EXECUTION'
        );
      }
      return { output: normalizeOutput(connector.id, input, output), activeOutputs: ['main'] };
    },
  };
}

/** Adds a plain `text` field to model replies so the next step can use `{{ $nodes.x.output.text }}`. */
/**
 * Adds the plain fields the editor's steps expose (`text`, `messageId`, `body`, …) next
 * to each service's raw answer, so `{{ $nodes.x.output.text }}` works for any provider.
 */
function normalizeOutput(
  connectorId: string,
  input: Record<string, unknown>,
  output: unknown
): unknown {
  if (!output || typeof output !== 'object') return output;
  const o = output as Record<string, any>;
  switch (connectorId) {
    case 'ai.openai': {
      const text = o.choices?.[0]?.message?.content;
      return typeof text === 'string' ? { ...o, text } : o;
    }
    case 'ai.ollama':
      return typeof o.response === 'string' ? { ...o, text: o.response } : o;
    case 'core.telegramBot':
      return { ...o, messageId: o.result?.message_id ?? null };
    case 'core.httpRequest':
      return { ...o, body: o.data };
    case 'core.outgoingWebhook':
      return { ...o, status: o.statusCode };
    case 'core.rss': {
      // The reader returns the item list itself.
      const all: Array<Record<string, unknown>> = Array.isArray(output)
        ? output
        : Array.isArray(o.items)
          ? o.items
          : [];
      const max = Number(input.maxItems);
      return summarizeFeed(Number.isFinite(max) && max > 0 ? all.slice(0, max) : all);
    }
    default:
      return o;
  }
}

/** The fields RSS steps expose: the items plus ready-to-use text for posts and prompts. */
export function summarizeFeed(items: Array<Record<string, unknown>>) {
  const titles = items.map((i) => String(i.title ?? '')).filter(Boolean);
  return {
    items,
    count: items.length,
    titles: titles.join('\n'),
    digest: items
      .map((i) => [i.title, i.link].filter(Boolean).join(' — '))
      .filter(Boolean)
      .join('\n'),
    link: String(items[0]?.link ?? ''),
    image: String(items.find((i) => i.image)?.image ?? ''),
  };
}

/** Node executors for every packaged connector, keyed by node type (= connector id). */
export function buildConnectorExecutors(
  options: ConnectorRuntimeOptions
): Record<string, NodeExecutor> {
  const all = { ...CORE_CONNECTORS, ...AI_CONNECTORS };
  const executors: Record<string, NodeExecutor> = Object.fromEntries(
    Object.values(all).map((connector) => [connector.id, connectorExecutor(connector, options)])
  );
  executors['ai.classify'] = classifyExecutor(executors['ai.openai']!);
  executors['telegram.sendFile'] = telegramFileExecutor(executors['core.telegramBot']!);
  executors['ai.process'] = buildProcessExecutor(executors['ai.openai']!, {
    httpClient: options.httpClient,
    ssrfAllowlist: options.ssrfAllowlist,
  });
  return executors;
}

/** "Send a file to Telegram": a photo or document by URL, with an optional caption. */
function telegramFileExecutor(telegram: NodeExecutor): NodeExecutor {
  return {
    execute(node, config, step) {
      const url = String(config.fileUrl ?? '').trim();
      if (!url) {
        throw new ActionExecutionError(
          'Send a file to Telegram: enter the link to the file.',
          'telegramBot',
          'telegram.sendFile'
        );
      }
      return telegram.execute(
        { ...node, type: 'core.telegramBot' },
        {
          chatId: config.chatId,
          text: toText(config.caption),
          parseMode: config.parseMode,
          ...(config.kind === 'document' ? { fileUrl: url } : { imageUrl: url }),
        },
        step
      );
    },
  };
}

/** Node types whose connector exists but does not work yet (the step fails honestly). */
export function notImplementedNodeTypes(): string[] {
  return Object.keys(NOT_IMPLEMENTED);
}

/**
 * "Sort into a category": asks the connection's chat model to pick exactly one of the
 * listed categories and returns it as `category` (matched back to the list's spelling).
 */
function classifyExecutor(chat: NodeExecutor): NodeExecutor {
  return {
    async execute(node, config, step) {
      const categories = String(config.categories ?? '')
        .split(',')
        .map((c) => c.trim())
        .filter(Boolean);
      if (categories.length < 2) {
        throw new ActionExecutionError(
          'Sort into a category: list at least two categories.',
          'classify',
          'ai.classify'
        );
      }
      const prompt =
        `Classify the text into exactly one of these categories: ${categories.join(', ')}.\n` +
        'Answer with the category name only.\n\n' +
        `Text:\n${toText(config.text)}`;
      const result = await chat.execute(
        { ...node, type: 'ai.openai' },
        { model: config.model, temperature: 0, prompt },
        step
      );
      const answer = String((result.output as { text?: unknown })?.text ?? '').trim();
      const plain = answer
        .toLowerCase()
        .replace(/[.!"«»]/g, '')
        .trim();
      const category =
        categories.find((c) => c.toLowerCase() === plain) ??
        // The longest category the answer mentions: "not spam" must not read as "spam".
        [...categories]
          .sort((x, y) => y.length - x.length)
          .find((c) => plain.includes(c.toLowerCase())) ??
        answer;
      return { output: { category, answer }, activeOutputs: ['main'] };
    },
  };
}

/**
 * Lists the models a connection can serve, which doubles as a connection test:
 * OpenAI-compatible servers answer `GET {baseUrl}/models`, native Ollama `GET /api/tags`.
 */
export async function listConnectionModels(
  type: string,
  secrets: Record<string, unknown>,
  options: Pick<ConnectorRuntimeOptions, 'httpClient' | 'ssrfAllowlist'>
): Promise<string[]> {
  const pseudo: ConnectorDefinition = {
    id: 'models',
    name: 'Model list',
    description: '',
    version: '1',
    category: 'ai',
    actions: {},
  };
  const http = stepHttpClient(options.httpClient, pseudo, options.ssrfAllowlist);
  if (type === 'ollama' || type === 'ai.ollama') {
    const base = String(secrets.baseUrl ?? 'http://localhost:11434').replace(/\/+$/, '');
    const res = await http.request<{ models?: Array<{ name?: string }> }>({
      url: `${base}/api/tags`,
    });
    return (res.data?.models ?? []).map((m) => m.name).filter((n): n is string => !!n);
  }
  if (!['openai', 'ai.openai', LOCAL_LLM_CREDENTIAL_TYPE].includes(type)) {
    throw new Error(`Connections of type "${type}" do not serve models.`);
  }
  const base = String(secrets.baseUrl ?? 'https://api.openai.com/v1').replace(/\/+$/, '');
  const res = await http.request<{ data?: Array<{ id?: string }> }>({
    url: `${base}/models`,
    headers: secrets.apiKey ? { Authorization: `Bearer ${String(secrets.apiKey)}` } : {},
  });
  return (res.data?.data ?? []).map((m) => m.id).filter((id): id is string => !!id);
}
