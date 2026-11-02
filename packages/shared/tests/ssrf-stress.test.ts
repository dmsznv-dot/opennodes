import { describe, it, expect } from 'vitest';
import http from 'node:http';
import {
  isIpInCidr,
  normalizeIp,
  isBlockedIp,
  isBlockedHostname,
  SafeHttpClient,
  SsrfBlockedError,
  DisallowedProtocolError,
} from '../src/ssrf/index.js';

describe('Adversarial SSRF Stress Testing', () => {
  const client = new SafeHttpClient(3000);

  describe('1. Octal IP Evasion Attacks', () => {
    const octalVectors = [
      { raw: '0177.0.0.1', expectedIp: '127.0.0.1', description: 'Standard octal loopback' },
      { raw: '0177.0000.0000.0001', expectedIp: '127.0.0.1', description: 'Octal with multi-zero padding' },
      { raw: '012.0.0.1', expectedIp: '10.0.0.1', description: 'Octal 10.0.0.1 (private A)' },
      { raw: '0251.0376.0251.0376', expectedIp: '169.254.169.254', description: 'Octal cloud metadata 169.254.169.254' },
      { raw: '0254.0020.0.1', expectedIp: '172.16.0.1', description: 'Octal 172.16.0.1 (private B)' },
      { raw: '0300.0250.0001.0001', expectedIp: '192.168.1.1', description: 'Octal 192.168.1.1 (private C)' },
      { raw: '0177.0.0.01', expectedIp: '127.0.0.1', description: 'Mixed octal single zero padding' },
    ];

    for (const vector of octalVectors) {
      it(`normalizes and blocks octal vector: ${vector.description} (${vector.raw})`, () => {
        const normalized = normalizeIp(vector.raw);
        expect(normalized).toBe(vector.expectedIp);
        expect(isBlockedIp(vector.raw)).toBe(true);
      });

      it(`SafeHttpClient rejects fetch to octal URL: http://${vector.raw}/`, async () => {
        await expect(client.fetch(`http://${vector.raw}/api`)).rejects.toThrow(SsrfBlockedError);
      });
    }
  });

  describe('2. Hexadecimal IP Evasion Attacks', () => {
    const hexVectors = [
      { raw: '0x7f000001', expectedIp: '127.0.0.1', description: 'DWORD Hex loopback' },
      { raw: '0x0a000001', expectedIp: '10.0.0.1', description: 'DWORD Hex 10.0.0.1' },
      { raw: '0xa9fea9fe', expectedIp: '169.254.169.254', description: 'DWORD Hex cloud metadata' },
      { raw: '0xac100001', expectedIp: '172.16.0.1', description: 'DWORD Hex 172.16.0.1' },
      { raw: '0xc0a80101', expectedIp: '192.168.1.1', description: 'DWORD Hex 192.168.1.1' },
      { raw: '0x7f.0.0.1', expectedIp: '127.0.0.1', description: 'Dotted mixed hex/dec' },
      { raw: '0x7f.0x0.0x0.0x1', expectedIp: '127.0.0.1', description: 'All-octets dotted hex' },
      { raw: '0xa9.0xfe.0xa9.0xfe', expectedIp: '169.254.169.254', description: 'Dotted hex cloud metadata' },
    ];

    for (const vector of hexVectors) {
      it(`normalizes and blocks hex vector: ${vector.description} (${vector.raw})`, () => {
        const normalized = normalizeIp(vector.raw);
        expect(normalized).toBe(vector.expectedIp);
        expect(isBlockedIp(vector.raw)).toBe(true);
      });

      it(`SafeHttpClient rejects fetch to hex URL: http://${vector.raw}/`, async () => {
        await expect(client.fetch(`http://${vector.raw}/`)).rejects.toThrow(SsrfBlockedError);
      });
    }
  });

  describe('3. DWORD / Integer IP Evasion Attacks', () => {
    const dwordVectors = [
      { raw: '2130706433', expectedIp: '127.0.0.1', description: 'DWORD 127.0.0.1' },
      { raw: '167772161', expectedIp: '10.0.0.1', description: 'DWORD 10.0.0.1' },
      { raw: '2852039166', expectedIp: '169.254.169.254', description: 'DWORD cloud metadata' },
      { raw: '2886729729', expectedIp: '172.16.0.1', description: 'DWORD 172.16.0.1' },
      { raw: '3232235777', expectedIp: '192.168.1.1', description: 'DWORD 192.168.1.1' },
      { raw: '0', expectedIp: '0.0.0.0', description: 'DWORD 0 (0.0.0.0)' },
    ];

    for (const vector of dwordVectors) {
      it(`normalizes and blocks DWORD integer: ${vector.description} (${vector.raw})`, () => {
        const normalized = normalizeIp(vector.raw);
        expect(normalized).toBe(vector.expectedIp);
        expect(isBlockedIp(vector.raw)).toBe(true);
      });

      it(`SafeHttpClient rejects fetch to DWORD URL: http://${vector.raw}/`, async () => {
        await expect(client.fetch(`http://${vector.raw}/status`)).rejects.toThrow(SsrfBlockedError);
      });
    }
  });

  describe('4. IPv6 Loopback & IPv4-Mapped IPv6 Attacks', () => {
    const ipv6Vectors = [
      { raw: '::1', isIpBlocked: true, description: 'IPv6 loopback' },
      { raw: '[::1]', isIpBlocked: true, description: 'Bracketed IPv6 loopback' },
      { raw: '0:0:0:0:0:0:0:1', isIpBlocked: true, description: 'Full form IPv6 loopback' },
      { raw: '[0:0:0:0:0:0:0:1]', isIpBlocked: true, description: 'Bracketed full form IPv6 loopback' },
      { raw: '::', isIpBlocked: true, description: 'IPv6 unspecified' },
      { raw: '[::]', isIpBlocked: true, description: 'Bracketed IPv6 unspecified' },
      { raw: 'fe80::1', isIpBlocked: true, description: 'IPv6 Link-Local' },
      { raw: '[fe80::1]', isIpBlocked: true, description: 'Bracketed IPv6 Link-Local' },
      { raw: 'fc00::1', isIpBlocked: true, description: 'IPv6 Unique Local (ULA)' },
      { raw: 'fd00::1', isIpBlocked: true, description: 'IPv6 ULA fd00::' },
      { raw: '::ffff:127.0.0.1', isIpBlocked: true, description: 'IPv4-mapped IPv6 loopback' },
      { raw: '[::ffff:127.0.0.1]', isIpBlocked: true, description: 'Bracketed IPv4-mapped IPv6 loopback' },
      { raw: '::ffff:7f00:1', isIpBlocked: true, description: 'IPv4-mapped hex IPv6 loopback' },
      { raw: '[::ffff:7f00:1]', isIpBlocked: true, description: 'Bracketed IPv4-mapped hex loopback' },
      { raw: '::ffff:169.254.169.254', isIpBlocked: true, description: 'IPv4-mapped cloud metadata' },
      { raw: '[::ffff:169.254.169.254]', isIpBlocked: true, description: 'Bracketed IPv4-mapped cloud metadata' },
      { raw: '::ffff:a9fe:a9fe', isIpBlocked: true, description: 'IPv4-mapped hex cloud metadata' },
      { raw: '[::ffff:a9fe:a9fe]', isIpBlocked: true, description: 'Bracketed IPv4-mapped hex cloud metadata' },
      { raw: '::ffff:10.0.0.1', isIpBlocked: true, description: 'IPv4-mapped private 10.0.0.1' },
      { raw: '::ffff:192.168.1.1', isIpBlocked: true, description: 'IPv4-mapped private 192.168.1.1' },
    ];

    for (const vector of ipv6Vectors) {
      it(`identifies and blocks IPv6 variant: ${vector.description} (${vector.raw})`, () => {
        expect(isBlockedIp(vector.raw)).toBe(vector.isIpBlocked);
      });

      it(`SafeHttpClient rejects fetch to IPv6 URL: http://${vector.raw.startsWith('[') ? vector.raw : `[${vector.raw}]`}/`, async () => {
        const hostStr = vector.raw.startsWith('[') ? vector.raw : `[${vector.raw}]`;
        await expect(client.fetch(`http://${hostStr}/data`)).rejects.toThrow(SsrfBlockedError);
      });
    }
  });

  describe('5. Cloud Metadata Endpoints & Internal Hostnames', () => {
    const cloudMetadataEndpoints = [
      'http://169.254.169.254/latest/meta-data/',
      'http://169.254.169.254/computeMetadata/v1/',
      'http://instance-data/latest/meta-data/',
      'http://metadata.google.internal/computeMetadata/v1/',
      'http://metadata/v1/',
      'http://service.internal/secret',
      'http://app.localhost/admin',
      'http://subdomain.local/internal',
    ];

    for (const url of cloudMetadataEndpoints) {
      it(`blocks access to cloud metadata / internal service: ${url}`, async () => {
        await expect(client.fetch(url)).rejects.toThrow(SsrfBlockedError);
      });
    }

    it('blocks internal hostnames directly via isBlockedHostname', () => {
      expect(isBlockedHostname('metadata.google.internal')).toBe(true);
      expect(isBlockedHostname('instance-data')).toBe(true);
      expect(isBlockedHostname('metadata')).toBe(true);
      expect(isBlockedHostname('localhost')).toBe(true);
      expect(isBlockedHostname('db.local')).toBe(true);
      expect(isBlockedHostname('backend.internal')).toBe(true);
      expect(isBlockedHostname('cluster.localhost')).toBe(true);
    });
  });

  describe('6. Protocol Smuggling & Malformed URLs', () => {
    const disallowedProtocols = [
      'file:///etc/passwd',
      'ftp://ftp.local/passwords.txt',
      'gopher://127.0.0.1:70/',
      'ldap://127.0.0.1:389/o=example',
      'dict://127.0.0.1:2628/',
      'data:text/plain;base64,SGVsbG8sIFdvcmxkIQ==',
      'ws://127.0.0.1:8080/socket',
    ];

    for (const url of disallowedProtocols) {
      it(`rejects disallowed scheme: ${url}`, async () => {
        await expect(client.fetch(url)).rejects.toThrow(DisallowedProtocolError);
      });
    }

    it('rejects invalid / unparseable URLs', async () => {
      await expect(client.fetch('not-a-valid-url')).rejects.toThrow(/Invalid URL/);
      await expect(client.fetch('http://:8080/')).rejects.toThrow();
    });
  });

  describe('7. HTTP Redirect to Blocked Target Protection', () => {
    it('catches and blocks redirect hop to cloud metadata or loopback IP', async () => {
      const server = http.createServer((req, res) => {
        if (req.url === '/redirect-to-metadata') {
          res.writeHead(302, { Location: 'http://169.254.169.254/latest/meta-data/' });
          res.end();
          return;
        }
        if (req.url === '/redirect-to-loopback') {
          res.writeHead(307, { Location: 'http://0177.0.0.1:8080/internal' });
          res.end();
          return;
        }
        if (req.url === '/redirect-to-hex') {
          res.writeHead(301, { Location: 'http://0x7f000001/' });
          res.end();
          return;
        }
        res.writeHead(200);
        res.end('ok');
      });

      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
      const port = (server.address() as any).port;

      try {
        // Redirect to 169.254.169.254
        await expect(
          client.fetch(`http://127.0.0.1:${port}/redirect-to-metadata`, {
            allowlist: [`127.0.0.1:${port}`],
          })
        ).rejects.toThrow(SsrfBlockedError);

        // Redirect to octal loopback
        await expect(
          client.fetch(`http://127.0.0.1:${port}/redirect-to-loopback`, {
            allowlist: [`127.0.0.1:${port}`],
          })
        ).rejects.toThrow(SsrfBlockedError);

        // Redirect to hex loopback
        await expect(
          client.fetch(`http://127.0.0.1:${port}/redirect-to-hex`, {
            allowlist: [`127.0.0.1:${port}`],
          })
        ).rejects.toThrow(SsrfBlockedError);
      } finally {
        server.close();
      }
    });
  });
});
