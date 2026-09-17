import type { PIEReportDraft } from './domains/reporting';
import type { PIELiveAuthorityStateName } from './PIELiveAuthorityStateMachine';

export type ReportReadinessReason =
  | { code: 'authority_loading' }
  | { code: 'authority_conflicts'; count: number }
  | { code: 'authority_offline_or_save_failed' }
  | { code: 'authority_needs_device_data_ack' }
  | { code: 'authority_stale' }
  | { code: 'review_flags'; flags: string[] }
  | { code: 'ready' };

export function diagnoseReportReadiness({
  state,
  reportGenerationAllowed,
  degradedLocalAcknowledged,
  activeConflictCount,
  report,
}: {
  state: PIELiveAuthorityStateName;
  reportGenerationAllowed: boolean;
  degradedLocalAcknowledged: boolean;
  activeConflictCount: number;
  report: Pick<PIEReportDraft, 'needsReview' | 'reviewFlags'>;
}): ReportReadinessReason {
  if (state === 'loading') return { code: 'authority_loading' };
  if (state === 'conflict_blocked') {
    return { code: 'authority_conflicts', count: Math.max(1, activeConflictCount) };
  }
  if (state === 'stale_model') return { code: 'authority_stale' };
  if ((state === 'queued_for_cloud' || state === 'degraded_local_only') && !degradedLocalAcknowledged) {
    return { code: 'authority_needs_device_data_ack' };
  }
  if (state === 'persistence_failed' || state === 'unavailable') {
    return { code: 'authority_offline_or_save_failed' };
  }

  const flags = Array.from(new Set(report.reviewFlags.map(flag => flag.trim()).filter(Boolean)));
  if (flags.length > 0 || report.needsReview) {
    return {
      code: 'review_flags',
      flags: flags.length ? flags : ['This report still requires review before sharing.'],
    };
  }
  if (!reportGenerationAllowed) return { code: 'authority_offline_or_save_failed' };
  return { code: 'ready' };
}
