import { and, eq, gt, lt } from 'drizzle-orm';
import { sessions, type DatabaseInstance } from '@localflow/db';
import {
  generateSessionToken,
  hashToken,
  type SessionData,
  type SessionStore,
} from '@localflow/auth';

/**
 * Sessions persisted in PostgreSQL so sign-ins survive an API restart.
 * Only the SHA-256 hash of the bearer token is stored.
 */
export class PgSessionStore implements SessionStore {
  constructor(private readonly db: DatabaseInstance) {}

  public async createSession(
    userId: string,
    ttlMs = 86400000 // 24 hours
  ): Promise<{ token: string; session: SessionData }> {
    const rawToken = generateSessionToken();
    const tokenHash = hashToken(rawToken);
    const expiresAt = new Date(Date.now() + ttlMs);
    await (this.db as any).insert(sessions).values({ id: tokenHash, userId, expiresAt });
    return { token: rawToken, session: { sessionId: tokenHash, userId, expiresAt } };
  }

  public async validateSession(token: string): Promise<SessionData | null> {
    if (!token || typeof token !== 'string') return null;
    const tokenHash = hashToken(token);
    const rows = await (this.db as any)
      .select()
      .from(sessions)
      .where(and(eq(sessions.id, tokenHash), gt(sessions.expiresAt, new Date())))
      .limit(1);
    const row = rows[0];
    if (!row) {
      await (this.db as any)
        .delete(sessions)
        .where(and(eq(sessions.id, tokenHash), lt(sessions.expiresAt, new Date())));
      return null;
    }
    return { sessionId: row.id, userId: row.userId, expiresAt: row.expiresAt };
  }

  public async deleteSession(token: string): Promise<void> {
    await (this.db as any).delete(sessions).where(eq(sessions.id, hashToken(token)));
  }
}
