import { createHash } from 'node:crypto';
import { and, eq, gt, inArray, or, sql } from 'drizzle-orm';
import { rssSeenItems, type DatabaseInstance } from '@localflow/db';
import type { SafeHttpClient } from '@localflow/shared';
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
 * than lost. Editor tests read the feed but record nothing — unless `rememberTests` is on,
 * then a successful test uses its items up like a run. When nothing is new the
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

      // Editor tests leave the memory alone, unless the step says tests count too.
      const remember = step.triggerType !== 'test' || isOn(config.rememberTests);
      if (remember && fresh.length) {
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
          // Not in a test: a remembering test is for walking through the items one by one.
          ...(n === 0 && step.triggerType !== 'test'
            ? fresh.slice(max).map((x) => ({ key: x.key, pending: false }))
            : []),
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
/** How many items each RSS step of a workflow remembers as already handed on. */
export async function rssMemory(
  db: DatabaseInstance,
  workflowId: string
): Promise<Record<string, number>> {
  const rows = await (db as Db)
    .select({ nodeId: rssSeenItems.nodeId, n: sql<number>`count(*)::int` })
    .from(rssSeenItems)
    .where(eq(rssSeenItems.workflowId, workflowId))
    .groupBy(rssSeenItems.nodeId);
  return Object.fromEntries(rows.map((r: { nodeId: string; n: number }) => [r.nodeId, r.n]));
}

/** Forgets what an RSS step (or every RSS step of the workflow) has handed on. */
export async function resetRssMemory(
  db: DatabaseInstance,
  workflowId: string,
  nodeId?: string
): Promise<number> {
  const rows = await (db as Db)
    .delete(rssSeenItems)
    .where(
      nodeId
        ? and(eq(rssSeenItems.workflowId, workflowId), eq(rssSeenItems.nodeId, nodeId))
        : eq(rssSeenItems.workflowId, workflowId)
    )
    .returning({ key: rssSeenItems.itemKey });
  return rows.length;
}

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

const PAGE_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (compatible; OpenNodes/0.1; +feed reader)',
  Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5',
};

/** The picture a page shows when shared (og:image / twitter:image), absolute. */
export function pageImage(html: string, pageUrl: string): string | undefined {
  const raw =
    html.match(
      /<meta[^>]+(?:property|name)=["'](?:og:image(?::secure_url)?|twitter:image(?::src)?)["'][^>]*content=["']([^"']+)["']/i
    )?.[1] ??
    html.match(
      /<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["'](?:og:image|twitter:image(?::src)?)["']/i
    )?.[1];
  if (!raw) return undefined;
  try {
    return new URL(raw.replace(/&amp;/g, '&'), pageUrl).toString();
  } catch {
    return undefined;
  }
}

/**
 * RSS items without a picture get the one their article page shows when shared — many
 * feeds carry none. Only the items handed on are looked up (at most 10, in parallel).
 */
export function withPageImages(
  rss: NodeExecutor,
  http: SafeHttpClient,
  allowlist: string[] = []
): NodeExecutor {
  return {
    async execute(node, config, step) {
      const res = await rss.execute(node, config, step);
      const out = res.output as Record<string, unknown> & {
        items?: Array<Record<string, unknown>>;
      };
      const items = out?.items;
      if (config.pageImages === false || config.pageImages === 'false' || !items?.length)
        return res;
      const missing = items
        .filter((i) => !i.image && /^https?:\/\//.test(String(i.link ?? '')))
        .slice(0, 10);
      if (!missing.length) return res;
      await Promise.all(
        missing.map(async (item) => {
          try {
            const page = await http.request<unknown>({
              url: String(item.link),
              headers: PAGE_HEADERS,
              timeoutMs: 8_000,
              allowlist,
            });
            if (page.status >= 400 || typeof page.data !== 'string') return;
            const image = pageImage(page.data.slice(0, 300_000), String(item.link));
            if (image) item.image = image;
          } catch {
            /* a page that does not answer keeps its item without a picture */
          }
        })
      );
      const { items: _old, ...rest } = out;
      return { ...res, output: { ...rest, ...summarizeFeed(items) } };
    },
  };
}
