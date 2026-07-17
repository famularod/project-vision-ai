import type {
  DAVEDailyBriefDocument,
  DAVEDailyBriefScheduleItem,
  DAVEDailyBriefUpdate,
} from './DAVEDailyBrief';

export type DAVEProjectEvidenceStrength = 'High' | 'Medium' | 'Low';
export type DAVEProjectEvidenceSignalKey =
  | 'recent_photos'
  | 'recent_updates'
  | 'inspection_status'
  | 'schedule_freshness'
  | 'document_freshness'
  | 'analysis_health';

export type DAVEProjectEvidenceSignal = {
  id: string;
  key: DAVEProjectEvidenceSignalKey;
  label: string;
  value: string;
  quality: 'strong' | 'limited' | 'weak';
  score: 0 | 1 | 2;
  whyItMatters: string | null;
};

export type DAVEProjectEvidenceQuality = {
  projectId: string;
  generatedAt: string;
  strength: DAVEProjectEvidenceStrength;
  score: number;
  maximumScore: 12;
  signals: DAVEProjectEvidenceSignal[];
  limitation: string;
};

export type BuildProjectEvidenceQualityInput = {
  projectId: string;
  projectName: string;
  updates: DAVEDailyBriefUpdate[];
  documents: DAVEDailyBriefDocument[];
  scheduleItems: DAVEDailyBriefScheduleItem[];
  now?: string;
  recentAfterDays?: number;
  staleAfterDays?: number;
};

export type BuildProjectEvidenceQualityFromRealityInput = {
  reality: import('./DAVEProjectReality').DAVEProjectReality;
};

const DAY_MS = 24 * 60 * 60 * 1000;

export function buildProjectEvidenceQuality(
  input: BuildProjectEvidenceQualityInput | BuildProjectEvidenceQualityFromRealityInput,
): DAVEProjectEvidenceQuality {
  if ('reality' in input) return input.reality.evidenceSummary;
  const now = validDate(input.now) ?? new Date();
  const recentCutoff = now.getTime() - (input.recentAfterDays ?? 14) * DAY_MS;
  const staleCutoff = now.getTime() - (input.staleAfterDays ?? 30) * DAY_MS;
  const projectKey = normalizeKey(input.projectName);
  const updates = input.updates.filter(update => normalizeKey(update.projectName) === projectKey);
  const documents = input.documents.filter(document =>
    !document.isArchived && (!document.projectId || document.projectId === input.projectId),
  );
  const scheduleItems = input.scheduleItems.filter(item => normalizeKey(item.projectName) === projectKey);

  const recentUpdates = updates.filter(update => timestampMs(updateTimestamp(update)) >= recentCutoff);
  const recentPhotos = recentUpdates.flatMap(update =>
    update.photos.filter(photo => timestampMs(photo.locationCapturedAt || updateTimestamp(update)) >= recentCutoff),
  );
  const inspectionDocuments = documents.filter(document =>
    normalizeKey(document.category) === 'inspection' && document.status !== 'failed',
  );
  const latestInspectionAt = latestTimestamp(inspectionDocuments.map(documentTimestamp));
  const latestScheduleAt = latestTimestamp(scheduleItems.map(scheduleTimestamp));
  const latestDocumentAt = latestTimestamp(documents.filter(document => document.status !== 'failed').map(documentTimestamp));
  const analyzedPhotos = recentPhotos.filter(photo => photo.photoIntelligence);
  const failedAnalyses = analyzedPhotos.filter(photo => isAnalysisFailure(photo.photoIntelligence?.status));
  const completedAnalyses = analyzedPhotos.filter(photo => isCompletedAnalysis(photo.photoIntelligence?.status));

  const signals: DAVEProjectEvidenceSignal[] = [
    countSignal(
      input.projectId,
      'recent_photos',
      'Recent photos',
      recentPhotos.length,
      'Recent visual evidence helps the PM verify current conditions; its absence does not prove work did not occur.',
    ),
    countSignal(
      input.projectId,
      'recent_updates',
      'Recent updates',
      recentUpdates.length,
      'Recent project records provide context for current decisions; older records may not reflect current conditions.',
    ),
    freshnessSignal({
      projectId: input.projectId,
      key: 'inspection_status',
      label: 'Inspection status',
      timestamp: latestInspectionAt,
      recentCutoff,
      staleCutoff,
      missingValue: 'Not recorded',
      currentValue: 'Evidence recorded recently',
      limitedValue: 'Evidence recorded, but not recently',
      weakWhy: 'Without a recorded inspection artifact, inspection status cannot be established.',
      limitedWhy: 'Older inspection evidence may not represent the current inspection status.',
    }),
    freshnessSignal({
      projectId: input.projectId,
      key: 'schedule_freshness',
      label: 'Schedule freshness',
      timestamp: latestScheduleAt,
      recentCutoff,
      staleCutoff,
      missingValue: 'No schedule record',
      currentValue: 'Updated recently',
      limitedValue: 'Not recently updated',
      weakWhy: 'Without structured schedule evidence, time-sensitive guidance cannot be checked against a current schedule.',
      limitedWhy: 'An older schedule may no longer reflect current dates, dependencies, or owners.',
    }),
    freshnessSignal({
      projectId: input.projectId,
      key: 'document_freshness',
      label: 'Document freshness',
      timestamp: latestDocumentAt,
      recentCutoff,
      staleCutoff,
      missingValue: 'No current documents',
      currentValue: 'Added or updated recently',
      limitedValue: 'No recent document activity',
      weakWhy: 'Without project documents, there is less recorded context for verification and follow-up.',
      limitedWhy: 'Older documents may omit recent approvals, revisions, or field decisions.',
    }),
    analysisSignal(input.projectId, recentPhotos.length, analyzedPhotos.length, completedAnalyses.length, failedAnalyses.length),
  ];
  const score = signals.reduce((total, signal) => total + signal.score, 0);

  return {
    projectId: input.projectId,
    generatedAt: now.toISOString(),
    strength: score >= 10 ? 'High' : score >= 6 ? 'Medium' : 'Low',
    score,
    maximumScore: 12,
    signals,
    limitation: 'Evidence strength describes record coverage and freshness. It does not verify project progress or completion.',
  };
}

