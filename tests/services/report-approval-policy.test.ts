import { evaluateReportApprovalPolicy } from '../../services/ReportApprovalPolicy';

describe('report approval policy', () => {
  it('allows a ready report only when live report authority is available', () => {
    expect(evaluateReportApprovalPolicy({
      report: { needsReview: false, reviewFlags: [] },
      reportGenerationAllowed: true,
    })).toEqual({
      allowed: true,
      blockingReasons: [],
      message: 'The report is ready for approval.',
    });
  });

  it('keeps evidence, confidence, verification, and owner flags blocking', () => {
    const policy = evaluateReportApprovalPolicy({
      report: {
        needsReview: true,
        reviewFlags: [
          'Some source evidence has low confidence.',
          'One action needs verification.',
          'One or more action items need an owner.',
        ],
      },
      reportGenerationAllowed: true,
    });

    expect(policy.allowed).toBe(false);
    expect(policy.blockingReasons).toEqual([
      'Some source evidence has low confidence.',
      'One action needs verification.',
      'One or more action items need an owner.',
    ]);
    expect(policy.message).toBe('3 review items must be resolved before approval or sharing.');
  });

  it('fails closed when needsReview is true without a detailed flag', () => {
    expect(evaluateReportApprovalPolicy({
      report: { needsReview: true, reviewFlags: [] },
      reportGenerationAllowed: true,
    }).blockingReasons).toEqual([
      'This report still requires review before sharing.',
    ]);
  });

  it('blocks approval when the live authority is unavailable', () => {
    const policy = evaluateReportApprovalPolicy({
      report: { needsReview: false, reviewFlags: [] },
      reportGenerationAllowed: false,
    });

    expect(policy.allowed).toBe(false);
    expect(policy.message).toContain('live project authority');
  });
});
