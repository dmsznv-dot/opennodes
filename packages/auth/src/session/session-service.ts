import { generateSessionToken, hashToken } from './token.js';

export interface SessionData {
  sessionId: string;
  userId: string;
  expiresAt: Date;
}

export interface SessionStore {
  createSession(userId: string, ttlMs: number): Promise<{ token: string; session: SessionData }>;
  validateSession(token: string): Promise<SessionData | null>;
  deleteSession(token: string): Promise<void>;
}

export class MemorySessionStore implements SessionStore {
  private readonly sessions = new Map<string, SessionData>();

  public async createSession(
    userId: string,
    ttlMs = 86400000 // 24 hours
  ): Promise<{ token: string; session: SessionData }> {
    const rawToken = generateSessionToken();
    const tokenHash = hashToken(rawToken);
    const expiresAt = new Date(Date.now() + ttlMs);
    const session: SessionData = {
      sessionId: tokenHash,
      userId,
      expiresAt,
    };
    this.sessions.set(tokenHash, session);
    return { token: rawToken, session };
  }

  public async validateSession(token: string): Promise<SessionData | null> {
    if (!token || typeof token !== 'string') return null;
    const tokenHash = hashToken(token);
    const session = this.sessions.get(tokenHash);
    if (!session) return null;
    if (session.expiresAt.getTime() < Date.now()) {
      this.sessions.delete(tokenHash);
      return null;
    }
    return session;
  }

  public async deleteSession(token: string): Promise<void> {
    const tokenHash = hashToken(token);
    this.sessions.delete(tokenHash);
  }
}
