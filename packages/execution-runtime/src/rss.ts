import { createHash } from 'node:crypto';
import { and, eq, gt, inArray, or, sql } from 'drizzle-orm';
import { rssSeenItems, type DatabaseInstance } from '@localflow/db';
import type { NodeExecutor } from '@localflow/workflow-engine';
import { summarizeFeed } from './connectors.js';

type Db = any; // Drizzle's pg and PGlite clients share this query surface

/** A pending item older than this belongs to a run that died; it may be handed on again. */
const PENDING_TTL_MS = 60 * 60 * 1000;

const itemKey = (item: Record<string, unknown>) =>
  createHash('sha256')
    .update(String(item.guid || item.link || item.title || ''))
    .digest('hex');

const isOn = (v: unknown) => v === true || v === 'true';

/**
 * "Only items new since the last run" for the RSS step. A real run hands on the newest
 * unseen items (at most `maxItems`) and records them as pending; they become seen when
 * the run succeeds and are released when it fails, so a failed post is retried rather
 * than lost. Editor tests read the feed but record nothing. When nothing is new the
 * flow below the step stops (the run still succeeds), so no empty post goes out.
 */
export function withOnlyNewItems(rss: NodeExecutor, db: DatabaseInstance): NodeExecutor {
  return {
    async execute(node, config, step) {
      if (!isOn(config.onlyNew)) return rss.execute(node, config, step);

      // Read the whole feed, then pick the unseen items ourselves.
      const read = await rss.execute(node, { ...config, maxItems: 0 }, step);
      const all = ((read.output as { items?: Array<Record<string, unknown>> })?.items ?? []).map(
        (item) => ({ item, key: itemKey(item) })
      );
      const max = Number(config.maxItems) > 0 ? Number(config.maxItems) : all.length;

      const known = all.length
        ? await (db as Db)
            .select({ key: rssSeenItems.itemKey })
            .from(rssSeenItems)
            .where(
              and(
                eq(rssSeenItems.workflowId, step.workflowId),
                eq(rssSeenItems.nodeId, node.id),
                inArray(
                  rssSeenItems.itemKey,
                  all.map((x) => x.key)
                ),
                or(
                  eq(rssSeenItems.committed, true),
                  gt(rssSeenItems.createdAt, new Date(Date.now() - PENDING_TTL_MS))
                )
              )
            )
        : [];
      const seen = new Set(known.map((r: { key: string }) => r.key));
      const fresh = all.filter((x) => !seen.has(x.key));
      const handed = fresh.slice(0, max);

      if (step.triggerType !== 'test' && fresh.length) {
        const [{ n }] = await (db as Db)
          .select({ n: sql<number>`count(*)::int` })
          .from(rssSeenItems)
          .where(
            and(eq(rssSeenItems.workflowId, step.workflowId), eq(rssSeenItems.nodeId, node.id))
          );
        const now = new Date();
        const rows = [
          ...handed.map((x) => ({ key: x.key, pending: true })),
          // First run: the feed's backlog counts as seen, or it would come out run after run.
          ...(n === 0 ? fresh.slice(max).map((x) => ({ key: x.key, pending: false })) : []),
        ];
        await (db as Db)
          .insert(rssSeenItems)
          .values(
            rows.map((r) => ({
              workflowId: step.workflowId,
              nodeId: node.id,
              itemKey: r.key,
              executionId: r.pending ? step.executionId : null,
              committed: !r.pending,
              createdAt: now,
            }))
          )
          .onConflictDoUpdate({
            target: [rssSeenItems.workflowId, rssSeenItems.nodeId, rssSeenItems.itemKey],
            // Only a stale pending row is taken over; a committed one never changes.
            set: { executionId: step.executionId, createdAt: now },
            setWhere: eq(rssSeenItems.committed, false),
          });
      }

      const output = {
        ...summarizeFeed(handed.map((x) => x.item)),
        stopped: !handed.length,
        // How many items the feed has in all: tells "nothing new" from "empty feed".
        feedCount: all.length,
      };
      return { output, activeOutputs: handed.length ? ['main'] : [] };
    },
  };
}

/** Settles a run's pending RSS items: seen if it succeeded, released if it failed. */
export async function settleRssItems(
  db: DatabaseInstance,
  executionId: string,
  succeeded: boolean
): Promise<void> {
  const mine = and(eq(rssSeenItems.executionId, executionId), eq(rssSeenItems.committed, false));
  if (succeeded) {
    await (db as Db).update(rssSeenItems).set({ committed: true }).where(mine);
  } else {
    await (db as Db).delete(rssSeenItems).where(mine);
  }
}
