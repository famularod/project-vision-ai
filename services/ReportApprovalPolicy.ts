import type { PIEReportDraft } from './domains/reporting';
import type { PIELiveAuthorityStateName } from './PIELiveAuthorityStateMachine';

export type ReportReviewItem = Readonly<{
  /** Stable for the same text, so an acknowledgement survives re-renders. */
  id: string;
  text: string;
  /** blocking: the report cannot be trusted until the data is fixed.
   *  advisory: the reviewer must look at it and may then approve. */
  kind: 'blocking' | 'advisory';
}>;

export type ReportApprovalPolicy = {
  allowed: boolean;
  /** Every unresolved review item as text (kept for existing callers). */
  blockingReasons: string[];
  items: ReportReviewItem[];
  pendingAdvisoryIds: string[];
  /** True only while project data is genuinely not available yet. */
  waitingForProjectData: boolean;
  message: string;
};

// The report would describe nothing real, or the wrong project. These cannot be
// waved through by a reviewer; the project data has to change.
const BLOCKING_FLAG = /no supporting|no evidence|missing supporting|missing project|project assignment/i;

const AUTHORITY_ADVISORY: Partial<Record<PIELiveAuthorityStateName, string>> = {
  degraded_local_only:
    'This report uses the information saved on this device. Cloud confirmation is not available right now.',
  queued_for_cloud:
    'This report uses the information saved on this device. It will be confirmed with the cloud when a connection is available.',
  persistence_failed:
    'Project understanding could not be saved to the cloud. The report is built from your saved tasks and field updates.',
  unavailable:
    'Project understanding is not fully available. The report is built from your saved tasks and field updates.',
  stale_model:
    'Project understanding may be out of date. Check that the tasks and updates below are current.',
  conflict_blocked:
    'Vitruvius found project records that may disagree with each other. Check the report details against what you know.',
};

/**
 * The reviewer is the control. Hard blocks are limited to cases where there is
 * nothing trustworthy to review (data still loading, no trusted project
 * connection, no evidence, wrong project). Everything else is shown to the
 * reviewer and must be acknowledged before approval, copy, email, or text.
 */
export function evaluateReportApprovalPolicy({
  report,
  reportGenerationAllowed,
  authorityState,
  acknowledgedItemIds = [],
}: {
  report: Pick<PIEReportDraft, 'needsReview' | 'reviewFlags'>;
  reportGenerationAllowed: boolean;
  /** When omitted, reportGenerationAllowed=false stays a hard block. */
  authorityState?: PIELiveAuthorityStateName;
  acknowledgedItemIds?: readonly string[];
}): ReportApprovalPolicy {
  const flags = Array.from(new Set(
    report.reviewFlags.map(flag => flag.trim()).filter(Boolean),
  ));
  if (report.needsReview && flags.length === 0) {
    flags.push('This report still requires review before sharing.');
  }
  const items: ReportReviewItem[] = flags.map(text => ({
    id: reviewItemId(text),
    text,
    kind: BLOCKING_FLAG.test(text) ? 'blocking' : 'advisory',
  }));

  const waitingForProjectData = authorityState === 'loading';
  const untrustedConnection =
    authorityState === 'blocked_identity' || authorityState === 'blocked_organization';
  const authorityAdvisory = authorityState ? AUTHORITY_ADVISORY[authorityState] : undefined;
  const legacyAuthorityBlock = authorityState === undefined && !reportGenerationAllowed;
  if (authorityAdvisory && !reportGenerationAllowed) {
    items.unshift({
      id: `authority:${authorityState}`,
      text: authorityAdvisory,
      kind: 'advisory',
    });
  }

  const acknowledged = new Set(acknowledgedItemIds);
  const pendingAdvisoryIds = items
    .filter(item => item.kind === 'advisory' && !acknowledged.has(item.id))
    .map(item => item.id);
  const blockingCount = items.filter(item => item.kind === 'blocking').length;
  const base = {
    blockingReasons: items.map(item => item.text),
    items,
    pendingAdvisoryIds,
    waitingForProjectData,
  };

  if (waitingForProjectData) {
    return { ...base, allowed: false, message: 'Project data is still loading. Approval unlocks when it finishes.' };
  }
  if (untrustedConnection) {
    return { ...base, allowed: false, message: 'Sign in to a trusted project connection before approving this report.' };
  }
  if (legacyAuthorityBlock) {
    return { ...base, allowed: false, message: 'Report approval is unavailable until the live project authority is ready.' };
  }
  if (blockingCount > 0) {
    return {
      ...base,
      allowed: false,
      message: `${blockingCount} item${blockingCount === 1 ? '' : 's'} must be fixed in the project before this report can be approved.`,
    };
  }
  if (pendingAdvisoryIds.length > 0) {
    const count = pendingAdvisoryIds.length;
    return {
      ...base,
      allowed: false,
      message: `${count} item${count === 1 ? '' : 's'} need${count === 1 ? 's' : ''} your review below. Mark ${count === 1 ? 'it' : 'them'} reviewed to approve.`,
    };
  }
  return { ...base, allowed: true, message: 'The report is ready for approval.' };
}

export function reviewItemId(text: string): string {
  const normalized = text.trim().toLowerCase().replace(/\s+/g, ' ');
  let hash = 5381;
  for (let index = 0; index < normalized.length; index += 1) {
    hash = ((hash << 5) + hash + normalized.charCodeAt(index)) | 0;
  }
  return `flag:${(hash >>> 0).toString(36)}:${normalized.length}`;
}
