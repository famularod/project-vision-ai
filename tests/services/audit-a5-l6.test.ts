import { localDateText } from '../../services/DAVETaskAreaSummary';

const fs = jest.requireActual('fs') as typeof import('fs');
const path = jest.requireActual('path') as typeof import('path');
const summary = fs.readFileSync(path.resolve(__dirname, '../../services/DAVETaskAreaSummary.ts'), 'utf8');

// Whole-app audit A5 pass 2 L6 (30 Sep 2026): a parsed schedule date is local
// midnight, and reading its day through UTC showed the day before east of UTC.
describe('task-area summary dates', () => {
  it('read the local calendar day whatever the time of day', () => {
    const lateEvening = new Date(2026, 8, 28, 23, 30);
    expect(localDateText(lateEvening)).toBe('2026-09-28');
    expect(localDateText(new Date(2026, 9, 5))).toBe('2026-10-05');
  });

  it('the earliest start and latest finish labels use it', () => {
    expect(summary).toContain("earliestStartLabel: earliestStart ? formatAppDate(localDateText(earliestStart)) : 'Not set',");
    expect(summary).toContain("latestFinishLabel: latestFinish ? formatAppDate(localDateText(latestFinish)) : 'Not set',");
    expect(summary).not.toContain('toISOString().slice(0, 10)');
  });
});
