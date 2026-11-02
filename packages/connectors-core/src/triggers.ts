import { createHmac, timingSafeEqual } from 'node:crypto';
import type { ConnectorTrigger } from '@localflow/connector-sdk';

export interface ParsedCronFields {
  minute: string;
  hour: string;
  dayOfMonth: string;
  month: string;
  dayOfWeek: string;
}

export function parseCronFields(expr: string): ParsedCronFields {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new Error(`Invalid cron expression "${expr}": expected 5 fields`);
  }
  return {
    minute: parts[0]!,
    hour: parts[1]!,
    dayOfMonth: parts[2]!,
    month: parts[3]!,
    dayOfWeek: parts[4]!,
  };
}

export function validateTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    throw new Error(`Invalid timezone "${tz}"`);
  }
}

export function verifyWebhookHmac(
  payload: string,
  secret: string,
  signature: string
): boolean {
  const expected = createHmac('sha256', secret).update(payload).digest('hex');
  if (expected.length !== signature.length) {
    return false;
  }
  return timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

export interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    from?: { id: number; username?: string; first_name?: string };
    chat: { id: number; type?: string };
    text?: string;
    date?: number;
  };
}

export class TelegramPollingClient {
  private lastUpdateId = 0;

  constructor(private readonly botToken: string) {}

  get nextOffset(): number {
    return this.lastUpdateId > 0 ? this.lastUpdateId + 1 : 0;
  }

  processUpdates(updates: TelegramUpdate[]): Array<{
    updateId: number;
    command?: string;
    args?: string;
    message?: TelegramUpdate['message'];
  }> {
    const processed = [];
    const cmdRegex = /^\/([a-zA-Z0-9_]+)(?:\s+(.*))?$/;

    for (const update of updates) {
      if (update.update_id > this.lastUpdateId) {
        this.lastUpdateId = update.update_id;
      }
      const text = update.message?.text ?? '';
      const match = text.match(cmdRegex);
      processed.push({
        updateId: update.update_id,
        command: match?.[1],
        args: match?.[2],
        message: update.message,
      });
    }
    return processed;
  }

  getPollUrl(): string {
    const offsetParam = this.nextOffset > 0 ? `?offset=${this.nextOffset}` : '';
    return `https://api.telegram.org/bot${this.botToken}/getUpdates${offsetParam}`;
  }
}

export const ManualTrigger: ConnectorTrigger = {
  name: 'trigger.manual',
  type: 'manual',
  description: 'Immediate manual workflow trigger via API or UI Run button.',
  outputs: [
    { id: 'main', name: 'Output', type: 'json', direction: 'output', required: false },
  ],
};

export const CronTrigger: ConnectorTrigger = {
  name: 'trigger.cron',
  type: 'cron',
  description: 'Scheduled recurring trigger using 5-field cron expressions and IANA timezones.',
  outputs: [
    { id: 'main', name: 'Output', type: 'json', direction: 'output', required: false },
  ],
};

export const WebhookTrigger: ConnectorTrigger = {
  name: 'trigger.webhook',
  type: 'webhook',
  description: 'Incoming HTTP webhook trigger with HMAC-SHA256 verification and idempotency.',
  outputs: [
    { id: 'main', name: 'Output', type: 'json', direction: 'output', required: false },
  ],
};

export const TelegramPollingTrigger: ConnectorTrigger = {
  name: 'trigger.telegram',
  type: 'telegram',
  description: 'Telegram Bot getUpdates long-polling trigger.',
  outputs: [
    { id: 'main', name: 'Output', type: 'json', direction: 'output', required: false },
  ],
};

export const CORE_TRIGGERS: Record<string, ConnectorTrigger> = {
  'trigger.manual': ManualTrigger,
  'trigger.cron': CronTrigger,
  'trigger.webhook': WebhookTrigger,
  'trigger.telegram': TelegramPollingTrigger,
};
