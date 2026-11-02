import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import {
  EnvKeyProvider,
  AesGcmEncryptionService,
  maskSecret,
  sanitizeCredentialEntity,
  DecryptionFailedError,
  InvalidKeyError,
  KeyVersionNotFoundError,
} from '../src/index.js';

describe('AES-256-GCM Envelope Encryption & Masking', () => {
  const masterKey = crypto.randomBytes(32).toString('hex');
  const keyProvider = new EnvKeyProvider(masterKey, 1);
  const cryptoService = new AesGcmEncryptionService(keyProvider);

  it('encrypts and decrypts string with roundtrip fidelity', async () => {
    const plaintext = 'sk-prod-test-secret-key-12345';
    const encrypted = await cryptoService.encrypt(plaintext);

    expect(encrypted.keyVersion).toBe(1);
    expect(encrypted.iv).toBeDefined();
    expect(encrypted.authTag).toBeDefined();
    expect(encrypted.ciphertext).toBeDefined();

    const decrypted = await cryptoService.decrypt(encrypted);
    expect(decrypted).toBe(plaintext);
  });

  it('encrypts and decrypts JSON objects with deep type fidelity', async () => {
    const payload = {
      host: 'smtp.mail.com',
      port: 587,
      auth: { user: 'admin', pass: 's3cr3t' },
      features: ['tls', 'auth'],
    };
    const encrypted = await cryptoService.encryptJson(payload);
    const decrypted = await cryptoService.decryptJson<typeof payload>(encrypted);

    expect(decrypted).toEqual(payload);
  });

  it('generates distinct IVs and ciphertexts for identical plaintext', async () => {
    const plaintext = 'constant-secret-value';
    const enc1 = await cryptoService.encrypt(plaintext);
    const enc2 = await cryptoService.encrypt(plaintext);

    expect(enc1.iv).not.toBe(enc2.iv);
    expect(enc1.ciphertext).not.toBe(enc2.ciphertext);
  });

  it('rejects tampered ciphertext with DecryptionFailedError', async () => {
    const encrypted = await cryptoService.encrypt('sensitive data');
    const tampered = {
      ...encrypted,
      ciphertext: Buffer.from('tampered-ciphertext').toString('base64'),
    };

    await expect(cryptoService.decrypt(tampered)).rejects.toThrow(DecryptionFailedError);
  });

  it('rejects tampered authTag with DecryptionFailedError', async () => {
    const encrypted = await cryptoService.encrypt('sensitive data');
    const buf = Buffer.from(encrypted.authTag, 'base64');
    buf[0] = (buf[0] ?? 0) ^ 0xff; // Flip bits
    const tampered = {
      ...encrypted,
      authTag: buf.toString('base64'),
    };

    await expect(cryptoService.decrypt(tampered)).rejects.toThrow(DecryptionFailedError);
  });

  it('binds Additional Authenticated Data (AAD) context securely', async () => {
    const encrypted = await cryptoService.encrypt('context-bound-secret', 'workspace:ws_1');
    // Same context succeeds
    expect(await cryptoService.decrypt(encrypted, 'workspace:ws_1')).toBe('context-bound-secret');
    // Different context fails
    await expect(cryptoService.decrypt(encrypted, 'workspace:ws_2')).rejects.toThrow(
      DecryptionFailedError
    );
  });

  it('supports key rotation across versions', async () => {
    const key1 = crypto.randomBytes(32).toString('hex');
    const key2 = crypto.randomBytes(32).toString('hex');

    const rotatingProvider = new EnvKeyProvider(key2, 2, { 1: key1 });
    const rotatingCrypto = new AesGcmEncryptionService(rotatingProvider);

    // Encrypt under version 1
    const v1Provider = new EnvKeyProvider(key1, 1);
    const v1Crypto = new AesGcmEncryptionService(v1Provider);
    const v1Data = await v1Crypto.encrypt('old-key-secret');

    // Decrypt version 1 data using rotating provider
    const decrypted = await rotatingCrypto.decrypt(v1Data);
    expect(decrypted).toBe('old-key-secret');

    // New encryptions use active version 2
    const v2Data = await rotatingCrypto.encrypt('new-key-secret');
    expect(v2Data.keyVersion).toBe(2);
  });

  it('throws KeyVersionNotFoundError for unknown key versions', async () => {
    const encrypted = await cryptoService.encrypt('secret');
    const unknownVersion = { ...encrypted, keyVersion: 99 };
    await expect(cryptoService.decrypt(unknownVersion)).rejects.toThrow(KeyVersionNotFoundError);
  });

  it('throws InvalidKeyError when master key is invalid length', () => {
    expect(() => new EnvKeyProvider('too-short')).toThrow(InvalidKeyError);
  });

  it('produces masked secret hints safely without revealing secret', () => {
    expect(maskSecret('')).toBe('');
    expect(maskSecret('abc')).toBe('••••••••');
    expect(maskSecret('password')).toBe('••••rd');
    expect(maskSecret('super-secret-api-token-xyz1234')).toBe('••••••••1234');
  });

  it('sanitizes credential summary without exposing ciphertext', () => {
    const entity = {
      id: 'cred_1',
      workspaceId: 'ws_1',
      name: 'Telegram Bot',
      type: 'telegram',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const sanitized = sanitizeCredentialEntity(entity, '123456789:ABCdefGHIJK');
    expect(sanitized.id).toBe('cred_1');
    expect(sanitized.maskedHint).toBe('••••••••HIJK');
    expect((sanitized as any).ciphertext).toBeUndefined();
  });

  it('encrypts and decrypts empty string with roundtrip fidelity', async () => {
    const plaintext = '';
    const encrypted = await cryptoService.encrypt(plaintext);

    expect(encrypted.keyVersion).toBe(1);
    expect(encrypted.iv).toBeDefined();
    expect(encrypted.authTag).toBeDefined();
    expect(encrypted.ciphertext).toBe('');

    const decrypted = await cryptoService.decrypt(encrypted);
    expect(decrypted).toBe('');
  });
});
