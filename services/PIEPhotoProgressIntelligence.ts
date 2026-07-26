import type {
  ProjectUpdate,
  ReferenceDocument,
  ScheduleItem,
  UpdatePhoto,
} from '../types';
import type { ProjectConfidenceLevel } from './ProjectIntelligenceEngine';
import type {
  PIEQualifiedRealityEvidence,
} from './PIERealityModelSynchronization';
import type {
  PIERealityModel,
  PIERealityObject,
} from './PIERealityModel';
import { scheduleProgressIsComplete } from './ScheduleProgressInvariant';

export type PIEPhotoComparability =
  | 'strong_match'
  | 'probable_match'
  | 'weak_match'
  | 'not_comparable';

export type PIEPhotoProgressDirection =
  | 'progressed'
  | 'partially_progressed'
  | 'unchanged'
  | 'regressed'
  | 'uncertain'
  | 'not_comparable';

export type PIEPhotoProgressCategory =
  | 'new_installation'
  | 'removed_material_or_equipment'
  | 'demolition'
  | 'completed_construction'
  | 'partial_construction'
  | 'finish_completion'
  | 'repaired_damage'
  | 'unresolved_damage'
  | 'housekeeping_improvement'
  | 'housekeeping_deterioration'
  | 'cleared_obstruction'
  | 'new_obstruction'
  | 'safety_control_added'
  | 'safety_control_removed'
  | 'signage_added_or_missing'
  | 'visible_damage_or_deterioration'
  | 'work_started_not_completed'
  | 'temporary_condition_remaining'
  | 'no_meaningful_change'
  | 'not_comparable';

export type PIEVisualJARVISOutcome =
  | 'supported'
  | 'supported_with_limitations'
  | 'needs_another_photograph'
  | 'needs_corroborating_evidence'
  | 'human_review_required'
  | 'blocked';

export type PIEPhotoNormalizationOperation =
  | 'orientation_normalized'
  | 'crop_suggested'
  | 'scale_estimated'
  | 'perspective_estimated'
  | 'camera_alignment_estimated'
  | 'brightness_normalized'
  | 'contrast_normalized'
  | 'rotation_estimated';

export type PIEPhotoIntelligencePhoto = {
  photoId: string;
  updateId: string;
  uri: string;
  organizationId: string;
  projectId: string;
  projectName: string;
  buildingName: string | null;
  areaName: string | null;
  roomName: string | null;
  realityObjectId: string | null;
  equipmentOrAssetName: string | null;
  subject: string;
  capturedAt: string | null;
  timestampReliable: boolean;
  caption: string | null;
  notes: string | null;
  category: UpdatePhoto['category'];
  actionStatus: UpdatePhoto['actionStatus'];
  actionOwner: string | null;
  actionRequired: string | null;
  gpsLatitude: number | null;
  gpsLongitude: number | null;
  gpsAccuracy: number | null;
  cameraDirection: string | null;
  viewpointKey: string;
  metadataReliability: ProjectConfidenceLevel;
  imageQuality: {
    lighting: ProjectConfidenceLevel;
    resolution: ProjectConfidenceLevel;
    obstruction: ProjectConfidenceLevel;
    orientation: ProjectConfidenceLevel;
  };
  sourceSignature: string;
  duplicateKey: string;
};

export type PIEPhotoSequence = {
  id: string;
  organizationId: string;
  projectId: string;
  projectName: string;
  buildingName: string | null;
  areaName: string | null;
  roomName: string | null;
  realityObjectId: string | null;
  equipmentOrAssetName: string | null;
  subject: string;
  approximateViewpoint: string;
  photoIds: string[];
  firstCaptureDate: string | null;
  lastCaptureDate: string | null;
  identityConfidence: ProjectConfidenceLevel;
  stableKey: string;
};

export type PIEPhotoComparabilityAssessment = {
  earlierPhotoId: string;
  laterPhotoId: string;
  classification: PIEPhotoComparability;
  score: number;
  reasons: string[];
  limitations: string[];
  normalizationOperations: PIEPhotoNormalizationOperation[];
  duplicateDetected: boolean;
};

export type PIEPhotoProgressEvent = {
  id: string;
  organizationId: string;
  projectId: string;
  photoSequenceId: string;
  affectedRealityObjectIds: string[];
  earlierPhotoId: string;
  laterPhotoId: string;
  earlierCaptureDate: string | null;
  laterCaptureDate: string | null;
  observation: string;
  inferredMeaning: string;
  progressCategory: PIEPhotoProgressCategory;
  progressDirection: PIEPhotoProgressDirection;
  confidence: ProjectConfidenceLevel;
  comparabilityScore: number;
  imageRegions: string[];
  limitations: string[];
  corroboratingEvidenceIds: string[];
  contradictingEvidenceIds: string[];
  scheduleOrActionItemLinks: string[];
  verificationStatus: 'unverified' | 'supported' | 'needs_review' | 'human_confirmed' | 'rejected';
  reviewStatus: PIEVisualJARVISOutcome;
  createdAt: string;
};

export type PIEPhotoProgressEstimate = {
  state: 'progress_visible' | 'partial_progress_visible' | 'unchanged' | 'regression_possible' | 'insufficient_scope' | 'not_comparable';
  estimatedProgress: number | null;
  confidenceRange: [number, number] | null;
  scopeIncluded: string[];
  scopeExcluded: string[];
  assumptions: string[];
  evidenceGaps: string[];
  summary: string;
};

export type PIEPhotoProgressConflict = {
  id: string;
  organizationId: string;
  projectId: string;
  eventId: string;
  conflictType:
    | 'reported_complete_but_visibly_incomplete'
    | 'schedule_no_progress_but_visual_progress'
    | 'issue_closed_but_condition_visible'
    | 'temporary_condition_persisting'
    | 'visual_regression_candidate';
  summary: string;
  evidenceIds: string[];
  reviewRequired: boolean;
};

export type PIERepeatPhotoGuidance = {
  needed: boolean;
  projectId: string;
  projectName: string;
  areaName: string | null;
  realityObjectId: string | null;
  referencePhotoId: string | null;
  referencePhotoUri: string | null;
  instruction: string;
  reason: string;
  alignmentGuide: string;
  priority: 'low' | 'medium' | 'high';
};

export type PIEPhotoIntelligenceCacheEntry = {
  comparisonInputSignature: string;
  sequenceId: string;
  earlierPhotoId: string;
  laterPhotoId: string;
  realityModelVersion: number | null;
  analysisVersion: string;
};

