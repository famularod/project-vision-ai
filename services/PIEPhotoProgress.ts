import type {
  ProjectUpdate,
  UpdatePhoto,
} from '../types';
import type { ProjectConfidenceLevel } from './ProjectIntelligenceEngine';
import {
  photoDisplayResultCanBeReviewed,
} from './PhotoAssessment';

export type PIEPhotoChangeLabel =
  | 'Visible change'
  | 'Visible concern'
  | 'No visible change'
  | 'Material added'
  | 'Material removed'
  | 'Could not determine confidently';

export type PIEPhotoProgressVerificationStatus =
  | 'needs-review'
  | 'accepted'
  | 'edited'
  | 'rejected'
  | 'not-useful';

export type PIEPhotoProgressPhotoRef = {
  photoId: string;
  updateId: string;
  uri: string;
  projectName: string;
  areaName: string | null;
  capturedAt: string | null;
  caption: string | null;
  category: UpdatePhoto['category'];
  actionStatus: UpdatePhoto['actionStatus'];
  gpsLatitude: number | null;
  gpsLongitude: number | null;
};

export type PIEPhotoProgressComparison = {
  id: string;
  previousPhoto: PIEPhotoProgressPhotoRef;
  currentPhoto: PIEPhotoProgressPhotoRef;
  daysBetween: number | null;
  area: string | null;
  project: string;
  confidence: ProjectConfidenceLevel;
  confidenceScore: number;
  matchReasons: string[];
  changeLabels: PIEPhotoChangeLabel[];
  structuredSummary: {
    primaryChange: PIEPhotoChangeLabel;
    summary: string;
    evidence: string[];
    limitations: string[];
    verificationQuestion: 'Is this visible finding correct?';
  };
  visualProgressEstimate: 'none' | 'minor' | 'moderate' | 'major' | 'complete' | 'unknown';
  needsReview: boolean;
  verificationStatus: PIEPhotoProgressVerificationStatus;
  userActions: ['Confirm', 'Incorrect', 'Not useful'];
};

export type PIEPhotoProgressEvidence = {
  id: string;
  projectName: string;
  areaName: string | null;
  summary: string;
  confidence: ProjectConfidenceLevel;
  previousPhotoId: string;
  currentPhotoId: string;
  acceptedAt: string | null;
};

export type PIEPhotoProgressResult = {
  generatedAt: string;
  projectName: string;
  comparisons: PIEPhotoProgressComparison[];
  lastComparison: PIEPhotoProgressComparison | null;
  photoProgressSummary: string;
  comparisonConfidence: ProjectConfidenceLevel;
  visualProgressEstimate: PIEPhotoProgressComparison['visualProgressEstimate'];
  comparisonNeedsReview: boolean;
  acceptedEvidence: PIEPhotoProgressEvidence[];
  missionFeed: {
    evidence: string[];
    recommendedActions: string[];
  };
  executiveFeed: {
    summary: string;
    progressSignals: string[];
    reviewRequired: boolean;
  };
  evidenceFusionFeed: {
    acceptedEvidence: PIEPhotoProgressEvidence[];
    unverifiedComparisons: string[];
  };
  knowledgeGraphFeed: {
    nodes: Array<{
      id: string;
      type: 'photo' | 'photo_comparison' | 'area' | 'progress_evidence';
      label: string;
    }>;
    relationships: Array<{
      from: string;
      to: string;
      type: 'compares_to' | 'located_in' | 'supports' | 'needs_review';
    }>;
  };
  reviewFeed: {
    prompt: 'Is this visible finding correct?';
    actions: ['Confirm', 'Incorrect', 'Not useful'];
    pendingCount: number;
  };
  combinedUpdateFeed: {
    acceptedSummaries: string[];
    pendingSummaries: string[];
  };
};

export type BuildPhotoProgressParams = {
  projectName?: string | null;
  updates?: ProjectUpdate[];
  currentUpdate?: ProjectUpdate | null;
  userSelectedComparisons?: Array<{
    currentPhotoId: string;
    previousPhotoId: string;
  }>;
  now?: Date;
};

