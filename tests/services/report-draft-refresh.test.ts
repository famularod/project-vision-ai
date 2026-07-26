import type { PIEReportDraft } from '../../services/domains/reporting';
import {
  selectStableReportDraft,
  type StableReportDraftCache,
} from '../../services/ReportDraftRefresh';

function reportDraft(id: string, reviewFlags: string[]): PIEReportDraft {
  return {
    id,
    reportType: 'combined_project_update',
    audience: 'internal_team',
    title: 'Combined Project Update',
    subject: 'Combined Project Update',
    body: 'Current project report.',
    openingLine: '',
    closingLine: '',
    executiveSummary: [],
    sections: [],
    locationGroups: [],
    actionItems: [],
    imageReferences: [],
    risks: [],
    decisionsNeeded: [],
    sourceEvidence: [],
    confidence: 'medium',
    reportReadiness: 'medium',
    needsReview: reviewFlags.length > 0,
    reviewFlags,
    constructionUnderstanding: {
      locationGroups: [],
      workAreas: [],
      executiveSummaryBullets: [],
      reviewFlags,
    },
    generatedAt: '2026-07-25T12:00:00.000Z',
  };
}

describe('stable report draft refresh selection', () => {
  it('keeps the completed live report while the same scope rebuilds', () => {
    const fallback = reportDraft('runtime-fallback', [
      'Missing owner.',
      'Missing work area.',
    ]);
    const live = reportDraft('live-combined', [
      'Missing owner.',
      'Missing work area.',
      'Schedule conflict.',
      'Missing supporting evidence.',
    ]);

    const accepted = selectStableReportDraft({
      scopeKey: 'combined|executive|2321|2375',
      liveDraft: live,
      fallbackDraft: fallback,
      cachedDraft: null,
    });

    const rebuilding = selectStableReportDraft({
      scopeKey: 'combined|executive|2321|2375',
      liveDraft: null,
      fallbackDraft: fallback,
      cachedDraft: accepted.cache,
    });

    expect(rebuilding.draft).toBe(live);
    expect(rebuilding.draft.reviewFlags).toHaveLength(4);
    expect(rebuilding.cache).toBe(accepted.cache);
  });

  it('does not carry a completed report into a different report scope', () => {
    const fallback = reportDraft('new-scope-fallback', ['Missing owner.']);
    const previousCache: StableReportDraftCache = {
      scopeKey: 'combined|executive|2321|2375',
      draft: reportDraft('previous-live-report', ['Schedule conflict.']),
    };

    const selection = selectStableReportDraft({
      scopeKey: 'daily|project_manager|2321',
      liveDraft: null,
      fallbackDraft: fallback,
      cachedDraft: previousCache,
    });

    expect(selection.draft).toBe(fallback);
    expect(selection.cache).toBeNull();
  });

  it('replaces the retained report once the refreshed live report is ready', () => {
    const previous = reportDraft('previous-live-report', ['Missing owner.']);
    const refreshed = reportDraft('refreshed-live-report', []);

    const selection = selectStableReportDraft({
      scopeKey: 'combined|project_manager|2321|2375',
      liveDraft: refreshed,
      fallbackDraft: reportDraft('runtime-fallback', ['Missing owner.']),
      cachedDraft: {
        scopeKey: 'combined|project_manager|2321|2375',
        draft: previous,
      },
    });

    expect(selection.draft).toBe(refreshed);
    expect(selection.cache?.draft).toBe(refreshed);
  });
});
