import { describe, it, expect } from 'vitest';
import {
  BcryptPasswordHasher,
  ScryptPasswordHasher,
  validatePasswordStrength,
} from '../src/index.js';

describe('Password Hashers & Validator', () => {
  it('hashes and verifies password using Bcrypt', async () => {
    const hasher = new BcryptPasswordHasher(10);
    const password = 'super-secret-password-123';
    const hash = await hasher.hash(password);

    expect(hash).toBeDefined();
    expect(hash).not.toBe(password);
    expect(await hasher.verify(password, hash)).toBe(true);
    expect(await hasher.verify('wrong-password', hash)).toBe(false);
  });

  it('hashes and verifies password using Scrypt', async () => {
    const hasher = new ScryptPasswordHasher();
    const password = 'scrypt-secure-password-456';
    const hash = await hasher.hash(password);

    expect(hash.startsWith('scrypt$')).toBe(true);
    expect(await hasher.verify(password, hash)).toBe(true);
    expect(await hasher.verify('wrong-password', hash)).toBe(false);
  });

  it('validates password strength rules', () => {
    expect(validatePasswordStrength('short').valid).toBe(false);
    expect(validatePasswordStrength('eight_ch').valid).toBe(true);
    expect(validatePasswordStrength('a'.repeat(129)).valid).toBe(false);
  });
});
