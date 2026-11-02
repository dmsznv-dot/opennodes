import { describe, it, expect, vi } from 'vitest';
import http from 'node:http';
import {
  isIpInCidr,
  normalizeIp,
  isBlockedIp,
  isBlockedHostname,
  isAllowlisted,
  SafeHttpClient,
  SsrfBlockedError,
  DisallowedProtocolError,
} from '../src/ssrf/index.js';

describe('SSRF Protection Engine', () => {
  describe('CIDR checking', () => {
    it('correctly matches IPv4 addresses in CIDR ranges', () => {
      expect(isIpInCidr('127.0.0.1', '127.0.0.0/8')).toBe(true);
      expect(isIpInCidr('127.255.255.254', '127.0.0.0/8')).toBe(true);
      expect(isIpInCidr('10.20.30.40', '10.0.0.0/8')).toBe(true);
      expect(isIpInCidr('172.16.5.4', '172.16.0.0/12')).toBe(true);
      expect(isIpInCidr('172.31.255.255', '172.16.0.0/12')).toBe(true);
      expect(isIpInCidr('172.32.0.1', '172.16.0.0/12')).toBe(false);
      expect(isIpInCidr('192.168.1.1', '192.168.0.0/16')).toBe(true);
      expect(isIpInCidr('8.8.8.8', '192.168.0.0/16')).toBe(false);
      expect(isIpInCidr('169.254.169.254', '169.254.0.0/16')).toBe(true);
    });

    it('correctly matches IPv6 addresses in CIDR ranges', () => {
      expect(isIpInCidr('::1', '::1/128')).toBe(true);
      expect(isIpInCidr('fe80::1', 'fe80::/10')).toBe(true);
      expect(isIpInCidr('fc00::1', 'fc00::/7')).toBe(true);
      expect(isIpInCidr('2001:4860:4860::8888', 'fc00::/7')).toBe(false);
    });
  });

  describe('IP Normalizer', () => {
    it('normalizes DWORD decimal integers', () => {
      expect(normalizeIp('2130706433')).toBe('127.0.0.1');
    });

    it('normalizes Hex IP strings', () => {
      expect(normalizeIp('0x7f000001')).toBe('127.0.0.1');
    });

    it('normalizes Octal and mixed base notation', () => {
      expect(normalizeIp('0177.0.0.1')).toBe('127.0.0.1');
    });

    it('normalizes IPv4-mapped IPv6', () => {
      expect(normalizeIp('::ffff:127.0.0.1')).toBe('127.0.0.1');
    });

    it('strips brackets from IPv6', () => {
      expect(normalizeIp('[::1]')).toBe('::1');
    });
  });

  describe('Blocklist & Hostname Detection', () => {
    it('identifies blocked IPv4 addresses', () => {
      expect(isBlockedIp('127.0.0.1')).toBe(true);
      expect(isBlockedIp('10.0.0.1')).toBe(true);
      expect(isBlockedIp('169.254.169.254')).toBe(true);
      expect(isBlockedIp('172.16.0.1')).toBe(true);
      expect(isBlockedIp('192.168.1.1')).toBe(true);
      expect(isBlockedIp('8.8.8.8')).toBe(false);
      expect(isBlockedIp('1.1.1.1')).toBe(false);
    });

    it('identifies blocked hostnames', () => {
      expect(isBlockedHostname('localhost')).toBe(true);
      expect(isBlockedHostname('sub.localhost')).toBe(true);
      expect(isBlockedHostname('app.local')).toBe(true);
      expect(isBlockedHostname('metadata.google.internal')).toBe(true);
      expect(isBlockedHostname('service.internal')).toBe(true);
      expect(isBlockedHostname('api.github.com')).toBe(false);
    });
  });

  describe('Allowlist checking', () => {
    it('honors exact host and wildcard entries', () => {
      const allowlist = ['localhost:8080', '*.corp.internal', '192.168.1.50'];
      expect(isAllowlisted('localhost', undefined, 8080, allowlist)).toBe(true);
      expect(isAllowlisted('localhost', undefined, 3000, allowlist)).toBe(false);
      expect(isAllowlisted('api.corp.internal', undefined, 443, allowlist)).toBe(true);
      expect(isAllowlisted('corp.internal', undefined, 443, allowlist)).toBe(true);
      expect(isAllowlisted('example.com', undefined, 443, allowlist)).toBe(false);
      expect(isAllowlisted('host', '192.168.1.50', 80, allowlist)).toBe(true);
    });
  });

  describe('SafeHttpClient Security Enforcement', () => {
    const client = new SafeHttpClient();

    it('rejects disallowed protocols like file:, ftp:, gopher:', async () => {
      await expect(client.fetch('file:///etc/passwd')).rejects.toThrow(DisallowedProtocolError);
      await expect(client.fetch('ftp://ftp.example.com')).rejects.toThrow(DisallowedProtocolError);
      await expect(client.fetch('gopher://localhost:70')).rejects.toThrow(DisallowedProtocolError);
    });

    it('blocks direct request to loopback IP', async () => {
      await expect(client.fetch('http://127.0.0.1:8080/admin')).rejects.toThrow(SsrfBlockedError);
    });

    it('blocks request to cloud metadata IP', async () => {
      await expect(client.fetch('http://169.254.169.254/latest/meta-data/')).rejects.toThrow(
        SsrfBlockedError
      );
    });

    it('blocks obfuscated loopback formats', async () => {
      await expect(client.fetch('http://2130706433/')).rejects.toThrow(SsrfBlockedError);
      await expect(client.fetch('http://0x7f000001/')).rejects.toThrow(SsrfBlockedError);
      await expect(client.fetch('http://0177.0.0.1/')).rejects.toThrow(SsrfBlockedError);
    });

    it('blocks localhost hostname', async () => {
      await expect(client.fetch('http://localhost:3000/')).rejects.toThrow(SsrfBlockedError);
      await expect(client.fetch('http://test.localhost/')).rejects.toThrow(SsrfBlockedError);
    });

    it('supports request() interface with params and JSON body', async () => {
      // Create local mock HTTP server that will be allowlisted for this test
      const server = http.createServer((req, res) => {
        if (req.url?.startsWith('/redirect')) {
          res.writeHead(302, { Location: 'http://127.0.0.1:9999/malicious' });
          res.end();
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, method: req.method }));
      });

      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
      const port = (server.address() as any).port;
      const targetUrl = `http://127.0.0.1:${port}/api/test`;

      try {
        // Request without allowlist should fail
        await expect(client.request({ url: targetUrl })).rejects.toThrow(SsrfBlockedError);

        // Request with explicit allowlist should succeed
        const response = await client.request<{ success: boolean; method: string }>({
          url: targetUrl,
          method: 'POST',
          data: { hello: 'world' },
          allowlist: [`127.0.0.1:${port}`],
        });

        expect(response.status).toBe(200);
        expect(response.data.success).toBe(true);
        expect(response.data.method).toBe('POST');

        // Test redirect intercept: server redirects to 127.0.0.1:9999 which is not allowlisted
        const redirectUrl = `http://127.0.0.1:${port}/redirect`;
        await expect(
          client.request({
            url: redirectUrl,
            allowlist: [`127.0.0.1:${port}`], // Only initial port is allowlisted
          })
        ).rejects.toThrow(SsrfBlockedError);
      } finally {
        server.close();
      }
    });
  });
});
