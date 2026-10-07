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
  /** Short-lived transformed image used only for list/grid presentation. */
  cloudPreviewUri?: string | null;
  cloudPreviewSignedUrlExpiresAt?: string | null;
  continuityAnchor?: PhotoContinuityAnchor | null;
  /** Chosen from the photo library: taken at an unknown place, so it never takes the draft's GPS fix. */
  pickedFromLibrary?: boolean;
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
  /** Immutable cloud project identity. Display names are never write authority. */
  projectId?: string | null;
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
  /**
   * Project ownership for new area records. Legacy records may omit this and
   * are scoped conservatively from their existing task/update links.
   */
  projectName?: string | null;
  building?: string;
  latitude: number;
  longitude: number;
  radiusFeet: number;
  locationCapturedAt?: string | null;
  /** Accuracy of the saved point in meters, as the phone reported it. Older points have none. */
  locationAccuracyMeters?: number | null;
  /** locationCapturedAt of the point that accuracy belongs to; any other point has no known precision. */
  locationAccuracyCapturedAt?: string | null;
  /** Last user-authored change to area metadata or GPS. */
  updatedAt?: string | null;
};

export type DAVESyncTombstoneEntity =
  | 'project'
  | 'project_update'
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
  /** Projects explicitly covered when one shared document applies to more than one project. */
  projectNames?: string[];
  /**
   * Projects a current combined schedule no longer speaks for, because a
   * schedule for them was made current (owner answer Q15, 30 Sep 2026).
   * Written and cleared only by the cloud's activation call; the project
   * list itself is never trimmed.
   */
  retiredForProjectNames?: string[];
  /**
   * How a schedule is used, chosen at import review (owner answer Q22, 30 Sep
   * 2026): 'lookahead' adds to the master schedule of its projects and is in
   * effect for as long as it is kept; 'master' (or none, every schedule
   * imported before) is a full schedule that replaces the one before it.
   */
  scheduleRole?: 'master' | 'lookahead' | null;
  /** Immutable identity of the import review that created this document. */
  importBatchId?: string | null;
  /** Protected cloud object path. Cloud-only documents may not have a local uri. */
  storagePath?: string | null;
  /** Original-file provider retained so every device can offer an honest open action. */
  sourceProvider?: 'supabase_storage' | 'google_drive' | null;
  /** Immutable Google Drive identity. Vitruvius never persists the short-lived access token. */
  externalSource?: Readonly<{
    provider: 'google_drive';
    fileId: string;
    name: string;
    mimeType: string;
    sizeBytes: number;
    modifiedTime: string | null;
    revisionId: string | null;
    md5Checksum: string | null;
    resourceKey: string | null;
    webViewLink: string | null;
  }> | null;
  sizeBytes?: number | null;
  /** SHA-256 of the exact uploaded bytes, used to verify cloud recovery. */
  contentSha256?: string | null;
  /** Local business-data revision used to order cross-device changes. */
  updatedAt?: string | null;
  /** Cloud row revision. Transport metadata only; never persisted inside document_data. */
  cloudUpdatedAt?: string | null;
  /** This device's record of the cloud copy's shared details when it last merged it; never sent (A7 pass 6 L1). */
  cloudDetailsSeen?: string | null;
  /** Browser upload/version metadata retained when mobile refreshes the shared record. */
  webFileFingerprint?: string | null;
  webVersionGroupId?: string | null;
  webContentReview?: string | null;
  webReport?: unknown;
  /** Drawing-control metadata. Retained on the shared record for every device. */
  drawingNumber?: string | null;
  drawingRevision?: string | null;
  drawingDiscipline?: string | null;
  drawingStatus?: 'Draft' | 'For Review' | 'For Construction' | 'As-Built' | 'Superseded' | null;
  drawingIssuedAt?: string | null;
  /** Searchable text extracted from the immutable source bytes. */
  extractedText?: string | null;
  extractionStatus?:
    | 'pending'
    | 'complete'
    | 'partial'
    | 'needs_ocr'
    | 'failed'
    | 'not_supported'
    | null;
  extractionMethod?: 'embedded_text' | 'local_ocr' | 'embedded_text_and_ocr' | null;
  extractionLimitations?: string[];
  documentIntelligenceVersion?:
    | 'ecos-document-intelligence/1.0'
    | 'ecos-document-intelligence/1.1'
    | 'ecos-document-intelligence/1.2'
    | 'ecos-document-intelligence/1.3'
    | 'ecos-document-intelligence/1.4'
    | 'ecos-document-intelligence/1.5'
    | 'ecos-document-intelligence/2.0'
    | null;
  /** Visual extraction/assurance pipeline version, independent of page-index schema. */
  documentVisualIndexVersion?: 'ecos-visual-index/3.0' | null;
  /** Database-issued proof that the current source passed the exact transactional index gate. */
  ecosVerifiedIndexCommitVersion?: 'ecos-verified-index-commit/1.0' | null;
  ecosVerifiedIndexCommittedAt?: string | null;
  ecosVerifiedIndexCommittedSha256?: string | null;
  ecosVerifiedIndexCommittedPageCount?: number | null;
  indexedAt?: string | null;
  /** Total source pages discovered before page limits or OCR limits were applied. */
  sourcePageCount?: number | null;
  /** Source pages containing searchable text or trustworthy OCR regions. */
  searchablePageCount?: number | null;
  /** Pages whose searchable content required OCR. */
  ocrPageCount?: number | null;
  /** Average confidence across indexed text regions, from 0 through 1. */
  extractionAverageConfidence?: number | null;
  /** Source hash that the current index was created from. */
  indexedContentSha256?: string | null;
  /** Optional page/region index used for exact citations and automatic report excerpts. */
  extractedPages?: ReferenceDocumentExtractedPage[];
  /** Customer-safe status mirrored from the Vitruvius-operated background indexer. */
  ecosHostedIndexStatus?:
    | 'Waiting'
    | 'Preparing'
    | 'Prepared'
    | 'Prepared with limitations'
    | 'Ready for ECOS'
    | 'Ready with limitations'
    | 'Needs Review'
    | 'Reconnect Files'
    | 'Temporarily Unavailable'
    | null;
  ecosHostedIndexProgressPercent?: number | null;
  /** Customer-safe explanation returned by the hosted preparation boundary. */
  ecosHostedIndexCustomerMessage?: string | null;
  /** Number of accepted pages whose Assurance result retained review limitations. */
  ecosHostedIndexLimitationCount?: number | null;
  ecosHostedIndexSupportReference?: string | null;
  ecosHostedIndexEvidenceVersion?: string | null;
  ecosHostedIndexUpdatedAt?: string | null;
};

