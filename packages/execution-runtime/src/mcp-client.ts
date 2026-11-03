import type { SafeHttpClient } from '@localflow/shared';

/**
 * A small MCP client for remote servers over Streamable HTTP (JSON-RPC 2.0 by POST,
 * answered with JSON or an SSE stream). Requests go through the SSRF-safe HTTP client,
 * so an MCP server URL obeys the same policy as any other outgoing call.
 */

export const MCP_PROTOCOL_VERSION = '2025-06-18';

export interface McpTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export interface McpToolResult {
  isError: boolean;
  /** Text parts joined; other parts (images, resources) are summarized. */
  text: string;
  structured?: unknown;
}

export class McpError extends Error {}

export interface McpServerConfig {
  url: string;
  /** Sent as `Authorization: Bearer …` when set. */
  token?: string;
}

/** The JSON-RPC message with `id` from a JSON or SSE response body. */
function pickResponse(body: string, contentType: string, id: number): any {
  if (contentType.includes('text/event-stream')) {
    for (const event of body.split(/\r?\n\r?\n/)) {
      const data = event
        .split(/\r?\n/)
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(5).trimStart())
        .join('\n');
      if (!data) continue;
      try {
        const msg = JSON.parse(data);
        if (msg?.id === id) return msg;
      } catch {
        // Not JSON (keep-alive or comment): skip.
      }
    }
    return undefined;
  }
  const parsed = JSON.parse(body);
  return Array.isArray(parsed) ? parsed.find((m) => m?.id === id) : parsed;
}

export class McpClient {
  private sessionId?: string;
  private nextId = 1;
  private ready?: Promise<void>;

  constructor(
    private readonly server: McpServerConfig,
    private readonly http: SafeHttpClient,
    private readonly allowlist: string[] = [],
    private readonly timeoutMs = 30_000
  ) {}

  private async post(payload: Record<string, unknown>, expectId?: number): Promise<any> {
    const res = await this.http.fetch(this.server.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-protocol-version': MCP_PROTOCOL_VERSION,
        ...(this.server.token && { authorization: `Bearer ${this.server.token}` }),
        ...(this.sessionId && { 'mcp-session-id': this.sessionId }),
      },
      body: JSON.stringify({ jsonrpc: '2.0', ...payload }),
      timeoutMs: this.timeoutMs,
      allowlist: this.allowlist,
    });
    const session = res.headers['mcp-session-id'];
    if (session) this.sessionId = session;
    if (res.status === 401 || res.status === 403) {
      throw new McpError(`the server refused access (HTTP ${res.status}); check the token.`);
    }
    if (res.status >= 400) {
      throw new McpError(`the server answered HTTP ${res.status}.`);
    }
    if (expectId === undefined) return undefined;
    let msg: any;
    try {
      msg = pickResponse(res.data, res.headers['content-type'] ?? '', expectId);
    } catch {
      throw new McpError('the server did not answer with MCP JSON-RPC.');
    }
    if (!msg) throw new McpError('the server sent no answer to the request.');
    if (msg.error) {
      throw new McpError(String(msg.error.message ?? 'request failed'));
    }
    return msg.result;
  }

  private request(method: string, params: Record<string, unknown> = {}): Promise<any> {
    const id = this.nextId++;
    return this.post({ id, method, params }, id);
  }

  /** initialize + notifications/initialized, once per client. */
  connect(): Promise<void> {
    this.ready ??= (async () => {
      await this.request('initialize', {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: 'OpenNodes', version: '0.1.0' },
      });
      await this.post({ method: 'notifications/initialized' });
    })();
    return this.ready;
  }

  async listTools(): Promise<McpTool[]> {
    await this.connect();
    const tools: McpTool[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 20; page++) {
      const res = await this.request('tools/list', cursor ? { cursor } : {});
      tools.push(...((res?.tools ?? []) as McpTool[]));
      cursor = res?.nextCursor;
      if (!cursor) break;
    }
    return tools;
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<McpToolResult> {
    await this.connect();
    const res = await this.request('tools/call', { name, arguments: args });
    const parts: Array<{ type: string; text?: string; mimeType?: string; resource?: any }> =
      res?.content ?? [];
    const text = parts
      .map((p) =>
        p.type === 'text'
          ? (p.text ?? '')
          : p.type === 'resource' && typeof p.resource?.text === 'string'
            ? p.resource.text
            : `[${p.type}${p.mimeType ? ` ${p.mimeType}` : ''}]`
      )
      .join('\n');
    return { isError: Boolean(res?.isError), text, structured: res?.structuredContent };
  }
}
