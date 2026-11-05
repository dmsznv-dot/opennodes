import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { executions, type DatabaseInstance } from '@localflow/db';
import { ActionExecutionError } from '@localflow/connector-sdk';
import { markdownToTelegramHtml } from '@localflow/connectors-core';
import { SafeHttpClient } from '@localflow/shared';
import {
  ExecutionSuspendedSignal,
  type ExecutionJournal,
  type IWorkflowQueueManager,
  type NodeExecutor,
} from '@localflow/workflow-engine';
import {
  approvalHours,
  approvalOutcome,
  decideApproval,
  isApprovalState,
  resumeDecidedRun,
  type ApprovalState,
} from './approval.js';
import type { CredentialResolver } from './connectors.js';
import { toText } from './text.js';

/**
 * "Approve in Telegram": a separate bot posts the preview to a chat (a private channel or
 * group for approvals) with “Approve” / “Reject” buttons. A press decides the run — the
 * same as the buttons in History. The bot must be its own bot, not one that starts
 * scenarios: Telegram gives each update to one reader only.
 */

/** What the bot says, in the language chosen on the step. */
const TEXTS = {
  ru: {
    approve: '✅ Утвердить',
    reject: '❌ Отклонить',
    approved: '✅ Утверждено',
    rejected: '❌ Отклонено',
    timeout: '⌛ Нет ответа вовремя — не отправлено',
    until: 'Ждём решения до',
    closed: 'Этот запрос уже закрыт.',
    notAllowed: 'Вас нет в списке тех, кто может утверждать этот запрос.',
  },
  en: {
    approve: '✅ Approve',
    reject: '❌ Reject',
    approved: '✅ Approved',
    rejected: '❌ Rejected',
    timeout: '⌛ No answer in time — not sent',
    until: 'Waiting for a decision until',
    closed: 'This request is already closed.',
    notAllowed: 'You are not on the list of approvers for this request.',
  },
};
type Lang = keyof typeof TEXTS;
const textsFor = (lang: unknown) => TEXTS[(lang === 'en' ? 'en' : 'ru') as Lang];

const PREVIEW_MAX = 3_500; // a Telegram message is at most 4096 characters

interface TelegramOptions {
  journal: ExecutionJournal;
  resolveCredential: CredentialResolver;
  telegramApiBase?: string;
  ssrfAllowlist?: string[];
}

const apiBase = (base?: string) => (base ?? 'https://api.telegram.org').replace(/\/+$/, '');

async function call(
  http: SafeHttpClient,
  options: { telegramApiBase?: string; ssrfAllowlist?: string[] },
  token: string,
  method: string,
  body: Record<string, unknown>
): Promise<{ ok: boolean; result?: any; description?: string }> {
  const res = await http.request<{ ok?: boolean; result?: unknown; description?: string }>({
    url: `${apiBase(options.telegramApiBase)}/bot${token}/${method}`,
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    data: body,
    timeoutMs: 20_000,
    allowlist: options.ssrfAllowlist,
  });
  const data = (typeof res.data === 'object' && res.data) || {};
  return {
    ok: res.status < 400 && data.ok !== false,
    result: data.result,
    description: data.description,
  };
}

const usernames = (v: unknown) =>
  toText(v)
    .split(/[\s,;]+/)
    .map((x) => x.replace(/^@/, '').trim().toLowerCase())
    .filter(Boolean);

/** The approval message: the title, the text in Telegram's formatting, and the deadline. */
export function approvalMessage(
  title: string,
  content: string,
  until: Date,
  lang: unknown = 'ru'
): string {
  const body = content.length > PREVIEW_MAX ? `${content.slice(0, PREVIEW_MAX)}…` : content;
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return [
    `<b>${esc(title || 'Approval')}</b>`,
    '',
    markdownToTelegramHtml(body),
    '',
    `<i>⏳ ${textsFor(lang).until} ${esc(until.toISOString().slice(0, 16).replace('T', ' '))} UTC</i>`,
  ].join('\n');
}