export type ReferenceDocumentRegionEvidence = {
  id?: string | null;
  text?: string | null;
  source?: string | null;
  confidence?: number | null;
  bounds?: {
    x: number;
    y: number;
    width: number;
    height: number;
  } | null;
  ocrKind?: string | null;
  ocrPrefix?: string | null;
  ocrRotationDegrees?: number | null;
  ocrBlockNumber?: number | null;
  ocrParagraphNumber?: number | null;
  ocrLineNumber?: number | null;
  ocrOrder?: number | null;
};

export type ReferenceDocumentRegion = {
  id: string;
  label?: string | null;
  text?: string | null;
  /** Structured, provider-verified evidence fields used by hybrid retrieval. */
  factKind?: 'drawing_fact' | 'sheet_identity' | null;
  subject?: string | null;
  location?: string | null;
  evidenceText?: string | null;
  areaNames?: string[];
  /** Normalized page coordinates from 0 through 1. */
  x: number;
  y: number;
  width: number;
  height: number;
  confidence?: number | null;
  /** Canonical consumer source. Deterministic label blocks are OCR-derived. */
  source?: 'embedded_text' | 'ocr' | 'vision' | null;
  /** Exact persisted producer source, retained for Assurance and diagnostics. */
  rawSource?: string | null;
  reconstructionMethod?: string | null;
  evidenceSources?: string[];
  constituentEvidence?: ReferenceDocumentRegionEvidence[];
  corroboratingEvidence?: ReferenceDocumentRegionEvidence[];
};

export type ReferenceDocumentSheetMappingSource =
  | 'pdf_bookmark'
  | 'native_title_band'
  | 'pdf_annotation_title_band'
  | 'coordinate_text';

export type ReferenceDocumentSheetMappingEvidence = {
  id: string;
  pageNumber: number;
  source: 'pdf_bookmark' | 'embedded_text' | 'pdf_annotation';
  annotationSubtype?: 'Square' | null;
  text: string;
  normalizedBounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  } | null;
};

export type ReferenceDocumentStructuralIdentity = {
  sheetNumber: string;
  source: 'pdf_bookmark' | 'native_title_band' | 'pdf_annotation_title_band';
  evidence: ReferenceDocumentSheetMappingEvidence[];
};

