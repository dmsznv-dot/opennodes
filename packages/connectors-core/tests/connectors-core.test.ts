import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import {
  parseCronFields,
  validateTimezone,
  verifyWebhookHmac,
  TelegramPollingClient,
  parseCsv,
  generateCsv,
  parseRssXml,
  SandboxedFilesystem,
  CORE_CONNECTORS,
  CORE_TRIGGERS,
} from '../src/index.js';

describe('@localflow/connectors-core', () => {
  it('registers all 4 core triggers and 10 core connectors', () => {
    expect(Object.keys(CORE_TRIGGERS)).toHaveLength(4);
    expect(Object.keys(CORE_CONNECTORS)).toHaveLength(10);
  });

  it('parses cron expressions and validates timezones (F21, F26)', () => {
    const parsed = parseCronFields('*/10 8-18 * * 1-5');
    expect(parsed.minute).toBe('*/10');
    expect(parsed.dayOfWeek).toBe('1-5');
    expect(() => parseCronFields('invalid')).toThrow();
    expect(validateTimezone('UTC')).toBe(true);
    expect(() => validateTimezone('Bad/Zone')).toThrow();
  });

  it('verifies webhook HMAC-SHA256 signatures (F22)', () => {
    const secret = 'whsec_test_123';
    const payload = JSON.stringify({ event: 'order.paid' });
    const sig = createHmac('sha256', secret).update(payload).digest('hex');
    expect(verifyWebhookHmac(payload, secret, sig)).toBe(true);
    expect(verifyWebhookHmac(payload, secret, 'bad_sig')).toBe(false);
  });

  it('tracks Telegram polling offsets and slash commands (F23)', () => {
    const client = new TelegramPollingClient('123:ABC');
    const res = client.processUpdates([
      {
        update_id: 500,
        message: {
          message_id: 1,
          chat: { id: 42 },
          text: '/run daily_sync --force',
        },
      },
    ]);
    expect(res[0]?.command).toBe('run');
    expect(res[0]?.args).toBe('daily_sync --force');
    expect(client.nextOffset).toBe(501);
  });

  it('parses and generates CSV data (F28)', () => {
    const csv = 'name,role\nAlice,admin\nBob,editor';
    const rows = parseCsv(csv);
    expect(rows).toEqual([
      { name: 'Alice', role: 'admin' },
      { name: 'Bob', role: 'editor' },
    ]);
    const regenerated = generateCsv(rows);
    expect(regenerated).toBe(csv);
  });

  it('parses RSS 2.0 and Atom XML feeds (F29)', () => {
    const xml = `<rss><channel><item><guid>1</guid><title>Hello</title><link>https://example.com/1</link><description>Desc</description></item></channel></rss>`;
    const items = parseRssXml(xml);
    expect(items).toHaveLength(1);
    expect(items[0]?.title).toBe('Hello');
  });

  it('enforces sandboxed filesystem boundaries and blocks path traversal (F35)', () => {
    const fs = new SandboxedFilesystem();
    const writeRes = fs.execute(
      { action: 'writeFile', path: 'reports/out.txt', content: 'ok' },
      '/data/allowed'
    ) as { written: boolean };
    expect(writeRes.written).toBe(true);

    const readRes = fs.execute(
      { action: 'readFile', path: 'reports/out.txt' },
      '/data/allowed'
    ) as { content: string };
    expect(readRes.content).toBe('ok');

    expect(() =>
      fs.execute({ action: 'readFile', path: '../../etc/passwd' }, '/data/allowed')
    ).toThrow(/ERR_PATH_TRAVERSAL_DETECTED/);
  });
});