export type PIEPhotoProgressIntelligenceResult = {
  analysisVersion: string;
  generatedAt: string;
  organizationId: string;
  projectId: string;
  sequences: PIEPhotoSequence[];
  comparabilityAssessments: PIEPhotoComparabilityAssessment[];
  progressEvents: PIEPhotoProgressEvent[];
  progressEstimate: PIEPhotoProgressEstimate;
  conflicts: PIEPhotoProgressConflict[];
  stalledProgressEvents: PIEPhotoProgressEvent[];
  regressionCandidates: PIEPhotoProgressEvent[];
  repeatPhotoGuidance: PIERepeatPhotoGuidance[];
  visualJarvisValidation: {
    outcome: PIEVisualJARVISOutcome;
    checks: Array<{
      id: string;
      status: PIEVisualJARVISOutcome;
      summary: string;
    }>;
  };
  qualifiedRealityEvidence: PIEQualifiedRealityEvidence[];
  cacheEntries: PIEPhotoIntelligenceCacheEntry[];
  reanalysisReasons: string[];
  conciseProgressCard: {
    visible: boolean;
    title: string;
    summary: string;
    primaryAction: 'View Progress' | 'Capture Repeat Photo' | 'Review Evidence';
  };
};

export type PIEPhotoProgressIntelligenceInput = {
  organizationId?: string | null;
  projectId?: string | null;
  projectName?: string | null;
  updates?: ProjectUpdate[];
  currentUpdate?: ProjectUpdate | null;
  realityModel?: PIERealityModel | null;
  scheduleItems?: ScheduleItem[];
  actionItems?: Array<{
    id: string;
    projectName?: string | null;
    areaName?: string | null;
    title?: string | null;
    status?: string | null;
    owner?: string | null;
  }>;
  issues?: Array<{
    id: string;
    projectName?: string | null;
    areaName?: string | null;
    status?: string | null;
    summary?: string | null;
  }>;
  risks?: Array<{
    id: string;
    projectName?: string | null;
    areaName?: string | null;
    summary?: string | null;
  }>;
  documents?: ReferenceDocument[];
  priorAnalyses?: PIEPhotoProgressIntelligenceResult[];
  now?: Date;
};

const ANALYSIS_VERSION = 'pie-photo-progress-intelligence-v1';

function normalized(value: string | null | undefined) {
  return (value || '').trim().toLowerCase();
}

function slug(value: string | null | undefined) {
  const safe = normalized(value).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return safe || 'unknown';
}

function trimOrNull(value: string | null | undefined) {
  const trimmed = value?.trim() || '';
  return trimmed ? trimmed : null;
}

function parseDate(value: string | null | undefined) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function dateValue(value: string | null | undefined) {
  return parseDate(value)?.getTime() || 0;
}

function daysBetween(left: string | null, right: string | null) {
  const leftDate = parseDate(left);
  const rightDate = parseDate(right);
  if (!leftDate || !rightDate) return null;
  return Math.round((rightDate.getTime() - leftDate.getTime()) / 86400000);
}

function includesAny(text: string, words: string[]) {
  const lower = text.toLowerCase();
  return words.some(word => lower.includes(word));
}

function confidenceFromScore(score: number): ProjectConfidenceLevel {
  if (score >= 75) return 'high';
  if (score >= 45) return 'medium';
  return 'low';
}

function projectMatches(expected: string | null | undefined, actual: string) {
  const expectedProject = normalized(expected);
  return !expectedProject || expectedProject === normalized(actual);
}

function sourceText(photo: UpdatePhoto, update: ProjectUpdate) {
  return [
    photo.caption,
    photo.category,
    photo.actionRequired,
    photo.actionOwner,
    photo.actionStatus,
    update.notes,
    photo.selectedAreaName,
    update.selectedAreaName,
  ].filter(Boolean).join(' ');
}

function inferSubject(photo: UpdatePhoto, update: ProjectUpdate) {
  const text = sourceText(photo, update);
  const candidates = [
    'guardrail',
    'toe board',
    'platform',
    'conduit',
    'pipe',
    'sprinkler',
    'rack',
    'barrier',
    'signage',
    'panel',
    'fire wall',
    'doorway',
    'electrical',
    'rough-in',
    'damage',
    'leak',
    'crack',
    'corrosion',
    'housekeeping',
    'debris',
  ];
  const match = candidates.find(candidate => normalized(text).includes(candidate));
  return match || trimOrNull(photo.caption)?.slice(0, 48) || trimOrNull(photo.selectedAreaName) || trimOrNull(update.selectedAreaName) || 'project area';
}

function inferBuilding(areaName: string | null, projectName: string) {
  const combined = `${areaName || ''} ${projectName}`;
  const match = combined.match(/\b(\d{4})\b/);
  return match ? `${match[1]} Location` : null;
}

function photoCapturedAt(update: ProjectUpdate, photo: UpdatePhoto) {
  return photo.locationCapturedAt || update.locationCapturedAt || update.date || null;
}

function photoSignature(photo: UpdatePhoto, update: ProjectUpdate) {
  return [
    photo.id,
    photo.uri,
    photo.fileName,
    photo.mimeType,
    photo.caption,
    update.projectName,
    photoCapturedAt(update, photo),
  ].filter(Boolean).join('|');
}

function duplicateKey(photo: UpdatePhoto, update: ProjectUpdate) {
  return [
    update.projectName,
    photo.selectedAreaName || update.selectedAreaName,
    photoCapturedAt(update, photo),
    normalized(photo.caption),
  ].filter(Boolean).join('|');
}

function inferViewpoint(photo: UpdatePhoto, update: ProjectUpdate, subject: string, areaName: string | null) {
  const gps =
    typeof photo.gpsLatitude === 'number' && typeof photo.gpsLongitude === 'number'
      ? `${photo.gpsLatitude.toFixed(4)},${photo.gpsLongitude.toFixed(4)}`
      : typeof update.gpsLatitude === 'number' && typeof update.gpsLongitude === 'number'
        ? `${update.gpsLatitude.toFixed(4)},${update.gpsLongitude.toFixed(4)}`
        : 'no-gps';
  return `${slug(update.projectName)}:${slug(areaName)}:${slug(subject)}:${gps}`;
}

function metadataReliability(photo: UpdatePhoto, update: ProjectUpdate): ProjectConfidenceLevel {
  let score = 0;
  if (photoCapturedAt(update, photo)) score += 25;
  if (photo.selectedAreaName || update.selectedAreaName) score += 25;
  if (typeof photo.gpsLatitude === 'number' || typeof update.gpsLatitude === 'number') score += 20;
  if (photo.caption?.trim()) score += 20;
  if (photo.fileName || photo.mimeType) score += 10;
  return confidenceFromScore(score);
}

