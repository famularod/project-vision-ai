import type {
  ProjectUpdate,
  UpdatePhoto,
} from '../types';
import type { ProjectConfidenceLevel } from './ProjectIntelligenceEngine';

export type PIEPhotoChangeLabel =
  | 'No visible change'
  | 'Minor progress'
  | 'Moderate progress'
  | 'Major progress'
  | 'Completed work'
  | 'Material added'
  | 'Material removed'
  | 'Equipment installed'
  | 'Equipment removed'
  | 'Housekeeping improved'
  | 'Housekeeping declined'
  | 'New safety concern'
  | 'Safety concern resolved'
  | 'Could not determine confidently';

export type PIEPhotoProgressVerificationStatus =
  | 'needs-review'
  | 'accepted'
  | 'edited'
  | 'rejected';

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
    verificationQuestion: 'Does this summary look correct?';
  };
  visualProgressEstimate: 'none' | 'minor' | 'moderate' | 'major' | 'complete' | 'unknown';
  needsReview: boolean;
  verificationStatus: PIEPhotoProgressVerificationStatus;
  userActions: ['Accept', 'Edit', 'Reject'];
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
    prompt: 'Does this summary look correct?';
    actions: ['Accept', 'Edit', 'Reject'];
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
  updateDate: string | null;
  sourceText: string;
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

function distanceFeet(
  lat1: number | null,
  lon1: number | null,
  lat2: number | null,
  lon2: number | null,
) {
  if (
    typeof lat1 !== 'number' ||
    typeof lon1 !== 'number' ||
    typeof lat2 !== 'number' ||
    typeof lon2 !== 'number'
  ) {
    return null;
  }

  const radians = Math.PI / 180;
  const earthFeet = 20902231;
  const dLat = (lat2 - lat1) * radians;
  const dLon = (lon2 - lon1) * radians;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * radians) *
      Math.cos(lat2 * radians) *
      Math.sin(dLon / 2) ** 2;

  return 2 * earthFeet * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
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
        const sourceText = [
          caption,
          photo.category,
          photo.actionRequired,
          photo.actionStatus,
          update.notes,
        ]
          .filter(Boolean)
          .join(' ');

        return {
          photoId: photo.id,
          updateId: update.id,
          uri: photo.uri,
          projectName: update.projectName,
          areaName,
          capturedAt,
          updateDate: update.date || null,
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
          sourceText,
        };
      }),
    )
    .sort((left, right) => {
      const leftDate = parseDate(left.capturedAt)?.getTime() || 0;
      const rightDate = parseDate(right.capturedAt)?.getTime() || 0;

      return leftDate - rightDate;
    });
}

function scorePreviousPhoto({
  current,
  previous,
  userSelected,
}: {
  current: PhotoCandidate;
  previous: PhotoCandidate;
  userSelected: boolean;
}) {
  const reasons: string[] = [];
  let score = userSelected ? 55 : 0;

  if (current.projectName && normalized(current.projectName) === normalized(previous.projectName)) {
    score += 20;
    reasons.push('Same project');
  }

  if (current.areaName && normalized(current.areaName) === normalized(previous.areaName)) {
    score += 25;
    reasons.push('Same area');
  }

  const distance = distanceFeet(
    current.gpsLatitude,
    current.gpsLongitude,
    previous.gpsLatitude,
    previous.gpsLongitude,
  );

  if (distance !== null && distance <= 100) {
    score += 25;
    reasons.push(`GPS proximity ${Math.round(distance)} ft`);
  } else if (distance !== null && distance <= 300) {
    score += 15;
    reasons.push(`Nearby GPS ${Math.round(distance)} ft`);
  }

  const gap = daysBetween(previous.capturedAt, current.capturedAt);

  if (gap !== null && gap > 0 && gap <= 90) {
    score += 20;
    reasons.push(`${gap} days between photos`);
  } else if (gap !== null && gap > 90) {
    score += 8;
    reasons.push(`${gap} days between photos`);
  }

  if (current.category === previous.category) {
    score += 8;
    reasons.push('Same photo category');
  }

  if (userSelected) reasons.push('User-selected comparison');

  return {
    score,
    reasons,
  };
}

