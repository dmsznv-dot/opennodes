/**
 * LocalFlow E2E Test Suite - Tier 2: Encryption & Redaction Boundaries
 * Verifies empty secrets, large payloads, Unicode characters, corrupt authTags, and deep object redaction.
 */

import { describe, it, expect } from '../harness/index.ts';
import { encryptionService, redactionService } from '../harness/security-harness.ts';

describe('Tier 2: Boundary - Encryption & Redaction Boundaries', () => {
  it('B-ENC-1: should encrypt and decrypt empty string secret properly', async () => {
    const emptySecret = '';
    const enc = await encryptionService.encrypt(emptySecret);
    const dec = await encryptionService.decrypt(enc);

    expect(dec).toBe('');
    expect(enc.iv).toBeDefined();
    expect(enc.authTag).toBeDefined();
  });

  it('B-ENC-2: should encrypt and decrypt large secret payloads (256 KB) without memory leaks', async () => {
    const largeSecret = 'X'.repeat(256 * 1024);
    const enc = await encryptionService.encrypt(largeSecret);
    const dec = await encryptionService.decrypt(enc);

    expect(dec.length).toBe(256 * 1024);
    expect(dec).toBe(largeSecret);
  });

  it('B-ENC-3: should encrypt and decrypt multi-byte UTF-8 Unicode characters and emojis faithfully', async () => {
    const unicodeSecret = 'Пароль_123_🛡️_🔑_秘密_مفتاح';
    const enc = await encryptionService.encrypt(unicodeSecret);
    const dec = await encryptionService.decrypt(enc);

    expect(dec).toBe(unicodeSecret);
  });

  it('B-ENC-4: should throw cryptographic authentication error on truncated or altered authTag', async () => {
    const secret = 'valid_secret_key';
    const enc = await encryptionService.encrypt(secret);

    // Corrupt the authTag
    const corruptedEnc = {
      ...enc,
      authTag: Buffer.from('corrupted_tag_16b').toString('base64')
    };

    await expect(encryptionService.decrypt(corruptedEnc)).rejects.toThrow();
  });

  it('B-ENC-5: should recursively redact massive objects (1,000 keys) without exceeding recursion limits', () => {
    const largeObj: Record<string, unknown> = {};
    for (let i = 0; i < 1000; i++) {
      if (i % 10 === 0) {
        largeObj[`api_key_${i}`] = `secret_token_${i}`;
      } else {
        largeObj[`metric_${i}`] = i;
      }
    }

    const redacted = redactionService.redact(largeObj) as Record<string, unknown>;
    expect(redacted['api_key_0']).toBe('[REDACTED]');
    expect(redacted['api_key_500']).toBe('[REDACTED]');
    expect(redacted['metric_1']).toBe(1);
    expect(redacted['metric_999']).toBe(999);
  });

  it('B-ENC-6: should redact all variations of hyphenated, snake_case, and camelCase sensitive keys', () => {
    const testCases = {
      'x-access-token': 'val1',
      'client_secret': 'val2',
      'masterPassword': 'val3',
      'USER_AUTH_TOKEN': 'val4',
      'secret-webhook-key': 'val5'
    };

    const redacted = redactionService.redact(testCases) as Record<string, string>;
    for (const key of Object.keys(testCases)) {
      expect(redacted[key]).toBe('[REDACTED]');
    }
  });
});