function imageQualityFromText(text: string) {
  const obstructed = includesAny(text, ['blocked', 'obstructed', 'covered', 'stored material', 'behind material']);
  const dark = includesAny(text, ['dark', 'low light', 'shadow', 'glare']);
  const blurry = includesAny(text, ['blurry', 'unclear', 'far away', 'too far']);
  return {
    lighting: dark ? 'low' as ProjectConfidenceLevel : 'medium' as ProjectConfidenceLevel,
    resolution: blurry ? 'low' as ProjectConfidenceLevel : 'medium' as ProjectConfidenceLevel,
    obstruction: obstructed ? 'low' as ProjectConfidenceLevel : 'medium' as ProjectConfidenceLevel,
    orientation: 'medium' as ProjectConfidenceLevel,
  };
}

function flattenPhotos(input: PIEPhotoProgressIntelligenceInput): PIEPhotoIntelligencePhoto[] {
  const organizationId = input.organizationId || input.realityModel?.organizationId || 'local-organization';
  const projectId = input.projectId || input.realityModel?.projectId || slug(input.projectName) || 'local-project';
  const allUpdates = input.currentUpdate
    ? [...(input.updates || []), input.currentUpdate]
    : input.updates || [];

  return allUpdates
    .filter(update => projectMatches(input.projectName, update.projectName))
    .flatMap(update =>
      update.photos.map(photo => {
        const areaName = trimOrNull(photo.selectedAreaName) || trimOrNull(update.selectedAreaName);
        const subject = inferSubject(photo, update);
        const text = sourceText(photo, update);
        const capturedAt = photoCapturedAt(update, photo);
        const realityObject = matchRealityObject(input.realityModel, {
          projectName: update.projectName,
          areaName,
          subject,
        });

        return {
          photoId: photo.id,
          updateId: update.id,
          uri: photo.uri,
          organizationId,
          projectId,
          projectName: update.projectName,
          buildingName: inferBuilding(areaName, update.projectName),
          areaName,
          roomName: null,
          realityObjectId: realityObject?.stableObjectId || null,
          equipmentOrAssetName: realityObject?.type === 'equipment' || realityObject?.type === 'asset'
            ? realityObject.name
            : null,
          subject,
          capturedAt,
          timestampReliable: Boolean(capturedAt),
          caption: trimOrNull(photo.caption),
          notes: trimOrNull(update.notes),
          category: photo.category,
          actionStatus: photo.actionStatus,
          actionOwner: trimOrNull(photo.actionOwner),
          actionRequired: trimOrNull(photo.actionRequired),
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
          gpsAccuracy:
            typeof photo.gpsAccuracy === 'number'
              ? photo.gpsAccuracy
              : typeof update.gpsAccuracy === 'number'
                ? update.gpsAccuracy
                : null,
          cameraDirection: inferCameraDirection(text),
          viewpointKey: inferViewpoint(photo, update, subject, areaName),
          metadataReliability: metadataReliability(photo, update),
          imageQuality: imageQualityFromText(text),
          sourceSignature: stableHash(photoSignature(photo, update)),
          duplicateKey: stableHash(duplicateKey(photo, update)),
        };
      }),
    )
    .sort((left, right) => dateValue(left.capturedAt) - dateValue(right.capturedAt));
}

function inferCameraDirection(text: string) {
  const lower = normalized(text);
  const directions = ['north', 'south', 'east', 'west'];
  const match = directions.find(direction => lower.includes(`facing ${direction}`) || lower.includes(`toward ${direction}`));
  return match || null;
}

function matchRealityObject(
  model: PIERealityModel | null | undefined,
  photo: { projectName: string; areaName: string | null; subject: string },
): PIERealityObject | null {
  if (!model) return null;
  const subject = normalized(photo.subject);
  const area = normalized(photo.areaName);
  return model.objects.find(object => {
    const objectName = normalized(object.name);
    const objectArea = normalized(object.areaName || object.location);
    return (
      (subject && (objectName.includes(subject) || subject.includes(objectName))) ||
      (area && objectArea === area)
    );
  }) || null;
}

function stableHash(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
  }
  return Math.abs(hash).toString(36);
}

export function buildPhotoSequences(
  photos: PIEPhotoIntelligencePhoto[],
): PIEPhotoSequence[] {
  const groups = new Map<string, PIEPhotoIntelligencePhoto[]>();
  photos.forEach(photo => {
    const key = [
      photo.organizationId,
      photo.projectId,
      slug(photo.buildingName),
      slug(photo.areaName),
      slug(photo.realityObjectId || photo.subject),
      slug(photo.viewpointKey),
    ].join(':');
    groups.set(key, [...(groups.get(key) || []), photo]);
  });

  return Array.from(groups.entries()).map(([stableKey, group]) => {
    const sorted = group.sort((left, right) => dateValue(left.capturedAt) - dateValue(right.capturedAt));
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    return {
      id: `photo-sequence-${stableHash(stableKey)}`,
      organizationId: first.organizationId,
      projectId: first.projectId,
      projectName: first.projectName,
      buildingName: first.buildingName,
      areaName: first.areaName,
      roomName: first.roomName,
      realityObjectId: first.realityObjectId,
      equipmentOrAssetName: first.equipmentOrAssetName,
      subject: first.subject,
      approximateViewpoint: first.viewpointKey,
      photoIds: sorted.map(photo => photo.photoId),
      firstCaptureDate: first.capturedAt,
      lastCaptureDate: last.capturedAt,
      identityConfidence: sorted.some(photo => photo.realityObjectId) ? 'high' : first.areaName ? 'medium' : 'low',
      stableKey,
    };
  });
}