function confidenceFromScore(score: number): ProjectConfidenceLevel {
  if (score >= 75) return 'high';
  if (score >= 45) return 'medium';
  return 'low';
}

function includesAny(text: string, words: string[]) {
  const lower = text.toLowerCase();

  return words.some(word => lower.includes(word));
}

function verificationStatus(text: string): PIEPhotoProgressVerificationStatus {
  const lower = text.toLowerCase();

  if (lower.includes('photo progress rejected')) return 'rejected';
  if (lower.includes('photo progress edited')) return 'edited';
  if (lower.includes('photo progress accepted') || lower.includes('accepted photo progress')) {
    return 'accepted';
  }

  return 'needs-review';
}

function changeLabels(
  previous: PhotoCandidate,
  current: PhotoCandidate,
  confidence: ProjectConfidenceLevel,
): PIEPhotoChangeLabel[] {
  const combined = `${previous.sourceText} ${current.sourceText}`;
  const currentText = current.sourceText;
  const previousText = previous.sourceText;
  const labels: PIEPhotoChangeLabel[] = [];

  if (confidence === 'low') return ['Could not determine confidently'];

  if (
    current.category === 'Safety Concern' &&
    current.actionStatus !== 'Closed' &&
    previous.category !== 'Safety Concern'
  ) {
    labels.push('New safety concern');
  }

  if (
    previous.category === 'Safety Concern' &&
    current.actionStatus === 'Closed'
  ) {
    labels.push('Safety concern resolved');
  }

  if (
    previous.actionStatus !== 'Closed' &&
    current.actionStatus === 'Closed'
  ) {
    labels.push('Completed work');
  }

  if (includesAny(currentText, ['installed', 'set in place', 'mounted'])) {
    labels.push('Equipment installed');
  }

  if (includesAny(currentText, ['removed', 'demo complete', 'demolished'])) {
    labels.push(
      includesAny(combined, ['equipment', 'unit', 'panel', 'pump', 'fan'])
        ? 'Equipment removed'
        : 'Material removed',
    );
  }

  if (includesAny(currentText, ['delivered', 'material', 'stockpiled', 'staged'])) {
    labels.push('Material added');
  }

  if (includesAny(currentText, ['clean', 'organized', 'swept'])) {
    labels.push('Housekeeping improved');
  }

  if (includesAny(currentText, ['debris', 'trash', 'clutter', 'housekeeping issue'])) {
    labels.push('Housekeeping declined');
  }

  if (
    includesAny(currentText, ['progress', 'continued', 'rough-in', 'framing']) ||
    current.actionStatus === 'In Progress'
  ) {
    labels.push('Moderate progress');
  }

  if (
    current.caption &&
    previous.caption &&
    normalized(current.caption) === normalized(previous.caption) &&
    current.category === previous.category
  ) {
    labels.push('No visible change');
  }

  if (labels.length === 0 && current.caption && current.caption !== previous.caption) {
    labels.push('Minor progress');
  }

  if (labels.length === 0) labels.push('Could not determine confidently');

  return Array.from(new Set(labels));
}

function visualEstimate(labels: PIEPhotoChangeLabel[]): PIEPhotoProgressComparison['visualProgressEstimate'] {
  if (labels.includes('Completed work')) return 'complete';
  if (labels.includes('Major progress') || labels.includes('Equipment installed')) return 'major';
  if (labels.includes('Moderate progress') || labels.includes('Material added')) return 'moderate';
  if (labels.includes('Minor progress')) return 'minor';
  if (labels.includes('No visible change')) return 'none';

  return 'unknown';
}

