/**
 * @jest-environment node
 */
import type { DAVEReportSnapshot } from '../../services/DAVEReportSnapshot';
import { daveWebReportFromBeforeRememberedSends } from '../../services/DAVEWebReportSend';

// R1 item 3 (8 Oct 2026): which reports are "from before the last three this
// computer remembers sending". The rule on its own; the page test beside this
// one shows the sentence on the Reports page. Synthetic data.

jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() }));

const day = (n: number) => `2026-09-${String(n).padStart(2, '0')}T15:00:00.000Z`;
/** A period that runs from the report sent on the last of `days`, remembering the ones before it as a saved period does. */
function periodOf(...days: number[]): DAVEReportSnapshot {
  return days.reduce<DAVEReportSnapshot | null>((earlier, n) => ({
    version: 'dave-report-snapshot/1.0', scopeKey: 'tower', capturedAt: day(n), sourceFingerprint: `facts-${n}`, reportFormat: 'project_manager',
    tasks: [], deliveredAt: day(n), ...(earlier ? { supersedes: earlier } : {}),
  }) as unknown as DAVEReportSnapshot, null) as DAVEReportSnapshot;
}

describe('R1 item 3: a report from before the sent reports the period remembers', () => {
  it('three remembered (sent on the 14th, 21st and 28th): one that counted from the 7th, or from no report, is from before them', () => {
    const period = periodOf(7, 14, 21, 28);
    expect(daveWebReportFromBeforeRememberedSends(period, `sent:${day(7)}`)).toBe(true);
    expect(daveWebReportFromBeforeRememberedSends(period, 'none')).toBe(true);
  });

  it('one that counted from the oldest remembered report, or a later one, is not', () => {
    const period = periodOf(7, 14, 21, 28);
    expect(daveWebReportFromBeforeRememberedSends(period, `sent:${day(14)}`)).toBe(false);
    expect(daveWebReportFromBeforeRememberedSends(period, `sent:${day(28)}`)).toBe(false);
  });

  it('a period that remembers fewer than three remembers every report sent: nothing is from before them', () => {
    expect(daveWebReportFromBeforeRememberedSends(periodOf(21, 28), 'none')).toBe(false);
    expect(daveWebReportFromBeforeRememberedSends(periodOf(21, 28), `sent:${day(7)}`)).toBe(false);
    expect(daveWebReportFromBeforeRememberedSends(null, 'none')).toBe(false);
  });

  it('a report saved before reports kept their period: not known, so not called older', () => {
    expect(daveWebReportFromBeforeRememberedSends(periodOf(7, 14, 21, 28), undefined)).toBe(false);
    expect(daveWebReportFromBeforeRememberedSends(periodOf(7, 14, 21, 28), null)).toBe(false);
  });
});
