import type {
  ProjectArea,
  ProjectUpdate,
  ReferenceDocument,
  ScheduleItem,
  UpdatePhoto,
} from '../types';
import {
  daysUntilDate,
  dueStatusText,
} from '../utils/date';
import {
  buildScheduleSummary,
  type ScheduleSummary,
} from '../utils/schedule';
import type {
  PIEPhotoProgressEvidence,
} from './PIEPhotoProgress';
import type {
  ProjectConfidenceLevel,
  ProjectReportHistoryMetadata,
  ProjectSyncFreshnessMetadata,
} from './ProjectIntelligenceEngine';

export type PIEEvidenceSourceType =
  | 'schedule'
  | 'photo'
  | 'photo-progress'
  | 'gps'
  | 'typed-update'
  | 'issue'
  | 'safety'
  | 'project-area'
  | 'document-metadata'
  | 'report-history'
  | 'sync-cloud'
  | 'demo-ocr'
  | 'ai-ocr'
  | 'pdf-text'
  | 'unknown';

export type PIEEvidenceSource = {
  type: PIEEvidenceSourceType;
  label: string;
  recordId?: string | null;
  confidence: ProjectConfidenceLevel;
  capturedAt?: string | null;
};

export type PIEScheduleEvidence = {
  id: string;
  projectName: string;
  taskName: string;
  areaName: string;
  startDate: string | null;
  dueDate: string | null;
  dueLabel: string;
  daysUntilDue: number | null;
  status: ScheduleItem['status'];
  percentComplete: number;
  priority: ScheduleItem['priority'];
  owner: string | null;
  contractor: string | null;
  notes: string | null;
  milestone: string | null;
  importedFrom: string | null;
  importedAt: string | null;
  isMilestone: boolean;
  isOverdue: boolean;
  isUpcoming7: boolean;
  isUpcoming14: boolean;
  isUpcoming30: boolean;
  isComplete: boolean;
  needsReview: boolean;
  sources: PIEEvidenceSource[];
  confidence: ProjectConfidenceLevel;
};

export type PIEPhotoEvidence = {
  id: string;
  updateId: string;
  projectName: string;
  areaName: string | null;
  caption: string | null;
  category: UpdatePhoto['category'];
  actionRequired: string | null;
  actionOwner: string | null;
  actionDueDate: string | null;
  actionStatus: UpdatePhoto['actionStatus'];
  timestamp: string | null;
  gpsLatitude: number | null;
  gpsLongitude: number | null;
  gpsAccuracy: number | null;
  hasGps: boolean;
  isIssue: boolean;
  isSafety: boolean;
  needsAction: boolean;
  sources: PIEEvidenceSource[];
  confidence: ProjectConfidenceLevel;
};

export type PIEGPSEvidence = {
  projectName: string;
  gpsAvailable: boolean;
  recommendedProject: string | null;
  recommendedArea: string | null;
  lastKnownLocation: string | null;
  latitude: number | null;
  longitude: number | null;
  accuracy: number | null;
  nearestMappedArea: string | null;
  distanceFromNearestAreaFeet: number | null;
  withinMappedArea: boolean | null;
  correctionStatus: 'accepted' | 'corrected' | 'needs-verification' | 'not-available';
  supportsProjectWalk: boolean;
  confidenceScore: number;
  confidence: ProjectConfidenceLevel;
  evidence: string[];
  sources: PIEEvidenceSource[];
};

export type PIEUserUpdateEvidence = {
  id: string;
  projectName: string;
  areaName: string | null;
  notes: string | null;
  date: string | null;
  photoCount: number;
  mentionedIssues: string[];
  mentionedSafety: string[];
  mentionedDecisions: string[];
  blockers: string[];
  nextSteps: string[];
  communicationReady: boolean;
  recipientCount: number;
  sources: PIEEvidenceSource[];
  confidence: ProjectConfidenceLevel;
};

export type PIEIssueEvidence = {
  id: string;
  projectName: string;
  areaName: string | null;
  title: string;
  status: string;
  owner: string | null;
  dueDate: string | null;
  isOverdue: boolean;
  evidenceText: string[];
  sources: PIEEvidenceSource[];
  confidence: ProjectConfidenceLevel;
};

export type PIESafetyEvidence = {
  id: string;
  projectName: string;
  areaName: string | null;
  title: string;
  status: string;
  owner: string | null;
  dueDate: string | null;
  isOpen: boolean;
  evidenceText: string[];
  sources: PIEEvidenceSource[];
  confidence: ProjectConfidenceLevel;
};

export type PIEvidenceGap = {
  id: string;
  projectName: string;
  title: string;
  summary: string;
  source: PIEEvidenceSourceType;
  severity: 'low' | 'medium' | 'high' | 'critical';
  confidence: ProjectConfidenceLevel;
  suggestedAction: string;
};

export type PIEvidenceConflict = {
  id: string;
  projectName: string;
  title: string;
  summary: string;
  sources: PIEEvidenceSourceType[];
  severity: 'low' | 'medium' | 'high' | 'critical';
  confidence: ProjectConfidenceLevel;
  suggestedAction: string;
};

export type PIEEvidenceGap = PIEvidenceGap;
export type PIEEvidenceConflict = PIEvidenceConflict;

export type PIEEvidenceFusionSummary = {
  projectName: string;
  generatedAt: string;
  sourceCount: number;
  sources: PIEEvidenceSourceType[];
  scheduleItemCount: number;
  milestoneCount: number;
  overdueScheduleCount: number;
  upcoming7Count: number;
  upcoming14Count: number;
  upcoming30Count: number;
  scheduleNeedsReviewCount: number;
  photoCount: number;
  captionedPhotoCount: number;
  photoActionCount: number;
  gpsAvailable: boolean;
  gpsConfidenceScore: number;
  userUpdateCount: number;
  issueCount: number;
  safetyCount: number;
  documentCount: number;
  reportHistoryCount: number;
  gapCount: number;
  conflictCount: number;
  confidence: ProjectConfidenceLevel;
  trustScore: number;
  summary: string;
};

export type PIEIntelligentSummary = {
  projectName: string;
  generatedAt: string;
  projectStatus: string;
  whatChanged: string;
  scheduleStatus: string;
  photoEvidenceSummary: string;
  gpsLocationConfidence: string;
  userUpdateSummary: string;
  risksAndIssues: string;
  safetySummary: string;
  missingInformation: string[];
  pieRecommendation: string;
  confidence: ProjectConfidenceLevel;
  trust: number;
  nextAction: string;
  evidenceSourceSummary: string;
};

