import dns from 'node:dns/promises';
import net from 'node:net';
import http from 'node:http';
import https from 'node:https';
import { isBlockedIp, isBlockedHostname } from './blocklist.js';
import { isAllowlisted } from './allowlist.js';
import { createPinnedAgent } from './agent-pinning.js';
import { normalizeIp } from './ip-normalizer.js';
import { SsrfBlockedError, DisallowedProtocolError } from './errors.js';

export interface SafeRequestOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string | Buffer | Record<string, unknown>;
  params?: Record<string, string | number | boolean>;
  timeoutMs?: number;
  maxRedirects?: number;
  allowlist?: string[];
}

export interface SafeResponse<T = unknown> {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  data: string;
  json(): T;
}

export interface HttpRequestOptions {
  url: string;
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | string;
  headers?: Record<string, string>;
  params?: Record<string, string | number | boolean>;
  data?: unknown;
  timeoutMs?: number;
  maxRedirects?: number;
  allowlist?: string[];
}

export interface HttpResponse<T = unknown> {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  data: T;
}

export class SafeHttpClient {
  private readonly defaultTimeout: number;

  constructor(timeoutMs = 10000) {
    this.defaultTimeout = timeoutMs;
  }

  public async fetch(urlStr: string, options: SafeRequestOptions = {}): Promise<SafeResponse> {
    return this.executeWithRedirects(urlStr, options, 0);
  }

  public async request<T = unknown>(options: HttpRequestOptions): Promise<HttpResponse<T>> {
    let targetUrl = options.url;
    if (options.params && Object.keys(options.params).length > 0) {
      const parsed = new URL(targetUrl);
      for (const [k, v] of Object.entries(options.params)) {
        parsed.searchParams.set(k, String(v));
      }
      targetUrl = parsed.toString();
    }

    let bodyData: string | Buffer | undefined = undefined;
    if (options.data !== undefined) {
      if (typeof options.data === 'string' || Buffer.isBuffer(options.data)) {
        bodyData = options.data;
      } else {
        bodyData = JSON.stringify(options.data);
      }
    }

    const headers = { ...(options.headers ?? {}) };
    if (bodyData && typeof bodyData === 'string' && !headers['content-type'] && !headers['Content-Type']) {
      try {
        JSON.parse(bodyData);
        headers['Content-Type'] = 'application/json';
      } catch {
        // Not JSON, leave as is
      }
    }

    const res = await this.fetch(targetUrl, {
      method: options.method ?? 'GET',
      headers,
      body: bodyData,
      timeoutMs: options.timeoutMs,
      maxRedirects: options.maxRedirects,
      allowlist: options.allowlist,
    });

    let parsedData: unknown = res.data;
    try {
      parsedData = res.json();
    } catch {
      // Keep as string if not JSON
    }

    return {
      status: res.status,
      statusText: res.statusText,
      headers: res.headers,
      data: parsedData as T,
    };
  }