type PhotoCandidate = PIEPhotoProgressPhotoRef & {
  photoIntelligence: UpdatePhoto['photoIntelligence'];
};

function trimOrNull(value: string | null | undefined) {
  const trimmed = value?.trim() || '';

  return trimmed ? trimmed : null;
}

function normalized(value: string | null | undefined) {
  return (value || '').trim().toLowerCase();
}

function projectMatches(projectName: string | null | undefined, photoProject: string) {
  const expected = normalized(projectName);

  return !expected || normalized(photoProject) === expected;
}

function parseDate(value: string | null | undefined) {
  if (!value) return null;

  const parsed = new Date(value);

  if (!Number.isNaN(parsed.getTime())) return parsed;

  const dateOnly = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);

  if (!dateOnly) return null;

  const date = new Date(
    Number(dateOnly[1]),
    Number(dateOnly[2]) - 1,
    Number(dateOnly[3]),
  );

  return Number.isNaN(date.getTime()) ? null : date;
}

function daysBetween(left: string | null, right: string | null) {
  const leftDate = parseDate(left);
  const rightDate = parseDate(right);

  if (!leftDate || !rightDate) return null;

  return Math.round((rightDate.getTime() - leftDate.getTime()) / 86400000);
}

function photoDate(update: ProjectUpdate, photo: UpdatePhoto) {
  return photo.locationCapturedAt || update.locationCapturedAt || update.date || null;
}

function flattenPhotos(updates: ProjectUpdate[], projectName?: string | null) {
  return updates
    .filter(update => projectMatches(projectName, update.projectName))
    .flatMap(update =>
      update.photos.map((photo): PhotoCandidate => {
        const areaName =
          trimOrNull(photo.selectedAreaName) ||
          trimOrNull(update.selectedAreaName);
        const capturedAt = photoDate(update, photo);
        const caption = trimOrNull(photo.caption);
        return {
          photoId: photo.id,
          updateId: update.id,
          uri: photo.uri,
          projectName: update.projectName,
          areaName,
          capturedAt,
          caption,
          category: photo.category,
          actionStatus: photo.actionStatus,
          gpsLatitude:
            typeof photo.gpsLatitude === 'number'
              ? photo.gpsLatitude
              : typeof update.gpsLatitude === 'number'
                ? update.gpsLatitude
                : null,
          gpsLongitude:
            typeof photo.gpsLongitude === 'number'
              ? photo.gpsLongitude
              : typeof update.gpsLongitude === 'number'
                ? update.gpsLongitude
                : null,
          photoIntelligence: photo.photoIntelligence ?? null,
        };
      }),
    )
    .sort((left, right) => {
      const leftDate = parseDate(left.capturedAt)?.getTime() || 0;
      const rightDate = parseDate(right.capturedAt)?.getTime() || 0;

      return leftDate - rightDate;
    });
}

function confidenceFromResult(value: string | null): ProjectConfidenceLevel {
  if (value === 'high' || value === 'medium' || value === 'low') return value;
  return 'low';
}

function verificationStatus(
  review: NonNullable<UpdatePhoto['photoIntelligence']>['userReview'],
): PIEPhotoProgressVerificationStatus {
  if (review === 'confirmed') return 'accepted';
  if (review === 'incorrect') return 'rejected';
  if (review === 'not_useful') return 'not-useful';
  return 'needs-review';
}

function changeLabels(current: PhotoCandidate): PIEPhotoChangeLabel[] {
  const result = current.photoIntelligence;
  const labels: PIEPhotoChangeLabel[] = [];
  for (const finding of result?.findings ?? []) {
    if (finding.findingType === 'added') labels.push('Material added');
    else if (finding.findingType === 'removed') labels.push('Material removed');
    else if (finding.findingType === 'visible_concern') labels.push('Visible concern');
    else if (finding.findingType !== 'uncertain') labels.push('Visible change');
  }
  if (labels.length === 0 && result?.visibleChange) labels.push('Visible change');
  if (labels.length === 0) labels.push('Could not determine confidently');

  return Array.from(new Set(labels));
}

