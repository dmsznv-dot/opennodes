import net from 'node:net';

export function ipv4ToInt(ip: string): number {
  const octets = ip.split('.').map(Number);
  return (
    ((octets[0]! << 24) | (octets[1]! << 16) | (octets[2]! << 8) | octets[3]!) >>> 0
  );
}

export function isIpv4InCidr(ip: string, cidr: string): boolean {
  const [rangeIp, prefixStr] = cidr.split('/');
  if (!rangeIp || prefixStr === undefined) return false;
  const prefix = Number(prefixStr);
  const ipInt = ipv4ToInt(ip);
  const rangeInt = ipv4ToInt(rangeIp);
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (ipInt & mask) === (rangeInt & mask);
}

export function ipv6ToBigInt(ip: string): bigint {
  const parts = ip.split(':');
  let expanded: string[] = [];

  const doubleColonIndex = parts.indexOf('');
  if (doubleColonIndex !== -1) {
    const head = parts.slice(0, doubleColonIndex).filter(Boolean);
    const tail = parts.slice(doubleColonIndex + 1).filter(Boolean);
    const missing = 8 - (head.length + tail.length);
    expanded = [...head, ...Array(missing).fill('0'), ...tail];
  } else {
    expanded = parts;
  }

  let result = 0n;
  for (let i = 0; i < 8; i++) {
    const part = expanded[i] || '0';
    const val = BigInt(parseInt(part, 16) || 0);
    result = (result << 16n) | val;
  }
  return result;
}

export function isIpv6InCidr(ip: string, cidr: string): boolean {
  const [rangeIp, prefixStr] = cidr.split('/');
  if (!rangeIp || prefixStr === undefined) return false;
  const prefix = BigInt(prefixStr);
  const ipBig = ipv6ToBigInt(ip);
  const rangeBig = ipv6ToBigInt(rangeIp);

  if (prefix === 0n) return true;
  if (prefix > 128n) return false;
  const shift = 128n - prefix;
  return (ipBig >> shift) === (rangeBig >> shift);
}

export function isIpInCidr(ip: string, cidr: string): boolean {
  const isV4 = net.isIPv4(ip);
  const isCidrV4 = cidr.includes('.');
  if (isV4 && isCidrV4) {
    return isIpv4InCidr(ip, cidr);
  }
  if (!isV4 && !isCidrV4) {
    return isIpv6InCidr(ip, cidr);
  }
  return false;
}