export type PIEFusedEvidence = {
  projectName: string;
  generatedAt: string;
  sources: PIEEvidenceSourceType[];
  scheduleEvidence: PIEScheduleEvidence[];
  scheduleSummary: ScheduleSummary;
  photoEvidence: PIEPhotoEvidence[];
  photoProgressEvidence: PIEPhotoProgressEvidence[];
  gpsEvidence: PIEGPSEvidence;
  userUpdateEvidence: PIEUserUpdateEvidence[];
  issueEvidence: PIEIssueEvidence[];
  safetyEvidence: PIESafetyEvidence[];
  documentEvidence: PIEEvidenceSource[];
  reportEvidence: PIEEvidenceSource[];
  syncEvidence: PIEEvidenceSource[];
  gaps: PIEvidenceGap[];
  conflicts: PIEvidenceConflict[];
  evidenceFusionSummary: PIEEvidenceFusionSummary;
  intelligentSummary: PIEIntelligentSummary;
};

export type BuildFusedEvidenceParams = {
  projectName?: string | null;
  projectNames?: string[];
  updates?: ProjectUpdate[];
  currentUpdate?: ProjectUpdate | null;
  photoProgressEvidence?: PIEPhotoProgressEvidence[];
  scheduleItems?: ScheduleItem[];
  projectAreas?: ProjectArea[];
  referenceDocuments?: ReferenceDocument[];
  reportHistory?: ProjectReportHistoryMetadata[];
  syncMetadata?: ProjectSyncFreshnessMetadata | null;
  now?: Date;
};

type EvidenceSet = Pick<
  PIEFusedEvidence,
  | 'projectName'
  | 'generatedAt'
  | 'scheduleEvidence'
  | 'scheduleSummary'
  | 'photoEvidence'
  | 'photoProgressEvidence'
  | 'gpsEvidence'
  | 'userUpdateEvidence'
  | 'issueEvidence'
  | 'safetyEvidence'
  | 'documentEvidence'
  | 'reportEvidence'
  | 'syncEvidence'
  | 'sources'
>;

export function buildFusedEvidence({
  projectName,
  projectNames = [],
  updates = [],
  currentUpdate = null,
  photoProgressEvidence = [],
  scheduleItems = [],
  projectAreas = [],
  referenceDocuments = [],
  reportHistory = [],
  syncMetadata = null,
  now = new Date(),
}: BuildFusedEvidenceParams = {}): PIEFusedEvidence {
  const resolvedProjectName = resolveProjectName({
    projectName,
    projectNames,
    updates,
    currentUpdate,
    scheduleItems,
  });
  const projectUpdates = relatedUpdates(
    resolvedProjectName,
    updates,
    currentUpdate,
  );
  const scheduleEvidence = extractScheduleEvidence({
    projectName: resolvedProjectName,
    scheduleItems,
  });
  const scheduleSummary = buildScheduleSummary(scheduleItems, {
    projectName: resolvedProjectName,
  });
  const photoEvidence = extractPhotoEvidence({
    projectName: resolvedProjectName,
    updates: projectUpdates,
  });
  const gpsEvidence = extractGPSEvidence({
    projectName: resolvedProjectName,
    updates: projectUpdates,
    photoEvidence,
    scheduleEvidence,
    projectAreas,
  });
  const userUpdateEvidence = extractUserUpdateEvidence({
    projectName: resolvedProjectName,
    updates: projectUpdates,
  });
  const issueEvidence = extractIssueEvidence({
    projectName: resolvedProjectName,
    photoEvidence,
    userUpdateEvidence,
  });
  const safetyEvidence = extractSafetyEvidence({
    projectName: resolvedProjectName,
    photoEvidence,
    userUpdateEvidence,
  });
  const documentEvidence = extractDocumentEvidence(
    resolvedProjectName,
    referenceDocuments,
  );
  const reportEvidence = extractReportEvidence(resolvedProjectName, reportHistory);
  const syncEvidence = extractSyncEvidence(syncMetadata, now);
  const evidenceSet: EvidenceSet = {
    projectName: resolvedProjectName,
    generatedAt: now.toISOString(),
    scheduleEvidence,
    scheduleSummary,
    photoEvidence,
    photoProgressEvidence,
    gpsEvidence,
    userUpdateEvidence,
    issueEvidence,
    safetyEvidence,
    documentEvidence,
    reportEvidence,
    syncEvidence,
    sources: [],
  };
  const sources = collectSources(evidenceSet);
  const gaps = findEvidenceGaps({
    ...evidenceSet,
    sources,
  });
  const conflicts = findEvidenceConflicts({
    ...evidenceSet,
    sources,
  });
  const evidenceFusionSummary = buildEvidenceFusionSummary({
    ...evidenceSet,
    sources,
    gaps,
    conflicts,
  });
  const intelligentSummary = buildIntelligentSummary({
    ...evidenceSet,
    sources,
    gaps,
    conflicts,
    evidenceFusionSummary,
    intelligentSummary: emptyIntelligentSummary(
      resolvedProjectName,
      now.toISOString(),
    ),
    photoProgressEvidence,
  });

  return {
    ...evidenceSet,
    sources,
    gaps,
    conflicts,
    evidenceFusionSummary,
    intelligentSummary,
  };
}

export function extractScheduleEvidence({
  projectName,
  scheduleItems = [],
}: {
  projectName?: string | null;
  scheduleItems?: ScheduleItem[];
}): PIEScheduleEvidence[] {
  return scheduleItems
    .filter(item => matchesProject(projectName, item.projectName))
    .map(item => {
      const days = daysUntilDate(item.finishDate);
      const isComplete = item.status === 'Complete';
      const notes = trimOrNull(item.notes);
      const importedFrom = trimOrNull(item.importedFrom ?? '');
      const importedAt = trimOrNull(item.importedAt ?? '');
      const needsReview =
        !item.projectName.trim() ||
        !item.locationName.trim() ||
        !item.finishDate.trim() ||
        includesAny(notes || '', ['review', 'demo/test', 'best-effort', 'ai/ocr']);

      return {
        id: item.id,
        projectName: item.projectName.trim() || projectName || 'Unassigned Project',
        taskName: item.taskName.trim() || item.milestone.trim() || 'Untitled schedule item',
        areaName: item.locationName.trim() || 'Unassigned area',
        startDate: trimOrNull(item.startDate),
        dueDate: trimOrNull(item.finishDate),
        dueLabel: dueStatusText(item.finishDate),
        daysUntilDue: days,
        status: item.status,
        percentComplete: item.percentComplete,
        priority: item.priority,
        owner: trimOrNull(item.owner),
        contractor: trimOrNull(item.contractor),
        notes,
        milestone: trimOrNull(item.milestone),
        importedFrom,
        importedAt,
        isMilestone:
          Boolean(item.milestone.trim()) ||
          item.taskName.toLowerCase().includes('milestone'),
        isOverdue: !isComplete && days !== null && days < 0,
        isUpcoming7: !isComplete && days !== null && days >= 0 && days <= 7,
        isUpcoming14: !isComplete && days !== null && days >= 0 && days <= 14,
        isUpcoming30: !isComplete && days !== null && days >= 0 && days <= 30,
        isComplete,
        needsReview,
        sources: [
          {
            type: scheduleSourceType(importedFrom),
            label: importedFrom || 'Schedule item',
            recordId: item.id,
            confidence: scheduleConfidence(item, needsReview),
            capturedAt: importedAt || item.createdAt,
          },
        ],
        confidence: scheduleConfidence(item, needsReview),
      };
    })
    .sort((left, right) => {
      const leftRank = scheduleEvidenceRank(left);
      const rightRank = scheduleEvidenceRank(right);

      return rightRank - leftRank || (left.daysUntilDue ?? 9999) - (right.daysUntilDue ?? 9999);
    });
}

