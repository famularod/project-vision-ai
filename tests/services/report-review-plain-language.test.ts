import { plainReportReviewFlag, plainReportReviewFlags } from '../../services/ReportReviewPlainLanguage';
import { evaluateReportApprovalPolicy } from '../../services/ReportApprovalPolicy';
import { stripProjectWalkBoilerplate } from '../../services/DAVEReportIntelligence';

describe('report review plain language', () => {
  it('replaces engine names with an instruction and fixes doubled punctuation', () => {
    expect(plainReportReviewFlag('Executive action needs verification: Confirm the decision status..'))
      .toBe('Check before acting: Confirm the decision status.');
    expect(plainReportReviewFlag('Reflection confidence is low; review the report before communication.'))
      .not.toMatch(/Reflection/);
    expect(plainReportReviewFlag('One or more action items need an owner.'))
      .toBe('One or more action items need an owner.');
  });

  it('collapses flags that say the same thing', () => {
    expect(plainReportReviewFlags([
      'Executive action needs verification: Confirm the decision status..',
      'Wait for evidence before final recommendation: Confirm the decision status.',
      'Reflection confidence is low; review the report before communication.',
      'Executive Judgment readiness is Uncertain; review before communicating.',
    ])).toHaveLength(2);
  });

  it('keeps a flag blocking after rewording and de-duplicates policy items', () => {
    const policy = evaluateReportApprovalPolicy({
      report: {
        needsReview: true,
        reviewFlags: [
          'Current situation needs evidence: no supporting project record.',
          'Executive action needs verification: Confirm X..',
          'Wait for evidence before final recommendation: Confirm X.',
        ],
      },
      reportGenerationAllowed: true,
      authorityState: 'ready',
    });
    expect(policy.items).toHaveLength(2);
    expect(policy.items[0].kind).toBe('blocking');
  });

  it('removes Project Walk drafting headers from report text', () => {
    expect(stripProjectWalkBoilerplate(
      'Project Walk draft — review before sending Prepared from 1 confirmed field memory. Confirmed area: East Driveway Area: East Driveway General note: Concrete is being poured.',
    )).toBe('Concrete is being poured.');
    expect(stripProjectWalkBoilerplate('Saw cut new door openings.')).toBe('Saw cut new door openings.');
  });
});
