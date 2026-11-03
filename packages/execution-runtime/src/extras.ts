import dns from 'node:dns/promises';
import net from 'node:net';
import tls from 'node:tls';
import { randomUUID } from 'node:crypto';
import { ActionExecutionError } from '@localflow/connector-sdk';
import { feedText, markdownToTelegramHtml } from '@localflow/connectors-core';
import {
  isAllowlisted,
  isBlockedHostname,
  isBlockedIp,
  type SafeHttpClient,
} from '@localflow/shared';
import type { NodeExecutor } from '@localflow/workflow-engine';
import type { CredentialResolver } from './connectors.js';
import { extractLinks } from './process.js';
import { markdownToSlack, toText } from './text.js';

export interface ExtrasOptions {
  httpClient: SafeHttpClient;
  resolveCredential: CredentialResolver;
  ssrfAllowlist?: string[];
}

const fail = (type: string, message: string): never => {
  throw new ActionExecutionError(message, type, type);
};

// ── Text: process ─────────────────────────────────────────────────────────────

/** What the "Text: process" step can do; each one turns `input` into `result`. */
export const TEXT_OPERATIONS = [
  'stripHtml',
  'truncate',
  'replace',
  'extractLinks',
  'extractRegex',
  'upper',
  'lower',
  'trim',
  'firstLine',
] as const;

export function formatText(input: string, config: Record<string, unknown>): string {
  const op = String(config.operation ?? 'stripHtml');
  switch (op) {
    case 'stripHtml':
      return feedText(input.replace(/<\/(p|div|li|h[1-6])>/gi, '\n'), { stripTags: true })
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
        .join('\n');
    case 'truncate': {
      const max = Math.max(1, Number(config.maxLength) || 1000);
      if (input.length <= max) return input;
      // Cut at a word boundary when one is close, and mark the cut.
      const cut = input.slice(0, max - 1);
      const space = cut.lastIndexOf(' ');
      return `${space > max * 0.8 ? cut.slice(0, space) : cut}…`;
    }
    case 'replace':
      return config.find
        ? input.split(String(config.find)).join(String(config.replaceWith ?? ''))
        : input;
    case 'extractLinks':
      return extractLinks(input).join('\n');
    case 'extractRegex': {
      let re: RegExp;
      try {
        re = new RegExp(String(config.pattern ?? ''), 'u');
      } catch (err) {
        return fail(
          'text.format',
          `Text: the pattern is not a valid regular expression (${(err as Error).message}).`
        );
      }
      const m = input.match(re);
      return m ? (m[1] ?? m[0]) : '';
    }
    case 'upper':
      return input.toUpperCase();
    case 'lower':
      return input.toLowerCase();
    case 'trim':
      return input
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
        .join('\n');
    case 'firstLine':
      return (
        input
          .split('\n')
          .find((l) => l.trim())
          ?.trim() ?? ''
      );
    default:
      return fail('text.format', `Text: unknown operation "${op}".`);
  }
}

function textExecutor(): NodeExecutor {
  return {
    async execute(_node, config) {
      const input =
        typeof config.input === 'string' ? config.input : JSON.stringify(config.input ?? '');
      const result = formatText(input, config);
      return { output: { result, length: result.length }, activeOutputs: ['main'] };
    },
  };
}

// ── Discord / Slack incoming webhooks ─────────────────────────────────────────

function webhookExecutor(kind: 'discord' | 'slack', options: ExtrasOptions): NodeExecutor {
  const type = `${kind}.sendMessage`;
  const name = kind === 'discord' ? 'Discord' : 'Slack';
  return {
    async execute(node, config, step) {
      const credentialId = node.data.credentialId;
      if (!credentialId) fail(type, `${name}: no connection selected for this step.`);
      const cred = await options.resolveCredential(credentialId!, step.workspaceId);
      if (cred.type !== kind)
        fail(type, `${name}: the selected connection is not a ${name} webhook.`);
      const url = String(cred.secrets.webhookUrl ?? '');
      if (!url) fail(type, `${name}: the connection has no webhook address.`);
      // Discord reads Markdown as is; Slack has its own flavour (mrkdwn).
      const typed = toText(config.text).trim();
      const text = kind === 'slack' ? markdownToSlack(typed) : typed;
      const imageUrl = String(config.imageUrl ?? '').trim();
      if (!text && !imageUrl) fail(type, `${name}: write the message text.`);

      // Discord takes up to 2000 characters per message, Slack about 40 000.
      const body =
        kind === 'discord'
          ? {
              content: text.slice(0, 2000),
              ...(config.username ? { username: String(config.username) } : {}),
              ...(imageUrl && { embeds: [{ image: { url: imageUrl } }] }),
            }
          : {
              text,
              ...(imageUrl && {
                blocks: [
                  ...(text ? [{ type: 'section', text: { type: 'mrkdwn', text } }] : []),
                  { type: 'image', image_url: imageUrl, alt_text: 'image' },
                ],
              }),
            };
      let res;
      try {
        res = await options.httpClient.request<any>({
          url: kind === 'discord' ? `${url}${url.includes('?') ? '&' : '?'}wait=true` : url,
          method: 'POST',
          data: body,
          timeoutMs: 20_000,
          allowlist: options.ssrfAllowlist,
        });
      } catch (err) {
        // Never echo the webhook address: it is the secret.
        const msg = (err as Error).message.split(url).join('***');
        return fail(type, `${name}: could not reach the webhook (${msg}).`);
      }
      if (res.status >= 400) {
        const detail =
          typeof res.data === 'string' ? res.data.slice(0, 200) : (res.data?.message ?? '');
        fail(
          type,
          `${name}: the webhook answered HTTP ${res.status}${detail ? ` — ${detail}` : ''}.`
        );
      }
      return {
        output: { ok: true, status: res.status, messageId: res.data?.id ?? null },
        activeOutputs: ['main'],
      };
    },
  };
}

