import { ECOS_ARCHITECTURE } from '../../product-brand';
import {
  photoDisplayResultCanInformProject,
  type PhotoAssessmentDisplayResult,
} from '../../services/PhotoAssessment';
import { evaluateReportApprovalPolicy } from '../../services/ReportApprovalPolicy';

describe('ECOS Core and ECOS Assurance boundary', () => {
  it('never allows Core to approve its own work', () => {
    expect(ECOS_ARCHITECTURE.coreMayApproveOwnWork).toBe(false);
    expect(ECOS_ARCHITECTURE.assuranceIsIndependent).toBe(true);
  });

  it('keeps a visually grounded finding proposed until a person confirms it', () => {
    const proposal: PhotoAssessmentDisplayResult = {
      status: 'analysis_complete',
      assessmentDisposition: 'finding',
      visibleChange: 'A visible condition requires review.',
      findings: [{ findingType: 'change' }],
      priorEvidenceId: 'prior-photo',
      comparability: 'strong',
      provenance: 'visual_only',
      userReview: null,
    };

    expect(photoDisplayResultCanInformProject(proposal)).toBe(false);
    expect(photoDisplayResultCanInformProject({
      ...proposal,
      userReview: 'confirmed',
    })).toBe(true);
  });

  it('fails report approval closed while authority or review questions remain', () => {
    expect(evaluateReportApprovalPolicy({
      report: { needsReview: false, reviewFlags: [] },
      reportGenerationAllowed: false,
    }).allowed).toBe(false);

    expect(evaluateReportApprovalPolicy({
      report: { needsReview: true, reviewFlags: ['Confirm the project identity.'] },
      reportGenerationAllowed: true,
    })).toMatchObject({
      allowed: false,
      blockingReasons: ['Confirm the project identity.'],
    });
  });
});