export function extractPhotoEvidence({
  projectName,
  updates = [],
}: {
  projectName?: string | null;
  updates?: ProjectUpdate[];
}): PIEPhotoEvidence[] {
  return updates
    .filter(update => matchesProject(projectName, update.projectName))
    .flatMap(update =>
      update.photos.map(photo => {
        const caption = trimOrNull(photo.caption);
        const actionRequired = trimOrNull(photo.actionRequired);
        const areaName = trimOrNull(photo.selectedAreaName ?? '') ||
          trimOrNull(update.selectedAreaName ?? '');
        const hasGps =
          typeof photo.gpsLatitude === 'number' &&
          typeof photo.gpsLongitude === 'number';
        const isIssue =
          photo.category === 'Open Issue' ||
          includesAny(`${caption || ''} ${actionRequired || ''}`, [
            'issue',
            'blocked',
            'blocker',
            'delay',
            'problem',
          ]);
        const isSafety =
          photo.category === 'Safety Concern' ||
          includesAny(`${caption || ''} ${actionRequired || ''}`, [
            'safety',
            'hazard',
            'unsafe',
          ]);
        const needsAction =
          Boolean(actionRequired) ||
          photo.actionStatus === 'Open' ||
          photo.actionStatus === 'In Progress' ||
          photo.actionStatus === 'Waiting';
        const confidence = photoConfidence({
          caption,
          areaName,
          hasGps,
          needsAction,
        });

        return {
          id: photo.id,
          updateId: update.id,
          projectName: update.projectName,
          areaName,
          caption,
          category: photo.category,
          actionRequired,
          actionOwner: trimOrNull(photo.actionOwner),
          actionDueDate: trimOrNull(photo.actionDueDate),
          actionStatus: photo.actionStatus,
          timestamp: photo.locationCapturedAt || update.date || null,
          gpsLatitude: photo.gpsLatitude ?? null,
          gpsLongitude: photo.gpsLongitude ?? null,
          gpsAccuracy: photo.gpsAccuracy ?? null,
          hasGps,
          isIssue,
          isSafety,
          needsAction,
          sources: [
            {
              type: 'photo',
              label: caption || photo.category,
              recordId: photo.id,
              confidence,
              capturedAt: photo.locationCapturedAt || update.date || null,
            },
          ],
          confidence,
        };
      }),
    );
}

export function extractGPSEvidence({
  projectName,
  updates = [],
  photoEvidence = [],
  scheduleEvidence = [],
  projectAreas = [],
}: {
  projectName?: string | null;
  updates?: ProjectUpdate[];
  photoEvidence?: PIEPhotoEvidence[];
  scheduleEvidence?: PIEScheduleEvidence[];
  projectAreas?: ProjectArea[];
}): PIEGPSEvidence {
  const updateGps = updates
    .filter(update => matchesProject(projectName, update.projectName))
    .map(update => ({
      projectName: update.projectName,
      areaName: trimOrNull(update.selectedAreaName ?? ''),
      latitude: update.gpsLatitude ?? null,
      longitude: update.gpsLongitude ?? null,
      accuracy: update.gpsAccuracy ?? null,
      capturedAt: update.locationCapturedAt || update.date || null,
      sourceId: update.id,
      sourceType: 'typed-update' as const,
    }));
  const photoGps = photoEvidence.map(photo => ({
    projectName: photo.projectName,
    areaName: photo.areaName,
    latitude: photo.gpsLatitude,
    longitude: photo.gpsLongitude,
    accuracy: photo.gpsAccuracy,
    capturedAt: photo.timestamp,
    sourceId: photo.id,
    sourceType: 'photo' as const,
  }));
  const candidates = [...photoGps, ...updateGps]
    .filter(
      candidate =>
        typeof candidate.latitude === 'number' &&
        typeof candidate.longitude === 'number',
    )
    .sort((left, right) => timestampValue(right.capturedAt) - timestampValue(left.capturedAt));
  const latest = candidates[0] ?? null;
  const areaCandidate =
    latest?.areaName ||
    mostCommon(photoEvidence.map(photo => photo.areaName)) ||
    mostCommon(scheduleEvidence.map(item => item.areaName)) ||
    null;
  const nearest = latest &&
    typeof latest.latitude === 'number' &&
    typeof latest.longitude === 'number'
    ? nearestArea(
        latest.latitude,
        latest.longitude,
        projectAreas,
      )
    : null;
  const recommendedArea = nearest?.withinRadius
    ? nearest.area.name
    : areaCandidate || nearest?.area.name || null;
  const recommendedProject =
    projectName ||
    latest?.projectName ||
    mostCommon(scheduleEvidence.map(item => item.projectName)) ||
    null;
  const gpsAvailable = Boolean(latest);
  const confidenceScore = gpsConfidenceScore({
    gpsAvailable,
    hasSelectedArea: Boolean(areaCandidate),
    hasNearestArea: Boolean(nearest),
    withinMappedArea: nearest?.withinRadius ?? false,
    hasScheduleArea: scheduleEvidence.some(item => item.areaName !== 'Unassigned area'),
  });
  const confidence = confidenceFromScore(confidenceScore);
  const correctionStatus: PIEGPSEvidence['correctionStatus'] =
    !gpsAvailable && !recommendedArea
      ? 'not-available'
      : confidenceScore < 70
        ? 'needs-verification'
        : areaCandidate && nearest && nearest.area.name !== areaCandidate
          ? 'corrected'
          : 'accepted';

  return {
    projectName: recommendedProject || projectName || 'Unassigned Project',
    gpsAvailable,
    recommendedProject,
    recommendedArea,
    lastKnownLocation:
      recommendedArea ||
      (latest ? `${latest.latitude}, ${latest.longitude}` : null),
    latitude: latest?.latitude ?? null,
    longitude: latest?.longitude ?? null,
    accuracy: latest?.accuracy ?? null,
    nearestMappedArea: nearest?.area.name ?? null,
    distanceFromNearestAreaFeet: nearest?.distanceFeet ?? null,
    withinMappedArea: nearest ? nearest.withinRadius : null,
    correctionStatus,
    supportsProjectWalk: Boolean(recommendedProject || recommendedArea),
    confidenceScore,
    confidence,
    evidence: uniqueText([
      gpsAvailable
        ? 'GPS metadata is available from recent field evidence.'
        : 'GPS metadata is not available.',
      recommendedProject ? `Recommended project: ${recommendedProject}.` : null,
      recommendedArea ? `Recommended area: ${recommendedArea}.` : null,
      nearest
        ? `Nearest mapped area is ${nearest.area.name} (${Math.round(nearest.distanceFeet)} ft away).`
        : null,
    ]),
    sources: latest
      ? [
          {
            type: latest.sourceType === 'photo' ? 'photo' : 'typed-update',
            label: latest.areaName || 'GPS evidence',
            recordId: latest.sourceId,
            confidence,
            capturedAt: latest.capturedAt,
          },
        ]
      : [],
  };
}