export function assessPhotoComparability(
  earlier: PIEPhotoIntelligencePhoto,
  later: PIEPhotoIntelligencePhoto,
): PIEPhotoComparabilityAssessment {
  const reasons: string[] = [];
  const limitations: string[] = [];
  let score = 0;

  if (earlier.organizationId === later.organizationId) {
    score += 20;
    reasons.push('Same organization');
  } else {
    limitations.push('Organization mismatch.');
  }

  if (earlier.projectId === later.projectId && normalized(earlier.projectName) === normalized(later.projectName)) {
    score += 25;
    reasons.push('Same project');
  } else {
    limitations.push('Project mismatch.');
  }

  if (earlier.areaName && normalized(earlier.areaName) === normalized(later.areaName)) {
    score += 20;
    reasons.push('Same area or room');
  } else {
    limitations.push('Area or room does not clearly match.');
  }

  if (earlier.realityObjectId && earlier.realityObjectId === later.realityObjectId) {
    score += 20;
    reasons.push('Same Reality Object');
  } else if (normalized(earlier.subject) === normalized(later.subject)) {
    score += 12;
    reasons.push('Same subject label');
  } else {
    limitations.push('Subject identity is not clearly the same.');
  }

  if (earlier.viewpointKey === later.viewpointKey) {
    score += 15;
    reasons.push('Approximate viewpoint matches');
  } else if (earlier.cameraDirection && earlier.cameraDirection === later.cameraDirection) {
    score += 8;
    reasons.push('Viewing direction appears similar');
  } else {
    limitations.push('Camera viewpoint or direction may differ.');
  }

  if (earlier.metadataReliability !== 'low' && later.metadataReliability !== 'low') {
    score += 10;
    reasons.push('Metadata reliability is sufficient');
  } else {
    limitations.push('Timestamp, GPS, caption, or area metadata is incomplete.');
  }

  if (later.imageQuality.obstruction === 'low') limitations.push('Later photo may be obstructed.');
  if (later.imageQuality.lighting === 'low') limitations.push('Lighting may affect visual interpretation.');
  if (later.imageQuality.resolution === 'low') limitations.push('Resolution may be too weak for confident comparison.');

  const duplicateDetected = earlier.duplicateKey === later.duplicateKey;
  if (duplicateDetected) {
    limitations.push('Duplicate or near-duplicate photo signature detected.');
  }

  const cappedScore = duplicateDetected ? Math.min(score, 25) : Math.min(score, 100);
  const classification: PIEPhotoComparability =
    earlier.organizationId !== later.organizationId || earlier.projectId !== later.projectId
      ? 'not_comparable'
      : cappedScore >= 82
        ? 'strong_match'
        : cappedScore >= 62
          ? 'probable_match'
          : cappedScore >= 38
            ? 'weak_match'
            : 'not_comparable';

  return {
    earlierPhotoId: earlier.photoId,
    laterPhotoId: later.photoId,
    classification,
    score: cappedScore,
    reasons,
    limitations,
    normalizationOperations: normalizationOperationsFor(earlier, later, classification),
    duplicateDetected,
  };
}

function normalizationOperationsFor(
  earlier: PIEPhotoIntelligencePhoto,
  later: PIEPhotoIntelligencePhoto,
  classification: PIEPhotoComparability,
): PIEPhotoNormalizationOperation[] {
  if (classification === 'not_comparable') return [];
  const operations: PIEPhotoNormalizationOperation[] = [
    'orientation_normalized',
    'brightness_normalized',
    'contrast_normalized',
  ];
  if (earlier.viewpointKey !== later.viewpointKey) {
    operations.push('camera_alignment_estimated', 'scale_estimated', 'perspective_estimated');
  }
  if (later.imageQuality.obstruction === 'low') operations.push('crop_suggested');
  if (earlier.cameraDirection !== later.cameraDirection) operations.push('rotation_estimated');
  return operations;
}

export function detectPhotoProgressEvent({
  sequence,
  earlier,
  later,
  comparability,
  scheduleItems = [],
  actionItems = [],
  issues = [],
  generatedAt,
}: {
  sequence: PIEPhotoSequence;
  earlier: PIEPhotoIntelligencePhoto;
  later: PIEPhotoIntelligencePhoto;
  comparability: PIEPhotoComparabilityAssessment;
  scheduleItems?: ScheduleItem[];
  actionItems?: PIEPhotoProgressIntelligenceInput['actionItems'];
  issues?: PIEPhotoProgressIntelligenceInput['issues'];
  generatedAt: string;
}): PIEPhotoProgressEvent | null {
  if (comparability.duplicateDetected) return null;
  if (comparability.classification === 'not_comparable') return null;

  const category = inferProgressCategory(earlier, later, comparability);
  const direction = progressDirectionFor(category, comparability);
  const confidence =
    comparability.classification === 'strong_match' && direction !== 'uncertain'
      ? 'high'
      : comparability.classification === 'probable_match'
        ? 'medium'
        : 'low';

  if (comparability.classification === 'weak_match' && direction !== 'regressed') {
    return null;
  }

  const corroboratingEvidenceIds = findCorroboratingEvidenceIds(later, scheduleItems, actionItems, issues, category);
  const contradictingEvidenceIds = findContradictingEvidenceIds(later, scheduleItems, actionItems, issues, category);
  const jarvisOutcome = validateVisualProgressWithJARVIS({
    comparability,
    direction,
    confidence,
    corroboratingEvidenceIds,
    contradictingEvidenceIds,
    category,
  });

  return {
    id: `photo-progress-event-${stableHash(`${sequence.id}:${earlier.photoId}:${later.photoId}:${category}`)}`,
    organizationId: sequence.organizationId,
    projectId: sequence.projectId,
    photoSequenceId: sequence.id,
    affectedRealityObjectIds: [earlier.realityObjectId, later.realityObjectId].filter((item): item is string => Boolean(item)),
    earlierPhotoId: earlier.photoId,
    laterPhotoId: later.photoId,
    earlierCaptureDate: earlier.capturedAt,
    laterCaptureDate: later.capturedAt,
    observation: observationFor(category, earlier, later),
    inferredMeaning: inferenceFor(category, direction),
    progressCategory: category,
    progressDirection: direction,
    confidence,
    comparabilityScore: comparability.score,
    imageRegions: regionHintsFor(later),
    limitations: [
      ...comparability.limitations,
      'DAVE separates visible observation from completion approval.',
      confidence === 'low' ? 'Low confidence prevents a firm project conclusion.' : null,
    ].filter((item): item is string => Boolean(item)),
    corroboratingEvidenceIds,
    contradictingEvidenceIds,
    scheduleOrActionItemLinks: [...corroboratingEvidenceIds, ...contradictingEvidenceIds],
    verificationStatus:
      jarvisOutcome === 'supported' ? 'supported' : jarvisOutcome === 'blocked' ? 'needs_review' : 'unverified',
    reviewStatus: jarvisOutcome,
    createdAt: generatedAt,
  };
}

