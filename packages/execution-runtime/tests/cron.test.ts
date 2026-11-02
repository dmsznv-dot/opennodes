import { describe, it, expect } from 'vitest';
import { nextCronTime, parseCron, scheduleToCron } from '../src/index.js';

const next = (cron: string, after: string, tz = 'UTC') =>
  nextCronTime(cron, new Date(after), tz).toISOString();

describe('cron schedules', () => {
  it('finds the next run in UTC', () => {
    expect(next('*/15 * * * *', '2026-11-02T10:07:30Z')).toBe('2026-11-02T10:15:00.000Z');
    expect(next('*/15 * * * *', '2026-11-02T10:15:00Z')).toBe('2026-11-02T10:30:00.000Z');
    expect(next('0 9 * * 1-5', '2026-11-06T09:00:00Z')).toBe('2026-11-09T09:00:00.000Z'); // Fri → Mon
    expect(next('@monthly', '2026-11-02T00:00:00Z')).toBe('2026-12-01T00:00:00.000Z');
    expect(next('0 0 * * sun', '2026-11-02T00:00:00Z')).toBe('2026-11-08T00:00:00.000Z');
    expect(next('0 0 * * 7', '2026-11-02T00:00:00Z')).toBe('2026-11-08T00:00:00.000Z');
  });

  it('runs on local wall-clock time in the trigger time zone', () => {
    // 09:00 in Moscow (UTC+3) is 06:00 UTC.
    expect(next('0 9 * * *', '2026-11-02T07:00:00Z', 'Europe/Moscow')).toBe(
      '2026-11-03T06:00:00.000Z'
    );
    expect(next('0 9 * * *', '2026-11-02T05:00:00Z', 'Europe/Moscow')).toBe(
      '2026-11-02T06:00:00.000Z'
    );
    // Half-hour zone: 08:00 in Kolkata (UTC+5:30) is 02:30 UTC.
    expect(next('0 8 * * *', '2026-11-02T03:00:00Z', 'Asia/Kolkata')).toBe(
      '2026-11-03T02:30:00.000Z'
    );
  });

  it('handles daylight saving: a skipped time does not fire, a repeated one fires once', () => {
    // Berlin springs forward 2026-03-29 02:00 → 03:00: 02:30 does not exist that day.
    expect(next('30 2 * * *', '2026-03-28T12:00:00Z', 'Europe/Berlin')).toBe(
      '2026-03-30T00:30:00.000Z'
    );
    // Midnight right after a DST change is not skipped.
    expect(next('0 0 * * *', '2026-03-28T12:00:00Z', 'Europe/Berlin')).toBe(
      '2026-03-28T23:00:00.000Z'
    );
    // Berlin falls back 2026-10-25 03:00 → 02:00: 02:30 happens twice, fires once.
    expect(next('30 2 * * *', '2026-10-24T12:00:00Z', 'Europe/Berlin')).toBe(
      '2026-10-25T00:30:00.000Z'
    );
    expect(next('30 2 * * *', '2026-10-25T00:30:00Z', 'Europe/Berlin')).toBe(
      '2026-10-26T01:30:00.000Z'
    );
  });

  it('matches either day field when both are restricted, like Vixie cron', () => {
    // The 13th or any Friday: Friday 6 November comes first.
    expect(next('0 0 13 * 5', '2026-11-01T00:00:00Z')).toBe('2026-11-06T00:00:00.000Z');
  });

  it('rejects malformed and impossible schedules', () => {
    expect(() => parseCron('* * * *')).toThrow(/expected 5 fields/);
    expect(() => parseCron('61 * * * *')).toThrow(/minute "61" must be 0-59/);
    expect(() => parseCron('* * * * mon-fri/0')).toThrow(/bad day of week/);
    expect(() => parseCron('0 0 5-1 * *')).toThrow(/reversed/);
    expect(() => nextCronTime('0 0 31 2 *', new Date())).toThrow(/never fires/);
  });

  it('turns the editor settings into cron', () => {
    expect(scheduleToCron({ every: 'every15m' })).toBe('*/15 * * * *');
    expect(scheduleToCron({ every: 'hourly' })).toBe('0 * * * *');
    expect(scheduleToCron({ every: 'daily', time: '09:05' })).toBe('5 9 * * *');
    expect(scheduleToCron({ every: 'weekly', time: '18:30' })).toBe('30 18 * * 1');
    expect(scheduleToCron({})).toBe('0 9 * * *');
    expect(scheduleToCron({ every: 'daily', cron: '0 8 * * 1-5' })).toBe('0 8 * * 1-5');
    expect(scheduleToCron({ cronExpression: '0 8 * * *' })).toBe('0 8 * * *');
    expect(() => scheduleToCron({ every: 'daily', time: '25:00' })).toThrow(/Invalid time/);
    expect(() => scheduleToCron({ every: 'sometimes' })).toThrow(/Unknown schedule/);
  });
});