export function extractUserUpdateEvidence({
  projectName,
  updates = [],
}: {
  projectName?: string | null;
  updates?: ProjectUpdate[];
}): PIEUserUpdateEvidence[] {
  return updates
    .filter(update => matchesProject(projectName, update.projectName))
    .map(update => {
      const notes = trimOrNull(update.notes);
      const mentionedIssues = extractMatchingLines(notes, [
        'issue',
        'blocked',
        'blocker',
        'delay',
        'problem',
      ]);
      const mentionedSafety = extractMatchingLines(notes, [
        'safety',
        'hazard',
        'unsafe',
      ]);
      const mentionedDecisions = extractMatchingLines(notes, [
        'decision',
        'decided',
        'approved',
        'approval',
      ]);
      const blockers = extractMatchingLines(notes, [
        'blocked',
        'blocker',
        'waiting',
        'hold',
      ]);
      const nextSteps = extractMatchingLines(notes, [
        'next',
        'tomorrow',
        'follow up',
        'follow-up',
        'schedule',
      ]);
      const recipientCount = update.recipients.contactIds.length;
      const communicationReady = Boolean(notes) && recipientCount > 0;
      const confidence = updateConfidence({
        notes,
        areaName: update.selectedAreaName ?? null,
        photoCount: update.photos.length,
        communicationReady,
      });

      return {
        id: update.id,
        projectName: update.projectName,
        areaName: trimOrNull(update.selectedAreaName ?? ''),
        notes,
        date: update.date || null,
        photoCount: update.photos.length,
        mentionedIssues,
        mentionedSafety,
        mentionedDecisions,
        blockers,
        nextSteps,
        communicationReady,
        recipientCount,
        sources: [
          {
            type: 'typed-update',
            label: notes ? 'Typed update notes' : 'Saved update',
            recordId: update.id,
            confidence,
            capturedAt: update.date || null,
          },
        ],
        confidence,
      };
    });
}

export function extractIssueEvidence({
  projectName,
  photoEvidence = [],
  userUpdateEvidence = [],
}: {
  projectName?: string | null;
  photoEvidence?: PIEPhotoEvidence[];
  userUpdateEvidence?: PIEUserUpdateEvidence[];
}): PIEIssueEvidence[] {
  const photoIssues = photoEvidence
    .filter(photo => photo.isIssue || photo.category === 'Open Issue')
    .map(photo => ({
      id: `photo-issue-${photo.id}`,
      projectName: photo.projectName,
      areaName: photo.areaName,
      title: photo.actionRequired || photo.caption || 'Open issue from photo',
      status: photo.actionStatus,
      owner: photo.actionOwner,
      dueDate: photo.actionDueDate,
      isOverdue:
        photo.actionStatus !== 'Closed' &&
        Boolean(photo.actionDueDate) &&
        (daysUntilDate(photo.actionDueDate || '') ?? 0) < 0,
      evidenceText: uniqueText([
        photo.caption,
        photo.actionRequired,
        photo.areaName ? `Area: ${photo.areaName}` : null,
      ]),
      sources: photo.sources,
      confidence: photo.confidence,
    }));
  const noteIssues = userUpdateEvidence.flatMap(update =>
    update.mentionedIssues.map((line, index) => ({
      id: `note-issue-${update.id}-${index}`,
      projectName: update.projectName,
      areaName: update.areaName,
      title: line,
      status: 'Mentioned',
      owner: null,
      dueDate: null,
      isOverdue: false,
      evidenceText: [line],
      sources: update.sources,
      confidence: update.confidence,
    })),
  );

  return [...photoIssues, ...noteIssues].filter(item =>
    matchesProject(projectName, item.projectName),
  );
}

export function extractSafetyEvidence({
  projectName,
  photoEvidence = [],
  userUpdateEvidence = [],
}: {
  projectName?: string | null;
  photoEvidence?: PIEPhotoEvidence[];
  userUpdateEvidence?: PIEUserUpdateEvidence[];
}): PIESafetyEvidence[] {
  const photoSafety = photoEvidence
    .filter(photo => photo.isSafety || photo.category === 'Safety Concern')
    .map(photo => ({
      id: `photo-safety-${photo.id}`,
      projectName: photo.projectName,
      areaName: photo.areaName,
      title: photo.actionRequired || photo.caption || 'Safety concern from photo',
      status: photo.actionStatus,
      owner: photo.actionOwner,
      dueDate: photo.actionDueDate,
      isOpen: photo.actionStatus !== 'Closed',
      evidenceText: uniqueText([
        photo.caption,
        photo.actionRequired,
        photo.areaName ? `Area: ${photo.areaName}` : null,
      ]),
      sources: photo.sources,
      confidence: photo.confidence,
    }));
  const noteSafety = userUpdateEvidence.flatMap(update =>
    update.mentionedSafety.map((line, index) => ({
      id: `note-safety-${update.id}-${index}`,
      projectName: update.projectName,
      areaName: update.areaName,
      title: line,
      status: 'Mentioned',
      owner: null,
      dueDate: null,
      isOpen: true,
      evidenceText: [line],
      sources: update.sources,
      confidence: update.confidence,
    })),
  );

  return [...photoSafety, ...noteSafety].filter(item =>
    matchesProject(projectName, item.projectName),
  );
}