function visualEstimate(labels: PIEPhotoChangeLabel[]): PIEPhotoProgressComparison['visualProgressEstimate'] {
  if (labels.includes('No visible change')) return 'none';
  return 'unknown';
}

function photoRef(candidate: PhotoCandidate): PIEPhotoProgressPhotoRef {
  return {
    photoId: candidate.photoId,
    updateId: candidate.updateId,
    uri: candidate.uri,
    projectName: candidate.projectName,
    areaName: candidate.areaName,
    capturedAt: candidate.capturedAt,
    caption: candidate.caption,
    category: candidate.category,
    actionStatus: candidate.actionStatus,
    gpsLatitude: candidate.gpsLatitude,
    gpsLongitude: candidate.gpsLongitude,
  };
}

export function buildPhotoProgress({
  projectName,
  updates = [],
  currentUpdate = null,
  userSelectedComparisons = [],
  now = new Date(),
}: BuildPhotoProgressParams = {}): PIEPhotoProgressResult {
  const allUpdates = currentUpdate ? [...updates, currentUpdate] : updates;
  const photos = flattenPhotos(allUpdates, projectName);
  const comparisons = photos.flatMap(current => {
    const result = current.photoIntelligence;
    if (!photoDisplayResultCanBeReviewed(result)) return [];
    const selectedPreviousId = result?.diagnostics?.selectedPriorPhotoId || null;
    const userSelectedPreviousId = userSelectedComparisons.find(
      item => item.currentPhotoId === current.photoId,
    )?.previousPhotoId;
    const previous = photos.find(candidate =>
      candidate.photoId === (selectedPreviousId || userSelectedPreviousId) &&
      candidate.photoId !== current.photoId,
    );
    if (!previous || !result) return [];

    const confidence = confidenceFromResult(result.comparisonConfidence);
    const labels = changeLabels(current);
    const estimate = visualEstimate(labels);
    const status = verificationStatus(result.userReview);
    const summary = result.summary.trim() || result.visibleChange || 'A visible photo change is ready for review.';
    const needsReview = status === 'needs-review';
    const matchReasons = [
      'Provider-selected prior photo',
      `Comparability: ${result.comparability}`,
      `Visual confidence: ${result.comparisonConfidence}`,
    ];

    return [{
      id: `photo-progress:${previous.photoId}:${current.photoId}`,
      previousPhoto: photoRef(previous),
      currentPhoto: photoRef(current),
      daysBetween: daysBetween(previous.capturedAt, current.capturedAt),
      area: current.areaName || previous.areaName,
      project: current.projectName,
      confidence,
      confidenceScore: confidence === 'high' ? 90 : confidence === 'medium' ? 65 : 35,
      matchReasons,
      changeLabels: labels,
      structuredSummary: {
        primaryChange: labels[0],
        summary,
        evidence: [
          ...matchReasons,
          ...(result.findings ?? []).map(finding => finding.description),
        ].filter((item): item is string => Boolean(item)),
        limitations: result.captureLimitations,
        verificationQuestion: 'Is this visible finding correct?' as const,
      },
      visualProgressEstimate: estimate,
      needsReview,
      verificationStatus: status,
      userActions: ['Confirm', 'Incorrect', 'Not useful'] as ['Confirm', 'Incorrect', 'Not useful'],
    }];
  });
  const sortedComparisons = comparisons.sort((left, right) => {
    const leftTime = parseDate(left.currentPhoto.capturedAt)?.getTime() || 0;
    const rightTime = parseDate(right.currentPhoto.capturedAt)?.getTime() || 0;

    return rightTime - leftTime;
  });
  const lastComparison = sortedComparisons[0] || null;
  const acceptedComparisons = sortedComparisons.filter(
    comparison => comparison.verificationStatus === 'accepted',
  );
  const acceptedEvidence = acceptedComparisons.map(comparison => ({
    id: `accepted-${comparison.id}`,
    projectName: comparison.project,
    areaName: comparison.area,
    summary: comparison.structuredSummary.summary,
    confidence: comparison.confidence,
    previousPhotoId: comparison.previousPhoto.photoId,
    currentPhotoId: comparison.currentPhoto.photoId,
    acceptedAt: comparison.currentPhoto.capturedAt || now.toISOString(),
  }));
  const comparisonConfidence =
    lastComparison?.confidence ||
    (photos.length > 1 ? 'low' : 'medium');
  const photoProgressSummary =
    lastComparison?.structuredSummary.summary ||
    'No comparable previous project photo was found yet.';
  const comparisonNeedsReview = sortedComparisons.some(comparison => comparison.needsReview);
  const pendingSummaries = sortedComparisons
    .filter(comparison => comparison.verificationStatus !== 'accepted')
    .slice(0, 5)
    .map(comparison => comparison.structuredSummary.summary);

  return {
    generatedAt: now.toISOString(),
    projectName: projectName || lastComparison?.project || 'Current Project',
    comparisons: sortedComparisons,
    lastComparison,
    photoProgressSummary,
    comparisonConfidence,
    visualProgressEstimate: lastComparison?.visualProgressEstimate || 'unknown',
    comparisonNeedsReview,
    acceptedEvidence,
    missionFeed: {
      evidence: acceptedEvidence.map(item => item.summary),
      recommendedActions: comparisonNeedsReview
        ? ['Ask the user to confirm the visible finding, mark it incorrect, or mark it not useful before using it as project evidence.']
        : ['Use accepted photo progress as project evidence for review and updates.'],
    },
    executiveFeed: {
      summary: photoProgressSummary,
      progressSignals: sortedComparisons
        .filter(comparison => comparison.verificationStatus === 'accepted')
        .slice(0, 5)
        .map(comparison => `${comparison.project}: ${comparison.changeLabels.join(', ')}`),
      reviewRequired: comparisonNeedsReview,
    },
    evidenceFusionFeed: {
      acceptedEvidence,
      unverifiedComparisons: pendingSummaries,
    },
    knowledgeGraphFeed: {
      nodes: sortedComparisons.flatMap(comparison => [
        {
          id: comparison.previousPhoto.photoId,
          type: 'photo' as const,
          label: 'Previous photo',
        },
        {
          id: comparison.currentPhoto.photoId,
          type: 'photo' as const,
          label: 'Current photo',
        },
        {
          id: comparison.id,
          type: 'photo_comparison' as const,
          label: comparison.structuredSummary.primaryChange,
        },
        ...(comparison.area
          ? [{
              id: `area:${normalized(comparison.area)}`,
              type: 'area' as const,
              label: comparison.area,
            }]
          : []),
      ]),
      relationships: sortedComparisons.flatMap(comparison => [
        {
          from: comparison.currentPhoto.photoId,
          to: comparison.previousPhoto.photoId,
          type: 'compares_to' as const,
        },
        {
          from: comparison.id,
          to: comparison.currentPhoto.photoId,
          type: comparison.verificationStatus === 'accepted'
            ? 'supports' as const
            : 'needs_review' as const,
        },
        ...(comparison.area
          ? [{
              from: comparison.id,
              to: `area:${normalized(comparison.area)}`,
              type: 'located_in' as const,
            }]
          : []),
      ]),
    },
    reviewFeed: {
      prompt: 'Is this visible finding correct?',
      actions: ['Confirm', 'Incorrect', 'Not useful'],
      pendingCount: sortedComparisons.filter(
        comparison => comparison.verificationStatus !== 'accepted',
      ).length,
    },
    combinedUpdateFeed: {
      acceptedSummaries: acceptedEvidence.map(item => item.summary),
      pendingSummaries,
    },
  };
}
