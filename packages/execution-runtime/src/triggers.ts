import { hostname } from 'node:os';
import { randomUUID } from 'node:crypto';
import { and, desc, eq, inArray, isNotNull, isNull, lt, lte, or, sql } from 'drizzle-orm';
import {
  credentials,
  telegramBotCursors,
  triggerLogs,
  triggers,
  type DatabaseInstance,
} from '@localflow/db';
import { LocalFlowError, SafeHttpClient } from '@localflow/shared';
import { DrizzleExecutionJournal, type IWorkflowQueueManager } from '@localflow/workflow-engine';
import type { WorkflowNode } from '@localflow/workflow-schema';
import {
  CronExpressionError,
  assertTimezone,
  nextCronTime,
  parseCron,
  scheduleToCron,
} from './cron.js';
import type { EnqueueExecutionParams, ExecutionRuntime, RuntimeLogger } from './runtime.js';
import { createCredentialResolver } from './store.js';

type Db = any; // Drizzle's pg and PGlite clients share this query surface

const TELEGRAM_CONNECTION_TYPES = ['telegram', 'core.telegramBot'];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A schedule or bot trigger whose settings cannot work; publishing is refused. */
export class TriggerConfigError extends LocalFlowError {
  constructor(message: string, details: Record<string, unknown>) {
    super(message, 'ERR_TRIGGER_INVALID', 422, details);
  }
}

export interface CronTriggerConfig {
  kind: 'cron';
  nodeId: string;
  cron: string;
  timezone: string;
  /** What to do with a run missed while nothing was running: skip it or run it once. */
  catchUp: 'skip' | 'once';
}

export interface TelegramTriggerConfig {
  kind: 'telegram';
  nodeId: string;
  credentialId: string;
  /** Lower-case command names without the slash; empty means every message. */
  commands: string[];
}

export type TriggerSpec = CronTriggerConfig | TelegramTriggerConfig;

/**
 * Reads the trigger node of a graph. Returns undefined for triggers that need no
 * background work (manual, webhook) and throws TriggerConfigError for bad settings.
 */