export function findEvidenceGaps(evidence: EvidenceSet): PIEvidenceGap[] {
  const gaps: PIEvidenceGap[] = [];

  if (evidence.scheduleEvidence.length === 0) {
    gaps.push(gap({
      evidence,
      id: 'missing-schedule',
      title: 'No schedule evidence',
      summary: 'DAVE does not have schedule items, so milestones, overdue work, and next work are less reliable.',
      source: 'schedule',
      severity: 'high',
      suggestedAction:
        'Import a PDF/CSV schedule or use Demo OCR Schedule for testing.',
    }));
  }

  if (evidence.photoEvidence.length === 0) {
    gaps.push(gap({
      evidence,
      id: 'missing-photos',
      title: 'No photo evidence',
      summary: 'DAVE does not have field photos to verify current conditions.',
      source: 'photo',
      severity: 'medium',
      suggestedAction: 'Capture field photos with captions and action status.',
    }));
  }

  if (!evidence.gpsEvidence.gpsAvailable) {
    gaps.push(gap({
      evidence,
      id: 'missing-gps',
      title: 'GPS unavailable',
      summary: 'DAVE cannot strongly recommend project or area from location evidence.',
      source: 'gps',
      severity: 'medium',
      suggestedAction: 'Capture GPS-backed field evidence or confirm the current area.',
    }));
  }

  if (evidence.userUpdateEvidence.length === 0) {
    gaps.push(gap({
      evidence,
      id: 'missing-user-updates',
      title: 'No typed updates',
      summary: 'DAVE does not have recent user notes to explain what changed.',
      source: 'typed-update',
      severity: 'medium',
      suggestedAction: 'Add a short update note after the next walk or photo capture.',
    }));
  }

  if (evidence.scheduleSummary.needsReviewCount > 0) {
    gaps.push(gap({
      evidence,
      id: 'schedule-needs-review',
      title: 'Schedule items need review',
      summary: `${evidence.scheduleSummary.needsReviewCount} schedule item${evidence.scheduleSummary.needsReviewCount === 1 ? '' : 's'} need project, area, date, or OCR review.`,
      source: 'schedule',
      severity: 'medium',
      suggestedAction: 'Review imported draft schedule items before relying on them.',
    }));
  }

  if (evidence.scheduleEvidence.some(item => !item.owner && !item.contractor)) {
    gaps.push(gap({
      evidence,
      id: 'missing-schedule-owners',
      title: 'Schedule ownership incomplete',
      summary: 'Some schedule work does not have an owner or contractor.',
      source: 'schedule',
      severity: 'medium',
      suggestedAction: 'Add owner or contractor fields to schedule items that need follow-up.',
    }));
  }

  if (evidence.documentEvidence.length === 0) {
    gaps.push(gap({
      evidence,
      id: 'missing-documents',
      title: 'No document context',
      summary: 'DAVE does not have document metadata to connect plans, specs, or schedules to the current status.',
      source: 'document-metadata',
      severity: 'low',
      suggestedAction: 'Attach relevant document metadata when available.',
    }));
  }

  if (evidence.reportEvidence.length === 0) {
    gaps.push(gap({
      evidence,
      id: 'missing-report-history',
      title: 'No report history',
      summary: 'DAVE cannot compare this summary against previous reports.',
      source: 'report-history',
      severity: 'low',
      suggestedAction: 'Generate or save a reviewed report when communication is ready.',
    }));
  }

  return gaps;
}

export function findEvidenceConflicts(
  evidence: EvidenceSet,
): PIEvidenceConflict[] {
  const conflicts: PIEvidenceConflict[] = [];
  const completedScheduleWithOpenIssue = evidence.scheduleEvidence.find(
    schedule =>
      schedule.isComplete &&
      evidence.issueEvidence.some(issue =>
        sameArea(schedule.areaName, issue.areaName) && issue.status !== 'Closed',
      ),
  );

  if (completedScheduleWithOpenIssue) {
    conflicts.push(conflict({
      evidence,
      id: 'complete-work-open-issue',
      title: 'Completed schedule has open issue',
      summary: `${completedScheduleWithOpenIssue.taskName} is marked complete while an issue remains open in the same area.`,
      sources: ['schedule', 'issue', 'photo'],
      severity: 'high',
      suggestedAction: 'Verify whether the issue is resolved before reporting the task complete.',
    }));
  }

  const gpsArea = evidence.gpsEvidence.recommendedArea;
  const recentUpdateArea = evidence.userUpdateEvidence[0]?.areaName;
  if (gpsArea && recentUpdateArea && !sameArea(gpsArea, recentUpdateArea)) {
    conflicts.push(conflict({
      evidence,
      id: 'gps-update-area-mismatch',
      title: 'GPS area differs from update area',
      summary: `GPS suggests ${gpsArea}, but the latest update references ${recentUpdateArea}.`,
      sources: ['gps', 'typed-update', 'project-area'],
      severity: 'medium',
      suggestedAction: 'Confirm the current project area before saving the next update.',
    }));
  }

  const overdueClosedAction = evidence.photoEvidence.find(photo => {
    const days = daysUntilDate(photo.actionDueDate || '');

    return photo.actionStatus === 'Closed' && days !== null && days < 0;
  });
  if (overdueClosedAction) {
    conflicts.push(conflict({
      evidence,
      id: 'closed-photo-action-overdue',
      title: 'Closed action still has overdue date',
      summary: `${overdueClosedAction.actionRequired || overdueClosedAction.caption || 'A photo action'} is closed but still carries an overdue due date.`,
      sources: ['photo'],
      severity: 'low',
      suggestedAction: 'Review the photo action due date or closure status.',
    }));
  }

  return conflicts;
}

export function buildIntelligentSummary(
  fusedEvidence: PIEFusedEvidence,
): PIEIntelligentSummary {
  const summary = fusedEvidence.evidenceFusionSummary;
  const safetyOpenCount = fusedEvidence.safetyEvidence.filter(item => item.isOpen).length;
  const issueOpenCount = fusedEvidence.issueEvidence.filter(
    item => item.status !== 'Closed',
  ).length;
  const scheduleStatus = scheduleStatusSummary(fusedEvidence);
  const hasCriticalConcern =
    safetyOpenCount > 0 ||
    summary.overdueScheduleCount > 0 ||
    fusedEvidence.conflicts.some(item => item.severity === 'critical' || item.severity === 'high');
  const projectStatus = hasCriticalConcern
    ? 'At Risk'
    : summary.gapCount > 0
      ? 'Needs Review'
      : 'On Track';
  const missingInformation = fusedEvidence.gaps
    .slice(0, 5)
    .map(item => item.title);
  const recommendation = recommendationForFusedEvidence(fusedEvidence);

  return {
    projectName: fusedEvidence.projectName,
    generatedAt: fusedEvidence.generatedAt,
    projectStatus,
    whatChanged: whatChangedSummary(fusedEvidence),
    scheduleStatus,
    photoEvidenceSummary:
      fusedEvidence.photoProgressEvidence.length > 0
        ? `${summary.photoCount} photo${summary.photoCount === 1 ? '' : 's'} available; accepted photo progress: ${fusedEvidence.photoProgressEvidence[0].summary}`
        : summary.photoCount === 0
        ? 'No photo evidence is available.'
        : `${summary.photoCount} photo${summary.photoCount === 1 ? '' : 's'} available; ${summary.captionedPhotoCount} captioned and ${summary.photoActionCount} action-linked.`,
    gpsLocationConfidence: fusedEvidence.gpsEvidence.gpsAvailable
      ? `GPS supports ${fusedEvidence.gpsEvidence.recommendedArea || 'the current area'} with ${fusedEvidence.gpsEvidence.confidenceScore}% confidence.`
      : 'GPS is unavailable; DAVE is relying on project, area, schedule, or last activity context.',
    userUpdateSummary:
      summary.userUpdateCount === 0
        ? 'No typed update notes are available.'
        : `${summary.userUpdateCount} update note${summary.userUpdateCount === 1 ? '' : 's'} available with ${fusedEvidence.userUpdateEvidence.filter(item => item.nextSteps.length > 0).length} next-step signal${fusedEvidence.userUpdateEvidence.filter(item => item.nextSteps.length > 0).length === 1 ? '' : 's'}.`,
    risksAndIssues:
      issueOpenCount === 0
        ? 'No open issue evidence is currently detected.'
        : `${issueOpenCount} issue signal${issueOpenCount === 1 ? '' : 's'} need review.`,
    safetySummary:
      safetyOpenCount === 0
        ? 'No open safety concern evidence is currently detected.'
        : `${safetyOpenCount} safety concern${safetyOpenCount === 1 ? '' : 's'} should be reviewed before communication.`,
    missingInformation,
    pieRecommendation: recommendation,
    confidence: summary.confidence,
    trust: summary.trustScore,
    nextAction: nextActionForFusedEvidence(fusedEvidence),
    evidenceSourceSummary: `DAVE fused ${summary.sourceCount} evidence source${summary.sourceCount === 1 ? '' : 's'}: ${summary.sources.join(', ') || 'none'}.`,
  };
}