function inferProgressCategory(
  earlier: PIEPhotoIntelligencePhoto,
  later: PIEPhotoIntelligencePhoto,
  comparability: PIEPhotoComparabilityAssessment,
): PIEPhotoProgressCategory {
  if (comparability.classification === 'not_comparable') return 'not_comparable';
  const previous = `${earlier.caption || ''} ${earlier.notes || ''} ${earlier.actionStatus}`;
  const current = `${later.caption || ''} ${later.notes || ''} ${later.actionStatus}`;

  if (includesAny(current, ['removed guardrail', 'missing guardrail', 'barrier removed', 'safety removed'])) return 'safety_control_removed';
  if (includesAny(current, ['damage', 'leak', 'crack', 'corrosion', 'deterioration'])) return 'visible_damage_or_deterioration';
  if (includesAny(current, ['obstructed', 'blocked', 'stored material', 'new obstruction'])) return 'new_obstruction';
  if (includesAny(current, ['debris', 'trash', 'housekeeping issue', 'clutter'])) return 'housekeeping_deterioration';
  if (includesAny(current, ['incomplete', 'still in progress', 'not complete', 'partially complete'])) return 'partial_construction';
  if (includesAny(current, ['complete', 'completed', 'closed']) || later.actionStatus === 'Closed') return 'completed_construction';
  if (includesAny(current, ['progress', 'rough-in', 'framing', 'started', 'in progress']) || later.actionStatus === 'In Progress') return 'partial_construction';
  if (includesAny(current, ['installed', 'mounted', 'set in place', 'conduit', 'guardrail', 'toe board'])) return 'new_installation';
  if (includesAny(current, ['clean', 'cleared', 'organized', 'swept']) && !includesAny(previous, ['clean', 'cleared'])) return 'housekeeping_improvement';
  if (includesAny(current, ['removed', 'demolished', 'demo'])) return 'removed_material_or_equipment';
  if (normalized(previous) === normalized(current) && current.trim()) return 'no_meaningful_change';
  if (daysBetween(earlier.capturedAt, later.capturedAt) !== null && daysBetween(earlier.capturedAt, later.capturedAt)! >= 14) {
    return 'temporary_condition_remaining';
  }
  return 'no_meaningful_change';
}

function progressDirectionFor(
  category: PIEPhotoProgressCategory,
  comparability: PIEPhotoComparabilityAssessment,
): PIEPhotoProgressDirection {
  if (category === 'not_comparable' || comparability.classification === 'not_comparable') return 'not_comparable';
  if (
    category === 'safety_control_removed' ||
    category === 'visible_damage_or_deterioration' ||
    category === 'housekeeping_deterioration' ||
    category === 'new_obstruction'
  ) return 'regressed';
  if (category === 'no_meaningful_change' || category === 'temporary_condition_remaining') return 'unchanged';
  if (category === 'partial_construction' || category === 'work_started_not_completed') return 'partially_progressed';
  if (comparability.classification === 'weak_match') return 'uncertain';
  return 'progressed';
}

function observationFor(
  category: PIEPhotoProgressCategory,
  earlier: PIEPhotoIntelligencePhoto,
  later: PIEPhotoIntelligencePhoto,
) {
  if (category === 'not_comparable') return 'The photos do not show the same subject or viewpoint reliably.';
  if (category === 'no_meaningful_change') return 'The comparable photos show no meaningful visible change from the available metadata and captions.';
  if (category === 'safety_control_removed') return 'A safety control or barrier appears missing or removed in the later photo context.';
  if (category === 'visible_damage_or_deterioration') return 'Visible damage, leak, crack, corrosion, debris, or deterioration is described in the later photo context.';
  if (category === 'new_installation') return `The later photo context includes installed or added work for ${later.subject}.`;
  if (category === 'completed_construction') return `The later photo context describes ${later.subject} as closed or complete.`;
  if (category === 'partial_construction') return `The later photo context describes active or partial work on ${later.subject}.`;
  if (category === 'temporary_condition_remaining') return `The same condition for ${later.subject} appears across multiple comparable photos over time.`;
  return `The later photo context differs from the earlier photo for ${earlier.subject}.`;
}

function inferenceFor(category: PIEPhotoProgressCategory, direction: PIEPhotoProgressDirection) {
  if (direction === 'regressed') return 'This may indicate regression or an unresolved condition. Human or corroborating validation is required before presenting it as fact.';
  if (direction === 'unchanged') return 'No visible progress was detected in the comparable images. Work may have occurred outside the photographed area.';
  if (category === 'completed_construction') return 'The work may be complete, but completion still requires supporting evidence such as inspection, schedule, action-item, or human confirmation.';
  if (direction === 'progressed') return 'The work appears to have advanced visually, pending corroboration.';
  if (direction === 'partially_progressed') return 'The work appears in progress and not fully complete.';
  return 'The visual meaning is uncertain and needs better evidence.';
}

function regionHintsFor(photo: PIEPhotoIntelligencePhoto) {
  return [
    photo.subject ? `Primary subject: ${photo.subject}` : null,
    photo.areaName ? `Area: ${photo.areaName}` : null,
    photo.caption ? 'Caption-supported region' : 'Full image review needed',
  ].filter((item): item is string => Boolean(item));
}

function findCorroboratingEvidenceIds(
  photo: PIEPhotoIntelligencePhoto,
  scheduleItems: ScheduleItem[],
  actionItems: PIEPhotoProgressIntelligenceInput['actionItems'],
  issues: PIEPhotoProgressIntelligenceInput['issues'],
  category: PIEPhotoProgressCategory,
) {
  const area = normalized(photo.areaName);
  const subject = normalized(photo.subject);
  const ids: string[] = [];
  scheduleItems.forEach(item => {
    if (
      normalized(item.projectName) === normalized(photo.projectName) &&
      (normalized(item.locationName) === area || normalized(item.taskName).includes(subject)) &&
      (
        scheduleProgressIsComplete(item) ||
        item.status === 'In Progress' ||
        (item.percentComplete > 0 && item.percentComplete < 100)
      )
    ) {
      ids.push(`schedule:${item.id}`);
    }
  });
  actionItems?.forEach(item => {
    if (
      normalized(item.projectName) === normalized(photo.projectName) &&
      (!area || normalized(item.areaName) === area) &&
      (normalized(item.title).includes(subject) || category === 'completed_construction')
    ) {
      ids.push(`action:${item.id}`);
    }
  });
  issues?.forEach(item => {
    if (
      normalized(item.projectName) === normalized(photo.projectName) &&
      (!area || normalized(item.areaName) === area) &&
      (category === 'visible_damage_or_deterioration' || category === 'safety_control_removed')
    ) {
      ids.push(`issue:${item.id}`);
    }
  });
  return ids;
}

