/**
 * Audit round 2, H1 (30 Sep 2026): the Project Manager daily report printed
 * the NEWEST photo comparison as fact as soon as ANY comparison on the
 * project had been confirmed. An unconfirmed AI finding reached the report,
 * the finding the owner did confirm was dropped, and the area came from the
 * open draft (empty on the Reports screen, so "Alpha Hangar — Alpha Hangar").
 *
 * The report now prints only the newest CONFIRMED comparison, with its own
 * project and area, and only while it is recent. Tested through the path the
 * Reports screen uses: the daily-report scope, the runtime draft (shown while
 * the authority rebuilds) and the live Core draft.
 */
const mockStorage = new Map<string, string>();
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async (key: string) => mockStorage.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => {
      mockStorage.set(key, value);
    }),
    removeItem: jest.fn(async (key: string) => {
      mockStorage.delete(key);
    }),
  },
}));

import { buildRuntime, type PIERuntimeContext } from '../../services/PIERuntime';
import { buildLivePIECoreIntelligence } from '../../services/PIECoreIntelligence';
import { buildDailyReportAuthorityScope } from '../../services/ReportAuthorityScope';
import { buildPIEAttentionState } from '../../services/PIEAttentionEngine';
import type { ProjectUpdate, UpdatePhoto } from '../../types';

const DAY = 24 * 60 * 60 * 1000;
const PROJECT = 'Alpha Hangar';
const CONFIRMED = 'New conduit is visible along the north wall.';
const UNCONFIRMED = 'New drywall is visible along the south wall.';

function daysAgo(days: number) {
  return new Date(Date.now() - days * DAY).toISOString();
}

function intelligence(summary: string, priorPhotoId: string, confirmed: boolean) {
  return {
    status: 'analysis_complete',
    title: 'Possible visible changes',
    summary,
    visibleChange: summary,
    location: null,
    comparisonConfidence: 'medium',
    comparability: 'strong',
    captureLimitations: [],
    projectProgress: 'unable_to_determine',
    assessmentDisposition: 'finding',
    repeatPhotoGuidance: null,
    authorityMessage: 'Visual observation only.',
    findings: [{
      findingType: 'added',
      description: summary,
      objectName: 'material',
      baselineState: 'not visible',
      currentState: 'visible',
      location: 'wall',
      confidence: 0.9,
      limitations: [],
      evidenceRegions: [],
      source: 'structured_provider',
    }],
    priorUpdateUsed: null,
    priorEvidenceId: `evidence-${priorPhotoId}`,
    provenance: 'visual_only',
    userReview: confirmed ? 'confirmed' : null,
    userReviewedAt: confirmed ? daysAgo(1) : null,
    diagnostics: { selectedPriorPhotoId: priorPhotoId },
    updatedAt: daysAgo(1),
  } as unknown as UpdatePhoto['photoIntelligence'];
}

function photo(id: string, area: string, capturedAt: string, photoIntelligence: UpdatePhoto['photoIntelligence'] = null): UpdatePhoto {
  return {
    id,
    uri: `file:///photos/${id}.jpg`,
    caption: '',
    category: 'Update',
    actionRequired: '',
    actionOwner: '',
    actionDueDate: '',
    actionStatus: 'Open',
    selectedAreaId: `area-${area}`,
    selectedAreaName: area,
    locationCapturedAt: capturedAt,
    photoIntelligence,
  } as UpdatePhoto;
}

function update(id: string, area: string, capturedAt: string, updatePhoto: UpdatePhoto): ProjectUpdate {
  return {
    id,
    projectName: PROJECT,
    date: capturedAt.slice(0, 10),
    photos: [updatePhoto],
    notes: '',
    recipients: { contactIds: [] },
    selectedAreaId: `area-${area}`,
    selectedAreaName: area,
    status: 'sent',
  };
}

type Scenario = {
  confirmedAgeDays: number | null;
  unconfirmedAgeDays: number | null;
};

function updatesFor({ confirmedAgeDays, unconfirmedAgeDays }: Scenario) {
  const updates: ProjectUpdate[] = [];
  if (confirmedAgeDays !== null) {
    const priorAt = daysAgo(confirmedAgeDays + 5);
    const currentAt = daysAgo(confirmedAgeDays);
    updates.push(
      update('north-prior', 'North Bay', priorAt, photo('north-prior-photo', 'North Bay', priorAt)),
      update('north-current', 'North Bay', currentAt, photo(
        'north-current-photo', 'North Bay', currentAt,
        intelligence(CONFIRMED, 'north-prior-photo', true),
      )),
    );
  }
  if (unconfirmedAgeDays !== null) {
    const priorAt = daysAgo(unconfirmedAgeDays + 5);
    const currentAt = daysAgo(unconfirmedAgeDays);
    updates.push(
      update('south-prior', 'South Bay', priorAt, photo('south-prior-photo', 'South Bay', priorAt)),
      update('south-current', 'South Bay', currentAt, photo(
        'south-current-photo', 'South Bay', currentAt,
        intelligence(UNCONFIRMED, 'south-prior-photo', false),
      )),
    );
  }
  return updates;
}

