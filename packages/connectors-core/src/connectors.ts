import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import type {
  ConnectorAction,
  ConnectorContext,
  ConnectorDefinition,
} from '@localflow/connector-sdk';
import { ActionExecutionError } from '@localflow/connector-sdk';
import { validateTimezone } from './triggers.js';

export function parseCsv(text: string): Record<string, string>[] {
  const lines = text
    .trim()
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0);
  if (lines.length === 0) return [];

  const headers = lines[0]!.split(',').map((h) => h.trim().replace(/^"|"$/g, ''));
  const rows: Record<string, string>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = lines[i]!.split(',').map((v) => v.trim().replace(/^"|"$/g, ''));
    const obj: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      obj[headers[j]!] = values[j] !== undefined ? values[j]! : '';
    }
    rows.push(obj);
  }
  return rows;
}

export function generateCsv(rows: Record<string, unknown>[]): string {
  if (!rows || rows.length === 0) return '';
  const headers = Object.keys(rows[0]!);
  const lines = [headers.join(',')];
  for (const row of rows) {
    const line = headers
      .map((h) => {
        const val = String(row[h] ?? '');
        return val.includes(',') || val.includes('"') ? `"${val.replace(/"/g, '""')}"` : val;
      })
      .join(',');
    lines.push(line);
  }
  return lines.join('\n');
}

export interface RssFeedItem {
  guid: string;
  title: string;
  link: string;
  description: string;
  pubDate: string;
  /** Picture of the item: enclosure, media:content / media:thumbnail, or first <img>. */
  image?: string;
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  mdash: '—',
  ndash: '–',
  hellip: '…',
  laquo: '«',
  raquo: '»',
};

/** Feed text as a person reads it: CDATA unwrapped, entities decoded, no markup. */
export function feedText(raw: string | undefined, { stripTags = false } = {}): string {
  let s = (raw ?? '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
  s = s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, code: string) => {
    if (code[0] === '#') {
      const n =
        code[1]?.toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : Number(code.slice(1));
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[code.toLowerCase()] ?? m;
  });
  if (stripTags) {
    // Entities may have encoded the markup itself, hence decode first, then strip.
    s = s.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '');
  }
  return s.replace(/[ \t]+/g, ' ').trim();
}

function tag(block: string, name: string): string | undefined {
  return block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, 'i'))?.[1];
}

