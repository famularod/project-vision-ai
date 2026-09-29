import type { UpdatePhoto } from '../types';

type PhotoIntelligence = NonNullable<UpdatePhoto['photoIntelligence']>;

/**
 * How long an "Analyzing" state is believable. The phone gives up on an
 * analysis after ANALYSIS_TIMEOUT_SECONDS (135 s); an older "Analyzing" on
 * the desktop means the phone finished (or stopped) after it had already
 * synced the update, and the result never reached the cloud (code review
 * 27 Sep 2026).
 */
export const STALE_ANALYZING_AFTER_MS = 10 * 60 * 1000;

export type PhotoAnalysisDisplayStatus = Readonly<{
  label: string;
  tone: 'good' | 'attention' | 'danger' | 'neutral';
}>;

export function photoAnalysisDisplayStatus(
  intelligence: Pick<PhotoIntelligence, 'status' | 'updatedAt'>,
  now = Date.now(),
): PhotoAnalysisDisplayStatus {
  const { status } = intelligence;
  if (status === 'analysis_complete') return { label: 'Analysis complete', tone: 'good' };
  if (status === 'completed_with_limitations') return { label: 'Limited comparison', tone: 'attention' };
  if (status === 'comparison_unavailable') return { label: 'Comparison unavailable', tone: 'attention' };
  if (status === 'analysis_failed_retry') return { label: 'Retry needed', tone: 'danger' };
  if (status === 'no_suitable_prior_photo') return { label: 'Baseline only', tone: 'neutral' };
  const startedAt = Date.parse(intelligence.updatedAt || '');
  if (Number.isFinite(startedAt) && now - startedAt > STALE_ANALYZING_AFTER_MS) {
    return { label: 'Result not synced from the phone', tone: 'attention' };
  }
  return { label: 'Analyzing', tone: 'neutral' };
}