function findContradictingEvidenceIds(
  photo: PIEPhotoIntelligencePhoto,
  scheduleItems: ScheduleItem[],
  actionItems: PIEPhotoProgressIntelligenceInput['actionItems'],
  issues: PIEPhotoProgressIntelligenceInput['issues'],
  category: PIEPhotoProgressCategory,
) {
  const area = normalized(photo.areaName);
  const subject = normalized(photo.subject);
  const ids: string[] = [];
  scheduleItems.forEach(item => {
    if (
      normalized(item.projectName) === normalized(photo.projectName) &&
      (normalized(item.locationName) === area || normalized(item.taskName).includes(subject)) &&
      category === 'completed_construction' &&
      !scheduleProgressIsComplete(item)
    ) {
      ids.push(`schedule:${item.id}`);
    }
    if (
      normalized(item.projectName) === normalized(photo.projectName) &&
      (normalized(item.locationName) === area || normalized(item.taskName).includes(subject)) &&
      (category === 'partial_construction' || category === 'work_started_not_completed') &&
      scheduleProgressIsComplete(item)
    ) {
      ids.push(`schedule:${item.id}`);
    }
  });
  actionItems?.forEach(item => {
    if (
      normalized(item.projectName) === normalized(photo.projectName) &&
      (!area || normalized(item.areaName) === area) &&
      normalized(item.status) === 'closed' &&
      (category === 'visible_damage_or_deterioration' || category === 'safety_control_removed' || category === 'partial_construction')
    ) {
      ids.push(`action:${item.id}`);
    }
  });
  issues?.forEach(item => {
    if (
      normalized(item.projectName) === normalized(photo.projectName) &&
      (!area || normalized(item.areaName) === area) &&
      normalized(item.status) === 'closed' &&
      (category === 'visible_damage_or_deterioration' || category === 'safety_control_removed')
    ) {
      ids.push(`issue:${item.id}`);
    }
  });
  return ids;
}

export function validateVisualProgressWithJARVIS({
  comparability,
  direction,
  confidence,
  corroboratingEvidenceIds,
  contradictingEvidenceIds,
  category,
}: {
  comparability: PIEPhotoComparabilityAssessment;
  direction: PIEPhotoProgressDirection;
  confidence: ProjectConfidenceLevel;
  corroboratingEvidenceIds: string[];
  contradictingEvidenceIds: string[];
  category: PIEPhotoProgressCategory;
}): PIEVisualJARVISOutcome {
  if (comparability.classification === 'not_comparable') return 'blocked';
  if (comparability.duplicateDetected) return 'blocked';
  if (comparability.classification === 'weak_match') return 'needs_another_photograph';
  if (contradictingEvidenceIds.length > 0) return 'human_review_required';
  if (direction === 'regressed') return 'human_review_required';
  if (category === 'completed_construction' && corroboratingEvidenceIds.length === 0) {
    return 'needs_corroborating_evidence';
  }
  if (confidence === 'low') return 'needs_another_photograph';
  if (comparability.limitations.length > 0) return 'supported_with_limitations';
  return 'supported';
}

function buildConflicts(events: PIEPhotoProgressEvent[]): PIEPhotoProgressConflict[] {
  return events.flatMap(event => {
    const conflicts: PIEPhotoProgressConflict[] = [];
    if (event.contradictingEvidenceIds.length > 0) {
      conflicts.push({
        id: `visual-conflict-${event.id}`,
        organizationId: event.organizationId,
        projectId: event.projectId,
        eventId: event.id,
        conflictType:
          event.progressDirection === 'regressed'
            ? 'visual_regression_candidate'
            : 'reported_complete_but_visibly_incomplete',
        summary: 'Photo progress does not fully agree with schedule, action item, issue, or expected Reality state.',
        evidenceIds: [event.earlierPhotoId, event.laterPhotoId, ...event.contradictingEvidenceIds],
        reviewRequired: true,
      });
    }
    if (event.reviewStatus === 'human_review_required' && event.progressDirection === 'regressed') {
      conflicts.push({
        id: `visual-regression-${event.id}`,
        organizationId: event.organizationId,
        projectId: event.projectId,
        eventId: event.id,
        conflictType: 'visual_regression_candidate',
        summary: 'A possible visual regression was detected and requires JARVIS/human validation before it is treated as fact.',
        evidenceIds: [event.earlierPhotoId, event.laterPhotoId],
        reviewRequired: true,
      });
    }
    return conflicts;
  });
}

function buildRepeatPhotoGuidance(
  photos: PIEPhotoIntelligencePhoto[],
  assessments: PIEPhotoComparabilityAssessment[],
): PIERepeatPhotoGuidance[] {
  const assessmentGuidance = assessments
    .filter(assessment =>
      assessment.classification === 'weak_match' ||
      assessment.classification === 'not_comparable' ||
      assessment.limitations.some(limit => normalized(limit).includes('obstruct') || normalized(limit).includes('viewpoint')),
    )
    .slice(0, 3)
    .map(assessment => {
      const later = photos.find(photo => photo.photoId === assessment.laterPhotoId);
      const earlier = photos.find(photo => photo.photoId === assessment.earlierPhotoId);
      const reference = earlier || later || null;
      return {
        needed: true,
        projectId: reference?.projectId || 'unknown-project',
        projectName: reference?.projectName || 'Current Project',
        areaName: reference?.areaName || null,
        realityObjectId: reference?.realityObjectId || null,
        referencePhotoId: reference?.photoId || null,
        referencePhotoUri: reference?.uri || null,
        instruction: captureInstructionFor(reference, assessment),
        reason: 'A comparable repeat photo would reduce uncertainty in visible progress.',
        alignmentGuide: reference?.cameraDirection
          ? `Match the prior view facing ${reference.cameraDirection}.`
          : 'Match the previous framing and keep the full subject visible.',
        priority: assessment.classification === 'not_comparable' ? 'high' as const : 'medium' as const,
      };
    });
  const assessedPhotoIds = new Set(
    assessmentGuidance
      .flatMap(item => [item.referencePhotoId])
      .filter((item): item is string => Boolean(item)),
  );
  const obstructionGuidance = photos
    .filter(photo =>
      photo.imageQuality.obstruction === 'low' &&
      !assessedPhotoIds.has(photo.photoId)
    )
    .slice(0, 2)
    .map(photo => ({
      needed: true,
      projectId: photo.projectId,
      projectName: photo.projectName,
      areaName: photo.areaName,
      realityObjectId: photo.realityObjectId,
      referencePhotoId: photo.photoId,
      referencePhotoUri: photo.uri,
      instruction: `Take one unobstructed photo of ${photo.subject}.`,
      reason: 'The current photo is blocked, so progress cannot be compared confidently.',
      alignmentGuide: photo.cameraDirection
        ? `Match the prior view facing ${photo.cameraDirection}.`
        : 'Keep the full subject visible from the same standing position.',
      priority: 'high' as const,
    }));
  return [...assessmentGuidance, ...obstructionGuidance].slice(0, 3);
}

