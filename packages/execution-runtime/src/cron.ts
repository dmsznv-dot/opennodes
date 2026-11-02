/**
 * Standard 5-field cron (minute hour day-of-month month day-of-week) evaluated in an
 * IANA time zone. Supports `*`, lists, ranges, steps, month/day names, `7` = Sunday and
 * the @hourly/@daily/@weekly/@monthly/@yearly shorthands. As in Vixie cron, when both
 * day fields are restricted a day matches if either of them does.
 */

export class CronExpressionError extends Error {}

export interface ParsedCron {
  source: string;
  minutes: Set<number>;
  hours: Set<number>;
  daysOfMonth: Set<number>;
  months: Set<number>;
  daysOfWeek: Set<number>;
  anyDayOfMonth: boolean;
  anyDayOfWeek: boolean;
}

const MACROS: Record<string, string> = {
  '@yearly': '0 0 1 1 *',
  '@annually': '0 0 1 1 *',
  '@monthly': '0 0 1 * *',
  '@weekly': '0 0 * * 0',
  '@daily': '0 0 * * *',
  '@midnight': '0 0 * * *',
  '@hourly': '0 * * * *',
};

const MONTH_NAMES = [
  'jan',
  'feb',
  'mar',
  'apr',
  'may',
  'jun',
  'jul',
  'aug',
  'sep',
  'oct',
  'nov',
  'dec',
];
const DAY_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

interface FieldSpec {
  name: string;
  min: number;
  max: number;
  names?: string[];
  namesOffset?: number;
}

const FIELDS: FieldSpec[] = [
  { name: 'minute', min: 0, max: 59 },
  { name: 'hour', min: 0, max: 23 },
  { name: 'day of month', min: 1, max: 31 },
  { name: 'month', min: 1, max: 12, names: MONTH_NAMES, namesOffset: 1 },
  { name: 'day of week', min: 0, max: 7, names: DAY_NAMES, namesOffset: 0 },
];

function parseValue(raw: string, spec: FieldSpec, expr: string): number {
  const lower = raw.toLowerCase();
  const named = spec.names?.indexOf(lower) ?? -1;
  const value =
    named >= 0 ? named + (spec.namesOffset ?? 0) : /^\d+$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isInteger(value) || value < spec.min || value > spec.max) {
    throw new CronExpressionError(
      `Invalid cron expression "${expr}": ${spec.name} "${raw}" must be ${spec.min}-${spec.max}.`
    );
  }
  return value;
}

function parseField(field: string, spec: FieldSpec, expr: string): Set<number> {
  const out = new Set<number>();
  for (const part of field.split(',')) {
    const [range, stepRaw] = part.split('/');
    const step = stepRaw === undefined ? 1 : Number(stepRaw);
    if (
      !range ||
      !Number.isInteger(step) ||
      step < 1 ||
      (stepRaw !== undefined && !/^\d+$/.test(stepRaw))
    ) {
      throw new CronExpressionError(
        `Invalid cron expression "${expr}": bad ${spec.name} "${part}".`
      );
    }
    let from: number;
    let to: number;
    if (range === '*') {
      from = spec.min;
      to = spec.max;
    } else if (range.includes('-')) {
      const [a, b] = range.split('-');
      from = parseValue(a ?? '', spec, expr);
      to = parseValue(b ?? '', spec, expr);
      if (from > to) {
        throw new CronExpressionError(
          `Invalid cron expression "${expr}": range "${range}" is reversed.`
        );
      }
    } else {
      from = parseValue(range, spec, expr);
      to = stepRaw === undefined ? from : spec.max;
    }
    for (let v = from; v <= to; v += step) out.add(v);
  }
  return out;
}

export function parseCron(expression: string): ParsedCron {
  const source = expression.trim();
  const expanded = MACROS[source.toLowerCase()] ?? source;
  const parts = expanded.split(/\s+/);
  if (parts.length !== 5) {
    throw new CronExpressionError(
      `Invalid cron expression "${source}": expected 5 fields (minute hour day month weekday).`
    );
  }
  const [minutes, hours, daysOfMonth, months, daysOfWeek] = parts.map((p, i) =>
    parseField(p, FIELDS[i]!, source)
  ) as [Set<number>, Set<number>, Set<number>, Set<number>, Set<number>];
  if (daysOfWeek.delete(7)) daysOfWeek.add(0);
  return {
    source,
    minutes,
    hours,
    daysOfMonth,
    months,
    daysOfWeek,
    anyDayOfMonth: parts[2] === '*',
    anyDayOfWeek: parts[4] === '*',
  };
}

