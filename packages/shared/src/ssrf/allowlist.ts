import net from 'node:net';
import { isIpInCidr } from './cidr.js';
import { normalizeIp } from './ip-normalizer.js';

export function parseAllowlist(envVar?: string): string[] {
  const raw = envVar ?? process.env.SSRF_ALLOWLIST ?? '';
  return raw
    .split(/[,;\s]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function isAllowlisted(
  hostname: string,
  ip?: string,
  port?: number,
  customAllowlist?: string[]
): boolean {
  const allowlist = customAllowlist ?? parseAllowlist();
  if (allowlist.length === 0) return false;

  const lowerHost = hostname.toLowerCase();
  const normalizedIp = ip ? normalizeIp(ip) : undefined;
  const hostWithPort = port ? `${lowerHost}:${port}` : lowerHost;
  const ipWithPort = normalizedIp && port ? `${normalizedIp}:${port}` : undefined;

  for (const entry of allowlist) {
    const entryLower = entry.toLowerCase();

    // Exact match for hostname or host:port
    if (entryLower === lowerHost || entryLower === hostWithPort) {
      return true;
    }

    // Exact match for IP or IP:port
    if (normalizedIp && (entryLower === normalizedIp || entryLower === ipWithPort)) {
      return true;
    }

    // Wildcard domain match (e.g. *.internal or *.corp.example.com)
    if (entryLower.startsWith('*.')) {
      const suffix = entryLower.slice(1); // e.g. '.internal'
      if (lowerHost.endsWith(suffix) || lowerHost === entryLower.slice(2)) {
        return true;
      }
    }

    // CIDR match if entry is CIDR and we have an IP
    if (normalizedIp && entryLower.includes('/')) {
      if (isIpInCidr(normalizedIp, entryLower)) {
        return true;
      }
    }
  }

  return false;
}