function buildEvidenceFusionSummary(
  fusedEvidence: EvidenceSet & {
    gaps: PIEvidenceGap[];
    conflicts: PIEvidenceConflict[];
  },
): PIEEvidenceFusionSummary {
  const photoActionCount = fusedEvidence.photoEvidence.filter(
    photo => photo.needsAction,
  ).length;
  const captionedPhotoCount = fusedEvidence.photoEvidence.filter(
    photo => Boolean(photo.caption),
  ).length;
  const sourceCount = fusedEvidence.sources.length;
  const gapPenalty = fusedEvidence.gaps.reduce(
    (sum, item) => sum + severityPenalty(item.severity),
    0,
  );
  const conflictPenalty = fusedEvidence.conflicts.reduce(
    (sum, item) => sum + severityPenalty(item.severity) + 4,
    0,
  );
  const coverageScore =
    (fusedEvidence.scheduleEvidence.length > 0 ? 22 : 0) +
    (fusedEvidence.photoEvidence.length > 0 ? 18 : 0) +
    (fusedEvidence.gpsEvidence.confidenceScore * 0.18) +
    (fusedEvidence.userUpdateEvidence.length > 0 ? 18 : 0) +
    (fusedEvidence.documentEvidence.length > 0 ? 8 : 0) +
    (fusedEvidence.reportEvidence.length > 0 ? 6 : 0) +
    (fusedEvidence.syncEvidence.length > 0 ? 6 : 0);
  const trustScore = clamp(
    Math.round(coverageScore - gapPenalty - conflictPenalty),
    0,
    100,
  );

  return {
    projectName: fusedEvidence.projectName,
    generatedAt: fusedEvidence.generatedAt,
    sourceCount,
    sources: fusedEvidence.sources,
    scheduleItemCount: fusedEvidence.scheduleEvidence.length,
    milestoneCount: fusedEvidence.scheduleSummary.milestoneCount,
    overdueScheduleCount: fusedEvidence.scheduleSummary.overdueCount,
    upcoming7Count: fusedEvidence.scheduleSummary.upcoming7Count,
    upcoming14Count: fusedEvidence.scheduleSummary.upcoming14Count,
    upcoming30Count: fusedEvidence.scheduleSummary.upcoming30Count,
    scheduleNeedsReviewCount: fusedEvidence.scheduleSummary.needsReviewCount,
    photoCount: fusedEvidence.photoEvidence.length,
    captionedPhotoCount,
    photoActionCount,
    gpsAvailable: fusedEvidence.gpsEvidence.gpsAvailable,
    gpsConfidenceScore: fusedEvidence.gpsEvidence.confidenceScore,
    userUpdateCount: fusedEvidence.userUpdateEvidence.length,
    issueCount: fusedEvidence.issueEvidence.length,
    safetyCount: fusedEvidence.safetyEvidence.length,
    documentCount: fusedEvidence.documentEvidence.length,
    reportHistoryCount: fusedEvidence.reportEvidence.length,
    gapCount: fusedEvidence.gaps.length,
    conflictCount: fusedEvidence.conflicts.length,
    confidence: confidenceFromScore(trustScore),
    trustScore,
    summary: `DAVE fused schedule, photos, GPS, and updates into a ${confidenceFromScore(trustScore)}-confidence evidence summary.`,
  };
}

function extractDocumentEvidence(
  projectName: string,
  documents: ReferenceDocument[],
): PIEEvidenceSource[] {
  return documents
    .filter(document =>
      matchesDocumentProject(projectName, document),
    )
    .map(document => ({
      type: 'document-metadata',
      label: document.name || document.originalFileName || 'Reference document',
      recordId: document.id,
      confidence: document.isCurrent ? 'high' : 'medium',
      capturedAt: document.importedAt,
    }));
}

function extractReportEvidence(
  projectName: string,
  reportHistory: ProjectReportHistoryMetadata[],
): PIEEvidenceSource[] {
  return reportHistory
    .filter(report => matchesProject(projectName, report.projectName || projectName))
    .map(report => ({
      type: 'report-history',
      label: report.title || report.reportType || 'Project report',
      recordId: report.id,
      confidence: report.generatedAt ? 'high' : 'medium',
      capturedAt: report.generatedAt || null,
    }));
}

function extractSyncEvidence(
  syncMetadata: ProjectSyncFreshnessMetadata | null,
  now: Date,
): PIEEvidenceSource[] {
  if (!syncMetadata) return [];

  return [
    {
      type: 'sync-cloud',
      label: syncMetadata.message || 'Sync metadata',
      recordId: null,
      confidence:
        (syncMetadata.conflicts ?? 0) > 0
          ? 'low'
          : syncMetadata.lastSyncAt
            ? 'high'
            : 'medium',
      capturedAt: syncMetadata.checkedAt || syncMetadata.lastSyncAt || now.toISOString(),
    },
  ];
}

function collectSources(evidence: EvidenceSet): PIEEvidenceSourceType[] {
  return uniqueText([
    evidence.scheduleEvidence.length > 0 ? 'schedule' : null,
    evidence.photoEvidence.length > 0 ? 'photo' : null,
    evidence.photoProgressEvidence.length > 0 ? 'photo-progress' : null,
    evidence.gpsEvidence.gpsAvailable ? 'gps' : null,
    evidence.userUpdateEvidence.length > 0 ? 'typed-update' : null,
    evidence.issueEvidence.length > 0 ? 'issue' : null,
    evidence.safetyEvidence.length > 0 ? 'safety' : null,
    evidence.documentEvidence.length > 0 ? 'document-metadata' : null,
    evidence.reportEvidence.length > 0 ? 'report-history' : null,
    evidence.syncEvidence.length > 0 ? 'sync-cloud' : null,
  ]) as PIEEvidenceSourceType[];
}

