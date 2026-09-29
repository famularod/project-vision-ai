import type { UpdatePhoto } from '../types';

type PhotoIntelligence = NonNullable<UpdatePhoto['photoIntelligence']>;

/**
 * How long an "Analyzing" state is believable. The state is stamped when a
 * photo is added, and the photos of one pick (up to 10) are analysed one
 * after another, each for up to 120 s plus sign-in retries, so the last of a
 * batch can honestly still be analysing well past 10 minutes (review pass 8,
 * 28 Sep 2026). Past 30 minutes, the phone finished or stopped after it had
 * synced the update and the result never reached the cloud (code review
 * 27 Sep 2026).
 */
export const STALE_ANALYZING_AFTER_MS = 30 * 60 * 1000;

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
