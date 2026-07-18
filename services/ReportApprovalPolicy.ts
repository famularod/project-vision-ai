import type { PIEReportDraft } from './domains/reporting';

export type ReportApprovalPolicy = {
  allowed: boolean;
  blockingReasons: string[];
  message: string;
};

/**
 * Report review flags describe unresolved evidence or authority questions.
 * Approval is therefore fail-closed: the same unresolved questions that are
 * shown to the reviewer must also prevent copy, email, and text actions.
 */
export function evaluateReportApprovalPolicy({
  report,
  reportGenerationAllowed,
}: {
  report: Pick<PIEReportDraft, 'needsReview' | 'reviewFlags'>;
  reportGenerationAllowed: boolean;
}): ReportApprovalPolicy {
  const blockingReasons = Array.from(new Set(
    report.reviewFlags
      .map(flag => flag.trim())
      .filter(Boolean),
  ));

  if (report.needsReview && blockingReasons.length === 0) {
    blockingReasons.push('This report still requires review before sharing.');
  }

  if (!reportGenerationAllowed) {
    return {
      allowed: false,
      blockingReasons,
      message: 'Report approval is unavailable until the live project authority is ready.',
    };
  }

  if (blockingReasons.length > 0) {
    return {
      allowed: false,
      blockingReasons,
      message: `${blockingReasons.length} review item${blockingReasons.length === 1 ? '' : 's'} must be resolved before approval or sharing.`,
    };
  }

  return {
    allowed: true,
    blockingReasons: [],
    message: 'The report is ready for approval.',
  };
}