export function buildTelegramApprovalExecutor(options: TelegramOptions): NodeExecutor {
  const http = new SafeHttpClient();
  return {
    async execute(node, config, step) {
      const row = await options.journal.findNodeExecution(step.executionId, node.id);
      const state = row?.outputPayload;
      if (isApprovalState(state) && state.waitingUntil) {
        const result = approvalOutcome(state); // throws (keeps waiting) when undecided
        // Decided (here, in History, or timed out): the buttons go, the outcome is said.
        if (state.telegram?.messageId) {
          try {
            const { secrets } = await options.resolveCredential(
              state.telegram.bot,
              step.workspaceId
            );
            const token = String(secrets.botToken ?? '');
            const tx = textsFor(state.telegram.lang);
            const approved = (result.output as { approved?: boolean }).approved;
            const reason = (result.output as { reason?: string }).reason;
            await call(http, options, token, 'editMessageReplyMarkup', {
              chat_id: state.telegram.chatId,
              message_id: state.telegram.messageId,
              reply_markup: { inline_keyboard: [] },
            });
            await call(http, options, token, 'sendMessage', {
              chat_id: state.telegram.chatId,
              reply_to_message_id: state.telegram.messageId,
              text: approved
                ? `${tx.approved}${state.decidedBy ? ` — ${state.decidedBy}` : ''}`
                : reason === 'timeout'
                  ? tx.timeout
                  : `${tx.rejected}${state.decidedBy ? ` — ${state.decidedBy}` : ''}`,
            });
          } catch {
            // Best effort: the run goes on (or stops) whatever the chat shows.
          }
        }
        return result;
      }

      const credentialId = node.data.credentialId;
      if (!credentialId)
        throw new ActionExecutionError(
          'Approve in Telegram: choose the bot that asks for approval (a separate bot).',
          'approval',
          'telegram.approval'
        );
      const chatId = toText(config.chatId).trim();
      if (!chatId)
        throw new ActionExecutionError(
          'Approve in Telegram: fill in the chat for approvals (e.g. @my_approvals or -100…).',
          'approval',
          'telegram.approval'
        );
      const { secrets } = await options.resolveCredential(credentialId, step.workspaceId);
      const botToken = String(secrets.botToken ?? '');
      if (!botToken)
        throw new ActionExecutionError(
          'Approve in Telegram: the selected connection has no bot token.',
          'approval',
          'telegram.approval'
        );
      const title = toText(config.title).trim() || toText(node.data.label).trim();
      const content = toText(config.content).trim().slice(0, 20_000);
      const until = new Date(Date.now() + approvalHours(config) * 3_600_000);
      const token = randomBytes(9).toString('base64url'); // short: callback data is 64 bytes
      const keyboard = {
        inline_keyboard: [
          [
            { text: textsFor(config.lang).approve, callback_data: `ap:y:${token}` },
            { text: textsFor(config.lang).reject, callback_data: `ap:n:${token}` },
          ],
        ],
      };
      let sent = await call(http, options, botToken, 'sendMessage', {
        chat_id: chatId,
        text: approvalMessage(title, content, until, config.lang),
        parse_mode: 'HTML',
        disable_web_page_preview: false,
        reply_markup: keyboard,
      });
      if (!sent.ok && /parse|entit/i.test(sent.description ?? '')) {
        // Formatting Telegram cannot read: the same text, plain.
        sent = await call(http, options, botToken, 'sendMessage', {
          chat_id: chatId,
          text: `${title}\n\n${content.slice(0, PREVIEW_MAX)}`,
          reply_markup: keyboard,
        });
      }
      if (!sent.ok)
        throw new ActionExecutionError(
          `Approve in Telegram: the bot could not post to ${chatId} (${sent.description ?? 'error'}). Add the bot to the chat and let it post.`,
          'approval',
          'telegram.approval'
        );
      const details: Omit<ApprovalState, 'waitingUntil'> = {
        approval: true,
        title,
        content,
        telegram: {
          bot: credentialId,
          chatId,
          messageId: Number(sent.result?.message_id) || undefined,
          ref: token,
          lang: config.lang === 'en' ? 'en' : 'ru',
          approvers: usernames(config.approvers),
        },
      };
      throw new ExecutionSuspendedSignal(until, details as unknown as Record<string, unknown>);
    },
  };
}

interface Pending {
  execution: typeof executions.$inferSelect;
  nodeId: string;
  state: ApprovalState;
}

