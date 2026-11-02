import { describe, it, expect, afterAll } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { SafeHttpClient } from '../src/index.js';

/**
 * Requests to a host *name* go through the pinned DNS lookup. Node ≥ 20 asks it for
 * all addresses; answering with a bare string failed every such request with
 * "Invalid IP address: undefined" — api.telegram.org, api.openai.com, localhost:1234.
 */
const server = http.createServer((_req, res) => {
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify({ ok: true }));
});
const listening = new Promise<number>((resolve) =>
  server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port))
);
afterAll(() => new Promise<void>((r) => server.close(() => r())));

describe('SafeHttpClient — pinned lookup by host name', () => {
  it('reaches an allowlisted host by name (DNS resolved, then pinned)', async () => {
    const port = await listening;
    const res = await new SafeHttpClient().request<{ ok: boolean }>({
      url: `http://localhost:${port}/v1/models`,
      allowlist: [`localhost:${port}`],
    });
    expect(res.status).toBe(200);
    expect(res.data).toEqual({ ok: true });
  });

  it('still refuses that host when it is not allowlisted', async () => {
    const port = await listening;
    await expect(
      new SafeHttpClient().request({ url: `http://localhost:${port}/` })
    ).rejects.toThrow(/blocked/i);
  });
});
