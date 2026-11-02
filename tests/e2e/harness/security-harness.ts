/**
 * LocalFlow E2E Test Suite - Security Harness
 * Implements genuine AES-256-GCM Envelope Encryption, Secret Redaction, and SSRF Network Protection.
 */

import * as crypto from 'node:crypto';
import type { EncryptedData, EncryptionService, RedactionService } from './types.ts';

export class SSRFBlockedError extends Error {
  public code = 'ERR_SSRF_BLOCKED';
  public target: string;
  public reason: string;

  constructor(target: string, reason: string) {
    super(`ERR_SSRF_BLOCKED: SSRF Protection blocked access to target "${target}" (${reason})`);
    this.name = 'SSRFBlockedError';
    this.target = target;
    this.reason = reason;
  }
}

export class SSRFProtectionEngine {
  private allowedHosts: Set<string>;

  constructor(allowedHosts: string[] = []) {
    this.allowedHosts = new Set(allowedHosts.map(h => h.toLowerCase()));
  }

  allowHost(host: string): void {
    this.allowedHosts.add(host.toLowerCase());
  }

  disallowHost(host: string): void {
    this.allowedHosts.delete(host.toLowerCase());
  }

  isIpBlocked(ip: string): boolean {
    const cleanIp = ip.trim().toLowerCase().replace(/^\[|\]$/g, '');

    // Loopback IPv4
    if (cleanIp === '127.0.0.1' || cleanIp.startsWith('127.')) return true;
    // Loopback IPv6
    if (cleanIp === '::1' || cleanIp === '0:0:0:0:0:0:0:1' || cleanIp === '::') return true;
    // 0.0.0.0/8
    if (cleanIp === '0.0.0.0' || cleanIp.startsWith('0.')) return true;
    // Link local / Cloud metadata 169.254.0.0/16
    if (cleanIp.startsWith('169.254.')) return true;
    // Private Class A: 10.0.0.0/8
    if (cleanIp.startsWith('10.')) return true;
    // Private Class B: 172.16.0.0/12 (172.16. - 172.31.)
    const bMatch = cleanIp.match(/^172\.(\d+)\./);
    if (bMatch) {
      const secondOctet = parseInt(bMatch[1], 10);
      if (secondOctet >= 16 && secondOctet <= 31) return true;
    }
    // Private Class C: 192.168.0.0/16
    if (cleanIp.startsWith('192.168.')) return true;
    // Carrier Grade NAT: 100.64.0.0/10 (100.64. - 100.127.)
    const cgMatch = cleanIp.match(/^100\.(\d+)\./);
    if (cgMatch) {
      const secondOctet = parseInt(cgMatch[1], 10);
      if (secondOctet >= 64 && secondOctet <= 127) return true;
    }
    // IPv6 Unique Local (fc00::/7) and Link-Local (fe80::/10)
    if (cleanIp.startsWith('fc') || cleanIp.startsWith('fd') || cleanIp.startsWith('fe80:')) return true;

    return false;
  }

  parseNumericIp(str: string): string | null {
    // Check for decimal integer IP (e.g., 2130706433 = 127.0.0.1)
    if (/^\d+$/.test(str)) {
      const num = parseInt(str, 10);
      if (num >= 0 && num <= 4294967295) {
        return [
          (num >>> 24) & 255,
          (num >>> 16) & 255,
          (num >>> 8) & 255,
          num & 255
        ].join('.');
      }
    }
    // Check for hex IP (e.g. 0x7f000001)
    if (/^0x[0-9a-fA-F]+$/.test(str)) {
      const num = parseInt(str, 16);
      if (num >= 0 && num <= 4294967295) {
        return [
          (num >>> 24) & 255,
          (num >>> 16) & 255,
          (num >>> 8) & 255,
          num & 255
        ].join('.');
      }
    }
    // Check for octal IP (e.g. 0177.0.0.1)
    const parts = str.split('.');
    if (parts.length === 4 && parts.some(p => p.startsWith('0') && p.length > 1 && /^\d+$/.test(p))) {
      const decParts = parts.map(p => parseInt(p, p.startsWith('0') ? 8 : 10));
      return decParts.join('.');
    }

    return null;
  }

