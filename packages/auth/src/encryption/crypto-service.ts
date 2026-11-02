import crypto from 'node:crypto';
import { Buffer } from 'node:buffer';
import type { KeyProvider } from './key-provider.js';
import { DecryptionFailedError } from './errors.js';

export interface EncryptedData {
  keyVersion: number;
  iv: string; // base64
  authTag: string; // base64
  ciphertext: string; // base64
}

export interface EncryptionService {
  encrypt(plaintext: string, context?: string): Promise<EncryptedData>;
  decrypt(data: EncryptedData, context?: string): Promise<string>;
  encryptJson<T = unknown>(obj: T, context?: string): Promise<EncryptedData>;
  decryptJson<T = unknown>(data: EncryptedData, context?: string): Promise<T>;
}

export class AesGcmEncryptionService implements EncryptionService {
  constructor(private readonly keyProvider: KeyProvider) {}

  public async encrypt(plaintext: string, context?: string): Promise<EncryptedData> {
    const keyVersion = this.keyProvider.getActiveVersion();
    const key = this.keyProvider.getKey(keyVersion);
    const iv = crypto.randomBytes(12);

    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    if (context) {
      cipher.setAAD(Buffer.from(context, 'utf8'));
    }

    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();

    return {
      keyVersion,
      iv: iv.toString('base64'),
      authTag: authTag.toString('base64'),
      ciphertext: encrypted.toString('base64'),
    };
  }

  public async decrypt(data: EncryptedData, context?: string): Promise<string> {
    if (!data.iv || !data.authTag || typeof data.ciphertext !== 'string') {
      throw new DecryptionFailedError('Malformed encrypted data envelope.');
    }

    const key = this.keyProvider.getKey(data.keyVersion);
    const iv = Buffer.from(data.iv, 'base64');
    const authTag = Buffer.from(data.authTag, 'base64');
    const ciphertext = Buffer.from(data.ciphertext, 'base64');

    if (iv.length !== 12) {
      throw new DecryptionFailedError('Invalid IV length. Expected 12 bytes.');
    }
    if (authTag.length !== 16) {
      throw new DecryptionFailedError('Invalid Auth Tag length. Expected 16 bytes.');
    }

    try {
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(authTag);
      if (context) {
        decipher.setAAD(Buffer.from(context, 'utf8'));
      }

      const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

      return decrypted.toString('utf8');
    } catch {
      throw new DecryptionFailedError(
        'Decryption failed: integrity check or authentication tag mismatch.'
      );
    }
  }

  public async encryptJson<T = unknown>(obj: T, context?: string): Promise<EncryptedData> {
    const serialized = JSON.stringify(obj);
    return this.encrypt(serialized, context);
  }

  public async decryptJson<T = unknown>(data: EncryptedData, context?: string): Promise<T> {
    const raw = await this.decrypt(data, context);
    try {
      return JSON.parse(raw) as T;
    } catch {
      throw new DecryptionFailedError('Decrypted payload is not valid JSON.');
    }
  }
}