export function describeTrigger(nodes: readonly WorkflowNode[]): TriggerSpec | undefined {
  const node = nodes.find((n) => n.type.startsWith('trigger.'));
  if (!node) return undefined;
  const config = (node.data?.config ?? {}) as Record<string, unknown>;
  if (node.type === 'trigger.cron') {
    try {
      const cron = scheduleToCron(config);
      parseCron(cron);
      const timezone = String(config.timezone ?? '').trim() || 'UTC';
      assertTimezone(timezone);
      nextCronTime(cron, new Date(), timezone); // also rejects schedules that never fire
      const catchUp = config.catchUp === 'once' ? 'once' : 'skip';
      return { kind: 'cron', nodeId: node.id, cron, timezone, catchUp };
    } catch (err) {
      if (err instanceof CronExpressionError) {
        throw new TriggerConfigError(`Schedule: ${err.message}`, { nodeId: node.id });
      }
      throw err;
    }
  }
  if (node.type === 'trigger.telegram') {
    const credentialId = node.data?.credentialId;
    if (!credentialId) {
      throw new TriggerConfigError(
        'Telegram trigger: select the bot connection that should receive messages.',
        { nodeId: node.id, field: 'credentialId' }
      );
    }
    const raw = config.onlyCommands ?? config.commands ?? '';
    const list = Array.isArray(raw) ? raw.map(String) : String(raw).split(/[\s,]+/);
    const commands = list.map((c) => c.trim().replace(/^\//, '').toLowerCase()).filter(Boolean);
    return { kind: 'telegram', nodeId: node.id, credentialId, commands };
  }
  return undefined;
}

/** Validates a graph's trigger against this workspace (e.g. its bot connection exists). */
export async function assertWorkflowTrigger(
  db: DatabaseInstance,
  workspaceId: string,
  nodes: readonly WorkflowNode[]
): Promise<TriggerSpec | undefined> {
  const spec = describeTrigger(nodes);
  if (spec?.kind === 'telegram') {
    const [cred] = UUID_RE.test(spec.credentialId)
      ? await (db as Db)
          .select({ type: credentials.type, workspaceId: credentials.workspaceId })
          .from(credentials)
          .where(eq(credentials.id, spec.credentialId))
          .limit(1)
      : [];
    if (!cred || cred.workspaceId !== workspaceId) {
      throw new TriggerConfigError('Telegram trigger: the selected connection was not found.', {
        nodeId: spec.nodeId,
        field: 'credentialId',
      });
    }
    if (!TELEGRAM_CONNECTION_TYPES.includes(cred.type)) {
      throw new TriggerConfigError(
        `Telegram trigger: the selected connection is a "${cred.type}" connection, not a Telegram bot.`,
        { nodeId: spec.nodeId, field: 'credentialId' }
      );
    }
  }
  return spec;
}

/**
 * Makes the workflow's background trigger match the version that just went live
 * (publish or rollback): registers a schedule or bot trigger, updates it, or removes
 * it when the live version is triggered manually or by webhook. A paused trigger
 * stays paused; an unchanged schedule keeps its next run time.
 */
export async function syncWorkflowTriggers(
  db: DatabaseInstance,
  input: {
    workspaceId: string;
    workflowId: string;
    workflowVersionId: string;
    nodes: readonly WorkflowNode[];
    name?: string;
    now?: Date;
  }
): Promise<void> {
  const spec = await assertWorkflowTrigger(db, input.workspaceId, input.nodes);
  const now = input.now ?? new Date();
  await (db as Db).transaction(async (tx: Db) => {
    const existing = await tx
      .select()
      .from(triggers)
      .where(eq(triggers.workflowId, input.workflowId));
    const keep = spec && existing.find((t: { type: string }) => t.type === spec.kind);
    const stale = existing
      .filter((t: { id: string }) => t.id !== keep?.id)
      .map((t: { id: string }) => t.id);
    if (stale.length) await tx.delete(triggers).where(inArray(triggers.id, stale));
    if (!spec) return;

    const config = { ...spec, workflowVersionId: input.workflowVersionId };
    let nextTriggerAt: Date | null = null;
    if (spec.kind === 'cron') {
      const prev = keep?.config as Partial<CronTriggerConfig> | undefined;
      const unchanged =
        prev?.cron === spec.cron &&
        prev?.timezone === spec.timezone &&
        keep?.nextTriggerAt &&
        keep.nextTriggerAt > now;
      nextTriggerAt = unchanged ? keep.nextTriggerAt : nextCronTime(spec.cron, now, spec.timezone);
    }
    const values = {
      name: input.name ?? spec.nodeId,
      config,
      nextTriggerAt,
      updatedAt: now,
    };
    if (keep) {
      await tx.update(triggers).set(values).where(eq(triggers.id, keep.id));
    } else {
      await tx.insert(triggers).values({
        workspaceId: input.workspaceId,
        workflowId: input.workflowId,
        type: spec.kind,
        isEnabled: true,
        ...values,
      });
    }
  });
}

/** Pauses or resumes a workflow's background trigger. Resuming never replays missed runs. */
export async function setWorkflowTriggersEnabled(
  db: DatabaseInstance,
  workflowId: string,
  enabled: boolean,
  now = new Date()
): Promise<void> {
  const rows = await (db as Db).select().from(triggers).where(eq(triggers.workflowId, workflowId));
  for (const row of rows) {
    const config = row.config as Partial<CronTriggerConfig>;
    await (db as Db)
      .update(triggers)
      .set({
        isEnabled: enabled,
        updatedAt: now,
        ...(row.type === 'cron' &&
          enabled && { nextTriggerAt: nextCronTime(config.cron!, now, config.timezone) }),
      })
      .where(eq(triggers.id, row.id));
  }
}

export interface TriggerStatus {
  id: string;
  type: string;
  enabled: boolean;
  schedule?: { cron: string; timezone: string; catchUp: string };
  telegram?: { commands: string[]; lastPolledAt: string | null; lastError: string | null };
  nextRunAt: string | null;
  lastRunAt: string | null;
  /** The run the trigger started most recently. */
  lastExecutionId: string | null;
}

/** What the editor shows about a workflow's background trigger. */
export async function listWorkflowTriggers(
  db: DatabaseInstance,
  workflowId: string
): Promise<TriggerStatus[]> {
  const rows = await (db as Db).select().from(triggers).where(eq(triggers.workflowId, workflowId));
  const out: TriggerStatus[] = [];
  for (const row of rows) {
    const config = row.config as TriggerSpec;
    const [last] = await (db as Db)
      .select({ executionId: triggerLogs.executionId })
      .from(triggerLogs)
      .where(and(eq(triggerLogs.triggerId, row.id), isNotNull(triggerLogs.executionId)))
      .orderBy(desc(triggerLogs.triggeredAt))
      .limit(1);
    const status: TriggerStatus = {
      id: row.id,
      type: row.type,
      enabled: row.isEnabled,
      nextRunAt: row.isEnabled ? (row.nextTriggerAt?.toISOString() ?? null) : null,
      lastRunAt: row.lastTriggeredAt?.toISOString() ?? null,
      lastExecutionId: last?.executionId ?? null,
    };
    if (config.kind === 'cron') {
      status.schedule = { cron: config.cron, timezone: config.timezone, catchUp: config.catchUp };
    } else if (config.kind === 'telegram') {
      const [cursor] = await (db as Db)
        .select()
        .from(telegramBotCursors)
        .where(eq(telegramBotCursors.credentialId, config.credentialId))
        .limit(1);
      status.telegram = {
        commands: config.commands,
        lastPolledAt: cursor?.lastPolledAt?.toISOString() ?? null,
        lastError: cursor?.lastError ?? null,
      };
    }
    out.push(status);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Telegram updates

interface TelegramMessage {
  message_id: number;
  date: number;
  text?: string;
  caption?: string;
  chat: { id: number; type?: string; title?: string; username?: string };
  from?: { id: number; first_name?: string; last_name?: string; username?: string };
}

interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
}

/** The `$trigger` of a run started by a Telegram message. */
export interface TelegramTriggerPayload {
  updateId: number;
  text: string;
  command: string | null;
  args: string;
  chatId: string;
  chatType: string | null;
  fromId: string | null;
  fromName: string;
  username: string | null;
  messageId: number;
  sentAt: string;
  message: TelegramMessage;
}

export function telegramPayload(update: TelegramUpdate): TelegramTriggerPayload | undefined {
  const message = update.message;
  if (!message) return undefined;
  const text = message.text ?? message.caption ?? '';
  const cmd = /^\/([A-Za-z0-9_]+)(?:@[A-Za-z0-9_]+)?(?:\s+([\s\S]*))?$/.exec(text.trim());
  const from = message.from;
  const fromName =
    [from?.first_name, from?.last_name].filter(Boolean).join(' ') ||
    from?.username ||
    message.chat.title ||
    '';
  return {
    updateId: update.update_id,
    text,
    command: cmd ? cmd[1]!.toLowerCase() : null,
    args: cmd?.[2]?.trim() ?? '',
    chatId: String(message.chat.id),
    chatType: message.chat.type ?? null,
    fromId: from ? String(from.id) : null,
    fromName,
    username: from?.username ?? null,
    messageId: message.message_id,
    sentAt: new Date(message.date * 1000).toISOString(),
    message,
  };
}

class TelegramApiError extends Error {}

// ---------------------------------------------------------------------------
// Scheduler

export interface TriggerSchedulerOptions {
  db: DatabaseInstance;
  runtime: ExecutionRuntime;
  queue: IWorkflowQueueManager;
  /** How often due schedules are checked and the set of polled bots refreshed. */
  tickMs?: number;
  /** A schedule this late counts as missed (its `catchUp` setting decides). */
  misfireGraceMs?: number;
  telegramApiBase?: string;
  /** getUpdates long-poll timeout. */
  telegramPollTimeoutSec?: number;
  /** Lower bound between two polls of one bot that returned nothing. */
  telegramMinPollIntervalMs?: number;
  /** Pause after a failed poll. */
  telegramRetryMs?: number;
  logger?: RuntimeLogger;
}

interface BotState {
  workspaceId: string;
  triggers: Array<{
    id: string;
    workflowId: string;
    workspaceId: string;
    createdAt: Date;
    config: TelegramTriggerConfig & { workflowVersionId: string };
  }>;
  loop?: Promise<void>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Starts runs from schedules and Telegram messages. Any number of processes may run
 * one: a schedule tick is claimed atomically together with the run it creates, and a
 * bot is polled by whoever holds its lease, advancing its cursor in the same
 * transaction that records the runs — so every tick and every message starts exactly
 * one run, even across crashes and restarts.
 */
export class TriggerScheduler {
  private readonly id = `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;
  private readonly http = new SafeHttpClient();
  private readonly bots = new Map<string, BotState>();
  private readonly logger: RuntimeLogger;
  private readonly tickMs: number;
  private readonly misfireGraceMs: number;
  private readonly apiBase: string;
  private readonly pollTimeoutSec: number;
  private readonly leaseMs: number;
  private timer?: NodeJS.Timeout;
  private ticking?: Promise<void>;
  private stopped = true;

  constructor(private readonly options: TriggerSchedulerOptions) {
    this.logger = options.logger ?? { info() {}, warn() {}, error() {} };
    this.tickMs = options.tickMs ?? 5_000;
    this.misfireGraceMs = options.misfireGraceMs ?? 60_000;
    this.apiBase = (options.telegramApiBase ?? 'https://api.telegram.org').replace(/\/+$/, '');
    this.pollTimeoutSec = options.telegramPollTimeoutSec ?? 25;
    this.leaseMs = Math.max(30_000, this.pollTimeoutSec * 1_000 + 30_000);
  }

  async start(): Promise<void> {
    this.stopped = false;
    await this.tick();
    this.timer = setInterval(() => void this.tick(), this.tickMs);
    this.timer.unref?.();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    await this.ticking;
    // Hand bots over at once instead of making the next process wait out the lease.
    try {
      await (this.options.db as Db)
        .update(telegramBotCursors)
        .set({ leaseHolder: null, leaseExpiresAt: null })
        .where(eq(telegramBotCursors.leaseHolder, this.id));
    } catch {
      // The database may already be closing; the lease then simply expires.
    }
    this.bots.clear();
  }

  /** One pass: fire due schedules, then (re)start or stop bot polling loops. */
  tick(): Promise<void> {
    if (this.stopped) return Promise.resolve();
    this.ticking ??= (async () => {
      try {
        await this.fireDueSchedules();
        await this.refreshBots();
      } catch (err) {
        this.logger.error({ err }, 'Trigger scheduler tick failed');
      } finally {
        this.ticking = undefined;
      }
    })();
    return this.ticking;
  }

  private async fireDueSchedules(): Promise<void> {
    const now = new Date();
    const due = await (this.options.db as Db)
      .select()
      .from(triggers)
      .where(
        and(
          eq(triggers.type, 'cron'),
          eq(triggers.isEnabled, true),
          lte(triggers.nextTriggerAt, now)
        )
      );
    for (const row of due) {
      if (this.stopped) return;
      try {
        await this.fireSchedule(row, now);
      } catch (err) {
        this.logger.error({ err, triggerId: row.id }, 'Could not start a scheduled run');
      }
    }
  }

  private async fireSchedule(
    row: {
      id: string;
      workspaceId: string;
      workflowId: string;
      nextTriggerAt: Date;
      config: CronTriggerConfig & { workflowVersionId: string };
    },
    now: Date
  ): Promise<void> {
    const { config } = row;
    const dueAt = row.nextTriggerAt;
    const next = nextCronTime(config.cron, now > dueAt ? now : dueAt, config.timezone);
    const lateMs = now.getTime() - dueAt.getTime();
    const fire = lateMs <= this.misfireGraceMs || config.catchUp === 'once';
    const params: EnqueueExecutionParams = {
      workspaceId: row.workspaceId,
      workflowId: row.workflowId,
      workflowVersionId: config.workflowVersionId,
      triggerType: 'cron',
      triggerPayload: {
        firedAt: now.toISOString(),
        scheduledAt: dueAt.toISOString(),
        timezone: config.timezone,
        cron: config.cron,
      },
      idempotencyKey: `cron:${row.id}:${dueAt.toISOString()}`,
    };

    let executionId: string | undefined;
    await (this.options.db as Db).transaction(async (tx: Db) => {
      // Only the process that moves the schedule forward from this exact tick fires it.
      const claimed = await tx
        .update(triggers)
        .set({ nextTriggerAt: next, updatedAt: now, ...(fire && { lastTriggeredAt: now }) })
        .where(and(eq(triggers.id, row.id), eq(triggers.nextTriggerAt, dueAt)))
        .returning({ id: triggers.id });
      if (!claimed.length) return;
      if (fire) {
        const run = await this.options.runtime.recordQueuedRun(
          new DrizzleExecutionJournal(tx),
          params
        );
        executionId = run.id;
      }
      await tx.insert(triggerLogs).values({
        triggerId: row.id,
        executionId: executionId ?? null,
        status: fire ? 'success' : 'ignored',
        payload: params.triggerPayload as Record<string, unknown>,
        errorMessage: fire
          ? null
          : `Missed by ${Math.round(lateMs / 1000)} s while no scheduler was running; skipped.`,
        triggeredAt: now,
      });
    });
    if (executionId) await this.dispatch(executionId, params);
  }

  private async dispatch(executionId: string, params: EnqueueExecutionParams): Promise<void> {
    try {
      await this.options.runtime.dispatch(this.options.queue, executionId, params);
    } catch (err) {
      // The run is recorded as QUEUED; crash recovery queues it once the queue is back.
      this.logger.warn(
        { err, executionId },
        'Queue unavailable; the run will be queued by recovery'
      );
    }
  }

  private async refreshBots(): Promise<void> {
    const rows = await (this.options.db as Db)
      .select()
      .from(triggers)
      .where(and(eq(triggers.type, 'telegram'), eq(triggers.isEnabled, true)));
    const wanted = new Map<string, BotState['triggers']>();
    for (const row of rows) {
      const credentialId = (row.config as TelegramTriggerConfig).credentialId;
      if (!wanted.has(credentialId)) wanted.set(credentialId, []);
      wanted.get(credentialId)!.push(row);
    }
    for (const [credentialId, list] of wanted) {
      const bot = this.bots.get(credentialId);
      if (bot) {
        bot.triggers = list;
      } else {
        const state: BotState = { workspaceId: list[0]!.workspaceId, triggers: list };
        this.bots.set(credentialId, state);
        state.loop = this.pollBot(credentialId, state);
      }
    }
    for (const credentialId of [...this.bots.keys()]) {
      if (!wanted.has(credentialId)) this.bots.delete(credentialId);
    }
  }

  private isPolling(credentialId: string, state: BotState): boolean {
    return !this.stopped && this.bots.get(credentialId) === state;
  }

  private async pollBot(credentialId: string, state: BotState): Promise<void> {
    const resolve = createCredentialResolver(this.options.db, this.options.runtime.encryption);
    const minInterval = this.options.telegramMinPollIntervalMs ?? 1_000;
    const retryMs = this.options.telegramRetryMs ?? 5_000;
    while (this.isPolling(credentialId, state)) {
      const started = Date.now();
      let token = '';
      try {
        const cursor = await this.acquireLease(credentialId);
        if (!cursor) {
          await sleep(Math.min(this.leaseMs / 2, 10_000));
          continue;
        }
        const { secrets } = await resolve(credentialId, state.workspaceId);
        token = String(secrets.botToken ?? '');
        if (!token) throw new TelegramApiError('The bot connection has no "botToken".');
        const updates = await this.getUpdates(token, cursor.updateOffset);
        if (!this.isPolling(credentialId, state)) return; // not acknowledged: redelivered
        await this.recordUpdates(credentialId, state, cursor.updateOffset, updates);
        if (!updates.length && Date.now() - started < minInterval) {
          await sleep(minInterval - (Date.now() - started));
        }
      } catch (err) {
        const raw = err instanceof Error ? err.message : String(err);
        const message = token ? raw.split(token).join('***') : raw;
        this.logger.warn({ credentialId, error: message }, 'Telegram polling failed');
        await this.saveError(credentialId, message);
        await sleep(retryMs);
      }
    }
  }

  private async acquireLease(credentialId: string): Promise<{ updateOffset: number } | undefined> {
    const now = new Date();
    const expires = new Date(now.getTime() + this.leaseMs);
    const [row] = await (this.options.db as Db)
      .insert(telegramBotCursors)
      .values({ credentialId, leaseHolder: this.id, leaseExpiresAt: expires })
      .onConflictDoUpdate({
        target: telegramBotCursors.credentialId,
        set: { leaseHolder: this.id, leaseExpiresAt: expires, updatedAt: now },
        setWhere: or(
          eq(telegramBotCursors.leaseHolder, this.id),
          isNull(telegramBotCursors.leaseHolder),
          lt(telegramBotCursors.leaseExpiresAt, now)
        ),
      })
      .returning({ updateOffset: telegramBotCursors.updateOffset });
    return row;
  }

  private async getUpdates(token: string, offset: number): Promise<TelegramUpdate[]> {
    const res = await this.http.request<{
      ok?: boolean;
      result?: TelegramUpdate[];
      description?: string;
      error_code?: number;
    }>({
      url: `${this.apiBase}/bot${token}/getUpdates`,
      params: {
        offset,
        timeout: this.pollTimeoutSec,
        allowed_updates: JSON.stringify(['message']),
      },
      timeoutMs: this.pollTimeoutSec * 1_000 + 15_000,
      allowlist: this.options.runtime.ssrfAllowlist,
    });
    const body = typeof res.data === 'object' && res.data ? res.data : {};
    if (res.status === 409) {
      throw new TelegramApiError(
        `Telegram answered 409: ${body.description ?? 'conflict'}. The bot has a webhook set or ` +
          'another program is reading its updates; remove the webhook (deleteWebhook) or stop the other program.'
      );
    }
    if (res.status === 401 || res.status === 404) {
      throw new TelegramApiError('Telegram rejected the bot token. Check the connection.');
    }
    if (res.status >= 400 || body.ok === false || !Array.isArray(body.result)) {
      throw new TelegramApiError(
        `Telegram answered HTTP ${res.status}${body.description ? `: ${body.description}` : ''}.`
      );
    }
    return body.result;
  }

  private async recordUpdates(
    credentialId: string,
    state: BotState,
    offset: number,
    updates: TelegramUpdate[]
  ): Promise<void> {
    const now = new Date();
    const newOffset = updates.reduce((max, u) => Math.max(max, u.update_id + 1), offset);
    const runs: Array<{ id: string; params: EnqueueExecutionParams }> = [];
    await (this.options.db as Db).transaction(async (tx: Db) => {
      // Acknowledge only if we still own the bot and nobody moved the cursor meanwhile.
      const moved = await tx
        .update(telegramBotCursors)
        .set({ updateOffset: newOffset, lastPolledAt: now, lastError: null, updatedAt: now })
        .where(
          and(
            eq(telegramBotCursors.credentialId, credentialId),
            eq(telegramBotCursors.updateOffset, offset),
            eq(telegramBotCursors.leaseHolder, this.id)
          )
        )
        .returning({ id: telegramBotCursors.credentialId });
      if (!moved.length) return;
      const journal = new DrizzleExecutionJournal(tx);
      for (const update of updates) {
        const payload = telegramPayload(update);
        if (!payload) continue;
        for (const trigger of state.triggers) {
          // Messages sent before the trigger existed are history, not new work.
          if (Date.parse(payload.sentAt) < trigger.createdAt.getTime() - 1_000) continue;
          const { commands } = trigger.config;
          const matched =
            !commands.length || (payload.command !== null && commands.includes(payload.command));
          if (!matched) continue;
          const params: EnqueueExecutionParams = {
            workspaceId: trigger.workspaceId,
            workflowId: trigger.workflowId,
            workflowVersionId: trigger.config.workflowVersionId,
            triggerType: 'telegram',
            triggerPayload: payload,
            idempotencyKey: `telegram:${credentialId}:${update.update_id}`,
          };
          const run = await this.options.runtime.recordQueuedRun(journal, params);
          runs.push({ id: run.id, params });
          await tx
            .update(triggers)
            .set({ lastTriggeredAt: now })
            .where(eq(triggers.id, trigger.id));
          await tx.insert(triggerLogs).values({
            triggerId: trigger.id,
            executionId: run.id,
            status: 'success',
            payload: { updateId: update.update_id, chatId: payload.chatId },
            triggeredAt: now,
          });
        }
      }
    });
    for (const run of runs) await this.dispatch(run.id, run.params);
  }

  private async saveError(credentialId: string, message: string): Promise<void> {
    try {
      await (this.options.db as Db)
        .update(telegramBotCursors)
        .set({
          lastError: message.slice(0, 1_000),
          lastPolledAt: new Date(),
          updatedAt: sql`now()`,
        })
        .where(
          and(
            eq(telegramBotCursors.credentialId, credentialId),
            or(eq(telegramBotCursors.leaseHolder, this.id), isNull(telegramBotCursors.leaseHolder))
          )
        );
    } catch {
      // Best effort: the error is also logged.
    }
  }
}