function resolveProjectName({
  projectName,
  projectNames,
  updates,
  currentUpdate,
  scheduleItems,
}: {
  projectName?: string | null;
  projectNames: string[];
  updates: ProjectUpdate[];
  currentUpdate: ProjectUpdate | null;
  scheduleItems: ScheduleItem[];
}) {
  return (
    trimOrNull(projectName ?? '') ||
    trimOrNull(currentUpdate?.projectName ?? '') ||
    mostCommon(updates.map(update => update.projectName)) ||
    mostCommon(scheduleItems.map(item => item.projectName)) ||
    projectNames.find(name => name.trim()) ||
    'Unassigned Project'
  );
}

function relatedUpdates(
  projectName: string,
  updates: ProjectUpdate[],
  currentUpdate: ProjectUpdate | null,
) {
  const saved = updates.filter(update => matchesProject(projectName, update.projectName));

  if (
    currentUpdate &&
    matchesProject(projectName, currentUpdate.projectName) &&
    !saved.some(update => update.id === currentUpdate.id)
  ) {
    return [currentUpdate, ...saved];
  }

  return saved;
}

function scheduleSourceType(importedFrom: string | null): PIEEvidenceSourceType {
  const value = (importedFrom || '').toLowerCase();

  if (value.includes('demo')) return 'demo-ocr';
  if (value.includes('ocr') || value.includes('ai')) return 'ai-ocr';
  if (value.includes('pdf')) return 'pdf-text';

  return 'schedule';
}

function scheduleConfidence(
  item: ScheduleItem,
  needsReview: boolean,
): ProjectConfidenceLevel {
  if (needsReview) return 'low';
  if (
    item.projectName.trim() &&
    item.locationName.trim() &&
    item.finishDate.trim() &&
    (item.owner.trim() || item.contractor.trim())
  ) {
    return 'high';
  }

  return 'medium';
}

function scheduleEvidenceRank(item: PIEScheduleEvidence) {
  return (
    (item.isOverdue ? 50 : 0) +
    (item.isUpcoming7 ? 35 : 0) +
    (item.isUpcoming14 ? 25 : 0) +
    (item.isUpcoming30 ? 15 : 0) +
    (item.priority === 'High' ? 20 : 0) +
    (item.status === 'Waiting' ? 20 : 0) +
    (item.isMilestone ? 10 : 0)
  );
}

function photoConfidence({
  caption,
  areaName,
  hasGps,
  needsAction,
}: {
  caption: string | null;
  areaName: string | null;
  hasGps: boolean;
  needsAction: boolean;
}): ProjectConfidenceLevel {
  const score =
    (caption ? 30 : 0) +
    (areaName ? 25 : 0) +
    (hasGps ? 25 : 0) +
    (needsAction ? 20 : 10);

  return confidenceFromScore(score);
}

function updateConfidence({
  notes,
  areaName,
  photoCount,
  communicationReady,
}: {
  notes: string | null;
  areaName: string | null;
  photoCount: number;
  communicationReady: boolean;
}): ProjectConfidenceLevel {
  const score =
    (notes ? 35 : 0) +
    (areaName ? 25 : 0) +
    Math.min(20, photoCount * 5) +
    (communicationReady ? 20 : 0);

  return confidenceFromScore(score);
}

function gpsConfidenceScore({
  gpsAvailable,
  hasSelectedArea,
  hasNearestArea,
  withinMappedArea,
  hasScheduleArea,
}: {
  gpsAvailable: boolean;
  hasSelectedArea: boolean;
  hasNearestArea: boolean;
  withinMappedArea: boolean;
  hasScheduleArea: boolean;
}) {
  if (!gpsAvailable) {
    return hasSelectedArea ? 65 : hasScheduleArea ? 55 : 25;
  }

  return clamp(
    45 +
      (hasSelectedArea ? 20 : 0) +
      (hasNearestArea ? 15 : 0) +
      (withinMappedArea ? 20 : 0) +
      (hasScheduleArea ? 8 : 0),
    0,
    100,
  );
}

function gap({
  evidence,
  id,
  title,
  summary,
  source,
  severity,
  suggestedAction,
}: {
  evidence: EvidenceSet;
  id: string;
  title: string;
  summary: string;
  source: PIEEvidenceSourceType;
  severity: PIEvidenceGap['severity'];
  suggestedAction: string;
}): PIEvidenceGap {
  return {
    id: `pie-evidence-gap-${id}`,
    projectName: evidence.projectName,
    title,
    summary,
    source,
    severity,
    confidence: severity === 'critical' || severity === 'high' ? 'high' : 'medium',
    suggestedAction,
  };
}

function conflict({
  evidence,
  id,
  title,
  summary,
  sources,
  severity,
  suggestedAction,
}: {
  evidence: EvidenceSet;
  id: string;
  title: string;
  summary: string;
  sources: PIEEvidenceSourceType[];
  severity: PIEvidenceConflict['severity'];
  suggestedAction: string;
}): PIEvidenceConflict {
  return {
    id: `pie-evidence-conflict-${id}`,
    projectName: evidence.projectName,
    title,
    summary,
    sources,
    severity,
    confidence: severity === 'critical' || severity === 'high' ? 'high' : 'medium',
    suggestedAction,
  };
}

function scheduleStatusSummary(fusedEvidence: PIEFusedEvidence) {
  const summary = fusedEvidence.evidenceFusionSummary;

  if (summary.scheduleItemCount === 0) {
    return 'No schedule evidence is available.';
  }
  if (summary.overdueScheduleCount > 0) {
    return `${summary.overdueScheduleCount} overdue schedule item${summary.overdueScheduleCount === 1 ? '' : 's'} need review.`;
  }
  if (summary.upcoming7Count > 0) {
    return `${summary.upcoming7Count} schedule item${summary.upcoming7Count === 1 ? '' : 's'} due in the next 7 days.`;
  }
  if (summary.upcoming30Count > 0) {
    return `${summary.upcoming30Count} schedule item${summary.upcoming30Count === 1 ? '' : 's'} due in the next 30 days.`;
  }

  return 'No urgent schedule concern is detected from imported items.';
}

function whatChangedSummary(fusedEvidence: PIEFusedEvidence) {
  const latestUpdate = fusedEvidence.userUpdateEvidence[0];
  const latestPhoto = fusedEvidence.photoEvidence[0];
  const nextSchedule = fusedEvidence.scheduleEvidence.find(
    item => item.isOverdue || item.isUpcoming7 || item.isUpcoming14,
  );

  return uniqueText([
    latestUpdate?.notes
      ? `Latest update: ${truncate(latestUpdate.notes, 140)}`
      : null,
    latestPhoto?.caption
      ? `Latest photo: ${truncate(latestPhoto.caption, 100)}`
      : null,
    nextSchedule
      ? `Schedule focus: ${nextSchedule.taskName} (${nextSchedule.dueLabel}).`
      : null,
  ]).join(' ') || 'DAVE does not see a recent change from current evidence.';
}