function captureInstructionFor(
  photo: PIEPhotoIntelligencePhoto | null,
  assessment: PIEPhotoComparabilityAssessment,
) {
  if (!photo) return 'Take one clear photo from the same position as the prior update.';
  if (assessment.limitations.some(limit => normalized(limit).includes('obstruct'))) {
    return `Take one unobstructed photo of ${photo.subject}.`;
  }
  if (assessment.limitations.some(limit => normalized(limit).includes('viewpoint'))) {
    return `Take one photo of ${photo.subject} from the same doorway or standing position.`;
  }
  return `Take one clear repeat photo of ${photo.subject}.`;
}

function buildProgressEstimate(
  events: PIEPhotoProgressEvent[],
  sequences: PIEPhotoSequence[],
  scheduleItems: ScheduleItem[],
): PIEPhotoProgressEstimate {
  const supportedProgress = events.filter(event =>
    (event.progressDirection === 'progressed' || event.progressDirection === 'partially_progressed') &&
    event.reviewStatus !== 'blocked',
  );
  const regressions = events.filter(event => event.progressDirection === 'regressed');
  const unchanged = events.filter(event => event.progressDirection === 'unchanged');
  const structuredScope = scheduleItems.length > 0;

  if (events.length === 0) {
    return {
      state: sequences.length > 0 ? 'not_comparable' : 'insufficient_scope',
      estimatedProgress: null,
      confidenceRange: null,
      scopeIncluded: sequences.map(sequence => sequence.subject),
      scopeExcluded: ['Areas without comparable photos', 'Work not visible in photographs'],
      assumptions: ['Completion percentages are not created from photos alone.'],
      evidenceGaps: ['Capture repeat photos from comparable viewpoints.'],
      summary: 'No reliable longitudinal photo progress event is available yet.',
    };
  }

  if (!structuredScope) {
    return {
      state: regressions.length > 0
        ? 'regression_possible'
        : supportedProgress.length > 0
          ? 'progress_visible'
          : unchanged.length > 0
            ? 'unchanged'
            : 'insufficient_scope',
      estimatedProgress: null,
      confidenceRange: null,
      scopeIncluded: Array.from(new Set(events.map(event => event.photoSequenceId))),
      scopeExcluded: ['Structured project scope is not available', 'Work outside the photographed area'],
      assumptions: ['Photo evidence is qualitative until structured scope, inspection, schedule, or human confirmation supports measurement.'],
      evidenceGaps: ['Add schedule scope or human confirmation before using a numeric progress estimate.'],
      summary: supportedProgress.length > 0
        ? 'Visible progress was detected qualitatively. No unsupported completion percentage was created.'
        : 'No visible progress was detected in comparable images. Work may have occurred outside the photographed area.',
    };
  }

  const estimated = Math.round((supportedProgress.length / Math.max(1, scheduleItems.length)) * 100);
  return {
    state: supportedProgress.length > 0 ? 'partial_progress_visible' : 'unchanged',
    estimatedProgress: Math.min(estimated, 95),
    confidenceRange: [Math.max(0, estimated - 20), Math.min(100, estimated + 15)],
    scopeIncluded: scheduleItems.map(item => item.taskName).slice(0, 6),
    scopeExcluded: ['Schedule items without visible photo evidence', 'Inspection-only acceptance criteria'],
    assumptions: ['Photo-backed progress is weighted against structured schedule scope and still requires corroboration.'],
    evidenceGaps: ['Confirm visually observed progress with inspection, action item, or human review evidence.'],
    summary: `Photo-backed progress estimate is ${Math.min(estimated, 95)}% for visible scheduled scope, with limits disclosed.`,
  };
}

function buildQualifiedEvidence(
  events: PIEPhotoProgressEvent[],
): PIEQualifiedRealityEvidence[] {
  return events.map(event => ({
    id: `visual-observation-${event.id}`,
    evidenceId: event.id,
    organizationId: event.organizationId,
    projectId: event.projectId,
    type: 'photo',
    name: event.observation,
    projectName: event.projectId,
    areaName: null,
    location: null,
    status:
      event.progressDirection === 'regressed'
        ? 'at_risk'
        : event.progressDirection === 'progressed'
          ? 'in_progress'
          : 'needs_verification',
    confidence: event.confidence,
    evidenceSummary: event.observation,
    nextAction:
      event.reviewStatus === 'supported'
        ? event.inferredMeaning
        : 'Verify this visual observation before treating it as project truth.',
    owner: null,
    occurredAt: event.laterCaptureDate || event.createdAt,
    source: 'longitudinal_photo_intelligence',
    evidenceQualified: true as const,
    identityConfidence: event.affectedRealityObjectIds.length > 0 ? 'high' : 'medium',
  }));
}

function buildJarvisValidation(
  assessments: PIEPhotoComparabilityAssessment[],
  events: PIEPhotoProgressEvent[],
  photos: PIEPhotoIntelligencePhoto[],
) {
  const checks = [
    {
      id: 'project-organization-match',
      status: photos.every(photo => photo.organizationId && photo.projectId) ? 'supported' as const : 'blocked' as const,
      summary: 'Project and organization boundaries are present on analyzed photos.',
    },
    {
      id: 'timestamp-integrity',
      status: photos.every(photo => photo.timestampReliable) ? 'supported' as const : 'supported_with_limitations' as const,
      summary: 'Timestamp reliability checked before sequencing.',
    },
    {
      id: 'sequence-identity',
      status: assessments.some(item => item.classification === 'strong_match' || item.classification === 'probable_match')
        ? 'supported' as const
        : 'needs_another_photograph' as const,
      summary: 'Comparable sequence identity is required before progress claims.',
    },
    {
      id: 'viewpoint-comparability',
      status: assessments.some(item => item.classification === 'weak_match' || item.classification === 'not_comparable')
        ? 'needs_another_photograph' as const
        : 'supported' as const,
      summary: 'Weak viewpoint matches produce repeat-photo guidance.',
    },
    {
      id: 'observation-inference-separation',
      status: events.every(event => event.observation && event.inferredMeaning) ? 'supported' as const : 'blocked' as const,
      summary: 'Visual observations are separated from inferred completion meaning.',
    },
    {
      id: 'regression-validation',
      status: events.some(event => event.progressDirection === 'regressed')
        ? 'human_review_required' as const
        : 'supported' as const,
      summary: 'Regression candidates require validation before presentation as fact.',
    },
    {
      id: 'duplicate-detection',
      status: assessments.some(item => item.duplicateDetected) ? 'blocked' as const : 'supported' as const,
      summary: 'Duplicate image signatures do not create progress events.',
    },
  ];
  const outcome: PIEVisualJARVISOutcome =
    checks.some(check => check.status === 'blocked')
      ? 'blocked'
      : checks.some(check => check.status === 'human_review_required')
        ? 'human_review_required'
        : checks.some(check => check.status === 'needs_another_photograph')
          ? 'needs_another_photograph'
          : checks.some(check => check.status === 'supported_with_limitations')
            ? 'supported_with_limitations'
            : 'supported';
  return { outcome, checks };
}