export function assertTimezone(timezone: string): void {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
  } catch {
    throw new CronExpressionError(
      `Unknown time zone "${timezone}". Use an IANA name like "Europe/Moscow".`
    );
  }
}

interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();
const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

function wallClock(at: Date, timezone: string): WallClock {
  let fmt = formatters.get(timezone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      weekday: 'short',
    });
    formatters.set(timezone, fmt);
  }
  const parts: Record<string, string> = {};
  for (const p of fmt.formatToParts(at)) parts[p.type] = p.value;
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    weekday: WEEKDAYS[parts.weekday ?? ''] ?? 0,
  };
}

function dayMatches(cron: ParsedCron, wc: WallClock): boolean {
  const dom = cron.daysOfMonth.has(wc.day);
  const dow = cron.daysOfWeek.has(wc.weekday);
  if (cron.anyDayOfMonth && cron.anyDayOfWeek) return true;
  if (cron.anyDayOfMonth) return dow;
  if (cron.anyDayOfWeek) return dom;
  return dom || dow;
}

const MINUTE = 60_000;
const SEARCH_LIMIT_MS = 5 * 366 * 24 * 60 * MINUTE;

/**
 * The first time strictly after `after` that the schedule fires, in `timezone`.
 * Wall-clock times skipped by a DST jump do not fire that day; a time repeated when
 * clocks go back fires once.
 */
export function nextCronTime(cron: ParsedCron | string, after: Date, timezone = 'UTC'): Date {
  const parsed = typeof cron === 'string' ? parseCron(cron) : cron;
  const start = wallClock(after, timezone);
  let t = Math.floor(after.getTime() / MINUTE) * MINUTE + MINUTE;
  const limit = after.getTime() + SEARCH_LIMIT_MS;
  while (t <= limit) {
    const wc = wallClock(new Date(t), timezone);
    if (!parsed.months.has(wc.month) || !dayMatches(parsed, wc)) {
      // Jump to 23:00 local and step hourly from there, so a DST change that day
      // can never carry us past midnight.
      t += (wc.hour < 22 ? (22 - wc.hour) * 60 + (60 - wc.minute) : 60 - wc.minute) * MINUTE;
      continue;
    }
    if (!parsed.hours.has(wc.hour)) {
      t += (60 - wc.minute) * MINUTE;
      continue;
    }
    if (!parsed.minutes.has(wc.minute)) {
      t += MINUTE;
      continue;
    }
    const sameWallMinute =
      wc.year === start.year &&
      wc.month === start.month &&
      wc.day === start.day &&
      wc.hour === start.hour &&
      wc.minute === start.minute;
    if (!sameWallMinute) return new Date(t);
    t += MINUTE;
  }
  throw new CronExpressionError(`Cron expression "${parsed.source}" never fires.`);
}

const EVERY_PRESETS = new Set(['every15m', 'hourly', 'daily', 'weekly']);

/**
 * The cron expression for a schedule trigger's settings: an explicit `cron`
 * (or legacy `cronExpression`) wins over the simple `every` + `time` choice.
 */
export function scheduleToCron(config: Record<string, unknown>): string {
  const custom = String(config.cron ?? config.cronExpression ?? '').trim();
  if (custom) return custom;
  const every = String(config.every ?? 'daily');
  if (!EVERY_PRESETS.has(every)) {
    throw new CronExpressionError(
      `Unknown schedule "${every}". Use every15m, hourly, daily, weekly or a cron expression.`
    );
  }
  if (every === 'every15m') return '*/15 * * * *';
  if (every === 'hourly') return '0 * * * *';
  const time = String(config.time ?? '09:00').trim();
  const m = /^(\d{1,2}):(\d{2})$/.exec(time);
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) {
    throw new CronExpressionError(`Invalid time "${time}". Use HH:MM, for example 09:00.`);
  }
  const at = `${Number(m[2])} ${Number(m[1])}`;
  return every === 'weekly' ? `${at} * * 1` : `${at} * * *`;
}