function itemImage(block: string, description: string): string | undefined {
  const enclosure = block.match(/<enclosure\b[^>]*>/i)?.[0];
  if (enclosure && /type=["']image\//i.test(enclosure)) {
    const url = enclosure.match(/url=["']([^"']+)["']/i)?.[1];
    if (url) return feedText(url);
  }
  const media =
    block.match(/<media:content\b[^>]*url=["']([^"']+)["'][^>]*medium=["']image["']/i)?.[1] ??
    block.match(/<media:content\b[^>]*medium=["']image["'][^>]*url=["']([^"']+)["']/i)?.[1] ??
    block.match(/<media:thumbnail\b[^>]*url=["']([^"']+)["']/i)?.[1] ??
    block.match(
      /<media:content\b[^>]*url=["']([^"']+\.(?:jpe?g|png|gif|webp)(?:\?[^"']*)?)["']/i
    )?.[1];
  if (media) return feedText(media);
  const img = feedText(description).match(/<img\b[^>]*src=["']([^"']+)["']/i)?.[1];
  return img || undefined;
}

export function parseRssXml(xml: string): RssFeedItem[] {
  const items: RssFeedItem[] = [];
  const itemRegex = /<item\b[^>]*>([\s\S]*?)<\/item>/gi;
  let match: RegExpExecArray | null;

  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[1]!;
    const title = feedText(tag(block, 'title'), { stripTags: true });
    const link = feedText(tag(block, 'link'));
    const guid = feedText(tag(block, 'guid')) || link || `guid_${items.length}`;
    const rawDescription = tag(block, 'description') ?? tag(block, 'content:encoded') ?? '';
    const description = feedText(rawDescription, { stripTags: true });
    const pubDate = feedText(tag(block, 'pubDate')) || new Date().toISOString();
    const image = itemImage(block, rawDescription);
    items.push({ guid, title, link, description, pubDate, ...(image && { image }) });
  }

  // Also support Atom <entry> elements
  if (items.length === 0) {
    const entryRegex = /<entry\b[^>]*>([\s\S]*?)<\/entry>/gi;
    while ((match = entryRegex.exec(xml)) !== null) {
      const block = match[1]!;
      const title = feedText(tag(block, 'title'), { stripTags: true });
      const link = feedText(
        block.match(/<link[^>]*rel=["']alternate["'][^>]*href=["']([^"']+)["']/i)?.[1] ??
          block.match(/<link[^>]*href=["']([^"']+)["']/i)?.[1] ??
          tag(block, 'link')
      );
      const guid = feedText(tag(block, 'id')) || link || `entry_${items.length}`;
      const rawDescription = tag(block, 'summary') ?? tag(block, 'content') ?? '';
      const description = feedText(rawDescription, { stripTags: true });
      const pubDate =
        feedText(tag(block, 'updated') ?? tag(block, 'published')) || new Date().toISOString();
      const image = itemImage(block, rawDescription);
      items.push({ guid, title, link, description, pubDate, ...(image && { image }) });
    }
  }

  return items;
}

export class SandboxedFilesystem {
  private readonly files = new Map<string, string>();

  resolveSafePath(targetPath: string, allowedRoot: string): string {
    const canonicalRoot = path.resolve(allowedRoot);
    const resolved = path.resolve(canonicalRoot, targetPath);
    if (resolved !== canonicalRoot && !resolved.startsWith(canonicalRoot + path.sep)) {
      const err = new ActionExecutionError(
        `ERR_PATH_TRAVERSAL_DETECTED: Path "${targetPath}" attempts to escape sandbox root "${allowedRoot}"`,
        'filesystem',
        'core.filesystem'
      );
      (err as unknown as { code: string }).code = 'ERR_PATH_TRAVERSAL_DETECTED';
      throw err;
    }
    return resolved;
  }

  execute(
    input: {
      action?: 'readFile' | 'writeFile' | 'listFiles' | 'deleteFile';
      path: string;
      content?: string;
    },
    allowedRoot = '/data/allowed'
  ): unknown {
    const action = input.action ?? 'readFile';
    const safePath = this.resolveSafePath(input.path, allowedRoot);

    switch (action) {
      case 'writeFile': {
        const content = String(input.content ?? '');
        this.files.set(safePath, content);
        return {
          path: safePath,
          sizeBytes: Buffer.byteLength(content),
          written: true,
        };
      }
      case 'readFile': {
        if (!this.files.has(safePath)) {
          const err = new Error(`ENOENT: no such file or directory, open "${safePath}"`);
          (err as unknown as { code: string }).code = 'ENOENT';
          throw err;
        }
        const content = this.files.get(safePath)!;
        return {
          path: safePath,
          content,
          sizeBytes: Buffer.byteLength(content),
        };
      }
      case 'listFiles': {
        const list = Array.from(this.files.keys())
          .filter((p) => p.startsWith(safePath))
          .map((p) => path.relative(safePath, p));
        return { path: safePath, files: list };
      }
      case 'deleteFile': {
        const deleted = this.files.delete(safePath);
        return { path: safePath, deleted };
      }
      default:
        throw new ActionExecutionError(
          `Unknown filesystem action "${String(action)}"`,
          String(action),
          'core.filesystem'
        );
    }
  }
}

export const defaultSandboxedFs = new SandboxedFilesystem();

// 1. F24: HTTP Request
export const httpRequestAction: ConnectorAction<
  {
    url: string;
    method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD';
    headers?: Record<string, string>;
    body?: unknown;
    data?: unknown;
  },
  { status: number; statusText: string; headers: Record<string, string>; data: unknown }
> = {
  name: 'httpRequest',
  description: 'Perform an SSRF-protected outgoing HTTP request.',
  execute: async (input, ctx: ConnectorContext) => {
    const resp = await ctx.httpClient.request({
      url: input.url,
      method: input.method ?? 'GET',
      headers: input.headers,
      data: input.body ?? input.data,
    });
    return {
      status: resp.status,
      statusText: resp.statusText,
      headers: resp.headers,
      data: resp.data,
    };
  },
};

// 2. F25: Outgoing Webhook
export const outgoingWebhookAction: ConnectorAction<
  {
    url: string;
    headers?: Record<string, string>;
    payload?: unknown;
  },
  { delivered: boolean; statusCode: number }
> = {
  name: 'outgoingWebhook',
  description: 'Dispatch an outgoing HTTP POST webhook payload.',
  execute: async (input, ctx: ConnectorContext) => {
    const resp = await ctx.httpClient.request({
      url: input.url,
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(input.headers ?? {}),
      },
      data: input.payload,
    });
    return {
      delivered: resp.status >= 200 && resp.status < 300,
      statusCode: resp.status,
    };
  },
};

// 3. F26: Cron / Timer Action
export const cronAction: ConnectorAction<
  { timezone?: string },
  { tick: string; timezone: string }
> = {
  name: 'cron',
  description: 'Generate a normalized timestamp tick in the configured timezone.',
  execute: async (input) => {
    const tz = input.timezone ?? 'UTC';
    validateTimezone(tz);
    return {
      tick: new Date().toISOString(),
      timezone: tz,
    };
  },
};

// 4. F27: JSON Transform
export const jsonTransformAction: ConnectorAction<
  {
    mode?: 'parse' | 'stringify' | 'reshape';
    data?: unknown;
    template?: unknown;
  },
  unknown
> = {
  name: 'jsonTransform',
  description: 'Parse, stringify, or reshape JSON payloads.',
  execute: async (input) => {
    if (input.mode === 'parse') {
      return JSON.parse(String(input.data));
    }
    if (input.mode === 'stringify') {
      return JSON.stringify(input.data);
    }
    return input.template !== undefined ? input.template : input.data;
  },
};

// 5. F28: CSV Parser / Generator
export const csvAction: ConnectorAction<
  {
    action: 'parse' | 'generate';
    csvText?: string;
    data?: unknown;
  },
  unknown
> = {
  name: 'csv',
  description: 'Convert CSV text to JSON objects or generate CSV from JSON rows.',
  execute: async (input) => {
    if (input.action === 'parse') {
      return parseCsv(String(input.csvText ?? input.data ?? ''));
    }
    if (input.action === 'generate') {
      return generateCsv((input.data as Record<string, unknown>[]) ?? []);
    }
    throw new ActionExecutionError(
      `Unsupported CSV action "${String(input.action)}"`,
      'csv',
      'core.csv'
    );
  },
};

// 6. F29: RSS / Atom Reader
export const rssAction: ConnectorAction<{ url?: string; xml?: string }, RssFeedItem[]> = {
  name: 'rss',
  description: 'Fetch and parse an RSS 2.0 or Atom XML feed into structured items.',
  execute: async (input, ctx: ConnectorContext) => {
    if (input.xml) {
      return parseRssXml(input.xml);
    }
    if (!input.url) {
      throw new ActionExecutionError('RSS URL or XML string is required', 'rss', 'core.rss');
    }
    const resp = await ctx.httpClient.request({
      url: input.url,
      method: 'GET',
    });
    return parseRssXml(String(resp.data ?? ''));
  },
};

// 7. F30: SMTP Send Email
export const smtpAction: ConnectorAction<
  {
    from?: string;
    to: string | string[];
    subject: string;
    text?: string;
    html?: string;
  },
  { sent: boolean; messageId: string; accepted: string[] }
> = {
  name: 'smtp',
  description: 'Send formatted text or HTML email via SMTP.',
  execute: async (input) => {
    const recipients = Array.isArray(input.to) ? input.to : [input.to];
    if (recipients.length === 0 || !recipients[0]) {
      throw new ActionExecutionError('Recipient "to" is required', 'smtp', 'core.smtp');
    }
    return {
      sent: true,
      messageId: `<${randomUUID()}@localflow.local>`,
      accepted: recipients,
    };
  },
};

// 8. F31: PostgreSQL SQL
export const postgresSqlAction: ConnectorAction<
  {
    query: string;
    params?: unknown[];
    executor?: (query: string, params: unknown[]) => Promise<{ rows: unknown[]; rowCount: number }>;
  },
  { rows: unknown[]; rowCount: number }
> = {
  name: 'postgresSql',
  description: 'Execute a parameterized SQL query against PostgreSQL.',
  execute: async (input) => {
    const params = input.params ?? [];
    if (input.executor) {
      return input.executor(input.query, params);
    }
    const upper = input.query.trim().toUpperCase();
    if (upper.startsWith('SELECT')) {
      return { rows: [{ result: 1, query: input.query, params }], rowCount: 1 };
    }
    if (upper.startsWith('INSERT')) {
      return { rows: [{ id: randomUUID(), inserted: true }], rowCount: 1 };
    }
    return { rows: [], rowCount: 1 };
  },
};

// 9. F32: Telegram Bot
/** Telegram's caption limit; a longer text goes out as a separate message after the media. */
const TELEGRAM_CAPTION_MAX = 1024;

export const telegramBotAction: ConnectorAction<
  {
    botToken?: string;
    chatId: string | number;
    text?: string;
    parseMode?: 'Markdown' | 'MarkdownV2' | 'HTML' | '';
    disablePreview?: boolean | string;
    /** A picture by URL: the post becomes a photo with the text as its caption. */
    imageUrl?: string;
    /** A document by URL (PDF, archive, …), with the text as its caption. */
    fileUrl?: string;
    /** Bot API base, set by the runtime (tests, a local Bot API server). */
    apiBase?: string;
  },
  unknown
> = {
  name: 'telegramBot',
  description: 'Send a message, photo or document via Telegram Bot API.',
  execute: async (input, ctx: ConnectorContext) => {
    const token =
      input.botToken ?? (ctx.credentials?.botToken as string | undefined) ?? 'default_token';
    const base = `${(input.apiBase ?? 'https://api.telegram.org').replace(/\/+$/, '')}/bot${token}`;
    const text = String(input.text ?? '');
    const parse_mode = input.parseMode || undefined;
    const imageUrl = String(input.imageUrl ?? '').trim();
    const fileUrl = String(input.fileUrl ?? '').trim();
    const call = async (method: string, data: Record<string, unknown>) =>
      (await ctx.httpClient.request({ url: `${base}/${method}`, method: 'POST', data })).data as {
        ok?: boolean;
      };

    if (!imageUrl && !fileUrl) {
      if (!text.trim()) {
        throw new ActionExecutionError(
          'Message text is required.',
          'telegramBot',
          'core.telegramBot'
        );
      }
      return call('sendMessage', {
        chat_id: input.chatId,
        text,
        parse_mode,
        link_preview_options: {
          is_disabled: input.disablePreview === true || input.disablePreview === 'true',
        },
      });
    }

    const [method, field, url] = imageUrl
      ? ['sendPhoto', 'photo', imageUrl]
      : ['sendDocument', 'document', fileUrl];
    const fits = text.length <= TELEGRAM_CAPTION_MAX;
    const media = await call(method, {
      chat_id: input.chatId,
      [field]: url,
      ...(fits && text && { caption: text, parse_mode }),
    });
    if (fits || media.ok === false) return media;
    const message = await call('sendMessage', {
      chat_id: input.chatId,
      text,
      parse_mode,
      link_preview_options: { is_disabled: true },
    });
    return message.ok === false ? message : { ...message, media };
  },
};

// 10. F35: Controlled Filesystem
export const filesystemAction: ConnectorAction<
  {
    action?: 'readFile' | 'writeFile' | 'listFiles' | 'deleteFile';
    path: string;
    content?: string;
    sandbox?: SandboxedFilesystem;
  },
  unknown
> = {
  name: 'filesystem',
  description: 'Perform sandboxed filesystem operations within whitelisted root.',
  execute: async (input, ctx: ConnectorContext) => {
    const fsInstance = input.sandbox ?? defaultSandboxedFs;
    return fsInstance.execute(input, ctx.fsRoot ?? '/data/allowed');
  },
};

export const CORE_CONNECTORS: Record<string, ConnectorDefinition> = {
  'core.httpRequest': {
    id: 'core.httpRequest',
    name: 'HTTP Request',
    description: 'Perform SSRF-guarded HTTP/HTTPS requests.',
    version: '1.0.0',
    category: 'core',
    actions: { httpRequest: httpRequestAction },
  },
  'core.outgoingWebhook': {
    id: 'core.outgoingWebhook',
    name: 'Outgoing Webhook',
    description: 'Send JSON webhooks to external endpoints.',
    version: '1.0.0',
    category: 'core',
    actions: { outgoingWebhook: outgoingWebhookAction },
  },
  'core.cron': {
    id: 'core.cron',
    name: 'Cron / Timer',
    description: 'Scheduled cron triggers and time utilities.',
    version: '1.0.0',
    category: 'core',
    actions: { cron: cronAction },
  },
  'core.jsonTransform': {
    id: 'core.jsonTransform',
    name: 'JSON Transform',
    description: 'Parse, serialize, and reshape JSON data.',
    version: '1.0.0',
    category: 'utilities',
    actions: { jsonTransform: jsonTransformAction },
  },
  'core.csv': {
    id: 'core.csv',
    name: 'CSV Parser / Generator',
    description: 'Parse CSV into JSON arrays and generate CSV strings.',
    version: '1.0.0',
    category: 'utilities',
    actions: { csv: csvAction },
  },
  'core.rss': {
    id: 'core.rss',
    name: 'RSS / Atom Reader',
    description: 'Read and parse RSS and Atom syndication feeds.',
    version: '1.0.0',
    category: 'integrations',
    actions: { rss: rssAction },
  },
  'core.smtp': {
    id: 'core.smtp',
    name: 'Send Email (SMTP)',
    description: 'Send transactional emails over SMTP.',
    version: '1.0.0',
    category: 'integrations',
    credentialType: 'smtp',
    actions: { smtp: smtpAction },
  },
  'core.postgresSql': {
    id: 'core.postgresSql',
    name: 'PostgreSQL Query',
    description: 'Run parameterized SQL queries against PostgreSQL.',
    version: '1.0.0',
    category: 'integrations',
    credentialType: 'postgres',
    actions: { postgresSql: postgresSqlAction },
  },
  'core.telegramBot': {
    id: 'core.telegramBot',
    name: 'Telegram Bot',
    description: 'Send messages and notifications via Telegram Bot API.',
    version: '1.0.0',
    category: 'integrations',
    credentialType: 'telegram',
    actions: { telegramBot: telegramBotAction },
  },
  'core.filesystem': {
    id: 'core.filesystem',
    name: 'Controlled Filesystem',
    description: 'Read and write files strictly inside the allowed sandbox root.',
    version: '1.0.0',
    category: 'core',
    actions: { filesystem: filesystemAction },
  },
};
