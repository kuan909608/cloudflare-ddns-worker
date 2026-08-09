import { describe, expect, it } from 'vitest';
import { formatLocalDateTime } from '../frontend/src/services/date-time';

describe('admin local date and time formatting', () => {
  it('converts UTC timestamps into the requested local time zone', () => {
    expect(formatLocalDateTime('2026-08-09T15:13:49.761Z', 'Asia/Taipei')).toContain('23:13:49');
  });

  it('uses a placeholder for missing or invalid timestamps', () => {
    expect(formatLocalDateTime(null)).toBe('—');
    expect(formatLocalDateTime('not-a-date')).toBe('—');
  });
});
