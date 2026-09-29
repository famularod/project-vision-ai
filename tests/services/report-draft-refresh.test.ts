import type { PIEReportDraft } from '../../services/domains/reporting';
import {
  reportApprovalTextKey,
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

// Code review, 27 Sep 2026: the draft id is a build timestamp, and every
// background rebuild wiped the owner's edits and approval.
describe('what a report approval covers', () => {
  const withImages = (draft: PIEReportDraft, photoIds: string[]): PIEReportDraft => ({
    ...draft,
    locationGroups: [{
      id: 'g', title: 'g',
      workAreas: [{ imageReferences: photoIds.map((photoId, index) => ({ photoId, imageNumber: index + 1 })) }],
    }] as never,
  });

  it('is the same for a rebuilt draft with a new id and the same text and photos', () => {
    expect(reportApprovalTextKey(withImages(reportDraft('pie-report-1', []), ['p1'])))
      .toBe(reportApprovalTextKey(withImages(reportDraft('pie-report-2', ['flag']), ['p1'])));
  });

  it('changes when the text or a cited photo changes', () => {
    const base = withImages(reportDraft('a', []), ['p1']);
    expect(reportApprovalTextKey({ ...base, body: 'Different text.' })).not.toBe(reportApprovalTextKey(base));
    expect(reportApprovalTextKey({ ...base, title: 'Other title' })).not.toBe(reportApprovalTextKey(base));
    expect(reportApprovalTextKey(withImages(base, ['p2']))).not.toBe(reportApprovalTextKey(base));
  });

  it('is what the Reports screen keys approval and state on, not the draft id', () => {
    const fs = jest.requireActual('fs') as typeof import('fs');
    const path = jest.requireActual('path') as typeof import('path');
    const screen = fs.readFileSync(path.resolve(__dirname, '../../screens/ReportsScreen.tsx'), 'utf8');
    expect(screen).toContain('const approvalTextKey = reportApprovalTextKey(effectiveReportDraft);');
    expect(screen).not.toContain('}, [pieReportDraft.id]);');
    const identity = screen.slice(screen.indexOf('const reportStateIdentityKey = ['), screen.indexOf("].join('|');", screen.indexOf('const reportStateIdentityKey = [')));
    expect(identity).not.toContain('pieReportDraft.id');
  });
});
