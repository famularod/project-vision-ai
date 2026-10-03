/**
 * Audit round 2, lows (30 Sep 2026).
 *
 * L1: photo comparisons analysed before the Q9 build still showed "High
 * confidence" next to "Comparability: probable/weak" and scored 90. The Q9
 * cap is now also applied when a stored result is read or shown, when it has
 * no providerComparisonConfidence (the field every result since Q9 carries).
 *
 * L4: an archived update kept counting in Home totals, the Daily Brief and
 * report scope until the cloud copy returned.
 */
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async () => null),
    setItem: jest.fn(async () => undefined),
    removeItem: jest.fn(async () => undefined),
  },
}));

import fs from 'fs';
import path from 'path';
import {
  storedPhotoComparisonConfidence,
  withStoredPhotoComparisonCap,
} from '../../services/PhotoAssessment';
import { buildPhotoProgress } from '../../services/PIEPhotoProgress';
import { buildDAVEUpdatePhotoComparison } from '../../services/DAVEUpdateWorkspace';
import {
  buildCombinedReportAuthorityScope,
  buildDailyReportAuthorityScope,
  buildProjectIntelligenceAuthorityScope,
} from '../../services/ReportAuthorityScope';
import type { ProjectUpdate, UpdatePhoto } from '../../types';

const APP_SOURCE = fs.readFileSync(path.join(__dirname, '../../App.tsx'), 'utf8');

/** A comparison saved before the Q9 build: no providerComparisonConfidence. */
function preQ9Result(comparisonConfidence: string, comparability: string) {
  return {
    status: 'analysis_complete',
    title: 'Possible visible changes',
    summary: 'New conduit is visible along the west wall.',
    visibleChange: 'New conduit is visible along the west wall.',
    location: 'Area A',
    comparisonConfidence,
    comparability,
    captureLimitations: [],
    projectProgress: 'unable_to_determine',
    assessmentDisposition: 'finding',
    repeatPhotoGuidance: null,
    authorityMessage: 'Visual observation only.',
    findings: [{
      findingType: 'added', description: 'New conduit is visible along the west wall.', objectName: 'conduit',
      baselineState: 'not visible', currentState: 'visible', location: 'west wall', confidence: 0.95,
      limitations: [], evidenceRegions: [], source: 'structured_provider',
    }],
    priorUpdateUsed: '2026-07-01',
    priorEvidenceId: 'evidence-prior',
    provenance: 'visual_only',
    userReview: null,
    userReviewedAt: null,
    diagnostics: { selectedPriorPhotoId: 'prior' },
    updatedAt: '2026-07-02T10:05:00.000Z',
  } as unknown as NonNullable<UpdatePhoto['photoIntelligence']>;
}

function photo(id: string, photoIntelligence: UpdatePhoto['photoIntelligence'] = null): UpdatePhoto {
  return {
    id, uri: `file:///photos/${id}.jpg`, caption: '', category: 'Update', actionRequired: '', actionOwner: '',
    actionDueDate: '', actionStatus: 'Open', selectedAreaId: 'area-a', selectedAreaName: 'Area A',
    locationCapturedAt: id === 'prior' ? '2026-07-01T10:00:00.000Z' : '2026-07-02T10:00:00.000Z',
    photoIntelligence,
  };
}

function update(id: string, updatePhoto: UpdatePhoto, extra: Partial<ProjectUpdate> & { isArchived?: boolean } = {}): ProjectUpdate {
  return {
    id, projectName: 'Project A', date: updatePhoto.locationCapturedAt || '', photos: [updatePhoto], notes: 'Note.',
    recipients: { contactIds: [] }, selectedAreaId: 'area-a', selectedAreaName: 'Area A', status: 'sent', ...extra,
  } as ProjectUpdate;
}

describe('L1: a comparison stored before Q9 is capped when read or shown', () => {
  it('caps a pre-Q9 result by comparability; a result capped since Q9 reads unchanged', () => {
    expect(storedPhotoComparisonConfidence(preQ9Result('high', 'probable'))).toBe('medium');
    expect(storedPhotoComparisonConfidence(preQ9Result('high', 'weak'))).toBe('low');
    expect(storedPhotoComparisonConfidence(preQ9Result('high', 'strong'))).toBe('high');
    // Saved since Q9: already capped from a raw 'high', which is never read.
    const postQ9 = { ...preQ9Result('medium', 'probable'), providerComparisonConfidence: 'high' };
    expect(storedPhotoComparisonConfidence(postQ9)).toBe('medium');
    expect(withStoredPhotoComparisonCap(postQ9)).toBe(postQ9);
    const unchanged = preQ9Result('medium', 'probable');
    expect(withStoredPhotoComparisonCap(unchanged)).toBe(unchanged);
    expect(withStoredPhotoComparisonCap(preQ9Result('high', 'probable'))?.comparisonConfidence).toBe('medium');
  });

  it('photo progress no longer scores a probable pre-Q9 comparison as high, 90', () => {
    const progress = buildPhotoProgress({
      projectName: 'Project A',
      updates: [
        update('prior-update', photo('prior')),
        update('current-update', photo('current', preQ9Result('high', 'probable'))),
      ],
    });
    expect(progress.comparisons).toHaveLength(1);
    expect(progress.comparisons[0].confidence).toBe('medium');
    expect(progress.comparisons[0].confidenceScore).toBe(65);
    expect(progress.comparisons[0].matchReasons).toContain('Visual confidence: medium');
  });

  it('the Updates photo comparison shows the capped confidence', () => {
    const prior = update('prior-update', photo('prior'));
    const current = update('current-update', photo('current', preQ9Result('high', 'probable')));
    const comparison = buildDAVEUpdatePhotoComparison(current as never, [prior, current] as never);
    expect(comparison?.comparisonConfidence).toBe('medium');
    expect(comparison?.comparability).toBe('probable');
  });

  it('the app caps stored photo results when it reads them', () => {
    expect(APP_SOURCE).toContain('photoIntelligence: withStoredPhotoComparisonCap(photo.photoIntelligence)');
  });
});

describe('L4: an archived update stops counting at once', () => {
  const live = update('live-update', photo('live-photo'));
  const archived = update('archived-update', photo('archived-photo'), { isArchived: true });
  const base = {
    projectRecords: [{ name: 'Project A' }] as never,
    updates: [live, archived],
    scheduleItems: [],
    currentUpdate: null,
  };

  it('report scopes and the project intelligence scope leave it out', () => {
    expect(buildDailyReportAuthorityScope({ ...base, selectedProjectName: 'Project A', selectedProjectNames: ['Project A'] })
      .updates.map(item => item.id)).toEqual(['live-update']);
    expect(buildCombinedReportAuthorityScope({ ...base, selectedProjectNames: ['Project A'] })
      .updates.map(item => item.id)).toEqual(['live-update']);
    expect(buildProjectIntelligenceAuthorityScope({ ...base, selectedProjectName: 'Project A' })
      .updates.map(item => item.id)).toEqual(['live-update']);
  });

  it('Home totals, the Daily Brief and the live authority read an active list without archived updates', () => {
    expect(APP_SOURCE).toMatch(/const activeSavedUpdates = useMemo\(\(\) => savedUpdateTaskEvidence\.active\.filter\(update => !update\.isArchived\)/);
  });
});