function recommendationForFusedEvidence(fusedEvidence: PIEFusedEvidence) {
  if (fusedEvidence.safetyEvidence.some(item => item.isOpen)) {
    return 'Review the open safety concern before preparing communication.';
  }
  if (fusedEvidence.scheduleSummary.overdueCount > 0) {
    return 'Review overdue schedule items and confirm recovery action.';
  }
  if (fusedEvidence.conflicts.length > 0) {
    return 'Resolve the evidence conflict before relying on the summary.';
  }
  if (!fusedEvidence.gpsEvidence.gpsAvailable) {
    return 'Confirm project and area context before the next Project Walk.';
  }
  if (fusedEvidence.photoEvidence.length === 0) {
    return 'Capture current field photos to strengthen DAVE confidence.';
  }
  if (fusedEvidence.userUpdateEvidence.length === 0) {
    return 'Add a concise typed update so DAVE can explain what changed.';
  }

  return 'Continue monitoring and review DAVE recommendations before acting.';
}

function nextActionForFusedEvidence(fusedEvidence: PIEFusedEvidence) {
  if (fusedEvidence.safetyEvidence.some(item => item.isOpen)) {
    return 'Review safety concern';
  }
  if (fusedEvidence.scheduleSummary.overdueCount > 0) {
    return 'Review overdue schedule';
  }
  if (fusedEvidence.scheduleSummary.needsReviewCount > 0) {
    return 'Review imported schedule items';
  }
  if (fusedEvidence.photoEvidence.length === 0) {
    return 'Capture field photos';
  }
  if (fusedEvidence.userUpdateEvidence.length === 0) {
    return 'Add update notes';
  }

  return 'Continue monitoring';
}

function emptyIntelligentSummary(
  projectName: string,
  generatedAt: string,
): PIEIntelligentSummary {
  return {
    projectName,
    generatedAt,
    projectStatus: 'Unknown',
    whatChanged: 'No fused evidence has been analyzed yet.',
    scheduleStatus: 'No schedule evidence is available.',
    photoEvidenceSummary: 'No photo evidence is available.',
    gpsLocationConfidence: 'GPS evidence is unavailable.',
    userUpdateSummary: 'No typed updates are available.',
    risksAndIssues: 'No issue evidence is available.',
    safetySummary: 'No safety evidence is available.',
    missingInformation: [],
    pieRecommendation: 'Capture project evidence.',
    confidence: 'low',
    trust: 0,
    nextAction: 'Capture project evidence',
    evidenceSourceSummary: 'No evidence sources are available.',
  };
}

function nearestArea(
  latitude: number,
  longitude: number,
  areas: ProjectArea[],
) {
  const candidates = areas
    .map(area => {
      const distanceFeet = distanceInFeet(
        latitude,
        longitude,
        area.latitude,
        area.longitude,
      );

      return {
        area,
        distanceFeet,
        withinRadius: distanceFeet <= area.radiusFeet,
      };
    })
    .sort((left, right) => left.distanceFeet - right.distanceFeet);

  return candidates[0] ?? null;
}

function distanceInFeet(
  startLatitude: number,
  startLongitude: number,
  endLatitude: number,
  endLongitude: number,
) {
  const earthRadiusFeet = 20925524.9;
  const deltaLatitude = toRadians(endLatitude - startLatitude);
  const deltaLongitude = toRadians(endLongitude - startLongitude);
  const startRadians = toRadians(startLatitude);
  const endRadians = toRadians(endLatitude);
  const a =
    Math.sin(deltaLatitude / 2) ** 2 +
    Math.cos(startRadians) *
      Math.cos(endRadians) *
      Math.sin(deltaLongitude / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return earthRadiusFeet * c;
}

function matchesDocumentProject(
  projectName: string,
  document: ReferenceDocument,
) {
  const text = `${document.name} ${document.originalFileName} ${document.category} ${document.notes}`;

  return includesAny(text, [projectName]) ||
    document.category.toLowerCase() === 'schedules' ||
    projectName === 'Unassigned Project';
}

function matchesProject(projectName: string | null | undefined, value: string | null | undefined) {
  if (!projectName || projectName === 'Unassigned Project') return true;

  return normalizedKey(projectName) === normalizedKey(value || '');
}

function sameArea(left: string | null | undefined, right: string | null | undefined) {
  if (!left || !right) return false;

  return normalizedKey(left) === normalizedKey(right);
}

function extractMatchingLines(
  value: string | null,
  patterns: string[],
): string[] {
  if (!value) return [];

  return value
    .split(/\n|\.|;/g)
    .map(line => line.trim())
    .filter(Boolean)
    .filter(line => includesAny(line, patterns))
    .slice(0, 5);
}

function includesAny(value: string, patterns: string[]) {
  const lower = value.toLowerCase();

  return patterns.some(pattern => lower.includes(pattern.toLowerCase()));
}

function mostCommon(values: Array<string | null | undefined>) {
  const counts = new Map<string, { value: string; count: number }>();

  values
    .map(value => trimOrNull(value || ''))
    .filter((value): value is string => Boolean(value))
    .forEach(value => {
      const key = normalizedKey(value);
      const current = counts.get(key) || { value, count: 0 };
      current.count += 1;
      counts.set(key, current);
    });

  return Array.from(counts.values()).sort((left, right) => right.count - left.count)[0]?.value ?? null;
}

function timestampValue(value: string | null | undefined) {
  if (!value) return 0;
  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

function trimOrNull(value: string | null | undefined) {
  const trimmed = (value || '').trim();

  return trimmed || null;
}

function uniqueText(values: Array<string | null | undefined>) {
  const seen = new Set<string>();
  const results: string[] = [];

  values.forEach(value => {
    const trimmed = (value || '').trim();
    const key = normalizedKey(trimmed);

    if (!trimmed || seen.has(key)) return;

    seen.add(key);
    results.push(trimmed);
  });

  return results;
}

function confidenceFromScore(score: number): ProjectConfidenceLevel {
  if (score >= 78) return 'high';
  if (score >= 50) return 'medium';

  return 'low';
}

function severityPenalty(severity: PIEvidenceGap['severity']) {
  if (severity === 'critical') return 24;
  if (severity === 'high') return 18;
  if (severity === 'medium') return 10;

  return 5;
}

function truncate(value: string, limit: number) {
  return value.length <= limit ? value : `${value.slice(0, limit - 3)}...`;
}

function normalizedKey(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function toRadians(value: number) {
  return (value * Math.PI) / 180;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