function summaryForLabels(labels: PIEPhotoChangeLabel[], confidence: ProjectConfidenceLevel) {
  if (confidence === 'low' || labels.includes('Could not determine confidently')) {
    return 'DAVE could not determine the photo change confidently from local metadata and captions. Review is required before this becomes project evidence.';
  }

  return `DAVE found ${labels.join(', ').toLowerCase()} based on local photo captions, categories, action status, area, GPS, and time evidence.`;
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
  const selectedMap = new Map(
    userSelectedComparisons.map(item => [item.currentPhotoId, item.previousPhotoId]),
  );
  const comparisons = photos.flatMap(current => {
    const currentTime = parseDate(current.capturedAt)?.getTime() || 0;
    const selectedPreviousId = selectedMap.get(current.photoId);
    const previousCandidates = photos.filter(previous => {
      if (previous.photoId === current.photoId) return false;
      if (selectedPreviousId) return previous.photoId === selectedPreviousId;

      const previousTime = parseDate(previous.capturedAt)?.getTime() || 0;

      return previousTime <= currentTime && previous.updateId !== current.updateId;
    });

    if (previousCandidates.length === 0) return [];

    const scored = previousCandidates
      .map(previous => ({
        previous,
        ...scorePreviousPhoto({
          current,
          previous,
          userSelected: previous.photoId === selectedPreviousId,
        }),
      }))
      .sort((left, right) => right.score - left.score);
    const best = scored[0];

    if (!best || best.score < 30) return [];

    const confidence = confidenceFromScore(best.score);
    const labels = changeLabels(best.previous, current, confidence);
    const estimate = visualEstimate(labels);
    const status = verificationStatus(current.sourceText);
    const summary = summaryForLabels(labels, confidence);
    const needsReview =
      confidence === 'low' ||
      labels.includes('Could not determine confidently') ||
      status === 'needs-review' ||
      status === 'edited';

    return [{
      id: `photo-progress:${best.previous.photoId}:${current.photoId}`,
      previousPhoto: photoRef(best.previous),
      currentPhoto: photoRef(current),
      daysBetween: daysBetween(best.previous.capturedAt, current.capturedAt),
      area: current.areaName || best.previous.areaName,
      project: current.projectName,
      confidence,
      confidenceScore: Math.min(100, Math.round(best.score)),
      matchReasons: best.reasons,
      changeLabels: labels,
      structuredSummary: {
        primaryChange: labels[0],
        summary,
        evidence: [
          ...best.reasons,
          best.previous.caption ? `Previous caption: ${best.previous.caption}` : null,
          current.caption ? `Current caption: ${current.caption}` : null,
          `Previous status: ${best.previous.actionStatus}`,
          `Current status: ${current.actionStatus}`,
        ].filter((item): item is string => Boolean(item)),
        limitations: [
          'No external AI or computer vision was used.',
          confidence === 'low'
            ? 'Low metadata/caption confidence means the change could not be determined confidently.'
            : null,
        ].filter((item): item is string => Boolean(item)),
        verificationQuestion: 'Does this summary look correct?' as const,
      },
      visualProgressEstimate: estimate,
      needsReview,
      verificationStatus: status,
      userActions: ['Accept', 'Edit', 'Reject'] as ['Accept', 'Edit', 'Reject'],
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
  const comparisonNeedsReview =
    !lastComparison ||
    sortedComparisons.some(comparison => comparison.needsReview);
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
      evidence: [
        ...acceptedEvidence.map(item => item.summary),
        lastComparison?.structuredSummary.summary,
      ].filter((item): item is string => Boolean(item)),
      recommendedActions: comparisonNeedsReview
        ? ['Ask the user: Does this summary look correct? Accept, edit, or reject before using it as project evidence.']
        : ['Use accepted photo progress as project evidence for review and updates.'],
    },
    executiveFeed: {
      summary: photoProgressSummary,
      progressSignals: sortedComparisons
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
      prompt: 'Does this summary look correct?',
      actions: ['Accept', 'Edit', 'Reject'],
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
