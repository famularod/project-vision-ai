import type { PIEReportDraft } from './domains/reporting';

export type StableReportDraftCache = Readonly<{
  scopeKey: string;
  draft: PIEReportDraft;
}>;

/**
 * Keeps the last completed live-authority report visible while the same report
 * scope is rebuilding. Without this boundary, a transient null live draft
 * falls back to the lightweight Runtime draft and makes approval warnings
 * appear and disappear during every background refresh.
 */
export function selectStableReportDraft({
  scopeKey,
  liveDraft,
  fallbackDraft,
  cachedDraft,
}: {
  scopeKey: string;
  liveDraft: PIEReportDraft | null;
  fallbackDraft: PIEReportDraft;
  cachedDraft: StableReportDraftCache | null;
}): {
  draft: PIEReportDraft;
  cache: StableReportDraftCache | null;
} {
  if (liveDraft) {
    const cache = Object.freeze({
      scopeKey,
      draft: liveDraft,
    });
    return { draft: liveDraft, cache };
  }

  if (cachedDraft?.scopeKey === scopeKey) {
    return { draft: cachedDraft.draft, cache: cachedDraft };
  }

  return { draft: fallbackDraft, cache: null };
}

/**
 * What an approval covers: the exact title and text, and the photos the text
 * cites. The draft's id is a build timestamp and changes on every background
 * rebuild (a sync, a new photo), so it must not decide whether the owner's
 * edits or approval survive (code review 27 Sep 2026: both were wiped on
 * every rebuild, although the screen said edits were saved).
 */
export function reportApprovalTextKey(
  draft: Pick<PIEReportDraft, 'title' | 'body' | 'locationGroups'>,
  /** The drawing excerpts the Word report embeds (independent review 28 Sep 2026). */
  drawingReferenceIds: readonly string[] = [],
): string {
  const citedPhotoIds = draft.locationGroups
    .flatMap(group => group.workAreas.flatMap(area => area.imageReferences))
    .map(reference => `${reference.imageNumber}:${reference.photoId}`)
    .sort();
  return JSON.stringify([draft.title, draft.body, citedPhotoIds, [...drawingReferenceIds].sort()]);
}