/** The context App.tsx hands the live authority on the Reports screen. */
function reportsScreenContext(
  scenario: Scenario,
  reportType: 'daily_project_update' | 'executive_summary' = 'daily_project_update',
): PIERuntimeContext {
  const scope = buildDailyReportAuthorityScope({
    selectedProjectName: PROJECT,
    selectedProjectNames: [PROJECT],
    projectRecords: [{ name: PROJECT }] as never,
    updates: updatesFor(scenario),
    scheduleItems: [],
    currentUpdate: null,
  });
  return {
    projectName: scope.projectName,
    projectNames: scope.projectNames,
    reportType,
    updates: scope.updates,
    scheduleItems: scope.scheduleItems,
    currentUpdate: scope.currentUpdate,
    projectAreas: scope.projectAreas,
    contacts: scope.contacts,
    referenceDocuments: scope.referenceDocuments,
    surface: 'reports',
  };
}

async function reportDrafts(scenario: Scenario, reportType?: 'daily_project_update' | 'executive_summary') {
  const context = reportsScreenContext(scenario, reportType);
  const runtime = buildRuntime(context);
  const core = await buildLivePIECoreIntelligence({
    runtime,
    runtimeContext: context,
    reportType: context.reportType,
    reportProjectNames: context.projectNames,
    organizationId: 'local-unverified-anonymous',
    projectId: 'project-alpha-hangar',
    identityTrusted: false,
    cloudAvailable: false,
  });
  return { runtime, runtimeDraft: runtime.response.reportDraft, coreDraft: core.reportDraft };
}

function photoEvidence(draft: { sourceEvidence: Array<{ id: string; source: string; summary: string; projectName: string; areaName: string }> }) {
  return draft.sourceEvidence.filter(item => item.id.startsWith('runtime-photo-progress'));
}

beforeEach(() => {
  mockStorage.clear();
});

describe('H1: the daily report prints only a confirmed photo finding', () => {
  it('an unconfirmed newer finding stays out; the confirmed older one prints with its own area', async () => {
    const { runtimeDraft, coreDraft } = await reportDrafts({ confirmedAgeDays: 3, unconfirmedAgeDays: 1 });
    for (const draft of [runtimeDraft, coreDraft]) {
      expect(draft.body).not.toContain('drywall');
      expect(draft.body).toContain(CONFIRMED.replace(/\.$/, ''));
      expect(photoEvidence(draft as never)).toEqual([
        expect.objectContaining({ summary: CONFIRMED, projectName: PROJECT, areaName: 'North Bay' }),
      ]);
      expect(draft.body).not.toMatch(/Alpha Hangar\s*[—-]\s*Alpha Hangar/);
      expect(draft.body).toContain('Alpha Hangar / North Bay — New conduit');
    }
  });

  it('with nothing confirmed there is no photo sentence at all', async () => {
    const { runtimeDraft, coreDraft } = await reportDrafts({ confirmedAgeDays: null, unconfirmedAgeDays: 1 });
    for (const draft of [runtimeDraft, coreDraft]) {
      expect(photoEvidence(draft as never)).toEqual([]);
      expect(draft.body).not.toContain('drywall');
    }
  });

  it('a confirmed finding older than the report window is not printed as a current photo note', async () => {
    const { runtimeDraft, coreDraft } = await reportDrafts({ confirmedAgeDays: 30, unconfirmedAgeDays: 1 });
    for (const draft of [runtimeDraft, coreDraft]) {
      expect(photoEvidence(draft as never)).toEqual([]);
      expect(draft.body).not.toContain('conduit');
      expect(draft.body).not.toContain('drywall');
    }
  });

  it('the executive summary never carries the unconfirmed finding either', async () => {
    const { runtimeDraft, coreDraft } = await reportDrafts(
      { confirmedAgeDays: 3, unconfirmedAgeDays: 1 },
      'executive_summary',
    );
    for (const draft of [runtimeDraft, coreDraft]) {
      expect(draft.reportType).toBe('executive_summary');
      expect(draft.body).not.toContain('drywall');
    }
  });
});

describe('H1: review prompts show the comparison that is waiting for review', () => {
  it('when the newest comparison is confirmed and an older one is pending, every review prompt names the pending one', async () => {
    const { runtime } = await reportDrafts({ confirmedAgeDays: 1, unconfirmedAgeDays: 3 });
    expect(runtime.comparisonNeedsReview).toBe(true);
    // photoProgressSummary itself is unchanged: the newest comparison.
    expect(runtime.photoProgressSummary).toBe(CONFIRMED);

    const reviewRecommendation = runtime.recommendations.find(item => item.title === 'Review photo progress comparison');
    expect(reviewRecommendation?.summary).toBe(UNCONFIRMED);
    const reviewUnknown = runtime.unknowns.find(item => item.title === 'Photo Progress Needs Review');
    expect(reviewUnknown?.summary).toBe(UNCONFIRMED);
    const attention = buildPIEAttentionState({ runtime });
    const photoAttention = attention.items.find(item => item.id === 'attention-photo-progress');
    expect(photoAttention?.whyItMatters).toBe(UNCONFIRMED);
  });
});