/**
 * Reads the presses on approval buttons. Every few seconds: the runs waiting for a
 * Telegram approval, grouped by bot; each bot's button presses (callback queries only)
 * are read, matched to a run by the token in the button, and decided.
 */
export class TelegramApprovalPoller {
  private readonly http = new SafeHttpClient();
  private readonly offsets = new Map<string, number>();
  private timer?: NodeJS.Timeout;
  private ticking?: Promise<void>;

  constructor(
    private readonly options: {
      db: DatabaseInstance;
      journal: ExecutionJournal;
      queue: IWorkflowQueueManager;
      resolveCredential: CredentialResolver;
      telegramApiBase?: string;
      ssrfAllowlist?: string[];
      tickMs?: number;
      logger?: { warn(obj: unknown, msg?: string): void };
    }
  ) {}

  start(): void {
    this.timer = setInterval(() => void this.tick(), this.options.tickMs ?? 3_000);
    this.timer.unref?.();
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    await this.ticking;
  }

  tick(): Promise<void> {
    this.ticking ??= this.pass()
      .catch((err) => this.options.logger?.warn({ err }, 'Telegram approvals: poll failed'))
      .finally(() => (this.ticking = undefined));
    return this.ticking;
  }

  private async pending(): Promise<Pending[]> {
    const waiting = await (this.options.db as any)
      .select()
      .from(executions)
      .where(eq(executions.status, 'WAITING'));
    const out: Pending[] = [];
    for (const execution of waiting as Array<typeof executions.$inferSelect>) {
      const nodeId = (execution.metadata as { waitingNodeId?: unknown } | null)?.waitingNodeId;
      if (typeof nodeId !== 'string') continue;
      const row = await this.options.journal.findNodeExecution(execution.id, nodeId);
      const state = row?.outputPayload;
      if (isApprovalState(state) && state.telegram && !state.decision)
        out.push({ execution, nodeId, state });
    }
    return out;
  }

  private async pass(): Promise<void> {
    const pending = await this.pending();
    const byBot = new Map<string, Pending[]>();
    for (const p of pending) {
      const key = `${p.execution.workspaceId}:${p.state.telegram!.bot}`;
      byBot.set(key, [...(byBot.get(key) ?? []), p]);
    }
    for (const [key, list] of byBot) {
      const { workspaceId } = list[0]!.execution;
      const { secrets } = await this.options.resolveCredential(
        list[0]!.state.telegram!.bot,
        workspaceId
      );
      const token = String(secrets.botToken ?? '');
      if (!token) continue;
      const updates = await call(this.http, this.options, token, 'getUpdates', {
        offset: this.offsets.get(key) ?? 0,
        timeout: 0,
        allowed_updates: ['callback_query'],
      });
      if (!updates.ok || !Array.isArray(updates.result)) continue;
      for (const u of updates.result as Array<{ update_id: number; callback_query?: any }>) {
        this.offsets.set(key, Math.max(this.offsets.get(key) ?? 0, u.update_id + 1));
        const cq = u.callback_query;
        if (cq) await this.press(token, cq, list);
      }
    }
  }

  private async press(token: string, cq: any, list: Pending[]): Promise<void> {
    const m = /^ap:([yn]):(\S+)$/.exec(String(cq.data ?? ''));
    const answer = (text: string) =>
      call(this.http, this.options, token, 'answerCallbackQuery', {
        callback_query_id: cq.id,
        text,
      }).catch(() => {});
    const p = m ? list.find((x) => x.state.telegram!.ref === m[2]) : undefined;
    const tx = textsFor(p?.state.telegram!.lang);
    if (!m || !p) return void (await answer(tx.closed));
    const who = String(cq.from?.username ?? '').toLowerCase();
    const allowed = p.state.telegram!.approvers;
    if (allowed.length && !allowed.includes(who)) return void (await answer(tx.notAllowed));
    const decision = m[1] === 'y' ? 'approved' : 'rejected';
    const by = cq.from?.username
      ? `@${cq.from.username}`
      : String(cq.from?.first_name ?? cq.from?.id ?? 'telegram');
    const ok = await decideApproval(this.options.journal, p.execution.id, p.nodeId, decision, by);
    if (!ok) return void (await answer(tx.closed));
    await answer(decision === 'approved' ? tx.approved : tx.rejected);
    await resumeDecidedRun(this.options.queue, p.execution);
  }
}
