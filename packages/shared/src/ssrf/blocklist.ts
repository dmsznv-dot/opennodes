import net from 'node:net';
import { isIpInCidr } from './cidr.js';
import { normalizeIp } from './ip-normalizer.js';

export const DENIED_CIDRS = [
  // IPv4 Denied Ranges
  '0.0.0.0/8',
  '10.0.0.0/8',
  '100.64.0.0/10',
  '127.0.0.0/8',
  '169.254.0.0/16',
  '172.16.0.0/12',
  '192.0.0.0/24',
  '192.0.2.0/24',
  '192.88.99.0/24',
  '192.168.0.0/16',
  '198.18.0.0/15',
  '198.51.100.0/24',
  '203.0.113.0/24',
  '224.0.0.0/4',
  '240.0.0.0/4',
  '255.255.255.255/32',

  // IPv6 Denied Ranges
  '::/128',
  '::1/128',
  '100::/64',
  '2001:db8::/32',
  '2002::/16',
  'fc00::/7',
  'fe80::/10',
  'ff00::/8',
];

export const DENIED_HOSTNAMES = new Set([
  'localhost',
  'metadata.google.internal',
  'instance-data',
  'metadata',
]);

export function isBlockedIp(rawIp: string): boolean {
  const normalized = normalizeIp(rawIp);
  const isValid = net.isIP(normalized) !== 0;
  if (!isValid) return true; // Fail closed if unrecognized

  for (const cidr of DENIED_CIDRS) {
    if (isIpInCidr(normalized, cidr)) {
      return true;
    }
  }
  return false;
}

export function isBlockedHostname(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  if (DENIED_HOSTNAMES.has(lower)) return true;
  if (lower.endsWith('.localhost') || lower.endsWith('.local') || lower.endsWith('.internal')) return true;
  return false;
}
