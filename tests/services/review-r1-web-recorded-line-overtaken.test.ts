/**
 * @jest-environment node
 */
import { daveWebReportRecordedLineNow } from '../../services/DAVEWebReportPeriod';

// R1 item 1 (8 Oct 2026): when the "Recorded as sent" line stops saying the
// next report runs from this one. The rule on its own; the page test beside
// this one shows it on the Reports page. Synthetic data.

jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() }));

const RECORDED = { sentAt: '2026-10-01T14:00:00.000Z', scopeKey: 'tower', reportFormat: 'project_manager' };
const page = (over: Partial<Parameters<typeof daveWebReportRecordedLineNow>[1]> = {}) => ({
  scopeKey: 'tower', reportFormat: 'project_manager', periodSentAt: '2026-10-01T15:00:00.000Z', periodSendFromThisBrowser: false, ...over,
});

describe('R1 item 1: the rule for the "Recorded as sent" line', () => {
  it('a later send for the same projects and format: the line says whose, and that the next report counts from it', () => {
    expect(daveWebReportRecordedLineNow(RECORDED, page())).toMatch(/^Recorded as sent .*\. Your other device sent a later report .*, so the next report counts from that one\.$/);
    expect(daveWebReportRecordedLineNow(RECORDED, page({ periodSendFromThisBrowser: true }))).toMatch(/\. Another tab of this browser sent a later report /);
  });

  it('the period still runs from this send, from an earlier one, or from none: the line stands', () => {
    expect(daveWebReportRecordedLineNow(RECORDED, page({ periodSentAt: RECORDED.sentAt }))).toBeNull();
    expect(daveWebReportRecordedLineNow(RECORDED, page({ periodSentAt: '2026-10-01T10:00:00.000Z' }))).toBeNull();
    expect(daveWebReportRecordedLineNow(RECORDED, page({ periodSentAt: null }))).toBeNull();
  });

  it('other projects, or the other format, on screen: their period says nothing about this line', () => {
    expect(daveWebReportRecordedLineNow(RECORDED, page({ scopeKey: 'annex' }))).toBeNull();
    expect(daveWebReportRecordedLineNow(RECORDED, page({ reportFormat: 'executive' }))).toBeNull();
  });
});