/**
 * Bounded page-level Assurance proof retained with exact sheet provenance.
 * Provider diagnostics may contain more fields, but only these stable fields
 * cross the operational document boundary.
 */
export type ReferenceDocumentPageAssurance = {
  accepted: boolean;
  method?: string | null;
  schemaVersion?: string | null;
  evidenceVersion?: string | null;
  assuranceProvider?: string | null;
  assuranceModel?: string | null;
  confidence?: number | null;
  checks?: {
    sheetMappingUsable?: boolean;
  } | null;
  failureCodes: string[];
};

export type ReferenceDocumentSheetProvenance = {
  sheetNumber: string | null;
  sheetMappingStatus: 'verified' | 'conflicted' | 'unverified';
  sheetMappingSource: ReferenceDocumentSheetMappingSource | null;
  sheetMappingEvidence: ReferenceDocumentSheetMappingEvidence[];
  documentStructuralIdentity: ReferenceDocumentStructuralIdentity | null;
  assurance: ReferenceDocumentPageAssurance | null;
};

export type ReferenceDocumentExtractedPage = {
  pageNumber: number;
  sheetNumber?: string | null;
  sheetTitle?: string | null;
  sheetMappingStatus?: 'verified' | 'conflicted' | 'unverified' | null;
  sheetMappingConfidence?: number | null;
  /** Exact page-bound producer provenance; never inferred from page order. */
  sheetMappingSource?: ReferenceDocumentSheetMappingSource | null;
  sheetMappingEvidence?: ReferenceDocumentSheetMappingEvidence[];
  documentStructuralIdentity?: ReferenceDocumentStructuralIdentity | null;
  assurance?: ReferenceDocumentPageAssurance | null;
  sheetMappingCandidates?: Array<{
    sheetNumber: string;
    score: number;
    confidence: number;
    evidenceRegionIds: string[];
  }>;
  visualCoverage?: {
    schemaVersion?: string;
    evidenceVersion?: string;
    sourceSha256?: string;
    pageNumber?: number;
    overviewAnalyzed: boolean;
    requestedDeepReadRegionCount: number;
    completedDeepReadRegionCount: number;
    coverageComplete: boolean;
    /** Stable tile identifiers let an interrupted drawing pass resume only missing work. */
    completedDeepReadRegionKeys?: string[];
    /** Exact page/source/version-bound proof for each completed fixed tile. */
    completedDeepReadRegionProofs?: Array<{
      tileKey: string;
      bounds: { x: number; y: number; width: number; height: number };
      state: 'completed';
      pageNumber: number;
      sourceSha256: string;
      evidenceVersion: string;
      renderMethod: string;
      analysisMethod: string;
      renderDpi: number;
      renderPixelWidth: number;
      renderPixelHeight: number;
      renderSha256: string;
      analysisInputSha256: string;
      analysisSha256: string;
      analysisRegionCount: number;
      analysisRegionIds: string[];
      searchableRegionCount: number;
      searchableRegionIds: string[];
      analysisDurationMs?: number;
    }>;
    /** Provider error codes retained for operator-visible retry diagnostics. */
    failureCodes?: string[];
  } | null;
  title?: string | null;
  text?: string | null;
  regions?: ReferenceDocumentRegion[];
};

export type ReferenceDocumentCitation = {
  documentId: string;
  /** Immutable project authority carried by hosted Ask ECOS proof. */
  projectId?: string | null;
  /** SHA-256 of the exact source bytes used to create the answer. */
  sourceSha256?: string | null;
  /** Hosted evidence contract version used to bind the cited page. */
  evidenceVersion?: string | null;
  documentName: string;
  revision: string | null;
  pageNumber: number | null;
  sheetNumber: string | null;
  regionId: string | null;
  label: string;
};


export type ScheduleStatus =
  | 'Not Started'
  | 'In Progress'
  | 'Waiting'
  | 'Complete';

export type SchedulePriority = 'Low' | 'Medium' | 'High';

/**
 * The first Vitruvius-authored schedule release intentionally supports the
 * most common construction relationship only. Additional relationship types
 * can be added without changing the stored task shape.
 */
export type ScheduleDependencyType = 'FS';

export type ScheduleDependency = {
  predecessorItemId: string;
  type: ScheduleDependencyType;
  /** Working-day lag after the predecessor finishes. */
  lagDays?: number | null;
};