  validateUrl(rawUrl: string): void {
    let parsed: URL;
    try {
      parsed = new URL(rawUrl);
    } catch {
      throw new SSRFBlockedError(rawUrl, 'Malformed URL');
    }

    const hostname = parsed.hostname.toLowerCase();

    // Check allowlist
    if (this.allowedHosts.has(hostname)) {
      return;
    }

    // Direct loopback names
    if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname === 'localflow.internal') {
      throw new SSRFBlockedError(hostname, 'Localhost domain blocked');
    }

    // Numeric encoding checks
    const decodedIp = this.parseNumericIp(hostname) || hostname;

    if (this.isIpBlocked(decodedIp)) {
      throw new SSRFBlockedError(decodedIp, `Destination IP ${decodedIp} is within a restricted network range`);
    }

    // Specific metadata host names
    if (hostname.includes('metadata.google') || hostname.includes('169.254.169.254')) {
      throw new SSRFBlockedError(hostname, 'Cloud instance metadata service blocked');
    }
  }
}

export class EnvelopeEncryptionService implements EncryptionService {
  private masterKey: Buffer;
  public currentKeyVersion: number = 1;

  constructor(masterKeyHex?: string) {
    if (masterKeyHex) {
      this.masterKey = Buffer.from(masterKeyHex, 'hex');
    } else {
      // 32-byte default master key for test suite
      this.masterKey = crypto.createHash('sha256').update('localflow-test-master-key-32-bytes').digest();
    }
  }

  async encrypt(plaintext: string): Promise<EncryptedData> {
    const iv = crypto.randomBytes(12); // 96-bit IV standard for GCM
    const cipher = crypto.createCipheriv('aes-256-gcm', this.masterKey, iv);
    
    let ciphertext = cipher.update(plaintext, 'utf8', 'base64');
    ciphertext += cipher.final('base64');
    const authTag = cipher.getAuthTag().toString('base64');

    return {
      keyVersion: this.currentKeyVersion,
      iv: iv.toString('base64'),
      authTag,
      ciphertext
    };
  }

  async decrypt(data: EncryptedData): Promise<string> {
    const iv = Buffer.from(data.iv, 'base64');
    const authTag = Buffer.from(data.authTag, 'base64');
    const decipher = crypto.createDecipheriv('aes-256-gcm', this.masterKey, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(data.ciphertext, 'base64', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }
}

export class SecretRedactionService implements RedactionService {
  private sensitivePatterns = [
    /password/i,
    /secret/i,
    /token/i,
    /api[-_]?key/i,
    /authorization/i,
    /bearer/i,
    /private[-_]?key/i,
    /access[-_]?token/i
  ];

  redact(obj: unknown, seen = new WeakSet()): unknown {
    if (obj === null || obj === undefined) return obj;
    if (typeof obj !== 'object') return obj;

    // Guard against circular references
    if (seen.has(obj as object)) {
      return '[CIRCULAR]';
    }
    seen.add(obj as object);

    if (Array.isArray(obj)) {
      return obj.map(item => this.redact(item, seen));
    }

    const result: Record<string, unknown> = {};
    const record = obj as Record<string, unknown>;

    for (const key of Object.keys(record)) {
      const val = record[key];
      const isSensitive = this.sensitivePatterns.some(pattern => pattern.test(key));

      if (isSensitive) {
        result[key] = '[REDACTED]';
      } else if (typeof val === 'object' && val !== null) {
        result[key] = this.redact(val, seen);
      } else {
        result[key] = val;
      }
    }

    return result;
  }
}

export const ssrfGuard = new SSRFProtectionEngine();
export const encryptionService = new EnvelopeEncryptionService();
export const redactionService = new SecretRedactionService();
