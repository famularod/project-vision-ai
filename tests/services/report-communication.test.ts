/**
 * Audit P1-40: canceled or undetermined composer results must never mark a
 * report as communicated.
 */

import {
  mailComposerOutcome,
  shouldApplyCommunicationOutcome,
  shouldMarkCommunicationComplete,
  smsComposerOutcome,
} from '../../services/ReportCommunication';

describe('report communication outcomes', () => {
  it('maps mail composer statuses to real outcomes', () => {
    expect(mailComposerOutcome('sent')).toBe('completed');
    expect(mailComposerOutcome('cancelled')).toBe('canceled');
    expect(mailComposerOutcome('saved')).toBe('unknown');
    expect(mailComposerOutcome('undetermined')).toBe('unknown');
    expect(mailComposerOutcome(undefined)).toBe('unknown');
  });

  it('maps SMS composer results to real outcomes', () => {
    expect(smsComposerOutcome('sent')).toBe('completed');
    expect(smsComposerOutcome('cancelled')).toBe('canceled');
    expect(smsComposerOutcome('unknown')).toBe('unknown');
    expect(smsComposerOutcome(null)).toBe('unknown');
  });

  it('marks communication complete only for a completed outcome', () => {
    expect(shouldMarkCommunicationComplete('completed')).toBe(true);
    expect(shouldMarkCommunicationComplete('canceled')).toBe(false);
    expect(shouldMarkCommunicationComplete('unknown')).toBe(false);
  });

  it('applies a completed outcome only to the same currently approved report', () => {
    expect(shouldApplyCommunicationOutcome({
      outcome: 'completed',
      startedReportIdentity: 'report-a',
      currentReportIdentity: 'report-a',
      approvalAllowed: true,
      reportApproved: true,
    })).toBe(true);
    expect(shouldApplyCommunicationOutcome({
      outcome: 'completed',
      startedReportIdentity: 'report-a',
      currentReportIdentity: 'report-b',
      approvalAllowed: true,
      reportApproved: true,
    })).toBe(false);
    expect(shouldApplyCommunicationOutcome({
      outcome: 'completed',
      startedReportIdentity: 'report-a',
      currentReportIdentity: 'report-a',
      approvalAllowed: false,
      reportApproved: true,
    })).toBe(false);
    expect(shouldApplyCommunicationOutcome({
      outcome: 'canceled',
      startedReportIdentity: 'report-a',
      currentReportIdentity: 'report-a',
      approvalAllowed: true,
      reportApproved: true,
    })).toBe(false);
    expect(shouldApplyCommunicationOutcome({
      outcome: 'completed',
      startedReportIdentity: 'report-a',
      currentReportIdentity: 'report-a',
      approvalAllowed: true,
      reportApproved: false,
    })).toBe(false);
  });
});