  private async executeWithRedirects(
    urlStr: string,
    options: SafeRequestOptions,
    redirectHop: number
  ): Promise<SafeResponse> {
    const maxRedirects = options.maxRedirects ?? 5;
    if (redirectHop > maxRedirects) {
      throw new Error(`Max redirects (${maxRedirects}) exceeded.`);
    }

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(urlStr);
    } catch {
      throw new Error(`Invalid URL: ${urlStr}`);
    }

    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      throw new DisallowedProtocolError(
        `Disallowed protocol: ${parsedUrl.protocol}. Only http: and https: are permitted.`
      );
    }

    const hostname = parsedUrl.hostname;
    const port = parsedUrl.port ? Number(parsedUrl.port) : parsedUrl.protocol === 'https:' ? 443 : 80;

    // Check allowlist
    const allowlisted = isAllowlisted(hostname, undefined, port, options.allowlist);
    let pinnedIp: string;

    if (!allowlisted) {
      if (isBlockedHostname(hostname)) {
        throw new SsrfBlockedError(`Access to hostname '${hostname}' is blocked by SSRF policy.`);
      }

      // Check if hostname is raw IP
      const normalizedHostIp = normalizeIp(hostname);
      if (net.isIP(normalizedHostIp)) {
        if (isBlockedIp(normalizedHostIp)) {
          throw new SsrfBlockedError(`Access to IP address '${hostname}' is blocked by SSRF policy.`);
        }
        pinnedIp = normalizedHostIp;
      } else {
        // Resolve DNS and validate ALL addresses
        let records;
        try {
          records = await dns.lookup(hostname, { all: true });
        } catch (err: any) {
          throw new Error(`DNS resolution failed for hostname '${hostname}': ${err.message}`);
        }

        if (!records || records.length === 0) {
          throw new Error(`No IP addresses found for hostname '${hostname}'.`);
        }

        for (const record of records) {
          if (isBlockedIp(record.address)) {
            throw new SsrfBlockedError(
              `Hostname '${hostname}' resolved to blocked IP '${record.address}'. Blocked by SSRF policy.`
            );
          }
        }
        pinnedIp = records[0]!.address;
      }
    } else {
      // In allowlist: resolve DNS without blocking
      const normalizedHostIp = normalizeIp(hostname);
      if (net.isIP(normalizedHostIp)) {
        pinnedIp = normalizedHostIp;
      } else {
        const records = await dns.lookup(hostname);
        pinnedIp = records.address;
      }
    }

    // Connect with socket IP pinning
    const isHttps = parsedUrl.protocol === 'https:';
    const agent = createPinnedAgent({ pinnedIp, isHttps });

    const client = isHttps ? https : http;
    const reqOptions: https.RequestOptions = {
      method: options.method ?? 'GET',
      hostname, // Keeps SNI valid for HTTPS
      port,
      path: parsedUrl.pathname + parsedUrl.search,
      headers: {
        Host: parsedUrl.host,
        ...(options.headers ?? {}),
      },
      agent,
      timeout: options.timeoutMs ?? this.defaultTimeout,
    };

    return new Promise<SafeResponse>((resolve, reject) => {
      const req = client.request(reqOptions, async (res) => {
        const statusCode = res.statusCode ?? 200;

        // Redirect handling (301, 302, 303, 307, 308)
        if ([301, 302, 303, 307, 308].includes(statusCode) && res.headers.location) {
          agent.destroy();
          try {
            const redirectTarget = new URL(res.headers.location, parsedUrl).toString();
            const redirectRes = await this.executeWithRedirects(redirectTarget, options, redirectHop + 1);
            resolve(redirectRes);
          } catch (err) {
            reject(err);
          }
          return;
        }

        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
        res.on('end', () => {
          agent.destroy();
          const raw = Buffer.concat(chunks).toString('utf8');
          const responseHeaders: Record<string, string> = {};
          for (const [k, v] of Object.entries(res.headers)) {
            if (v !== undefined) {
              responseHeaders[k] = Array.isArray(v) ? v.join(', ') : v;
            }
          }

          resolve({
            status: statusCode,
            statusText: res.statusMessage ?? '',
            headers: responseHeaders,
            data: raw,
            json<T = unknown>(): T {
              return JSON.parse(raw) as T;
            },
          });
        });
      });

      req.on('timeout', () => {
        req.destroy();
        agent.destroy();
        reject(new Error(`Request timed out after ${options.timeoutMs ?? this.defaultTimeout}ms`));
      });

      req.on('error', (err) => {
        agent.destroy();
        reject(err);
      });

      if (options.body) {
        if (Buffer.isBuffer(options.body) || typeof options.body === 'string') {
          req.write(options.body);
        } else {
          req.write(JSON.stringify(options.body));
        }
      }
      req.end();
    });
  }
}

export const safeHttpClient = new SafeHttpClient();
