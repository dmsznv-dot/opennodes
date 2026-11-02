import { describe, it, expect } from 'vitest';
import { generateSessionToken, hashToken, MemorySessionStore } from '../src/index.js';

describe('Session Tokens & Store', () => {
  it('generates 64-character hex session tokens', () => {
    const token1 = generateSessionToken();
    const token2 = generateSessionToken();
    expect(token1).toHaveLength(64);
    expect(token1).not.toBe(token2);
  });

  it('hashes token deterministically using SHA-256', () => {
    const token = 'sample-session-token';
    const hash1 = hashToken(token);
    const hash2 = hashToken(token);
    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(64);
  });

  it('creates, validates, and deletes sessions in MemorySessionStore', async () => {
    const store = new MemorySessionStore();
    const { token, session } = await store.createSession('user_123', 5000);

    expect(session.userId).toBe('user_123');
    const validated = await store.validateSession(token);
    expect(validated?.userId).toBe('user_123');

    await store.deleteSession(token);
    expect(await store.validateSession(token)).toBeNull();
  });

  it('expires sessions when TTL passes', async () => {
    const store = new MemorySessionStore();
    const { token } = await store.createSession('user_expired', -1000); // Expired 1 second ago
    expect(await store.validateSession(token)).toBeNull();
  });

  it('returns null when validating invalid, empty, or non-string tokens defensively', async () => {
    const store = new MemorySessionStore();
    expect(await store.validateSession(undefined as any)).toBeNull();
    expect(await store.validateSession(null as any)).toBeNull();
    expect(await store.validateSession('')).toBeNull();
    expect(await store.validateSession(12345 as any)).toBeNull();
    expect(await store.validateSession({} as any)).toBeNull();
  });
});
