import { formatCalendarDate, parseFlexibleDate } from '../../utils/date';

describe('calendar date storage', () => {
  it('formats a local calendar day without an ISO timezone shift', () => {
    expect(formatCalendarDate(new Date(2026, 6, 19, 23, 45))).toBe('07/19/2026');
  });

  it('round-trips the existing schedule date format', () => {
    const parsed = parseFlexibleDate('07/31/2026');
    expect(parsed).not.toBeNull();
    expect(formatCalendarDate(parsed!)).toBe('07/31/2026');
  });
});
