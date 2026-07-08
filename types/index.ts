export type Screen =
  | 'Home'
  | 'SelectProject'
  | 'AddPhotos'
  | 'BuildUpdate'
  | 'Projects'
  | 'ProjectAssistant'
  | 'SavedUpdates'
  | 'Contacts'
  | 'Diagnostics'
  | 'ReferenceDocuments'
  | 'Schedule'
  | 'Upcoming'
  | 'MilestoneTracking'
  | 'CriticalPath'
  | 'DelayAnalysis'
  | 'ContractorPerformance'
  | 'AIProjectCoach'
  | 'AIExecutiveBrief'
  | 'ProjectHealthDashboard'
  | 'WeeklyExecutiveReport'
  | 'ExecutiveKPIDashboard'
  | 'ConstructionTimeline'
  | 'ProjectRiskMatrix'
  | 'PortfolioDashboard';

export type PhotoCategory =
  | 'Open Issue'
  | 'Safety Concern'
  | 'Update';

export type ActionStatus =
  | 'Open'
  | 'In Progress'
  | 'Waiting'
  | 'Closed';

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
  selectedAreaId?: string | null;
  selectedAreaName?: string | null;
  gpsLatitude?: number | null;
  gpsLongitude?: number | null;
  gpsAccuracy?: number | null;
  distanceFromSelectedAreaFeet?: number | null;
  locationCapturedAt?: string | null;
  photoIntelligence?: PhotoIntelligenceDisplayState | null;
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
  selectedAreaId?: string | null;
  selectedAreaName?: string | null;
  gpsLatitude?: number | null;
  gpsLongitude?: number | null;
  gpsAccuracy?: number | null;
  distanceFromSelectedAreaFeet?: number | null;
  locationCapturedAt?: string | null;
  pieStartedAt?: string | null;
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

export type ScheduleItem = {
  id: string;
  projectName: string;
  locationName: string;
  taskName: string;
  startDate: string;
  finishDate: string;
  milestone: string;
  owner: string;
  contractor: string;
  percentComplete: number;
  priority: SchedulePriority;
  status: ScheduleStatus;
  notes: string;
  importedFrom?: string | null;
  importedAt?: string | null;
  createdAt: string;
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