export type ProjectItemType =
  | 'Task'
  | 'Issue'
  | 'RFI'
  | 'Submittal'
  | 'Transmittal'
  | 'Punch List'
  | 'Decision'
  | 'Inspection'
  | 'Daily Log'
  | 'Meeting'
  | 'Risk'
  | 'Safety Observation'
  | 'Quality Check';

export type ProjectItemActivity = {
  id: string;
  message: string;
  author: string;
  createdAt: string;
};

export type ProjectControlApprovalStatus =
  | 'Not Required'
  | 'Draft'
  | 'Pending'
  | 'Approved'
  | 'Changes Requested';

export type ProjectControlWorkflowStage =
  | 'Open'
  | 'In Review'
  | 'Waiting on Response'
  | 'Ready for Field'
  | 'Closed';

export type ProjectControlImpactConfidence = 'Low' | 'Medium' | 'High';

export type ProjectControlChecklistItem = {
  id: string;
  label: string;
  completed: boolean;
  completedAt?: string | null;
  completedBy?: string | null;
};

export type ProjectControlLinkedRecordKind =
  | 'Drawing'
  | 'Document'
  | 'Photo'
  | 'Schedule';

export type ProjectControlLinkedRecord = {
  id: string;
  kind: ProjectControlLinkedRecordKind;
  label: string;
  revision?: string | null;
};

export type ProjectControlResourceKind =
  | 'Person'
  | 'Crew'
  | 'Company'
  | 'Equipment';

export type ProjectControlResource = {
  id: string;
  name: string;
  kind: ProjectControlResourceKind;
  allocationPercent?: number | null;
};

export type ProjectControlDataField =
  | 'assignee'
  | 'trade'
  | 'watchers'
  | 'approvers'
  | 'approvalStatus'
  | 'workflowStage'
  | 'referenceNumber'
  | 'responseDueDate'
  | 'checklist'
  | 'linkedRecords'
  | 'resources'
  | 'estimatedCostImpact'
  | 'estimatedScheduleImpactDays'
  | 'impactConfidence'
  | 'impactNotes';

export type ProjectControlFieldRevision = {
  revision: number;
  updatedAt: string;
  updatedBy: string;
};

/**
 * Shared project-control details stored inside the existing task JSON record.
 * Keeping this data with the task lets the current cloud sync path carry it
 * across iPhone, iPad, and desktop without a separate schema migration.
 */
export type ProjectControls = {
  version: 1;
  assignee: string;
  trade: string;
  watchers: string[];
  approvers: string[];
  approvalStatus: ProjectControlApprovalStatus;
  workflowStage: ProjectControlWorkflowStage;
  referenceNumber: string;
  responseDueDate: string;
  checklist: ProjectControlChecklistItem[];
  linkedRecords: ProjectControlLinkedRecord[];
  resources: ProjectControlResource[];
  estimatedCostImpact: number | null;
  estimatedScheduleImpactDays: number | null;
  impactConfidence: ProjectControlImpactConfidence;
  impactNotes: string;
  revision: number;
  updatedAt: string | null;
  updatedBy: string | null;
  /**
   * Per-field edit authority lets offline devices merge independent control
   * changes without replacing the entire nested record.
   */
  fieldRevisions?: Partial<
    Record<ProjectControlDataField, ProjectControlFieldRevision>
  >;
};

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

/** A schedule row waiting for its schedule to become current (ScheduleItem.scheduleRowsAwaitingCurrent). */
export type ScheduleRowAwaitingCurrent = {
  importBatchId: string;
  sourceDocumentId?: string | null;
  startDate: string;
  finishDate: string;
  percentComplete: number;
  /** False when the file stated no percent for the row (A5 pass 5 H1). */
  percentCompleteStated?: boolean | null;
  status: ScheduleStatus;
};

