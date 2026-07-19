export type PhotoCategory =
  | 'Open Issue'
  | 'Safety Concern'
  | 'Update';

export type ActionStatus =
  | 'Open'
  | 'In Progress'
  | 'Waiting'
  | 'Closed';

export type PhotoContinuityAnchor = {
  referencePhotoId: string;
  referencePhotoUri?: string | null;
  realityObjectId?: string | null;
  projectName: string;
  areaName?: string | null;
  instruction: string;
  alignmentGuide: string;
  confirmedAt: string;
};

export type UpdatePhoto = {
  id: string;
  uri: string;
  caption: string;
  category: PhotoCategory;
  actionRequired: string;
  actionOwner: string;
  actionDueDate: string;
  actionStatus: ActionStatus;
  fileName?: string | null;
  mimeType?: string | null;
  cloudStoragePath?: string | null;
  cloudRecoveredAt?: string | null;
  cloudRecoveryStatus?: 'cached' | 'signed_url' | 'unavailable' | null;
  cloudSignedUrlExpiresAt?: string | null;
  continuityAnchor?: PhotoContinuityAnchor | null;
  selectedAreaId?: string | null;
  selectedAreaName?: string | null;
  gpsLatitude?: number | null;
  gpsLongitude?: number | null;
  gpsAccuracy?: number | null;
  distanceFromSelectedAreaFeet?: number | null;
  locationCapturedAt?: string | null;
  photoIntelligence?: PIEPhotoIntelligenceDisplayState | null;
};

export type PhotoIntelligenceStatus =
  | 'analyzing'
  | 'analysis_complete'
  | 'completed_with_limitations'
  | 'comparison_unavailable'
  | 'analysis_failed_retry'
  | 'no_suitable_prior_photo';

export type PhotoIntelligenceDisplayState = {
  status: PhotoIntelligenceStatus;
  title: string;
  summary: string;
  visibleChange: string | null;
  location: string | null;
  comparisonConfidence: string | null;
  captureLimitations: string[];
  projectProgress: 'supported' | 'unsupported' | 'unable_to_determine';
  repeatPhotoGuidance: string | null;
  authorityMessage: string;
  currentObservation?: string | null;
  changedFromPrior?: string | null;
  additions?: string[];
  removals?: string[];
  possibleProgress?: string | null;
  possibleConcerns?: string[];
  priorUpdateUsed?: string | null;
  requestId?: string | null;
  comparisonId?: string | null;
  analysisRequestId?: string | null;
  currentPhotoAssetId?: string | null;
  priorPhotoAssetId?: string | null;
  currentEvidenceId?: string | null;
  priorEvidenceId?: string | null;
  semanticComparisonResultId?: string | null;
  provenance?: 'visual_only' | 'caption_only' | 'visual_and_caption' | 'inferred' | 'unsupported';
  diagnostics?: {
    currentPhotoAssetId: string | null;
    priorPhotoAssetId: string | null;
    currentEvidenceId: string | null;
    priorEvidenceId: string | null;
    currentStoragePathHash: string | null;
    priorStoragePathHash: string | null;
    currentImageByteSize: number | null;
    priorImageByteSize: number | null;
    currentImageSha256: string | null;
    priorImageSha256: string | null;
    currentPhotoPrepStatus?: 'not_checked' | 'ready' | 'failed';
    priorPhotoPrepStatus?: 'not_checked' | 'ready' | 'failed';
    currentPhotoPrepReason?: string | null;
    priorPhotoPrepReason?: string | null;
    currentPhotoReadable?: boolean | null;
    priorPhotoReadable?: boolean | null;
    currentPhotoUploadReady?: boolean | null;
    priorPhotoUploadReady?: boolean | null;
    usablePriorCandidateFound?: boolean | null;
    skippedPriorCandidateCount?: number;
    imagePrepareFailureReason?: string | null;
    imageHashesDifferent: boolean | null;
    signedUrlsGenerated: boolean | null;
    providerInvocationId: string | null;
    providerResponseStatus: string | null;
    analysisRequestId: string | null;
    semanticComparisonResultId: string | null;
    selectedPriorPhotoId: string | null;
    selectionCandidateCount: number;
    selectedPriorReason: string | null;
    rejectedPriorReasons: string[];
    resultPairMatchesRequestedPair: boolean | null;
    resultProvenance: 'visual_only' | 'caption_only' | 'visual_and_caption' | 'inferred' | 'unsupported';
    executedStages: string[];
  } | null;
  updatedAt: string;
};

export type RecipientSelection = {
  contactIds: string[];
};

export type ProjectUpdate = {
  id: string;
  projectName: string;
  date: string;
  photos: UpdatePhoto[];
  notes: string;
  recipients: RecipientSelection;
  scheduleItemId?: string | null;
  scheduleTaskName?: string | null;
  scheduleProjectName?: string | null;
  selectedAreaId?: string | null;
  selectedAreaName?: string | null;
  gpsLatitude?: number | null;
  gpsLongitude?: number | null;
  gpsAccuracy?: number | null;
  distanceFromSelectedAreaFeet?: number | null;
  locationCapturedAt?: string | null;
  pieStartedAt?: string | null;
  pieStatus?:
    | 'not_started'
    | 'analyzing'
    | 'complete'
    | 'no_prior_photo'
    | 'no_visual_comparison'
    | 'failed'
    | 'taking_longer';
  pieCompletedAt?: string | null;
  pieSuggestedNote?: string | null;
  pieSuggestedNoteAccepted?: boolean;
  status?: 'draft' | 'ready_to_send' | 'queued' | 'sent' | 'failed';
  workflowTimestamps?: {
    startedAt?: string;
    cameraActionStartedAt?: string;
    firstPhotoAddedAt?: string;
    reviewOpenedAt?: string;
    sendTappedAt?: string;
    sendResolvedAt?: string;
  };
};