// ── Email over SMTP ───────────────────────────────────────────────────────────

const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');
/** RFC 2047 encoding for non-ASCII header text. */
const headerText = (s: string) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${b64(s)}?=`);
const wrap76 = (s: string) => s.replace(/.{1,76}/g, '$&\r\n');

export function buildMessage(input: {
  from: string;
  to: string[];
  subject: string;
  body: string;
  html: boolean;
  messageId: string;
}): string {
  return [
    `From: ${input.from}`,
    `To: ${input.to.join(', ')}`,
    `Subject: ${headerText(input.subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: ${input.messageId}`,
    'MIME-Version: 1.0',
    `Content-Type: text/${input.html ? 'html' : 'plain'}; charset=UTF-8`,
    'Content-Transfer-Encoding: base64',
    '',
    wrap76(b64(input.body)),
  ].join('\r\n');
}

/** One SMTP conversation: reads replies (multi-line aware) and sends commands. */
class SmtpSession {
  private buffer = '';
  private waiters: Array<(line: string) => void> = [];
  constructor(private socket: net.Socket | tls.TLSSocket) {
    this.attach(socket);
  }
  private attach(socket: net.Socket | tls.TLSSocket) {
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      this.buffer += chunk;
      // A reply is complete when its last line has a space after the code: "250 OK".
      for (;;) {
        const m = this.buffer.match(/^(?:\d{3}-[^\n]*\n)*\d{3}(?: [^\n]*)?\n/);
        if (!m) break;
        this.buffer = this.buffer.slice(m[0].length);
        this.waiters.shift()?.(m[0].trim());
      }
    });
  }
  reply(timeoutMs = 20_000): Promise<string> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('the mail server stopped answering')),
        timeoutMs
      );
      this.waiters.push((line) => {
        clearTimeout(timer);
        resolve(line);
      });
    });
  }
  async cmd(line: string, expect: number[]): Promise<string> {
    this.socket.write(`${line}\r\n`);
    const res = await this.reply();
    const code = Number(res.slice(0, 3));
    if (!expect.includes(code)) {
      const shown = line.startsWith('AUTH') ? 'AUTH' : line.split(' ')[0];
      throw new Error(`${shown} was refused: ${res.split('\n').pop()}`);
    }
    return res;
  }
  async upgrade(host: string): Promise<void> {
    const plain = this.socket;
    plain.removeAllListeners('data');
    this.socket = await new Promise<tls.TLSSocket>((resolve, reject) => {
      const s = tls.connect({ socket: plain, servername: host }, () => resolve(s));
      s.once('error', reject);
    });
    this.attach(this.socket);
  }
  end() {
    this.socket.end();
  }
}

/** The address to connect to, checked against the SSRF policy like any HTTP call. */
async function resolveMailHost(host: string, port: number, allowlist: string[]) {
  const allowed = isAllowlisted(host, undefined, port, allowlist);
  if (!allowed && isBlockedHostname(host)) throw new Error(`${host} is blocked by the SSRF policy`);
  const ip = net.isIP(host) ? host : (await dns.lookup(host)).address;
  if (!allowed && isBlockedIp(ip)) {
    throw new Error(
      `${host} is a private/local address and is blocked by the SSRF policy; add "${host}:${port}" to SSRF_ALLOWLIST`
    );
  }
  return { ip, allowed };
}

export async function sendMail(
  smtp: { host: string; port: number; secure: boolean; user?: string; password?: string },
  message: { from: string; to: string[]; raw: string },
  allowlist: string[] = []
): Promise<void> {
  const { ip, allowed } = await resolveMailHost(smtp.host, smtp.port, allowlist);
  const socket: net.Socket | tls.TLSSocket = await new Promise((resolve, reject) => {
    const s = smtp.secure
      ? tls.connect({ host: ip, port: smtp.port, servername: smtp.host }, () => resolve(s))
      : net.connect({ host: ip, port: smtp.port }, () => resolve(s));
    s.once('error', reject);
    s.setTimeout(30_000, () => s.destroy(new Error('the mail server did not answer in time')));
  });
  const session = new SmtpSession(socket);
  try {
    const greeting = await session.reply();
    if (!greeting.startsWith('220')) throw new Error(`unexpected greeting: ${greeting}`);
    let ehlo = await session.cmd('EHLO opennodes.local', [250]);
    let encrypted = smtp.secure;
    if (!encrypted && /STARTTLS/i.test(ehlo)) {
      await session.cmd('STARTTLS', [220]);
      await session.upgrade(smtp.host);
      encrypted = true;
      ehlo = await session.cmd('EHLO opennodes.local', [250]);
    }
    // A password never travels in the clear, except to a server you allowlisted yourself.
    if (!encrypted && !allowed) {
      throw new Error(
        'the server offers no encryption (TLS/STARTTLS); use port 465 with "Secure" or 587'
      );
    }
    if (smtp.user) {
      await session.cmd(`AUTH PLAIN ${b64(`\0${smtp.user}\0${smtp.password ?? ''}`)}`, [235]);
    }
    const addr = (a: string) => a.match(/<([^>]+)>/)?.[1] ?? a.trim();
    await session.cmd(`MAIL FROM:<${addr(message.from)}>`, [250]);
    for (const to of message.to) await session.cmd(`RCPT TO:<${addr(to)}>`, [250, 251]);
    await session.cmd('DATA', [354]);
    await session.cmd(`${message.raw}\r\n.`, [250]);
    await session.cmd('QUIT', [221]).catch(() => {});
  } finally {
    session.end();
  }
}

function smtpExecutor(options: ExtrasOptions): NodeExecutor {
  return {
    async execute(node, config, step) {
      const credentialId = node.data.credentialId;
      if (!credentialId) fail('core.smtp', 'Email: no mail connection selected for this step.');
      const cred = await options.resolveCredential(credentialId!, step.workspaceId);
      if (!['smtp', 'email', 'core.smtp'].includes(cred.type)) {
        fail('core.smtp', 'Email: the selected connection is not an SMTP mailbox.');
      }
      const s = cred.secrets;
      const port = Number(s.port) || 465;
      const from = String(s.from || s.user || '');
      const to = String(config.to ?? '')
        .split(/[,;\s]+/)
        .map((x) => x.trim())
        .filter(Boolean);
      if (!to.length) fail('core.smtp', 'Email: enter at least one recipient in “To”.');
      if (!from) fail('core.smtp', 'Email: the connection has no sender address.');
      const messageId = `<${randomUUID()}@opennodes>`;
      let body = toText(config.body ?? config.text);
      let html = config.isHtml === true || config.isHtml === 'true';
      // Markdown in a plain email (**bold**, [links](…), e.g. from an AI step) is sent formatted.
      if (!html && /\*\*\S|\[[^\]\n]+\]\(https?:\/\//.test(body)) {
        body = `<div style="font-family:sans-serif;line-height:1.5">${markdownToTelegramHtml(body).replace(/\n/g, '<br>\n')}</div>`;
        html = true;
      }
      const raw = buildMessage({
        from,
        to,
        subject: toText(config.subject),
        body,
        html,
        messageId,
      });
      try {
        await sendMail(
          {
            host: String(s.host ?? ''),
            port,
            secure:
              s.secure === undefined ? port === 465 : s.secure === true || s.secure === 'true',
            user: s.user ? String(s.user) : undefined,
            password: s.password ? String(s.password) : undefined,
          },
          { from, to, raw },
          options.ssrfAllowlist
        );
      } catch (err) {
        const msg = (err as Error).message.split(String(s.password ?? '\u0000')).join('***');
        fail('core.smtp', `Email: ${msg}.`);
      }
      return { output: { ok: true, messageId, accepted: to }, activeOutputs: ['main'] };
    },
  };
}

/** Steps added on top of the packaged connectors. */
export function buildExtraExecutors(options: ExtrasOptions): Record<string, NodeExecutor> {
  return {
    'text.format': textExecutor(),
    'discord.sendMessage': webhookExecutor('discord', options),
    'slack.sendMessage': webhookExecutor('slack', options),
    'core.smtp': smtpExecutor(options),
  };
}
