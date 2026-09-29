/**
 * Code review, 27 Sep 2026: a photo analysis that finished after its field
 * update had synced stayed on the phone, and the desktop showed "Analyzing"
 * for good. The phone now sends the update again when a late result arrives;
 * the desktop names an "Analyzing" that is too old to be real.
 */
import {
  photoAnalysisDisplayStatus,
  STALE_ANALYZING_AFTER_MS,
} from '../../services/PhotoAnalysisDisplayStatus';

const NOW = Date.parse('2026-09-28T22:00:00.000Z');
const ago = (ms: number) => new Date(NOW - ms).toISOString();

describe('desktop photo analysis status', () => {
  it('keeps the finished states as before', () => {
    expect(photoAnalysisDisplayStatus({ status: 'analysis_complete', updatedAt: ago(0) }, NOW))
      .toEqual({ label: 'Analysis complete', tone: 'good' });
    expect(photoAnalysisDisplayStatus({ status: 'analysis_failed_retry', updatedAt: ago(0) }, NOW))
      .toEqual({ label: 'Retry needed', tone: 'danger' });
    expect(photoAnalysisDisplayStatus({ status: 'no_suitable_prior_photo', updatedAt: ago(0) }, NOW).label)
      .toBe('Baseline only');
  });

  it('shows a recent analysis as Analyzing', () => {
    expect(photoAnalysisDisplayStatus({ status: 'analyzing', updatedAt: ago(60_000) }, NOW))
      .toEqual({ label: 'Analyzing', tone: 'neutral' });
  });

  it('names an Analyzing too old to be real, instead of showing it forever', () => {
    expect(photoAnalysisDisplayStatus({ status: 'analyzing', updatedAt: ago(STALE_ANALYZING_AFTER_MS + 1) }, NOW))
      .toEqual({ label: 'Result not synced from the phone', tone: 'attention' });
  });

  it('is used by the desktop, and the phone re-sends an already-synced update on a late result', () => {
    const fs = jest.requireActual('fs') as typeof import('fs');
    const path = jest.requireActual('path') as typeof import('path');
    const shell = fs.readFileSync(path.resolve(__dirname, '../../components/web-shell/desktop-read-only-shell.tsx'), 'utf8');
    expect(shell).toContain('photoAnalysisDisplayStatus(intelligence).label');
    expect(shell).not.toContain("return 'Analyzing';");
    const app = fs.readFileSync(path.resolve(__dirname, '../../App.tsx'), 'utf8');
    expect(app).toContain("if (saved && result.status !== 'analyzing' && (saved.status === 'sent' || saved.status === 'queued')) {");
    expect(app).toContain("upsertSavedUpdateUnlessDeleted({ ...applyToUpdate(saved), status: 'queued' });");
    // A request during a running pass is followed by one more pass inside the
    // same task (a new task would hit the guard's 2-run limit; review pass 3).
    expect(app).toContain('queuedHydrationRerunRequested.current = true;');
    expect(app).toMatch(/do \{\s+queuedHydrationRerunRequested\.current = false;\s+try \{\s+await hydrateQueuedUpdatesPass\(\);/);
    // A pass that throws still runs a requested rerun (review pass 4).
    expect(app).toContain('if (!queuedHydrationRerunRequested.current) throw error;');
    expect(app).toContain('} while (queuedHydrationRerunRequested.current);');
    expect(app).not.toContain("startAutomaticSyncBackgroundTask('late_photo_analysis', hydrateQueuedUpdates);\n      }");
  });
});
