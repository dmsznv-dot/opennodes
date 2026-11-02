import net from 'node:net';

export function normalizeIp(input: string): string {
  let ip = input.trim().toLowerCase();

  // Strip brackets if IPv6
  if (ip.startsWith('[') && ip.endsWith(']')) {
    ip = ip.slice(1, -1);
  }

  // Handle IPv4-mapped IPv6: ::ffff:127.0.0.1 or ::ffff:7f00:1
  if (ip.startsWith('::ffff:')) {
    const remainder = ip.slice(7);
    if (net.isIPv4(remainder)) {
      return remainder;
    }
    const hexParts = remainder.split(':');
    if (hexParts.length === 2 && hexParts[0] && hexParts[1]) {
      const p1 = parseInt(hexParts[0], 16);
      const p2 = parseInt(hexParts[1], 16);
      return `${(p1 >> 8) & 0xff}.${p1 & 0xff}.${(p2 >> 8) & 0xff}.${p2 & 0xff}`;
    }
  }

  // Handle DWORD integer (e.g. 2130706433 -> 127.0.0.1)
  if (/^\d+$/.test(ip)) {
    const num = Number(ip);
    if (num >= 0 && num <= 0xffffffff) {
      return `${(num >>> 24) & 0xff}.${(num >>> 16) & 0xff}.${(num >>> 8) & 0xff}.${num & 0xff}`;
    }
  }

  // Handle Hex IP (e.g. 0x7f000001 -> 127.0.0.1)
  if (/^0x[0-9a-fA-F]{1,8}$/.test(ip)) {
    const num = parseInt(ip.slice(2), 16);
    return `${(num >>> 24) & 0xff}.${(num >>> 16) & 0xff}.${(num >>> 8) & 0xff}.${num & 0xff}`;
  }

  // Handle Octal IP components (e.g. 0177.0.0.1 or 0x7f.0.0.1)
  if (ip.includes('.')) {
    const parts = ip.split('.');
    if (parts.length === 4) {
      const parsed = parts.map((part) => {
        if (part.startsWith('0x') || part.startsWith('0X')) return parseInt(part, 16);
        if (part.startsWith('0') && part.length > 1) return parseInt(part, 8);
        return parseInt(part, 10);
      });
      if (parsed.every((n) => !isNaN(n) && n >= 0 && n <= 255)) {
        return parsed.join('.');
      }
    }
  }

  return ip;
}
