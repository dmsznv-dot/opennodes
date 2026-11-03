import { and, inArray, lt, sql } from 'drizzle-orm';
import { executions, sessions, triggerLogs, type DatabaseInstance } from '@localflow/db';

export interface RetentionResult {
  executions: number;
  triggerLogs: number;
  sessions: number;
}

const FINISHED = ['SUCCEEDED', 'FAILED', 'CANCELLED'] as const;
const BATCH = 500;

/**
 * Run history cleanup: finished runs older than `days` (their steps, logs and events go
 * with them), trigger logs of the same age and expired sign-ins. Runs that are still
 * queued, running or waiting are never touched. `days <= 0` keeps history forever.
 */
export async function pruneHistory(db: DatabaseInstance, days: number): Promise<RetentionResult> {
  const result: RetentionResult = { executions: 0, triggerLogs: 0, sessions: 0 };
  const d = db as any;
  if (days > 0) {
    const cutoff = new Date(Date.now() - days * 86_400_000);
    // In batches, so a first cleanup of a big history does not hold one long lock.
    for (;;) {
      const ids = await d
        .select({ id: executions.id })
        .from(executions)
        .where(
          and(
            inArray(executions.status, [...FINISHED]),
            lt(sql`coalesce(${executions.finishedAt}, ${executions.createdAt})`, cutoff)
          )
        )
        .limit(BATCH);
      if (!ids.length) break;
      await d.delete(executions).where(
        inArray(
          executions.id,
          ids.map((r: { id: string }) => r.id)
        )
      );
      result.executions += ids.length;
      if (ids.length < BATCH) break;
    }
    const logs = await d
      .delete(triggerLogs)
      .where(lt(triggerLogs.triggeredAt, cutoff))
      .returning({ id: triggerLogs.id });
    result.triggerLogs = logs.length;
  }
  const expired = await d
    .delete(sessions)
    .where(lt(sessions.expiresAt, new Date()))
    .returning({ id: sessions.id });
  result.sessions = expired.length;
  return result;
}