export type ScheduleLookaheadOverlay = {
  /** The task's dates and percent before the first lookahead changed it. */
  masterStartDate: string;
  masterFinishDate: string;
  /**
   * The master dates this note held before each master that restated the
   * task replaced them, oldest first, each with the import of the master
   * that replaced it (Build 231, S3 item 3). The note kept one master's
   * dates only: after master G listed the task on a lookahead's dates, the
   * dates master F gives it were kept nowhere, so with F current again (or G
   * deleted) deleting the lookahead left the task on G's dates. Read with
   * the schedules saved: a master not in effect, or no longer saved,
   * replaced nothing (scheduleNotedMasterDates). Missing on a note saved
   * before, which reads as before.
   */
  masterDatesBefore?: Array<{ startDate: string; finishDate: string; replacedByMaster: string | true }>;
  masterPercentComplete: number;
  /**
   * Who stated masterPercentComplete (whole-app audit A5 pass 6 M2, 30 Sep
   * 2026): the task's progress source and confirmer, and when, before the
   * first lookahead; put back with the percent when deleting the lookaheads
   * gives it back. Missing on a task restated before.
   */
  masterProgressSource?: 'project_manager' | 'schedule_import' | null;
  masterProgressConfirmedBy?: string | null;
  masterProgressConfirmedAt?: string | null;
  /**
   * The status stated with masterPercentComplete (whole-app audit A5 pass 7
   * L3, 30 Sep 2026), given back with it: David's "Waiting 40%" comes back
   * Waiting. Missing on a note made before, which gives back the task's
   * status then, as before.
   */
  masterStatus?: ScheduleStatus | null;
  /**
   * The percent the master schedule file itself last stated for the task,
   * which the manager's own percent may stand over (A5 pass 6 M2): null when
   * no master file has stated one since the manager's. Missing on a task
   * restated before, whose masterPercentComplete was the file's.
   */
  masterFilePercentComplete?: number | null;
  /**
   * Each lookahead import that restated the task, oldest first, with the
   * dates it gave and the percent it gave (null: it left progress alone;
   * missing: approved before 30 Sep 2026 audit A5 pass 5 H1, not noted).
   * datesReplacedByMaster: a newer master changed the task's dates since
   * this lookahead, so deleting a later lookahead never gives its dates back
   * (whole-app audit A6 pass 19 M1); missing on an entry noted before. The
   * import batch id of the master that changed them (whole-app audit A5 pass
   * 20 P1): they stay replaced only while that master, or one newer, is
   * current; true on an entry marked before, replaced whatever is current.
   * percentStated: true when the lookahead's row stated a percent but it gave
   * none (at or below David's own, Q22), a newer word than an older master's
   * percent (whole-app audit A5 pass 21 R3); missing otherwise, and on an
   * entry noted before.
   * dateByHand: the one date David changed by hand, alone, while the task was
   * on this lookahead's dates, and when (review N1 M1, 3 Oct 2026). Changed
   * after a newer lookahead replaced this one, he was shown the master's
   * dates: his date stands and the other shows the master's. Changed before,
   * it is a hand move and the task shows as saved. Missing otherwise.
   * datesLeftAt: when a save moved the task from this lookahead's dates to
   * the master's dates the note keeps (review N2 F2, 5 Oct 2026: the phone's
   * "Delete PDF Only" on a replaced lookahead saves the dates shown; both
   * dates set so by hand read the same). The task has left the lookaheads'
   * dates: deleting a later lookahead gives the master's back, never this
   * one's or an earlier one's. Missing otherwise.
   * importedAt: when this lookahead's row was imported (review N2 F3, 5 Oct
   * 2026), noted when it restates the task. Once this lookahead's file is
   * deleted alone it stands for the file: a lookahead for the task's project
   * imported after it is newer and replaces it (owner answer Q25), as it does
   * while the file is saved. Missing on a note made before that review.
   * datesKeptAt: when the task was last known to be on this lookahead's
   * dates with its file gone (review N2 F3): noted by the next lookahead to
   * restate the task, when it finds the task still on these dates and this
   * lookahead's file deleted, so that deleting that next lookahead goes back
   * to them. Missing otherwise.
   */
  lookaheads: {
    batchId: string;
    startDate: string;
    finishDate: string;
    percentComplete?: number | null;
    datesReplacedByMaster?: boolean | string;
    percentStated?: true;
    dateByHand?: { field: 'startDate' | 'finishDate'; at: string };
    importedAt?: string;
    datesLeftAt?: string;
    datesKeptAt?: string;
  }[];
};