export type ProjectContact = {
  id: string;
  name: string;
  email: string;
  phone: string;
  emails?: string[];
  phones?: string[];
  selectedEmail?: string | null;
  selectedPhone?: string | null;
};

export type ContactBook = {
  contacts: ProjectContact[];
};

export type ProjectArea = {
  id: string;
  name: string;
  building?: string;
  latitude: number;
  longitude: number;
  radiusFeet: number;
  locationCapturedAt?: string | null;
  /** Last user-authored change to area metadata or GPS. */
  updatedAt?: string | null;
};

export type DAVESyncTombstoneEntity =
  | 'project_area'
  | 'schedule_item'
  | 'reference_document';

export type DAVESyncTombstone = {
  entityType: DAVESyncTombstoneEntity;
  recordId: string;
  deletedAt: string;
};

export type AreaSuggestion = {
  area: ProjectArea;
  distanceFeet: number;
  withinRadius: boolean;
};

export type StoredDraft = {
  draft: ProjectUpdate;
  savedAt: string;
};

export type ReferenceDocument = {
  id: string;
  name: string;
  originalFileName: string;
  uri: string;
  mimeType?: string | null;
  category: string;
  notes: string;
  isCurrent: boolean;
  importedAt: string;
  projectId?: string | null;
  projectName?: string | null;
  /** Immutable identity of the import review that created this document. */
  importBatchId?: string | null;
};

export type ProjectStats = {
  updates: number;
  photos: number;
  openActions: number;
  overdueActions: number;
  dueThisWeek: number;
  lastUpdate?: string;
};

export type ScheduleStatus =
  | 'Not Started'
  | 'In Progress'
  | 'Waiting'
  | 'Complete';

export type SchedulePriority = 'Low' | 'Medium' | 'High';

export type DAVECompletionVerificationStatus =
  | 'reported_complete'
  | 'evidence_supported'
  | 'pm_verified'
  | 'rejected'
  | 'conflicting_evidence';

export type DAVECompletionEvidenceKind =
  | 'email'
  | 'message_screenshot'
  | 'photo'
  | 'pm_confirmation'
  | 'pm_note';

export type DAVECompletionEvidence = {
  id: string;
  kind: DAVECompletionEvidenceKind;
  sourceRecordId: string;
  sourceName: string;
  summary: string;
  recordedAt: string;
};

export type DAVECompletionVerification = {
  status: DAVECompletionVerificationStatus;
  reportedAt: string;
  reportedBy: string | null;
  priorScheduleStatus: ScheduleStatus;
  priorPercentComplete: number;
  verifiedAt: string | null;
  verifiedBy: string | null;
  verificationNote: string | null;
  evidence: DAVECompletionEvidence[];
};

export type ScheduleItem = {
  id: string;
  scheduleProjectName?: string | null;
  projectTimeZone?: string | null;
  projectName: string;
  locationName: string;
  taskName: string;
  startDate: string;
  finishDate: string;
  milestone: string;
  owner: string;
  contractor: string;
  durationDays?: number | null;
  percentComplete: number;
  progressSource?: 'project_manager' | 'schedule_import' | null;
  progressConfirmedAt?: string | null;
  progressConfirmedBy?: string | null;
  priority: SchedulePriority;
  status: ScheduleStatus;
  notes: string;
  importedFrom?: string | null;
  importedAt?: string | null;
  /** Immutable import identity; filenames are display data only. */
  importBatchId?: string | null;
  /** Exact source within a multi-document import, when determinable. */
  sourceDocumentId?: string | null;
  completionVerification?: DAVECompletionVerification | null;
  createdAt: string;
  /** Last user-authored task change. Imported legacy rows may omit it. */
  updatedAt?: string | null;
};

export const EMPTY_PROJECT_STATS: ProjectStats = {
  updates: 0,
  photos: 0,
  openActions: 0,
  overdueActions: 0,
  dueThisWeek: 0,
};

export const REFERENCE_DOCUMENT_CATEGORIES = [
  'Site Plans',
  'Building 2321',
  'Building 2375',
  'H2 Room',
  'Fire Protection',
  'Civil',
  'Electrical',
  'Mechanical',
  'Schedules',
  'Other',
];

export const SCHEDULE_STATUSES: ScheduleStatus[] = [
  'Not Started',
  'In Progress',
  'Waiting',
  'Complete',
];

export const SCHEDULE_PRIORITIES: SchedulePriority[] = [
  'Low',
  'Medium',
  'High',
];
import type { PIEPhotoIntelligenceDisplayState } from '../services/PIEPhotoVisionMobileWorkflow';
