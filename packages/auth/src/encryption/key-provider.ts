import { Buffer } from 'node:buffer';
import { InvalidKeyError, KeyVersionNotFoundError } from './errors.js';

export interface KeyProvider {
  getKey(version?: number): Buffer;
  getActiveVersion(): number;
}

export class EnvKeyProvider implements KeyProvider {
  private readonly keys = new Map<number, Buffer>();
  private activeVersion: number;

  constructor(envKey?: string, activeVersion = 1, rotationKeys?: Record<number, string>) {
    this.activeVersion = activeVersion;
    const primaryRaw = envKey ?? process.env.ENCRYPTION_KEY;
    if (!primaryRaw) {
      throw new InvalidKeyError(
        'Master encryption key missing. Set ENCRYPTION_KEY environment variable.'
      );
    }
    this.keys.set(this.activeVersion, this.parseKey(primaryRaw));

    if (rotationKeys) {
      for (const [verStr, keyStr] of Object.entries(rotationKeys)) {
        const ver = Number(verStr);
        this.keys.set(ver, this.parseKey(keyStr));
      }
    }
  }

  public parseKey(raw: string): Buffer {
    let buf: Buffer;
    const trimmed = raw.trim();
    if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
      buf = Buffer.from(trimmed, 'hex');
    } else if (/^[A-Za-z0-9+/]{43}=?$/.test(trimmed)) {
      buf = Buffer.from(trimmed, 'base64');
    } else {
      buf = Buffer.from(trimmed, 'utf8');
    }

    if (buf.length !== 32) {
      throw new InvalidKeyError(
        `Master encryption key must be exactly 32 bytes (256 bits). Received ${buf.length} bytes.`
      );
    }
    return buf;
  }

  public getKey(version = this.activeVersion): Buffer {
    const key = this.keys.get(version);
    if (!key) {
      throw new KeyVersionNotFoundError(`Encryption key for version ${version} not found.`);
    }
    return key;
  }

  public getActiveVersion(): number {
    return this.activeVersion;
  }
}