function countSignal(
  projectId: string,
  key: 'recent_photos' | 'recent_updates',
  label: string,
  count: number,
  whyItMatters: string,
): DAVEProjectEvidenceSignal {
  const score: 0 | 1 | 2 = count >= 2 ? 2 : count === 1 ? 1 : 0;
  return signal(projectId, key, label, `${count} in the last 14 days`, score, score === 2 ? null : whyItMatters);
}

function freshnessSignal(input: {
  projectId: string;
  key: 'inspection_status' | 'schedule_freshness' | 'document_freshness';
  label: string;
  timestamp: number;
  recentCutoff: number;
  staleCutoff: number;
  missingValue: string;
  currentValue: string;
  limitedValue: string;
  weakWhy: string;
  limitedWhy: string;
}): DAVEProjectEvidenceSignal {
  if (!input.timestamp) {
    return signal(input.projectId, input.key, input.label, input.missingValue, 0, input.weakWhy);
  }
  if (input.timestamp >= input.recentCutoff) {
    return signal(input.projectId, input.key, input.label, input.currentValue, 2, null);
  }
  const value = input.timestamp < input.staleCutoff ? 'Stale' : input.limitedValue;
  return signal(input.projectId, input.key, input.label, value, 1, input.limitedWhy);
}

function analysisSignal(
  projectId: string,
  recentPhotoCount: number,
  analyzedCount: number,
  completedCount: number,
  failedCount: number,
): DAVEProjectEvidenceSignal {
  if (recentPhotoCount === 0) {
    return signal(projectId, 'analysis_health', 'Analysis health', 'No recent photos to analyze', 0,
      'Without recent photos, visual analysis cannot contribute current observations.');
  }
  if (failedCount > 0) {
    return signal(projectId, 'analysis_health', 'Analysis health', `${failedCount} unavailable or failed`, 0,
      'Unavailable analysis leaves recent visual evidence without a reliable comparison result.');
  }
  if (completedCount === recentPhotoCount) {
    return signal(projectId, 'analysis_health', 'Analysis health', 'Healthy', 2, null);
  }
  return signal(projectId, 'analysis_health', 'Analysis health', `${analyzedCount} of ${recentPhotoCount} have results`, 1,
    'Some recent photos lack completed analysis, so visual evidence coverage is limited.');
}

function signal(
  projectId: string,
  key: DAVEProjectEvidenceSignalKey,
  label: string,
  value: string,
  score: 0 | 1 | 2,
  whyItMatters: string | null,
): DAVEProjectEvidenceSignal {
  return {
    id: ['evidence-quality', encodeURIComponent(projectId), key].join(':'),
    key,
    label,
    value,
    quality: score === 2 ? 'strong' : score === 1 ? 'limited' : 'weak',
    score,
    whyItMatters,
  };
}

function updateTimestamp(update: DAVEDailyBriefUpdate): string {
  return update.workflowTimestamps?.sendResolvedAt ||
    update.workflowTimestamps?.sendTappedAt ||
    update.workflowTimestamps?.firstPhotoAddedAt ||
    update.date;
}

function documentTimestamp(document: DAVEDailyBriefDocument): string {
  return document.updatedAt || document.importedAt || document.createdAt;
}

function scheduleTimestamp(item: DAVEDailyBriefScheduleItem): string {
  return item.importedAt || item.createdAt;
}

function latestTimestamp(values: string[]): number {
  return values.reduce((latest, value) => Math.max(latest, timestampMs(value)), 0);
}

function timestampMs(value: string | null | undefined): number {
  const parsed = value ? new Date(value).getTime() : 0;
  return Number.isFinite(parsed) ? parsed : 0;
}

function validDate(value: string | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function normalizeKey(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function isCompletedAnalysis(status: string | undefined): boolean {
  return status === 'analysis_complete' || status === 'completed_with_limitations' || status === 'no_suitable_prior_photo';
}

function isAnalysisFailure(status: string | undefined): boolean {
  return status === 'analysis_failed_retry' || status === 'comparison_unavailable';
}