export type ScheduleItem = {
  id: string;
  /** Immutable cloud project identity. Display names are never write authority. */
  projectId?: string | null;
  /** PM-facing work type. Legacy schedule rows default to Task. */
  itemType?: ProjectItemType;
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
  /** Optional planning hierarchy retained in the shared JSON task record. */
  wbsCode?: string | null;
  parentItemId?: string | null;
  sortOrder?: number | null;
  dependencies?: ScheduleDependency[];
  /**
   * When David last changed this task's links by hand (owner answer Q29, 2
   * Oct 2026): the links follow the task from row to row as masters move it
   * and as Set Active / Make Current switch rows, and of two rows of one task
   * the one changed later holds them. Kept in the task's JSON record; missing
   * on a task whose links were never changed since.
   */
  dependenciesUpdatedAt?: string | null;
  isSummary?: boolean;
  isMilestone?: boolean;
  baselineStartDate?: string | null;
  baselineFinishDate?: string | null;
  percentComplete: number;
  /**
   * An imported row only (whole-app audit A5 pass 5 H1, 30 Sep 2026): false
   * when its file stated no percent for it (no % Complete column, or a blank
   * cell), so approving it leaves the task's progress alone. Missing means
   * stated, as for every row read before. Never kept on a saved task.
   */
  percentCompleteStated?: boolean | null;
  progressSource?: 'project_manager' | 'schedule_import' | null;
  progressConfirmedAt?: string | null;
  progressConfirmedBy?: string | null;
  /**
   * When the manager judged the percent the task holds, when that percent
   * was given back later (whole-app audit A10 pass 5 L1, 30 Sep 2026):
   * deleting a lookahead, or a file stating less than the manager's noted
   * percent, puts the manager's percent back confirmed at that moment
   * (givenBackAt = progressConfirmedAt, so every device takes it back,
   * DAVEScheduleRecovery), while judgedAt keeps when the manager said it,
   * for weighing field reports and dating the record
   * (scheduleProgressJudgedAt). It stands only while progressConfirmedAt is
   * still givenBackAt: any later confirmation is a newer judgment.
   */
  progressJudgment?: { judgedAt: string; givenBackAt: string } | null;
  /**
   * The percent David last entered himself, when a schedule file's higher
   * percent replaced it as the task's (whole-app audit A5 recorded Low, the
   * Q22 floor gap, 1 Oct 2026): while the task's percent is still a file's,
   * a lookahead never sets it below this (owner answer Q22). Kept in the
   * task's JSON record. Missing on every other task, and on one saved
   * before.
   */
  managersPercentUnderFile?: number | null;
  /**
   * When David judged the percent kept in managersPercentUnderFile (whole-app
   * audit A6 pass 24 L1, 2 Oct 2026): the floor is his latest own entry, so
   * a merge keeps the later of the two copies' entries, never an older floor
   * over a percent he entered since. Kept in the task's JSON record; missing
   * on a floor saved before, which counts as older than any dated entry.
   */
  managersPercentUnderFileJudgedAt?: string | null;
  /**
   * The earlier row a sync carry took this task's percent from, and when
   * David judged that percent (whole-app audit A7 pass 28 L, 2 Oct 2026): a
   * copy still holding it is weighed as a carried percent, not as David's
   * word on this row, also after that row is deleted. It goes with the
   * percent, and stops counting once the percent changes. Kept in the task's
   * JSON record.
   */
  progressCarriedFrom?: { taskId: string; judgedAt: string | null } | null;
  /**
   * When the schedule that shows this row was last made current (Set Active,
   * Make Current) with this row's percent LEFT STANDING against a percent
   * stated later on the row it hid, and the percent that stood (Build 231,
   * S3 item 1; the independent review's F02): a file's higher percent over
   * the percent David entered since under another master, or David's own
   * percent after a newer master's file had taken it over. Only the sync's
   * carry reads it (DAVEScheduleRecovery): what was stated before that time
   * on the rows set aside did not take this percent over, and this percent
   * stands over what he entered before it. It goes with the percent and
   * stops counting once the percent changes. Kept in the task's JSON record;
   * missing on a task saved before, which is weighed as before.
   */
  progressStandsSince?: { at: string; percentComplete: number } | null;
  /**
   * The highest percent a master schedule's file has stated on this row, and
   * when it was approved (Build 231, S3 item 1; owner answer Q32, option b,
   * on a task the masters keep on its dates). A file that states more than
   * the percent David entered takes the task over, and a newer master's
   * percent then replaces that file's, below his too; the row itself kept
   * only the last percent, so a copy of the row still holding his older
   * percent could not tell "G's 60% over his 40%, then H's 30%" from "H's 30%
   * straight over his 40%" (which he keeps). Read where two copies of one
   * row meet (the sync's merge, and an offline percent edit against the
   * cloud's row). Kept in the task's JSON record; missing on a task saved
   * before, which is weighed as before.
   */
  fileProgressPeak?: { percentComplete: number; statedAt: string } | null;
  /**
   * The percent the LAST master schedule's file stated on this row and when
   * it was approved, whether or not that percent stood (Build 231, S4 item
   * 3; owner answer Q32, option b, when two masters are approved apart on
   * two devices and both restate the row). A file's percent below the one
   * David holds stands for nothing on that device and left no trace; the
   * other device's file had meanwhile taken his percent over, and one device
   * would end on the newest master's percent. With fileProgressPeak it lets
   * the sync's merge replay the two statements in order. Kept in the task's
   * JSON record; missing on a task saved before, which is merged as before.
   */
  fileProgressLast?: { percentComplete: number; statedAt: string } | null;
  /**
   * The dates each master that shares this row gives it, kept with the row
   * once its lookahead note is gone (Build 231, S4 item 1): the newest
   * master's dates, and the dates held before each master replaced them
   * with that master's import (the note's masterStartDate / masterFinishDate
   * and masterDatesBefore, as they were). Master F 10/15, a lookahead 10/18,
   * master G on the lookahead's dates; back on F with the lookahead deleted
   * the task is on 10/15 and the note is gone; making G current again left
   * 10/15, though G lists 10/18. Set Active and Make Current read it
   * (scheduleNotedMasterDates): the dates of the master in effect, either
   * way. Missing on a row saved before, which keeps its dates as before.
   */
  masterDatesOfRow?: { startDate: string; finishDate: string; before: Array<{ startDate: string; finishDate: string; replacedByMaster: string | true }> } | null;
  /**
   * The percent Talk wrote on this task that its Undo took back, and when
   * Talk confirmed it (whole-app audit A5 pass 26 L1, 2 Oct 2026): another
   * device may still hold that entry, or a floor made from it, and neither
   * counts as David's word. Kept in the task's JSON record; the latest Undo's
   * stays.
   */
  progressUndone?: { percentComplete: number; confirmedAt: string | null } | null;
  priority: SchedulePriority;
  /**
   * The priority this row's own import gave it (schedule batch S6, item 1, 7
   * Oct 2026): High when the file marks the row critical or its finish was
   * within a week of the import, else Medium. Written once, on every row an
   * import adds, and never changed: a priority that reads otherwise is one
   * David set, and only that follows the task to the row a newer master
   * moves it to. Kept in the task's JSON record. Missing on a row saved
   * before, where only a Low is known to be his (no import gives one), until
   * he changes its priority: that edit writes what the row held before it
   * (scheduleEditWithPriorityNoted), so what he sets from then on is known.
   */
  priorityAsImported?: SchedulePriority | null;
  status: ScheduleStatus;
  notes: string;
  /** Smallest accountable step expected next. */
  nextAction?: string;
  /** Append-only PM activity retained with the shared task record. */
  activity?: ProjectItemActivity[];
  /** Accountability, workflow, field, plan, resource, and impact controls. */
  projectControls?: ProjectControls | null;
  importedFrom?: string | null;
  importedAt?: string | null;
  /** Immutable import identity; filenames are display data only. */
  importBatchId?: string | null;
  /**
   * Later imports this task was found unchanged in. The task keeps its own
   * import identity and belongs to each of these too, so a revision shows it
   * without taking it over (whole-app audit A5 pass 2).
   */
  alsoImportedInBatchIds?: string[] | null;
  /**
   * The row number the latest of those imports gives the task, when its file
   * numbers rows (Microsoft Project), so twins keep that file's order after a
   * revision moved one of them (whole-app audit A5 pass 19 L4, 1 Oct 2026).
   * sourceRowNumber stays the task's own import's. Kept in the task's JSON
   * record. Missing on a row saved before.
   */
  alsoImportedSourceRow?: { importBatchId: string; sourceRowNumber: number } | null;
  /**
   * A task a lookahead added (no master had it): its own import
   * (importBatchId) is a lookahead's (whole-app audit A6 pass 19 M2, 1 Oct
   * 2026). The merge knew lookaheads only by the notes of the tasks they
   * restated, which deleting the lookahead clears, so a later lookahead still
   * holding the task left it counted as a master's. Kept in the task's JSON
   * record. Missing on every other task, and on one added before.
   */
  importedAsLookahead?: boolean | null;
  /**
   * The lookaheads that restated this task in place (owner answer Q22), and
   * what it said before the first of them, so deleting a lookahead gives the
   * task back its master schedule dates.
   */
  lookaheadOverlay?: ScheduleLookaheadOverlay | null;
  /**
   * Only on a copy of the task as shown, never saved (owner answer Q25, 2 Oct
   * 2026): the task is shown on the master's dates because the lookahead
   * that moved it was replaced; these are the dates saved on the task and
   * those shown. A change written from the shown copy that leaves the dates
   * as shown keeps the saved ones (scheduleItemAsSaved), so the newest
   * lookahead's deletion can show the one before it again.
   */
  savedLookaheadDates?: Readonly<{ startDate: string; finishDate: string; shownStartDate: string; shownFinishDate: string }> | null;
  /**
   * The ids this task had before new masters moved its dates, oldest first
   * (whole-app audit A10 pass 5 M1, 30 Sep 2026): a new master saves a moved
   * task as a new row with a new id, and a field update linked to an earlier
   * id stays this task's (ScheduleTaskRevisions). Kept in the task's JSON
   * record, as lookaheadOverlay is. Missing on a row saved before.
   */
  revisedFromTaskIds?: string[] | null;
  /**
   * Review N3 R3 (5 Oct 2026): the owner, contractor, note, next step and
   * milestone this row took
   * from the task it answers to (taskId) when a master moved the task here:
   * each as the approving device's copy of that task had it then (owner
   * answer Q28's "copy it started from", for a row). A field that still reads
   * so was not typed on this row; when the row first reaches the cloud, the
   * cloud's row of that task says what he did to the field last
   * (SyncService). Only fields taken from the task: none the file stated.
   * Kept in the task's JSON record. Missing on a row saved before.
   * priority (schedule batch S5, item 1; put right in S6, item 1): the
   * priority the row took with them, only when it was one David had set on
   * the task (schedulePriorityIsHis). A task whose priority he never set
   * gets no entry: its new row keeps what its own import gave it.
   */
  textFromTask?: {
    taskId: string; owner?: string; contractor?: string; notes?: string; nextAction?: string; milestone?: string;
    priority?: SchedulePriority;
    /** Review P5-2: the hand links the row was made with (taken from that task's row, none included), when its file stated none. */
    dependencies?: ScheduleDependency[];
  } | null;
  /**
   * The saved tasks David said at import review this row is not (owner
   * answer Q30, 2 Oct 2026): a same-named row he called a new task. Set
   * Active and Make Current never pair it with them, so his answer holds when
   * he switches masters. Kept in the task's JSON record; missing otherwise.
   */
  notRevisionOfTaskIds?: string[] | null;
  /**
   * A task entered by hand: the rows of schedules uploaded on the web, not
   * current yet, that restate it (whole-app audit A5 pass 18 L3, 1 Oct
   * 2026). Each restates the task when its schedule is made current for the
   * task's project (Make Current on the web, Set Active on the phone), and
   * is dropped then. Kept in the task's JSON record. Missing on every other
   * task.
   */
  scheduleRowsAwaitingCurrent?: ScheduleRowAwaitingCurrent[] | null;
  /** Exact source within a multi-document import, when determinable. */
  sourceDocumentId?: string | null;
  /** Immutable activity identifier captured from the source schedule row. */
  sourceActivityId?: string | null;
  /** Immutable WBS value captured from the source schedule row. */
  sourceWbsCode?: string | null;
  /** Immutable one-based source row used when activity/WBS values are not unique. */
  sourceRowNumber?: number | null;
  /**
   * Microsoft Project's Unique ID for the row, when the file has the column
   * (owner answer Q30, 2 Oct 2026): unlike the ID, row and WBS it survives a
   * revision, so same-named tasks pair by it without asking. Missing when the
   * file has none.
   */
  sourceUniqueId?: string | null;
  completionVerification?: DAVECompletionVerification | null;
  createdAt: string;
  /** Last user-authored task change. Imported legacy rows may omit it. */
  updatedAt?: string | null;
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

export const PROJECT_ITEM_TYPES: ProjectItemType[] = [
  'Task',
  'Issue',
  'RFI',
  'Submittal',
  'Transmittal',
  'Punch List',
  'Decision',
  'Inspection',
  'Daily Log',
  'Meeting',
  'Risk',
  'Safety Observation',
  'Quality Check',
];
import type { PIEPhotoIntelligenceDisplayState } from '../services/PIEPhotoVisionMobileWorkflow';
