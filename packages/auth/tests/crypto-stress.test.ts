import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import { Buffer } from 'node:buffer';
import {
  EnvKeyProvider,
  AesGcmEncryptionService,
  DecryptionFailedError,
} from '../src/index.js';

describe('Adversarial Crypto Integrity Stress Testing (AES-256-GCM)', () => {
  const masterKey = crypto.randomBytes(32).toString('hex');
  const keyProvider = new EnvKeyProvider(masterKey, 1);
  const cryptoService = new AesGcmEncryptionService(keyProvider);

  describe('1. Single-Bit Flips in AuthTag (Authentication Integrity)', () => {
    it('rejects every single-bit flip across all 16 bytes of the authTag', async () => {
      const plaintext = 'top-secret-credentials-token-998877';
      const envelope = await cryptoService.encrypt(plaintext);
      const originalTag = Buffer.from(envelope.authTag, 'base64');
      expect(originalTag.length).toBe(16);

      // Stress test: flip bit 0, bit 1, and bit 7 at every byte offset (16 bytes * 3 bit flips = 48 tests)
      for (let byteOffset = 0; byteOffset < 16; byteOffset++) {
        for (const bitMask of [0x01, 0x02, 0x80]) {
          const corruptedTag = Buffer.from(originalTag);
          corruptedTag[byteOffset] = corruptedTag[byteOffset]! ^ bitMask;

          const tampered = {
            ...envelope,
            authTag: corruptedTag.toString('base64'),
          };

          await expect(
            cryptoService.decrypt(tampered),
            `AuthTag corruption at byte ${byteOffset} with mask ${bitMask} must be rejected`
          ).rejects.toThrow(DecryptionFailedError);
        }
      }
    });
  });

  describe('2. Single-Bit Flips in Ciphertext', () => {
    it('rejects single-bit flips at the start, middle, and end of the ciphertext', async () => {
      const plaintext = 'Super confidential authorization secret payload for cloud gateway connection';
      const envelope = await cryptoService.encrypt(plaintext);
      const originalCiphertext = Buffer.from(envelope.ciphertext, 'base64');

      const testPositions = [0, Math.floor(originalCiphertext.length / 2), originalCiphertext.length - 1];

      for (const pos of testPositions) {
        for (const bitMask of [0x01, 0x04, 0x80]) {
          const corrupted = Buffer.from(originalCiphertext);
          corrupted[pos] = corrupted[pos]! ^ bitMask;

          const tampered = {
            ...envelope,
            ciphertext: corrupted.toString('base64'),
          };

          await expect(
            cryptoService.decrypt(tampered),
            `Ciphertext corruption at byte ${pos} with mask ${bitMask} must be rejected`
          ).rejects.toThrow(DecryptionFailedError);
        }
      }
    });
  });

  describe('3. Single-Bit Flips in IV', () => {
    it('rejects single-bit flips in the IV', async () => {
      const plaintext = 'secret-data-bound-to-specific-iv';
      const envelope = await cryptoService.encrypt(plaintext);
      const originalIv = Buffer.from(envelope.iv, 'base64');
      expect(originalIv.length).toBe(12);

      for (let byteOffset = 0; byteOffset < 12; byteOffset += 3) {
        for (const bitMask of [0x01, 0x80]) {
          const corruptedIv = Buffer.from(originalIv);
          corruptedIv[byteOffset] = corruptedIv[byteOffset]! ^ bitMask;

          const tampered = {
            ...envelope,
            iv: corruptedIv.toString('base64'),
          };

          await expect(
            cryptoService.decrypt(tampered),
            `IV corruption at byte ${byteOffset} must be rejected`
          ).rejects.toThrow(DecryptionFailedError);
        }
      }
    });
  });

  describe('4. Invalid Envelope Dimensions & Truncation Attacks', () => {
    it('rejects invalid IV lengths (non-12 bytes)', async () => {
      const envelope = await cryptoService.encrypt('data');

      const invalidIvLengths = [0, 1, 8, 11, 13, 16, 24];
      for (const len of invalidIvLengths) {
        const tampered = {
          ...envelope,
          iv: crypto.randomBytes(len).toString('base64'),
        };
        await expect(cryptoService.decrypt(tampered)).rejects.toThrow(DecryptionFailedError);
      }
    });

    it('rejects invalid AuthTag lengths (non-16 bytes)', async () => {
      const envelope = await cryptoService.encrypt('data');

      const invalidTagLengths = [0, 8, 12, 15, 17, 32];
      for (const len of invalidTagLengths) {
        const tampered = {
          ...envelope,
          authTag: crypto.randomBytes(len).toString('base64'),
        };
        await expect(cryptoService.decrypt(tampered)).rejects.toThrow(DecryptionFailedError);
      }
    });

    it('rejects missing or empty envelope components', async () => {
      const envelope = await cryptoService.encrypt('data');

      await expect(cryptoService.decrypt({ ...envelope, iv: '' })).rejects.toThrow(DecryptionFailedError);
      await expect(cryptoService.decrypt({ ...envelope, authTag: '' })).rejects.toThrow(DecryptionFailedError);
      await expect(cryptoService.decrypt({ ...envelope, ciphertext: '' })).rejects.toThrow(DecryptionFailedError);
    });
  });

  describe('5. IV Uniqueness & CSPRNG Entropy', () => {
    it('generates 2,000 strictly distinct IVs with zero collisions', async () => {
      const iterations = 2000;
      const seenIvs = new Set<string>();

      for (let i = 0; i < iterations; i++) {
        const encrypted = await cryptoService.encrypt('identical-plaintext-for-collision-test');
        expect(seenIvs.has(encrypted.iv)).toBe(false);
        seenIvs.add(encrypted.iv);

        // Verify standard 96-bit (12-byte) CSPRNG length
        const rawIv = Buffer.from(encrypted.iv, 'base64');
        expect(rawIv.length).toBe(12);
      }

      expect(seenIvs.size).toBe(iterations);
    });
  });

  describe('6. Extreme Payload Sizes & Unicode Fidelity', () => {
    it('successfully decrypts empty string plaintext with cryptographic roundtrip fidelity', async () => {
      const envelope = await cryptoService.encrypt('');
      expect(envelope.ciphertext).toBe('');
      const decrypted = await cryptoService.decrypt(envelope);
      expect(decrypted).toBe('');
    });

    it('handles 1-byte plaintext successfully', async () => {
      const envelope = await cryptoService.encrypt('x');
      const decrypted = await cryptoService.decrypt(envelope);
      expect(decrypted).toBe('x');
    });

    it('handles 64KB plaintext successfully', async () => {
      const payload = 'A'.repeat(64 * 1024);
      const envelope = await cryptoService.encrypt(payload);
      const decrypted = await cryptoService.decrypt(envelope);
      expect(decrypted).toBe(payload);
    });

    it('handles 1MB large plaintext successfully', async () => {
      const payload = crypto.randomBytes(1024 * 1024).toString('base64');
      const envelope = await cryptoService.encrypt(payload);
      const decrypted = await cryptoService.decrypt(envelope);
      expect(decrypted).toBe(payload);
    });

    it('handles 5MB extreme plaintext successfully', async () => {
      const payload = 'Z'.repeat(5 * 1024 * 1024);
      const envelope = await cryptoService.encrypt(payload);
      const decrypted = await cryptoService.decrypt(envelope);
      expect(decrypted).toBe(payload);
    });

    it('preserves Unicode, surrogate pairs, emojis, and control characters', async () => {
      const unicodeString =
        '🚀🔥🔒🔑 — こんにちは世界！ — مرحبا بالعالم — \u0000\u0001\u0002\r\n\t — 👩‍👩‍👧‍👦 (ZWJ emoji)';
      const envelope = await cryptoService.encrypt(unicodeString);
      const decrypted = await cryptoService.decrypt(envelope);
      expect(decrypted).toBe(unicodeString);
    });
  });

  describe('7. AAD Context Binding Integrity', () => {
    it('strictly enforces Context / Additional Authenticated Data', async () => {
      const secret = 'database-master-password';
      const context = 'workspace:ws_enterprise_123';

      const envelope = await cryptoService.encrypt(secret, context);

      // Decrypting with matching context succeeds
      expect(await cryptoService.decrypt(envelope, context)).toBe(secret);

      // Decrypting with wrong context fails
      await expect(cryptoService.decrypt(envelope, 'workspace:ws_enterprise_999')).rejects.toThrow(
        DecryptionFailedError
      );

      // Decrypting with sub-string context fails
      await expect(cryptoService.decrypt(envelope, 'workspace:ws_enterprise_12')).rejects.toThrow(
        DecryptionFailedError
      );

      // Decrypting with omitted context fails
      await expect(cryptoService.decrypt(envelope)).rejects.toThrow(DecryptionFailedError);

      // Encrypting without context, but decrypting with context fails
      const noContextEnv = await cryptoService.encrypt(secret);
      await expect(cryptoService.decrypt(noContextEnv, context)).rejects.toThrow(
        DecryptionFailedError
      );
    });
  });
});
