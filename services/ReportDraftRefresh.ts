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