function buildCacheEntries(
  events: PIEPhotoProgressEvent[],
  realityModel: PIERealityModel | null | undefined,
): PIEPhotoIntelligenceCacheEntry[] {
  return events.map(event => ({
    comparisonInputSignature: stableHash([
      event.earlierPhotoId,
      event.laterPhotoId,
      event.photoSequenceId,
      realityModel?.version || 0,
      ANALYSIS_VERSION,
    ].join('|')),
    sequenceId: event.photoSequenceId,
    earlierPhotoId: event.earlierPhotoId,
    laterPhotoId: event.laterPhotoId,
    realityModelVersion: realityModel?.version || null,
    analysisVersion: ANALYSIS_VERSION,
  }));
}

function buildReanalysisReasons(
  input: PIEPhotoProgressIntelligenceInput,
  photos: PIEPhotoIntelligencePhoto[],
  events: PIEPhotoProgressEvent[],
) {
  const previousSignatureSet = new Set(
    input.priorAnalyses?.flatMap(analysis =>
      analysis.cacheEntries.map(entry => entry.comparisonInputSignature),
    ) || [],
  );
  const newSignatures = buildCacheEntries(events, input.realityModel)
    .filter(entry => !previousSignatureSet.has(entry.comparisonInputSignature));
  return [
    photos.length > 0 ? 'Project photos are available for automatic longitudinal review.' : null,
    newSignatures.length > 0 ? 'New photo comparison input signature detected.' : null,
    input.realityModel?.version ? `Reality Model version ${input.realityModel.version} used for context.` : null,
  ].filter((item): item is string => Boolean(item));
}

function buildConciseProgressCard(
  events: PIEPhotoProgressEvent[],
  guidance: PIERepeatPhotoGuidance[],
) {
  const bestEvent = events.find(event => event.progressDirection === 'progressed' || event.progressDirection === 'partially_progressed') ||
    events.find(event => event.progressDirection === 'regressed') ||
    events[0];
  if (bestEvent) {
    return {
      visible: true,
      title: bestEvent.progressDirection === 'regressed' ? 'Needs verification' : 'Visible progress detected',
      summary: `${bestEvent.observation} ${bestEvent.reviewStatus === 'supported' ? 'Verification is supported.' : 'Additional verification is still needed.'}`,
      primaryAction: 'View Progress' as const,
    };
  }
  if (guidance[0]) {
    return {
      visible: true,
      title: 'Repeat photo needed',
      summary: guidance[0].instruction,
      primaryAction: 'Capture Repeat Photo' as const,
    };
  }
  return {
    visible: false,
    title: 'No visual progress signal yet',
    summary: 'Comparable project photos will be analyzed automatically after capture.',
    primaryAction: 'View Progress' as const,
  };
}

export function buildPIEPhotoProgressIntelligence(
  input: PIEPhotoProgressIntelligenceInput = {},
): PIEPhotoProgressIntelligenceResult {
  const generatedAt = (input.now || new Date()).toISOString();
  const organizationId = input.organizationId || input.realityModel?.organizationId || 'local-organization';
  const projectId = input.projectId || input.realityModel?.projectId || slug(input.projectName) || 'local-project';
  const photos = flattenPhotos({ ...input, organizationId, projectId });
  const sequences = buildPhotoSequences(photos).filter(sequence => sequence.photoIds.length > 0);
  const photoById = new Map(photos.map(photo => [photo.photoId, photo]));
  const assessments: PIEPhotoComparabilityAssessment[] = [];
  const events: PIEPhotoProgressEvent[] = [];

  sequences.forEach(sequence => {
    const sequencePhotos = sequence.photoIds
      .map(id => photoById.get(id))
      .filter((photo): photo is PIEPhotoIntelligencePhoto => Boolean(photo))
      .sort((left, right) => dateValue(left.capturedAt) - dateValue(right.capturedAt));
    for (let index = 1; index < sequencePhotos.length; index += 1) {
      const earlier = sequencePhotos[index - 1];
      const later = sequencePhotos[index];
      const assessment = assessPhotoComparability(earlier, later);
      assessments.push(assessment);
      const event = detectPhotoProgressEvent({
        sequence,
        earlier,
        later,
        comparability: assessment,
        scheduleItems: input.scheduleItems,
        actionItems: input.actionItems,
        issues: input.issues,
        generatedAt,
      });
      if (event) events.push(event);
    }
  });

  const conflicts = buildConflicts(events);
  const repeatPhotoGuidance = buildRepeatPhotoGuidance(photos, assessments);
  const stalledProgressEvents = events.filter(event => event.progressDirection === 'unchanged');
  const regressionCandidates = events.filter(event => event.progressDirection === 'regressed');
  const progressEstimate = buildProgressEstimate(events, sequences, input.scheduleItems || []);
  const visualJarvisValidation = buildJarvisValidation(assessments, events, photos);
  const qualifiedRealityEvidence = buildQualifiedEvidence(events);
  const cacheEntries = buildCacheEntries(events, input.realityModel);
  const reanalysisReasons = buildReanalysisReasons(input, photos, events);
  const conciseProgressCard = buildConciseProgressCard(events, repeatPhotoGuidance);

  return {
    analysisVersion: ANALYSIS_VERSION,
    generatedAt,
    organizationId,
    projectId,
    sequences,
    comparabilityAssessments: assessments,
    progressEvents: events,
    progressEstimate,
    conflicts,
    stalledProgressEvents,
    regressionCandidates,
    repeatPhotoGuidance,
    visualJarvisValidation,
    qualifiedRealityEvidence,
    cacheEntries,
    reanalysisReasons,
    conciseProgressCard,
  };
}
