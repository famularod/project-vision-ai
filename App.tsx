import {
  deleteCloudProject,
  loadCloudArchivedProjectNames,
  loadCloudProjectRecords,
  queueCloudProjectArchives,
  saveCloudProject,
  saveCloudProjectCoverPhoto,
  setCloudProjectArchived,
} from './services/projectService';
import {
  loadCloudUpdates,
  persistAndQueueProjectUpdateDeletion,
  reconcileProjectUpdateDeletionJournal,
  type DeletedUpdateTombstone,
  type FieldUpdateDeleteDiagnostics,
} from './services/updateService';
import {
  clearScheduleItemSyncConflicts,
  cleanupStoredSyncStatusMessages,
  cloudPhotoPreviewIsFresh,
  getOfflineQueue,
  hydrateProjectUpdatePhotoPreviews,
  projectUpdateUploadedSince,
  hydrateRecoveredProjectUpdatePhotos,
  markMissingPhotosUnavailable,
  requestPendingChangesUpload,
  removeMissingPhotosFromSyncQueue,
  removeProjectUpdateFromSyncQueue,
  runFieldUpdateCloudSync,
  runScheduleImportCloudSync,
  runScheduleItemCloudSync,
  queueProjectAreaRecord,
  queueReferenceDocumentRecord, requeueReferenceDocumentEditsOutlivingActivation,
  queueProjectUpdateRecord,
  queueScheduleItemRecord,
  removeOperationalRecordFromSyncQueue, withdrawQueuedChangesOfDeletedProject,
  synchronizeLocalData,
  uploadPendingChanges,
  type FieldUpdateSyncWorkAttempt,
  type MissingSyncPhoto,
  type PhotoStorageUploadFailureCategory,
  type SyncUploadResult,
} from './services/SyncService';
import {
  cancelScheduleItemTextSync as cancelScheduleItemTextSyncLifecycle,
  createScheduleItemTextSyncLifecycle,
  disposeScheduleItemTextSyncLifecycle,
  flushPendingScheduleItemTextSync,
  markScheduleItemTextSyncPending,
  scheduleItemChangeUsesDebouncedSync,
  scheduleScheduleItemTextSync,
  settleScheduleItemTextSync,
} from './services/ScheduleItemTextSyncLifecycle';
import {
  accountDisplayNameForUser,
  getCurrentSessionAccessToken,
  getSupabaseClient,
  listArchivedProjects,
  listProjectAreas,
  listProjects,
  listProjectUpdates,
  listReferenceDocuments,
  listScheduleItems,
  signIn,
  signUp,
  subscribeToAuthStateChange,
  subscribeToDAVEOperationalChanges,
  uploadPhoto,
} from './services/SupabaseService';
import {
  createDAVEOperationalRefreshCommitGuard,
  createDAVEOperationalRefreshController,
  DAVE_OPERATIONAL_REFRESH_RETRY_MESSAGE,
  runDAVEOperationalCollectionRefreshes, shouldRefreshDAVEOperationalDataOnForeground,
  type DAVEOperationalCollectionName,
  type DAVEOperationalCollectionRefresh,
  type DAVEOperationalRefreshTrigger,
} from './services/DAVEOperationalRefresh';
import { createDAVEOperationalRealtimeApplier, createDAVEOperationalRealtimeCommit, mergeProjectNames } from './services/DAVEOperationalRealtimeApplication';
import { reconcileDAVEOperationalProjects } from './services/DAVEOperationalProjectRecovery';
import {
  isLegacyNonProjectShellName,
  legacyNonProjectShellNamesPresent,
  LEGACY_NON_PROJECT_SHELL_NAMES,
} from './services/CrossDeviceVisibility';
import { isReservedLegacyProjectName, RESERVED_LEGACY_PROJECT_NAME_MESSAGE } from './services/ReservedProjectNames';
import { AdminScreen, SignInModal } from './screens/AdminScreen';
import { ReportsScreen } from './screens/ReportsScreen';
import {
  ScheduleCommittedPercentField,
  ScheduleCommittedTextField,
} from './components/ScheduleCommittedFields';
import { afterTextInputBlur } from './components/after-text-input-blur';
import {
  mailComposerOutcome,
  smsComposerOutcome,
  type ReportCommunicationOutcome,
} from './services/ReportCommunication';
import { AppShellFrame } from './components/app-shell-frame';
import { OverlayErrorBoundary } from './components/overlay-error-boundary';
import { useFieldNoteBackgroundRetry } from './hooks/use-field-note-background-retry';
import { useHiddenSharedDocuments } from './hooks/use-hidden-shared-documents';
import { useProjectDocumentSharedRecordSync } from './hooks/use-project-document-shared-record-sync';
import { colors, styles } from './components/app-shell-theme';
import { LiveAuthorityStatusBanner } from './components/live-authority-status-banner';
import { OfflineSignInPendingBanner } from './components/offline-sign-in-pending-banner';
import { workspaceAccountChange } from './services/OwnerWorkspaceAuthDecision';
import {
  appShellContentTopPadding,
  appShellLayoutForWidth,
  useAppShellLayout,
} from './components/app-shell-layout';
import {
  OverviewResponsiveColumn,
  OverviewResponsiveFrame,
  OverviewResponsiveWorkspace,
} from './components/overview-responsive-layout';
import { ScheduleImportFlow } from './components/ScheduleImportFlow';
import { extractSchedulePdfWithServer } from './services/PIEScheduleRemoteExtraction';
import {
  bindStableScheduleImportItemIds,
  resolveScheduleImportSourceIdentity,
} from './services/ScheduleImportSourceIdentity';
import {
  ScheduleImportReviewError,
  scheduleImportApprovalBlocker,
  validateScheduleImportScope,
} from './services/ScheduleImportScopeGuard';
import { buildVitruviusMyWork } from './services/VitruviusMyWork';
import { buildVitruviusReviewQueue } from './services/VitruviusReviewQueue';
import { buildVitruviusCommitmentControl } from './services/VitruviusCommitmentControl';
import { ScheduleTaskEditorModal } from './components/schedule-task-editor-modal';
import { ScheduleTaskListControls, type ScheduleTaskFilter,
  type ScheduleTaskView, type ScheduleWorkspaceView } from './components/schedule-task-list-controls';
import {
  ScheduleTaskAreaSummaryPanel,
  ScheduleTaskGroupHeader,
  ScheduleWideWorkspace,
  scheduleWorkspaceAreaKey,
} from './components/schedule-workspace-layout';
import { buildDAVETaskAreaSummary } from './services/DAVETaskAreaSummary';
import { MobileSchedulePlanning } from './components/mobile-schedule-planning';
import { NativeDateField } from './components/native-date-field';
import {
  ProjectItemDetailsEditor,
  ProjectItemNextAction,
  ProjectItemTypeBadge,
} from './components/project-item-details';
import {
  UpdatePhotoComparison,
  UpdatesWideWorkspace,
  updatePhotoComparisonViewModel,
} from './components/updates-workspace-layout';
import { DocumentsWideWorkspace } from './components/documents-workspace-layout';
import { SharedReferenceDocumentCard } from './components/shared-reference-document-card';
import { buildMobileDocumentWorkspace, type MobileDocumentWorkspaceEntry } from './services/MobileDocumentWorkspace';
import { ProjectDocumentActions, ProjectDocumentsHeader } from './components/project-documents-header';
import { DocumentUploadDetailsSheet } from './components/document-upload-details-sheet';
import { ProjectDocumentCard } from './components/project-document-card';
import { mergeDAVEProjectAreaRecoveryRecords } from './services/DAVEProjectAreaRecovery';
import {
  explicitProjectAreaOwner,
  projectAreasForProject,
} from './services/DAVEProjectAreaScope';
import {
  projectUpdateBelongsToParentProject,
  projectUpdatesForParentProject,
} from './services/DAVEProjectUpdateScope';
import { groupScheduleWorkspaceItemsByProjectAndArea, resolveScheduleWorkspaceTask,
  scheduleItemsForWorkspaceProject, scheduleWorkspaceProjectOptions } from './services/DAVEScheduleWorkspace';
import { buildDAVEUpdatePhotoComparison, filterDAVEUpdateWorkspace,
  resolveUpdateWorkspaceUpdate, updateWorkspaceProjectOptions } from './services/DAVEUpdateWorkspace';
import { buildVitruviusCalendarExport } from './services/VitruviusCalendarExport';
import {
  buildVitruviusLookahead,
  vitruviusLookaheadCsv,
} from './services/VitruviusLookahead';
import { filterDAVEDocumentWorkspace, markCurrentProjectScheduleDocument,
  resolveDAVEDocumentWorkspaceDocument } from './services/DAVEDocumentWorkspace';
import {
  PROJECT_DOCUMENT_CATEGORIES,
  suggestProjectDocumentCategory,
  type ProjectDocumentCategory,
} from './services/ProjectDocumentClassification';
import { KeyboardAvoidingModalCard } from './components/KeyboardAvoidingModalCard';
import { UpdateDeleteControl } from './components/update-delete-control';
import { HoldToDeleteButton } from './components/hold-to-delete-button';
import { MoreOptionRow, ProjectActionSheet } from './components/project-action-sheet';
import { DAVEConversationAnswerSheet } from './components/DAVEConversationAnswerSheet';
import { ECOSDocumentEvidenceSheet } from './components/ECOSDocumentEvidenceSheet';
import { extractECOSMobileDocument } from './services/ECOSMobileDocumentExtraction';
import { loadECOSTalkReferenceDocuments } from './services/ECOSTalkDocumentContext';
import {
  DAVETaskActionConfirmationSheet,
  type DAVETaskActionCandidate,
} from './components/dave-task-action-confirmation-sheet';
import { DAVECaptureConfirmationSheet } from './components/DAVECaptureConfirmationSheet';
import { DAVECaptureMemoryDetailSheet } from './components/DAVECaptureMemoryDetailSheet';
import { DAVETypedCaptureSheet } from './components/DAVETypedCaptureSheet';
import { DAVEVoiceCaptureSheet } from './components/DAVEVoiceCaptureSheet';
import { AppScreenScroll as ScreenScroll } from './components/app-screen-scroll';
import { NativeFieldNotesExperience, OverviewFieldNotesCard } from './components/native-field-notes-experience';
import { useNativeWorkspaceOwner, useNativeWorkspaceSignInPending, useNativeWorkspaceSignInPendingRef } from './components/native-workspace-owner';
import { fieldUpdateSyncCategoryWithoutSession } from './services/FieldUpdateSessionWait';
import { ProjectPhotoImage } from './components/ProjectPhotoImage';
import { PhotoComparisonPreviewRow, SavedFieldUpdatesContext } from './components/photo-comparison-preview-row';
import {
  DailyBriefSection,
  DAVEProjectNeedsVerificationLabel,
  DAVEProjectStatusLoadingScreen,
  DAVEProjectTaskOperationalSummary,
  WorkspaceCardSkeleton,
} from './components/DAVEProjectStatusViews';
import { StartupErrorBoundary } from './components/StartupErrorBoundary';
import { StartupHydrationBoundary } from './components/StartupHydrationBoundary';
import {
  cancelPendingStoragePersistence, flushPendingStoragePersistence, persistStorageItem,
  removePersistedStorageItem,
  reportStoragePersistenceFailure,
  useJsonStoragePersistence,
  useStringStoragePersistence,
} from './hooks/use-async-storage-persistence';
import { useAccountDisplayName } from './hooks/use-account-display-name';
import { forgetFieldNoteDraft } from './hooks/use-field-note-draft';
import {
  isStartupHydrationReady,
  useStartupHydration,
} from './hooks/use-startup-hydration';
import { useRealityModelCacheRecovery } from './hooks/use-reality-model-cache-recovery';
import { useCommittedText } from './hooks/use-committed-text';
import { useScheduleProgressDraft } from './hooks/use-schedule-progress-draft';
import { useStartupLocalFirstRecovery } from './hooks/use-startup-local-first-recovery';
import { useProjectPhotoDisplayUri } from './hooks/use-project-photo-display-uri';
import type {
  ActionStatus,
  AreaSuggestion,
  ContactBook,
  DAVESyncTombstone,
  PhotoCategory,
  ProjectArea,
  ProjectContact,
  RecipientSelection,
  ScheduleItem,
  SchedulePriority,
  ScheduleStatus,
  StoredDraft,
  UpdatePhoto,
  ReferenceDocument,
  ProjectItemType,
} from './types';
import {
  DEFAULT_PROJECT_AREAS,
  normalizeProjectArea,
} from './services/ProjectAreaRecord';
import {
  areaPointAccuracyMeters,
  areaPointFromFix,
  areaPointImpreciseMessage,
  areaPointPrecisionLabel,
  areaGpsSaveDecision,
  areaPointSavedMessage,
  clearWinnerMarginFeet,
  formatGpsAccuracy,
  isConfidentlyInsideArea,
  overviewFixMaxAgeMs,
  PRECISE_LOCATION_OFF_MESSAGE,
  PRECISE_LOCATION_OFF_TITLE,
} from './services/GpsPrecision';
import { createRecentLocationFix } from './services/RecentLocationFix';
import { asLibraryPhoto, newPhotoGps, withDraftGps, withDraftLocation } from './services/DraftPhotoGps';
import { applyFixToDraft, areaChangeLocationFields } from './services/DraftFix';
import {
  currentDraftAreaSuggestion,
  distanceBetweenCoordinatesFeet,
  findProjectAreaSuggestions,
  hasSavedAreaLocation,
  homeDetectionDecision,
} from './services/AreaSuggestion';
import {
  currentDraftLocationNoticeView,
  draftAreaPresentation,
  type DraftLocationNotice,
  type DraftLocationNoticeDetail,
} from './services/DraftAreaPresentation';
import { createDraftFixTracker, createKeyedInFlight } from './services/DraftFixTracker';
import { optionalString, uid } from './services/RecordValues';
import { normalizeFieldUpdateSyncDiagnostics, type FieldUpdateSyncDiagnostics, type FieldUpdateSyncFailureCategory, type FieldUpdateSyncStepResult } from './services/FieldUpdateSyncDiagnosticsRecord';
import { reissueDraftAsNewUpdate } from './services/DraftReissue';
import { classifySyncFailureText } from './services/SyncFailureCategory';
import { forgetAllReportSessionState } from './services/ReportSessionState';
import {
  archiveDraftEnvelopeForValidation,
  archiveUpdateForValidation,
  archiveUpdatePhotosAreLocated,
  markPhotoUnavailableInBackup,
} from './services/BackupArchivePhotos';
import { isResumableFieldUpdateStatus } from './services/FieldUpdateLifecycle';
import {
  normalizeProjectItemActivity,
  normalizeProjectItemType,
  projectItemWorkflowIsClosed,
  resolveProjectItemWorkflowMutation,
  type ProjectItemWorkflowMutationRequest,
} from './services/ProjectItemWorkflow';
import {
  deleteStoredReferenceDocument,
  ensureReferenceDocumentsDirectory,
  isStoredReferenceDocument,
  normalizeReferenceDocument,
  normalizeReferenceDocuments,
  resolveReferenceDocumentUri,
} from './services/ReferenceDocumentRepository';
import {
  canonicalReferenceCategory,
  referenceDocumentAppliesToProject,
} from './services/AuthoritativeDocumentSystem';
import { buildECOSDocumentReadiness } from './services/ECOSDocumentReadiness';
import { compactECOSReferenceDocumentsForOperationalRead } from './services/ECOSDocumentIndexPersistence';
import { activateSharedReferenceDocument, importedScheduleOfPhoneSchedule, loadECOSScheduleRetirementScope, phoneScheduleActivationTarget, phoneScheduleCardIsCurrent, scheduleDocumentsAfterActivation, scheduleImportAlreadyAdded, scheduleRetirementMessage, scheduleTasksHiddenByActivation, scheduleTasksHiddenWarning } from './services/SharedDocumentActivation';
import {
  createECOSMobileDrawingControls,
  mobileDrawingMetadataForUpload,
  type ECOSMobileDrawingControls,
  validateECOSMobileDrawingControls,
} from './services/ECOSMobileDrawingOnboarding';
import { restoreReferenceDocumentBytesFromCloud } from './services/ExpoReferenceDocumentByteRestore';
import { withRestoredReferenceDocumentBytes, type ReferenceDocumentByteRestoreResult } from './services/ReferenceDocumentByteRestore';
import { openGoogleDriveReferenceDocument } from './services/ReferenceDocumentBrowser';
import { restoreProjectDocumentBytesFromCloud } from './services/ExpoProjectDocumentByteRestore';
import { logStartupDiagnostic } from './services/StartupDiagnostics';
import { startNewUpdate } from './services/StartNewUpdate';
import { cleanupProjectPhotoDirectory } from './services/PhotoDirectoryCleanupPolicy';
import {
  normalizeStartupArray,
  readStartupJson,
  readStartupJsonArray,
} from './services/StartupRecovery';
import {
  isStartupContactBook,
  isStartupDeletedUpdateRecord,
  isStartupDraftEnvelope,
  isStartupProjectAreaRecord,
  isStartupProjectName,
  isStartupProjectRecord,
  isStartupReferenceDocumentRecord,
  isStartupSavedUpdateRecord,
  isStartupScheduleItemRecord,
  isStartupStandaloneProjectDocumentRecord,
  salvageStartupContactBook,
} from './services/StartupRecordValidation';
import { dependencyChangesForDeletedTask, normalizeScheduleDependencies } from './services/VitruviusScheduleEngine';
import { normalizeProjectControls } from './services/VitruviusProjectControls';
import { runExclusiveLocalStorageMutation } from './services/LocalStorageMutationCoordinator';
import { reconcileFieldUpdateSyncResult } from './services/FieldUpdateSyncGeneration';
import { hasMatchingQueuedProjectUpdateRevision } from './services/ProjectUpdateQueueRevision';
import { scheduleItemRevisionForCloudRefresh } from './services/ScheduleItemQueueRevision';
import { createFieldUpdateLocalPersistence, FieldUpdatePersistenceBlockedError, prepareFieldUpdateStatusSave, prepareQueuedFieldUpdateSave } from './services/FieldUpdateLocalPersistence';
import {
  runAutomaticSyncQueue,
  shouldPersistAutomaticSyncOutcome,
  startAutomaticSyncBackgroundTask,
} from './services/AutomaticSyncState';
import { createProjectId, restoreProjectRecords } from './services/ProjectIdentity';
import { buildProjectDeletionCascade, buildProjectDeletionOperations, projectDeletionTakesUpdate,
  referenceDocumentMatchesProject as referenceDocumentMatchesDeletedProject, referenceDocumentDeletedWithProject,
  scheduleItemMatchesProject as scheduleItemMatchesDeletedProject, selectProjectDeletionFallback,
  PROJECT_DELETION_CLOUD_INTENTS_STORAGE_KEY, PROJECT_DELETION_FILE_CLEANUP_INTENTS_STORAGE_KEY,
  PROJECT_DELETION_TRANSACTION_JOURNAL_KEY, type ProjectDeletionStorageKeys } from './services/ProjectDeletionTransaction';
import { buildProjectDeletionFileCleanupIntents, createProjectDeletionLocalFileCleaner, createProjectDeletionRuntime, ProjectDeletionIntentRecoveryRequiredError, ProjectDeletionRecoveryRequiredError } from './services/ProjectDeletionRuntime';
import { PROJECT_UPDATE_DELETION_JOURNAL_STORAGE_KEY } from './services/ProjectUpdateDeletionJournal';
import { archivedProjectNameMessage, deletedProjectNameMessage, projectNameAvailability, queuedProjectNameChanges, similarProjectNameMessage } from './services/ProjectNameRules';
import {
  FileSizePreflightError,
  hashExpoFileSha256,
  MAX_PROJECT_DOCUMENT_FILE_BYTES,
  preflightExpoFileRead,
  prepareExpoFileUploadPayload,
} from './services/FileSizePreflight';
import {
  APP_BACKUP_VERSION,
  BackupRestoreRecoveryRequiredError,
  buildDeletionSafeRestoreState,
  createBackupRestoreRuntime,
  preflightAppBackup,
} from './services/BackupRestoreRuntime';
import {
  buildCombinedReportAuthorityScope,
  buildDailyReportAuthorityScope,
  buildProjectIntelligenceAuthorityScope, captureIntelligenceProjectName, projectTruthPersistencePolicyFor,
} from './services/ReportAuthorityScope';
import {
  isLegacyOwnedLocalFileReadDeleteAuthorized,
  isOwnedLocalFileManifestMember,
  parseOwnedLocalFileManifest,
  resolveLegacyOwnedLocalFilePath,
} from './services/OwnedLocalFileRepository';
import {
  buildSharedReferenceDocument,
  cleanupProjectDocumentOwnedFileForRecordRemoval,
  createProjectDocumentOwnedFileStore,
  findSharedReferenceDocumentForProjectDocument,
  importProjectDocumentIntoOwnedStorage,
  OWNED_PROJECT_DOCUMENTS_FOLDER,
  PROJECT_DOCUMENT_REIMPORT_REQUIRED_MESSAGE,
  recoverStaleUploadingDocuments,
  requireOwnedProjectDocumentAccess,
  synchronizeSharedReferenceDocumentMetadata,
} from './services/ProjectDocumentLifecycle';
import { bindProjectDocumentUploadToAccount, createProjectDocumentUploadRetryRunner, projectDocumentsAwaitingUpload, projectDocumentUploadAttemptsAfterFailure } from './services/ProjectDocumentUploadRetry';
import { legacyOrphanedProjectDocumentBridges, withdrawUnsentProjectDocumentBridge } from './services/ProjectDocumentBridge';
import { legacyProjectNameKey as authorityProjectId } from './services/OperationalProjectIdentity';
import { preserveLocalPhotoTransport, withLatestLocalPhotoTransport } from './services/ProjectPhotoTransport';
import { documentsUploadedAfterCloudCopy, fieldUpdatesToResendForDocument, withDeviceDocumentUploadState, withoutFieldUpdateDocument } from './services/FieldUpdateDocumentUploadState';
import { closeProjectMessage, queuedWorkForProject } from './services/ProjectCloseGuard';
import {
  fieldUpdateLifecycleLabel,
  persistedStatusForSyncResult,
  type PersistedFieldUpdateStatus,
} from './services/FieldUpdateLifecycle';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as Clipboard from 'expo-clipboard';
import * as Contacts from 'expo-contacts';
import * as DocumentPicker from 'expo-document-picker';
import * as Crypto from 'expo-crypto';
import * as FileSystem from 'expo-file-system/legacy';
import * as ImagePicker from 'expo-image-picker';
import { LinearGradient } from 'expo-linear-gradient';
import * as Location from 'expo-location';
import * as MailComposer from 'expo-mail-composer';
import * as Sharing from 'expo-sharing';
import * as SMS from 'expo-sms';
import {
  createCompleteBackupArchive,
  COMPLETE_BACKUP_MINIMUM_PASSPHRASE_LENGTH,
} from './services/CompleteBackupArchive';
import { type CompleteBackupAssetSource } from './services/CompleteBackupArchiveParts';
import {
  decryptedBytesAssetProvider, exportBackupInParts, measureBackupAssetSource,
  materializeCompleteBackupState, multiPartBackupNotice, openSelectedBackup, stagedAssetProvider,
  type UnavailableBackupDocument, type UnavailableBackupPhoto,
  unavailablePhotosNotice,
} from './services/DeviceBackupWorkflow';
import { expoBackupFileIO } from './services/ExpoBackupFileIO';
import {
  isAttachmentReadError, REPORT_EMAIL_IMAGE_LIMIT, REPORT_IMAGES_NOT_ATTACHED, REPORT_MESSAGE_IMAGE_BYTES,
  REPORT_TEXT_IMAGE_LIMIT,
  resolveReportImageAttachments,
} from './services/ReportImageAttachments';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import {
  assertBackupSerializedFits,
  DEVICE_BACKUP_SCOPE_NOTICE, DEVICE_BACKUP_RESTORE_NOTICE,
  MAX_DEVICE_BACKUP_BYTES,
} from './services/BackupExportPolicy';
import {
  analyzeProjectPhotoWithVision,
  buildAnalyzingPhotoIntelligenceState,
  photoNeedsPriorRecheckAfterAreaChange,
  type PIEPhotoIntelligenceDisplayState,
} from './services/PIEPhotoVisionMobileWorkflow';
import { createPhotoAnalysisCoordinator } from './services/PhotoAnalysisCoordinator';
import {
  createDraftLocationCaptureTarget,
  isDraftLocationCaptureTargetCurrent,
} from './services/draft-location-capture-target';
import {
  type PhotoAnalysisTarget,
} from './services/PhotoAnalysisTarget';
import {
  aggregatePhotoDisplayResults,
  photoAssessmentReviewCopy,
  photoDisplayResultCanInformProject,
  photoDisplayResultIsReviewCandidate,
  withStoredPhotoComparisonCap,
} from './services/PhotoAssessment';
import {
  attentionCategoryForPhotoCategory,
  buildStableAttentionItemId,
  dedupeAttentionItemsById,
} from './services/PIEAttentionIdentity';
import { buildECOSTalkProjectIntelligence } from './services/ECOSTalkProjectIntelligence';
import { talkContextProjectForScreen } from './services/ECOSTalkProjectContext';
import { selectActionableDailyBriefItems } from './services/DAVEDailyBrief';
import { parseDAVEAssertions } from './services/DAVEAssertionParser';
import {
  mergeLocalUpdateWithCloudCopy,
  mergeDAVEReferenceDocumentRecoveryRecords,
} from './services/DAVECloudRecovery';
import {
  isDAVESafeCloudScheduleRecord,
  reconcileDAVEScheduleRecords,
  recoverDAVEScheduleRecords,
} from './services/DAVEScheduleRecovery';
import {
  DAVE_SYNC_TOMBSTONES_STORAGE_KEY,
  deletedDAVERecordIds,
  recordDAVESyncTombstone,
  recordDAVESyncTombstones,
  loadDAVEOperationalTombstones,
  synchronizeDAVESyncTombstones,
} from './services/DAVESyncTombstones';
import {
  DELETED_TASK_EVIDENCE_LABEL,
  partitionProjectUpdatesByDeletedTask,
} from './services/DAVEDeletedTaskEvidence';
import { createDAVEPhotoContinuityAnchor } from './services/PIEVisualContinuity';
import { buildDAVEActionInbox } from './services/DAVEActionInbox';
import {
  buildDAVETalkMemoryDraft,
  mentionedDAVEProject,
  routeDAVEConversation,
  type DAVEConversationNavigationTarget,
} from './services/DAVEConversationRouter';
import {
  answerDAVEConversationContext,
  askECOSQuestionForTalk,
  resolveDAVEConversationContext,
} from './services/DAVEConversationContext';
import {
  findDAVETaskCandidates,
  type DAVETaskUpdateCommand,
} from './services/DAVETaskConversation';
import {
  createDAVEAskHistoryPersistence,
  daveAskHistoryStorageKey,
  resolveDAVEAskEvidenceNavigation,
  type DAVEAskConversationEntry,
} from './services/DAVEAskConversation';
import { type DAVEAskAnswer, type DAVEAskEvidence } from './services/DAVEAsk';
import type { DAVEVoiceUnderstandingResponse } from './services/DAVEVoiceUnderstanding';
import {
  buildDAVEProjectWalkContext,
  type DAVEProjectWalkContext,
  type DAVEProjectWalkLocationInput,
} from './services/DAVEProjectWalk';
import {
  buildDAVEProjectWalkFieldUpdateDraft,
  unusedConfirmedProjectWalkMemories,
} from './services/DAVEProjectWalkFieldUpdate';
import {
  createCaptureMemory,
  type DAVECaptureMemory,
  type DAVEConfirmedCaptureMemory,
} from './services/DAVECaptureMemory';
import {
  DAVE_CAPTURE_MEMORY_STORAGE_KEY,
  captureMemoryRepositoryStorageValue,
  localDAVECaptureMemoryRepository,
  normalizeConfirmedMemory,
} from './services/DAVECaptureMemoryRepository';
import {
  localDAVEIdentityRepository,
} from './services/DAVEIdentityRepository';
import type { DAVEIdentityCorrection } from './services/DAVEIdentity';
import {
  startDAVEProjectWalkSession,
  type DAVEProjectWalkSession,
} from './services/DAVEProjectWalkSession';
import { localDAVEProjectWalkSessionRepository } from './services/DAVEProjectWalkSessionRepository';
import {
  cacheSelectedProjectCoverPhoto,
  coverPhotoForProject,
  hydrateProjectCoverPhotoCache,
  mergeProjectRecords,
  normalizeProjectRecord,
  normalizeProjectRecords,
  projectRecordFromCloud,
  removeCachedProjectCoverPhoto,
  type ProjectCoverPhoto,
  type ProjectRecord,
} from './services/ProjectCoverPhotoService';
import { mostRecentProjectHeroPhoto, resolveProjectCoverImage, type ProjectCoverImage } from './services/ProjectCoverImage';
import {
  buildSixtySecondFlowTimingResult,
  type SixtySecondFlowTimingResult,
} from './services/SixtySecondFlowInstrumentation';
import {
  PIELiveAuthorityProvider,
  type PIELiveAuthorityInput,
  usePIELiveAuthority,
} from './providers/PIELiveAuthorityProvider';
import {
  automateLayer4DecisionLifecycle,
  buildLayer4DecisionCandidateFromExecutiveJudgment,
} from './services/PIELayer4Automation';
import type {
  PIEActor,
  PIEDecisionRecord,
  PIEEvidenceReference,
} from './services/PIEDecisionLedger';
import {
  resolvePIELayer4ActorContext,
  type PIELayer4ActorContext,
} from './services/PIELayer4Identity';
import {
  loadPIEDecisionLedgerForOrganization,
  savePIEDecisionLedgerForOrganization,
  type PIEDecisionLedgerMigrationStatus,
} from './services/PIEDecisionLedgerStorage';
import { createLocalPIEDecisionHistoryActions } from './services/LocalPIEDecisionHistoryActions';
import { buildVerifiedLearningEventsFromDecisionLedger } from './services/PIEDecisionOutcomeLearning';
import type { PIEExecutiveJudgmentRecord } from './services/PIEExecutiveJudgmentRepository';
import type { PIEReportDraft, PIEReportType } from './services/domains/reporting';
import {
  renderNativeReportDrawingPreview,
  resolveNativeReportWordMedia,
} from './services/ReportWordMedia.native';
import type { ReportDrawingReference } from './services/ReportDrawingReferences';
import {
  buildPIEScheduleReconciliation,
  reconcileCurrentScheduleDocuments,
  scheduleDocumentAddsToMaster, scheduleDocumentCurrentLabel, scheduleDocumentIsCurrentEverywhere, scheduleDocumentIsScheduleLike,
  selectAuthoritativeScheduleItems,
  type PIEScheduleFieldMatch,
  type PIEScheduleReconciliationWarning,
} from './services/PIEScheduleReconciliation';
import {
  buildPIEScheduleDependencyNetwork,
  type PIEScheduleDependencyNode,
} from './services/PIEScheduleDependencyNetwork';
import {
  explicitScheduleNote,
  normalizeImportedScheduleNote,
  normalizeMicrosoftProjectPdfRows,
  normalizeScheduleImport,
} from './services/PIEScheduleIntelligence';
import { extractScheduleItemsFromCommunicationText } from './services/PIEScheduleCommunicationImport';
import {
  findExactScheduleTaskForCompletionClaim,
  mergeReportedCompletionClaim,
  normalizeDAVECompletionVerification,
  rejectScheduleItemCompletion,
  scheduleCompletionVerificationLabel,
  scheduleItemNeedsCompletionVerification,
  verifyScheduleItemCompletion,
} from './services/DAVECompletionVerification';
import {
  bindPIEScheduleImportBatchProvenance,
  dedupeScheduleImportItems,
  scheduleImportItemIdentity,
  scheduleItemsForExactImportBatch, scheduleItemsOfUnbatchedDocument,
  scheduleItemsOnlyInImportBatch,
  scheduleOverviewProjectNames,
  resolveScheduleParentActions,
  scheduleParentProjectNames,
  scheduleProjectScopeNames,
  type PIEScheduleImportBatch,
} from './services/PIEScheduleImportBatch';
import {
  buildDAVEProjectScheduleRollup,
  scheduleTaskIsComplete,
  scheduleTasksForParentProject,
} from './services/dave-project-schedule-rollup';
import {
  normalizeScheduleStatus,
  reconcileScheduleProgress,
  reconcileScheduleProgressEdit,
} from './services/ScheduleProgressInvariant';
import {
  DEFAULT_PROJECT_TIME_ZONE,
  parseMonthNameDateParts,
  projectDateRelativeDays,
  projectTimeZoneOrDefault,
} from './services/ProjectDateTime';
import {
  deriveDAVEProjectOperationalStatus,
  operationalScheduleItemsForProject,
} from './services/DAVEProjectOperationalStatus';
import {
  daveConfirmedBlockerReason,
  findCurrentDAVEConfirmedBlocker,
  findCurrentDAVEConfirmedBlockerForScopes,
  updateHasOpenDAVEBlocker,
  updateHasOpenDAVESafetyConcern,
} from './services/DAVEProjectBlockerState';
import {
  canonicalizeDAVEScheduleItems,
  daveRegisteredIdentityNames,
  scheduleTaskGroupName,
} from './services/DAVEIdentity';
import { useIdentityAliasCleanup } from './hooks/use-identity-alias-cleanup';
import { useKeptTalkCapture } from './hooks/use-kept-talk-capture';
import { constructionRelevantObservations } from './services/dave-construction-relevance';
import { mergeApprovedScheduleImportItems, scheduleItemsVisibleBeforeImport, scheduleProgressCarriedOnActivation } from './services/ScheduleImportMerge';
import { scheduleImportAddsToMaster, scheduleItemsAfterLookaheadDeleted, scheduleLookaheadDeleteNote } from './services/ScheduleLookahead';
import { narrowScheduleDocumentLabels, scheduleDocumentsAfterApproval } from './services/ScheduleDocumentLabels';
import {
  extractTextFromPdf,
  isDavePdfTextExtractionAvailable,
  isDaveTextRecognitionAvailable,
  recognizeTextFromImage,
} from './modules/dave-text-recognition';
import type { AppScreen } from './types/app-navigation';
import { useAndroidHardwareBack, useAppNavigation } from './hooks/use-app-navigation';
import { useReportSelection } from './hooks/use-report-selection';
import { useECOSDocumentEvidence } from './hooks/use-ecos-document-evidence';
import {
  ecosDocumentProofClaimFromEvidence,
  loadAuthorizedECOSDocumentProofBundle,
} from './services/ECOSDocumentProofAuthority';
import { useECOSProjectQuestionExperience } from './hooks/use-ecos-project-question-experience';
import { useTalkSession } from './hooks/use-talk-session';
import { countLabel, pluralWord } from './utils/pluralization';
import type { ReactNode } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  AppState,
  FlatList,
  Image,
  InputAccessoryView,
  Keyboard,
  Linking,
  Modal,
  PanResponder,
  Platform,
  ScrollView,
  SectionList,
  StyleProp,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
  ViewStyle,
} from 'react-native';
import {
  SafeAreaProvider,
  SafeAreaView,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
type Screen = AppScreen;
type IconName = keyof typeof Ionicons.glyphMap;
type PhotoContinuityAnchor = import('./types').PhotoContinuityAnchor;
type ProjectUpdate = {
  id: string;
  projectName: string;
  date: string;
  photos: UpdatePhoto[];
  documents?: FieldUpdateDocument[];
  notes: string;
  sourceCaptureMemoryIds?: string[];
  sourceWalkSessionId?: string | null;
  scheduleItemId?: string | null;
  scheduleTaskName?: string | null;
  scheduleProjectName?: string | null;
  recipients: RecipientSelection;
  selectedAreaId?: string | null;
  selectedAreaName?: string | null;
  areaStatus?: 'confirmed' | 'suggested' | 'unknown';
  gpsLatitude?: number | null;
  gpsLongitude?: number | null;
  gpsAccuracy?: number | null;
  distanceFromSelectedAreaFeet?: number | null;
  locationCapturedAt?: string | null;
  quickContext?: QuickContext | null;
  safetyFlag?: boolean;
  blockerFlag?: boolean;
  continueWithoutPhotosAcknowledged?: boolean;
  pieStatus?: FieldUpdatePIEStatus;
  pieSummary?: string | null;
  observedFindings?: string[];
  possibleInterpretations?: string[];
  confirmedInterpretations?: string[];
  dismissedInterpretations?: string[];
  pieSuggestedNote?: string | null;
  pieSuggestedNoteAccepted?: boolean;
  interpretationDecisionLog?: PIEInterpretationDecisionLogEntry[];
  pieStartedAt?: string | null;
  pieCompletedAt?: string | null;
  status?: FieldUpdateStatus;
  stableSendId?: string | null;
  idempotencyKey?: string | null;
  sendAttempts?: number;
  lastSendAttemptAt?: string | null;
  syncDiagnostics?: FieldUpdateSyncDiagnostics | null;
  deleteDiagnostics?: FieldUpdateDeleteDiagnostics | null;
  generatedMessage?: string | null;
  archivedAt?: string | null;
  isArchived?: boolean;
  workflowTimestamps?: FieldUpdateWorkflowTimestamps;
};
type QuickContext =
  | 'Progress'
  | 'Safety'
  | 'Blocker'
  | 'Quality'
  | 'Material / Delivery'
  | 'Inspection'
  | 'Other';
type FieldUpdateStatus = PersistedFieldUpdateStatus;
type FieldUpdatePIEStatus =
  | 'not_started'
  | 'analyzing'
  | 'complete'
  | 'no_prior_photo'
  | 'no_visual_comparison'
  | 'failed'
  | 'taking_longer';
type ProjectDocumentStatus =
  | 'local'
  | 'uploading'
  | 'uploaded'
  | 'failed';
type ProjectDocument = {
  id: string;
  projectId: string;
  areaId?: string | null;
  updateId?: string | null;
  name: string;
  category: ProjectDocumentCategory;
  mimeType?: string | null;
  sizeBytes?: number | null;
  localUri?: string | null;
  ownedFileId?: string | null;
  ownedFileManifest?: unknown;
  referenceDocumentId?: string | null;
  storagePath?: string | null;
  uploadedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  note?: string | null;
  status: ProjectDocumentStatus;
  archivedAt?: string | null;
  isArchived?: boolean;
  isCurrent?: boolean;
  duplicateOf?: string | null;
  uploadAttemptCount?: number;
  lastUploadAttemptAt?: string | null;
  uploadProgress?: number | null;
  importedAt: string;
  drawingNumber?: string | null;
  drawingRevision?: string | null;
  drawingDiscipline?: string | null;
  drawingStatus?: ReferenceDocument['drawingStatus'];
  drawingIssuedAt?: string | null;
  webVersionGroupId?: string | null;
};
type FieldUpdateDocument = ProjectDocument;
type FieldUpdateWorkflowTimestamps = {
  startedAt?: string;
  cameraActionStartedAt?: string;
  firstPhotoAddedAt?: string;
  reviewOpenedAt?: string;
  sendTappedAt?: string;
  sendResolvedAt?: string;
};
type PIEInterpretationDecisionLogEntry = {
  id: string;
  interpretation: string;
  observations: string[];
  decision: 'confirmed' | 'dismissed';
  projectName: string;
  areaName: string | null;
  decidedAt: string;
};
type LocationSnapshot = {
  latitude: number;
  longitude: number;
  accuracy: number | null;
  capturedAt: string;
  /** iOS Precise Location is off for the app: fixes are only good to 1-3 km. */
  preciseLocationOff?: boolean;
};
type OverviewDetectionStatus =
  | 'checking'
  | 'detected'
  | 'denied'
  | 'multiple'
  | 'unmatched'
  | 'none'
  | 'unavailable';
type Phase2ActivityItem = {
  update: ProjectUpdate;
  projectName: string;
  dateLabel: string;
  areaLabel: string;
  photoCount: number;
  documentCount: number;
  pieStatus: string;
};
type Phase2AttentionItem = {
  id: string;
  updateId: string;
  photoId?: string;
  actionTarget: 'project' | 'update' | 'retry_photo_analysis' | 'retry_send';
  projectName: string;
  title: string;
  detail: string;
  areaLabel: string;
  dateLabel: string;
  priority: number;
  urgent: boolean;
  retryable: boolean;
  statusRole: StatusStyleRole;
};
type RestoredAppData = {
  savedUpdates: ProjectUpdate[]; projects: string[]; archivedProjects: string[];
  projectRecords: ProjectRecord[] | null;
  contactBook: ContactBook; projectAreas: ProjectArea[];
  referenceDocuments: ReferenceDocument[]; projectDocuments: ProjectDocument[];
  scheduleItems: ScheduleItem[];
  captureMemories: DAVEConfirmedCaptureMemory[];
  storedDraft: StoredDraft | null;
};
type ProjectStats = {
  updates: number;
  photos: number;
  openActions: number;
  overdueActions: number;
  dueThisWeek: number;
  lastUpdate?: string;
};
const UPDATES_STORAGE_KEY = 'projectPhotoUpdates.v2';
const DELETED_UPDATES_STORAGE_KEY = 'projectPhotoUpdate.deletedUpdates.v1';
const PROJECTS_STORAGE_KEY = 'projectPhotoUpdate.projects.v2';
const DELETED_PROJECTS_STORAGE_KEY = 'projectPhotoUpdate.deletedProjects.v1';
const ARCHIVED_PROJECTS_STORAGE_KEY = 'projectPhotoUpdate.archivedProjects.v2';
const BACKUP_KEEP_AWAKE_TAG = 'vitruvius-device-backup';
const CONTACTS_STORAGE_KEY = 'projectPhotoUpdate.contacts.v2';
const DRAFT_STORAGE_KEY = 'projectPhotoUpdate.activeDraft.v2';
const PROJECT_AREAS_STORAGE_KEY = 'projectPhotoUpdate.projectAreas.v1';
// v1 may contain full page/region indexes from legacy builds. Leave those
// bytes untouched for recovery, but never parse them during mobile startup.
const REFERENCE_DOCUMENTS_STORAGE_KEY = 'projectPhotoUpdate.referenceDocumentMetadata.v2';
const PROJECT_DOCUMENTS_STORAGE_KEY = 'projectPhotoUpdate.projectDocuments.v1';
const SCHEDULE_ITEMS_STORAGE_KEY = 'projectPhotoUpdate.scheduleItems.v1';
const DISPLAY_NAME_STORAGE_KEY = 'projectPhotoUpdate.displayName.v1';
const FIELD_UPDATE_TRANSACTION_JOURNAL_KEY =
  'projectPhotoUpdate.fieldUpdateTransaction.v1';
const FIELD_UPDATE_PERSISTENCE_KEYS = { journal: FIELD_UPDATE_TRANSACTION_JOURNAL_KEY, updates: UPDATES_STORAGE_KEY, tombstones: DELETED_UPDATES_STORAGE_KEY, draft: DRAFT_STORAGE_KEY };
const PROJECT_DELETION_STORAGE_KEYS: ProjectDeletionStorageKeys = {
  projects: PROJECTS_STORAGE_KEY, deletedProjects: DELETED_PROJECTS_STORAGE_KEY,
  archivedProjects: ARCHIVED_PROJECTS_STORAGE_KEY, updates: UPDATES_STORAGE_KEY,
  deletedUpdates: DELETED_UPDATES_STORAGE_KEY, updateDeletionJournal: PROJECT_UPDATE_DELETION_JOURNAL_STORAGE_KEY,
  projectDocuments: PROJECT_DOCUMENTS_STORAGE_KEY, referenceDocuments: REFERENCE_DOCUMENTS_STORAGE_KEY,
  projectAreas: PROJECT_AREAS_STORAGE_KEY,
  scheduleItems: SCHEDULE_ITEMS_STORAGE_KEY, daveSyncTombstones: DAVE_SYNC_TOMBSTONES_STORAGE_KEY,
  activeDraft: DRAFT_STORAGE_KEY, cloudIntents: PROJECT_DELETION_CLOUD_INTENTS_STORAGE_KEY,
  fileCleanupIntents: PROJECT_DELETION_FILE_CLEANUP_INTENTS_STORAGE_KEY,
};
const ANALYSIS_TIMEOUT_SECONDS = 135;
const PIE_ANALYSIS_PENDING_TIMEOUT_MS = ANALYSIS_TIMEOUT_SECONDS * 1000;
const GPS_CLEAR_WINNER_DISTANCE_FEET = 75;
const MAX_BACKUP_FILE_BYTES = MAX_DEVICE_BACKUP_BYTES;
const PHOTO_STORAGE_FOLDER = 'project-photos';
const PHOTO_STORAGE_DIR = FileSystem.documentDirectory
  ? `${FileSystem.documentDirectory}${PHOTO_STORAGE_FOLDER}/`
  : null;
const RECOVERED_PHOTO_CACHE_FOLDER = 'dave-recovered-project-photos';
// Manifest-owned project attachments must not share the legacy reference
// directory: legacy reference deletion authorizes direct children by path.
const OWNED_PROJECT_DOCUMENTS_DIR = FileSystem.documentDirectory
  ? `${FileSystem.documentDirectory}${OWNED_PROJECT_DOCUMENTS_FOLDER}/`
  : null;
const PROJECT_DOCUMENT_UPLOAD_FOLDER = 'project-documents';
const EMPTY_SELECTED_PROJECTS: Set<string> = new Set();
const GPS_CAPTURE_ENABLED = true;
const fieldUpdateLocalPersistence = createFieldUpdateLocalPersistence<ProjectUpdate, DeletedUpdateTombstone>({
  storage: AsyncStorage,
  keys: FIELD_UPDATE_PERSISTENCE_KEYS,
  createTransactionId: createProjectId,
  now: () => new Date().toISOString(),
  parseUpdate: normalizeStoredUpdateRecord,
  parseTombstone: parseStoredDeletedUpdateTombstone,
});
const projectDeletionRuntime = createProjectDeletionRuntime({
  storage: AsyncStorage, storageKeys: PROJECT_DELETION_STORAGE_KEYS,
  createTransactionId: createProjectId, now: () => new Date().toISOString(),
  getOfflineQueue, queueCloudProjectDelete: deleteCloudProject,
  cleanupLocalFile: createProjectDeletionLocalFileCleaner({
    ownedProjectDocumentsRoot: OWNED_PROJECT_DOCUMENTS_DIR, deleteOwnedReferenceDocument: deleteStoredReferenceDocument,
  }),
});
const backupRestoreRuntime = createBackupRestoreRuntime({
  storage: AsyncStorage,
  targetKeys: {
    updates: UPDATES_STORAGE_KEY, projects: PROJECTS_STORAGE_KEY, archivedProjects: ARCHIVED_PROJECTS_STORAGE_KEY,
    contacts: CONTACTS_STORAGE_KEY,
    projectAreas: PROJECT_AREAS_STORAGE_KEY, referenceDocuments: REFERENCE_DOCUMENTS_STORAGE_KEY,
    projectDocuments: PROJECT_DOCUMENTS_STORAGE_KEY, scheduleItems: SCHEDULE_ITEMS_STORAGE_KEY,
    captureMemories: DAVE_CAPTURE_MEMORY_STORAGE_KEY,
    activeDraft: DRAFT_STORAGE_KEY,
  },
  barrierKeys: {
    deletedProjects: DELETED_PROJECTS_STORAGE_KEY, deletedUpdates: DELETED_UPDATES_STORAGE_KEY,
    updateDeletionJournal: PROJECT_UPDATE_DELETION_JOURNAL_STORAGE_KEY,
    projectDeletionCloudIntents: PROJECT_DELETION_CLOUD_INTENTS_STORAGE_KEY,
    projectDeletionFileCleanupIntents: PROJECT_DELETION_FILE_CLEANUP_INTENTS_STORAGE_KEY,
    daveSyncTombstones: DAVE_SYNC_TOMBSTONES_STORAGE_KEY, fieldUpdateTransactionJournal: FIELD_UPDATE_TRANSACTION_JOURNAL_KEY,
    projectDeletionTransactionJournal: PROJECT_DELETION_TRANSACTION_JOURNAL_KEY,
  },
  createTransactionId: createProjectId, now: () => new Date().toISOString(),
  recoverProjectDeletion: projectDeletionRuntime.recoverBeforeStartupReads,
  recoverFieldUpdate: fieldUpdateLocalPersistence.recoverBeforeStartupReads,
  loadQueuedProjectDeletionNames: async () => (await getOfflineQueue())
    .flatMap(item => item.entity === 'project' && item.operation === 'delete' &&
      typeof (item.payload as Record<string, unknown>).name === 'string'
      ? [(item.payload as Record<string, string>).name] : []),
});
const localPIEDecisionHistoryActions = createLocalPIEDecisionHistoryActions();
const DEFAULT_PROJECTS = [
  '2321 Compliance Project',
  '2375 Compliance Project',
];
const LEGACY_PROJECT_STRUCTURE_CLOUD_MIGRATION_KEY =
  'projectPhotoUpdate.projectStructureCloudMigration.v1';
const LEGACY_NON_PROJECT_SHELL_CLOUD_MIGRATION_KEY =
  'projectPhotoUpdate.nonProjectShellCloudMigration.v1';
const LEGACY_WORK_CONTAINER_MIGRATIONS = [
  { legacyName: '2321 North Side Lot', parentProject: '2321 Compliance Project', workArea: 'North Side Lot' },
  { legacyName: '3 Hour Fire wall', parentProject: '2321 Compliance Project', workArea: '3 Hour Fire wall' },
  { legacyName: 'Building 2321  East Driveway', parentProject: '2321 Compliance Project', workArea: 'East Driveway' },
  { legacyName: 'Building 2375 Compliance', parentProject: '2375 Compliance Project', workArea: 'Building 2375' },
  { legacyName: 'Canopy A', parentProject: '2375 Compliance Project', workArea: 'Canopy A' },
  { legacyName: 'Canopy B', parentProject: '2375 Compliance Project', workArea: 'Canopy B' },
  { legacyName: 'Canopy C', parentProject: '2375 Compliance Project', workArea: 'Canopy C' },
] as const;
function legacyWorkContainerMigration(projectName: string | null | undefined) {
  const key = (projectName || '').trim().toLowerCase();
  return LEGACY_WORK_CONTAINER_MIGRATIONS.find(
    migration => migration.legacyName.toLowerCase() === key,
  ) || null;
}
function migrateLegacyProjectName(projectName: string | null | undefined) {
  const migration = legacyWorkContainerMigration(projectName);
  return migration?.parentProject || projectName || '';
}
function migratedWorkAreaName(
  currentArea: string | null | undefined,
  fallbackArea: string,
) {
  const current = (currentArea || '').trim();
  return current && current.toLowerCase() !== 'other' ? current : fallbackArea;
}

function migrateLegacyProjectUpdate(update: ProjectUpdate): ProjectUpdate {
  const migration = legacyWorkContainerMigration(update.projectName);
  if (!migration) return update;
  const selectedAreaName = migratedWorkAreaName(
    update.selectedAreaName,
    migration.workArea,
  );
  return {
    ...update,
    projectName: migration.parentProject,
    selectedAreaName,
    scheduleProjectName: update.scheduleProjectName
      ? migrateLegacyProjectName(update.scheduleProjectName)
      : update.scheduleProjectName,
    photos: update.photos.map(photo => ({
      ...photo,
      selectedAreaName: migratedWorkAreaName(
        photo.selectedAreaName,
        selectedAreaName,
      ),
    })),
    documents: update.documents?.map(document => ({
      ...document,
      projectId: authorityProjectId(migration.parentProject),
    })),
  };
}
function migrateLegacyScheduleItem(item: ScheduleItem): ScheduleItem {
  return {
    ...item,
    projectName: migrateLegacyProjectName(item.projectName),
    scheduleProjectName: item.scheduleProjectName
      ? migrateLegacyProjectName(item.scheduleProjectName)
      : item.scheduleProjectName,
  };
}
function migrateLegacyProjectDocument(document: ProjectDocument): ProjectDocument {
  const migration = LEGACY_WORK_CONTAINER_MIGRATIONS.find(item =>
    document.projectId === authorityProjectId(item.legacyName) ||
    document.projectId.toLowerCase() === item.legacyName.toLowerCase(),
  );
  return migration
    ? { ...document, projectId: authorityProjectId(migration.parentProject) }
    : document;
}
const REFERENCE_DOCUMENT_CATEGORIES = [
  'Site Plans',
  'Building 2321',
  'Building 2375',
  'H2 Room',
  'Fire Protection',
  'Civil',
  'Electrical',
  'Mechanical',
  'Schedules',
  'Report',
  'Other',
];
const COMPLIANCE_SENSITIVE_DOCUMENT_CATEGORIES: ProjectDocumentCategory[] = [
  'Permit Card',
  'Compliance',
  'Contract',
  'Inspection',
  'Safety',
];
const PIE_STATUS_COPY = {
  checking: 'Checking photos…',
  preparingSecureAnalysis: 'Preparing secure photo analysis…',
  signInRequired: 'Sign in required for photo intelligence',
  sessionExpired: 'Session expired · Sign in again',
  possibleChanges: 'Possible visual changes found',
  noReliableChange: 'No reliable visual change',
  noPriorPhoto: 'Baseline saved',
  unavailableRetry: 'Analysis unavailable · Retry',
  timeoutRetry: 'Analysis taking longer than expected · Retry',
} as const;
const PIE_AUTH_HYDRATION_RETRY_COUNT = 3;
const PIE_AUTH_HYDRATION_RETRY_DELAY_MS = 750;
const DRAFT_LOCATION_CAPTURE_WAIT_MS = 1500;
const ENABLE_DEV_AUTH_SIGNUP =
  __DEV__ && process.env.EXPO_PUBLIC_ENABLE_DEV_AUTH_SIGNUP === 'true';
const ATTENTION_PRIORITY = {
  safety: 0,
  sendIssue: 1,
  analysisIssue: 2,
  readyToSend: 3,
  blocker: 4,
  documentIssue: 5,
  otherOpenItem: 6,
} as const;
type StatusStyleRole =
  | 'safety'
  | 'possibleFinding'
  | 'interpretation'
  | 'informational'
  | 'needsRetry'
  | 'confirmedClear';
const STATUS_ICON_COLOR_MAP: Record<
  StatusStyleRole,
  {
    icon: IconName;
    colorRole: 'danger' | 'primary' | 'insight' | 'muted' | 'warning' | 'success';
    backgroundRole: 'dangerSoft' | 'primarySoft' | 'insightSoft' | 'fill' | 'warningSoft' | 'successSoft';
  }
> = {
  safety: {
    icon: 'warning-outline',
    colorRole: 'danger',
    backgroundRole: 'dangerSoft',
  },
  possibleFinding: {
    icon: 'search-outline',
    colorRole: 'primary',
    backgroundRole: 'primarySoft',
  },
  interpretation: {
    icon: 'bulb-outline',
    colorRole: 'insight',
    backgroundRole: 'insightSoft',
  },
  informational: {
    icon: 'information-circle-outline',
    colorRole: 'muted',
    backgroundRole: 'fill',
  },
  needsRetry: {
    icon: 'refresh-outline',
    colorRole: 'warning',
    backgroundRole: 'warningSoft',
  },
  confirmedClear: {
    icon: 'checkmark-circle-outline',
    colorRole: 'success',
    backgroundRole: 'successSoft',
  },
};
// Placeholder coordinates: stand in each area and use "Use Current Location"
// in Manage Areas to replace these with real worksite GPS points.
const CATEGORIES: PhotoCategory[] = [
  'Open Issue',
  'Safety Concern',
  'Update',
];
const QUICK_CONTEXTS: QuickContext[] = [
  'Progress',
  'Safety',
  'Blocker',
  'Quality',
  'Material / Delivery',
  'Inspection',
  'Other',
];
const CATEGORY_ICONS: Record<PhotoCategory, IconName> = {
  'Open Issue': 'alert-circle-outline',
  'Safety Concern': 'warning-outline',
  Update: 'information-circle-outline',
};
const ACTION_STATUSES: ActionStatus[] = [
  'Open',
  'In Progress',
  'Waiting',
  'Closed',
];
const SCHEDULE_STATUSES: ScheduleStatus[] = [
  'Not Started',
  'In Progress',
  'Waiting',
  'Complete',
];
const SCHEDULE_PRIORITIES: SchedulePriority[] = [
  'Low',
  'Medium',
  'High',
];
const zeroPad = (value: number) => value.toString().padStart(2, '0');
function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

const isoToday = () => {
  const today = new Date();

  return `${today.getFullYear()}-${zeroPad(today.getMonth() + 1)}-${zeroPad(
    today.getDate(),
  )}`;
};

const emptyRecipients = (): RecipientSelection => ({
  contactIds: [],
});

function createDraft(projectName: string): ProjectUpdate {
  const now = new Date().toISOString();

  return {
    id: uid(),
    projectName,
    date: isoToday(),
    photos: [],
    documents: [],
    notes: '',
    sourceCaptureMemoryIds: [],
    sourceWalkSessionId: null,
    scheduleItemId: null,
    scheduleTaskName: null,
    scheduleProjectName: null,
    recipients: emptyRecipients(),
    selectedAreaId: null,
    selectedAreaName: 'Unassigned / Unknown Area',
    areaStatus: 'unknown',
    quickContext: null,
    safetyFlag: false,
    blockerFlag: false,
    continueWithoutPhotosAcknowledged: false,
    pieStatus: 'not_started',
    pieSummary: null,
    observedFindings: [],
    possibleInterpretations: [],
    confirmedInterpretations: [],
    dismissedInterpretations: [],
    pieSuggestedNote: null,
    pieSuggestedNoteAccepted: false,
    interpretationDecisionLog: [],
    pieStartedAt: null,
    pieCompletedAt: null,
    status: 'draft',
    stableSendId: null,
    idempotencyKey: null,
    sendAttempts: 0,
    lastSendAttemptAt: null,
    generatedMessage: null,
    archivedAt: null,
    isArchived: false,
    workflowTimestamps: {
      startedAt: now,
    },
  };
}

function hasMeaningfulDraft(update: ProjectUpdate) {
  return (
    update.photos.length > 0 ||
    (update.documents?.length || 0) > 0 ||
    update.notes.trim().length > 0 ||
    update.recipients.contactIds.length > 0 ||
    Boolean(update.scheduleItemId?.trim()) ||
    Boolean(update.scheduleTaskName?.trim()) ||
    Boolean(update.quickContext) ||
    Boolean(update.continueWithoutPhotosAcknowledged)
  );
}

function hasDraftContent(update: ProjectUpdate) {
  return (
    update.photos.length > 0 ||
    (update.documents?.length || 0) > 0 ||
    update.notes.trim().length > 0 ||
    Boolean(update.quickContext) ||
    Boolean(update.continueWithoutPhotosAcknowledged)
  );
}

function formatDisplayDate(date: string) {
  const [year, month, day] = date.split('-').map(Number);

  return new Date(year, month - 1, day).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

type UpdateTimelineGroup = 'Today' | 'Yesterday' | 'Earlier';

function updateDateValue(value: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function updateTimelineGroup(value: string, now = new Date()): UpdateTimelineGroup {
  const date = updateDateValue(value);
  if (!date) return 'Earlier';

  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfUpdate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const dayDifference = Math.round(
    (startOfToday.getTime() - startOfUpdate.getTime()) / (24 * 60 * 60 * 1000),
  );

  if (dayDifference <= 0) return 'Today';
  if (dayDifference === 1) return 'Yesterday';
  return 'Earlier';
}

function relativeUpdateTimestamp(value: string, now = new Date()) {
  const date = updateDateValue(value);
  if (!date) return formatDisplayDate(value);

  const elapsedMinutes = Math.max(0, Math.floor((now.getTime() - date.getTime()) / 60000));
  if (elapsedMinutes < 1) return 'Just now';
  if (elapsedMinutes < 60) return `${elapsedMinutes}m ago`;

  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) return `${elapsedHours}h ago`;
  if (elapsedHours < 48) return 'Yesterday';
  return formatDisplayDate(value);
}

function formatSavedTime(value: string | null) {
  if (!value) return 'Recently';

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return 'Recently';

  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function analysisTimeTextForPIEResult(value: string | null | undefined) {
  if (!value) return 'Analysis time unavailable';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Analysis time unavailable';

  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function ensureSentence(text: string) {
  const trimmed = text.trim();

  if (!trimmed) return '';

  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

function parseDueDate(value: string) {
  const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);

  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);

  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }

  date.setHours(0, 0, 0, 0);
  return date;
}

function formatDueDate(value: string) {
  const date = parseDueDate(value);

  if (!date) return value.trim();

  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function isActionCategory(category: PhotoCategory) {
  return category === 'Open Issue' || category === 'Safety Concern';
}

function isOpenAction(photo: UpdatePhoto) {
  return (
    isActionCategory(photo.category) &&
    photo.actionStatus !== 'Closed' &&
    Boolean(
      photo.actionRequired.trim() ||
        photo.actionOwner.trim() ||
        photo.actionDueDate.trim(),
    )
  );
}

function isOverdueAction(photo: UpdatePhoto) {
  if (!isOpenAction(photo)) return false;
  const days = daysUntilDate(photo.actionDueDate);
  return days !== null && days < 0;
}

function isDueThisWeek(photo: UpdatePhoto) {
  if (!isOpenAction(photo)) return false;
  const days = daysUntilDate(photo.actionDueDate);
  return days !== null && days >= 0 && days <= 7;
}

function isDueTodayAction(photo: UpdatePhoto) {
  if (!isOpenAction(photo)) return false;
  return daysUntilDate(photo.actionDueDate) === 0;
}

function optionalNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : null;
}


function optionalBoolean(value: unknown) {
  return typeof value === 'boolean' ? value : false;
}

function optionalFiniteNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : null;
}

function uniqueStrings(values: string[]) {
  const seen = new Set<string>();
  const next: string[] = [];

  values.forEach(value => {
    const trimmed = value.trim();

    if (!trimmed) return;

    const key = trimmed.toLowerCase();

    if (seen.has(key)) return;

    seen.add(key);
    next.push(trimmed);
  });

  return next;
}

function normalizePhoto(photo: Partial<UpdatePhoto>): UpdatePhoto {
  return {
    id: typeof photo.id === 'string' ? photo.id : uid(),
    uri: typeof photo.uri === 'string' ? resolveProjectPhotoUri(photo) : '',
    caption: typeof photo.caption === 'string' ? photo.caption : '',
    category: CATEGORIES.includes(photo.category as PhotoCategory)
      ? (photo.category as PhotoCategory)
      : 'Update',
    actionRequired:
      typeof photo.actionRequired === 'string'
        ? photo.actionRequired
        : '',
    actionOwner:
      typeof photo.actionOwner === 'string'
        ? photo.actionOwner
        : '',
    actionDueDate:
      typeof photo.actionDueDate === 'string'
        ? photo.actionDueDate
        : '',
    actionStatus: ACTION_STATUSES.includes(
      photo.actionStatus as ActionStatus,
    )
      ? (photo.actionStatus as ActionStatus)
      : 'Open',
    fileName: photo.fileName,
    mimeType: photo.mimeType || 'image/jpeg',
    cloudStoragePath: optionalString(photo.cloudStoragePath),
    cloudRecoveredAt: optionalString(photo.cloudRecoveredAt),
    cloudRecoveryStatus:
      photo.cloudRecoveryStatus === 'cached' ||
      photo.cloudRecoveryStatus === 'signed_url' ||
      photo.cloudRecoveryStatus === 'unavailable'
        ? photo.cloudRecoveryStatus
        : null,
    cloudSignedUrlExpiresAt: optionalString(photo.cloudSignedUrlExpiresAt),
    cloudPreviewUri: optionalString(photo.cloudPreviewUri),
    cloudPreviewSignedUrlExpiresAt: optionalString(
      photo.cloudPreviewSignedUrlExpiresAt,
    ),
    continuityAnchor: photo.continuityAnchor || null,
    ...(photo.pickedFromLibrary === true ? { pickedFromLibrary: true } : {}),
    selectedAreaId: optionalString(photo.selectedAreaId),
    selectedAreaName: optionalString(photo.selectedAreaName),
    gpsLatitude: optionalNumber(photo.gpsLatitude),
    gpsLongitude: optionalNumber(photo.gpsLongitude),
    gpsAccuracy: optionalNumber(photo.gpsAccuracy),
    distanceFromSelectedAreaFeet: optionalNumber(
      photo.distanceFromSelectedAreaFeet,
    ),
    locationCapturedAt: optionalString(photo.locationCapturedAt),
    photoIntelligence: withStoredPhotoComparisonCap(photo.photoIntelligence), // pre-Q9 results capped when read (audit round 2 L1)
  };
}

function normalizeProjectDocumentCategory(
  value: unknown,
): ProjectDocumentCategory {
  return PROJECT_DOCUMENT_CATEGORIES.includes(value as ProjectDocumentCategory)
    ? (value as ProjectDocumentCategory)
    : 'Other';
}

function normalizeProjectDocumentStatus(
  value: unknown,
): ProjectDocumentStatus {
  if (
    value === 'local' ||
    value === 'uploading' ||
    value === 'uploaded' ||
    value === 'failed'
  ) {
    return value;
  }

  return 'local';
}

function normalizeProjectDocument(
  value: unknown,
  fallback?: {
    projectId?: string;
    areaId?: string | null;
    updateId?: string | null;
  },
): ProjectDocument | null {
  if (!isRecord(value)) return null;

  const now = new Date().toISOString();
  const createdAt =
    optionalString(value.createdAt) ||
    optionalString(value.importedAt) ||
    now;
  const name =
    optionalString(value.name) ||
    optionalString(value.originalFileName) ||
    'Attached document';
  const projectId =
    optionalString(value.projectId) ||
    fallback?.projectId ||
    'project-unassigned';
  const storagePath = optionalString(value.storagePath);
  const uploadedAt = optionalString(value.uploadedAt);
  const status = normalizeProjectDocumentStatus(value.status);
  const category = normalizeProjectDocumentCategory(value.category);
  const ownedFileId = optionalString(value.ownedFileId);
  const ownedFileManifest = ownedFileId && ownsProjectDocumentFile(
    value.ownedFileManifest,
    ownedFileId,
  ) ? value.ownedFileManifest : null;

  return {
    id: optionalString(value.id) || uid(),
    projectId,
    areaId: optionalString(value.areaId) || fallback?.areaId || null,
    updateId: optionalString(value.updateId) || fallback?.updateId || null,
    name,
    category,
    mimeType: optionalString(value.mimeType),
    sizeBytes: optionalFiniteNumber(value.sizeBytes),
    localUri:
      optionalString(value.localUri) ||
      optionalString(value.uri) ||
      null,
    ownedFileId: ownedFileManifest ? ownedFileId : null,
    ownedFileManifest,
    referenceDocumentId: optionalString(value.referenceDocumentId),
    storagePath,
    uploadedAt,
    createdAt,
    updatedAt: optionalString(value.updatedAt) || createdAt,
    note: optionalString(value.note) || optionalString(value.notes),
    status: uploadedAt ? 'uploaded' : status,
    archivedAt: optionalString(value.archivedAt),
    isArchived: optionalBoolean(value.isArchived),
    isCurrent: category === 'Schedule' && optionalBoolean(value.isCurrent),
    duplicateOf: optionalString(value.duplicateOf),
    uploadAttemptCount: optionalFiniteNumber(value.uploadAttemptCount) || 0,
    lastUploadAttemptAt: optionalString(value.lastUploadAttemptAt),
    importedAt: optionalString(value.importedAt) || createdAt,
    drawingNumber: optionalString(value.drawingNumber),
    drawingRevision: optionalString(value.drawingRevision),
    drawingDiscipline: optionalString(value.drawingDiscipline),
    drawingStatus:
      value.drawingStatus === 'Draft' ||
      value.drawingStatus === 'For Review' ||
      value.drawingStatus === 'For Construction' ||
      value.drawingStatus === 'As-Built' ||
      value.drawingStatus === 'Superseded'
        ? value.drawingStatus
        : null,
    drawingIssuedAt: optionalString(value.drawingIssuedAt),
    webVersionGroupId: optionalString(value.webVersionGroupId),
  };
}

function ownsProjectDocumentFile(manifest: unknown, fileId: string) {
  try {
    return isOwnedLocalFileManifestMember(manifest, fileId, 'project_document');
  } catch {
    return false;
  }
}

function normalizeFieldUpdateDocuments(
  value: unknown,
  fallback?: {
    projectId?: string;
    areaId?: string | null;
    updateId?: string | null;
  },
): FieldUpdateDocument[] {
  if (!Array.isArray(value)) return [];

  return value
    .map(item => normalizeProjectDocument(item, fallback))
    .filter(Boolean) as FieldUpdateDocument[];
}

function normalizeProjectDocuments(value: unknown): ProjectDocument[] {
  if (!Array.isArray(value)) return [];

  return value
    .map(item => normalizeProjectDocument(item))
    .filter(Boolean) as ProjectDocument[];
}

function normalizeWorkflowTimestamps(
  value: unknown,
): FieldUpdateWorkflowTimestamps {
  if (!isRecord(value)) return {};

  return {
    startedAt: optionalString(value.startedAt) || undefined,
    cameraActionStartedAt: optionalString(value.cameraActionStartedAt) || undefined,
    firstPhotoAddedAt: optionalString(value.firstPhotoAddedAt) || undefined,
    reviewOpenedAt: optionalString(value.reviewOpenedAt) || undefined,
    sendTappedAt: optionalString(value.sendTappedAt) || undefined,
    sendResolvedAt: optionalString(value.sendResolvedAt) || undefined,
  };
}

function normalizeInterpretationDecisionLog(
  value: unknown,
): PIEInterpretationDecisionLogEntry[] {
  if (!Array.isArray(value)) return [];

  return value
    .map(item => {
      if (!isRecord(item)) return null;
      const interpretation = optionalString(item.interpretation);
      const decision = item.decision === 'confirmed' || item.decision === 'dismissed'
        ? item.decision
        : null;
      if (!interpretation || !decision) return null;

      return {
        id: optionalString(item.id) || uid(),
        interpretation,
        observations: normalizeStringList(item.observations),
        decision,
        projectName: optionalString(item.projectName) || DEFAULT_PROJECTS[0],
        areaName: optionalString(item.areaName),
        decidedAt: optionalString(item.decidedAt) || new Date().toISOString(),
      };
    })
    .filter(Boolean) as PIEInterpretationDecisionLogEntry[];
}

function normalizeFieldUpdateDeleteDiagnostics(value: unknown): FieldUpdateDeleteDiagnostics | null {
  if (!isRecord(value)) return null;

  const lifecycleStatus =
    value.lifecycleStatus === 'draft' ||
    value.lifecycleStatus === 'ready_to_send' ||
    value.lifecycleStatus === 'queued' ||
    value.lifecycleStatus === 'sent' ||
    value.lifecycleStatus === 'failed'
      ? value.lifecycleStatus
      : 'draft';
  const sourceAfterReload =
    value.sourceAfterReload === 'local' ||
    value.sourceAfterReload === 'cloud' ||
    value.sourceAfterReload === 'pending' ||
    value.sourceAfterReload === 'orphaned-photo' ||
    value.sourceAfterReload === 'unknown'
      ? value.sourceAfterReload
      : 'unknown';
  const mergeDecision =
    value.mergeDecision === 'included' ||
    value.mergeDecision === 'excluded' ||
    value.mergeDecision === 'tombstoned'
      ? value.mergeDecision
      : 'included';

  return {
    updateId: optionalString(value.updateId) || optionalString(value.localId) || 'unknown',
    localId: optionalString(value.localId) || optionalString(value.updateId) || 'unknown',
    cloudIdPresent: value.cloudIdPresent === true,
    lifecycleStatus,
    pendingSync: value.pendingSync === true,
    tombstoned: value.tombstoned === true,
    deletedAt: optionalString(value.deletedAt),
    sourceAfterReload,
    mergeDecision,
    orphanedPhotoCountIgnored:
      typeof value.orphanedPhotoCountIgnored === 'number' &&
      Number.isFinite(value.orphanedPhotoCountIgnored)
        ? value.orphanedPhotoCountIgnored
        : 0,
  };
}

function normalizeDeletedUpdateTombstones(value: unknown): DeletedUpdateTombstone[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((item): DeletedUpdateTombstone | null => {
      const diagnostics = normalizeFieldUpdateDeleteDiagnostics(item);
      if (!diagnostics || diagnostics.updateId === 'unknown') return null;
      const record = isRecord(item) ? item : {};
      const action =
        record.action === 'delete_failed_update' ||
        record.action === 'delete_update_everywhere' ||
        record.action === 'remove_from_device' ||
        record.action === 'archive_sent_update' ||
        record.action === 'hide_cloud_update'
          ? record.action
          : diagnostics.lifecycleStatus === 'sent'
            ? 'archive_sent_update'
            : 'remove_from_device';

      return {
        ...diagnostics,
        tombstoned: true,
        mergeDecision: 'tombstoned',
        action,
      };
    })
    .filter((item): item is DeletedUpdateTombstone => Boolean(item));
}

function parseStoredDeletedUpdateTombstone(value: unknown): DeletedUpdateTombstone {
  if (!isStartupDeletedUpdateRecord(value)) throw new Error('Saved update deletion record is invalid.');
  const tombstone = normalizeDeletedUpdateTombstones([value])[0];
  if (!tombstone) throw new Error('Saved update deletion record could not be normalized.');
  return tombstone;
}

export function normalizeUpdate(update: Partial<ProjectUpdate>): ProjectUpdate {
  const updateId = typeof update.id === 'string' ? update.id : uid();
  const projectName =
    typeof update.projectName === 'string'
      ? update.projectName
      : DEFAULT_PROJECTS[0];

  return {
    // Same reasoning as normalizeScheduleItem: this rebuilds the record from
    // an explicit field list, so any field written by another surface or an
    // earlier build was destroyed here. For schedule items that surfaced
    // loudly, because their upload verifies the stored revision and refused
    // the write. Field updates have no such check, so a dropped field is
    // silently uploaded back over the good cloud copy instead — quieter, and
    // worse. Managed fields below still override, and photo internals such as
    // _backupAssetId are handled by normalizePhoto, not here.
    ...update,
    id: updateId,
    projectName,
    date: typeof update.date === 'string' ? update.date : isoToday(),
    photos: Array.isArray(update.photos)
      ? update.photos
          .map(normalizePhoto)
          .filter(photo => Boolean(
            resolveProjectPhotoDisplayUri(photo) || photo.cloudStoragePath,
          ))
      : [],
    documents: normalizeFieldUpdateDocuments(update.documents, {
      projectId: authorityProjectId(projectName),
      areaId: optionalString(update.selectedAreaId),
      updateId,
    }),
    notes: typeof update.notes === 'string' ? update.notes : '',
    sourceCaptureMemoryIds: Array.isArray(update.sourceCaptureMemoryIds)
      ? uniqueStrings(update.sourceCaptureMemoryIds.filter(item => typeof item === 'string'))
      : [],
    sourceWalkSessionId: optionalString(update.sourceWalkSessionId),
    scheduleItemId: optionalString(update.scheduleItemId),
    scheduleTaskName: optionalString(update.scheduleTaskName),
    scheduleProjectName: optionalString(update.scheduleProjectName),
    recipients: normalizeRecipientSelection(update.recipients),
    selectedAreaId: optionalString(update.selectedAreaId),
    selectedAreaName: optionalString(update.selectedAreaName),
    areaStatus:
      update.areaStatus === 'confirmed' ||
      update.areaStatus === 'suggested' ||
      update.areaStatus === 'unknown'
        ? update.areaStatus
        : update.selectedAreaId || update.selectedAreaName
          ? 'confirmed'
          : 'unknown',
    gpsLatitude: optionalNumber(update.gpsLatitude),
    gpsLongitude: optionalNumber(update.gpsLongitude),
    gpsAccuracy: optionalNumber(update.gpsAccuracy),
    distanceFromSelectedAreaFeet: optionalNumber(
      update.distanceFromSelectedAreaFeet,
    ),
    locationCapturedAt: optionalString(update.locationCapturedAt),
    quickContext: QUICK_CONTEXTS.includes(update.quickContext as QuickContext)
      ? (update.quickContext as QuickContext)
      : null,
    safetyFlag: Boolean(update.safetyFlag),
    blockerFlag: Boolean(update.blockerFlag),
    continueWithoutPhotosAcknowledged: Boolean(
      update.continueWithoutPhotosAcknowledged,
    ),
    pieStatus:
      update.pieStatus === 'analyzing' ||
      update.pieStatus === 'complete' ||
      update.pieStatus === 'no_prior_photo' ||
      update.pieStatus === 'no_visual_comparison' ||
      update.pieStatus === 'failed' ||
      update.pieStatus === 'taking_longer'
        ? update.pieStatus
        : 'not_started',
    pieSummary: optionalString(update.pieSummary),
    observedFindings: Array.isArray(update.observedFindings)
      ? update.observedFindings.filter(item => typeof item === 'string')
      : [],
    possibleInterpretations: Array.isArray(update.possibleInterpretations)
      ? update.possibleInterpretations.filter(item => typeof item === 'string')
      : [],
    confirmedInterpretations: Array.isArray(update.confirmedInterpretations)
      ? update.confirmedInterpretations.filter(item => typeof item === 'string')
      : [],
    dismissedInterpretations: Array.isArray(update.dismissedInterpretations)
      ? update.dismissedInterpretations.filter(item => typeof item === 'string')
      : [],
    pieSuggestedNote: optionalString(update.pieSuggestedNote),
    pieSuggestedNoteAccepted: Boolean(update.pieSuggestedNoteAccepted),
    interpretationDecisionLog: normalizeInterpretationDecisionLog(
      update.interpretationDecisionLog,
    ),
    pieStartedAt: optionalString(update.pieStartedAt),
    pieCompletedAt: optionalString(update.pieCompletedAt),
    status:
      update.status === 'ready_to_send' ||
      update.status === 'queued' ||
      update.status === 'sent' ||
      update.status === 'failed'
        ? update.status
        : 'draft',
    stableSendId: optionalString(update.stableSendId),
    idempotencyKey: optionalString(update.idempotencyKey) || optionalString(update.stableSendId),
    sendAttempts:
      typeof update.sendAttempts === 'number' && Number.isFinite(update.sendAttempts)
        ? update.sendAttempts
        : 0,
    lastSendAttemptAt: optionalString(update.lastSendAttemptAt),
    syncDiagnostics: normalizeFieldUpdateSyncDiagnostics(update.syncDiagnostics),
    deleteDiagnostics: normalizeFieldUpdateDeleteDiagnostics(update.deleteDiagnostics),
    generatedMessage: optionalString(update.generatedMessage),
    archivedAt: optionalString(update.archivedAt),
    isArchived: Boolean(update.isArchived),
    workflowTimestamps: normalizeWorkflowTimestamps(update.workflowTimestamps),
  };
}

function normalizeStoredUpdateRecord(value: unknown): ProjectUpdate {
  if (!isRecord(value) || typeof value.id !== 'string' || !value.id.trim()) {
    throw new Error('Saved update record is missing a stable ID.');
  }
  return migrateLegacyProjectUpdate(normalizeUpdate(value as Partial<ProjectUpdate>));
}

function isStartupDeviceSavedUpdateRecord(value: unknown) {
  if (!isStartupSavedUpdateRecord(value) || !isRecord(value)) return false;
  if (!Array.isArray(value.photos)) return true;
  return value.photos.every(photo =>
    Boolean(
      resolveProjectPhotoDisplayUri(photo as Partial<UpdatePhoto>) ||
      (photo as Partial<UpdatePhoto>).cloudStoragePath,
    ),
  );
}

function normalizeRecipientSelection(value: unknown): RecipientSelection {
  const raw =
    value && typeof value === 'object'
      ? (value as Partial<RecipientSelection>)
      : {};

  return {
    contactIds: Array.isArray(raw.contactIds)
      ? raw.contactIds.filter(id => typeof id === 'string')
      : [],
  };
}

function normalizeContact(value: Partial<ProjectContact>): ProjectContact {
  const emails = uniqueStrings([
    ...(Array.isArray(value.emails)
      ? value.emails.filter(item => typeof item === 'string')
      : []),
    typeof value.email === 'string' ? value.email : '',
  ]);

  const phones = uniqueStrings([
    ...(Array.isArray(value.phones)
      ? value.phones.filter(item => typeof item === 'string')
      : []),
    typeof value.phone === 'string' ? value.phone : '',
  ]);

  const selectedEmail =
    typeof value.selectedEmail === 'string' &&
    emails.some(email => email.toLowerCase() === value.selectedEmail?.trim().toLowerCase())
      ? value.selectedEmail.trim()
      : emails[0] || '';

  const selectedPhone =
    typeof value.selectedPhone === 'string' &&
    phones.some(phone => phone === value.selectedPhone?.trim())
      ? value.selectedPhone.trim()
      : phones[0] || '';

  return {
    id: typeof value.id === 'string' ? value.id : uid(),
    name: typeof value.name === 'string' ? value.name : '',
    email: selectedEmail,
    phone: selectedPhone,
    emails,
    phones,
    selectedEmail: selectedEmail || null,
    selectedPhone: selectedPhone || null,
  };
}

function selectedContactEmail(contact: ProjectContact) {
  const normalized = normalizeContact(contact);

  return normalized.selectedEmail || normalized.email || normalized.emails?.[0] || '';
}

function selectedContactPhone(contact: ProjectContact) {
  const normalized = normalizeContact(contact);

  return normalized.selectedPhone || normalized.phone || normalized.phones?.[0] || '';
}

function normalizeContacts(value: unknown): ContactBook {
  if (!value || typeof value !== 'object') {
    return { contacts: [] };
  }

  const raw = value as Record<string, unknown>;
  const directContacts = raw.contacts;

  if (Array.isArray(directContacts)) {
    const contacts = directContacts
      .map(item => normalizeContact(item as Partial<ProjectContact>))
      .filter(
        contact =>
          contact.name.trim() ||
          contact.email.trim() ||
          contact.phone.trim(),
      );

    return { contacts };
  }

  const contacts: ProjectContact[] = [];
  const contactKeyToId: Record<string, string> = {};

  Object.keys(raw).forEach(project => {
    const list = raw[project];

    if (!Array.isArray(list)) return;

    list
      .map(item => normalizeContact(item as Partial<ProjectContact>))
      .filter(
        contact =>
          contact.name.trim() ||
          contact.email.trim() ||
          contact.phone.trim(),
      )
      .forEach(contact => {
        const key = `${contact.name.trim().toLowerCase()}|${contact.email
          .trim()
          .toLowerCase()}|${contact.phone.trim()}`;

        if (!contactKeyToId[key]) {
          contactKeyToId[key] = contact.id;
          contacts.push(contact);
        }
      });
  });

  return { contacts };
}

function expandRecipients(
  contactBook: ContactBook,
  selection: RecipientSelection,
) {
  const ids = new Set(selection.contactIds);

  return contactBook.contacts.filter(contact => ids.has(contact.id));
}

function phoneContactDisplayName(contact: Contacts.ExistingContact) {
  return (
    contact.name ||
    [contact.firstName, contact.lastName].filter(Boolean).join(' ') ||
    contact.company ||
    'Unnamed Contact'
  );
}

function contactEmails(contact: Contacts.ExistingContact) {
  return uniqueStrings(
    contact.emails
      ?.map(item => item.email?.trim() || '')
      .filter(Boolean) || [],
  );
}

function contactPhones(contact: Contacts.ExistingContact) {
  return uniqueStrings(
    contact.phoneNumbers
      ?.map(item => item.number?.trim() || '')
      .filter(Boolean) || [],
  );
}

function phoneContactToProjectContact(
  contact: Contacts.ExistingContact,
): ProjectContact {
  const emails = contactEmails(contact);
  const phones = contactPhones(contact);

  return normalizeContact({
    id: `phone-${contact.id}`,
    name: phoneContactDisplayName(contact).trim(),
    email: emails[0] || '',
    phone: phones[0] || '',
    emails,
    phones,
    selectedEmail: emails[0] || null,
    selectedPhone: phones[0] || null,
  });
}

function hasActionDetails(photo: UpdatePhoto) {
  return Boolean(
    photo.actionRequired.trim() ||
      photo.actionOwner.trim() ||
      photo.actionDueDate.trim(),
  );
}

function hasPhotoMessageContent(photo: UpdatePhoto) {
  return (
    photo.caption.trim().length > 0 ||
    (isActionCategory(photo.category) && hasActionDetails(photo))
  );
}

function hasSavableUpdate(update: ProjectUpdate) {
  return (
    update.photos.length > 0 ||
    (update.documents?.length || 0) > 0 ||
    update.notes.trim().length > 0 ||
    Boolean(update.scheduleItemId?.trim()) ||
    Boolean(update.scheduleTaskName?.trim()) ||
    Boolean(update.quickContext) ||
    Boolean(update.continueWithoutPhotosAcknowledged) ||
    update.photos.some(
      photo =>
        photo.caption.trim() ||
        photo.actionRequired.trim() ||
        photo.actionOwner.trim() ||
        photo.actionDueDate.trim(),
    )
  );
}

function findInvalidDueDatePhoto(update: ProjectUpdate) {
  return update.photos.findIndex(
    photo =>
      photo.actionDueDate.trim() &&
      !parseDueDate(photo.actionDueDate),
  );
}

function normalizeStringList(value: unknown) {
  return Array.isArray(value)
    ? value
        .map(item => (typeof item === 'string' ? item.trim() : ''))
        .filter(Boolean)
    : [];
}


function projectAreaSetupStats(projectAreas: ProjectArea[]) {
  const total = projectAreas.length;
  const saved = projectAreas.filter(hasSavedAreaLocation).length;
  const missing = Math.max(total - saved, 0);
  const percent = total > 0 ? Math.round((saved / total) * 100) : 0;

  return {
    total,
    saved,
    missing,
    percent,
  };
}

function normalizeProjectAreas(value: unknown) {
  if (!Array.isArray(value)) return DEFAULT_PROJECT_AREAS;

  return value.map(item => normalizeProjectArea(item as Partial<ProjectArea>));
}


function isStartupDeviceDraftEnvelope(value: unknown) {
  if (!isStartupDraftEnvelope(value) || !isRecord(value)) return false;
  if (!('draft' in value)) return true;
  return isStartupDeviceSavedUpdateRecord(value.draft);
}


function filenameFromDocumentAsset(asset: DocumentPicker.DocumentPickerAsset) {
  const fallbackExtension = asset.mimeType?.includes('pdf')
    ? 'pdf'
    : asset.mimeType?.includes('png')
      ? 'png'
      : asset.mimeType?.includes('jpeg') || asset.mimeType?.includes('jpg')
        ? 'jpg'
        : 'file';

  return asset.name?.trim() || `reference-document.${fallbackExtension}`;
}

function likelyProjectCandidatesFromGps(
  currentLocation: LocationSnapshot | null,
  projectAreas: ProjectArea[],
  savedUpdates: ProjectUpdate[],
  activeProjects: string[],
  scheduleItems: ScheduleItem[],
) {
  const suggestions = findProjectAreaSuggestions(currentLocation, projectAreas)
    .filter(suggestion => suggestion.withinRadius);
  const candidates: Array<{ projectName: string; distanceFeet: number }> = [];
  const seen = new Set<string>();

  suggestions.forEach(suggestion => {
    const projectName = resolveProjectForDetectedArea(
      suggestion.area,
      savedUpdates,
      activeProjects,
      scheduleItems,
    );
    if (!projectName || seen.has(projectName)) return;
    seen.add(projectName);
    candidates.push({
      projectName,
      distanceFeet: suggestion.distanceFeet,
    });
  });

  const topCandidates = candidates
    .sort((a, b) => a.distanceFeet - b.distanceFeet)
    .slice(0, 3);
  const first = topCandidates[0] || null;
  const second = topCandidates[1] || null;
  const hasClearWinner =
    Boolean(first) &&
    (!second ||
      second.distanceFeet - first.distanceFeet >= clearWinnerMarginFeet(
        GPS_CLEAR_WINNER_DISTANCE_FEET,
        currentLocation?.accuracy,
      ));

  return {
    topCandidates,
    clearProjectName: hasClearWinner ? first?.projectName ?? null : null,
    ambiguous: topCandidates.length > 1 && !hasClearWinner,
  };
}

function formatFeet(value: number | null | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 'Unknown';
  }

  return `${Math.round(value).toLocaleString('en-US')} ft`;
}

// High (iOS nearest ten meters), not Balanced (hundred meters): areas are
// 100-250 ft circles (GPS review, 29 Sep 2026). Saving an area point uses Highest.
async function getCurrentLocationSnapshot(
  accuracy: Location.Accuracy = Location.Accuracy.High,
): Promise<LocationSnapshot | null> {
  const permission =
    await Location.requestForegroundPermissionsAsync();

  if (!permission.granted) return null;

  const location = await Location.getCurrentPositionAsync({ accuracy });

  return {
    latitude: location.coords.latitude,
    longitude: location.coords.longitude,
    accuracy: location.coords.accuracy,
    capturedAt: new Date().toISOString(),
    preciseLocationOff: permission.ios?.accuracy === 'reduced',
  };
}


function parseFlexibleDate(value: string) {
  const trimmed = value.trim();

  if (!trimmed) return null;

  const us = trimmed.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);

  if (us) {
    const month = Number(us[1]);
    const day = Number(us[2]);
    const year = Number(us[3]);
    const date = new Date(year, month - 1, day);

    if (
      date.getFullYear() === year &&
      date.getMonth() === month - 1 &&
      date.getDate() === day
    ) {
      date.setHours(0, 0, 0, 0);
      return date;
    }
  }

  const iso = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);

  if (iso) {
    const year = Number(iso[1]);
    const month = Number(iso[2]);
    const day = Number(iso[3]);
    const date = new Date(year, month - 1, day);

    if (
      date.getFullYear() === year &&
      date.getMonth() === month - 1 &&
      date.getDate() === day
    ) {
      date.setHours(0, 0, 0, 0);
      return date;
    }
  }

  // "Jul 24, 2026": how schedule imports stored dates until 30 Sep 2026, so a
  // saved row in that form is read and re-stored as MM/DD/YYYY (audit A5).
  const named = parseMonthNameDateParts(trimmed);
  if (named) {
    const date = new Date(named.year, named.month - 1, named.day);
    date.setHours(0, 0, 0, 0);
    return date;
  }

  return null;
}

function formatAppDate(value: string) {
  const date = parseFlexibleDate(value);

  if (!date) return value.trim();

  return `${zeroPad(date.getMonth() + 1)}/${zeroPad(date.getDate())}/${date.getFullYear()}`;
}

function formatCompactAppDate(value: string) {
  const date = parseFlexibleDate(value);

  if (!date) return value.trim();

  return `${date.getMonth() + 1}/${date.getDate()}/${String(date.getFullYear()).slice(-2)}`;
}

function daysUntilDate(value: string, projectTimeZone: string = DEFAULT_PROJECT_TIME_ZONE) {
  return projectDateRelativeDays(value, new Date(), projectTimeZone);
}

function daysUntilScheduleItem(item: ScheduleItem) {
  return daysUntilDate(item.finishDate, item.projectTimeZone || DEFAULT_PROJECT_TIME_ZONE);
}

function isScheduleItemDueToday(item: ScheduleItem) {
  if (scheduleTaskIsComplete(item)) return false;

  return daysUntilScheduleItem(item) === 0;
}

function timeOfDayGreeting(name?: string) {
  const hour = new Date().getHours();
  const greeting =
    hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const trimmedName = name?.trim();

  return trimmedName ? `${greeting}, ${trimmedName}` : greeting;
}

function todayLongDateLabel() {
  return new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
}

function dueStatusText(value: string, projectTimeZone: string = DEFAULT_PROJECT_TIME_ZONE) {
  const days = daysUntilDate(value, projectTimeZone);

  if (days === null) return 'No valid finish date';
  if (days < 0) return `Overdue by ${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'}`;
  if (days === 0) return 'Due today';
  if (days === 1) return 'Due tomorrow';
  if (days <= 7) return `Due in ${days} days`;

  return `Due ${formatAppDate(value)}`;
}


function photoAttachmentLabel(count: number) {
  if (count === 0) return 'No photos attached';
  if (count === 1) return 'Photo Attached';
  return `${count} Photos Attached`;
}

export function normalizeScheduleItem(
  value: Partial<ScheduleItem>,
  options?: { preserveEditedNotes?: boolean },
): ScheduleItem {
  const progress = reconcileScheduleProgress(value.status, value.percentComplete);
  return {
    // Carry through any field this build does not manage, BEFORE the managed
    // fields below override it. This rebuilds the record from an explicit
    // list, so every unlisted field was silently destroyed on each pass —
    // including provenance written by the schedule importer
    // (sourceContentSha256, sourceImportKey, sourceVersionGroupId) and, until
    // it was listed, projectId.
    //
    // The consequence was not just data loss. The stored row keeps those
    // fields, the local copy can never contain them, so the saved-revision
    // check can never match and the record is re-queued on every sync,
    // forever. Enumerating the missing fields one at a time only fixes the
    // instances found so far; preserving unknown fields fixes the class.
    ...value,
    id: typeof value.id === 'string' ? value.id : uid(),
    // undefined rather than null when absent: the record comparisons drop
    // undefined but keep null, so null here would not match a stored row that
    // simply has no projectId key, and those records would keep re-queueing.
    projectId: typeof value.projectId === 'string' ? value.projectId : undefined,
    itemType: normalizeProjectItemType(value.itemType),
    scheduleProjectName: optionalString(value.scheduleProjectName),
    projectTimeZone: projectTimeZoneOrDefault(value.projectTimeZone),
    projectName: typeof value.projectName === 'string' ? value.projectName : '',
    locationName: typeof value.locationName === 'string' ? value.locationName : '',
    taskName:
      typeof value.taskName === 'string' && value.taskName.trim()
        ? value.taskName.trim()
        : 'New Schedule Item',
    startDate: typeof value.startDate === 'string' ? formatAppDate(value.startDate) : '',
    finishDate: typeof value.finishDate === 'string' ? formatAppDate(value.finishDate) : '',
    milestone: typeof value.milestone === 'string' ? value.milestone : '',
    owner: typeof value.owner === 'string' ? value.owner : '',
    contractor: typeof value.contractor === 'string' ? value.contractor : '',
    durationDays:
      typeof value.durationDays === 'number' && Number.isFinite(value.durationDays)
        ? Math.max(0, value.durationDays)
        : null,
    wbsCode: optionalString(value.wbsCode),
    parentItemId: optionalString(value.parentItemId),
    sortOrder:
      typeof value.sortOrder === 'number' && Number.isFinite(value.sortOrder)
        ? Math.max(0, Math.trunc(value.sortOrder))
        : null,
    dependencies: normalizeScheduleDependencies(value.dependencies),
    isSummary: value.isSummary === true,
    isMilestone: value.isMilestone === true,
    baselineStartDate: optionalString(value.baselineStartDate),
    baselineFinishDate: optionalString(value.baselineFinishDate),
    percentComplete: progress.percentComplete,
    progressSource:
      value.progressSource === 'project_manager' || value.progressSource === 'schedule_import'
        ? value.progressSource
        : null,
    progressConfirmedAt: optionalString(value.progressConfirmedAt),
    progressConfirmedBy: optionalString(value.progressConfirmedBy),
    priority: SCHEDULE_PRIORITIES.includes(value.priority as SchedulePriority)
      ? (value.priority as SchedulePriority)
      : 'Medium',
    status: progress.status,
    notes: normalizeImportedScheduleNote(value.notes, value.importedFrom, {
      preserveEditingWhitespace: options?.preserveEditedNotes,
    }),
    nextAction: optionalString(value.nextAction) || '',
    activity: normalizeProjectItemActivity(value.activity, uid),
    projectControls: normalizeProjectControls(value.projectControls),
    importedFrom: optionalString(value.importedFrom),
    importedAt: optionalString(value.importedAt),
    importBatchId: optionalString(value.importBatchId),
    sourceDocumentId: optionalString(value.sourceDocumentId),
    sourceActivityId: optionalString(value.sourceActivityId),
    sourceWbsCode: optionalString(value.sourceWbsCode),
    sourceRowNumber:
      typeof value.sourceRowNumber === 'number' &&
      Number.isFinite(value.sourceRowNumber) &&
      value.sourceRowNumber > 0
        ? Math.trunc(value.sourceRowNumber)
        : null,
    completionVerification: normalizeDAVECompletionVerification(value.completionVerification),
    createdAt:
      typeof value.createdAt === 'string'
        ? value.createdAt
        : new Date().toISOString(),
    updatedAt: optionalString(value.updatedAt),
  };
}

function normalizeScheduleItems(value: unknown) {
  if (!Array.isArray(value)) return [];

  const items = value
    .map(item => normalizeScheduleItem(item as Partial<ScheduleItem>))
    .filter(item => item.taskName.trim());

  return reconcileDAVEScheduleRecords(canonicalizeScheduleIdentityItems(items));
}

function canonicalizeScheduleIdentityItems(
  items: ScheduleItem[],
  projectAreas: ProjectArea[] = [],
  corrections: readonly DAVEIdentityCorrection[] = [],
  registeredNames: readonly string[] = [],
) {
  const projectNames = Array.from(new Set([
    ...DEFAULT_PROJECTS,
    ...items.flatMap(item => [item.scheduleProjectName || '', item.projectName]),
  ].map(name => name.trim()).filter(Boolean)));

  return canonicalizeDAVEScheduleItems(
    items as unknown as import('./types').ScheduleItem[],
    {
      projectNames,
      projectAreas: projectAreas as unknown as import('./types').ProjectArea[],
      corrections,
      registeredNames,
    },
  ).items as unknown as ScheduleItem[];
}

async function withScheduleImportTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
) {
  let timeout: ReturnType<typeof setTimeout> | null = null;

  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object');
}

function normalizeStoredDraft(value: unknown): StoredDraft | null {
  if (!isRecord(value) || !value.draft) return null;

  const draft = normalizeUpdate(
    value.draft as Partial<ProjectUpdate>,
  );

  if (!hasMeaningfulDraft(draft)) return null;

  return {
    draft,
    savedAt:
      typeof value.savedAt === 'string'
        ? value.savedAt
        : new Date().toISOString(),
  };
}

function normalizeBackupData(value: unknown, options: Readonly<{ archive?: boolean }> = {}) {
  // An archive locates carried photos by asset id and may declare photos
  // unavailable; judged as such, or the whole backup was refused (whole-app
  // audit A7, 30 Sep 2026). The device rules themselves are unchanged, and
  // the device's uri resolver is asked only about a real uri: a placeholder
  // is never a file on this phone (audit A7 pass 2: the wrapper refused
  // every carried photo, and the export then refused to write the backup).
  const deviceResolves = (photo: unknown) =>
    Boolean(resolveProjectPhotoDisplayUri(photo as Partial<UpdatePhoto>));
  const savedUpdate = options.archive
    ? (item: unknown) =>
        isStartupSavedUpdateRecord(archiveUpdateForValidation(item)) &&
        archiveUpdatePhotosAreLocated(item, deviceResolves)
    : isStartupDeviceSavedUpdateRecord;
  const draftEnvelope = options.archive
    ? (item: unknown) =>
        isStartupDraftEnvelope(archiveDraftEnvelopeForValidation(item)) &&
        (!isRecord(item) || !('draft' in item) || archiveUpdatePhotosAreLocated(item.draft, deviceResolves))
    : isStartupDeviceDraftEnvelope;
  const preflight = preflightAppBackup(value, {
    savedUpdate, projectName: isStartupProjectName,
    projectRecord: value => normalizeProjectRecord(value) !== null,
    contactBook: isStartupContactBook, projectArea: isStartupProjectAreaRecord,
    referenceDocument: isStartupReferenceDocumentRecord,
    projectDocument: isStartupStandaloneProjectDocumentRecord, scheduleItem: isStartupScheduleItemRecord,
    captureMemory: value => {
      try {
        normalizeConfirmedMemory(value);
        return true;
      } catch {
        return false;
      }
    },
    draftEnvelope,
  });
  if (!preflight.ok) return preflight;
  const data = preflight.data;
  return {
    ok: true as const,
    data: {
      savedUpdates: data.savedUpdates.map(item => normalizeUpdate(item as Partial<ProjectUpdate>)),
      projects: normalizeStringList(data.projects), archivedProjects: normalizeStringList(data.archivedProjects),
      projectRecords: data.projectRecords ? normalizeProjectRecords(data.projectRecords) : null,
      contactBook: normalizeContacts(data.contacts), projectAreas: normalizeProjectAreas(data.projectAreas),
      referenceDocuments: normalizeReferenceDocuments(data.referenceDocuments),
      projectDocuments: normalizeProjectDocuments(data.projectDocuments), scheduleItems: normalizeScheduleItems(data.scheduleItems),
      captureMemories: data.captureMemories.map(normalizeConfirmedMemory),
      storedDraft: normalizeStoredDraft(data.activeDraft),
    } satisfies RestoredAppData,
  };
}

function isOversizedBackup(size: number | null | undefined) {
  return (
    typeof size === 'number' &&
    Number.isFinite(size) &&
    size > MAX_BACKUP_FILE_BYTES
  );
}

function extensionFromMimeType(mimeType: string) {
  if (mimeType.includes('png')) return 'png';
  if (mimeType.includes('heic')) return 'heic';
  if (mimeType.includes('webp')) return 'webp';

  return 'jpg';
}

function filenameFromUri(uri: string, index: number, mimeType: string) {
  const fallback = `project-photo-${index + 1}.${extensionFromMimeType(
    mimeType,
  )}`;

  const filename = uri.split('/').pop()?.split('?')[0];

  return filename && filename.includes('.') ? filename : fallback;
}

function sanitizeFilename(filename: string) {
  return filename.replace(/[^a-zA-Z0-9._-]/g, '-');
}

async function shareGeneratedScheduleFile({
  filename,
  content,
  mimeType,
  uti,
  dialogTitle,
}: {
  filename: string;
  content: string;
  mimeType: string;
  uti: string;
  dialogTitle: string;
}) {
  if (!await Sharing.isAvailableAsync()) {
    Alert.alert('Share unavailable', 'The Share Sheet is not available on this device.');
    return;
  }
  const directory = FileSystem.cacheDirectory || FileSystem.documentDirectory;
  if (!directory) {
    Alert.alert('Share unavailable', 'A temporary folder could not be found.');
    return;
  }
  const fileUri = `${directory}${sanitizeFilename(filename)}`;
  try {
    await FileSystem.writeAsStringAsync(fileUri, content);
    await Sharing.shareAsync(fileUri, { dialogTitle, mimeType, UTI: uti });
  } finally {
    await FileSystem.deleteAsync(fileUri, { idempotent: true }).catch(() => undefined);
  }
}

async function shareScheduleCalendar(items: readonly ScheduleItem[]) {
  const calendar = buildVitruviusCalendarExport(items);
  if (calendar.eventCount === 0) {
    Alert.alert('Calendar unavailable', 'Add a start or finish date to at least one task first.');
    return;
  }
  await shareGeneratedScheduleFile({
    filename: 'vitruvius-project-schedule.ics',
    content: calendar.content,
    mimeType: 'text/calendar',
    uti: 'public.calendar-event',
    dialogTitle: 'Share Vitruvius Schedule Calendar',
  });
}

async function shareScheduleLookahead(items: readonly ScheduleItem[]) {
  const lookahead = buildVitruviusLookahead({ items, weeks: 3 });
  await shareGeneratedScheduleFile({
    filename: `vitruvius-3-week-lookahead-${lookahead.rangeStart}.csv`,
    content: vitruviusLookaheadCsv(lookahead),
    mimeType: 'text/csv',
    uti: 'public.comma-separated-values-text',
    dialogTitle: 'Share Vitruvius 3-Week Lookahead',
  });
}

async function ensurePhotoStorageDirectory() {
  if (!PHOTO_STORAGE_DIR) {
    throw new Error('Photo storage is unavailable.');
  }

  const info = await FileSystem.getInfoAsync(PHOTO_STORAGE_DIR);

  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(PHOTO_STORAGE_DIR, {
      intermediates: true,
    });
  }

  return PHOTO_STORAGE_DIR;
}

function isStoredProjectPhoto(uri: string) {
  if (!PHOTO_STORAGE_DIR) return false;
  return isLegacyOwnedLocalFileReadDeleteAuthorized({
    ownedRoot: PHOTO_STORAGE_DIR,
    legacyFolderName: PHOTO_STORAGE_FOLDER,
    candidatePath: uri,
  });
}

function resolveProjectPhotoUri(photo: Partial<UpdatePhoto>) {
  const uri = typeof photo.uri === 'string' ? photo.uri : '';
  if (/^https:\/\//i.test(uri)) return uri;
  if (!uri) return '';
  const ownedPhoto = PHOTO_STORAGE_DIR && resolveLegacyOwnedLocalFilePath({
    ownedRoot: PHOTO_STORAGE_DIR, legacyFolderName: PHOTO_STORAGE_FOLDER, candidatePath: uri,
  });
  if (ownedPhoto) return ownedPhoto;
  const cacheRoot = FileSystem.cacheDirectory
    ? `${FileSystem.cacheDirectory}${RECOVERED_PHOTO_CACHE_FOLDER}/`
    : null;
  return photo.cloudRecoveryStatus === 'cached' && cacheRoot
    ? resolveLegacyOwnedLocalFilePath({ ownedRoot: cacheRoot, legacyFolderName: RECOVERED_PHOTO_CACHE_FOLDER, candidatePath: uri }) || ''
    : '';
}

function resolveProjectPhotoDisplayUri(photo: Partial<UpdatePhoto>) {
  const originalUri = resolveProjectPhotoUri(photo);
  return originalUri || (cloudPhotoPreviewIsFresh(photo) ? photo.cloudPreviewUri || '' : '');
}

async function deleteStoredPhotoIfUnused(
  uri: string,
  referencedUpdates: ProjectUpdate[],
) {
  if (!isStoredProjectPhoto(uri)) return;

  const isReferenced = referencedUpdates.some(update =>
    update.photos.some(photo => photo.uri === uri),
  );

  if (isReferenced) return;

  try {
    await FileSystem.deleteAsync(uri, { idempotent: true });
  } catch {
    // Deleting old local photo files is best-effort cleanup.
  }
}

async function deleteUnreferencedPhotosFromUpdate(
  deletedUpdate: ProjectUpdate,
  referencedUpdates: ProjectUpdate[],
) {
  await Promise.all(
    deletedUpdate.photos.map(photo =>
      deleteStoredPhotoIfUnused(photo.uri, referencedUpdates),
    ),
  );
}

async function deleteStoredPhotos(photos: UpdatePhoto[]) {
  await Promise.all(
    photos
      .filter(photo => isStoredProjectPhoto(photo.uri))
      .map(photo =>
        FileSystem.deleteAsync(photo.uri, {
          idempotent: true,
        }).catch(() => undefined),
      ),
  );
}

async function photoFromAsset(
  asset: ImagePicker.ImagePickerAsset,
): Promise<UpdatePhoto> {
  const mimeType = asset.mimeType || 'image/jpeg';
  const originalFilename =
    asset.fileName || filenameFromUri(asset.uri, 0, mimeType);
  const storedFilename = `${uid()}-${sanitizeFilename(originalFilename)}`;
  const targetUri = `${await ensurePhotoStorageDirectory()}${storedFilename}`;

  await FileSystem.copyAsync({
    from: asset.uri,
    to: targetUri,
  });

  return {
    id: uid(),
    uri: targetUri,
    caption: '',
    category: 'Update',
    actionRequired: '',
    actionOwner: '',
    actionDueDate: '',
    actionStatus: 'Open',
    fileName: originalFilename,
    mimeType,
  };
}

async function copyPhotoForSms(
  photo: UpdatePhoto,
  index: number,
  mimeType: string,
) {
  if (!FileSystem.cacheDirectory) return photo.uri;

  const filename = sanitizeFilename(
    photo.fileName || filenameFromUri(photo.uri, index, mimeType),
  );

  const targetUri = `${FileSystem.cacheDirectory}sms-${photo.id}-${filename}`;

  try {
    const existing = await FileSystem.getInfoAsync(targetUri);

    if (existing.exists) {
      await FileSystem.deleteAsync(targetUri, { idempotent: true });
    }

    await FileSystem.copyAsync({
      from: photo.uri,
      to: targetUri,
    });

    return targetUri;
  } catch {
    return photo.uri;
  }
}

async function buildSmsAttachments(photos: UpdatePhoto[]) {
  return Promise.all(
    photos.map(async (photo, index): Promise<SMS.SMSAttachment> => {
      const mimeType = photo.mimeType || 'image/jpeg';
      const fileUri = await copyPhotoForSms(photo, index, mimeType);

      const uri =
        Platform.OS === 'android'
          ? await FileSystem.getContentUriAsync(fileUri)
          : fileUri;

      return {
        uri,
        mimeType,
        filename:
          photo.fileName || filenameFromUri(photo.uri, index, mimeType),
      };
    }),
  );
}

function buildMessage(update: ProjectUpdate) {
  const displayDate = formatDisplayDate(update.date);
  const photoCount = update.photos.length;
  const hasPhotos = photoCount > 0;
  const openIssueCount = update.photos.filter(photo => photo.category === 'Open Issue').length;
  const safetyConcernCount = update.photos.filter(photo => photo.category === 'Safety Concern').length;
  const actionItemCount = update.photos.filter(
    photo => isActionCategory(photo.category) && hasActionDetails(photo),
  ).length;

  const subject = `Update on ${update.projectName} - ${displayDate}`;

  const summaryLines = [
    `📷 ${photoAttachmentLabel(photoCount)}`,
    `⚠️ ${countLabel(openIssueCount, 'Open Issue')}`,
    `📋 ${countLabel(actionItemCount, 'Action Item')}`,
    `🚨 ${countLabel(safetyConcernCount, 'Safety Concern')}`,
  ];

  const categoryHeaders: Record<PhotoCategory, string> = {
    Update: 'Progress Updates',
    'Open Issue': countLabel(openIssueCount, 'Item That Needs Attention', 'Items That Need Attention'),
    'Safety Concern': countLabel(safetyConcernCount, 'Safety Note', 'Safety Notes'),
  };

  const categoryIntros: Record<PhotoCategory, string> = {
    Update: 'Here is what changed or was completed:',
    'Open Issue': openIssueCount === 1 ? 'This item needs follow-up:' : 'These items need follow-up:',
    'Safety Concern': safetyConcernCount === 1 ? 'This safety-related item was noted:' : 'These safety-related items were noted:',
  };

  const sections = CATEGORIES.map(category => {
    const items = update.photos.filter(
      photo =>
        photo.category === category &&
        hasPhotoMessageContent(photo),
    );

    if (!items.length) return '';

    const lines = items.map((photo, index) => {
      const details: string[] = [];

      if (photo.caption.trim()) {
        details.push(ensureSentence(photo.caption));
      }

      if (
        isActionCategory(photo.category) &&
        hasActionDetails(photo)
      ) {
        if (photo.actionRequired.trim()) {
          details.push(`Next step: ${ensureSentence(photo.actionRequired)}`);
        }

        if (photo.actionOwner.trim()) {
          details.push(`Owner: ${photo.actionOwner.trim()}`);
        }

        if (photo.actionDueDate.trim()) {
          details.push(`Target date: ${formatDueDate(photo.actionDueDate)}`);
        }

        details.push(`Current status: ${photo.actionStatus}`);
      }

      return `${index + 1}. ${details.filter(Boolean).join('\n   ')}`;
    });

    return `${categoryHeaders[category]}\n${categoryIntros[category]}\n${lines.join('\n\n')}`;
  }).filter(Boolean);

  const noteText = update.notes.trim();

  const areaLine = update.selectedAreaName
    ? `Location: ${update.selectedAreaName}\n`
    : '';

  const updateDetails = sections.length
    ? sections.join('\n\n')
    : noteText
      ? ''
      : hasPhotos
        ? `I added ${photoCount === 1 ? 'a photo' : 'photos'} for reference, but no written field notes have been added yet.`
        : 'No detailed notes have been added yet.';

  const noteBlock = noteText
    ? `${updateDetails ? '\n\n' : ''}Additional Notes\n${ensureSentence(update.notes)}`
    : '';

  const attachmentBlock = hasPhotos
    ? `\n\n${photoCount === 1 ? 'The photo is attached for reference.' : 'The photos are attached for reference.'}`
    : '\n\nNo photos are attached.';

  const body = `Hi everyone,

Quick update on ${update.projectName} for ${displayDate}.

${summaryLines.join('\n')}

${areaLine}${updateDetails}${noteBlock}${attachmentBlock}

Please let me know if you have any questions or need anything else.

Thanks,
Dave`;

  return {
    subject,
    body,
  };
}


const EMPTY_PROJECT_STATS: ProjectStats = {
  updates: 0,
  photos: 0,
  openActions: 0,
  overdueActions: 0,
  dueThisWeek: 0,
};

function createEmptyProjectStats(): ProjectStats {
  return {
    updates: 0,
    photos: 0,
    openActions: 0,
    overdueActions: 0,
    dueThisWeek: 0,
  };
}

function buildProjectStatsByName(savedUpdates: ProjectUpdate[]) {
  const statsByProject: Record<string, ProjectStats> = {};

  savedUpdates.forEach(update => {
    const projectKey = projectRollupKey(update.projectName);
    const stats =
      statsByProject[projectKey] ||
      createEmptyProjectStats();

    stats.updates += 1;
    stats.photos += update.photos.length;

    update.photos.forEach(photo => {
      if (isOpenAction(photo)) stats.openActions += 1;
      if (isOverdueAction(photo)) stats.overdueActions += 1;
      if (isDueThisWeek(photo)) stats.dueThisWeek += 1;
    });

    if (!stats.lastUpdate || update.date > stats.lastUpdate) {
      stats.lastUpdate = update.date;
    }

    statsByProject[projectKey] = stats;
  });

  return statsByProject;
}

function projectRollupKey(projectName: string | null | undefined) {
  return (projectName || '').trim().toLowerCase();
}

function projectStatsForName(
  projectStatsByName: Record<string, ProjectStats>,
  projectName: string,
) {
  return projectStatsByName[projectRollupKey(projectName)] || EMPTY_PROJECT_STATS;
}

function projectMatchesScope(update: ProjectUpdate, projectName: string | null) {
  return !projectName || projectRollupKey(update.projectName) === projectRollupKey(projectName);
}

function projectUpdatesForScopes(
  savedUpdates: ProjectUpdate[],
  projectNames: string[],
  scheduleItems: ScheduleItem[] = [],
) {
  const parentProjectName = projectNames[0]?.trim();
  if (parentProjectName && scheduleItems.length > 0) {
    return projectUpdatesForParentProject(
      savedUpdates,
      parentProjectName,
      scheduleItems,
    );
  }
  return savedUpdates.filter(update =>
    projectNames.some(projectName => projectMatchesScope(update, projectName)),
  );
}

function projectStatsForUpdates(savedUpdates: ProjectUpdate[]): ProjectStats {
  return savedUpdates.reduce<ProjectStats>((stats, update) => {
    stats.updates += 1;
    stats.photos += update.photos.length;
    update.photos.forEach(photo => {
      if (isOpenAction(photo)) stats.openActions += 1;
      if (isOverdueAction(photo)) stats.overdueActions += 1;
      if (isDueThisWeek(photo)) stats.dueThisWeek += 1;
    });
    if (!stats.lastUpdate || update.date > stats.lastUpdate) {
      stats.lastUpdate = update.date;
    }
    return stats;
  }, createEmptyProjectStats());
}

function canonicalReferenceDocumentSha256(value: unknown) {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return /^[a-f0-9]{64}$/.test(normalized) ? normalized : null;
}

function projectDocumentMatchesProject(
  document: ProjectDocument,
  projectName: string | null,
) {
  if (!projectName) return true;

  const projectId = authorityProjectId(projectName);

  return (
    document.projectId === projectId ||
    document.projectId === projectName
  );
}

function projectDocumentsForProject(
  projectName: string | null,
  documents: ProjectDocument[],
) {
  return documents.filter(
    document =>
      !document.isArchived &&
      projectDocumentMatchesProject(document, projectName),
  );
}

function projectDocumentsForScopes(
  projectNames: string[],
  documents: ProjectDocument[],
) {
  return documents.filter(document =>
    !document.isArchived &&
    projectNames.some(projectName => projectDocumentMatchesProject(document, projectName)),
  );
}

function projectDocumentCountForProject(
  projectName: string | null,
  documents: ProjectDocument[],
) {
  return projectDocumentsForProject(projectName, documents).length;
}

function buildProjectDocumentStoragePath(
  documentId: string,
  projectId: string,
  fileName: string,
) {
  return `${PROJECT_DOCUMENT_UPLOAD_FOLDER}/${sanitizeFilename(
    projectId,
  )}/${documentId}/${sanitizeFilename(fileName)}`;
}

function ownedProjectDocumentAccess(document: ProjectDocument) {
  if (!OWNED_PROJECT_DOCUMENTS_DIR) throw new Error('Project document storage is unavailable.');
  return {
    store: createProjectDocumentOwnedFileStore({ ownedRoot: OWNED_PROJECT_DOCUMENTS_DIR }),
    input: requireOwnedProjectDocumentAccess(document),
  };
}

async function verifyOwnedProjectDocument(document: ProjectDocument) {
  const access = ownedProjectDocumentAccess(document);
  await access.store.verifyAuthorizedFile(access.input);
}

async function deleteOwnedProjectDocument(document: ProjectDocument) {
  if (!OWNED_PROJECT_DOCUMENTS_DIR) return { status: 'unavailable' as const };
  return cleanupProjectDocumentOwnedFileForRecordRemoval({
    document,
    ownedRoot: OWNED_PROJECT_DOCUMENTS_DIR,
  });
}

function projectDocumentStatusDetail(document: ProjectDocument) {
  if (document.status === 'failed') {
    return 'Document upload failed · Retry';
  }

  if (document.status === 'uploading') {
    const percent = typeof document.uploadProgress === 'number'
      ? Math.round(Math.min(1, Math.max(0, document.uploadProgress)) * 100)
      : null;
    return percent === null
      ? 'Document upload pending'
      : `Uploading ${percent}%`;
  }

  if (document.status === 'uploaded') {
    return `Uploaded ${formatSavedTime(document.uploadedAt || document.updatedAt)}`;
  }

  return 'Local only · not included as an uploaded attachment';
}

function isComplianceSensitiveProjectDocument(document: ProjectDocument) {
  return COMPLIANCE_SENSITIVE_DOCUMENT_CATEGORIES.includes(document.category);
}

function duplicateProjectDocumentForAsset(
  documents: ProjectDocument[],
  projectId: string,
  asset: {
    name?: string | null;
    mimeType?: string | null;
    size?: number | null;
  },
) {
  const name = (asset.name || '').trim().toLowerCase();
  const mimeType = (asset.mimeType || '').trim().toLowerCase();
  const size = typeof asset.size === 'number' ? asset.size : null;

  if (!name || !size) return null;

  return (
    documents.find(document => {
      if (document.isArchived || document.projectId !== projectId) return false;

      return (
        document.name.trim().toLowerCase() === name &&
        (document.mimeType || '').trim().toLowerCase() === mimeType &&
        document.sizeBytes === size
      );
    }) || null
  );
}

function photoHasVisualChange(photo: UpdatePhoto) {
  const result = photo.photoIntelligence;

  return photoDisplayResultCanInformProject(result);
}

function photoAssessmentForUpdate(update: ProjectUpdate) {
  return aggregatePhotoDisplayResults(
    update.photos.map(photo => photo.photoIntelligence),
  );
}

function pieResultHasCompletedVisualComparison(
  result: PIEPhotoIntelligenceDisplayState | null | undefined,
) {
  return Boolean(
    result &&
      (
        result.status === 'analysis_complete' ||
        result.status === 'completed_with_limitations'
      ) &&
      Boolean(result.priorUpdateUsed || result.priorEvidenceId || result.diagnostics?.selectedPriorPhotoId),
  );
}

function pieResultIsBaselineOnly(
  result: PIEPhotoIntelligenceDisplayState | null | undefined,
) {
  return result?.status === 'no_suitable_prior_photo';
}

function isBaselineInfoFinding(finding: string) {
  return /first visual baseline|baseline saved|no earlier photo|no prior photo|future comparison/i.test(finding);
}

function isPreparingSecurePhotoAnalysisResult(result: PIEPhotoIntelligenceDisplayState) {
  return (
    result.status === 'analyzing' &&
    result.diagnostics?.tokenMissingReason === 'auth_loading'
  );
}

function authStatusCopyForPIEResult(result: PIEPhotoIntelligenceDisplayState) {
  const reason = result.diagnostics?.tokenMissingReason;

  if (reason === 'auth_loading') return PIE_STATUS_COPY.preparingSecureAnalysis;
  if (reason === 'signed_out') return PIE_STATUS_COPY.signInRequired;
  if (reason === 'expired_session') return PIE_STATUS_COPY.sessionExpired;
  return null;
}

function pieResultRequiresSupabaseSignIn(result: PIEPhotoIntelligenceDisplayState | null | undefined) {
  const reason = result?.diagnostics?.tokenMissingReason;
  return reason === 'signed_out' || reason === 'expired_session';
}

function authStatusCopyForPIEResults(results: PIEPhotoIntelligenceDisplayState[]) {
  const loading = results.find(result => result.diagnostics?.tokenMissingReason === 'auth_loading');
  if (loading) return PIE_STATUS_COPY.preparingSecureAnalysis;

  const expired = results.find(result => result.diagnostics?.tokenMissingReason === 'expired_session');
  if (expired) return PIE_STATUS_COPY.sessionExpired;

  const signedOut = results.find(result => result.diagnostics?.tokenMissingReason === 'signed_out');
  if (signedOut) return PIE_STATUS_COPY.signInRequired;

  return null;
}

function photoIntelligenceNeedsAuthHydrationRetry(result: PIEPhotoIntelligenceDisplayState) {
  return result.diagnostics?.tokenMissingReason === 'auth_loading';
}

function priorUpdateUsedForPIEResult(result: PIEPhotoIntelligenceDisplayState | null | undefined) {
  if (!result?.priorUpdateUsed) return null;
  const diagnostics = result.diagnostics;
  const imagePrepFailure = diagnostics?.imagePrepareFailureReason || '';
  const currentPrepFailed = diagnostics?.currentPhotoPrepStatus === 'failed';
  const priorPrepFailed = diagnostics?.priorPhotoPrepStatus === 'failed';
  const currentOrPriorNotChecked =
    diagnostics &&
    (diagnostics.currentPhotoPrepStatus !== 'ready' || diagnostics.priorPhotoPrepStatus !== 'ready');
  const stalePersistedPrepFailure =
    !diagnostics &&
    (result.status === 'analysis_failed_retry' || result.status === 'comparison_unavailable') &&
    result.captureLimitations.some(item => /image could not be prepared/i.test(item));

  if (
    imagePrepFailure ||
    currentPrepFailed ||
    priorPrepFailed ||
    currentOrPriorNotChecked ||
    stalePersistedPrepFailure
  ) {
    return null;
  }

  return result.priorUpdateUsed;
}

function waitForPIEAuthHydrationRetry() {
  return new Promise(resolve => setTimeout(resolve, PIE_AUTH_HYDRATION_RETRY_DELAY_MS));
}

function pieStatusForUpdate(update: ProjectUpdate) {
  if (update.status === 'queued') return queuedStatusCopyForUpdate(update);
  if (update.status === 'failed') return queuedStatusCopyForUpdate(update);
  return summarizePIEStatusForUpdate(update).summary;
}

function summarizePIEStatusForUpdate(update: ProjectUpdate): {
  status: FieldUpdatePIEStatus;
  summary: string;
} {
  if (update.photos.length === 0) {
    return {
      status: 'no_visual_comparison',
      summary: 'No visual comparison available',
    };
  }

  const results = update.photos
    .map(photo => photo.photoIntelligence)
    .filter(Boolean) as PIEPhotoIntelligenceDisplayState[];

  const authCopy = authStatusCopyForPIEResults(results);
  const assessment = photoAssessmentForUpdate(update);

  if (
    assessment.state === 'not_assessed' ||
    assessment.state === 'assessing' ||
    results.some(isPreparingSecurePhotoAnalysisResult)
  ) {
    return {
      status: 'analyzing',
      summary: authCopy || (results.length === 0
        ? PIE_STATUS_COPY.preparingSecureAnalysis
        : PIE_STATUS_COPY.checking),
    };
  }

  if (assessment.state === 'baseline_only') {
    return {
      status: 'no_prior_photo',
      summary: PIE_STATUS_COPY.noPriorPhoto,
    };
  }

  if (assessment.state === 'failed' || assessment.state === 'incomparable') {
    return {
      status: 'failed',
      summary: authCopy || PIE_STATUS_COPY.unavailableRetry,
    };
  }

  return {
    status: 'complete',
    summary: assessment.state === 'assessed_finding'
      ? PIE_STATUS_COPY.possibleChanges
      : PIE_STATUS_COPY.noReliableChange,
  };
}

function pieResultsForUpdate(update: ProjectUpdate) {
  return update.photos
    .map(photo => photo.photoIntelligence)
    .filter(Boolean) as PIEPhotoIntelligenceDisplayState[];
}

function observedFindingsForPIEResult(
  result: PIEPhotoIntelligenceDisplayState | undefined,
) {
  if (!result || !photoDisplayResultCanInformProject(result) || pieResultIsBaselineOnly(result)) return [];

  return uniqueStrings([
    result.currentObservation || '',
    ...(result.additions || []),
    ...(result.removals || []),
  ]).filter(finding => !isBaselineInfoFinding(finding));
}

function possibleInterpretationsForPIEResult(
  result: PIEPhotoIntelligenceDisplayState | undefined,
) {
  if (!result || !pieResultSupportsInterpretations(result)) return [];

  return uniqueStrings([
    result.possibleProgress || '',
    ...(result.possibleConcerns || []),
  ]);
}

function pieResultSupportsInterpretations(
  result: PIEPhotoIntelligenceDisplayState | undefined,
) {
  return Boolean(
    result &&
      photoDisplayResultCanInformProject(result) &&
      ![
        'analysis_failed_retry',
        'comparison_unavailable',
        'analyzing',
        'no_suitable_prior_photo',
      ].includes(result.status),
  );
}

function updateSupportsPIEInterpretations(
  update: ProjectUpdate,
  summary: Pick<ReturnType<typeof summarizePIEStatusForUpdate>, 'status'>,
) {
  if (summary.status !== 'complete') return false;

  return pieResultsForUpdate(update).some(pieResultSupportsInterpretations);
}

function updateInterpretationState(
  update: ProjectUpdate,
  interpretation: string,
  action: 'confirm' | 'dismiss',
): ProjectUpdate {
  const confirmed = new Set(update.confirmedInterpretations || []);
  const dismissed = new Set(update.dismissedInterpretations || []);

  if (action === 'confirm') {
    confirmed.add(interpretation);
    dismissed.delete(interpretation);
  } else {
    dismissed.add(interpretation);
    confirmed.delete(interpretation);
  }

  return {
    ...update,
    possibleInterpretations: uniqueStrings([
      ...(update.possibleInterpretations || []),
      interpretation,
    ]),
    confirmedInterpretations: Array.from(confirmed),
    dismissedInterpretations: Array.from(dismissed),
  };
}

function appendInterpretationDecisionLog(
  update: ProjectUpdate,
  interpretation: string,
  decision: PIEInterpretationDecisionLogEntry['decision'],
): ProjectUpdate {
  const entry: PIEInterpretationDecisionLogEntry = {
    id: `pie-interpretation-${stableUiHash([
      update.id,
      interpretation,
      decision,
      new Date().toISOString(),
    ].join('|'))}`,
    interpretation,
    observations: update.observedFindings || [],
    decision,
    projectName: update.projectName,
    areaName: update.selectedAreaName || null,
    decidedAt: new Date().toISOString(),
  };

  return {
    ...update,
    interpretationDecisionLog: [
      ...(update.interpretationDecisionLog || []),
      entry,
    ],
  };
}

function buildGeneratedUpdateMessage(
  update: ProjectUpdate,
  pieStatus: { status: FieldUpdatePIEStatus; summary: string },
) {
  const message = buildMessage(update);
  const pieLine =
    pieStatus.status === 'analyzing'
      ? '\n\nPhoto analysis is still in progress.'
      : pieStatus.status === 'complete' ||
          pieStatus.status === 'no_prior_photo' ||
          pieStatus.status === 'no_visual_comparison' ||
          pieStatus.status === 'failed'
        ? `\n\nPhoto Analysis: ${pieStatus.summary}`
        : '';
  const confirmedInterpretationLine =
    pieStatus.status === 'complete' &&
    (update.confirmedInterpretations || []).length > 0
      ? `\n\nConfirmed possible interpretations:\n${(update.confirmedInterpretations || [])
          .map(item => `- ${item}`)
          .join('\n')}`
      : '';

  return `${message.subject}\n\n${message.body}${pieLine}${confirmedInterpretationLine}`;
}

function updateHasSafetyConcern(update: ProjectUpdate) {
  return updateHasOpenDAVESafetyConcern(update);
}

function updateHasBlocker(update: ProjectUpdate) {
  return updateHasOpenDAVEBlocker(update);
}

function lifecycleStatusForUpdate(update: ProjectUpdate): FieldUpdateStatus {
  if (
    update.status === 'draft' ||
    update.status === 'ready_to_send' ||
    update.status === 'queued' ||
    update.status === 'sent' ||
    update.status === 'failed'
  ) {
    return update.status;
  }

  return 'sent';
}

function updateAnalysisStartedAt(update: ProjectUpdate) {
  return update.pieStartedAt || update.workflowTimestamps?.firstPhotoAddedAt || null;
}

function isPIEPendingTooLong(update: ProjectUpdate) {
  const startedAt = updateAnalysisStartedAt(update);

  if (!startedAt) return false;

  const started = new Date(startedAt).getTime();

  if (!Number.isFinite(started)) return false;

  return Date.now() - started > PIE_ANALYSIS_PENDING_TIMEOUT_MS;
}

function updatePIEAnalysisStatus(update: ProjectUpdate) {
  if (update.photos.length === 0) return null;

  const summary = summarizePIEStatusForUpdate(update);

  if (summary.status === 'analyzing' && isPIEPendingTooLong(update)) {
    return PIE_STATUS_COPY.timeoutRetry;
  }

  if (summary.status === 'analyzing') return PIE_STATUS_COPY.checking;
  if (summary.status === 'failed') return PIE_STATUS_COPY.unavailableRetry;
  if (summary.status === 'no_prior_photo') return PIE_STATUS_COPY.noPriorPhoto;
  if (summary.status === 'complete') return summary.summary;

  return null;
}

function updateNeedsReview(update: ProjectUpdate) {
  const lifecycle = lifecycleStatusForUpdate(update);
  const pieStatus = summarizePIEStatusForUpdate(update).status;

  return (
    lifecycle === 'ready_to_send' ||
    lifecycle === 'queued' ||
    lifecycle === 'failed' ||
    pieStatus === 'failed' ||
    (pieStatus === 'analyzing' && isPIEPendingTooLong(update))
  );
}

function updateCanInlineRetry(update: ProjectUpdate) {
  const lifecycle = lifecycleStatusForUpdate(update);
  const pieStatus = summarizePIEStatusForUpdate(update).status;

  return (
    lifecycle === 'queued' ||
    lifecycle === 'failed' ||
    pieStatus === 'failed' ||
    (pieStatus === 'analyzing' && isPIEPendingTooLong(update))
  );
}

function updateNeedsAutomaticSyncRetry(update: ProjectUpdate) {
  const lifecycle = lifecycleStatusForUpdate(update);
  const category = update.syncDiagnostics?.lastSyncFailureCategory;
  const repairedMissingPhotoNeedsFinalization =
    lifecycle === 'failed' &&
    category === 'storage_upload_failed' &&
    update.photos.some(photo => photo.cloudRecoveryStatus === 'unavailable');

  return (
    lifecycle === 'queued' ||
    repairedMissingPhotoNeedsFinalization ||
    (lifecycle === 'failed' &&
      (category === 'signed_out' || category === 'auth' || category === 'offline'))
  );
}

function mergeSavedUpdatesWithTombstones({
  localUpdates,
  cloudUpdates,
  tombstones,
}: {
  localUpdates: ProjectUpdate[];
  cloudUpdates: ProjectUpdate[];
  tombstones: DeletedUpdateTombstone[];
}) {
  const tombstoneById = new Map(tombstones.map(item => [item.updateId, item]));
  const cloudUpdateById = new Map(cloudUpdates.map(update => [update.id, update]));
  const seen = new Set<string>();
  const merged: ProjectUpdate[] = [];

  const considerUpdate = (
    update: ProjectUpdate,
    sourceAfterReload: FieldUpdateDeleteDiagnostics['sourceAfterReload'],
  ) => {
    // A local update takes a cloud copy's receipt only when there is one:
    // merged with itself it read "Cloud Synced" before any upload (whole-app
    // audit A4, 29 Sep 2026).
    // A row read from the cloud has been uploaded: it is synced whatever
    // status the phone wrote into it (rows carry 'queued' verbatim; audit
    // A4/A7, 30 Sep 2026).
    const effectiveUpdate = sourceAfterReload === 'local'
      ? mergeLocalUpdateWithCloudCopy(update, cloudUpdateById.get(update.id))
      : { ...update, status: 'sent' as const };
    const tombstone = tombstoneById.get(update.id);
    const localArchiveCanStayHidden =
      tombstone?.action === 'archive_sent_update' && sourceAfterReload === 'local';

    if (tombstone && !localArchiveCanStayHidden) return;
    if (seen.has(update.id)) return;

    seen.add(update.id);

    const lifecycleStatus = lifecycleStatusForUpdate(effectiveUpdate);
    merged.push({
      ...effectiveUpdate,
      isArchived: effectiveUpdate.isArchived || tombstone?.action === 'archive_sent_update',
      archivedAt: effectiveUpdate.archivedAt || tombstone?.deletedAt || null,
      deleteDiagnostics: {
        updateId: effectiveUpdate.id,
        localId: effectiveUpdate.stableSendId || effectiveUpdate.id,
        cloudIdPresent: sourceAfterReload === 'cloud' || lifecycleStatus === 'sent',
        lifecycleStatus,
        pendingSync: updateNeedsAutomaticSyncRetry(effectiveUpdate),
        tombstoned: Boolean(tombstone),
        deletedAt: tombstone?.deletedAt || null,
        sourceAfterReload,
        mergeDecision: tombstone ? 'tombstoned' : 'included',
        orphanedPhotoCountIgnored: tombstone?.orphanedPhotoCountIgnored || 0,
      },
    });
  };

  localUpdates.forEach(update => considerUpdate(update, 'local'));
  cloudUpdates.forEach(update => considerUpdate(update, 'cloud'));

  return merged;
}

function buildUpdateTombstone(
  update: ProjectUpdate,
  action: DeletedUpdateTombstone['action'],
  deletedAt = new Date().toISOString(),
): DeletedUpdateTombstone {
  const lifecycleStatus = lifecycleStatusForUpdate(update);

  return {
    updateId: update.id,
    localId: update.stableSendId || update.id,
    cloudIdPresent: lifecycleStatus === 'sent',
    lifecycleStatus,
    pendingSync: updateNeedsAutomaticSyncRetry(update),
    tombstoned: true,
    deletedAt,
    sourceAfterReload: updateNeedsAutomaticSyncRetry(update) ? 'pending' : 'local',
    mergeDecision: 'tombstoned',
    orphanedPhotoCountIgnored: update.photos.length,
    action,
  };
}

function buildCloudUpdateDeletionBarrier(
  updateId: string,
  deletedAt: string,
): DeletedUpdateTombstone {
  return {
    updateId,
    localId: updateId,
    cloudIdPresent: true,
    lifecycleStatus: 'sent',
    pendingSync: false,
    tombstoned: true,
    deletedAt,
    sourceAfterReload: 'cloud',
    mergeDecision: 'tombstoned',
    orphanedPhotoCountIgnored: 0,
    action: 'delete_update_everywhere',
  };
}

function upsertDeletedUpdateTombstone(
  tombstones: DeletedUpdateTombstone[],
  tombstone: DeletedUpdateTombstone,
) {
  return [
    tombstone,
    ...tombstones.filter(item => item.updateId !== tombstone.updateId),
  ];
}

/** How long a save's or retry's own sync is left alone by the queued-updates loop. */
const DIRECT_SYNC_GRACE_MS = 20_000;

function directSyncIsRecent(update: ProjectUpdate, now: number): boolean {
  const attemptedAt = Date.parse(update.lastSendAttemptAt ?? '');
  if (!Number.isFinite(attemptedAt)) return false;
  // A stamp from a clock later corrected is not "still running" (audit A4 pass 3).
  const age = now - attemptedAt;
  return age >= 0 && age < DIRECT_SYNC_GRACE_MS;
}

// The rules live in services/SyncFailureCategory.ts (whole-app audit A4,
// 29 Sep 2026): they now recognise the sanitised sentences the queue writes
// and treat a transport failure anywhere in a message as offline.
function classifySyncFailureCategory(
  errors: string[],
): FieldUpdateSyncFailureCategory {
  return classifySyncFailureText(errors);
}

function syncCategoryForStorageFailure(
  category: PhotoStorageUploadFailureCategory | null,
): FieldUpdateSyncFailureCategory {
  if (category === 'auth_missing') return 'auth';
  if (category === 'rls_denied') return 'rls_denied';
  if (category === 'network') return 'offline';
  return 'storage_upload_failed';
}

function syncCategoryIsRlsOrAuth(
  category: FieldUpdateSyncFailureCategory | null,
) {
  return (
    category === 'signed_out' ||
    category === 'auth' ||
    category === 'rls_denied'
  );
}

type FieldUpdatePermissionAttempt = Pick<
  FieldUpdateSyncDiagnostics,
  | 'failedOperationName'
  | 'failedLogicalTarget'
  | 'rlsDenied'
  | 'authenticatedUserIdPresent'
  | 'projectIdPresent'
  | 'organizationIdPresent'
  | 'membershipCheckResult'
>;

function emptyPermissionAttempt(): FieldUpdatePermissionAttempt {
  return {
    failedOperationName: null,
    failedLogicalTarget: null,
    rlsDenied: false,
    authenticatedUserIdPresent: null,
    projectIdPresent: null,
    organizationIdPresent: null,
    membershipCheckResult: 'not_checked',
  };
}

function inferPermissionAttemptFromFailure({
  syncResult,
  workAttempt,
  failureCategory,
  sessionTokenPresent,
}: {
  syncResult: SyncUploadResult;
  workAttempt: FieldUpdateSyncWorkAttempt;
  failureCategory: FieldUpdateSyncFailureCategory | null;
  sessionTokenPresent: boolean | null;
}): FieldUpdatePermissionAttempt {
  const attempt = emptyPermissionAttempt();
  const errors = [...workAttempt.errors, ...syncResult.errors];
  const message = errors.join(' ').toLowerCase();

  attempt.authenticatedUserIdPresent =
    typeof sessionTokenPresent === 'boolean' ? sessionTokenPresent : null;

  if (workAttempt.storageUploadResult === 'failed') {
    attempt.failedOperationName = 'photo_storage_upload';
    attempt.failedLogicalTarget = workAttempt.storageBucketName || 'project-photos';
    attempt.rlsDenied = workAttempt.storageFailureCategory === 'rls_denied';
    attempt.projectIdPresent = null;
    attempt.organizationIdPresent = null;
    attempt.membershipCheckResult = attempt.rlsDenied
      ? 'missing_or_denied'
      : 'not_checked';
    return attempt;
  }

  if (/project update database select failed/.test(message)) {
    attempt.failedOperationName = 'project_update_metadata_select';
    attempt.failedLogicalTarget = 'project_updates';
  } else if (/project update database upsert failed/.test(message)) {
    attempt.failedOperationName = 'project_update_upsert';
    attempt.failedLogicalTarget = 'project_updates';
  } else if (/project sync failed|project database/.test(message)) {
    attempt.failedOperationName = 'project_record_sync';
    attempt.failedLogicalTarget = 'projects';
  }

  if (attempt.failedLogicalTarget === 'project_updates') {
    attempt.projectIdPresent = true;
    attempt.organizationIdPresent = null;
  }

  attempt.rlsDenied = failureCategory === 'rls_denied';
  attempt.membershipCheckResult = attempt.rlsDenied
    ? 'missing_or_denied'
    : attempt.failedOperationName
      ? 'unavailable'
      : 'not_checked';

  return attempt;
}

function buildSkippedSyncDiagnostics(
  category: FieldUpdateSyncFailureCategory,
  attemptedAt: string,
  queuedUpdateCount: number,
  sessionTokenPresent: boolean | null,
): FieldUpdateSyncDiagnostics {
  return {
    networkState: category === 'offline' ? 'offline' : 'unknown',
    connectionType: category === 'offline' ? 'none' : 'unknown',
    sessionTokenPresent,
    lastSyncAttemptAt: attemptedAt,
    lastSyncResult: 'skipped',
    lastSyncFailureCategory: category,
    cloudUpdateInsertAttempted: false,
    photoStorageUploadAttempted: false,
    storageUploadResult: 'skipped',
    databaseUpsertResult: 'skipped',
    rlsOrAuthFailureDetected: syncCategoryIsRlsOrAuth(category),
    retryAvailable: true,
    storageBucketName: null,
    storageBucketExists: 'unknown',
    storageFailureCategory: null,
    storageHttpStatus: null,
    storageErrorCode: null,
    retryAttemptNumber: null,
    localFileExists: null,
    localFileReadable: null,
    fileByteSizeCategory: 'unknown',
    uploadPayloadType: 'unknown',
    storageContentType: null,
    objectPathCategory: null,
    databaseSyncRanAfterUpload: false,
    ...emptyPermissionAttempt(),
    rlsDenied: category === 'rls_denied',
    authenticatedUserIdPresent: sessionTokenPresent,
    membershipCheckResult: syncCategoryIsRlsOrAuth(category)
      ? 'missing_or_denied'
      : 'not_checked',
    queuedUpdateCount,
    projectRollupsIncludeQueuedUpdates: true,
    projectCardWorkspaceSameSource: true,
  };
}

const SKIPPED_SYNC_WORK_ATTEMPT: FieldUpdateSyncWorkAttempt = {
  cloudUpdateInsertAttempted: false,
  photoStorageUploadAttempted: false,
  storageUploadResult: 'skipped',
  databaseUpsertResult: 'skipped',
  storageBucketName: null,
  storageBucketExists: 'unknown',
  storageFailureCategory: null,
  storageHttpStatus: null,
  storageErrorCode: null,
  localFileExists: null,
  localFileReadable: null,
  fileByteSizeCategory: 'unknown',
  uploadPayloadType: 'unknown',
  storageContentType: null,
  objectPathCategory: null,
  databaseSyncRanAfterUpload: false,
  errors: [],
};

function buildSyncDiagnosticsFromUpload(
  syncResult: SyncUploadResult,
  attemptedAt: string,
  sessionTokenPresent: boolean | null,
  workAttempt: FieldUpdateSyncWorkAttempt = SKIPPED_SYNC_WORK_ATTEMPT,
  retryAttemptNumber: number | null = null,
): FieldUpdateSyncDiagnostics {
  const databaseUpsertResult: FieldUpdateSyncStepResult =
    workAttempt.databaseUpsertResult !== 'skipped'
      ? workAttempt.databaseUpsertResult
      : syncResult.configured &&
          syncResult.errors.length === 0 &&
          syncResult.queued === 0
        ? 'success'
        : 'failed';
  const success =
    syncResult.configured &&
    syncResult.errors.length === 0 &&
    syncResult.queued === 0 &&
    workAttempt.storageUploadResult !== 'failed' &&
    databaseUpsertResult === 'success';
  const combinedErrors = [...workAttempt.errors, ...syncResult.errors];
  const failureCategory = success
    ? null
    : workAttempt.storageUploadResult === 'failed'
      ? syncCategoryForStorageFailure(workAttempt.storageFailureCategory)
      // The queue item's recorded category first (audit A4): the sanitised
      // sentence in `errors` used to read as 'unknown' and so as 'failed'.
      : syncResult.failureCategory ?? classifySyncFailureCategory(
          combinedErrors.length > 0
            ? combinedErrors
            : [syncResult.configured ? 'queued upload remains after sync' : 'Supabase is not configured'],
        );
  const permissionAttempt = inferPermissionAttemptFromFailure({
    syncResult,
    workAttempt,
    failureCategory,
    sessionTokenPresent,
  });

  return {
    networkState: failureCategory === 'offline' ? 'offline' : 'online',
    // Unknown connection type must not be interpreted as offline; cellular is
    // therefore never blocked client-side.
    connectionType: 'unknown',
    sessionTokenPresent,
    lastSyncAttemptAt: attemptedAt,
    lastSyncResult: success ? 'success' : 'failed',
    lastSyncFailureCategory: failureCategory,
    cloudUpdateInsertAttempted: workAttempt.cloudUpdateInsertAttempted,
    photoStorageUploadAttempted: workAttempt.photoStorageUploadAttempted,
    storageUploadResult: workAttempt.storageUploadResult,
    databaseUpsertResult,
    rlsOrAuthFailureDetected: syncCategoryIsRlsOrAuth(failureCategory),
    retryAvailable: !success,
    storageBucketName: workAttempt.storageBucketName,
    storageBucketExists: workAttempt.storageBucketExists,
    storageFailureCategory: workAttempt.storageFailureCategory,
    storageHttpStatus: workAttempt.storageHttpStatus,
    storageErrorCode: workAttempt.storageErrorCode,
    retryAttemptNumber,
    localFileExists: workAttempt.localFileExists,
    localFileReadable: workAttempt.localFileReadable,
    fileByteSizeCategory: workAttempt.fileByteSizeCategory,
    uploadPayloadType: workAttempt.uploadPayloadType,
    storageContentType: workAttempt.storageContentType,
    objectPathCategory: workAttempt.objectPathCategory,
    databaseSyncRanAfterUpload: workAttempt.databaseSyncRanAfterUpload,
    ...permissionAttempt,
    queuedUpdateCount: syncResult.queued,
    projectRollupsIncludeQueuedUpdates: true,
    projectCardWorkspaceSameSource: true,
  };
}

function statusForSyncDiagnostics(
  diagnostics: FieldUpdateSyncDiagnostics,
): FieldUpdateStatus {
  return persistedStatusForSyncResult({
    result: diagnostics.lastSyncResult,
    failureCategory: diagnostics.lastSyncFailureCategory,
  });
}

function queuedStatusCopyForUpdate(update: ProjectUpdate) {
  const category = update.syncDiagnostics?.lastSyncFailureCategory;
  if (category === 'signed_out') return 'Sign in required to sync';
  if (category === 'auth') return 'Session expired · Sign in again';
  if (
    category === 'rls_denied' &&
    update.syncDiagnostics?.membershipCheckResult === 'missing_or_denied'
  ) {
    return 'Project access required to sync';
  }
  if (category === 'rls_denied') return 'Sync failed · Permission issue';
  if (
    category === 'storage_upload_failed' &&
    (update.syncDiagnostics?.storageFailureCategory === 'stale_local_uri' ||
      update.syncDiagnostics?.storageFailureCategory === 'file_unreadable')
  ) {
    return 'Photo unavailable · retake or replace photo';
  }
  if (category === 'storage_upload_failed') return 'Sync failed · Photo upload issue';
  if (category === 'database_insert_failed') return 'Sync failed · Update save issue';
  if (category === 'malformed_payload') return 'Sync failed · App data issue';
  if (category && category !== 'offline') return 'Sync failed · Retry';
  return "Queued — will sync when you're back online";
}

function flowTimingForUpdate(update: ProjectUpdate): SixtySecondFlowTimingResult {
  return buildSixtySecondFlowTimingResult({
    timestamps: update.workflowTimestamps,
    targetSeconds: 60,
    analysisPending: summarizePIEStatusForUpdate(update).status === 'analyzing',
  });
}

function screenForUpdateResume(update: ProjectUpdate): Screen {
  const pieStatus = summarizePIEStatusForUpdate(update).status;

  if (update.photos.length === 0 && !update.continueWithoutPhotosAcknowledged) {
    return 'AddPhotos';
  }

  if (pieStatus === 'analyzing' && !isPIEPendingTooLong(update)) {
    return 'BuildUpdate';
  }

  return 'BuildUpdate';
}

function buildPIEBriefText(
  projectName: string | null,
  savedUpdates: ProjectUpdate[],
) {
  const scopedUpdates = savedUpdates.filter(update =>
    projectMatchesScope(update, projectName),
  );
  const safetyPhotos = scopedUpdates.flatMap(update =>
    update.photos.filter(photo => photo.category === 'Safety Concern'),
  );
  const failedCount = scopedUpdates.reduce(
    (sum, update) =>
      sum +
      update.photos.filter(
        photo =>
          photo.photoIntelligence?.status === 'analysis_failed_retry' ||
          photo.photoIntelligence?.status === 'comparison_unavailable',
      ).length,
    0,
  );
  const changeCount = scopedUpdates.reduce(
    (sum, update) => sum + update.photos.filter(photoHasVisualChange).length,
    0,
  );

  if (safetyPhotos.length > 0) {
    return `${safetyPhotos.length} safety observation${safetyPhotos.length === 1 ? '' : 's'} need review.`;
  }

  if (failedCount > 0) {
    return `${failedCount} photo comparison${failedCount === 1 ? '' : 's'} need retry.`;
  }

  if (changeCount > 0) {
    return `${changeCount} possible visual change${changeCount === 1 ? '' : 's'} found in recent updates.`;
  }

  return 'All projects on track — nothing needs your attention.';
}

type PIEProjectBriefObservation = {
  id: string;
  update: ProjectUpdate;
  text: string;
  context: string;
  observedTier: true;
};

type PIEProjectBriefModel = {
  summary: string;
  observations: PIEProjectBriefObservation[];
  latestUpdate: ProjectUpdate | null;
  lowDetailFallback: boolean;
  analysisUnavailable: boolean;
};

function buildPIEProjectBriefModel(
  projectName: string | null,
  savedUpdates: ProjectUpdate[],
): PIEProjectBriefModel {
  const scopedUpdates = (projectName
    ? savedUpdates.filter(update => projectMatchesScope(update, projectName))
    : [...savedUpdates])
    .sort((a, b) => updateSortTime(b) - updateSortTime(a));
  const failedCount = scopedUpdates.reduce(
    (sum, update) =>
      sum +
      update.photos.filter(
        photo =>
          photo.photoIntelligence?.status === 'analysis_failed_retry' ||
          photo.photoIntelligence?.status === 'comparison_unavailable',
      ).length,
    0,
  );
  const observations = scopedUpdates.flatMap(update =>
    observedFindingsForUpdateBrief(update).map((text, index) => ({
      id: `${update.id}-observed-${index}`,
      update,
      text,
      context: update.selectedAreaName || update.photos[0]?.selectedAreaName || update.projectName,
      observedTier: true as const,
    })),
  );
  const dedupedObservations = dedupePIEProjectBriefObservations(observations);
  const latestUpdate = dedupedObservations[0]?.update || latestUpdateWithVisualChange(scopedUpdates);
  const changeCount = scopedUpdates.reduce(
    (sum, update) => sum + update.photos.filter(photoHasVisualChange).length,
    0,
  );
  const baselineCount = scopedUpdates.reduce(
    (sum, update) =>
      sum + update.photos.filter(photo => pieResultIsBaselineOnly(photo.photoIntelligence)).length,
    0,
  );

  if (dedupedObservations.length > 0 && changeCount > 0) {
    return {
      summary: `${changeCount || observations.length} possible visual change${(changeCount || observations.length) === 1 ? '' : 's'} found.`,
      observations: dedupedObservations.slice(0, 3),
      latestUpdate,
      lowDetailFallback: false,
      analysisUnavailable: false,
    };
  }

  if (changeCount > 0) {
    return {
      summary: 'Possible visual changes found. Open details to review the photos.',
      observations: [],
      latestUpdate,
      lowDetailFallback: true,
      analysisUnavailable: false,
    };
  }

  if (failedCount > 0) {
    return {
      summary: 'Analysis unavailable · Retry',
      observations: [],
      latestUpdate: scopedUpdates.find(update =>
        update.photos.some(photo =>
          photo.photoIntelligence?.status === 'analysis_failed_retry' ||
          photo.photoIntelligence?.status === 'comparison_unavailable',
        ),
      ) || null,
      lowDetailFallback: false,
      analysisUnavailable: true,
    };
  }

  if (baselineCount > 0) {
    return {
      summary: `No visual changes compared yet.\n${baselineCount} baseline photo${baselineCount === 1 ? '' : 's'} saved for future comparisons.`,
      observations: [],
      latestUpdate: null,
      lowDetailFallback: false,
      analysisUnavailable: false,
    };
  }

  return {
    summary: buildPIEBriefText(projectName, savedUpdates),
    observations: [],
    latestUpdate: null,
    lowDetailFallback: false,
    analysisUnavailable: false,
  };
}

function observedFindingsForUpdateBrief(update: ProjectUpdate) {
  const hasCompletedComparison = update.photos.some(photo =>
    pieResultHasCompletedVisualComparison(photo.photoIntelligence),
  );
  if (!hasCompletedComparison) return [];

  return uniqueStrings([
    ...(update.observedFindings || []),
    ...pieResultsForUpdate(update).flatMap(result => observedFindingsForPIEResult(result)),
  ]).filter(isSafeObservedBriefFinding);
}

function isSafeObservedBriefFinding(finding: string) {
  const normalized = finding.trim().toLowerCase();
  if (!normalized) return false;
  if (isBaselineInfoFinding(finding)) return false;
  if (parseDAVEAssertions(normalized).assertions.length > 0) {
    return false;
  }
  return true;
}

function dedupePIEProjectBriefObservations(
  observations: PIEProjectBriefObservation[],
) {
  const seen = new Set<string>();
  return observations.filter(observation => {
    const key = observation.text.trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function latestUpdateWithVisualChange(updates: ProjectUpdate[]) {
  return updates.find(update => update.photos.some(photoHasVisualChange)) || null;
}

function updateSortTime(update: ProjectUpdate) {
  const time = new Date(
    update.workflowTimestamps?.sendResolvedAt ||
      update.workflowTimestamps?.sendTappedAt ||
      update.workflowTimestamps?.firstPhotoAddedAt ||
      update.locationCapturedAt ||
      update.date,
  ).getTime();
  return Number.isFinite(time) ? time : 0;
}

function buildProjectCardPIEStatus(
  projectNames: string[],
  savedUpdates: ProjectUpdate[],
) {
  const scopedUpdates = (projectNames.length > 0
    ? savedUpdates.filter(update =>
        projectNames.some(projectName => projectMatchesScope(update, projectName)),
      )
    : [...savedUpdates])
    .sort((a, b) => b.date.localeCompare(a.date));
  const currentConfirmedBlocker = findCurrentDAVEConfirmedBlocker(scopedUpdates);
  if (currentConfirmedBlocker && updateHasSafetyConcern(currentConfirmedBlocker)) {
    return 'Safety item needs review';
  }
  const failedSync = scopedUpdates.find(update => lifecycleStatusForUpdate(update) === 'failed');
  if (failedSync) return queuedStatusCopyForUpdate(failedSync);

  const queuedSync = scopedUpdates.find(update => lifecycleStatusForUpdate(update) === 'queued');
  if (queuedSync) return '1 update pending sync';

  const failedAnalysisCount = scopedUpdates.reduce(
    (sum, update) =>
      sum +
      update.photos.filter(
        photo =>
          photo.photoIntelligence?.status === 'analysis_failed_retry' ||
          photo.photoIntelligence?.status === 'comparison_unavailable',
      ).length,
    0,
  );

  if (failedAnalysisCount > 0) return PIE_STATUS_COPY.unavailableRetry;

  const analyzingCount = scopedUpdates.reduce(
    (sum, update) =>
      sum +
      update.photos.filter(photo => photo.photoIntelligence?.status === 'analyzing')
        .length,
    0,
  );

  if (analyzingCount > 0) {
    return analyzingCount === 1
      ? '1 update analyzing'
      : `${analyzingCount} updates analyzing`;
  }

  const latest = scopedUpdates[0];
  if (!latest) return 'No recent updates';

  if (lifecycleStatusForUpdate(latest) === 'sent') {
    return `Last update cloud synced ${relativeUpdateDateLabel(latest.date)}`;
  }

  if (lifecycleStatusForUpdate(latest) === 'queued') {
    return `Last local update ${relativeUpdateDateLabel(latest.date)}`;
  }

  if (lifecycleStatusForUpdate(latest) === 'failed') {
    return queuedStatusCopyForUpdate(latest);
  }

  if (lifecycleStatusForUpdate(latest) === 'ready_to_send') {
    return 'Draft ready to sync';
  }

  return `Last local update ${relativeUpdateDateLabel(latest.date)}`;
}

function relativeUpdateDateLabel(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return formatDisplayDate(value);

  const today = new Date();
  if (date.toDateString() === today.toDateString()) return 'today';

  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return 'yesterday';

  return formatDisplayDate(value);
}

function resolveProjectForDetectedArea(
  area: ProjectArea,
  savedUpdates: ProjectUpdate[],
  activeProjects: string[],
  scheduleItems: ScheduleItem[],
) {
  const explicitOwner = explicitProjectAreaOwner(area, activeProjects);
  if (explicitOwner) return explicitOwner;

  const areaMatches = savedUpdates.filter(update => {
    const updateAreaName = update.selectedAreaName || '';

    return (
      update.selectedAreaId === area.id ||
      updateAreaName.toLowerCase() === area.name.toLowerCase() ||
      update.photos.some(
        photo =>
          photo.selectedAreaId === area.id ||
          (photo.selectedAreaName || '').toLowerCase() ===
            area.name.toLowerCase(),
      )
    );
  });

  const orderedMatches = areaMatches.sort((a, b) =>
    b.date.localeCompare(a.date),
  );
  for (const update of orderedMatches) {
    const parent = activeProjects.find(project =>
      projectUpdateBelongsToParentProject({
        update,
        projectName: project,
        scheduleItems,
      }),
    );
    if (parent) return parent;
  }

  if (activeProjects.length === 1) return activeProjects[0];

  const areaText = `${area.id} ${area.name} ${area.building || ''}`.toLowerCase();
  const areaTokens = areaText
    .split(/[^a-z0-9]+/)
    .filter(token => token.length >= 3);

  return (
    activeProjects.find(project =>
      areaText.includes(project.toLowerCase()) ||
      areaTokens.some(token => project.toLowerCase().includes(token)),
    ) || null
  );
}

function projectDueTodayLabel(
  projectName: string,
  savedUpdates: ProjectUpdate[],
  scheduleItems: ScheduleItem[],
): string | null {
  const dueScheduleItem = scheduleTasksForParentProject(
    projectName,
    scheduleItems as unknown as import('./types').ScheduleItem[],
  ).find(item => isScheduleItemDueToday(item as unknown as ScheduleItem));

  if (dueScheduleItem) {
    return dueScheduleItem.taskName.trim() || 'Schedule item due today';
  }

  const hasDueTodayAction = savedUpdates.some(
    update =>
      projectUpdateBelongsToParentProject({
        update,
        projectName,
        scheduleItems,
      }) && update.photos.some(isDueTodayAction),
  );

  return hasDueTodayAction ? 'Open action item due today' : null;
}

type OverviewProjectRow = {
  project: string;
  scopeProjects: string[];
  needsAttention: boolean;
  priorityRank: number;
  health: 'Healthy' | 'Needs Setup' | 'At Risk' | 'Blocked';
  needsVerification: boolean;
  subtitle: string;
  dueTodayLabel: string | null;
  observationCount: number;
  taskCount: number;
  percentComplete: number;
  scheduleHealth: 'On Track' | 'At Risk' | 'Blocked';
};

function buildOverviewProjectRows(
  projects: string[],
  savedUpdates: ProjectUpdate[],
  scheduleItems: ScheduleItem[],
): OverviewProjectRow[] {
  return projects.map(project => {
    const scopeProjects = scheduleProjectScopeNames(
      project,
      scheduleItems as unknown as import('./types').ScheduleItem[],
    );
    const scopedFieldUpdates = projectUpdatesForParentProject(
      savedUpdates,
      project,
      scheduleItems,
    );
    const attentionItems = buildPhase2AttentionItems(scopedFieldUpdates, null);
    const dueTodayLabel = projectDueTodayLabel(
      project,
      savedUpdates,
      scheduleItems,
    );
    const projectScheduleItems = operationalScheduleItemsForProject(
      project,
      scheduleItems,
    );
    const scheduleRollup = buildDAVEProjectScheduleRollup({
      projectName: project,
      items: scheduleItems as unknown as import('./types').ScheduleItem[],
    });
    const scheduleReconciliation = buildPIEScheduleReconciliation({
      scheduleItems: projectScheduleItems as unknown as NonNullable<Parameters<typeof buildPIEScheduleReconciliation>[0]>['scheduleItems'],
      updates: scopedFieldUpdates as unknown as NonNullable<Parameters<typeof buildPIEScheduleReconciliation>[0]>['updates'],
    });
    const confirmedBlockingUpdate = findCurrentDAVEConfirmedBlocker(scopedFieldUpdates);
    const operationalStatus = deriveDAVEProjectOperationalStatus({
      scheduleHealth: scheduleRollup.health,
      scheduleReason: scheduleRollup.healthReason,
      reconciliationWarnings: scheduleReconciliation.warnings,
      hasConfirmedBlocker: Boolean(confirmedBlockingUpdate),
      confirmedBlockerReason: confirmedBlockingUpdate
        ? daveConfirmedBlockerReason(confirmedBlockingUpdate)
        : null,
      hasAttention: attentionItems.length > 0,
      attentionReason: attentionItems[0]?.detail || attentionItems[0]?.title || null,
      hasScheduleData: scheduleRollup.taskCount > 0,
      hasFieldData: scopedFieldUpdates.length > 0,
    });
    const needsAttention = operationalStatus.status !== 'Healthy';
    const brief = buildPIEProjectBriefModel(null, scopedFieldUpdates);
    const observations = brief.observations
      .sort((left, right) => updateSortTime(right.update) - updateSortTime(left.update));
    const subtitle = needsAttention
      ? operationalStatus.reason || operationalStatus.primaryWarning?.summary || observations[0]?.text || brief.summary.split('\n')[0]
      : buildProjectCardPIEStatus([], scopedFieldUpdates);

    return {
      project,
      scopeProjects,
      needsAttention,
      priorityRank: operationalStatus.priorityRank,
      health: operationalStatus.status,
      needsVerification: operationalStatus.needsVerification,
      subtitle,
      dueTodayLabel,
      observationCount: observations.length,
      taskCount: scheduleRollup.taskCount,
      percentComplete: scheduleRollup.percentComplete,
      scheduleHealth: scheduleRollup.health,
    };
  }).sort((left, right) =>
    Number(right.needsAttention) - Number(left.needsAttention) ||
    right.priorityRank - left.priorityRank ||
    left.project.localeCompare(right.project),
  );
}

function buildPhase2ActivityItems(
  savedUpdates: ProjectUpdate[],
  projectName: string | null,
  documents: ProjectDocument[],
) {
  return savedUpdates
    .filter(update => projectMatchesScope(update, projectName))
    .slice(0, 6)
    .map(update => ({
      update,
      projectName: update.projectName,
      dateLabel: formatDisplayDate(update.date),
      areaLabel: update.selectedAreaName || 'No area selected',
      photoCount: update.photos.length,
      documentCount:
        update.documents?.length ||
        projectDocumentCountForProject(update.projectName, documents),
      pieStatus: pieStatusForUpdate(update),
    }));
}

function buildPhase2AttentionItems(
  savedUpdates: ProjectUpdate[],
  projectName: string | null,
) {
  const scopedUpdates = projectName
    ? savedUpdates.filter(update => projectMatchesScope(update, projectName))
    : savedUpdates;
  const currentConfirmedBlocker = findCurrentDAVEConfirmedBlocker(scopedUpdates);
  const items = scopedUpdates
    .flatMap(update => {
      const recurringContext = recurringOpenItemContext(update, scopedUpdates);
      const safetyDraftItem = currentConfirmedBlocker?.id === update.id && (update.safetyFlag || update.quickContext === 'Safety')
        ? [
            {
              id: `${update.id}-safety-quick-context`,
              updateId: update.id,
              actionTarget: 'update' as const,
              projectName: update.projectName,
              title: 'Safety concern detected',
              detail:
                [
                  update.quickContext === 'Safety'
                  ? 'Safety was selected as quick context.'
                    : 'Saved update is marked safety-related.',
                  recurringContext,
                ].filter(Boolean).join(' '),
              areaLabel: update.selectedAreaName || 'No area selected',
              dateLabel: formatDisplayDate(update.date),
              priority: ATTENTION_PRIORITY.safety,
              urgent: true,
              retryable: false,
              statusRole: 'safety' as StatusStyleRole,
            },
          ]
        : [];
      const blockerItem = currentConfirmedBlocker?.id === update.id && (update.blockerFlag || update.quickContext === 'Blocker')
        ? [
            {
              id: `${update.id}-blocker`,
              updateId: update.id,
              actionTarget: 'update' as const,
              projectName: update.projectName,
              title: 'Blocker tagged',
              detail: [
                update.quickContext === 'Blocker'
                  ? 'Blocker was selected as quick context.'
                  : 'Saved update includes an open blocker.',
                recurringContext,
              ].filter(Boolean).join(' '),
              areaLabel: update.selectedAreaName || 'No area selected',
              dateLabel: formatDisplayDate(update.date),
              priority: ATTENTION_PRIORITY.blocker,
              urgent: false,
              retryable: false,
              statusRole: 'interpretation' as StatusStyleRole,
            },
          ]
        : [];
      const lifecycle = lifecycleStatusForUpdate(update);
      const lifecycleItems = [
        lifecycle === 'queued'
          ? {
              id: `${update.id}-queued`,
              updateId: update.id,
              actionTarget: 'retry_send' as const,
              projectName: update.projectName,
              title: 'Queued update waiting to sync',
              detail: queuedStatusCopyForUpdate(update),
              areaLabel: update.selectedAreaName || 'No area selected',
              dateLabel: formatDisplayDate(update.date),
              priority: ATTENTION_PRIORITY.sendIssue,
              urgent: false,
              retryable: true,
              statusRole: 'needsRetry' as StatusStyleRole,
            }
          : null,
        lifecycle === 'failed'
          ? {
              id: `${update.id}-send-failed`,
              updateId: update.id,
              actionTarget: 'retry_send' as const,
              projectName: update.projectName,
              title: queuedStatusCopyForUpdate(update),
              detail:
                update.syncDiagnostics?.lastSyncFailureCategory === 'signed_out'
                  ? 'Sign in required to sync. The update is saved locally and can be retried.'
                  : 'Sync failed · Retry. The update is saved locally and can be retried.',
              areaLabel: update.selectedAreaName || 'No area selected',
              dateLabel: formatDisplayDate(update.date),
              priority: ATTENTION_PRIORITY.sendIssue,
              urgent: false,
              retryable: true,
              statusRole: 'needsRetry' as StatusStyleRole,
            }
          : null,
        // No "Missing recipients" item: the app never sends an update to
        // its recipients, so none are needed (owner answer Q18, 30 Sep 2026).
        lifecycle === 'ready_to_send'
          ? {
              id: `${update.id}-ready-to-send`,
              updateId: update.id,
              actionTarget: 'update' as const,
              projectName: update.projectName,
              title: 'Update ready to sync',
              detail: 'Open the update to review it.',
              areaLabel: update.selectedAreaName || 'No area selected',
              dateLabel: formatDisplayDate(update.date),
              priority: ATTENTION_PRIORITY.readyToSend,
              urgent: false,
              retryable: false,
              statusRole: 'informational' as StatusStyleRole,
            }
          : null,
      ].filter(Boolean) as Phase2AttentionItem[];
      const analysisItems: Phase2AttentionItem[] = update.photos.flatMap((photo): Phase2AttentionItem[] => {
        const status = photo.photoIntelligence?.status;
        const escalated = update.quickContext === 'Safety' || update.quickContext === 'Blocker';
        const priority = escalated
          ? update.quickContext === 'Safety'
            ? ATTENTION_PRIORITY.safety
            : ATTENTION_PRIORITY.analysisIssue
          : ATTENTION_PRIORITY.analysisIssue;
        if (status === 'analysis_failed_retry' || status === 'comparison_unavailable') {
          return [{
            id: `${update.id}-${photo.id}-analysis-failed`,
            updateId: update.id,
            photoId: photo.id,
            actionTarget: 'retry_photo_analysis' as const,
            projectName: update.projectName,
            title: PIE_STATUS_COPY.unavailableRetry,
            detail: photo.photoIntelligence?.possibleConcerns?.[0] ||
              (escalated
                ? `${update.quickContext} tagged update needs retry before this can be trusted.`
                : 'Photo comparison returned no usable result.'),
            areaLabel: photo.selectedAreaName || update.selectedAreaName || 'No area selected',
            dateLabel: formatDisplayDate(update.date),
            priority,
            urgent: false,
            retryable: true,
            statusRole: 'needsRetry' as StatusStyleRole,
          }];
        }

        if (status === 'analyzing' && isPIEPendingTooLong(update)) {
          return [{
            id: `${update.id}-${photo.id}-analysis-timeout`,
            updateId: update.id,
            photoId: photo.id,
            actionTarget: 'retry_photo_analysis' as const,
            projectName: update.projectName,
            title: PIE_STATUS_COPY.timeoutRetry,
            detail: escalated
              ? `${update.quickContext} tagged update is still analyzing and remains surfaced.`
              : 'Photo analysis is taking longer than expected.',
            areaLabel: photo.selectedAreaName || update.selectedAreaName || 'No area selected',
            dateLabel: formatDisplayDate(update.date),
            priority,
            urgent: false,
            retryable: true,
            statusRole: 'needsRetry' as StatusStyleRole,
          }];
        }

        return [];
      });
      const documentItems: Phase2AttentionItem[] = (update.documents || [])
        .filter(document => document.status === 'failed')
        .map((document): Phase2AttentionItem => ({
          id: `${update.id}-${document.id}-document-failed`,
          updateId: update.id,
          actionTarget: 'update' as const,
          projectName: update.projectName,
          title: 'Document upload failed · Retry',
          detail: document.name,
          areaLabel: update.selectedAreaName || 'No area selected',
          dateLabel: formatDisplayDate(document.updatedAt || update.date),
          priority: ATTENTION_PRIORITY.documentIssue,
          urgent: false,
          retryable: true,
          statusRole: 'needsRetry' as StatusStyleRole,
        }));
      const postSendResolutionItem = postSendResolutionNeedsAttention(update)
        ? [{
            id: `${update.id}-post-send-pie-resolution`,
            updateId: update.id,
            actionTarget: 'update' as const,
            projectName: update.projectName,
            title: 'Analysis result changed after cloud sync',
            detail: `The field update synced while analysis was unresolved. Current result: ${summarizePIEStatusForUpdate(update).summary}`,
            areaLabel: update.selectedAreaName || 'No area selected',
            dateLabel: formatDisplayDate(update.date),
            priority: updateHasSafetyConcern(update)
              ? ATTENTION_PRIORITY.safety
              : ATTENTION_PRIORITY.analysisIssue,
            urgent: updateHasSafetyConcern(update),
            retryable: false,
            statusRole: updateHasSafetyConcern(update)
              ? 'safety' as StatusStyleRole
              : 'possibleFinding' as StatusStyleRole,
          }]
        : [];

      return [
        ...safetyDraftItem,
        ...blockerItem,
        ...lifecycleItems,
        ...analysisItems,
        ...documentItems,
        ...postSendResolutionItem,
        ...update.photos
        .filter(
          photo =>
            isActionCategory(photo.category) &&
            photo.actionStatus !== 'Closed',
        )
        .map((photo): Phase2AttentionItem => {
          const safety = photo.category === 'Safety Concern';
          const overdue = isOverdueAction(photo);

          return {
            id: stableOpenItemAttentionId(update, photo),
            updateId: update.id,
            photoId: photo.id,
            actionTarget: 'update' as const,
            projectName: update.projectName,
            title: safety
              ? 'Safety concern detected'
              : photo.actionRequired || 'Open action needs follow-up',
            detail:
              [
                photo.actionRequired ||
                  photo.caption ||
                  update.selectedAreaName ||
                  'Review the saved update.',
                safety || update.quickContext === 'Blocker' ? recurringContext : null,
              ].filter(Boolean).join(' '),
            areaLabel: photo.selectedAreaName || update.selectedAreaName || 'No area selected',
            dateLabel: formatDisplayDate(update.date),
            priority: safety ? ATTENTION_PRIORITY.safety : ATTENTION_PRIORITY.otherOpenItem,
            urgent: safety || Boolean(overdue),
            retryable: false,
            statusRole: safety ? 'safety' as StatusStyleRole : 'informational' as StatusStyleRole,
          };
        }),
      ];
    });

  return dedupeAttentionItemsById(items)
    .sort((a, b) => a.priority - b.priority || b.dateLabel.localeCompare(a.dateLabel))
    .slice(0, 6);
}

function stableOpenItemAttentionId(update: ProjectUpdate, photo: UpdatePhoto) {
  const category = attentionCategoryForPhotoCategory(photo.category);
  return buildStableAttentionItemId({
    updateId: update.id,
    photoId: photo.id,
    category,
    itemType: category === 'safety_concern' ? 'safety_observation' : 'open_item',
    subtype: 'photo_action',
  });
}

function recurringOpenItemContext(
  update: ProjectUpdate,
  savedUpdates: ProjectUpdate[],
) {
  const tag =
    update.quickContext === 'Safety' ||
    update.safetyFlag ||
    update.photos.some(photo => photo.category === 'Safety Concern')
      ? 'Safety'
      : update.quickContext === 'Blocker' || update.blockerFlag
        ? 'Blocker'
        : null;

  if (!tag) return null;

  const areaKey = normalizeAttentionAreaKey(update);
  const recurring = savedUpdates.filter(item => {
    if (item.projectName !== update.projectName) return false;
    if (normalizeAttentionAreaKey(item) !== areaKey) return false;
    if (tag === 'Safety') return updateHasSafetyConcern(item);
    return updateHasBlocker(item);
  });

  if (recurring.length < 2) return null;

  const dates = recurring
    .map(item => new Date(item.date).getTime())
    .filter(Number.isFinite);
  const first = Math.min(...dates);
  const last = Math.max(...dates);
  const daySpan = dates.length > 1
    ? Math.max(1, Math.round((last - first) / (1000 * 60 * 60 * 24)))
    : 1;

  return `Flagged ${recurring.length} times over ${daySpan} day${daySpan === 1 ? '' : 's'}, still unresolved.`;
}

function normalizeAttentionAreaKey(update: ProjectUpdate) {
  return (
    update.selectedAreaId ||
    update.selectedAreaName ||
    'unassigned'
  ).trim().toLowerCase();
}

function postSendResolutionNeedsAttention(update: ProjectUpdate) {
  if (lifecycleStatusForUpdate(update) !== 'sent') return false;
  if (!/Photo analysis is still in progress/i.test(update.generatedMessage || '')) {
    return false;
  }

  const summary = summarizePIEStatusForUpdate(update);
  if (summary.status !== 'complete') return false;

  return (
    updateHasSafetyConcern(update) ||
    summary.summary === PIE_STATUS_COPY.possibleChanges
  );
}

function stableUiHash(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
  }
  return Math.abs(hash).toString(36);
}

export default function App() {
  return (
    <StartupErrorBoundary>
      <SafeAreaProvider>
        <AppShell />
        {Platform.OS === 'ios' ? (
          <InputAccessoryView nativeID="vitruvius-keyboard-done">
            <View style={styles.keyboardAccessory}>
              <TouchableOpacity
                onPress={Keyboard.dismiss}
                accessibilityRole="button"
                accessibilityLabel="Hide keyboard"
              >
                <Text style={styles.keyboardAccessoryText}>Done</Text>
              </TouchableOpacity>
            </View>
          </InputAccessoryView>
        ) : null}
      </SafeAreaProvider>
    </StartupErrorBoundary>
  );
}

function AppShell() {
  const workspaceOwnerId = useNativeWorkspaceOwner();
  const signInPendingRef = useNativeWorkspaceSignInPendingRef(); // updates wait, not fail, offline (A4 pass 7 M1)
  const workspaceSignInPending = useNativeWorkspaceSignInPending(); // Live updates resubscribe when it ends (A1 pass 2 #4).
  useFieldNoteBackgroundRetry(workspaceOwnerId ?? 'local-device'); // notes saved offline reach the desktop (audit A11)
  const hiddenSharedDocuments = useHiddenSharedDocuments(); // Delete from This Device (audit A8)
  const insets = useSafeAreaInsets();
  const { width: appShellWidth } = useWindowDimensions();
  const appShellLayout = appShellLayoutForWidth(appShellWidth);
  const scheduleScreenshotOcrAvailable =
    Platform.OS === 'ios' && isDaveTextRecognitionAvailable();

  const { screen, setScreen, goBack, returnScreen: contactsReturnScreen,
    setReturnScreen: setContactsReturnScreen } = useAppNavigation('Home');

  const [savedUpdatesEntryFilter, setSavedUpdatesEntryFilter] = useState<{
    tab: 'Sent';
    withinDays: number | null;
    project?: string | null;
  } | null>(null);
  const [scheduleEntryFilter, setScheduleEntryFilter] = useState<ScheduleTaskFilter>('Attention');
  const [scheduleAddProjectName, setScheduleAddProjectName] = useState<string | null>(null);
  const [scheduleAddGuided, setScheduleAddGuided] = useState(false);
  const [scheduleProjectFilter, setScheduleProjectFilter] = useState<string | null>(null);
  const [updatesProjectFilter, setUpdatesProjectFilter] = useState<string | null>(null);

  useEffect(() => {
    if (screen === 'SavedUpdates' && savedUpdatesEntryFilter) {
      setSavedUpdatesEntryFilter(null);
    }

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen]);

  useEffect(() => {
    if (screen !== 'Schedule') {
      if (scheduleAddProjectName !== null) setScheduleAddProjectName(null);
      if (scheduleAddGuided) setScheduleAddGuided(false);
    }
  }, [scheduleAddGuided, scheduleAddProjectName, screen]);

  const [selectedWorkspaceProject, setSelectedWorkspaceProject] =
    useState(DEFAULT_PROJECTS[0]);

  const [detectedProjectName, setDetectedProjectName] =
    useState<string | null>(null);
  const [projectDetectionStatus, setProjectDetectionStatus] =
    useState<OverviewDetectionStatus>('checking');

  const [savedUpdates, setSavedUpdates] = useState<ProjectUpdate[]>([]);
  const [decisionLedger, setDecisionLedger] = useState<PIEDecisionRecord[]>([]);
  const [layer4Identity, setLayer4Identity] = useState<PIELayer4ActorContext | null>(null);
  const [layer4IdentityReady, setLayer4IdentityReady] = useState(false);
  const [decisionLedgerMigrationStatus, setDecisionLedgerMigrationStatus] =
    useState<PIEDecisionLedgerMigrationStatus | null>(null);
  const [captureMemories, setCaptureMemories] = useState<DAVEConfirmedCaptureMemory[]>([]);
  const [identityCorrections, setIdentityCorrections] = useState<DAVEIdentityCorrection[]>([]);
  const [syncCleanupNotice, setSyncCleanupNotice] = useState<string | null>(null);
  const [talkProjectName, setTalkProjectName] = useState(DEFAULT_PROJECTS[0]);
  const [talkTaskId, setTalkTaskId] = useState<string | null>(null);
  const [talkVoiceOpen, setTalkVoiceOpen] = useState(false);
  const [talkTypedOpen, setTalkTypedOpen] = useState(false);
  const [talkCaptureDraft, setTalkCaptureDraft] = useState<DAVECaptureMemory | null>(null);
  const keptTalkCapture = useKeptTalkCapture(talkCaptureDraft); // a failing panel keeps the memory (A11 F8)
  const talkCaptureSheetDraft = keptTalkCapture.sheetDraft;
  const [talkAnswer, setTalkAnswer] = useState<{
    projectName: string;
    question: string;
    answer: DAVEAskAnswer;
    askECOSQuestion: string | null; // what "Ask in Ask ECOS" sends (audit A9 pass 2 F2)
  } | null>(null);
  const [talkTaskAction, setTalkTaskAction] = useState<{
    projectName: string;
    command: DAVETaskUpdateCommand;
    candidates: DAVETaskActionCandidate[];
    selectedTaskId: string | null;
  } | null>(null);
  const [activeProjectWalkSession, setActiveProjectWalkSession] =
    useState<DAVEProjectWalkSession | null>(null);
  const [deletedUpdateTombstones, setDeletedUpdateTombstones] =
    useState<DeletedUpdateTombstone[]>([]);
  const [operationalSyncTombstones, setOperationalSyncTombstones] =
    useState<DAVESyncTombstone[]>([]);
  const [deletedProjectNames, setDeletedProjectNames] =
    useState<string[]>([]);

  const [projects, setProjects] =
    useState<string[]>(DEFAULT_PROJECTS);

  const [projectRecords, setProjectRecords] = useState<ProjectRecord[]>(
    DEFAULT_PROJECTS.map(name => ({ name })),
  );

  const [archivedProjects, setArchivedProjects] =
    useState<string[]>([]);

  const [deletingProjectName, setDeletingProjectName] =
    useState<string | null>(null);

  const [projectAreas, setProjectAreas] =
    useState<ProjectArea[]>(DEFAULT_PROJECT_AREAS);

  const [referenceDocuments, setReferenceDocuments] =
    useState<ReferenceDocument[]>([]);
  const ecosDocumentEvidence = useECOSDocumentEvidence({
    documents: referenceDocuments,
    projectIdentities: projectRecords,
    loadProofDocument: async (evidence, document) => {
      const claim = ecosDocumentProofClaimFromEvidence(evidence);
      if (!claim) throw new Error('The Ask ECOS citation is incomplete.');
      return loadAuthorizedECOSDocumentProofBundle({
        client: getSupabaseClient(),
        document,
        claim,
      });
    },
    ensureDocument: ensureVerifiedReferenceDocumentBytes,
    openDocument: openReferenceDocument,
  });
  const [projectDocuments, setProjectDocuments] =
    useState<ProjectDocument[]>([]);

  const [scheduleItems, setScheduleItems] =
    useState<ScheduleItem[]>([]);
  const projectAreasCurrentRef = useRef(projectAreas);
  const [areaGpsSaveInFlight] = useState(createKeyedInFlight);
  // One fix serves home-screen detection for a minute, so data changes do
  // not restart a multi-second fix (review, 29 Sep 2026).
  const overviewLocationFixRef = useRef(createRecentLocationFix(() => getCurrentLocationSnapshot(), 60_000, {
    maxAgeFor: fix => overviewFixMaxAgeMs(fix.accuracy),
  }));
  const referenceDocumentsCurrentRef = useRef(referenceDocuments);
  const currentReferenceActivationIdsRef = useRef(new Set<string>());
  const projectScheduleImportCardRef = useRef<{ batchId: string; documentId: string } | null>(null);
  const projectDocumentsCurrentRef = useRef(projectDocuments);
  const scheduleItemsCurrentRef = useRef(scheduleItems);
  const projectsCurrentRef = useRef(projects);
  const projectRecordsCurrentRef = useRef(projectRecords);
  const archivedProjectsCurrentRef = useRef(archivedProjects);
  const operationalSyncTombstonesRef = useRef(operationalSyncTombstones);
  // These refs are read only by asynchronous callbacks. Assigning during the
  // render keeps them current without scheduling eight post-render effects.
  projectAreasCurrentRef.current = projectAreas;
  referenceDocumentsCurrentRef.current = referenceDocuments;
  projectDocumentsCurrentRef.current = projectDocuments;
  scheduleItemsCurrentRef.current = scheduleItems;
  projectsCurrentRef.current = projects;
  projectRecordsCurrentRef.current = projectRecords;
  archivedProjectsCurrentRef.current = archivedProjects;
  operationalSyncTombstonesRef.current = operationalSyncTombstones;
  const [projectDocumentUploadRetry] = useState(() => createProjectDocumentUploadRetryRunner(() => projectDocumentsCurrentRef.current)); // documents added without signal upload by themselves (whole-app audit A8 pass 1 F5, 30 Sep 2026)
  // A card's typed text is queued once typing pauses (whole-app audit A8 pass 1 F1 (30 Sep 2026)).
  const projectDocumentSharedRecordSync = useProjectDocumentSharedRecordSync(documentId => {
    const latest = referenceDocumentsCurrentRef.current.find(document => document.id === documentId);
    if (latest) void queueReferenceDocumentRecord(latest);
  });

  const [displayName, setDisplayName] =
    useState('');

  const [contactBook, setContactBook] =
    useState<ContactBook>({ contacts: [] });

  const [draft, setDraft] = useState<ProjectUpdate>(() =>
    createDraft(DEFAULT_PROJECTS[0]),
  );

  const [previewPhoto, setPreviewPhoto] =
    useState<UpdatePhoto | null>(null);

  const [documentUploadRequest, setDocumentUploadRequest] = useState<{
    asset: {
      uri: string;
      name?: string | null;
      mimeType?: string | null;
      size?: number | null;
    };
    selected: Set<string>;
    category: ProjectDocumentCategory;
    attachToDraft: boolean;
    areaId: string | null;
    updateId: string | null;
    drawingControls: ECOSMobileDrawingControls;
  } | null>(null);
  const [incomingScheduleImportBatch, setIncomingScheduleImportBatch] = useState<PIEScheduleImportBatch | null>(null);

  const [selectedDetailUpdate, setSelectedDetailUpdate] =
    useState<ProjectUpdate | null>(null);

  const [draftSavedAt, setDraftSavedAt] =
    useState<string | null>(null);
  const [fieldUpdateSaving, setFieldUpdateSaving] = useState(false);

  const [updatesLoaded, setUpdatesLoaded] =
    useState(false);
  const [updatesLocalLoaded, setUpdatesLocalLoaded] =
    useState(false);
  const [deletedUpdateTombstonesLoaded, setDeletedUpdateTombstonesLoaded] =
    useState(false);

  const [projectsLoaded, setProjectsLoaded] =
    useState(false);
  const [projectsLocalLoaded, setProjectsLocalLoaded] =
    useState(false);
  const [deletedProjectNamesLoaded, setDeletedProjectNamesLoaded] =
    useState(false);
  const [deletedProjectNamesLocalLoaded, setDeletedProjectNamesLocalLoaded] =
    useState(false);

  const [archivedProjectsLoaded, setArchivedProjectsLoaded] =
    useState(false);

  const [projectAreasLoaded, setProjectAreasLoadedState] =
    useState(false);
  const [projectAreasLocalLoaded, setProjectAreasLocalLoaded] =
    useState(false);

  const [referenceDocumentsLoaded, setReferenceDocumentsLoadedState] =
    useState(false);
  const [referenceDocumentsLocalLoaded, setReferenceDocumentsLocalLoaded] =
    useState(false);

  const [projectDocumentsLoaded, setProjectDocumentsLoaded] =
    useState(false);

  const [scheduleItemsLoaded, setScheduleItemsLoadedState] =
    useState(false);
  const [scheduleItemsLocalLoaded, setScheduleItemsLocalLoaded] =
    useState(false);
  const projectAreasAuthorityRef = useRef(false);
  const referenceDocumentsAuthorityRef = useRef(false);
  const scheduleItemsAuthorityRef = useRef(false);
  const markProjectAreasAuthorityReady = (ready: boolean) => { projectAreasAuthorityRef.current = ready; setProjectAreasLoadedState(ready); };
  const markReferenceDocumentsAuthorityReady = (ready: boolean) => { referenceDocumentsAuthorityRef.current = ready; setReferenceDocumentsLoadedState(ready); };
  const markScheduleItemsAuthorityReady = (ready: boolean) => { scheduleItemsAuthorityRef.current = ready; setScheduleItemsLoadedState(ready); };
  const [captureMemoriesLoaded, setCaptureMemoriesLoaded] =
    useState(false);
  const [identityCorrectionsLoaded, setIdentityCorrectionsLoaded] =
    useState(false);
  const [scheduleIdentityReady, setScheduleIdentityReady] = useState(false);
  const [displayNameLoaded, setDisplayNameLoaded] =
    useState(false);

  const [contactsLoaded, setContactsLoaded] =
    useState(false);

  const [draftLoaded, setDraftLoaded] =
    useState(false);

  const startupHydration = useStartupHydration();
  const realityModelCacheRecoveryFinished = useRealityModelCacheRecovery();
  const requiredLocalHydrationDomains = [
    realityModelCacheRecoveryFinished, updatesLocalLoaded, deletedUpdateTombstonesLoaded, projectsLocalLoaded, deletedProjectNamesLocalLoaded,
    archivedProjectsLoaded, projectAreasLocalLoaded, referenceDocumentsLocalLoaded, projectDocumentsLoaded,
    scheduleItemsLocalLoaded, captureMemoriesLoaded, identityCorrectionsLoaded, scheduleIdentityReady,
    displayNameLoaded, contactsLoaded, draftLoaded,
  ];
  const startupHydrationReady = isStartupHydrationReady(
    requiredLocalHydrationDomains,
    startupHydration.failures,
  );

  // A suggestion belongs to the draft whose fix produced it (review pass 3).
  const [draftAreaSuggestionEntry, setDraftAreaSuggestionEntry] =
    useState<{ draftId: string; suggestion: AreaSuggestion } | null>(null);


  // Why the draft has no GPS suggestion, shown on Add Photos (GPS review
  // pass 22: this was a text status nothing rendered).
  const [draftLocationNotice, setDraftLocationNotice] =
    useState<DraftLocationNotice | null>(null);

  const draftSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  const savedUpdatesSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const scheduleItemTextSyncLifecycleRef = useRef(
    createScheduleItemTextSyncLifecycle(),
  );
  const scheduleItemSyncGenerationsRef = useRef(new Map<string, number>());
  const scheduleItemSyncWarningsRef = useRef(new Set<string>());
  const updateDetailReturnScreenRef = useRef<AppScreen>('SavedUpdates');

  useEffect(() => () => {
    disposeScheduleItemTextSyncLifecycle(scheduleItemTextSyncLifecycleRef.current);
  }, []);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => {
      if (state !== 'background' && state !== 'inactive') return;

      const pendingItemIds = [
        ...scheduleItemTextSyncLifecycleRef.current.pendingIds,
      ];
      if (pendingItemIds.length > 0) {
        requestPendingChangesUpload('schedule_item_text_background');
      }
      flushPendingScheduleItemTextSync({
        lifecycle: scheduleItemTextSyncLifecycleRef.current,
        currentGeneration: itemId =>
          scheduleItemSyncGenerationsRef.current.get(itemId),
        onReady: (itemId, generation) => {
          const latest = scheduleItemsCurrentRef.current.find(
            candidate => candidate.id === itemId,
          );
          if (latest) void syncScheduleItemRevision(latest, generation);
        },
      });
    });

    return () => subscription.remove();
  }, []);

  const startupCompletionLogged = useRef(false);
  const photoCleanupRan = useRef(false);
  const queuedHydrationInFlight = useRef(false);
  const queuedHydrationRerunRequested = useRef(false);
  const fieldUpdateSaveInFlightRef = useRef(false);
  const updateDeletionInFlightRef = useRef(false);
  const backupRestoreInFlightRef = useRef(false);
  const [operationalRefreshCommitGuard] = useState(createDAVEOperationalRefreshCommitGuard); // a restore stops a refresh (A4 pass 6 F3)
  const photoAnalysisCoordinator = useRef(createPhotoAnalysisCoordinator()).current;
  const talkHistoryPersistence = useRef(createDAVEAskHistoryPersistence({
    readItem: storageKey => AsyncStorage.getItem(storageKey),
    persistItem: persistStorageItem,
    removeItem: removePersistedStorageItem,
  })).current;
  const talkSession = useTalkSession(); // "previous answer" = this Talk session only (audit A9 pass 2 F1)
  const legacyProjectStructureMigrationInFlight = useRef(false);
  const scheduleParentProjectsQueuedRef = useRef(new Set<string>());
  const deletedProjectNamesRef = useRef(deletedProjectNames);
  deletedProjectNamesRef.current = deletedProjectNames;
  const deletedUpdateTombstonesRef = useRef(deletedUpdateTombstones);
  deletedUpdateTombstonesRef.current = deletedUpdateTombstones;
  const savedUpdatesRef = useRef(savedUpdates);
  savedUpdatesRef.current = savedUpdates;
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const [draftFixTracker] = useState(createDraftFixTracker);
  const draftLocationCaptureRef = useRef<ReturnType<typeof captureDraftLocation> | null>(null);
  const [photoAuthRequest, setPhotoAuthRequest] = useState<{
    update: ProjectUpdate;
    photo: UpdatePhoto;
  } | null>(null);
  const [photoAuthEmail, setPhotoAuthEmail] = useState('');
  const [photoAuthPassword, setPhotoAuthPassword] = useState('');
  const [photoAuthMessage, setPhotoAuthMessage] = useState<string | null>(null);
  const [photoAuthSubmitting, setPhotoAuthSubmitting] = useState(false);

  useAndroidHardwareBack({
    onBack: goBack,
    blocked:
      screen === 'SelectProject' ||
      screen === 'AddPhotos' ||
      screen === 'BuildUpdate' ||
      Boolean(
        photoAuthRequest ||
        previewPhoto ||
        documentUploadRequest ||
        talkVoiceOpen ||
        talkTypedOpen ||
        talkCaptureSheetDraft ||
        talkAnswer ||
        talkTaskAction,
      ),
  });

  useEffect(() => {
    logStartupDiagnostic('app_shell_mounted', 'App shell mounted.');
  }, []);

  useEffect(() => {
    void backupRestoreRuntime.recoverBeforeStartupReads()
      .then(() => projectDeletionRuntime.recoverPendingIntentStores())
      .then(() => startupHydration.loaded(PROJECT_DELETION_CLOUD_INTENTS_STORAGE_KEY, 'pending project deletion cleanup'))
      .then(() => Promise.allSettled([
        projectDeletionRuntime.processPendingCloudIntents(),
        projectDeletionRuntime.processPendingFileCleanupIntents(),
      ]))
      .catch(error => { if (error instanceof ProjectDeletionIntentRecoveryRequiredError) startupHydration.fail(PROJECT_DELETION_CLOUD_INTENTS_STORAGE_KEY, 'pending project deletion cleanup', error); });
  }, [startupHydration.retryAttempt]);

useEffect(() => {
  async function loadSavedUpdates() {
    try {
      // Opening pass: cloud rows into the live list, no stale re-read (audit A2 pass 2 M1).
      if (startupHydrationReady) return await mergeCloudSavedUpdates();
      await backupRestoreRuntime.recoverBeforeStartupReads();
      const [localResult, tombstoneResult] = await Promise.all([
        readStartupJsonArray<ProjectUpdate>(
          UPDATES_STORAGE_KEY,
          [],
          'saved updates',
          isStartupDeviceSavedUpdateRecord,
        ),
        readStartupJsonArray<DeletedUpdateTombstone>(
          DELETED_UPDATES_STORAGE_KEY,
          [],
          'deleted update records',
          isStartupDeletedUpdateRecord,
        ),
      ]);
      if (!startupHydration.accept([localResult, tombstoneResult])) return;
      const localUpdates = normalizeStartupArray(
        localResult.value,
        normalizeStoredUpdateRecord,
        'saved updates',
      ).value;
      const tombstones = normalizeDeletedUpdateTombstones(
        tombstoneResult.value,
      );
      setDeletedUpdateTombstones(tombstones);
      // Field fix 2026-07-18: deletion-journal reconciliation talks to the
      // cloud; its failure is a sync concern retried later, never a local
      // hydration failure (that mis-filing drove the startup loop). Before opening, once.
      await reconcileProjectUpdateDeletionJournal(tombstones).catch(() => undefined);
      setSavedUpdates(mergeSavedUpdatesWithTombstones({
        localUpdates,
        cloudUpdates: [],
        tombstones,
      }));
      setUpdatesLocalLoaded(true);
      setUpdatesLoaded(true);
      setDeletedUpdateTombstonesLoaded(true);
    } catch (error) {
      startupHydration.fail(UPDATES_STORAGE_KEY, 'saved updates', error);
    }
  }

  async function mergeCloudSavedUpdates() {
    try {
      const cloudUpdates = await loadCloudUpdates<ProjectUpdate>();
      const normalizedCloudUpdates = normalizeStartupArray(
        cloudUpdates,
        normalizeStoredUpdateRecord,
        'cloud saved updates',
      ).value;
      const effectiveTombstones = normalizedCloudUpdates
        .filter(update => update.isArchived)
        .map(update => buildUpdateTombstone(
          update,
          'hide_cloud_update',
          update.archivedAt || update.date,
        ))
        .reduce(
          (current, tombstone) => upsertDeletedUpdateTombstone(current, tombstone),
          deletedUpdateTombstonesRef.current,
        );
      deletedUpdateTombstonesRef.current = effectiveTombstones;
      setDeletedUpdateTombstones(effectiveTombstones);

      setSavedUpdates(current => {
        const merged = mergeSavedUpdatesWithTombstones({
          localUpdates: current,
          cloudUpdates: normalizedCloudUpdates,
          tombstones: effectiveTombstones,
        });
        savedUpdatesRef.current = merged;
        return merged;
      });
    } catch {
      // Cloud recovery failures are retried by sync (audit P1-27); local
      // hydration already succeeded and must stay hydrated.
    }
  }

  void loadSavedUpdates();
}, [startupHydration.retryAttempt, startupHydrationReady]);

useEffect(() => {
  const ready = startupHydrationReady &&
    projectsLoaded &&
    deletedProjectNamesLoaded &&
    updatesLoaded &&
    projectAreasLoaded &&
    referenceDocumentsLoaded &&
    projectDocumentsLoaded &&
    scheduleItemsLoaded;
  if (!ready || legacyProjectStructureMigrationInFlight.current) return;

  let active = true;
  legacyProjectStructureMigrationInFlight.current = true;

  void (async () => {
    try {
      const completed = await AsyncStorage.getItem(
        LEGACY_PROJECT_STRUCTURE_CLOUD_MIGRATION_KEY,
      );
      if (completed === 'complete') return;

      const tokenResult = await getCurrentSessionAccessToken();
      if (!tokenResult.ok || tokenResult.data?.status !== 'token_present') return;

      const [cloudProjects, cloudArchivedProjects] = await Promise.all([
        listProjects(),
        listArchivedProjects(),
      ]);
      // Field fix 2026-07-18 (cpu_resource kill, audit P1-21): a failed or
      // unverifiable cloud inventory must SKIP the migration this launch —
      // it previously fell through to a full synchronizeLocalData, which
      // base64-encodes and uploads every photo of every update on the JS
      // thread at every app start (84% CPU for ~107s in the crash report)
      // because the completion marker only writes after a fully clean sync.
      if (
        !cloudProjects.ok || cloudProjects.stubbed || !cloudProjects.data ||
        !cloudArchivedProjects.ok || cloudArchivedProjects.stubbed || !cloudArchivedProjects.data
      ) return;
      const remainingLegacyProjects = [
        ...cloudProjects.data,
        ...cloudArchivedProjects.data,
      ].filter(project =>
        Boolean(legacyWorkContainerMigration(project.name)),
      );
      if (remainingLegacyProjects.length === 0) {
        await AsyncStorage.setItem(
          LEGACY_PROJECT_STRUCTURE_CLOUD_MIGRATION_KEY,
          'complete',
        );
        if (active) {
          setSyncCleanupNotice(
            'Project records are organized under the 2321 and 2375 parent projects. Existing updates and photos were preserved.',
          );
        }
        return;
      }

      const migratedUpdates = savedUpdates.map(migrateLegacyProjectUpdate);
      const migratedSchedules = identityAliasCleanup.scheduleItemsForFullSync.map(migrateLegacyScheduleItem);
      const syncResult = await synchronizeLocalData({
        projects: [...DEFAULT_PROJECTS],
        savedUpdates: migratedUpdates,
        projectAreas,
        scheduleItems: migratedSchedules,
        referenceDocuments,
      });
      const projectStructureErrors = syncResult.errors.filter(error =>
        /Project “.*could not sync|Schedule task “.*could not sync/i.test(error),
      );
      if (
        projectStructureErrors.length > 0 ||
        syncResult.queued > 0 ||
        syncResult.conflicts > 0 ||
        // Audit P1-27/P1-21: never proceed to cloud deletions after an
        // incomplete or failed cloud download.
        syncResult.downloadStatus !== 'complete'
      ) return;

      for (const migration of LEGACY_WORK_CONTAINER_MIGRATIONS) {
        await deleteCloudProject(migration.legacyName);
      }
      const deleteResult = await uploadPendingChanges();
      if (deleteResult.errors.length > 0 || deleteResult.queued > 0) return;

      await AsyncStorage.setItem(
        LEGACY_PROJECT_STRUCTURE_CLOUD_MIGRATION_KEY,
        'complete',
      );
      if (active) {
        setSyncCleanupNotice(
          'Project records reorganized under the 2321 and 2375 parent projects. Existing updates and photos were preserved.',
        );
      }
    } catch {
      // This is an opportunistic signed-in cleanup. A transient storage or
      // network failure must never become an unhandled startup rejection;
      // leaving the completion marker unset safely retries on a later launch.
    } finally {
      legacyProjectStructureMigrationInFlight.current = false;
    }
  })();

  return () => {
    active = false;
  };
}, [
  deletedProjectNamesLoaded,
  projectAreasLoaded,
  projectDocumentsLoaded,
  projectsLoaded,
  referenceDocumentsLoaded,
  scheduleItemsLoaded,
  startupHydrationReady,
  updatesLoaded,
]);

useEffect(() => {
  let active = true;

  void localDAVECaptureMemoryRepository.list()
    .then(memories => {
      if (active) {
        setCaptureMemories([...memories]);
        startupHydration.loaded('dave-capture-memories', 'confirmed project memories');
        setCaptureMemoriesLoaded(true);
      }
    })
    .catch(error => {
      if (active) {
        startupHydration.fail('dave-capture-memories', 'confirmed project memories', error);
      }
    });

  return () => {
    active = false;
  };
}, [startupHydration.retryAttempt]);

useEffect(() => {
  let active = true;

  void localDAVEIdentityRepository.list()
    .then(corrections => {
      if (active) {
        setIdentityCorrections([...corrections]);
        startupHydration.loaded('dave-identity-corrections', 'identity corrections');
        setIdentityCorrectionsLoaded(true);
      }
    })
    .catch(error => {
      if (active) startupHydration.fail('dave-identity-corrections', 'identity corrections', error);
    });

  return () => {
    active = false;
  };
}, [startupHydration.retryAttempt]);

const identityAliasCleanup = useIdentityAliasCleanup({
  retryAttempt: startupHydration.retryAttempt,
  ready: identityCorrectionsLoaded && projectsLocalLoaded && projectAreasLocalLoaded,
  projectNames: projects, projectAreas, scheduleItems,
  onCorrections: corrections => setIdentityCorrections([...corrections]),
});

useEffect(() => {
  if (!identityCorrectionsLoaded || !scheduleItemsLocalLoaded || !projectAreasLocalLoaded) return;
  if (!identityAliasCleanup.done) return;
  if (identityCorrections.length > 0 && scheduleItems.length > 0) {
    setScheduleItems(previous => {
      const canonical = canonicalizeScheduleIdentityItems(
        previous,
        projectAreas,
        identityCorrections,
        daveRegisteredIdentityNames({ projectNames: projects, projectAreas }),
      );
      return JSON.stringify(canonical) === JSON.stringify(previous)
        ? previous
      : canonical;
    });
  }
  setScheduleIdentityReady(true);
}, [
  identityAliasCleanup.done,
  identityCorrections,
  identityCorrectionsLoaded,
  projects,
  projectAreas,
  projectAreasLocalLoaded,
  scheduleItems.length,
  scheduleItemsLocalLoaded,
]);

useEffect(() => {
  let active = true;

  void localDAVEProjectWalkSessionRepository.readActive()
    .then(session => {
      if (active) setActiveProjectWalkSession(session);
    })
    .catch(() => {
      if (active) {
        Alert.alert(
          'Project Walk unavailable',
          'The active Project Walk could not be restored from this device.',
        );
      }
    });

  return () => {
    active = false;
  };
}, []);

useEffect(() => {
  async function loadProjects() {
    try {
      // Opening pass: cloud rows only, into the live lists (audit A2 pass 2 M1).
      if (startupHydrationReady) return await mergeCloudProjects();
      await backupRestoreRuntime.recoverBeforeStartupReads();
      const [localResult, deletedProjectsResult, queuedChanges] = await Promise.all([
        readStartupJsonArray<ProjectRecord>(
          PROJECTS_STORAGE_KEY,
          [],
          'saved projects',
          isStartupProjectRecord,
        ),
        readStartupJsonArray<string>(
          DELETED_PROJECTS_STORAGE_KEY,
          [],
          'deleted project records',
          isStartupProjectName,
        ),
        // Read only for queued reopens and deletions: a queue that cannot be
        // recovered is a sync matter, not a startup failure (audit A7 pass 3).
        getOfflineQueue().catch(() => []),
      ]);
      if (!startupHydration.accept([localResult, deletedProjectsResult])) return;
      const localProjects = normalizeProjectRecords(localResult.value);
      const queuedProjectChanges = queuedProjectNameChanges(queuedChanges);
      const queuedDeletedNames = queuedProjectChanges.deletedNames;
      const deletedNames = mergeProjectNames(
        mergeProjectNames(
          mergeProjectNames(
            normalizeStringList(
              deletedProjectsResult.value,
            ),
            queuedDeletedNames,
          ),
          LEGACY_WORK_CONTAINER_MIGRATIONS.map(item => item.legacyName),
        ),
        [...LEGACY_NON_PROJECT_SHELL_NAMES],
      );
      deletedProjectNamesRef.current = deletedNames;
      setDeletedProjectNames(deletedNames);
      const starterProjects = localResult.found ? [] : DEFAULT_PROJECTS;
      const localRecords = mergeProjectRecords(
        starterProjects,
        localProjects,
        [],
        deletedNames,
      );
      setProjectRecords(localRecords);
      setProjects(localRecords.map(project => project.name));
      setProjectsLocalLoaded(true);
      setDeletedProjectNamesLocalLoaded(true);
      setProjectsLoaded(true);
      setDeletedProjectNamesLoaded(true);
    } catch (error) {
      startupHydration.fail(PROJECTS_STORAGE_KEY, 'saved projects', error);
    }
  }

  async function mergeCloudProjects() {
    try {
      const [cloudProjects, cloudArchivedProjects, queuedChanges] = await Promise.all([
        loadCloudProjectRecords(),
        loadCloudArchivedProjectNames(),
        getOfflineQueue().catch(() => []),
      ]);
      const nonProjectShellNames = legacyNonProjectShellNamesPresent(cloudProjects);
      const visibleCloudProjects = cloudProjects.filter(
        project => !isLegacyNonProjectShellName(project.name),
      );
      const shellMigrationComplete = await AsyncStorage.getItem(
        LEGACY_NON_PROJECT_SHELL_CLOUD_MIGRATION_KEY,
      );
      if (nonProjectShellNames.length > 0 && shellMigrationComplete !== 'complete') {
        await queueCloudProjectArchives(nonProjectShellNames);
        await persistStorageItem(
          LEGACY_NON_PROJECT_SHELL_CLOUD_MIGRATION_KEY,
          'complete',
        );
      }
      const currentDeletedNames = deletedProjectNamesRef.current;
      const deletedKeys = new Set(
        currentDeletedNames.map(name => name.toLowerCase()),
      );
      const { reopenedKeys } = queuedProjectNameChanges(queuedChanges);
      setProjectRecords(current => {
        return mergeProjectRecords(
          [],
          current,
          visibleCloudProjects,
          currentDeletedNames,
        );
      });
      setProjects(current => mergeProjectNames(
        current,
        visibleCloudProjects.map(project => project.name),
      ).filter(project => !deletedKeys.has(project.toLowerCase())));
      setArchivedProjects(previous =>
        // A reopen still in the offline queue is not re-archived (audit A3).
        mergeProjectNames(
          previous,
          cloudArchivedProjects.filter(project => !reopenedKeys.has(project.trim().toLowerCase())),
        ).filter(
          project => !deletedKeys.has(project.toLowerCase()),
        ),
      );
    } catch {
      // Field fix 2026-07-18: cloud recovery failures are sync concerns
      // (audit P1-27) and must never mis-file as a LOCAL hydration failure
      // — that oscillated startupHydrationReady in an infinite loop.
    }
  }

  void loadProjects();
}, [startupHydration.retryAttempt, startupHydrationReady]);

useEffect(() => {
  if (!startupHydrationReady) return;
  void Promise.all(projectRecords.map(async project => {
    if (!project.coverPhoto?.remotePath) return;
    const hydrationTarget = project.coverPhoto;
    const hydrationVersion =
      project.coverPhotoUpdatedAt || hydrationTarget.updatedAt || null;
    const hydrated = await hydrateProjectCoverPhotoCache(
      authorityProjectId(project.name),
      hydrationTarget,
    );
    if (hydrated.localUri === hydrationTarget.localUri) return;
    // Audit P1-58: compare-and-swap — apply hydrated bytes only if the record
    // still references the exact cover version downloaded by this attempt.
    setProjectRecords(previous => previous.map(item => {
      if (item.name.toLowerCase() !== project.name.toLowerCase()) return item;
      if (!item.coverPhoto) return item;
      if (item.coverPhoto.remotePath !== hydrationTarget.remotePath) return item;
      const currentVersion =
        item.coverPhotoUpdatedAt || item.coverPhoto.updatedAt || null;
      if (currentVersion !== hydrationVersion) return item;
      return { ...item, coverPhoto: hydrated };
    }));
  })).catch(() => undefined);
}, [projectRecords, startupHydrationReady]);

  useEffect(() => {
    if (!startupHydrationReady) return;
    void cleanupStoredSyncStatusMessages()
      .then(result => {
        if (result.cleaned || result.missingPhotosRemoved > 0) {
          setSyncCleanupNotice('Sync status cleaned up. Unavailable photo references were removed safely.');
        }
      })
      .catch(() => undefined);
  }, [startupHydrationReady]);

  useEffect(() => {
    if (!deletedProjectNamesLocalLoaded) return;

    backupRestoreRuntime.recoverBeforeStartupReads()
      .then(() => readStartupJsonArray<string>(
        ARCHIVED_PROJECTS_STORAGE_KEY,
        [],
        'archived projects',
        isStartupProjectName,
      ))
      .then(result => {
        if (!startupHydration.accept([result])) return;
        const parsed = result.value;

        if (Array.isArray(parsed)) {
          const deletedKeys = new Set(
            deletedProjectNamesRef.current.map(name => name.toLowerCase()),
          );
          setArchivedProjects(previous =>
            mergeProjectNames(previous, parsed).filter(
              project => !deletedKeys.has(project.toLowerCase()),
            ),
          );
        }
        setArchivedProjectsLoaded(true);
      })
      .catch(error => startupHydration.fail(ARCHIVED_PROJECTS_STORAGE_KEY, 'archived projects', error));
  }, [deletedProjectNamesLocalLoaded, startupHydration.retryAttempt]);

  useStartupLocalFirstRecovery<ProjectArea, ProjectArea, ProjectArea>({
    retryAttempt: startupHydration.retryAttempt, startupReady: startupHydrationReady,
    localLoaded: projectAreasLocalLoaded, localAuthorityReady: projectAreasLoaded, localAuthorityRef: projectAreasAuthorityRef, resetLocalLoaded: () => { setProjectAreasLocalLoaded(false); markProjectAreasAuthorityReady(false); },
    readLocal: () => backupRestoreRuntime.recoverBeforeStartupReads().then(() =>
      readStartupJsonArray(PROJECT_AREAS_STORAGE_KEY, DEFAULT_PROJECT_AREAS, 'project areas', isStartupProjectAreaRecord)),
    acceptLocal: result => startupHydration.accept([result]),
    normalizeLocal: normalizeProjectAreas,
    applyLocal: (areas, found) => { setProjectAreas(areas); setProjectAreasLocalLoaded(true); markProjectAreasAuthorityReady(found); },
    onLocalError: error => startupHydration.fail(PROJECT_AREAS_STORAGE_KEY, 'project areas', error),
    loadCloud: listProjectAreas, synchronizeTombstones: synchronizeDAVESyncTombstones,
    normalizeCloud: areas => normalizeProjectAreas(areas.filter(isStartupProjectAreaRecord)),
    applyCloud: (areas, tombstones) => setProjectAreas(current => mergeDAVEProjectAreaRecoveryRecords({
      local: current, cloud: areas, deletedIds: deletedDAVERecordIds(tombstones, 'project_area'),
    })),
    onCloudApplied: () => markProjectAreasAuthorityReady(true),
    onCloudDeferred: () => setSyncCleanupNotice('Cloud area recovery was deferred. Phone data stayed unchanged; use Sync Now when connected.'),
  });

  useStartupLocalFirstRecovery<ReferenceDocument, ReferenceDocument, ReferenceDocument>({
    retryAttempt: startupHydration.retryAttempt, startupReady: startupHydrationReady,
    localLoaded: referenceDocumentsLocalLoaded, localAuthorityReady: referenceDocumentsLoaded, localAuthorityRef: referenceDocumentsAuthorityRef, resetLocalLoaded: () => { setReferenceDocumentsLocalLoaded(false); markReferenceDocumentsAuthorityReady(false); },
    readLocal: () => backupRestoreRuntime.recoverBeforeStartupReads().then(() =>
      readStartupJsonArray(REFERENCE_DOCUMENTS_STORAGE_KEY, [], 'reference documents', isStartupReferenceDocumentRecord)),
    acceptLocal: result => startupHydration.accept([result]),
    normalizeLocal: normalizeReferenceDocuments,
    applyLocal: (documents, found) => { setReferenceDocuments(documents); setReferenceDocumentsLocalLoaded(true); markReferenceDocumentsAuthorityReady(found); },
    onLocalError: error => startupHydration.fail(REFERENCE_DOCUMENTS_STORAGE_KEY, 'reference documents', error),
    loadCloud: listReferenceDocuments, synchronizeTombstones: synchronizeDAVESyncTombstones,
    normalizeCloud: documents => normalizeReferenceDocuments(documents.filter(isStartupReferenceDocumentRecord)),
    applyCloud: (documents, tombstones) => setReferenceDocuments(current => reconcileCurrentScheduleDocuments(mergeDAVEReferenceDocumentRecoveryRecords({
      local: current, cloud: documents, deletedIds: deletedDAVERecordIds(tombstones, 'reference_document'),
    }))),
    onCloudApplied: () => markReferenceDocumentsAuthorityReady(true),
    onCloudDeferred: () => setSyncCleanupNotice('Cloud document recovery was deferred. Phone data stayed unchanged; use Sync Now when connected.'),
  });

  useEffect(() => {
    backupRestoreRuntime.recoverBeforeStartupReads()
      .then(() => readStartupJsonArray<ProjectDocument>(
        PROJECT_DOCUMENTS_STORAGE_KEY,
        [],
        'project documents',
        isStartupStandaloneProjectDocumentRecord,
      ))
      .then(result => {
        if (!startupHydration.accept([result])) return;
        // Audit P1-23: uploads cannot survive relaunch; stale 'uploading'
        // documents become retryable 'failed' instead of pending forever.
        setProjectDocuments(
          recoverStaleUploadingDocuments(
            normalizeProjectDocuments(result.value).map(migrateLegacyProjectDocument),
          ),
        );
        setProjectDocumentsLoaded(true);
      })
      .catch(error => startupHydration.fail(PROJECT_DOCUMENTS_STORAGE_KEY, 'project documents', error));
  }, [startupHydration.retryAttempt]);

  const scheduleCloudDownloadPending = useStartupLocalFirstRecovery<ScheduleItem, ScheduleItem, ScheduleItem>({
    retryAttempt: startupHydration.retryAttempt, startupReady: startupHydrationReady,
    localLoaded: scheduleItemsLocalLoaded, localAuthorityReady: scheduleItemsLoaded, localAuthorityRef: scheduleItemsAuthorityRef, resetLocalLoaded: () => { setScheduleItemsLocalLoaded(false); markScheduleItemsAuthorityReady(false); },
    readLocal: () => backupRestoreRuntime.recoverBeforeStartupReads().then(() =>
      readStartupJsonArray(SCHEDULE_ITEMS_STORAGE_KEY, [], 'schedule items', isStartupScheduleItemRecord)),
    acceptLocal: result => startupHydration.accept([result]),
    normalizeLocal: items => reconcileDAVEScheduleRecords(
      normalizeScheduleItems(items).map(migrateLegacyScheduleItem),
    ),
    applyLocal: (items, found) => { setScheduleItems(items); setScheduleItemsLocalLoaded(true); markScheduleItemsAuthorityReady(found); },
    onLocalError: error => startupHydration.fail(SCHEDULE_ITEMS_STORAGE_KEY, 'schedule items', error),
    loadCloud: listScheduleItems, synchronizeTombstones: synchronizeDAVESyncTombstones,
    normalizeCloud: items => normalizeScheduleItems(
      items.filter(isDAVESafeCloudScheduleRecord),
    ).map(migrateLegacyScheduleItem),
    applyCloud: (items, tombstones) => setScheduleItems(current => recoverDAVEScheduleRecords({
      local: current, cloud: items, deletedIds: deletedDAVERecordIds(tombstones, 'schedule_item'),
      allowCloudOnly: true,
    })),
    onCloudApplied: () => markScheduleItemsAuthorityReady(true),
    onCloudDeferred: () => setSyncCleanupNotice('Cloud schedule recovery was deferred. Phone data stayed unchanged; use Sync Now when connected.'),
  });

  // Opens on the saved name; the account lookup follows (audit A2 M2).
  const typeDisplayName = useAccountDisplayName({
    storageKey: DISPLAY_NAME_STORAGE_KEY, retryAttempt: startupHydration.retryAttempt, workspaceOwnerId,
    saveReady: startupHydrationReady && displayNameLoaded, displayName, setDisplayName,
    onLoaded: () => {
      startupHydration.loaded(DISPLAY_NAME_STORAGE_KEY, 'profile settings');
      setDisplayNameLoaded(true);
    },
    onFailed: error => startupHydration.fail(DISPLAY_NAME_STORAGE_KEY, 'profile settings', error),
  });

  useEffect(() => {
    backupRestoreRuntime.recoverBeforeStartupReads()
      .then(() => readStartupJson(
        CONTACTS_STORAGE_KEY,
        { contacts: [] },
        'contacts',
        isStartupContactBook,
        value => {
          const salvaged = salvageStartupContactBook(value);
          return salvaged
            ? {
                value: salvaged.value as ContactBook,
                isolatedRecordCount: salvaged.isolatedRecordCount,
              }
            : null;
        },
      ))
      .then(result => {
        if (!startupHydration.accept([result])) return;
        setContactBook(normalizeContacts(result.value));
        setContactsLoaded(true);
      })
      .catch(error => startupHydration.fail(CONTACTS_STORAGE_KEY, 'contacts', error));
  }, [startupHydration.retryAttempt]);

  useEffect(() => {
    backupRestoreRuntime.recoverBeforeStartupReads()
      .then(() => readStartupJson<Partial<StoredDraft>>(
        DRAFT_STORAGE_KEY,
        {},
        'unfinished field update',
        isStartupDeviceDraftEnvelope,
      ))
      .then(result => {
        if (!startupHydration.accept([result])) return;
        const parsed = result.value;
        setDraftLoaded(true);

        if (!parsed.draft) return;

        const recoveredDraft = migrateLegacyProjectUpdate(normalizeUpdate(parsed.draft));

        if (hasMeaningfulDraft(recoveredDraft)) {
          setDraft(recoveredDraft);

          setDraftSavedAt(
            typeof parsed.savedAt === 'string'
              ? parsed.savedAt
              : null,
          );
        }
      })
      .catch(error => startupHydration.fail(DRAFT_STORAGE_KEY, 'unfinished field update', error));
  }, [startupHydration.retryAttempt]);

  useEffect(() => {
    const startupReady = startupHydrationReady &&
      updatesLoaded &&
      deletedUpdateTombstonesLoaded &&
      projectsLoaded &&
      deletedProjectNamesLoaded &&
      archivedProjectsLoaded &&
      projectAreasLoaded &&
      referenceDocumentsLoaded &&
      projectDocumentsLoaded &&
      scheduleItemsLoaded &&
      displayNameLoaded &&
      contactsLoaded &&
      draftLoaded;
    if (!startupReady || startupCompletionLogged.current) return;

    startupCompletionLogged.current = true;
    logStartupDiagnostic('startup_completed', 'Local startup completed.', {
      projectCount: projects.length,
      savedUpdateCount: savedUpdates.length,
      scheduleItemCount: scheduleItems.length,
    });
  }, [
    archivedProjectsLoaded,
    contactsLoaded,
    deletedProjectNamesLoaded,
    deletedUpdateTombstonesLoaded,
    displayNameLoaded,
    draftLoaded,
    projectAreasLoaded,
    projectDocumentsLoaded,
    projects.length,
    projectsLoaded,
    referenceDocumentsLoaded,
    savedUpdates.length,
    scheduleItems.length,
    scheduleItemsLoaded,
    startupHydrationReady,
    updatesLoaded,
  ]);

  useEffect(() => {
    if (!startupHydrationReady || !updatesLoaded) return;

    if (savedUpdatesSaveTimer.current) {
      clearTimeout(savedUpdatesSaveTimer.current);
    }

    savedUpdatesSaveTimer.current = setTimeout(() => {
      savedUpdatesSaveTimer.current = null;

      persistStorageItem(UPDATES_STORAGE_KEY, JSON.stringify(savedUpdates)).catch(error =>
        reportStoragePersistenceFailure({ storageKey: UPDATES_STORAGE_KEY, label: 'saved updates', error }),
      );
    }, 750);

    return () => {
      if (savedUpdatesSaveTimer.current) {
        clearTimeout(savedUpdatesSaveTimer.current);
        // Cleared too, or the background handler wrote the list after a
        // blocked read took readiness away (whole-app audit A4 pass 5).
        savedUpdatesSaveTimer.current = null;
      }
    };
  }, [savedUpdates, startupHydrationReady, updatesLoaded]);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => {
      if (state !== 'background' && state !== 'inactive') return;
      void flushPendingStoragePersistence();
      // The draft's own timer too: a caption or photo added just before
      // backgrounding sat only in memory while the app was suspended
      // (whole-app audit A4, 29 Sep 2026). Only a pending write is flushed.
      if (draftSaveTimer.current) void persistDraftNow(draftRef.current);
      if (!savedUpdatesSaveTimer.current) return;
      clearTimeout(savedUpdatesSaveTimer.current);
      savedUpdatesSaveTimer.current = null;
      persistStorageItem(UPDATES_STORAGE_KEY, JSON.stringify(savedUpdatesRef.current)).catch(error =>
        reportStoragePersistenceFailure({ storageKey: UPDATES_STORAGE_KEY, label: 'saved updates', error }),
      );
    });
    return () => subscription.remove();
  }, []);
  useJsonStoragePersistence({
    enabled: startupHydrationReady && deletedUpdateTombstonesLoaded,
    storageKey: DELETED_UPDATES_STORAGE_KEY,
    value: deletedUpdateTombstones,
    label: 'deleted update records',
  });
  useJsonStoragePersistence({
    enabled: startupHydrationReady && projectsLoaded,
    storageKey: PROJECTS_STORAGE_KEY,
    value: projectRecords,
    label: 'projects',
  });
  useJsonStoragePersistence({
    enabled: startupHydrationReady && deletedProjectNamesLoaded,
    storageKey: DELETED_PROJECTS_STORAGE_KEY,
    value: deletedProjectNames,
    label: 'deleted project records',
  });
  useJsonStoragePersistence({
    enabled: startupHydrationReady && archivedProjectsLoaded,
    storageKey: ARCHIVED_PROJECTS_STORAGE_KEY,
    value: archivedProjects,
    label: 'archived projects',
  });
  useJsonStoragePersistence({
    enabled: startupHydrationReady && projectAreasLoaded,
    storageKey: PROJECT_AREAS_STORAGE_KEY,
    value: projectAreas,
    label: 'project areas',
  });
  useJsonStoragePersistence({
    enabled: startupHydrationReady && referenceDocumentsLoaded,
    storageKey: REFERENCE_DOCUMENTS_STORAGE_KEY,
    value: compactECOSReferenceDocumentsForOperationalRead(referenceDocuments),
    label: 'reference documents',
  });
  useJsonStoragePersistence({
    enabled: startupHydrationReady && projectDocumentsLoaded,
    storageKey: PROJECT_DOCUMENTS_STORAGE_KEY,
    value: projectDocuments,
    label: 'project documents',
  });
  useJsonStoragePersistence({
    enabled: startupHydrationReady && scheduleItemsLoaded,
    storageKey: SCHEDULE_ITEMS_STORAGE_KEY,
    value: scheduleItems,
    label: 'schedule',
  });
  useEffect(() => {
    if (!startupHydrationReady || !scheduleItemsLoaded || !projectsLoaded) return;
    ensureScheduleParentProjects(scheduleItems);
  }, [scheduleItems, scheduleItemsLoaded, projects, projectsLoaded, startupHydrationReady]);
  useEffect(() => {
    // A schedule labelled with projects none of its rows belong to (every
    // project the import could use, before 30 Sep) is narrowed to its rows'
    // projects, or it hid another project's schedule (audit A5 pass 2).
    if (!startupHydrationReady || !scheduleItemsLoaded || !referenceDocumentsLoaded) return;
    const repair = narrowScheduleDocumentLabels(referenceDocuments, scheduleItems, new Date().toISOString());
    if (repair.changed.length === 0) return;
    markReferenceDocumentsAuthorityReady(true);
    referenceDocumentsCurrentRef.current = repair.documents;
    setReferenceDocuments(repair.documents);
    void Promise.all(repair.changed.map(document => queueReferenceDocumentRecord(document))).catch(() => undefined);
  }, [referenceDocuments, referenceDocumentsLoaded, scheduleItems, scheduleItemsLoaded, startupHydrationReady]);
  useEffect(() => { // shared records of documents deleted on Build 228 or earlier (audit A7 pass 4)
    if (!startupHydrationReady || !projectDocumentsLoaded || !referenceDocumentsLoaded) return;
    const orphanIds = legacyOrphanedProjectDocumentBridges(referenceDocuments, projectDocuments).map(document => document.id);
    if (orphanIds.length === 0) return;
    markReferenceDocumentsAuthorityReady(true);
    setReferenceDocuments(prev => prev.filter(document => !orphanIds.includes(document.id)));
    void Promise.all(orphanIds.map(id => removeOperationalRecordFromSyncQueue('reference_document', id))).catch(() => undefined);
  }, [projectDocuments, projectDocumentsLoaded, referenceDocuments, referenceDocumentsLoaded, startupHydrationReady]);

  useStringStoragePersistence({
    enabled: startupHydrationReady && displayNameLoaded,
    storageKey: DISPLAY_NAME_STORAGE_KEY,
    value: displayName,
    label: 'profile setting',
  });
  useJsonStoragePersistence({
    enabled: startupHydrationReady && contactsLoaded,
    storageKey: CONTACTS_STORAGE_KEY,
    value: contactBook,
    label: 'contacts',
  });
  useEffect(() => {
    if (!startupHydrationReady || !draftLoaded) return;

    if (draftSaveTimer.current) {
      clearTimeout(draftSaveTimer.current);
    }

    draftSaveTimer.current = setTimeout(() => {
      void persistDraftNow(draft);
    }, 750);

    return () => {
      if (draftSaveTimer.current) {
        clearTimeout(draftSaveTimer.current);
      }
    };
  }, [draft, draftLoaded, startupHydrationReady]);

  /**
   * Writes the draft now (the 750 ms timer's own work, run at once): the
   * timer when it fires, the background flush, and a draft replacement
   * before the old draft's files go (whole-app audit A4, 29 Sep 2026).
   */
  function persistDraftNow(nextDraft: ProjectUpdate): Promise<void> {
    if (draftSaveTimer.current) {
      clearTimeout(draftSaveTimer.current);
      draftSaveTimer.current = null;
    }
    if (!hasMeaningfulDraft(nextDraft)) {
      setDraftSavedAt(null);
      return removePersistedStorageItem(DRAFT_STORAGE_KEY).catch(error =>
        reportStoragePersistenceFailure({ storageKey: DRAFT_STORAGE_KEY, label: 'field update draft', error }),
      );
    }
    const savedAt = new Date().toISOString();
    const storedDraft: StoredDraft = { draft: nextDraft, savedAt };
    setDraftSavedAt(savedAt);
    return persistStorageItem(DRAFT_STORAGE_KEY, JSON.stringify(storedDraft)).catch(error =>
      reportStoragePersistenceFailure({ storageKey: DRAFT_STORAGE_KEY, label: 'field update draft', error }),
    );
  }

  /**
   * The replacement draft (already in draftRef) is on disk before the
   * discarded draft's photo files are deleted: a kill inside the timer's
   * window restored the old draft pointing at deleted files (audit A4; the
   * same window on every path that replaces a draft, PR #83's included).
   */
  async function discardDraftAfterReplacement(discardedDraft: ProjectUpdate): Promise<void> {
    await persistDraftNow(draftRef.current);
    await deleteUnreferencedPhotosFromUpdate(discardedDraft, savedUpdatesRef.current);
  }

  useEffect(() => {
    if (!startupHydrationReady || !updatesLoaded || !draftLoaded || photoCleanupRan.current) {
      return;
    }

    photoCleanupRan.current = true;

    const referencedUris = new Set(
      [draft, ...savedUpdates].flatMap(update =>
        update.photos.map(photo => photo.uri),
      ),
    );
    void cleanupProjectPhotoDirectory({
      directoryUri: PHOTO_STORAGE_DIR,
      folderName: PHOTO_STORAGE_FOLDER,
      currentOwnerId: workspaceOwnerId,
      referencedUris,
      storage: AsyncStorage,
      fileSystem: FileSystem,
    }).catch(() => undefined);
  }, [updatesLoaded, draftLoaded, draft, savedUpdates, startupHydrationReady, workspaceOwnerId]);

  const hasQueuedSyncRetries = useMemo(
    () => savedUpdates.some(update => updateNeedsAutomaticSyncRetry(update)),
    [savedUpdates],
  );

  useEffect(() => {
    if (!startupHydrationReady || !updatesLoaded || !hasQueuedSyncRetries) return;
    startAutomaticSyncBackgroundTask('queued_updates_detected', hydrateQueuedUpdates);
  }, [updatesLoaded, hasQueuedSyncRetries, startupHydrationReady]);
  useEffect(() => { if (startupHydrationReady && projectDocumentsLoaded) void projectDocumentUploadRetry.run(retryProjectDocumentUpload); }, [projectDocumentsLoaded, startupHydrationReady]);

  useEffect(() => {
    const operationalDataLoaded = projectsLoaded || updatesLoaded || projectAreasLoaded ||
      referenceDocumentsLoaded || scheduleItemsLoaded;
    if (!startupHydrationReady || !operationalDataLoaded) return;
    let active = true;

    const applyRealtimeOperationalPayload = createDAVEOperationalRealtimeApplier({
      isActive: () => active,
      snapshot: () => ({
        projects: projectsCurrentRef.current, projectRecords: projectRecordsCurrentRef.current,
        archivedProjects: archivedProjectsCurrentRef.current, deletedProjectNames: deletedProjectNamesRef.current,
        updates: savedUpdatesRef.current, deletedUpdates: deletedUpdateTombstonesRef.current,
        tombstones: operationalSyncTombstonesRef.current, areas: projectAreasCurrentRef.current,
        scheduleItems: scheduleItemsCurrentRef.current, documents: referenceDocumentsCurrentRef.current,
      }),
      getPendingQueue: getOfflineQueue, normalizeUpdate: normalizeStoredUpdateRecord,
      normalizeAreas: normalizeProjectAreas, normalizeSchedule: normalizeScheduleItems,
      normalizeDocuments: normalizeReferenceDocuments, migrateSchedule: migrateLegacyScheduleItem,
      localPhotoUri: resolveProjectPhotoUri, mergeProjectNames, deviceDocuments: () => projectDocumentsCurrentRef.current,
      updateHasPendingLocalWork: updateNeedsAutomaticSyncRetry,
      mergeUpdates: mergeSavedUpdatesWithTombstones, buildUpdateTombstone,
      buildCloudDeletionBarrier: buildCloudUpdateDeletionBarrier,
      upsertDeletedUpdate: upsertDeletedUpdateTombstone,
      commitProjects: (records, projects, archived) => {
        projectRecordsCurrentRef.current = records; projectsCurrentRef.current = projects;
        archivedProjectsCurrentRef.current = archived;
        setProjectRecords(records); setProjects(projects); setArchivedProjects(archived);
      },
      commitDeletedProjects: createDAVEOperationalRealtimeCommit(deletedProjectNamesRef, setDeletedProjectNames),
      commitUpdates: createDAVEOperationalRealtimeCommit(savedUpdatesRef, setSavedUpdates),
      commitDeletedUpdates: createDAVEOperationalRealtimeCommit(deletedUpdateTombstonesRef, setDeletedUpdateTombstones),
      commitTombstones: createDAVEOperationalRealtimeCommit(operationalSyncTombstonesRef, setOperationalSyncTombstones),
      commitAreas: createDAVEOperationalRealtimeCommit(projectAreasCurrentRef, setProjectAreas),
      commitSchedule: createDAVEOperationalRealtimeCommit(scheduleItemsCurrentRef, setScheduleItems),
      commitDocuments: createDAVEOperationalRealtimeCommit(referenceDocumentsCurrentRef, setReferenceDocuments),
    });

    async function refreshOperationalCollections(
      _trigger: DAVEOperationalRefreshTrigger,
      requestedCollections?: readonly DAVEOperationalCollectionName[],
    ) {
      if (!active) return;
      const requestedCollectionSet = requestedCollections
        ? new Set(requestedCollections)
        : null;
      const shouldRefresh = (name: DAVEOperationalCollectionName) =>
        !requestedCollectionSet || requestedCollectionSet.has(name);
      const refreshCommit = operationalRefreshCommitGuard.begin();
      const tombstones = await loadDAVEOperationalTombstones();
      if (!active || !refreshCommit.isCurrent()) return;
      const latestOperationalTombstones = tombstones.tombstones;
      const currentOperationalTombstones = operationalSyncTombstonesRef.current;
      refreshCommit.commit(() => {
        operationalSyncTombstonesRef.current = latestOperationalTombstones;
        setOperationalSyncTombstones(
          JSON.stringify(latestOperationalTombstones) === JSON.stringify(currentOperationalTombstones)
            ? currentOperationalTombstones
            : latestOperationalTombstones,
        );
        const nextDeletedProjectNames = mergeProjectNames(
          deletedProjectNamesRef.current,
          deletedDAVERecordIds(latestOperationalTombstones, 'project'),
        );
        if (
          JSON.stringify(nextDeletedProjectNames) !==
          JSON.stringify(deletedProjectNamesRef.current)
        ) {
          deletedProjectNamesRef.current = nextDeletedProjectNames;
          setDeletedProjectNames(nextDeletedProjectNames);
        }
        const nextDeletedUpdateTombstones = latestOperationalTombstones
          .filter(tombstone => tombstone.entityType === 'project_update')
          .reduce(
            (current, tombstone) => upsertDeletedUpdateTombstone(
              current,
              buildCloudUpdateDeletionBarrier(
                tombstone.recordId,
                tombstone.deletedAt,
              ),
            ),
            deletedUpdateTombstonesRef.current,
          );
        if (
          JSON.stringify(nextDeletedUpdateTombstones) !==
          JSON.stringify(deletedUpdateTombstonesRef.current)
        ) {
          deletedUpdateTombstonesRef.current = nextDeletedUpdateTombstones;
          setDeletedUpdateTombstones(nextDeletedUpdateTombstones);
        }
      });
      const collectionRefreshes: DAVEOperationalCollectionRefresh[] = [];

      if (projectsLoaded && shouldRefresh('projects')) collectionRefreshes.push({ name: 'projects', run: async () => {
        const [activeProjectsResult, archivedProjectsResult, offlineQueue] = await Promise.all([
          listProjects(),
          listArchivedProjects(),
          getOfflineQueue(),
        ]);
        if (
          !activeProjectsResult.ok ||
          activeProjectsResult.stubbed ||
          !Array.isArray(activeProjectsResult.data) ||
          !archivedProjectsResult.ok ||
          archivedProjectsResult.stubbed ||
          !Array.isArray(archivedProjectsResult.data)
        ) {
          throw new Error('project_refresh_incomplete');
        }
        if (!active || !refreshCommit.isCurrent()) return;

        const cloudActiveRecords = activeProjectsResult.data
          .filter(project => project.name.trim() && !isLegacyNonProjectShellName(project.name))
          .map(projectRecordFromCloud);
        const cloudArchivedRecords = archivedProjectsResult.data
          .filter(project => project.name.trim() && !isLegacyNonProjectShellName(project.name))
          .map(projectRecordFromCloud);
        const reconciled = reconcileDAVEOperationalProjects({
          localRecords: projectRecordsCurrentRef.current,
          localArchivedProjectNames: archivedProjectsCurrentRef.current,
          cloudActiveRecords,
          cloudArchivedRecords,
          deletedProjectNames: deletedProjectNamesRef.current,
          queuedChanges: offlineQueue
            .filter(item => item.entity === 'project')
            .map(item => ({ operation: item.operation, payload: item.payload })),
        });
        const currentRecords = projectRecordsCurrentRef.current;
        const currentNames = projectsCurrentRef.current;
        const currentArchivedNames = archivedProjectsCurrentRef.current;
        refreshCommit.commit(() => {
          projectRecordsCurrentRef.current = reconciled.projectRecords;
          projectsCurrentRef.current = reconciled.projectNames;
          archivedProjectsCurrentRef.current = reconciled.archivedProjectNames;
          setProjectRecords(
            JSON.stringify(reconciled.projectRecords) === JSON.stringify(currentRecords)
              ? currentRecords
              : reconciled.projectRecords,
          );
          setProjects(
            JSON.stringify(reconciled.projectNames) === JSON.stringify(currentNames)
              ? currentNames
              : reconciled.projectNames,
          );
          setArchivedProjects(
            JSON.stringify(reconciled.archivedProjectNames) === JSON.stringify(currentArchivedNames)
              ? currentArchivedNames
              : reconciled.archivedProjectNames,
          );
        });
      }});

      if (updatesLoaded && shouldRefresh('project_updates')) collectionRefreshes.push({ name: 'project_updates', run: async () => {
        // A row listed before this device's own upload landed is older than
        // the phone's copy (audit A7 M5).
        const listStartedAt = Date.now();
        const updatesResult = await listProjectUpdates<ProjectUpdate>();
        if (!updatesResult.ok || updatesResult.stubbed || !Array.isArray(updatesResult.data)) {
          throw new Error('field_update_refresh_incomplete');
        }
        if (!active || !refreshCommit.isCurrent()) return;

        const normalizedCloudUpdates = normalizeStartupArray(
          updatesResult.data.map(row => row.updateData),
          normalizeStoredUpdateRecord,
          'cloud saved updates',
        ).value;
        const updatesForPhotoCache = savedUpdatesRef.current;
        const currentById = new Map(updatesForPhotoCache.map(update => [update.id, update]));
        const hydratedCloudUpdates = await Promise.all(
          normalizedCloudUpdates.map(async cloudUpdate => {
            if (cloudUpdate.isArchived) return cloudUpdate;
            const localUpdate = currentById.get(cloudUpdate.id);
            // Every photo is judged on this device: a resolved path can still
            // name a file that is not here (audit A7 M3). Previews are signed
            // when shown, not here (whole-app audit A4 pass 6 (30 Sep 2026)).
            return hydrateProjectUpdatePhotoPreviews({
              ...cloudUpdate,
              photos: cloudUpdate.photos.map(cloudPhoto =>
                preserveLocalPhotoTransport(cloudPhoto, localUpdate, resolveProjectPhotoUri)),
            }, { sign: false });
          }),
        );
        if (!active || !refreshCommit.isCurrent()) return;

        const [currentUpdates, pendingQueue] = await Promise.all([
          Promise.resolve(savedUpdatesRef.current),
          getOfflineQueue(),
        ]);
        const currentUpdateTombstones = deletedUpdateTombstonesRef.current;
        const refreshedUpdateTombstones = hydratedCloudUpdates
          .filter(update => update.isArchived)
          .map(update => buildUpdateTombstone(
            update,
            'hide_cloud_update',
            update.archivedAt || update.date,
          ))
          .reduce(
            (current, tombstone) => upsertDeletedUpdateTombstone(current, tombstone),
            currentUpdateTombstones,
          );
        const effectiveTombstones =
          JSON.stringify(refreshedUpdateTombstones) === JSON.stringify(currentUpdateTombstones)
            ? currentUpdateTombstones
            : refreshedUpdateTombstones;
        const cloudUpdateById = new Map(
          hydratedCloudUpdates.map(update => [update.id, update]),
        );
        const localUpdatesForMerge = currentUpdates.map(localUpdate => {
          const cloudUpdate = cloudUpdateById.get(localUpdate.id);
          return cloudUpdate &&
            !hasMatchingQueuedProjectUpdateRevision(localUpdate, pendingQueue) &&
            !projectUpdateUploadedSince(localUpdate.id, listStartedAt)
            ? withDeviceDocumentUploadState(withLatestLocalPhotoTransport(cloudUpdate, currentById.get(localUpdate.id), localUpdate, resolveProjectPhotoUri), projectDocumentsCurrentRef.current) // a document's upload state is this device's own (A7 pass 5 M1)
            : localUpdate;
        });
        const mergedUpdates = mergeSavedUpdatesWithTombstones({
          localUpdates: localUpdatesForMerge,
          cloudUpdates: hydratedCloudUpdates,
          tombstones: effectiveTombstones,
        });
        refreshCommit.commit(() => {
          deletedUpdateTombstonesRef.current = effectiveTombstones;
          if (effectiveTombstones !== currentUpdateTombstones) {
            setDeletedUpdateTombstones(effectiveTombstones);
          }
          savedUpdatesRef.current = mergedUpdates;
          setSavedUpdates(
            JSON.stringify(mergedUpdates) === JSON.stringify(currentUpdates)
              ? currentUpdates
              : mergedUpdates,
          );
          documentsUploadedAfterCloudCopy(hydratedCloudUpdates, currentUpdates, pendingQueue, projectDocumentsCurrentRef.current) // the iPad's copy says so too (A7 pass 5 M1)
            .forEach(documentId => resendUpdatesListingDocument(documentId, update => withDeviceDocumentUploadState(update, projectDocumentsCurrentRef.current)));
        });
      }});

      if (projectAreasLoaded && shouldRefresh('project_areas')) collectionRefreshes.push({ name: 'project_areas', run: async () => {
        const areasResult = await listProjectAreas();
        if (!areasResult.ok || areasResult.stubbed || !Array.isArray(areasResult.data)) throw new Error('area_refresh_incomplete');
        if (!active || !refreshCommit.isCurrent()) return;
        const cloudAreas = normalizeProjectAreas(areasResult.data.filter(isStartupProjectAreaRecord));
        const deletedIds = deletedDAVERecordIds(tombstones.tombstones, 'project_area');
        const currentAreas = projectAreasCurrentRef.current;
        const safeCloudAreas = tombstones.cloudAuthoritative ? cloudAreas : cloudAreas.filter(area => currentAreas.some(current => current.id === area.id));
        const mergedAreas = mergeDAVEProjectAreaRecoveryRecords({ local: currentAreas, cloud: safeCloudAreas, deletedIds });
        refreshCommit.commit(() => {
          projectAreasCurrentRef.current = mergedAreas;
          setProjectAreas(JSON.stringify(mergedAreas) === JSON.stringify(currentAreas)
            ? currentAreas : mergedAreas);
        });
      }});

      if (scheduleItemsLoaded && shouldRefresh('schedule_items')) collectionRefreshes.push({ name: 'schedule_items', run: async () => {
        const schedulesResult = await listScheduleItems();
        if (!schedulesResult.ok || schedulesResult.stubbed || !Array.isArray(schedulesResult.data)) throw new Error('task_refresh_incomplete');
        if (!active || !refreshCommit.isCurrent()) return;
        const cloudItems = normalizeScheduleItems(schedulesResult.data
          .filter(isDAVESafeCloudScheduleRecord)).map(migrateLegacyScheduleItem);
        const deletedIds = deletedDAVERecordIds(tombstones.tombstones, 'schedule_item');
        const currentItems = scheduleItemsCurrentRef.current;
        const safeCloudItems = tombstones.cloudAuthoritative ? cloudItems : cloudItems.filter(item => currentItems.some(current => current.id === item.id));
        const pendingQueue = await getOfflineQueue();
        const cloudItemById = new Map(safeCloudItems.map(item => [item.id, item]));
        const localItemsForMerge = currentItems.map(localItem => {
          const cloudItem = cloudItemById.get(localItem.id);
          return cloudItem
            ? scheduleItemRevisionForCloudRefresh(
                localItem,
                cloudItem,
                pendingQueue,
              )
            : localItem;
        });
        const mergedItems = recoverDAVEScheduleRecords({ local: localItemsForMerge, cloud: safeCloudItems,
          deletedIds, allowCloudOnly: true });
        refreshCommit.commit(() => {
          scheduleItemsCurrentRef.current = mergedItems;
          setScheduleItems(JSON.stringify(mergedItems) === JSON.stringify(currentItems)
            ? currentItems : mergedItems);
          identityAliasCleanup.markScheduleRefreshed(); // true names are back (audit A11 pass 2)
        });
      }});

      if (referenceDocumentsLoaded && shouldRefresh('reference_documents')) collectionRefreshes.push({ name: 'reference_documents', run: async () => {
        const documentsResult = await listReferenceDocuments();
        if (!documentsResult.ok || documentsResult.stubbed || !Array.isArray(documentsResult.data)) throw new Error('document_refresh_incomplete');
        if (!active || !refreshCommit.isCurrent()) return;
        const cloudDocuments = normalizeReferenceDocuments(documentsResult.data);
        const deletedIds = deletedDAVERecordIds(tombstones.tombstones, 'reference_document');
        const currentDocuments = referenceDocumentsCurrentRef.current;
        const safeCloudDocuments = tombstones.cloudAuthoritative ? cloudDocuments : cloudDocuments.filter(document => currentDocuments.some(current => current.id === document.id));
        const mergedDocuments = reconcileCurrentScheduleDocuments(
          mergeDAVEReferenceDocumentRecoveryRecords({ local: currentDocuments, cloud: safeCloudDocuments, deletedIds }));
        refreshCommit.commit(() => {
          referenceDocumentsCurrentRef.current = mergedDocuments;
          setReferenceDocuments(JSON.stringify(mergedDocuments) === JSON.stringify(currentDocuments)
            ? currentDocuments : mergedDocuments);
        });
      }});

      const failures = await runDAVEOperationalCollectionRefreshes(collectionRefreshes);
      if (failures.length > 0) throw new Error(`operational_collection_refresh_incomplete:${failures.join(',')}`);
    }
    let realtimeHealthy = false, lastSuccessfulRefreshAt: string | null = null;
    const refreshController = createDAVEOperationalRefreshController({
      refresh: refreshOperationalCollections,
      canRefresh: () => active && AppState.currentState !== 'background',
      onStateChange: state => {
        if (!active) return;
        if (state.status === 'retrying') setSyncCleanupNotice(DAVE_OPERATIONAL_REFRESH_RETRY_MESSAGE);
        else if (state.status === 'ready') {
          lastSuccessfulRefreshAt = state.lastSuccessfulRefreshAt;
          setSyncCleanupNotice(current =>
            current === DAVE_OPERATIONAL_REFRESH_RETRY_MESSAGE ? null : current);
        }
      },
    });
    refreshController.start();

    let realtimeHasSubscribed = false;
    let realtimeUnsubscribe: () => void = () => undefined;
    void subscribeToDAVEOperationalChanges({
      onChange: (entity, collections, payload) => {
        void applyRealtimeOperationalPayload(entity, payload)
          .then(applied => {
            if (!applied) {
              const fallbackCollections = collections
                ? Array.from(new Set(['sync_tombstones', ...collections])) as DAVEOperationalCollectionName[]
                : undefined;
              void refreshController.request('realtime', fallbackCollections);
            }
          })
          .catch(() => {
            void refreshController.request('realtime');
          });
      },
      onStatus: status => {
        if (status === 'subscribed') {
          realtimeHealthy = true;
          requestPendingChangesUpload('realtime_reconnected');
          // The durable queue moves rows; only this loop re-stages photos, so
          // updates saved offline sync when the connection returns (audit
          // A4, 30 Sep 2026: they waited for a token refresh or a relaunch).
          startAutomaticSyncBackgroundTask('realtime_reconnected', hydrateQueuedUpdates);
          void projectDocumentUploadRetry.run(retryProjectDocumentUpload); // and documents (whole-app audit A8 pass 1 F5)
          if (realtimeHasSubscribed) void refreshController.request('realtime');
          realtimeHasSubscribed = true;
        }
        if (active && (status === 'error' || status === 'closed')) {
          realtimeHealthy = false;
          setSyncCleanupNotice(DAVE_OPERATIONAL_REFRESH_RETRY_MESSAGE);
        }
      },
    }).then(unsubscribe => {
      if (!active) unsubscribe();
      else realtimeUnsubscribe = unsubscribe;
    }).catch(() => { if (active) setSyncCleanupNotice(DAVE_OPERATIONAL_REFRESH_RETRY_MESSAGE); });

    const subscription = AppState.addEventListener('change', state => {
      if (state !== 'active') return;
      startAutomaticSyncBackgroundTask('app_active', hydrateQueuedUpdates);
      void projectDocumentUploadRetry.run(retryProjectDocumentUpload);
      if (shouldRefreshDAVEOperationalDataOnForeground({
        realtimeHealthy, lastSuccessfulRefreshAt,
      })) {
        void refreshController.request('foreground');
      }
    });
    return () => {
      active = false;
      operationalRefreshCommitGuard.invalidate();
      refreshController.stop();
      realtimeUnsubscribe();
      subscription.remove();
    };
  }, [
    projectAreasLoaded,
    projectsLoaded,
    referenceDocumentsLoaded,
    scheduleItemsLoaded,
    startupHydrationReady,
    updatesLoaded,
    workspaceSignInPending,
  ]);

  const activeProjects = useMemo(
    () =>
      projects.filter(
        project =>
          !archivedProjects.some(
            archived =>
              archived.toLowerCase() ===
              project.toLowerCase(),
          ),
      ),
    [projects, archivedProjects],
  );

  const savedUpdateTaskEvidence = useMemo(
    () => partitionProjectUpdatesByDeletedTask(
      savedUpdates,
      operationalSyncTombstones,
      update => update,
    ),
    [operationalSyncTombstones, savedUpdates],
  );
  const activeSavedUpdates = useMemo(() => savedUpdateTaskEvidence.active.filter(update => !update.isArchived), [savedUpdateTaskEvidence.active]); // an archived update stops counting at once, not when the cloud copy returns (audit round 2 L4)
  const deletedTaskEvidenceIds = useMemo(
    () => new Set(savedUpdateTaskEvidence.historical.map(update => update.id)),
    [savedUpdateTaskEvidence.historical],
  );

  const projectStatsByName = useMemo(
    () => buildProjectStatsByName(activeSavedUpdates),
    [activeSavedUpdates],
  );

  const overviewProjectName = detectedProjectName;

  useEffect(() => {
    let mounted = true;

    async function detectOverviewProject() {
      if (!GPS_CAPTURE_ENABLED || projectAreas.length === 0) {
        setDetectedProjectName(null);
        setProjectDetectionStatus('none');
        return;
      }

      const recentFix = overviewLocationFixRef.current.fresh();
      if (!recentFix) setProjectDetectionStatus('checking');

      try {
        const snapshot = recentFix ? recentFix.fix : await overviewLocationFixRef.current.get();
        // Every area by nearest centre, across every project: a nearer area
        // of another project keeps this uncertain (review passes 4, 20, 21).
        const suggestions = findProjectAreaSuggestions(snapshot, projectAreas);

        if (!mounted) return;

        if (!snapshot) {
          setDetectedProjectName(null);
          setProjectDetectionStatus('denied');
          return;
        }

        const gpsCandidates = likelyProjectCandidatesFromGps(
          snapshot,
          projectAreas,
          savedUpdates,
          activeProjects,
          scheduleItems,
        );

        const decision = homeDetectionDecision({
          suggestions,
          clearProjectName: gpsCandidates.clearProjectName,
          ambiguous: gpsCandidates.ambiguous,
          hasCandidates: gpsCandidates.topCandidates.length > 0,
          projectForArea: area => resolveProjectForDetectedArea(area, savedUpdates, activeProjects, scheduleItems),
        });
        setDetectedProjectName(decision.projectName);
        setProjectDetectionStatus(decision.status);
      } catch {
        if (!mounted) return;

        setDetectedProjectName(null);
        setProjectDetectionStatus('unavailable');
      }
    }

    void detectOverviewProject();

    return () => {
      mounted = false;
    };
  }, [activeProjects, projectAreas, savedUpdates, scheduleItems]);

  const message = useMemo(
    () => buildMessage(draft),
    [draft],
  );

  const currentContacts = expandRecipients(
    contactBook,
    draft.recipients,
  );

  const currentEmails = currentContacts
    .map(contact => selectedContactEmail(contact).trim())
    .filter(Boolean);

  const currentPhones = currentContacts
    .map(contact => selectedContactPhone(contact).trim())
    .filter(Boolean);

  const draftProjectAreas = useMemo(
    () => projectAreasForProject({
      projectAreas,
      projectName: draft.projectName,
      scheduleItems,
      updates: activeSavedUpdates,
    }),
    [activeSavedUpdates, draft.projectName, projectAreas, scheduleItems],
  );
  // Only this draft's suggestion, with the area as it is now; an area deleted
  // since the fix is not offered (review pass 4).
  const draftAreaSuggestion = currentDraftAreaSuggestion({
    entry: draftAreaSuggestionEntry,
    draft,
    areas: draftProjectAreas,
  });
  const draftLocationNoticeView = currentDraftLocationNoticeView({
    notice: draftLocationNotice,
    generation: draftFixTracker.generation(),
    draft,
    areas: draftProjectAreas,
  });

  const selectedWorkspaceProjectAreas = useMemo(
    () => projectAreasForProject({
      projectAreas,
      projectName: selectedWorkspaceProject,
      scheduleItems,
      updates: activeSavedUpdates,
    }),
    [activeSavedUpdates, projectAreas, scheduleItems, selectedWorkspaceProject],
  );

  const talkProjectAreas = useMemo(
    () => projectAreasForProject({
      projectAreas,
      projectName: talkProjectName,
      scheduleItems,
      updates: activeSavedUpdates,
    }),
    [activeSavedUpdates, projectAreas, scheduleItems, talkProjectName],
  );

  const currentDraftArea = useMemo(
    () =>
      draftProjectAreas.find(area => area.id === draft.selectedAreaId) ||
      null,
    [draft.selectedAreaId, draftProjectAreas],
  );

  const draftPIEStatus = useMemo(
    () => summarizePIEStatusForUpdate(draft),
    [draft],
  );

  function updateDraftTiming(
    key: keyof FieldUpdateWorkflowTimestamps,
    value = new Date().toISOString(),
  ) {
    setDraft(prev => ({
      ...prev,
      workflowTimestamps: {
        ...(prev.workflowTimestamps || {}),
        [key]: value,
      },
    }));
  }

  function applyAreaAndLocationToDraft(
    area: ProjectArea | null,
    snapshot?: LocationSnapshot | null,
  ) {
    let nextDraftAfterAreaChange: ProjectUpdate | null = null;

    setDraft(prev => {
      const locationFields = areaChangeLocationFields(prev, area, snapshot);

      const next = {
        ...prev,
        ...locationFields,
        areaStatus: area ? 'confirmed' as const : 'unknown' as const,
        photos: prev.photos.map(photo => withDraftLocation(photo, locationFields)),
      };

      nextDraftAfterAreaChange = next;
      return next;
    });

    if (area && nextDraftAfterAreaChange) {
      void recheckPhotosAfterAreaChange(nextDraftAfterAreaChange);
    }
  }

  async function recheckPhotosAfterAreaChange(updateSnapshot: ProjectUpdate) {
    const photosNeedingRecheck = updateSnapshot.photos.filter(photo =>
      photoNeedsPriorRecheckAfterAreaChange(updateSnapshot, photo));

    for (const photo of photosNeedingRecheck) {
      await analyzePhotoWithAuthHydrationRetry({
        update: updateSnapshot,
        photo,
        priorUpdates: savedUpdatesRef.current,
      });
    }
  }

  // Review pass 2, 29 Sep 2026: callers start a draft and capture in one
  // handler, before draftRef renders, so the target was the previous draft
  // and every fix was discarded. They now pass the draft they started.
  async function captureDraftLocation(targetDraft: ProjectUpdate = draftRef.current) {
    const generation = draftFixTracker.start(targetDraft.id);
    const target = createDraftLocationCaptureTarget(targetDraft, generation);
    // Pending until the fix is written into the draft, which React does at
    // its next render, not when the fix arrives (review pass 6).
    let handedToDraft = false;
    const settle = () => draftFixTracker.settle(generation);
    const targetAreas = projectAreasForProject({
      projectAreas,
      projectName: targetDraft.projectName,
      scheduleItems,
      updates: activeSavedUpdates,
    });
    const targetIsCurrent = () => isDraftLocationCaptureTargetCurrent(
      target,
      draftRef.current,
      draftFixTracker.generation(),
    );
    setDraftLocationNotice({ draftId: target.draftId, generation, kind: 'capturing' });

    try {
      const snapshot = await getCurrentLocationSnapshot();
      if (!targetIsCurrent()) return null;

      if (!snapshot) {
        setDraftAreaSuggestionEntry(null);
        setDraftLocationNotice({ draftId: target.draftId, generation, kind: 'denied' });
        return null;
      }

      if (snapshot.preciseLocationOff) {
        // An approximate fix (Precise Location off, ±1-3 km) is written
        // nowhere: not to an area point (Save GPS) and not to the draft or
        // its photos (review pass 25). The notice says why.
        setDraftAreaSuggestionEntry(null);
        setDraftLocationNotice({ draftId: target.draftId, generation, kind: 'precise-off' });
        return null;
      }

      // Every area with a saved point, nearest centre first: the suggestion
      // is the nearest one the fix is confidently inside, else the nearest;
      // the notice says what GPS can say about the rest (review pass 23).
      const candidates = findProjectAreaSuggestions(snapshot, targetAreas);
      const suggestion = candidates.find(item => item.withinRadius) ?? candidates[0] ?? null;

      const reliableSuggestion = suggestion?.withinRadius ? suggestion : null;
      setDraftAreaSuggestionEntry(
        reliableSuggestion ? { draftId: target.draftId, suggestion: reliableSuggestion } : null,
      );
      // Where the fix places you is derived at render from the draft's own
      // fix (review pass 24).
      setDraftLocationNotice(null);

      handedToDraft = true;
      setDraft(prev => {
        settle();
        if (!isDraftLocationCaptureTargetCurrent(
          target,
          prev,
          draftFixTracker.generation(),
        )) {
          return prev;
        }
        return applyFixToDraft({
          draft: prev,
          fix: snapshot,
          areas: targetAreas,
          reliableSuggestion,
          now: Date.now(),
        });
      });

      return {
        snapshot,
        suggestion,
      };
    } catch {
      if (!targetIsCurrent()) return null;
      setDraftAreaSuggestionEntry(null);
      setDraftLocationNotice({ draftId: target.draftId, generation, kind: 'failed' });
      return null;
    } finally {
      if (!handedToDraft) settle();
    }
  }

  // A save drops the draft's pending fix. Only that draft, still open and
  // still without GPS, takes a new one: re-fixing any GPS-less draft would
  // stamp today's location on an older update's photos (review pass 5).
  function recaptureDroppedDraftLocation(savedDraftId: string, droppedPendingFix: boolean) {
    const openDraft = draftRef.current;
    if (!droppedPendingFix || openDraft.id !== savedDraftId || typeof openDraft.gpsLatitude === 'number') return;
    draftLocationCaptureRef.current = captureDraftLocation(openDraft);
  }

  async function waitForDraftLocationCapture() {
    const pending = draftLocationCaptureRef.current;
    if (!pending) return;

    await Promise.race([
      pending.catch(() => undefined),
      delay(DRAFT_LOCATION_CAPTURE_WAIT_MS),
    ]);
  }


  function changeDraftArea(areaId: string) {
    const area =
      draftProjectAreas.find(item => item.id === areaId) || null;
    // An area removed since it was offered must not clear the draft's area.
    if (areaId && !area) return;

    applyAreaAndLocationToDraft(area);
  }

  function selectQuickContext(context: QuickContext) {
    setDraft(prev => ({
      ...prev,
      quickContext: prev.quickContext === context ? null : context,
      safetyFlag:
        context === 'Safety'
          ? prev.quickContext !== 'Safety'
          : prev.safetyFlag || false,
      blockerFlag:
        context === 'Blocker'
          ? prev.quickContext !== 'Blocker'
          : prev.blockerFlag || false,
    }));
  }

  function confirmPIEInterpretation(interpretation: string) {
    setDraft(prev => {
      const next = updateInterpretationState(prev, interpretation, 'confirm');
      return appendInterpretationDecisionLog(next, interpretation, 'confirmed');
    });
  }

  function dismissPIEInterpretation(interpretation: string) {
    setDraft(prev => {
      const next = updateInterpretationState(prev, interpretation, 'dismiss');
      return appendInterpretationDecisionLog(next, interpretation, 'dismissed');
    });
  }

  function continueWithoutPhotos() {
    setDraft(prev => ({
      ...prev,
      continueWithoutPhotosAcknowledged: true,
      pieStatus: 'no_visual_comparison',
      pieSummary: 'No visual comparison available',
      status: 'ready_to_send',
      workflowTimestamps: {
        ...(prev.workflowTimestamps || {}),
        reviewOpenedAt: new Date().toISOString(),
      },
    }));
    setScreen('BuildUpdate');
  }

  function continueToReview() {
    const summary = summarizePIEStatusForUpdate(draft);

    setDraft(prev => ({
      ...prev,
      status: 'ready_to_send',
      pieStartedAt:
        prev.photos.length > 0
          ? prev.pieStartedAt || new Date().toISOString()
          : prev.pieStartedAt || null,
      pieStatus: summary.status,
      pieSummary: summary.summary,
      workflowTimestamps: {
        ...(prev.workflowTimestamps || {}),
        reviewOpenedAt: new Date().toISOString(),
      },
    }));
    setScreen('BuildUpdate');
  }

  /**
   * Changes one document wherever it is listed, and only while it is still
   * listed. The whole list was set from a snapshot, so an upload's progress
   * landing between a delete or archive and the next render put the
   * document back (whole-app audit A8 pass 3 L3).
   */
  function updateDocumentEverywhere(
    documentId: string,
    updater: (document: ProjectDocument) => ProjectDocument,
  ) {
    const update = (documents: ProjectDocument[]) => documents.map(document =>
      document.id === documentId ? updater(document) : document);
    projectDocumentsCurrentRef.current = update(projectDocumentsCurrentRef.current);
    setProjectDocuments(update);
    setDraft(prev => ({ ...prev, documents: update(prev.documents || []) }));
    setSavedUpdates(prev => prev.map(saved => ({ ...saved, documents: update(saved.documents || []) })));
    return projectDocumentsCurrentRef.current.find(document => document.id === documentId) || null;
  }

  /** A document change the other devices must see goes up again with each sent update listing it (whole-app audit A7 pass 5 M1). */
  function resendUpdatesListingDocument(documentId: string, change: (update: ProjectUpdate) => ProjectUpdate) {
    const resent = new Map(fieldUpdatesToResendForDocument(savedUpdatesRef.current, documentId, change).map(update => [update.id, update]));
    savedUpdatesRef.current = savedUpdatesRef.current.map(update => resent.get(update.id) || change(update));
    setSavedUpdates(prev => prev.map(update => resent.get(update.id) || change(update)));
    resent.forEach(update => void queueProjectUpdateRecord(update, false).catch(() => undefined).finally(requestQueuedUpdateSync));
  }

  async function persistProjectDocumentsImmediately(
    documents: readonly ProjectDocument[],
  ) {
    await persistStorageItem(
      PROJECT_DOCUMENTS_STORAGE_KEY,
      JSON.stringify(documents),
    );
  }

  async function addProjectDocumentDurably(document: ProjectDocument) {
    const nextDocuments = [
      document,
      ...projectDocumentsCurrentRef.current.filter(item => item.id !== document.id),
    ];

    try {
      await persistProjectDocumentsImmediately(nextDocuments);
    } catch (error) {
      await deleteOwnedProjectDocument(document).catch(() => undefined);
      reportStoragePersistenceFailure({
        storageKey: PROJECT_DOCUMENTS_STORAGE_KEY,
        label: 'project document',
        error,
      });
      throw new Error(
        'Vitruvius could not save this document record. The selected file was not uploaded.',
      );
    }

    projectDocumentsCurrentRef.current = nextDocuments;
    setProjectDocuments(nextDocuments);
  }

  async function publishUploadedProjectDocument(
    document: ProjectDocument,
  ) {
    const ownedRecord = document.ownedFileId
      ? parseOwnedLocalFileManifest(document.ownedFileManifest)
          .files[document.ownedFileId]
      : null;
    const projectName =
      projectsCurrentRef.current.find(
        name => authorityProjectId(name) === document.projectId,
      ) || null;
    const sharedDocument = normalizeReferenceDocument(
      buildSharedReferenceDocument({
        document,
        projectName,
        contentSha256: ownedRecord?.sha256 || null,
        updatedAt: document.updatedAt,
      }),
    );
    const nextReferenceDocuments = [
      sharedDocument,
      ...referenceDocumentsCurrentRef.current.filter(
        item => item.id !== sharedDocument.id,
      ),
    ];

    markReferenceDocumentsAuthorityReady(true);
    referenceDocumentsCurrentRef.current = nextReferenceDocuments;
    setReferenceDocuments(nextReferenceDocuments);

    const linkedDocument = updateDocumentEverywhere(document.id, current => ({
      ...current,
      referenceDocumentId: sharedDocument.id,
    }));
    if (linkedDocument) {
      await persistProjectDocumentsImmediately(
        projectDocumentsCurrentRef.current,
      );
    }
    await queueReferenceDocumentRecord(sharedDocument);
  }

  /** The owner's Retry: passed the document, so a failure is said (whole-app audit A8 pass 3). */
  const retryProjectDocumentUploadAsked = (documentId: string) => void retryProjectDocumentUpload(documentId,
    projectDocumentsCurrentRef.current.find(item => item.id === documentId) || draft.documents?.find(item => item.id === documentId));

  async function retryProjectDocumentUpload(
    documentId: string,
    providedDocument?: ProjectDocument,
  ) {
    const sameAccount = bindProjectDocumentUploadToAccount(); // nothing written or shared once another account signs in (whole-app audit A8 pass 3 M3)
    const target =
      providedDocument ||
      projectDocumentsCurrentRef.current.find(
        document => document.id === documentId,
      ) ||
      draft.documents?.find(document => document.id === documentId);

    if (!target?.localUri) {
      updateDocumentEverywhere(documentId, document => ({
        ...document,
        status: 'failed',
        updatedAt: new Date().toISOString(),
        lastUploadAttemptAt: new Date().toISOString(),
        uploadAttemptCount: (document.uploadAttemptCount || 0) + 1,
      }));
      return;
    }

    const startedAt = new Date().toISOString();
    const storagePath =
      target.storagePath ||
      buildProjectDocumentStoragePath(
        target.id,
        target.projectId,
        target.name,
      );

    updateDocumentEverywhere(documentId, document => ({
      ...document,
      status: 'uploading',
      storagePath,
      updatedAt: startedAt,
      lastUploadAttemptAt: startedAt,
      uploadAttemptCount: (document.uploadAttemptCount || 0) + 1,
      uploadProgress: 0,
    }));

    try {
      await verifyOwnedProjectDocument(target);
      if (!sameAccount()) return false;
      let lastReportedPercent = -1;
      const result = await uploadPhoto({
        bucket: PROJECT_DOCUMENT_UPLOAD_FOLDER,
        path: storagePath,
        uri: target.localUri,
        contentType: target.mimeType || 'application/octet-stream',
        upsert: true,
        reportedSizeBytes: target.sizeBytes,
        maxBytes: MAX_PROJECT_DOCUMENT_FILE_BYTES,
        onProgress: progress => {
          const percent = Math.round(progress * 100);
          if (percent === lastReportedPercent) return;
          lastReportedPercent = percent;
          updateDocumentEverywhere(documentId, document => ({
            ...document,
            uploadProgress: progress,
          }));
        },
      });
      if (!sameAccount()) return false;
      const completedAt = new Date().toISOString();
      const uploaded = result.ok && !result.stubbed;
      const completedDocument = updateDocumentEverywhere(documentId, document => ({
        ...document,
        status: uploaded ? 'uploaded' : 'failed',
        storagePath,
        uploadedAt: uploaded ? completedAt : document.uploadedAt,
        updatedAt: completedAt,
        uploadProgress: uploaded ? 1 : document.uploadProgress,
        // A failure for want of signal is not counted toward the backoff (whole-app audit A8 pass 2 #5).
        uploadAttemptCount: uploaded ? document.uploadAttemptCount : projectDocumentUploadAttemptsAfterFailure(document.uploadAttemptCount, result.error),
      }));
      await persistProjectDocumentsImmediately(
        projectDocumentsCurrentRef.current,
      );

      if (!uploaded) {
        if (providedDocument) {
          Alert.alert(
            target.category === 'Drawing'
              ? 'Drawing upload not completed'
              : 'Document upload not completed',
            result.error ||
              'The file remains saved on this device. Check the connection and retry the upload.',
          );
        }
        return false;
      }

      if (completedDocument && !completedDocument.isArchived && sameAccount()) { // archived while it uploaded: not shared (whole-app audit A8 pass 2 #4)
        try {
          await publishUploadedProjectDocument(completedDocument);
        } catch {
          if (providedDocument) {
            Alert.alert(
              'Document saved; cloud record pending',
              'The file uploaded, but its shared document record is still waiting to sync. Keep Vitruvius open and use Sync Now.',
            );
          }
        }
      }
      if (completedDocument && sameAccount()) resendUpdatesListingDocument(documentId, update => withDeviceDocumentUploadState(update, projectDocumentsCurrentRef.current)); // the iPad sees it uploaded (A7 pass 5 M1)
      return true;
    } catch (error) {
      if (!sameAccount()) return false;
      if (error instanceof Error &&
          error.message === PROJECT_DOCUMENT_REIMPORT_REQUIRED_MESSAGE) {
        Alert.alert(
          'Add document again',
          'Delete this attachment record, then add the original file again before uploading it.',
        );
      } else if (providedDocument) {
        Alert.alert(
          target.category === 'Drawing'
            ? 'Drawing upload not completed'
            : 'Document upload not completed',
          error instanceof Error
            ? error.message
            : 'The file remains saved on this device. Check the connection and retry the upload.',
        );
      }
      updateDocumentEverywhere(documentId, document => ({
        ...document,
        status: 'failed',
        updatedAt: new Date().toISOString(),
        uploadProgress: null,
        uploadAttemptCount: projectDocumentUploadAttemptsAfterFailure(document.uploadAttemptCount, error),
      }));
      await persistProjectDocumentsImmediately(
        projectDocumentsCurrentRef.current,
      ).catch(persistenceError => reportStoragePersistenceFailure({
        storageKey: PROJECT_DOCUMENTS_STORAGE_KEY,
        label: 'project document upload status',
        error: persistenceError,
      }));
      return false;
    }
  }

  async function replaceProjectDocumentFile(documentId: string) {
    const target =
      projectDocuments.find(document => document.id === documentId) ||
      draft.documents?.find(document => document.id === documentId);
    if (!target || !OWNED_PROJECT_DOCUMENTS_DIR) return;

    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: [
          'application/pdf',
          'image/*',
          'application/msword',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'application/vnd.ms-excel',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'text/csv',
          'text/plain',
        ],
        copyToCacheDirectory: true,
      });
      if (result.canceled) return;

      const asset = result.assets[0];
      if (!asset) return;
      await preflightExpoFileRead({
        uri: asset.uri,
        reportedSizeBytes: asset.size,
        maxBytes: MAX_PROJECT_DOCUMENT_FILE_BYTES,
      });

      const replacementName = asset.name || target.name;
      const replacementMimeType =
        asset.mimeType || target.mimeType || 'application/octet-stream';
      const owned = await importProjectDocumentIntoOwnedStorage({
        sourceUri: asset.uri,
        ownedRoot: OWNED_PROJECT_DOCUMENTS_DIR,
        fileName: replacementName,
        mimeType: replacementMimeType,
        reportedSizeBytes: asset.size,
      });
      const replacement: ProjectDocument = {
        ...target,
        name: replacementName,
        mimeType: replacementMimeType,
        sizeBytes: owned.record.sizeBytes,
        localUri: owned.localUri,
        ownedFileId: owned.fileId,
        ownedFileManifest: owned.manifest,
        storagePath: buildProjectDocumentStoragePath(
          target.id,
          target.projectId,
          replacementName,
        ),
        status: 'local',
        updatedAt: new Date().toISOString(),
      };

      updateDocumentEverywhere(documentId, () => replacement);
      try {
        await persistProjectDocumentsImmediately(
          projectDocumentsCurrentRef.current,
        );
      } catch (error) {
        updateDocumentEverywhere(documentId, () => target);
        await deleteOwnedProjectDocument(replacement).catch(() => undefined);
        throw error;
      }
      void deleteOwnedProjectDocument(target).catch(() => undefined);
      await retryProjectDocumentUpload(documentId, replacement);
    } catch (error) {
      Alert.alert(
        'Document unavailable',
        error instanceof FileSizePreflightError
          ? error.message
          : 'The selected file could not replace this document. Choose the original PDF, image, or drawing and try again.',
      );
    }
  }

  async function attachProjectDocumentToDraft(document: ProjectDocument) {
    await addProjectDocumentDurably(document);
    setDraft(prev => ({
      ...prev,
      documents: [document, ...(prev.documents || [])],
    }));

    await retryProjectDocumentUpload(document.id, document);
  }

  async function createProjectDocumentFromAsset(asset: {
    uri: string;
    name?: string | null;
    mimeType?: string | null;
    size?: number | null;
  }, context?: {
    projectName?: string;
    areaId?: string | null;
    updateId?: string | null;
    category?: ProjectDocumentCategory;
    drawingMetadata?: ReturnType<typeof mobileDrawingMetadataForUpload>;
  }) {
    const now = new Date().toISOString();
    const id = uid();
    const name =
      asset.name ||
      filenameFromUri(
        asset.uri,
        0,
        asset.mimeType || 'application/octet-stream',
      );
    const projectName = context?.projectName || draft.projectName;
    const projectId = authorityProjectId(projectName);
    if (!OWNED_PROJECT_DOCUMENTS_DIR) {
      throw new Error('Project document storage is unavailable.');
    }
    const owned = await importProjectDocumentIntoOwnedStorage({
      sourceUri: asset.uri,
      ownedRoot: OWNED_PROJECT_DOCUMENTS_DIR,
      fileName: name,
      mimeType: asset.mimeType || 'application/octet-stream',
      reportedSizeBytes: asset.size,
    });

    return normalizeProjectDocument({
      id,
      projectId,
      areaId:
        typeof context?.areaId !== 'undefined'
          ? context.areaId
          : draft.selectedAreaId || null,
      updateId:
        typeof context?.updateId !== 'undefined'
          ? context.updateId
          : draft.id,
      name,
      category: context?.category || 'Other',
      mimeType: asset.mimeType || null,
      sizeBytes: owned.record.sizeBytes,
      localUri: owned.localUri,
      ownedFileId: owned.fileId,
      ownedFileManifest: owned.manifest,
      storagePath: buildProjectDocumentStoragePath(id, projectId, name),
      createdAt: now,
      updatedAt: now,
      importedAt: now,
      status: 'local',
      uploadAttemptCount: 0,
      ...(context?.category === 'Drawing' ? context.drawingMetadata : null),
    }) as ProjectDocument;
  }

  async function confirmAndAttachProjectDocument(
    document: ProjectDocument,
    duplicate: ProjectDocument | null,
    attachToDraft = true,
  ) {
    if (duplicate) {
      Alert.alert(
        'Possible duplicate document',
        `${document.name} looks like it already exists for this project.`,
        [
          { text: 'Cancel', style: 'cancel', onPress: () => {
            void deleteOwnedProjectDocument(document).catch(() => undefined);
          } },
          {
            text: 'Upload Anyway',
            onPress: () => {
              const duplicateDocument = {
                ...document,
                duplicateOf: duplicate.id,
              };
              void (attachToDraft
                ? attachProjectDocumentToDraft(duplicateDocument)
                : saveProjectDocument(duplicateDocument)
              ).catch(error => {
                Alert.alert(
                  'Document unavailable',
                  error instanceof Error
                    ? error.message
                    : 'The selected document could not be saved.',
                );
              });
            },
          },
        ],
        { cancelable: false },
      );
      return;
    }

    if (attachToDraft) {
      await attachProjectDocumentToDraft(document);
      return;
    }

    await saveProjectDocument(document);
  }

  async function saveProjectDocument(document: ProjectDocument) {
    await addProjectDocumentDurably(document);
    await retryProjectDocumentUpload(document.id, document);
  }

  function promptDocumentProjectSelection(
    asset: {
      uri: string;
      name?: string | null;
      mimeType?: string | null;
      size?: number | null;
    },
    defaultProjectName: string,
    options?: {
      attachToDraft?: boolean;
      areaId?: string | null;
      updateId?: string | null;
    },
  ) {
    setDocumentUploadRequest({
      asset,
      selected: new Set([defaultProjectName]),
      category: suggestProjectDocumentCategory(asset),
      attachToDraft: Boolean(options?.attachToDraft),
      areaId: options?.areaId || null,
      updateId: options?.updateId || null,
      drawingControls: createECOSMobileDrawingControls(asset.name || ''),
    });
  }

  function setDocumentUploadCategory(category: ProjectDocumentCategory) {
    setDocumentUploadRequest(current => current ? {
      ...current,
      category,
      drawingControls: {
        ...current.drawingControls,
        replacementDocumentId: null,
      },
    } : current);
  }

  function setDocumentUploadDrawingControls(drawingControls: ECOSMobileDrawingControls) {
    setDocumentUploadRequest(current => current ? { ...current, drawingControls } : current);
  }

  function toggleDocumentUploadProject(projectName: string) {
    setDocumentUploadRequest(prev => {
      if (!prev) return prev;

      const nextSelected = new Set(prev.selected);

      if (nextSelected.has(projectName)) {
        nextSelected.delete(projectName);
      } else {
        nextSelected.add(projectName);
      }

      return {
        ...prev,
        selected: nextSelected,
        drawingControls: {
          ...prev.drawingControls,
          // A replacement family is project-specific. Any scope change must
          // require an explicit fresh choice rather than carrying stale intent.
          replacementDocumentId: null,
        },
      };
    });
  }

  function cancelDocumentProjectSelection() {
    setDocumentUploadRequest(null);
  }

  async function confirmDocumentProjectSelection() {
    if (!documentUploadRequest) return;

    const {
      asset,
      selected,
      category,
      attachToDraft,
      areaId,
      updateId,
      drawingControls,
    } = documentUploadRequest;

    const drawingValidation = category === 'Drawing'
      ? validateECOSMobileDrawingControls(drawingControls)
      : null;
    if (drawingValidation && !drawingValidation.valid) {
      Alert.alert('Complete drawing details', drawingValidation.message || 'Add the required drawing details.');
      return;
    }

    // Same picked file, one ProjectDocument record per selected project -
    // each project keeps its own independent upload/retry/status lifecycle,
    // matching how documents already work everywhere else in this screen.
    try {
      const selectedProjectNames = Array.from(selected);
      const replacementDocument = category === 'Drawing' &&
        selectedProjectNames.length === 1 &&
        drawingControls.replacementDocumentId
        ? referenceDocumentsCurrentRef.current.find(document =>
            document.id === drawingControls.replacementDocumentId &&
            canonicalReferenceCategory(document) === 'drawing' &&
            (referenceDocumentAppliesToProject(document, selectedProjectNames[0]) ||
              document.projectId === authorityProjectId(selectedProjectNames[0])),
          ) || null
        : null;
      const drawingMetadata = category === 'Drawing'
        ? mobileDrawingMetadataForUpload(drawingControls, replacementDocument)
        : undefined;
      if (category === 'Schedule' && !attachToDraft) {
        const batch = await prepareScheduleImportFromAsset(asset, selectedProjectNames);
        if (batch) {
          setIncomingScheduleImportBatch(batch);
          setScheduleProjectFilter(null);
          setScreen('Schedule');
        }
        return;
      }

      for (const projectName of selected) {
        const document = await createProjectDocumentFromAsset(asset, {
          projectName,
          areaId: attachToDraft ? areaId : null,
          updateId: attachToDraft ? updateId : null,
          category,
          drawingMetadata,
        });
        const duplicate = duplicateProjectDocumentForAsset(
          projectDocuments, document.projectId, {
            name: document.name, mimeType: document.mimeType, size: document.sizeBytes,
          },
        );
        await confirmAndAttachProjectDocument(document, duplicate, attachToDraft);
      }
    } catch (error) {
      Alert.alert(
        category === 'Schedule' ? 'Schedule review unavailable' : 'Document unavailable',
        error instanceof Error
          ? error.message
          : 'The selected document could not be copied into secure app storage.',
      );
    } finally {
      setDocumentUploadRequest(null);
    }
  }

  async function importFieldUpdateDocument() {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: [
          'application/pdf',
          'image/*',
          'application/msword',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'application/vnd.ms-excel',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'text/csv',
          'text/plain',
        ],
        copyToCacheDirectory: true,
      });

      if (result.canceled) return;

      const asset = result.assets[0];

      if (!asset) return;

      await preflightExpoFileRead({
        uri: asset.uri,
        reportedSizeBytes: asset.size,
        maxBytes: MAX_PROJECT_DOCUMENT_FILE_BYTES,
      });
      promptDocumentProjectSelection(
        {
          uri: asset.uri,
          name: asset.name,
          mimeType: asset.mimeType,
          size: asset.size,
        },
        draft.projectName,
        {
          attachToDraft: true,
          areaId: draft.selectedAreaId || null,
          updateId: draft.id,
        },
      );
    } catch (error) {
      Alert.alert(
        'Document unavailable',
        error instanceof FileSizePreflightError
          ? error.message
          : 'The selected document could not be attached to this update.',
      );
    }
  }

  async function importProjectDocumentForProject(projectName: string) {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: [
          'application/pdf',
          'image/*',
          'application/msword',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'application/vnd.ms-excel',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'text/csv',
          'text/plain',
        ],
        copyToCacheDirectory: true,
      });

      if (result.canceled) return;

      const asset = result.assets[0];

      if (!asset) return;

      await preflightExpoFileRead({
        uri: asset.uri,
        reportedSizeBytes: asset.size,
        maxBytes: MAX_PROJECT_DOCUMENT_FILE_BYTES,
      });

      promptDocumentProjectSelection(
        {
          uri: asset.uri,
          name: asset.name,
          mimeType: asset.mimeType,
          size: asset.size,
        },
        projectName,
      );
    } catch (error) {
      Alert.alert(
        'Document unavailable',
        error instanceof FileSizePreflightError
          ? error.message
          : 'The selected document could not be added to this project.',
      );
    }
  }

  async function takeProjectDocumentPhoto(
    projectName = draft.projectName,
    attachToDraft = true,
  ) {
    try {
      const permission = await ImagePicker.requestCameraPermissionsAsync();

      if (!permission.granted) {
        Alert.alert(
          'Camera permission needed',
          'Allow camera access to take a photo of a document.',
        );
        return;
      }

      const result = await ImagePicker.launchCameraAsync({
        allowsEditing: false,
        quality: 0.85,
      });

      if (result.canceled) return;

      const asset = result.assets[0];

      if (!asset) return;

      const photoAsset = {
        uri: asset.uri,
        name: asset.fileName || `document-photo-${Date.now()}.jpg`,
        mimeType: asset.mimeType || 'image/jpeg',
        size: asset.fileSize || null,
      };

      promptDocumentProjectSelection(
        photoAsset,
        projectName,
        attachToDraft
          ? {
              attachToDraft: true,
              areaId: draft.selectedAreaId || null,
              updateId: draft.id,
            }
          : undefined,
      );
    } catch {
      Alert.alert(
        'Document photo unavailable',
        'The document photo could not be saved right now.',
      );
    }
  }

  function minimumSendDataIssue(update: ProjectUpdate) {
    if (!update.projectName.trim()) return 'Project is required.';

    if (!update.selectedAreaId && update.areaStatus !== 'unknown') {
      return 'Choose an area or keep Unassigned / Unknown Area.';
    }

    if (update.recipients.contactIds.length === 0) {
      return 'Recipients are required before sending.';
    }

    if (
      update.photos.length === 0 &&
      (update.documents?.length || 0) === 0 &&
      !update.notes.trim() &&
      !update.continueWithoutPhotosAcknowledged
    ) {
      return 'Add a photo, note, document, or use Continue Without Photos.';
    }

    return null;
  }

  function upsertSavedUpdateUnlessDeleted(update: ProjectUpdate) {
    const nextUpdates = mergeSavedUpdatesWithTombstones({
      localUpdates: [
        update,
        ...savedUpdatesRef.current.filter(item => item.id !== update.id),
      ],
      cloudUpdates: [],
      tombstones: deletedUpdateTombstonesRef.current,
    });
    savedUpdatesRef.current = nextUpdates;
    setSavedUpdates(nextUpdates);
  }

  function applyFieldUpdateSyncResultIfCurrent(
    attemptedUpdate: ProjectUpdate,
    syncResult: ProjectUpdate,
  ) {
    const reconciliation = reconcileFieldUpdateSyncResult(
      savedUpdatesRef.current,
      attemptedUpdate,
      syncResult,
    );
    if (!reconciliation.applied) return reconciliation;

    const nextUpdates = mergeSavedUpdatesWithTombstones({
      localUpdates: reconciliation.updates,
      cloudUpdates: [],
      tombstones: deletedUpdateTombstonesRef.current,
    });
    const applied = nextUpdates.some(item => item.id === syncResult.id);
    savedUpdatesRef.current = nextUpdates;
    setSavedUpdates(nextUpdates);
    return {
      updates: nextUpdates,
      applied,
      current: applied ? syncResult : null,
    };
  }

  async function saveFieldUpdateFromReview() {
    if (fieldUpdateSaveInFlightRef.current) {
      Alert.alert('Save in progress', 'Wait for the current field update to finish saving.');
      return;
    }

    const draftSnapshot = draftRef.current;
    if (!hasSavableUpdate(draftSnapshot)) {
      Alert.alert(
        'Update is blank',
        'Add a photo, update notes, field note, or action information before saving.',
      );
      return;
    }

    const invalidDueDateIndex = findInvalidDueDatePhoto(draftSnapshot);
    if (invalidDueDateIndex >= 0) {
      Alert.alert(
        'Invalid due date',
        `Photo ${invalidDueDateIndex + 1} has a due date that is not in YYYY-MM-DD format.`,
      );
      return;
    }

    fieldUpdateSaveInFlightRef.current = true;
    setFieldUpdateSaving(true);
    // A fix landing during the write would make the saved draft look edited
    // and keep it open (review pass 3); this draft's pending fix is dropped.
    const droppedPendingFix = draftFixTracker.beginSave(draftSnapshot.id);
    const now = new Date().toISOString();
    const pieSummary = summarizePIEStatusForUpdate(draftSnapshot);
    const idempotencyKey = draftSnapshot.idempotencyKey ||
      draftSnapshot.stableSendId || `send-${draftSnapshot.id}`;
    const sendAttempts = (draftSnapshot.sendAttempts || 0) + 1;
    const baseUpdate: ProjectUpdate = {
      ...draftSnapshot,
      status: 'ready_to_send',
      stableSendId: idempotencyKey,
      idempotencyKey,
      sendAttempts,
      lastSendAttemptAt: now,
      pieStatus: pieSummary.status,
      pieSummary: pieSummary.summary,
      generatedMessage: buildGeneratedUpdateMessage(draftSnapshot, pieSummary),
      workflowTimestamps: {
        ...(draftSnapshot.workflowTimestamps || {}),
        sendTappedAt: now,
      },
    };

    const queuedUpdate: ProjectUpdate = {
      ...baseUpdate,
      status: 'queued',
    };

    try {
      if (savedUpdatesSaveTimer.current) {
        clearTimeout(savedUpdatesSaveTimer.current);
        savedUpdatesSaveTimer.current = null;
      }
      if (draftSaveTimer.current) {
        clearTimeout(draftSaveTimer.current);
        draftSaveTimer.current = null;
      }
      const persisted = await fieldUpdateLocalPersistence.commit(snapshot =>
        prepareQueuedFieldUpdateSave({ snapshot, queuedUpdate,
          currentUpdates: savedUpdatesRef.current, currentTombstones: deletedUpdateTombstonesRef.current,
          keys: FIELD_UPDATE_PERSISTENCE_KEYS, mergeVisibleUpdates: mergeSavedUpdatesWithTombstones }),
      );
      if (!persisted.applied) {
        // A deletion barrier for this id dropped the save: the update was
        // deleted while it was open as the draft, on this phone or another
        // device. Nothing was written; the draft is kept and can be saved as
        // a new update (whole-app audit A4, 29 Sep 2026).
        fieldUpdateSaveInFlightRef.current = false;
        setFieldUpdateSaving(false);
        // The save cancelled the pending draft and saved-updates writes; put both back.
        void persistDraftNow(draftRef.current);
        persistStorageItem(UPDATES_STORAGE_KEY, JSON.stringify(savedUpdatesRef.current)).catch(error =>
          reportStoragePersistenceFailure({ storageKey: UPDATES_STORAGE_KEY, label: 'saved updates', error }),
        );
        recaptureDroppedDraftLocation(draftSnapshot.id, droppedPendingFix);
        offerToSaveDeletedDraftAsNewUpdate(draftSnapshot.projectName, persisted.barrierAction);
        return;
      }
      savedUpdatesRef.current = persisted.nextUpdates;
      deletedUpdateTombstonesRef.current = persisted.nextTombstones;
      setSavedUpdates(persisted.nextUpdates);
      setDeletedUpdateTombstones(persisted.nextTombstones);
      setSelectedWorkspaceProject(queuedUpdate.projectName);
    } catch (error) {
      if (error instanceof FieldUpdatePersistenceBlockedError) blockFieldUpdateStores(error);
      Alert.alert(
        'Update not saved',
        'The device could not verify the saved update. Your draft is still here; try again.',
      );
      fieldUpdateSaveInFlightRef.current = false;
      setFieldUpdateSaving(false);
      // A store the save found unreadable stays as it is for recovery; only
      // a plain commit failure re-arms the cancelled write (audit A4 pass 4)
      // and rewrites the draft: after a blocked save its rewrite broke the
      // recovery's check for good (A7 pass 3).
      if (!(error instanceof FieldUpdatePersistenceBlockedError)) {
        void persistDraftNow(draftRef.current);
        persistStorageItem(UPDATES_STORAGE_KEY, JSON.stringify(savedUpdatesRef.current)).catch(persistError =>
          reportStoragePersistenceFailure({ storageKey: UPDATES_STORAGE_KEY, label: 'saved updates', error: persistError }),
        );
      }
      recaptureDroppedDraftLocation(draftSnapshot.id, droppedPendingFix);
      return;
    }

    const draftUnchanged = draftRef.current === draftSnapshot;
    if (draftUnchanged) {
      setDraft(createDraft(queuedUpdate.projectName));
      setDraftSavedAt(null);
      setScreen('ProjectWorkspace');
    } else {
      recaptureDroppedDraftLocation(draftSnapshot.id, droppedPendingFix);
    }

    try {
      await queueProjectUpdateRecord(queuedUpdate, false);
    } catch {
      // The verified saved-update record remains durable and startup recovery
      // will stage it again if the dedicated sync queue write was interrupted.
    }
    fieldUpdateSaveInFlightRef.current = false;
    setFieldUpdateSaving(false);
    Alert.alert(
      'Field update saved',
      draftUnchanged
        ? 'The update is saved on this device. Cloud sync will continue in the background.'
        : 'The saved version is safe, and your newer draft changes were kept.',
    );
    void syncQueuedFieldUpdateInBackground(queuedUpdate);
  }

  /**
   * The open draft is replaced by a blank one for the project, on disk
   * first; the discarded draft's own photo files go afterwards when it is
   * passed (audit A4, 30 Sep 2026: they were left as orphans, or deleted
   * before the blank draft was on disk).
   */
  function clearOpenDraft(projectName: string, discardedDraft?: ProjectUpdate) {
    const blank = createDraft(projectName);
    draftRef.current = blank;
    setDraft(blank);
    if (discardedDraft) {
      void discardDraftAfterReplacement(discardedDraft);
    } else {
      void persistDraftNow(blank);
    }
  }

  function offerToSaveDeletedDraftAsNewUpdate(
    projectName: string,
    barrierAction: string | null | undefined,
  ) {
    const archived = barrierAction === 'hide_cloud_update' || barrierAction === 'archive_sent_update';
    Alert.alert(
      archived ? 'Update was archived' : 'Update was deleted',
      archived
        ? 'This update was archived in the cloud while it was open, so it cannot be saved under its old record. Save it as a new update?'
        : 'This update was deleted while it was open, on this phone or another device, so it cannot be saved under its old record. Save it as a new update?',
      [
        { text: 'Discard draft', style: 'destructive', onPress: () => clearOpenDraft(projectName, draftRef.current) },
        {
          text: 'Save as new update',
          onPress: () => {
            const reissued = reissueDraftAsNewUpdate(draftRef.current, uid());
            draftRef.current = reissued;
            setDraft(reissued);
            void saveFieldUpdateFromReview();
          },
        },
      ],
    );
  }

  async function syncQueuedFieldUpdateInBackground(queuedUpdate: ProjectUpdate) {
    let finalUpdate: ProjectUpdate;
    const attemptedAt = queuedUpdate.lastSendAttemptAt || new Date().toISOString();
    try {
      const tokenResult = await getCurrentSessionAccessToken();
      const tokenLookup = tokenResult.data;
      const sessionTokenPresent = tokenLookup?.status === 'token_present';
      if (!sessionTokenPresent) {
        const syncDiagnostics = buildSkippedSyncDiagnostics(
          await fieldUpdateSyncCategoryWithoutSession(tokenLookup, signInPendingRef.current),
          attemptedAt,
          1,
          false,
        );
        finalUpdate = {
          ...queuedUpdate,
          status: statusForSyncDiagnostics(syncDiagnostics),
          syncDiagnostics,
          workflowTimestamps: {
            ...(queuedUpdate.workflowTimestamps || {}),
            sendResolvedAt: new Date().toISOString(),
          },
        };
      } else {
        const { syncResult, workAttempt } = await runFieldUpdateCloudSync(queuedUpdate);
        const syncDiagnostics = buildSyncDiagnosticsFromUpload(
          syncResult,
          attemptedAt,
          true,
          workAttempt,
          queuedUpdate.sendAttempts || 1,
        );
        finalUpdate = {
          ...queuedUpdate,
          status: statusForSyncDiagnostics(syncDiagnostics),
          syncDiagnostics,
          workflowTimestamps: {
            ...(queuedUpdate.workflowTimestamps || {}),
            sendResolvedAt: new Date().toISOString(),
          },
        };
      }
    } catch (error) {
      const syncDiagnostics = buildSkippedSyncDiagnostics(
        classifySyncFailureCategory([
          error instanceof Error ? error.message : 'unknown sync error',
        ]),
        attemptedAt,
        1,
        null,
      );
      finalUpdate = {
        ...queuedUpdate,
        status: statusForSyncDiagnostics(syncDiagnostics),
        syncDiagnostics,
        workflowTimestamps: {
          ...(queuedUpdate.workflowTimestamps || {}),
          sendResolvedAt: new Date().toISOString(),
        },
      };
    }

    try {
      await persistSavedUpdateImmediately(finalUpdate, queuedUpdate);
    } catch {
      // The verified queued update remains durable and will be retried on startup.
    }
  }

  async function persistSavedUpdateImmediately(
    update: ProjectUpdate,
    expectedUpdate: ProjectUpdate = update,
  ) {
    try {
      const persisted = await fieldUpdateLocalPersistence.commit(snapshot =>
        prepareFieldUpdateStatusSave({ snapshot, update, expectedUpdate,
          currentUpdates: savedUpdatesRef.current, currentTombstones: deletedUpdateTombstonesRef.current,
          keys: FIELD_UPDATE_PERSISTENCE_KEYS, mergeVisibleUpdates: mergeSavedUpdatesWithTombstones,
          reconcile: reconcileFieldUpdateSyncResult }),
      );
      savedUpdatesRef.current = persisted.nextUpdates;
      deletedUpdateTombstonesRef.current = persisted.nextTombstones;
      setSavedUpdates(persisted.nextUpdates);
      setDeletedUpdateTombstones(persisted.nextTombstones);
      return persisted.applied;
    } catch (error) {
      if (error instanceof FieldUpdatePersistenceBlockedError) blockFieldUpdateStores(error);
      throw error;
    }
  }

  /** A save found the field-update stores blocked: recovery owns them, so no pending write may land (audit A4 pass 5). */
  function blockFieldUpdateStores(error: FieldUpdatePersistenceBlockedError) {
    startupHydration.fail(UPDATES_STORAGE_KEY, 'field update save recovery', error);
    cancelPendingStoragePersistence(DELETED_UPDATES_STORAGE_KEY);
  }

  async function syncFieldUpdateWithMissingPhotoRepair(
    update: ProjectUpdate,
    onRepair?: (repairedUpdate: ProjectUpdate) => void,
  ) {
    const firstAttempt = await runFieldUpdateCloudSync(update);
    if (firstAttempt.missingPhotos.length === 0) {
      return { ...firstAttempt, update };
    }

    const repairedUpdate = markMissingPhotosUnavailable(
      update,
      firstAttempt.missingPhotos,
    );
    await removeMissingPhotosFromSyncQueue(firstAttempt.missingPhotos);
    const repairPersisted = await persistSavedUpdateImmediately(repairedUpdate, update);
    if (!repairPersisted) return { ...firstAttempt, update };
    onRepair?.(repairedUpdate);
    const repairedAttempt = await runFieldUpdateCloudSync(repairedUpdate);
    return { ...repairedAttempt, update: repairedUpdate };
  }

  async function retryQueuedUpdate(update: ProjectUpdate) {
    const now = new Date().toISOString();
    const retryUpdate: ProjectUpdate = {
      ...update,
      stableSendId: update.idempotencyKey || update.stableSendId || `send-${update.id}`,
      idempotencyKey: update.idempotencyKey || update.stableSendId || `send-${update.id}`,
      sendAttempts: (update.sendAttempts || 0) + 1,
      lastSendAttemptAt: now,
      status: 'queued',
    };
    let activeRetryUpdate = retryUpdate;

    upsertSavedUpdateUnlessDeleted(retryUpdate);

    try {
      const tokenResult = await getCurrentSessionAccessToken();
      const tokenLookup = tokenResult.data;
      const sessionTokenPresent = tokenLookup?.status === 'token_present';
      if (!sessionTokenPresent) {
        const syncDiagnostics = buildSkippedSyncDiagnostics(
          await fieldUpdateSyncCategoryWithoutSession(tokenLookup, signInPendingRef.current),
          now,
          1,
          false,
        );
        const finalUpdate: ProjectUpdate = {
          ...retryUpdate,
          status: statusForSyncDiagnostics(syncDiagnostics),
          syncDiagnostics,
          workflowTimestamps: {
            ...(retryUpdate.workflowTimestamps || {}),
            sendResolvedAt: new Date().toISOString(),
          },
        };
        const reconciliation = applyFieldUpdateSyncResultIfCurrent(
          retryUpdate,
          finalUpdate,
        );
        return reconciliation.current || finalUpdate;
      }

      const {
        syncResult,
        workAttempt,
        update: syncReadyUpdate,
      } = await syncFieldUpdateWithMissingPhotoRepair(
        retryUpdate,
        repairedUpdate => {
          activeRetryUpdate = repairedUpdate;
        },
      );
      activeRetryUpdate = syncReadyUpdate;
      const syncDiagnostics = buildSyncDiagnosticsFromUpload(
        syncResult,
        now,
        sessionTokenPresent,
        workAttempt,
        retryUpdate.sendAttempts || 1,
      );
      const finalUpdate: ProjectUpdate = {
        ...syncReadyUpdate,
        status: statusForSyncDiagnostics(syncDiagnostics),
        syncDiagnostics,
        workflowTimestamps: {
          ...(syncReadyUpdate.workflowTimestamps || {}),
          sendResolvedAt: new Date().toISOString(),
        },
      };

      const reconciliation = applyFieldUpdateSyncResultIfCurrent(
        syncReadyUpdate,
        finalUpdate,
      );
      return reconciliation.current || finalUpdate;
    } catch (error) {
      const syncDiagnostics = buildSkippedSyncDiagnostics(
        classifySyncFailureCategory([
          error instanceof Error ? error.message : 'unknown sync error',
        ]),
        now,
        1,
        null,
      );
      const failedOrQueuedUpdate: ProjectUpdate = {
        ...activeRetryUpdate,
        status: statusForSyncDiagnostics(syncDiagnostics),
        syncDiagnostics,
      };
      const reconciliation = applyFieldUpdateSyncResultIfCurrent(
        activeRetryUpdate,
        failedOrQueuedUpdate,
      );
      return reconciliation.current || failedOrQueuedUpdate;
    }
  }

  const queuedHydrationDeferredRerun = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function hydrateQueuedUpdates() {
    if (queuedHydrationInFlight.current) return;
    queuedHydrationInFlight.current = true;
    try {
      // A late photo-analysis result that arrives during a pass asks for one
      // more (requestQueuedUpdateSync). The loop runs it inside this same task:
      // starting a new task from here would hit the background guard's limit
      // of 2 consecutive runs and be dropped (review pass 3, 28 Sep 2026).
      do {
        queuedHydrationRerunRequested.current = false;
        try {
          await hydrateQueuedUpdatesPass();
        } catch (error) {
          // A failed pass still owes a requested rerun (review pass 4).
          if (!queuedHydrationRerunRequested.current) throw error;
        }
      } while (queuedHydrationRerunRequested.current);
    } finally {
      queuedHydrationInFlight.current = false;
    }
  }

  async function hydrateQueuedUpdatesPass() {
    // An update whose own save or retry is still syncing is left to it: the
    // loop used to stage and upload the same photos a second time, alongside
    // the direct sync (audit A4, 30 Sep 2026). One deferred pass follows.
    const now = Date.now();
    const retryable = savedUpdatesRef.current.filter(updateNeedsAutomaticSyncRetry);
    const queuedUpdates = retryable.filter(update => !directSyncIsRecent(update, now));
    if (queuedUpdates.length < retryable.length && !queuedHydrationDeferredRerun.current) {
      queuedHydrationDeferredRerun.current = setTimeout(() => {
        queuedHydrationDeferredRerun.current = null;
        // A pass still running owes one more (as a late analysis result
        // does); a new task could be dropped by the guard's run cap.
        if (queuedHydrationInFlight.current) queuedHydrationRerunRequested.current = true;
        else startAutomaticSyncBackgroundTask('after_direct_sync', hydrateQueuedUpdates);
      }, DIRECT_SYNC_GRACE_MS);
    }

    if (queuedUpdates.length === 0) return;

    const tokenResult = await getCurrentSessionAccessToken();
    const tokenLookup = tokenResult.data;
    const sessionTokenPresent = tokenLookup?.status === 'token_present';

    const resolvedAt = new Date().toISOString();

    if (!sessionTokenPresent) {
      const failureCategory = await fieldUpdateSyncCategoryWithoutSession(tokenLookup, signInPendingRef.current);
      const stampedStatus = persistedStatusForSyncResult({ result: 'skipped', failureCategory });
      // Field fix 2026-07-18 (cpu_resource / diskwrites_resource kills):
      // stamping is idempotent. Updates already marked failed for this
      // same auth condition are NOT re-stamped — re-stamping every 30s
      // rewrote the full saved-updates store to disk and changed the
      // authority input each pass, driving a continuous core recompute
      // until iOS terminated the app for CPU/disk-write exhaustion.
      // Nor is one already waiting offline (A4 pass 7 M1).
      const needsStamp = queuedUpdates.filter(update =>
        lifecycleStatusForUpdate(update) !== stampedStatus ||
        update.syncDiagnostics?.lastSyncFailureCategory !== failureCategory,
      );
      if (needsStamp.length === 0) return;

      const syncDiagnostics = buildSkippedSyncDiagnostics(
        failureCategory,
        resolvedAt,
        needsStamp.length,
        false,
      );
      needsStamp.forEach(update => {
        applyFieldUpdateSyncResultIfCurrent(update, {
          ...update,
          status: stampedStatus,
          syncDiagnostics,
          workflowTimestamps: {
            ...(update.workflowTimestamps || {}),
            sendResolvedAt:
              update.workflowTimestamps?.sendResolvedAt || resolvedAt,
          },
        });
      });
      return;
    }

    await runAutomaticSyncQueue(queuedUpdates, async update => {
        const attemptStartedAt = new Date().toISOString();
        const {
          syncResult,
          workAttempt,
          update: syncReadyUpdate,
        } = await syncFieldUpdateWithMissingPhotoRepair(update);
        const syncDiagnostics = buildSyncDiagnosticsFromUpload(
          syncResult,
          attemptStartedAt,
          sessionTokenPresent,
          workAttempt,
          update.sendAttempts || null,
        );
        const nextUpdate: ProjectUpdate = {
          ...syncReadyUpdate,
          status: statusForSyncDiagnostics(syncDiagnostics),
          syncDiagnostics,
          workflowTimestamps: {
            ...(syncReadyUpdate.workflowTimestamps || {}),
            sendResolvedAt:
              syncReadyUpdate.workflowTimestamps?.sendResolvedAt || resolvedAt,
          },
        };
        const current = savedUpdatesRef.current.find(item => item.id === update.id);
        if (current && !shouldPersistAutomaticSyncOutcome(current, nextUpdate)) {
          return;
        }
        applyFieldUpdateSyncResultIfCurrent(syncReadyUpdate, nextUpdate);
    });
  }

  async function removeMissingSyncPhotos(missingPhotos: MissingSyncPhoto[]) {
    const affectedUpdateIds = new Set(missingPhotos.map(photo => photo.updateId));
    await removeMissingPhotosFromSyncQueue(missingPhotos);
    let repairedUpdates = savedUpdatesRef.current.map(update =>
      affectedUpdateIds.has(update.id)
        ? markMissingPhotosUnavailable(update, missingPhotos)
        : update,
    );
    savedUpdatesRef.current = repairedUpdates;
    setSavedUpdates(repairedUpdates);
    await persistStorageItem(UPDATES_STORAGE_KEY, JSON.stringify(repairedUpdates));

    for (const updateId of affectedUpdateIds) {
      const update = savedUpdatesRef.current.find(item => item.id === updateId);
      if (!update) continue;
      await retryQueuedUpdate(update);
    }
  }

  function beginDraftForProject(projectName: string) {
    const nextDraft = createDraft(projectName);
    draftRef.current = nextDraft;
    setDraft(nextDraft);
    setSelectedWorkspaceProject(projectName);
    setScreen('AddPhotos');
    draftLocationCaptureRef.current = captureDraftLocation(nextDraft);
  }

  function createNewUpdate(projectName?: string) {
    if (!projectName && activeProjects.length === 0) {
      Alert.alert(
        'No projects yet',
        'Add a new project or reopen an archived project first.',
      );

      setScreen('Home');

      return;
    }

    const confidentTarget =
      projectName ||
      (activeProjects.length === 1 ? activeProjects[0] : null) ||
      (projectDetectionStatus === 'detected' ? detectedProjectName : null);

    const proceed = (discardedDraft: ProjectUpdate | null) =>
      startNewUpdate({
        target: confidentTarget,
        discardedDraft,
        beginDraftForProject,
        replaceDraftWithBlank: () => {
          const blank = createDraft(activeProjects[0] || '');
          draftRef.current = blank;
          setDraft(blank);
        },
        openProjectPicker: () => setScreen('SelectProject'),
        deleteDiscardedPhotos: discardDraftAfterReplacement,
      });

    if (hasDraftContent(draft)) {
      Alert.alert(
        'Unfinished update found',
        'Starting a new update will replace the current unfinished draft.',
        [
          {
            text: 'Cancel',
            style: 'cancel',
          },
          {
            text: 'Start New',
            style: 'destructive',
            onPress: () => proceed(draft),
          },
        ],
      );

      return;
    }

    proceed(null);
  }

  function createNewUpdateForScheduleTask(
    parentProjectName: string,
    scheduleItem: ScheduleItem,
  ) {
    const taskProjectName = scheduleItem.projectName.trim() || parentProjectName;
    const taskProjectAreas = projectAreasForProject({
      projectAreas,
      projectName: parentProjectName,
      scheduleItems,
      updates: activeSavedUpdates,
    });
    const area = taskProjectAreas.find(item =>
      item.name.trim().toLowerCase() === scheduleItem.locationName.trim().toLowerCase(),
    ) || null;

    function proceed() {
      const nextDraft: ProjectUpdate = {
        ...createDraft(taskProjectName),
        scheduleItemId: scheduleItem.id,
        scheduleTaskName: scheduleItem.taskName,
        scheduleProjectName: parentProjectName,
        selectedAreaId: area?.id || null,
        selectedAreaName: area?.name || scheduleItem.locationName || 'Unassigned / Unknown Area',
        areaStatus: area || scheduleItem.locationName ? 'confirmed' : 'unknown',
      };
      draftRef.current = nextDraft;
      setDraft(nextDraft);
      setSelectedWorkspaceProject(parentProjectName);
      setScreen('AddPhotos');
      draftLocationCaptureRef.current = captureDraftLocation(nextDraft);
    }

    if (!hasDraftContent(draft)) {
      proceed();
      return;
    }

    Alert.alert(
      'Unfinished update found',
      'Starting this task update will replace the current unfinished draft.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Start Task Update',
          style: 'destructive',
          onPress: () => {
            const discardedDraft = draftRef.current;
            proceed();
            void discardDraftAfterReplacement(discardedDraft);
          },
        },
      ],
    );
  }

  function prepareProjectWalkFieldUpdate(
    projectName: string,
    memories: readonly DAVEConfirmedCaptureMemory[],
    sourceWalkSessionId: string | null = null,
    onPrepared?: () => void,
  ) {
    let prepared: ReturnType<typeof buildDAVEProjectWalkFieldUpdateDraft>;
    try {
      prepared = buildDAVEProjectWalkFieldUpdateDraft({ projectName, memories });
    } catch (error) {
      Alert.alert(
        'Nothing to prepare',
        error instanceof Error
          ? error.message
          : 'Capture and confirm a Project Walk memory first.',
      );
      return;
    }

    const walkProjectAreas = projectAreasForProject({
      projectAreas,
      projectName,
      scheduleItems,
      updates: activeSavedUpdates,
    });
    const area = prepared.recommendedAreaName
      ? walkProjectAreas.find(item =>
          item.name.trim().toLowerCase() === prepared.recommendedAreaName?.trim().toLowerCase()
        ) || null
      : null;

    function proceed() {
      const nextDraft: ProjectUpdate = {
        ...createDraft(projectName),
        notes: prepared.notes,
        sourceCaptureMemoryIds: [...prepared.sourceMemoryIds],
        sourceWalkSessionId,
        selectedAreaId: area?.id || null,
        selectedAreaName:
          area?.name || prepared.recommendedAreaName || 'Unassigned / Unknown Area',
        areaStatus: area ? 'confirmed' : 'unknown',
        continueWithoutPhotosAcknowledged: true,
        pieStatus: 'no_visual_comparison',
        pieSummary: 'No visual comparison available',
        status: 'ready_to_send',
        workflowTimestamps: {
          startedAt: new Date().toISOString(),
          reviewOpenedAt: new Date().toISOString(),
        },
      };
      // The replaced draft's files go only after this draft is on disk
      // (audit A4, 30 Sep 2026: they were left behind, and the ref lagged).
      const discardedDraft = draftRef.current;
      draftRef.current = nextDraft;
      setDraft(nextDraft);
      setSelectedWorkspaceProject(projectName);
      setScreen('BuildUpdate');
      onPrepared?.();
      if (hasDraftContent(discardedDraft)) void discardDraftAfterReplacement(discardedDraft);
      else void persistDraftNow(nextDraft);
    }

    if (hasDraftContent(draft)) {
      Alert.alert(
        'Unfinished update found',
        'Preparing this Project Walk update will replace the current unfinished draft.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Prepare Update',
            style: 'destructive',
            onPress: proceed,
          },
        ],
      );
      return;
    }

    proceed();
  }

  function openProjectWorkspace(projectName: string) {
    setSelectedWorkspaceProject(projectName);
    setScreen('ProjectWorkspace');
  }

  function workspaceScopeNames(projectName: string) {
    return scheduleProjectScopeNames(
      projectName,
      authoritativeScheduleItems as unknown as import('./types').ScheduleItem[],
    );
  }

  async function startProjectWalk(projectName: string) {
    const existing = await localDAVEProjectWalkSessionRepository.readActive();
    if (existing) {
      setActiveProjectWalkSession(existing);
      if (existing.projectName.trim().toLowerCase() === projectName.trim().toLowerCase()) {
        return true;
      }
      Alert.alert(
        'Project Walk already in progress',
        `Finish or end the walk for ${existing.projectName} before starting another one.`,
        [
          { text: 'Not Now', style: 'cancel' },
          {
            text: 'Resume Walk',
            onPress: () => openProjectWorkspace(existing.projectName),
          },
        ],
      );
      return false;
    }

    const startedAt = new Date().toISOString();
    const session = await localDAVEProjectWalkSessionRepository.start(
      startDAVEProjectWalkSession({
        id: `walk-session-${uid()}`,
        projectName,
        startedAt,
      }),
    );
    setActiveProjectWalkSession(session);
    return true;
  }

  async function saveCaptureMemory(
    memory: DAVEConfirmedCaptureMemory,
    walkSessionId?: string,
  ) {
    // A corrected project or area belongs to this memory only. It was saved
    // as a name alias that renamed every task of the real area (whole-app
    // audit A11 pass 2, 30 Sep 2026).
    await localDAVECaptureMemoryRepository.save(memory);
    const refreshedMemories = await localDAVECaptureMemoryRepository.list();
    setCaptureMemories([...refreshedMemories]);
    if (walkSessionId) {
      const session = await localDAVEProjectWalkSessionRepository.addMemory(
        walkSessionId,
        memory.id,
        new Date().toISOString(),
      );
      setActiveProjectWalkSession(session);
    }
  }

  async function finishProjectWalk(sessionId: string) {
    try {
      const session = await localDAVEProjectWalkSessionRepository.readActive();
      if (!session || session.id !== sessionId) {
        throw new Error('The active Project Walk was not found.');
      }
      const allMemories = await localDAVECaptureMemoryRepository.list();
      const memoriesById = new Map(allMemories.map(memory => [memory.id, memory]));
      const sessionMemories = session.memoryIds
        .map(memoryId => memoriesById.get(memoryId))
        .filter((memory): memory is DAVEConfirmedCaptureMemory => Boolean(memory));
      if (sessionMemories.length === 0) {
        throw new Error('Capture at least one observation before finishing the walk.');
      }
      prepareProjectWalkFieldUpdate(
        session.projectName,
        sessionMemories,
        session.id,
        () => {
          void localDAVEProjectWalkSessionRepository
            .complete(session.id, new Date().toISOString())
            .then(() => setActiveProjectWalkSession(current =>
              current?.id === session.id ? null : current
            ))
            .catch(() => {
              Alert.alert(
                'Walk status not cleared',
                'The update is ready to review, but the active walk could not be cleared. Try Finish Walk again after returning to the project.',
              );
            });
        },
      );
    } catch (error) {
      Alert.alert(
        'Unable to finish walk',
        error instanceof Error ? error.message : 'The Project Walk could not be prepared.',
      );
    }
  }

  function cancelProjectWalk(sessionId: string) {
    const session = activeProjectWalkSession;
    const count = session?.id === sessionId ? session.memoryIds.length : 0;
    Alert.alert(
      'End Project Walk?',
      count > 0
        ? `${count} confirmed ${count === 1 ? 'observation remains' : 'observations remain'} in project history and can still be prepared later.`
        : 'No observations have been saved in this walk.',
      [
        { text: 'Keep Walking', style: 'cancel' },
        {
          text: 'End Walk',
          style: 'destructive',
          onPress: () => {
            void localDAVEProjectWalkSessionRepository
              .cancel(sessionId, new Date().toISOString())
              .then(() => setActiveProjectWalkSession(current =>
                current?.id === sessionId ? null : current
              ))
              .catch(() => {
                Alert.alert('Unable to end walk', 'The active Project Walk could not be ended.');
              });
          },
        },
      ],
    );
  }

  async function deleteCaptureMemory(memoryId: string) {
    const deleted = await localDAVECaptureMemoryRepository.delete(memoryId);
    if (!deleted) throw new Error('The saved memory was already removed.');
    setCaptureMemories(current => current.filter(memory => memory.id !== memoryId));
    if (activeProjectWalkSession?.memoryIds.includes(memoryId)) {
      const session = await localDAVEProjectWalkSessionRepository.removeMemory(
        activeProjectWalkSession.id,
        memoryId,
        new Date().toISOString(),
      );
      setActiveProjectWalkSession(session);
    }
  }

  async function persistSelectedProjectCoverPhoto(
    projectName: string,
    asset: ImagePicker.ImagePickerAsset,
  ) {
    try {
      const coverPhoto = await cacheSelectedProjectCoverPhoto(
        asset.uri,
        authorityProjectId(projectName),
        asset.mimeType || 'image/jpeg',
      );
      setProjectRecords(previous => previous.map(project =>
        project.name.toLowerCase() === projectName.toLowerCase()
          ? {
              ...project,
              coverPhoto,
              coverPhotoMode: 'manual',
              coverPhotoUpdatedAt: coverPhoto.updatedAt,
            }
          : project,
      ));
      const record = projectRecords.find(project =>
        project.name.toLowerCase() === projectName.toLowerCase(),
      );
      saveCloudProjectCoverPhoto(projectName, coverPhoto, 'manual', record?.data);
    } catch {
      Alert.alert('Cover photo unavailable', 'The selected cover photo could not be saved.');
    }
  }

  async function chooseProjectCoverFromLibrary(projectName: string) {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Photo access needed', 'Allow photo access to select a project cover photo.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [16, 9],
      quality: 0.9,
    });
    if (result.canceled || !result.assets[0]) return;
    await persistSelectedProjectCoverPhoto(projectName, result.assets[0]);
  }

  async function takeNewProjectCoverPhoto(projectName: string) {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Camera access needed', 'Allow camera access to take a project cover photo.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [16, 9],
      quality: 0.9,
    });
    if (result.canceled || !result.assets[0]) return;
    await persistSelectedProjectCoverPhoto(projectName, result.assets[0]);
  }

  function useBestProjectPhoto(projectName: string) {
    const changedAt = new Date().toISOString();
    const record = projectRecords.find(project =>
      project.name.toLowerCase() === projectName.toLowerCase(),
    );
    setProjectRecords(previous => previous.map(project =>
      project.name.toLowerCase() === projectName.toLowerCase()
        ? { ...project, coverPhotoMode: 'automatic', coverPhotoUpdatedAt: changedAt }
        : project,
    ));
    saveCloudProjectCoverPhoto(
      projectName,
      record?.coverPhoto || null,
      'automatic',
      record?.data,
      changedAt,
    );
  }

  function removeProjectCoverPhoto(projectName: string) {
    const current = coverPhotoForProject(projectRecords, projectName);
    Alert.alert(
      'Remove cover photo?',
      'The project will return to automatic photo selection.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => {
            const removedAt = new Date().toISOString();
            setProjectRecords(previous => previous.map(project =>
              project.name.toLowerCase() === projectName.toLowerCase()
                ? {
                    ...project,
                    coverPhoto: null,
                    coverPhotoMode: 'automatic',
                    coverPhotoUpdatedAt: removedAt,
                  }
                : project,
            ));
            const record = projectRecords.find(project =>
              project.name.toLowerCase() === projectName.toLowerCase(),
            );
            saveCloudProjectCoverPhoto(projectName, null, 'automatic', record?.data, removedAt);
            void removeCachedProjectCoverPhoto(current);
          },
        },
      ],
    );
  }

  function resumeDraft() {
    setSelectedWorkspaceProject(draft.projectName);
    setScreen('AddPhotos');
  }

  function discardDraft() {
    Alert.alert(
      'Discard unfinished update?',
      'The photos, captions, categories, notes, and selected recipients in this draft will be removed.',
      [
        {
          text: 'Cancel',
          style: 'cancel',
        },
        {
          text: 'Discard',
          style: 'destructive',
          onPress: () => {
            // The blank draft is on disk before the discarded draft's files go (audit A4).
            clearOpenDraft(activeProjects[0] || '', draftRef.current);
          },
        },
      ],
    );
  }

  

  function changeDraftProject(projectName: string) {
    beginDraftForProject(projectName);
  }

  function persistDeletedProjectNames(nextNames: string[]) {
    deletedProjectNamesRef.current = nextNames;
    setDeletedProjectNames(nextNames);
    persistStorageItem(DELETED_PROJECTS_STORAGE_KEY, JSON.stringify(nextNames)).catch(error =>
      reportStoragePersistenceFailure({ storageKey: DELETED_PROJECTS_STORAGE_KEY, label: 'deleted project records', error }),
    );
  }

  function markProjectDeleted(projectName: string) {
    persistDeletedProjectNames(
      mergeProjectNames(deletedProjectNamesRef.current, [projectName]),
    );
  }

  function clearProjectDeletion(projectName: string) {
    const key = projectName.trim().toLowerCase();
    persistDeletedProjectNames(
      deletedProjectNamesRef.current.filter(name => name.toLowerCase() !== key),
    );
  }

function addProject(projectName: string) {
  const trimmed = projectName.trim();

  if (!trimmed) {
    Alert.alert(
      'Project name needed',
      'Enter a project name first.',
    );

    return false;
  }
  if (isReservedLegacyProjectName(trimmed)) {
    Alert.alert('Name not available', RESERVED_LEGACY_PROJECT_NAME_MESSAGE);
    return false;
  }

  // A deleted name is refused with the reason; an archived one is offered for reopening (audit A3).
  const availability = projectNameAvailability({
    projectName: trimmed, projects, archivedProjects,
    deletedProjectNames: deletedProjectNamesRef.current, tombstones: operationalSyncTombstonesRef.current,
  });
  if (availability.kind === 'deleted') {
    const deletedOn = availability.deletedAt ? formatSavedTime(availability.deletedAt) : null;
    Alert.alert('Name not available', deletedProjectNameMessage(trimmed, deletedOn));
    return false;
  }
  if (availability.kind === 'archived' || (availability.kind === 'similar' && availability.source === 'archived')) {
    Alert.alert('Project is archived', archivedProjectNameMessage(trimmed, availability.projectName), [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Reopen', onPress: () => reopenProject(availability.projectName) },
    ]);
    return false;
  }
  if (availability.kind === 'exists') {
    Alert.alert('Already added', `${trimmed} is already in your project list.`);
    return false;
  }
  if (availability.kind === 'similar') {
    Alert.alert('Name not available', similarProjectNameMessage(trimmed, availability.projectName, availability.source));
    return false;
  }

  setProjects(prev => [trimmed, ...prev]);
  setProjectRecords(prev => [{ name: trimmed }, ...prev]);

  saveCloudProject(trimmed);

  return true;
}
  function addAndChangeDraftProject(projectName: string) {
    const added = addProject(projectName);

    if (added) {
      changeDraftProject(projectName.trim());
    }

    return added;
  }

  async function closeProject(projectName: string) {
    // Work still queued for the project is named first (audit A7 M2).
    const queue = await getOfflineQueue().catch(() => []);
    Alert.alert(
      'Close Project?',
      closeProjectMessage(projectName, queuedWorkForProject(queue, projectName)),
      [
        {
          text: 'Cancel',
          style: 'cancel',
        },
        {
          text: 'Close Project',
          style: 'destructive',
          onPress: () => {
            setArchivedProjects(prev =>
              mergeProjectNames(prev, [projectName]),
            );
            setCloudProjectArchived(projectName, true);
            setScreen('Home');
          },
        },
      ],
    );
  }

  function reopenProject(projectName: string) {
    const availability = projectNameAvailability({
      projectName, projects: [], archivedProjects: [],
      deletedProjectNames: deletedProjectNamesRef.current, tombstones: operationalSyncTombstonesRef.current,
    });
    if (availability.kind === 'deleted') {
      // Deleted on another device: not revived from a stale archived list (audit A3 pass 2).
      setArchivedProjects(prev => prev.filter(project => project.toLowerCase() !== projectName.toLowerCase()));
      Alert.alert('Project was deleted', `${projectName} was deleted${availability.deletedAt ? ` on ${formatSavedTime(availability.deletedAt)}` : ''}, so it cannot be reopened.`);
      return;
    }
    setProjects(prev => mergeProjectNames(prev, [projectName]));
    setProjectRecords(prev =>
      prev.some(project => project.name.toLowerCase() === projectName.toLowerCase())
        ? prev
        : [{ name: projectName }, ...prev],
    );
    setArchivedProjects(prev =>
      prev.filter(
        project =>
          project.toLowerCase() !==
          projectName.toLowerCase(),
      ),
    );
    setCloudProjectArchived(projectName, false);
  }

  async function deleteProjectPermanently(projectName: string) {
    setDeletingProjectName(projectName);

    try {
      if (savedUpdatesSaveTimer.current) {
        clearTimeout(savedUpdatesSaveTimer.current);
        savedUpdatesSaveTimer.current = null;
      }
      if (draftSaveTimer.current) {
        clearTimeout(draftSaveTimer.current);
        draftSaveTimer.current = null;
      }

      const deletionResult = await projectDeletionRuntime.commit(
        support => {
          const deletedAt = new Date().toISOString();
          const remainingProjectNames = projectRecords
            .filter(project => project.name.toLowerCase() !== projectName.toLowerCase())
            .map(project => project.name);
          const fallbackProject = selectProjectDeletionFallback({
            remainingProjectNames, archivedProjectNames: archivedProjects,
            deletedProjectNames: [...deletedProjectNamesRef.current, projectName],
          });
          const replacementDraft = createDraft(fallbackProject);
          const currentDraftEnvelope: StoredDraft = {
            draft: draftRef.current,
            savedAt: draftSavedAt || deletedAt,
          };
          const replacementDraftEnvelope: StoredDraft = {
            draft: replacementDraft,
            savedAt: deletedAt,
          };
          const explicitlyOwnedReferenceDocuments = referenceDocuments.filter(document =>
            referenceDocumentDeletedWithProject( // a shared schedule's file stays (audit A3 pass 3)
              document,
              projectName,
              authorityProjectId(projectName),
            ),
          );
          // One rule with the cascade, historical evidence included (audit A4 pass 5).
          const removedUpdates = savedUpdatesRef.current.filter(update =>
            projectDeletionTakesUpdate({
              update,
              projectName,
              scheduleItems,
            }),
          );
          const ownedProjectDocumentCandidates = [
            ...projectDocuments.filter(document =>
              projectDocumentMatchesProject(document, projectName),
            ),
            ...removedUpdates.flatMap(update => update.documents || []),
            ...(projectDeletionTakesUpdate({
              update: draftRef.current,
              projectName,
              scheduleItems,
            })
              ? draftRef.current.documents || []
              : []),
          ];
          const newFileCleanupIntents = buildProjectDeletionFileCleanupIntents({
            projectName,
            projectDocuments: ownedProjectDocumentCandidates,
            referenceDocuments: explicitlyOwnedReferenceDocuments,
            isOwnedReferenceDocument: document => isStoredReferenceDocument(document.uri),
          });
          const cascade = buildProjectDeletionCascade({
            projectName,
            authorityProjectId: authorityProjectId(projectName),
            deletedAt,
            projectRecords,
            deletedProjectNames: deletedProjectNamesRef.current,
            archivedProjects,
            updates: savedUpdatesRef.current,
            updateTombstones: deletedUpdateTombstonesRef.current,
            updateDeletionIntents: support.updateDeletionIntents,
            projectDocuments,
            referenceDocuments,
            projectAreas: projectAreasCurrentRef.current,
            scheduleItems,
            daveSyncTombstones: support.daveSyncTombstones,
            draft: currentDraftEnvelope,
            draftBelongsToProject: projectDeletionTakesUpdate({
              update: draftRef.current,
              projectName,
              scheduleItems,
            }),
            replacementDraft: replacementDraftEnvelope,
            cloudIntents: support.cloudIntents,
            fileCleanupIntents: support.fileCleanupIntents,
            newFileCleanupIntents,
            buildUpdateTombstone: (update, deletionTimestamp) =>
              buildUpdateTombstone(
                update,
                'delete_update_everywhere',
                deletionTimestamp,
              ),
          });
          return {
            operations: buildProjectDeletionOperations(
              cascade,
              PROJECT_DELETION_STORAGE_KEYS,
            ),
            result: { cascade, fallbackProject, replacementDraft },
          };
        },
      );
      const { cascade, fallbackProject, replacementDraft } = deletionResult;

      rememberOperationalTombstones(cascade.nextDAVESyncTombstones);
      deletedProjectNamesRef.current = cascade.nextDeletedProjectNames;
      deletedUpdateTombstonesRef.current = cascade.nextUpdateTombstones;
      savedUpdatesRef.current = cascade.remainingUpdates;
      setDeletedProjectNames(cascade.nextDeletedProjectNames);
      setDeletedUpdateTombstones(cascade.nextUpdateTombstones);
      setProjects(cascade.remainingProjectRecords.map(project => project.name));
      setProjectRecords(cascade.remainingProjectRecords);
      setArchivedProjects(cascade.remainingArchivedProjects);
      setSavedUpdates(cascade.remainingUpdates);
      setProjectDocuments(cascade.remainingProjectDocuments);
      projectAreasCurrentRef.current = cascade.remainingProjectAreas;
      setProjectAreas(cascade.remainingProjectAreas);
      markProjectAreasAuthorityReady(true);
      markReferenceDocumentsAuthorityReady(true); markScheduleItemsAuthorityReady(true);
      setReferenceDocuments(cascade.remainingReferenceDocuments);
      setScheduleItems(cascade.remainingScheduleItems);

      if (cascade.draftReplaced) {
        draftRef.current = replacementDraft;
        setDraft(replacementDraft);
        setDraftSavedAt(null);
      }

      setSelectedWorkspaceProject(fallbackProject);
      setScreen('Home');
      await Promise.allSettled([
        ...cascade.removedProjectAreas.map(area =>
          removeOperationalRecordFromSyncQueue('project_area', area.id),
        ),
        ...cascade.removedScheduleItems.map(item =>
          removeOperationalRecordFromSyncQueue('schedule_item', item.id),
        ),
        ...cascade.removedReferenceDocuments.map(document =>
          removeOperationalRecordFromSyncQueue('reference_document', document.id),
        ),
        withdrawQueuedChangesOfDeletedProject(projectName, projectRecords), // cover, reopen, shared copies (audit A3 pass 4)
      ]);
      void reconcileProjectUpdateDeletionJournal(cascade.nextUpdateTombstones).catch(() => undefined);
      void synchronizeDAVESyncTombstones().catch(() => undefined);
      const deletedCoverPhoto = projectRecords.find(project => project.name.toLowerCase() === projectName.toLowerCase())?.coverPhoto;
      void removeCachedProjectCoverPhoto(deletedCoverPhoto).catch(() => undefined); // goes with the project (audit A3)
      const [cloudQueueResult, fileCleanupResult] = await Promise.allSettled([
        projectDeletionRuntime.processPendingCloudIntents(),
        projectDeletionRuntime.processPendingFileCleanupIntents(),
      ]);
      if (
        cloudQueueResult.status === 'rejected' ||
        fileCleanupResult.status === 'rejected' ||
        (fileCleanupResult.status === 'fulfilled' && fileCleanupResult.value > 0)
      ) {
        Alert.alert(
          'Project removed',
          'The project is safely removed from this app. Pending active-cloud or device-file cleanup will retry automatically. Secure cloud audit evidence may remain until separately authorized.',
        );
      }
    } catch (error) {
      const recoveryBlocked = error instanceof ProjectDeletionRecoveryRequiredError; if (recoveryBlocked) startupHydration.fail(PROJECTS_STORAGE_KEY, 'project deletion recovery', error);
      Alert.alert(recoveryBlocked ? 'Recovery required' : 'Delete failed', recoveryBlocked
        ? 'Project deletion was partially saved. Editing is locked until Retry Recovery succeeds or the app restarts.'
        : `${projectName} could not be safely saved as deleted. No cloud deletion was queued; try again.`);
    } finally {
      setDeletingProjectName(null);
    }
  }

  function addProjectArea(
    name: string,
    projectName = selectedWorkspaceProject,
  ) {
    const trimmed = name.trim();

    if (!trimmed) {
      Alert.alert(
        'Area name needed',
        'Enter a project area name first.',
      );

      return false;
    }

    const now = new Date().toISOString();
    const nextArea = normalizeProjectArea({
      id: uid(),
      name: trimmed,
      projectName,
      latitude: DEFAULT_PROJECT_AREAS[0].latitude,
      longitude: DEFAULT_PROJECT_AREAS[0].longitude,
      radiusFeet: 250,
      locationCapturedAt: null,
      updatedAt: now,
    });
    markProjectAreasAuthorityReady(true);
    setProjectAreas(prev => [nextArea, ...prev]);
    void queueProjectAreaRecord(nextArea).catch(() => {
      Alert.alert('Area saved on this device', 'Automatic cloud sync could not be queued. Use Sync Now when connected.');
    });

    return true;
  }

  function updateProjectArea(
    areaId: string,
    next: Partial<ProjectArea>,
  ): boolean {
    // The latest copy: Save GPS calls this after a fix that takes seconds
    // (review, 29 Sep 2026).
    const current = projectAreasCurrentRef.current.find(area => area.id === areaId);
    if (!current) return false;
    const updated = normalizeProjectArea({
      ...current,
      ...next,
      updatedAt: new Date().toISOString(),
    });
    markProjectAreasAuthorityReady(true);
    setProjectAreas(prev => prev.map(area => area.id === areaId ? updated : area));
    void queueProjectAreaRecord(updated).catch(() => {
      Alert.alert('Area saved on this device', 'Automatic cloud sync could not be queued. Use Sync Now when connected.');
    });
    return true;
  }

  function deleteProjectArea(areaId: string) {
    const area = projectAreas.find(item => item.id === areaId);

    if (!area) return;

    Alert.alert(
      'Delete project area?',
      `${area.name} will be removed from the area list. Saved updates will keep their area names.`,
      [
        {
          text: 'Cancel',
          style: 'cancel',
        },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            void recordDAVESyncTombstone('project_area', areaId)
              .then(tombstone => {
                rememberOperationalTombstones([tombstone]);
                return removeOperationalRecordFromSyncQueue('project_area', areaId);
              })
              .then(() => {
                markProjectAreasAuthorityReady(true);
                setProjectAreas(prev => prev.filter(item => item.id !== areaId));

                if (draft.selectedAreaId === areaId) {
                  changeDraftArea('');
                }
              })
              .catch(() => {
                Alert.alert(
                  'Delete failed',
                  `${area.name} could not be saved as deleted. Try again.`,
                );
              });
          },
        },
      ],
    );
  }

  function useCurrentLocationForArea(areaId: string) {
    const area = projectAreas.find(item => item.id === areaId);
    if (!area || !hasSavedAreaLocation(area)) {
      void saveCurrentLocationForArea(areaId);
      return;
    }

    Alert.alert(
      'Replace saved GPS?',
      `Stand in ${area.name}. Your current location replaces its saved GPS point.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Replace GPS', onPress: () => void saveCurrentLocationForArea(areaId) },
      ],
    );
  }

  async function saveCurrentLocationForArea(areaId: string) {
    if (!areaGpsSaveInFlight.tryStart(areaId)) return;
    try {
      const snapshot = await getCurrentLocationSnapshot(Location.Accuracy.Highest);

      const decision = areaGpsSaveDecision(snapshot);
      if (!snapshot || decision === 'location-denied') {
        Alert.alert(
          'Location access needed',
          'Allow location access, or enter/update this area manually later.',
        );

        return;
      }
      if (decision === 'precise-off') {
        Alert.alert(PRECISE_LOCATION_OFF_TITLE, PRECISE_LOCATION_OFF_MESSAGE, [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Open Settings', onPress: () => void Linking.openSettings() },
        ]);
        return;
      }

      const save = () => {
        if (!updateProjectArea(areaId, areaPointFromFix(snapshot))) return;
        Alert.alert('Area location saved', areaPointSavedMessage(snapshot.accuracy));
      };
      if (decision === 'save') {
        save();
        return;
      }
      Alert.alert('GPS is not precise here', areaPointImpreciseMessage(snapshot.accuracy), [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Save Anyway', onPress: save },
        { text: 'Try Again', onPress: () => void saveCurrentLocationForArea(areaId) },
      ]);
    } catch {
      Alert.alert(
        'GPS unavailable',
        'Current location could not be captured right now.',
      );
    } finally {
      areaGpsSaveInFlight.finish(areaId);
    }
  }

  function openContacts() {
    setContactsReturnScreen(
      screen === 'Contacts' ? 'Home' : screen,
    );
    setScreen('Contacts');
  }
function hasPlzCorpRecipient(emails: string[]) {
  return emails.some(email =>
    email.toLowerCase().includes('@plzcorp.com'),
  );
}

async function copyEmailDraftToClipboard(subject: string, body: string) {
  await Clipboard.setStringAsync(`Subject: ${subject}\n\n${body}`);
}

function buildOutlookComposeUrl({
  recipients,
  subject,
  body,
}: {
  recipients: string[];
  subject: string;
  body: string;
}) {
  const to = encodeURIComponent(recipients.join(';'));
  const encodedSubject = encodeURIComponent(subject);
  const encodedBody = encodeURIComponent(body);

  return `ms-outlook://compose?to=${to}&subject=${encodedSubject}&body=${encodedBody}`;
}
  function composeEmail(withPhotos = true) {
    return MailComposer.composeAsync({
      recipients: currentEmails,
      subject: message.subject,
      body: message.body,
      attachments: withPhotos
        ? draft.photos.map(photo => photo.uri)
        : [],
    });
  }

  async function openOutlookForPlzEmail() {
    try {
      await copyEmailDraftToClipboard(message.subject, message.body);

      const url = buildOutlookComposeUrl({
        recipients: currentEmails,
        subject: message.subject,
        body: `${message.body}

Note: This update was opened through Outlook because PLZ email security may reject messages sent from personal mail accounts. Photos are not attached automatically in this mode.`,
      });

      await Linking.openURL(url);
    } catch {
      Alert.alert(
        'Open Outlook manually',
        'The update was copied to your clipboard. Open Outlook with your PLZ account, start a new email, paste the update, and attach photos manually if needed.',
      );
    }
  }

  async function copyPlzEmailFallback() {
    await copyEmailDraftToClipboard(message.subject, message.body);

    Alert.alert(
      'Update copied',
      'Open Outlook or your PLZ-approved email app, paste the update, and send it from your PLZ/corporate account. This avoids the Yahoo/Mimecast block.',
    );
  }

  function toggleContactRecipient(contactId: string) {
    setDraft(prev => {
      const selected = prev.recipients.contactIds.includes(contactId);

      return {
        ...prev,
        recipients: {
          ...prev.recipients,
          contactIds: selected
            ? prev.recipients.contactIds.filter(id => id !== contactId)
            : [...prev.recipients.contactIds, contactId],
        },
      };
    });
  }

  function togglePhoneContactRecipient(contact: ProjectContact) {
    const next = normalizeContact(contact);

    if (!next.email && !next.phone) {
      Alert.alert(
        'No email or phone',
        'Choose a contact with an email address or phone number.',
      );

      return;
    }

    setContactBook(prev => {
      const exists = prev.contacts.some(item => item.id === next.id);

      return {
        ...prev,
        contacts: exists
          ? prev.contacts.map(item =>
              item.id === next.id
                ? next
                : item,
            )
          : [next, ...prev.contacts],
      };
    });

    setDraft(prev => {
      const selected = prev.recipients.contactIds.includes(next.id);

      return {
        ...prev,
        recipients: {
          ...prev.recipients,
          contactIds: selected
            ? prev.recipients.contactIds.filter(id => id !== next.id)
            : [...prev.recipients.contactIds, next.id],
        },
      };
    });
  }

  function updateContactDeliveryChoice(
    contactId: string,
    next: Partial<ProjectContact>,
  ) {
    setContactBook(prev => ({
      ...prev,
      contacts: prev.contacts.map(contact =>
        contact.id === contactId
          ? normalizeContact({
              ...contact,
              ...next,
            })
          : contact,
      ),
    }));
  }

  async function pickPhotos() {
    const cameraActionStartedAt = new Date().toISOString();

    setDraft(prev => ({
      ...prev,
      workflowTimestamps: {
        ...(prev.workflowTimestamps || {}),
        cameraActionStartedAt:
          prev.workflowTimestamps?.cameraActionStartedAt ||
          cameraActionStartedAt,
      },
    }));

    const permission =
      await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (!permission.granted) {
      Alert.alert(
        'Photo access needed',
        'Allow photo access to attach project photos.',
      );

      return;
    }

    const result =
      await ImagePicker.launchImageLibraryAsync({
        allowsMultipleSelection: true,
        mediaTypes: ['images'],
        quality: 0.85,
        selectionLimit: 10,
    });

    if (!result.canceled) {
      const photos: UpdatePhoto[] = [];

      try {
        for (const asset of result.assets) {
          photos.push(asLibraryPhoto(withDraftPhotoContext(await photoFromAsset(asset), draftRef.current)));
        }

        // The draft as it is now, not when the button was tapped: a GPS fix
        // may have landed while the camera or picker was open (review pass 2).
        const baseDraft = draftRef.current;
        const nextDraft = {
          ...baseDraft,
          photos: [...baseDraft.photos, ...photos],
          workflowTimestamps: {
            ...(baseDraft.workflowTimestamps || {}),
            cameraActionStartedAt:
              baseDraft.workflowTimestamps?.cameraActionStartedAt ||
              cameraActionStartedAt,
            firstPhotoAddedAt:
              baseDraft.workflowTimestamps?.firstPhotoAddedAt ||
              new Date().toISOString(),
          },
        };
        setDraft(prev => ({
          ...prev,
          photos: [...prev.photos, ...photos.map(photo => withDraftGps(photo, prev))],
          workflowTimestamps: {
            ...(prev.workflowTimestamps || {}),
            cameraActionStartedAt:
              prev.workflowTimestamps?.cameraActionStartedAt ||
              cameraActionStartedAt,
            firstPhotoAddedAt:
              prev.workflowTimestamps?.firstPhotoAddedAt ||
              new Date().toISOString(),
          },
        }));
        void (async () => {
          await waitForDraftLocationCapture();
          await analyzeAddedPhotos(nextDraft, photos);
        })();
      } catch {
        await deleteStoredPhotos(photos);

        Alert.alert(
          'Photos could not be saved',
          'Try choosing the photos again.',
        );
      }
    }
  }

  async function takePhoto(continuityAnchor?: PhotoContinuityAnchor | null) {
    const cameraActionStartedAt = new Date().toISOString();

    setDraft(prev => ({
      ...prev,
      workflowTimestamps: {
        ...(prev.workflowTimestamps || {}),
        cameraActionStartedAt:
          prev.workflowTimestamps?.cameraActionStartedAt ||
          cameraActionStartedAt,
      },
    }));

    const permission =
      await ImagePicker.requestCameraPermissionsAsync();

    if (!permission.granted) {
      Alert.alert(
        'Camera access needed',
        'Allow camera access to take project photos.',
      );

      return;
    }

    const result =
      await ImagePicker.launchCameraAsync({
        mediaTypes: ['images'],
        quality: 0.85,
    });

    if (!result.canceled) {
      const photos: UpdatePhoto[] = [];

      try {
        for (const asset of result.assets) {
          photos.push({
            ...withDraftPhotoContext(await photoFromAsset(asset), draftRef.current),
            continuityAnchor: continuityAnchor || null,
          });
        }

        // The draft as it is now, not when the button was tapped: a GPS fix
        // may have landed while the camera or picker was open (review pass 2).
        const baseDraft = draftRef.current;
        const nextDraft = {
          ...baseDraft,
          photos: [...baseDraft.photos, ...photos],
          workflowTimestamps: {
            ...(baseDraft.workflowTimestamps || {}),
            cameraActionStartedAt:
              baseDraft.workflowTimestamps?.cameraActionStartedAt ||
              cameraActionStartedAt,
            firstPhotoAddedAt:
              baseDraft.workflowTimestamps?.firstPhotoAddedAt ||
              new Date().toISOString(),
          },
        };
        setDraft(prev => ({
          ...prev,
          photos: [...prev.photos, ...photos.map(photo => withDraftGps(photo, prev))],
          workflowTimestamps: {
            ...(prev.workflowTimestamps || {}),
            cameraActionStartedAt:
              prev.workflowTimestamps?.cameraActionStartedAt ||
              cameraActionStartedAt,
            firstPhotoAddedAt:
              prev.workflowTimestamps?.firstPhotoAddedAt ||
              new Date().toISOString(),
          },
        }));
        void (async () => {
          await waitForDraftLocationCapture();
          await analyzeAddedPhotos(nextDraft, photos);
        })();
      } catch {
        await deleteStoredPhotos(photos);

        Alert.alert(
          'Photo could not be saved',
          'Try taking the photo again.',
        );
      }
    }
  }

  function updatePhoto(
    photoId: string,
    next: Partial<UpdatePhoto>,
  ) {
    setDraft(prev => ({
      ...prev,
      photos: prev.photos.map(photo =>
        photo.id === photoId
          ? { ...photo, ...next }
          : photo,
      ),
    }));
  }

  function withDraftPhotoContext(
    photo: UpdatePhoto,
    sourceDraft: ProjectUpdate,
  ): UpdatePhoto {
    // The draft's fix only if recent; the photo's own time, not the fix's
    // (GPS review pass 8: prior-photo ordering reads it).
    return {
      ...photo,
      selectedAreaId: sourceDraft.selectedAreaId ?? null,
      selectedAreaName: sourceDraft.selectedAreaName ?? null,
      ...newPhotoGps(sourceDraft, Date.now()),
      locationCapturedAt: new Date().toISOString(),
      photoIntelligence: buildAnalyzingPhotoIntelligenceState(),
    };
  }

  async function analyzeAddedPhotos(
    updateSnapshot: ProjectUpdate,
    photos: UpdatePhoto[],
  ) {
    for (const addedPhoto of photos) {
      await analyzePhotoWithAuthHydrationRetry({
        update: updateSnapshot,
        photo: addedPhoto,
        priorUpdates: savedUpdates,
      });
    }
  }

  async function analyzePhotoWithAuthHydrationRetry({
    update,
    photo,
    priorUpdates,
    retryAttempt = false,
  }: {
    update: ProjectUpdate;
    photo: UpdatePhoto;
    priorUpdates: ProjectUpdate[];
    retryAttempt?: boolean;
  }) {
    for (let attempt = 0; attempt <= PIE_AUTH_HYDRATION_RETRY_COUNT; attempt += 1) {
      const entityAttempt = photoAnalysisCoordinator.beginAttempt({
        projectId: authorityProjectId(update.projectName),
        updateId: update.id,
        photoId: photo.id,
      });
      let submittedTarget: PhotoAnalysisTarget | null = null;
      const result = await analyzeProjectPhotoWithVision({
        update,
        photo,
        priorUpdates,
        retryAttempt,
        onTargetPrepared: target => {
          submittedTarget = photoAnalysisCoordinator.bindTargetIfCurrent(entityAttempt, target);
        },
      });

      const commit = () => applyPhotoIntelligenceResult(
        authorityProjectId(update.projectName), update.id, photo.id, result,
      );
      if (submittedTarget) {
        photoAnalysisCoordinator.commitIfCurrent(submittedTarget, commit);
      } else {
        photoAnalysisCoordinator.commitAttemptIfCurrent(entityAttempt, commit);
      }

      if (!photoIntelligenceNeedsAuthHydrationRetry(result)) return;
      if (attempt === PIE_AUTH_HYDRATION_RETRY_COUNT) return;

      await waitForPIEAuthHydrationRetry();
    }
  }

  function applyPhotoIntelligenceResult(
    projectId: string,
    updateId: string,
    photoId: string,
    result: PIEPhotoIntelligenceDisplayState,
  ) {
    const applyToUpdate = (update: ProjectUpdate): ProjectUpdate => {
      if (
        update.id !== updateId ||
        authorityProjectId(update.projectName) !== projectId ||
        !update.photos.some(photo => photo.id === photoId)
      ) return update;
      const nextUpdate = {
        ...update,
        photos: update.photos.map(photo =>
          photo.id === photoId
            ? { ...photo, photoIntelligence: result }
            : photo,
        ),
      };
      const summary = summarizePIEStatusForUpdate(nextUpdate);
      const observedFindings = update.observedFindings || [];
      const possibleInterpretations = summary.status === 'complete'
        ? update.possibleInterpretations || []
        : [];

      return {
        ...nextUpdate,
        pieStartedAt: result.status === 'analyzing' ? result.updatedAt : update.pieStartedAt || null,
        pieStatus: summary.status,
        pieSummary: summary.summary,
        observedFindings,
        possibleInterpretations,
        notes: update.notes,
        pieSuggestedNote: update.pieSuggestedNote || null,
        pieSuggestedNoteAccepted: update.pieSuggestedNoteAccepted || false,
        pieCompletedAt:
          summary.status !== 'analyzing'
            ? new Date().toISOString()
            : update.pieCompletedAt || null,
      };
    };

    setDraft(prev => applyToUpdate(prev));
    setSavedUpdates(prev => prev.map(applyToUpdate));
    // A result that arrives after the update synced, or while it syncs, would
    // otherwise stay on this phone and the desktop would show "Analyzing" for
    // good (code review 27 Sep 2026). Queue the update with the result and ask
    // for a sync pass; one already running is followed by one more, so a
    // second result a few seconds later is not left behind (review 28 Sep).
    // Every pass uploads the update's single queue record, so the newest wins.
    // The queue record is written at once, as a save does: until a queued
    // record carries this revision, a realtime echo or a refresh would replace
    // the phone's copy with the older cloud row and lose the result (review
    // pass 6).
    // Known limit (review pass 7): a result that lands while a pass is staging
    // this same update can still be overwritten by that pass's older copy; the
    // queue keeps the last write. Fixing it needs a monotonic local revision in
    // queue writes (see handoff), a sync-protocol change.
    const saved = savedUpdatesRef.current.find(update => update.id === updateId);
    const withResult = saved ? applyToUpdate(saved) : null;
    if (
      saved && withResult && withResult !== saved && result.status !== 'analyzing' &&
      (saved.status === 'sent' || saved.status === 'queued')
    ) {
      const queued: ProjectUpdate = { ...withResult, status: 'queued' };
      upsertSavedUpdateUnlessDeleted(queued);
      void queueProjectUpdateRecord(queued, false).catch(() => undefined).finally(requestQueuedUpdateSync);
    }
  }

  function requestQueuedUpdateSync() {
    if (queuedHydrationInFlight.current) {
      queuedHydrationRerunRequested.current = true;
      return;
    }
    startAutomaticSyncBackgroundTask('late_photo_analysis', hydrateQueuedUpdates);
  }

  function requestPhotoIntelligenceSignIn(update: ProjectUpdate, photo: UpdatePhoto) {
    markPhotoAnalysisRetryRoutedToSignIn(photo.id);
    setPhotoAuthRequest({ update, photo });
    setPhotoAuthMessage(null);
  }

  function closePhotoIntelligenceSignIn() {
    if (photoAuthSubmitting) return;
    setPhotoAuthRequest(null);
    setPhotoAuthPassword('');
    setPhotoAuthMessage(null);
  }

  function dismissAllOverlays() { // a sheet that failed to render closes (audit A2 pass 2)
    closePhotoIntelligenceSignIn(); setPreviewPhoto(null); cancelDocumentProjectSelection(); ecosProjectQuestion.close();
    setTalkVoiceOpen(false); setTalkTypedOpen(false); keptTalkCapture.keep(); setTalkAnswer(null); setTalkTaskAction(null);
    ecosDocumentEvidence.close();
  }

  function markPhotoAnalysisRetryRoutedToSignIn(photoId: string) {
    const applyToUpdate = (update: ProjectUpdate): ProjectUpdate => ({
      ...update,
      photos: update.photos.map(photo => {
        if (photo.id !== photoId || !photo.photoIntelligence?.diagnostics) return photo;

        return {
          ...photo,
          photoIntelligence: {
            ...photo.photoIntelligence,
            diagnostics: {
              ...photo.photoIntelligence.diagnostics,
              retryRoutedToSignIn: true,
              edgeFunctionInvoked: false,
              edgeFunctionStatus: 'not invoked',
            },
          },
        };
      }),
    });

    setDraft(prev => applyToUpdate(prev));
    setSavedUpdates(prev => prev.map(applyToUpdate));
  }

  async function submitPhotoIntelligenceSignIn() {
    if (!photoAuthRequest) return;

    const email = photoAuthEmail.trim();
    if (!email || !photoAuthPassword) {
      setPhotoAuthMessage('Enter your Vitruvius account email and password.');
      return;
    }

    setPhotoAuthSubmitting(true);
    setPhotoAuthMessage(null);

    try {
      const result = await signIn({ email, password: photoAuthPassword });

      if (!result.ok) {
        setPhotoAuthMessage(result.error || 'Sign in failed.');
        return;
      }

      const tokenResult = await getCurrentSessionAccessToken();
      const tokenLookup = tokenResult.data;

      if (!tokenResult.ok || tokenLookup?.status !== 'token_present') {
        setPhotoAuthMessage(
          tokenLookup?.missingReason === 'auth_loading'
            ? PIE_STATUS_COPY.preparingSecureAnalysis
            : tokenLookup?.missingReason === 'expired_session'
              ? PIE_STATUS_COPY.sessionExpired
              : 'Sign in completed, but the session token is not available yet.',
        );
        return;
      }

      const pending = photoAuthRequest;
      setPhotoAuthRequest(null);
      setPhotoAuthPassword('');
      setPhotoAuthMessage(null);
      startAutomaticSyncBackgroundTask('photo_analysis_sign_in', hydrateQueuedUpdates);
      await runPhotoAnalysisRetry(pending.update, pending.photo);
    } finally {
      setPhotoAuthSubmitting(false);
    }
  }

  async function submitPhotoIntelligenceDevelopmentSignUp() {
    if (!photoAuthRequest) return;

    const email = photoAuthEmail.trim();
    if (!email || !photoAuthPassword) {
      setPhotoAuthMessage('Enter an email and password for the development Vitruvius account.');
      return;
    }

    setPhotoAuthSubmitting(true);
    setPhotoAuthMessage(null);

    try {
      const created = await signUp({ email, password: photoAuthPassword });
      let authResult = created;

      if (!created.ok && /already|registered|exists/i.test(created.error || '')) {
        authResult = await signIn({ email, password: photoAuthPassword });
      }

      if (!authResult.ok) {
        setPhotoAuthMessage(authResult.error || 'Development account sign-up failed.');
        return;
      }

      const tokenResult = await getCurrentSessionAccessToken();
      const tokenLookup = tokenResult.data;

      if (!tokenResult.ok || tokenLookup?.status !== 'token_present') {
        setPhotoAuthMessage(
          tokenLookup?.missingReason === 'auth_loading'
            ? PIE_STATUS_COPY.preparingSecureAnalysis
            : 'The development account was created, but the Vitruvius session is not ready. If email confirmation is enabled, confirm the email and sign in.',
        );
        return;
      }

      const pending = photoAuthRequest;
      setPhotoAuthRequest(null);
      setPhotoAuthPassword('');
      setPhotoAuthMessage(null);
      startAutomaticSyncBackgroundTask('photo_analysis_development_sign_up', hydrateQueuedUpdates);
      await runPhotoAnalysisRetry(pending.update, pending.photo);
    } finally {
      setPhotoAuthSubmitting(false);
    }
  }

  async function runPhotoAnalysisRetry(update: ProjectUpdate, photo: UpdatePhoto) {
    applyPhotoIntelligenceResult(
      authorityProjectId(update.projectName),
      update.id,
      photo.id,
      buildAnalyzingPhotoIntelligenceState(),
    );

    await analyzePhotoWithAuthHydrationRetry({
      update,
      photo: {
        ...photo,
        photoIntelligence: buildAnalyzingPhotoIntelligenceState(),
      },
      priorUpdates: savedUpdates.filter(item => item.id !== update.id),
      retryAttempt: true,
    });
  }

  async function retryPhotoAnalysis(update: ProjectUpdate, photo: UpdatePhoto) {
    const tokenResult = await getCurrentSessionAccessToken();
    const tokenLookup = tokenResult.data;

    if (
      !tokenResult.ok ||
      tokenLookup?.missingReason === 'signed_out' ||
      tokenLookup?.missingReason === 'expired_session' ||
      tokenLookup?.missingReason === 'storage_unavailable'
    ) {
      requestPhotoIntelligenceSignIn(update, photo);
      return;
    }

    await runPhotoAnalysisRetry(update, photo);
  }

  function removePhoto(photoId: string) {
    const shownDraft = draftRef.current;
    const deletedPhoto = shownDraft.photos.find(
      photo => photo.id === photoId,
    );
    const nextDraft = {
      ...shownDraft,
      photos: shownDraft.photos.filter(photo => photo.id !== photoId),
    };
    photoAnalysisCoordinator.invalidate({
      projectId: authorityProjectId(shownDraft.projectName),
      updateId: shownDraft.id,
      photoId,
    });

    draftRef.current = nextDraft;
    setDraft(prev => ({
      ...prev,
      photos: prev.photos.filter(
        photo => photo.id !== photoId,
      ),
    }));

    // The draft without the photo is on disk before its file goes: a kill in
    // the 750 ms save window reopened it on a deleted file, and saving it
    // marked the photo missing (whole-app audit A4 pass 6 F5 (30 Sep 2026)).
    if (deletedPhoto) {
      void persistDraftNow(nextDraft).then(() => deleteStoredPhotoIfUnused(
        deletedPhoto.uri, [draftRef.current, ...savedUpdatesRef.current]));
    }
  }

  function movePhoto(
    photoId: string,
    direction: 'up' | 'down',
  ) {
    setDraft(prev => {
      const currentIndex = prev.photos.findIndex(
        photo => photo.id === photoId,
      );

      if (currentIndex < 0) return prev;

      const targetIndex =
        direction === 'up'
          ? currentIndex - 1
          : currentIndex + 1;

      if (
        targetIndex < 0 ||
        targetIndex >= prev.photos.length
      ) {
        return prev;
      }

      const nextPhotos = [...prev.photos];

      [
        nextPhotos[currentIndex],
        nextPhotos[targetIndex],
      ] = [
        nextPhotos[targetIndex],
        nextPhotos[currentIndex],
      ];

      return {
        ...prev,
        photos: nextPhotos,
      };
    });
  }

  async function sendEmail() {
    const hasPlzRecipient = hasPlzCorpRecipient(currentEmails);

    if (hasPlzRecipient) {
      Alert.alert(
        'Use PLZ-approved email',
        'PLZ/Mimecast is blocking this update when it is sent from Yahoo or another personal account. The safest path is to send from Outlook using your PLZ/corporate email. Photos are not attached automatically in Outlook-safe mode.',
        [
          {
            text: 'Open Outlook',
            onPress: () => {
              void openOutlookForPlzEmail();
            },
          },
          {
            text: 'Copy Update',
            onPress: () => {
              void copyPlzEmailFallback();
            },
          },
          {
            text: 'Native Mail Anyway',
            style: 'destructive',
            onPress: () => {
              void composeEmail(false);
            },
          },
          {
            text: 'Cancel',
            style: 'cancel',
          },
        ],
      );

      return;
    }

    const available = await MailComposer.isAvailableAsync();

    if (!available) {
      Alert.alert(
        'Email unavailable',
        'Email composition is not available on this device.',
      );

      return;
    }

    if (!currentEmails.length) {
      Alert.alert(
        'No email recipients selected',
        'Select recipients for this update, or continue and enter recipients manually in Mail.',
        [
          {
            text: 'Select Recipients',
            onPress: openContacts,
          },
          {
            text: 'Continue',
            onPress: () => {
              void composeEmail();
            },
          },
          {
            text: 'Cancel',
            style: 'cancel',
          },
        ],
      );

      return;
    }

    await composeEmail();
  }

  async function sendText() {
    const available = await SMS.isAvailableAsync();

    if (!available) {
      Alert.alert(
        'Text unavailable',
        'SMS is not available on this device.',
      );

      return;
    }

    if (!currentPhones.length) {
      Alert.alert(
        'No text recipients selected',
        'Select recipients for this update, or continue and enter recipients manually in Messages.',
        [
          {
            text: 'Select Recipients',
            onPress: openContacts,
          },
          {
            text: 'Continue',
            onPress: () => {
              void sendTextWithAttachments();
            },
          },
          {
            text: 'Cancel',
            style: 'cancel',
          },
        ],
      );

      return;
    }

    await sendTextWithAttachments();
  }

  async function sendTextWithAttachments() {
    try {
      const attachments =
        await buildSmsAttachments(draft.photos);

      await SMS.sendSMSAsync(
        currentPhones,
        `${message.subject}\n\n${message.body}`,
        attachments.length
          ? { attachments }
          : undefined,
      );
    } catch {
      Alert.alert(
        'Photos could not be attached',
        'Try Send Email, or pick the photos again and retry.',
      );
    }
  }

  async function copyMessage() {
    await Clipboard.setStringAsync(
      buildGeneratedUpdateMessage(draft, summarizePIEStatusForUpdate(draft)),
    );

    Alert.alert(
      'Copied',
      'The update message is ready to paste.',
    );
  }

  // Audit P1-40: every report communication returns its real outcome so the
  // UI marks communication complete only when it actually happened. A canceled
  // or undetermined composer result must never read as "sent".
  async function copyReport(report: PIEReportDraft): Promise<ReportCommunicationOutcome> {
    await Clipboard.setStringAsync(
      `${report.title}\n\n${report.body}`,
    );

    Alert.alert(
      'Report copied',
      'The approved report is ready to paste.',
    );
    return 'completed';
  }

  async function emailReport(report: PIEReportDraft): Promise<ReportCommunicationOutcome> {
    const available = await MailComposer.isAvailableAsync();

    if (!available) {
      await Clipboard.setStringAsync(`${report.title}\n\n${report.body}`);
      Alert.alert(
        'Email unavailable',
        'The report was copied instead. Open your email app and paste it into a new message.',
      );
      // The report is on the clipboard to be pasted and sent, as Copy Report leaves it (audit A6 pass 3).
      return 'completed';
    }

    // The text cites "See Image N"; the images go with it (review 27 Sep 2026).
    // A body without citations (the executive format, or an edited body)
    // takes no images and no "not attached" note (whole-app audit A6).
    const images = await reportImageFiles(reportBodyCitesImages(report) ? report : { ...report, locationGroups: [] }, REPORT_EMAIL_IMAGE_LIMIT);
    const compose = (attachments: string[], note: string) => MailComposer.composeAsync({
      subject: report.subject || report.title,
      body: report.body + note,
      attachments,
    });
    // An unreadable attachment makes the composer throw before it opens; send
    // the text alone then. A real send failure is not retried.
    const attachments = images.photos.map(photo => photo.uri);
    const result = await compose(attachments, images.note).catch(error => {
      if (attachments.length === 0 || !isAttachmentReadError(error)) throw error;
      return compose([], `\n\n${REPORT_IMAGES_NOT_ATTACHED}`);
    });
    return mailComposerOutcome(result.status);
  }

  /** Whether the body as it will be sent still cites "See Image N" (an edited body may not). The executive body numbers no images, so "see image 4" there is the owner's own note (audit A6 pass 5). */
  function reportBodyCitesImages(report: PIEReportDraft): boolean {
    return reportFormat !== 'executive' && /\bSee Images?\s+\d/i.test(report.body);
  }

  async function reportImageFiles(report: PIEReportDraft, limit: number) {
    return resolveReportImageAttachments<UpdatePhoto>({
      report,
      limit,
      maxTotalBytes: REPORT_MESSAGE_IMAGE_BYTES,
      sizeOf: async photo => {
        const info = await FileSystem.getInfoAsync(photo.uri);
        return info.exists && 'size' in info && typeof info.size === 'number' ? info.size : null;
      },
      findPhoto: async photoId => {
        const update = activeSavedUpdates.find(candidate => candidate.photos.some(photo => photo.id === photoId));
        if (!update) return null;
        // Only the cited photo is fetched, not every cloud-only photo of its
        // update (review pass 4).
        const cited = update.photos.filter(photo => photo.id === photoId);
        return (await hydrateRecoveredProjectUpdatePhotos({ ...update, photos: cited })).photos[0] ?? null;
      },
    });
  }

  async function textReport(report: PIEReportDraft): Promise<ReportCommunicationOutcome> {
    const available = await SMS.isAvailableAsync();

    if (!available) {
      await Clipboard.setStringAsync(`${report.title}\n\n${report.body}`);
      Alert.alert(
        'Text unavailable',
        'The report was copied instead. Open Messages and paste it into a new text.',
      );
      return 'completed';
    }

    const images = await reportImageFiles(reportBodyCitesImages(report) ? report : { ...report, locationGroups: [] }, REPORT_TEXT_IMAGE_LIMIT);
    const reportText = `${report.title}\n\n${report.body}`;
    const textOnly = () => SMS.sendSMSAsync([], `${reportText}\n\n${REPORT_IMAGES_NOT_ATTACHED}`);
    const attachments = await buildSmsAttachments(images.photos).catch(() => null);
    const { result } = attachments === null
      ? await textOnly()
      : await SMS.sendSMSAsync([], `${reportText}${images.note}`, { attachments }).catch(error => {
        if (attachments.length === 0 || !isAttachmentReadError(error)) throw error;
        return textOnly();
      });
    return smsComposerOutcome(result);
  }

  // PLZ email security (Mimecast) rejects report email sent from a personal
  // account: on 29 Sep a report reached Gmail but not the work address.
  // Outlook sends from the work account, and the Word report carries the
  // report and its photos; the text is copied for the message body.
  async function outlookReport(
    report: PIEReportDraft,
    drawingReferences: readonly ReportDrawingReference[],
  ): Promise<ReportCommunicationOutcome> {
    await Clipboard.setStringAsync(`${report.title}\n\n${report.body}`);
    const proceed = await askToContinue(
      'Send from Outlook',
      'Next, choose Outlook in the share screen and send from your work account. The Word report with its photos is attached, and the report text is copied: paste it into the message.',
      'Continue',
    );
    if (!proceed) return 'canceled';
    const shared = await shareWordReport(report, drawingReferences, 'Choose Outlook to send from your work account');
    if (!shared) return 'unknown';
    // The share sheet closes the same way whether the mail was sent, the
    // file was saved or the sheet was dismissed: only the owner knows
    // (audit A6 pass 3: a dismissed sheet started the next reporting period).
    const sent = await askToContinue(
      'Was the report sent?',
      'If you sent it from Outlook, the next report will run from this one. If not, nothing is recorded and you can send it later.',
      'Yes, it was sent',
      'Not yet',
    );
    return sent ? 'completed' : 'unknown';
  }

  /** Saving or opening the Word file is not a delivery (audit A6 pass 3). */
  async function downloadWordReport(
    report: PIEReportDraft,
    drawingReferences: readonly ReportDrawingReference[],
  ): Promise<ReportCommunicationOutcome> {
    await shareWordReport(report, drawingReferences, 'Open or save the Word report');
    return 'unknown';
  }

  /** Builds the Word report and offers it through the share sheet; true when the sheet was shown. */
  async function shareWordReport(
    report: PIEReportDraft,
    drawingReferences: readonly ReportDrawingReference[],
    shareTitle: string,
  ): Promise<boolean> {
    const sharingAvailable = await Sharing.isAvailableAsync();
    if (!sharingAvailable) {
      Alert.alert(
        'Word report unavailable',
        'The iOS Share Sheet is not available on this device.',
      );
      return false;
    }

    const directory = FileSystem.cacheDirectory || FileSystem.documentDirectory;
    if (!directory) {
      Alert.alert(
        'Word report unavailable',
        'A temporary folder could not be found on this device.',
      );
      return false;
    }

    // No photo appendix for a body that cites no image (the executive
    // format, or an edited body): as email and text (audit A6, pass 2).
    const reportPhotoNumbers = new Map(
      reportBodyCitesImages(report)
        ? report.locationGroups.flatMap(group =>
            group.workAreas.flatMap(area =>
              area.imageReferences.map(reference => [
                reference.photoId,
                reference.imageNumber,
              ] as const)))
        : [],
    );
    // In the order the report text numbers them, so the Word file's "Photo
    // 3" is the body's "Image 3" whether or not its file is present
    // (whole-app audit A6, 29 Sep 2026).
    const reportPhotoIds = [...reportPhotoNumbers.keys()].sort(
      (left, right) => (reportPhotoNumbers.get(left) ?? 0) - (reportPhotoNumbers.get(right) ?? 0),
    );
    const reportPhotoIdSet = new Set(reportPhotoIds);
    const relevantUpdates = activeSavedUpdates.filter(update =>
      update.photos.some(photo => reportPhotoIdSet.has(photo.id)));
    // Only the cited photos are fetched, not every cloud-only photo of their
    // updates, as the email path already does (audit A6).
    const hydratedUpdates = await Promise.all(
      relevantUpdates.map(update => hydrateRecoveredProjectUpdatePhotos({
        ...update,
        photos: update.photos.filter(photo => reportPhotoIdSet.has(photo.id)),
      })),
    );
    const readableDrawingReferences = await Promise.all(
      drawingReferences.map(async reference => {
        try {
          const readableDocument =
            await ensureVerifiedReferenceDocumentBytes(reference.excerpt.document);
          return {
            ...reference,
            excerpt: {
              ...reference.excerpt,
              document: readableDocument,
            },
          };
        } catch {
          return reference;
        }
      }),
    );
    const resolvedMedia = await resolveNativeReportWordMedia({
      updates: hydratedUpdates as unknown as Parameters<
        typeof resolveNativeReportWordMedia
      >[0]['updates'],
      reportPhotoIds,
      drawingReferences: readableDrawingReferences,
    });
    const fileUri =
      `${directory}${sanitizeFilename(report.title || 'Vitruvius Project Report')}.docx`;

    try {
      const {
        buildReportWordBase64,
        summarizeReportWordUnavailableMedia,
      } = await import('./services/ReportWordDocument');
      const base64 = await buildReportWordBase64({
        title: report.title,
        body: report.body,
        generatedAt: report.generatedAt,
        media: resolvedMedia.media.map(item => item.kind === 'photo'
          ? {
            ...item,
            displayNumber: reportPhotoNumbers.get(item.id) || null,
          }
          : item),
        unavailableMedia: resolvedMedia.unavailableMedia,
      });
      await FileSystem.writeAsStringAsync(fileUri, base64, {
        encoding: FileSystem.EncodingType.Base64,
      });
      await Sharing.shareAsync(fileUri, {
        dialogTitle: shareTitle,
        mimeType:
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        UTI: 'org.openxmlformats.wordprocessingml.document',
      });

      const unavailable = resolvedMedia.unavailableMedia.length;
      if (unavailable > 0) {
        const unavailableDetail = unavailable === 1
          ? `\n\n${resolvedMedia.unavailableMedia[0].label}: ${resolvedMedia.unavailableMedia[0].reason}`
          : '';
        // Read before anything else is asked (audit A6 pass 4: the Outlook
        // question opened on top of this notice).
        await new Promise<void>(resolve => Alert.alert(
          'Word report prepared',
          `${summarizeReportWordUnavailableMedia(resolvedMedia.unavailableMedia)}` +
            `${unavailableDetail}\n\nEach unavailable source image is listed in Media Requiring Review.`,
          [{ text: 'OK', onPress: () => resolve() }],
          { cancelable: true, onDismiss: () => resolve() },
        ));
      }
      return true;
    } catch (error) {
      Alert.alert(
        'Word report unavailable',
        error instanceof Error && error.message.trim()
          ? error.message.trim()
          : 'The Word report could not be prepared from the current project files.',
      );
      return false;
    } finally {
      await FileSystem.deleteAsync(fileUri, { idempotent: true }).catch(() => undefined);
    }
  }

  async function resolveReportDrawingPreview(
    reference: ReportDrawingReference,
  ): Promise<string | null> {
    try {
      const readableDocument =
        await ensureVerifiedReferenceDocumentBytes(reference.excerpt.document);
      return await renderNativeReportDrawingPreview({
        ...reference,
        excerpt: {
          ...reference.excerpt,
          document: readableDocument,
        },
      });
    } catch {
      return null;
    }
  }

  async function resolveReportPhotoPreview(photoId: string): Promise<string | null> {
    const update = activeSavedUpdates.find(candidate =>
      candidate.photos.some(photo => photo.id === photoId));
    if (!update) return null;
    try { // only the requested photo, as email and Word fetch (audit A6 pass 6)
      const hydrated = await hydrateRecoveredProjectUpdatePhotos({ ...update, photos: update.photos.filter(photo => photo.id === photoId) });
      return hydrated.photos[0]?.uri?.trim() || null;
    } catch {
      return null;
    }
  }

  async function openSystemShareSheet() {
    const available = await Sharing.isAvailableAsync();

    if (!available) {
      Alert.alert('Share unavailable', 'The iOS Share Sheet is not available on this device.');
      return;
    }

    const targetDirectory =
      FileSystem.cacheDirectory || FileSystem.documentDirectory;

    if (!targetDirectory) {
      Alert.alert('Share unavailable', 'A temporary folder could not be found.');
      return;
    }

    const pieSummary = summarizePIEStatusForUpdate(draft);
    const fileUri = `${targetDirectory}field-update-${draft.id}.txt`;

    await FileSystem.writeAsStringAsync(
      fileUri,
      buildGeneratedUpdateMessage(draft, pieSummary),
    );

    await Sharing.shareAsync(fileUri, {
      dialogTitle: 'Share Field Update',
      mimeType: 'text/plain',
      UTI: 'public.plain-text',
    });
  }

  async function prepareUpdateForCompleteBackup(
    update: ProjectUpdate,
    assetPrefix: string,
    sources: CompleteBackupAssetSource[],
    includeFiles: boolean,
    unavailablePhotos: UnavailableBackupPhoto[] = [],
  ): Promise<ProjectUpdate> {
    const hydrated = await hydrateRecoveredProjectUpdatePhotos(update);
    const photos = [];
    for (const photo of hydrated.photos) {
      const assetId = `photo:${assetPrefix}:${photo.id}`;
      const source = includeFiles ? await measureBackupAssetSource(expoBackupFileIO, {
        id: assetId,
        kind: 'photo',
        relativePath: sanitizeFilename(photo.fileName || filenameFromUri(
          photo.uri,
          sources.length,
          photo.mimeType || 'image/jpeg',
        )),
        uri: photo.uri,
      }) : null;
      // Records-only, or a photo on neither this device nor the cloud, keeps
      // the photo's metadata with no bytes and no asset id, so a restore never
      // looks for a file this archive does not have.
      if (!source) {
        // A photo with a cloud copy is restored from it. One with neither a
        // file in this archive nor a cloud copy (records-only, or the file
        // is gone) is declared unavailable, so the owner is told and the
        // restore accepts the archive and drops that photo, instead of
        // refusing the whole backup (whole-app audit A7, 30 Sep 2026).
        if (photo.cloudStoragePath?.trim()) {
          // The lookup above stamps a derived path even when it finds
          // nothing (offline, or the object is gone): the record keeps the
          // path so a later restore can look again, and the owner is told
          // now (audit A7 pass 2: these were counted as cloud copies).
          if (photo.cloudRecoveryStatus === 'unavailable') {
            unavailablePhotos.push({ projectName: update.projectName, updateDate: update.date, reason: 'cloud_unconfirmed' });
          }
          photos.push({ ...photo, uri: '' });
          continue;
        }
        unavailablePhotos.push({ projectName: update.projectName, updateDate: update.date, reason: 'only_on_this_phone' });
        photos.push(markPhotoUnavailableInBackup(photo));
        continue;
      }
      sources.push(source);
      photos.push({
        ...photo,
        uri: '',
        _backupAssetId: assetId,
      });
    }
    return {
      ...hydrated,
      photos,
    } as ProjectUpdate;
  }

  const askToContinue = (title: string, message: string, continueLabel: string, cancelLabel = 'Cancel') => new Promise<boolean>(resolve => Alert.alert(
    title, message,
    [{ text: cancelLabel, style: 'cancel', onPress: () => resolve(false) }, { text: continueLabel, onPress: () => resolve(true) }],
    { cancelable: true, onDismiss: () => resolve(false) },
  ));

  // Backup and restore each take minutes on the phone: keep the screen on so
  // the app is not suspended part-way.
  const withBackupKeepAwake = async <T,>(work: () => Promise<T>): Promise<T> => {
    await activateKeepAwakeAsync(BACKUP_KEEP_AWAKE_TAG).catch(() => undefined);
    try { return await work(); } finally { await deactivateKeepAwake(BACKUP_KEEP_AWAKE_TAG).catch(() => undefined); }
  };

  async function exportBackup(passphrase: string, includeFiles = true, onProgress?: (message: string) => void) {
    if (passphrase.trim().length < COMPLETE_BACKUP_MINIMUM_PASSPHRASE_LENGTH) {
      Alert.alert(
        'Passphrase required',
        `Use a backup passphrase with at least ${COMPLETE_BACKUP_MINIMUM_PASSPHRASE_LENGTH} characters.`,
      );
      return;
    }
    const targetDirectory = FileSystem.cacheDirectory;
    if (!targetDirectory) {
      Alert.alert(
        'Device backup unavailable',
        'A temporary app folder for the encrypted backup could not be found.',
      );
      return;
    }
    if (!(await Sharing.isAvailableAsync())) {
      Alert.alert(
        'Device backup sharing unavailable',
        'The Share Sheet is unavailable on this device, so no backup was written.',
      );
      return;
    }

    const fileStem = `vitruvius-device-${includeFiles ? 'backup' : 'records'}-${isoToday()}`;
    const fileUri = `${targetDirectory}${fileStem}.vitruvius-backup`;

    try {
      // Encrypting a part takes minutes on the phone: keep the screen on so
      // the app is not suspended before its save screen can open.
      if (includeFiles) await activateKeepAwakeAsync(BACKUP_KEEP_AWAKE_TAG).catch(() => undefined);
      onProgress?.('Checking photos and documents for the backup…');
      // Files are described here and read one backup part at a time later,
      // so the full backup never holds every photo in memory at once.
      const sources: CompleteBackupAssetSource[] = [];
      const unavailablePhotos: UnavailableBackupPhoto[] = [];
      const backupUpdates = [];
      for (const update of savedUpdates) {
        backupUpdates.push(await prepareUpdateForCompleteBackup(
          update,
          `update:${update.id}`,
          sources,
          includeFiles,
          unavailablePhotos,
        ));
      }
      // A document whose file cannot be read now is kept as a record without
      // its file, like records-only, and only with the owner's agreement,
      // which is asked before anything is written.
      const unavailableDocuments: UnavailableBackupDocument[] = [];
      const leaveOut = (name: string, error?: unknown) => {
        unavailableDocuments.push({ name, reason: error instanceof Error && error.message ? error.message : 'Its file could not be found on this device.' });
        return null;
      };
      const backupReferenceDocuments = [];
      for (const document of referenceDocuments) {
        const assetId = `reference_document:${document.id}`;
        const inDriveOnly = document.sourceProvider === 'google_drive' && !document.storagePath;
        const readable = includeFiles ? await ensureVerifiedReferenceDocumentBytes(document).catch(error => leaveOut(document.name, inDriveOnly
          ? new Error('Its file is kept in Google Drive, not in Vitruvius storage, so this phone cannot copy it.') : error)) : null;
        const source = readable ? await measureBackupAssetSource(expoBackupFileIO, {
          id: assetId,
          kind: 'reference_document',
          relativePath: sanitizeFilename(document.originalFileName),
          uri: readable.uri,
        }) : null;
        if (!source) {
          if (readable) leaveOut(document.name);
          backupReferenceDocuments.push({ ...(readable ?? document), uri: '' });
          continue;
        }
        sources.push(source);
        backupReferenceDocuments.push({ ...readable, uri: '', _backupAssetId: assetId });
      }
      const backupProjectDocuments = [];
      for (const document of projectDocuments) {
        const assetId = `project_document:${document.id}`;
        const readable = includeFiles ? await ensureVerifiedProjectDocumentBytes(document).catch(error => leaveOut(document.name, error)) : null;
        const source = readable?.localUri ? await measureBackupAssetSource(expoBackupFileIO, {
          id: assetId,
          kind: 'project_document',
          relativePath: sanitizeFilename(document.name),
          uri: readable.localUri,
        }) : null;
        const withoutFile = { localUri: null, ownedFileId: null, ownedFileManifest: null };
        if (!source) {
          if (readable) leaveOut(document.name);
          backupProjectDocuments.push({ ...(readable ?? document), ...withoutFile });
          continue;
        }
        sources.push(source);
        backupProjectDocuments.push({ ...readable, ...withoutFile, _backupAssetId: assetId });
      }
      const backupDraft = hasMeaningfulDraft(draft)
        ? await prepareUpdateForCompleteBackup(
            draft,
            `draft:${draft.id}`,
            sources,
            includeFiles,
            unavailablePhotos,
          )
        : null;
      const backup = {
        version: APP_BACKUP_VERSION,
        exportedAt: new Date().toISOString(),
        savedUpdates: backupUpdates,
        projects,
        // Full records (id, cover photo, project data) so a restore on a new
        // phone keeps project identity instead of rebuilding name-only rows.
        // Cover photo local cache paths are device-specific; the cover is
        // fetched again from its remotePath after restore.
        projectRecords: projectRecords.map(record => ({
          ...record,
          coverPhoto: record.coverPhoto ? { ...record.coverPhoto, localUri: null } : record.coverPhoto ?? null,
        })),
        archivedProjects,
        contacts: contactBook,
        projectAreas,
        referenceDocuments: backupReferenceDocuments,
        projectDocuments: backupProjectDocuments,
        scheduleItems,
        captureMemories,
        activeDraft: backupDraft
          ? {
              draft: backupDraft,
              savedAt: draftSavedAt || new Date().toISOString(),
            }
          : null,
      };
      // What is about to be written must restore: the same check the
      // restore runs, before anything is encrypted (audit A7).
      const restorable = normalizeBackupData(backup, { archive: true });
      if (!restorable.ok) {
        onProgress?.('Backup not written.');
        Alert.alert('Backup not written', `This backup would not restore: ${restorable.message}`);
        return;
      }
      if (!includeFiles && unavailablePhotos.length > 0) {
        // Records-only carries no files: photos not yet in the cloud will
        // not be in this backup, and the owner decides with that known.
        const proceed = await askToContinue(
          'Some photos are not in this backup',
          unavailablePhotosNotice(unavailablePhotos, { recordsOnly: true }),
          'Back up without them',
        );
        if (!proceed) {
          onProgress?.('Backup not written.');
          return;
        }
      }
      const randomBytes = (length: number) => Crypto.getRandomBytesAsync(length);

      if (!includeFiles) {
        // Records-only carries no files, so it stays the single archive it
        // has always been.
        const archive = await createCompleteBackupArchive({
          state: backup,
          assets: [],
          passphrase,
          createdAt: new Date().toISOString(),
        }, { randomBytes });
        const serialized = JSON.stringify(archive);
        assertBackupSerializedFits(serialized);
        await FileSystem.writeAsStringAsync(fileUri, serialized);
        await Sharing.shareAsync(fileUri, {
          dialogTitle: 'Export Limited Vitruvius Device Backup',
          mimeType: 'application/vnd.vitruvius.backup+json',
          UTI: 'public.data',
        });
        Alert.alert(
          'Backup share sheet closed',
          `${DEVICE_BACKUP_SCOPE_NOTICE} Confirm that the file was saved in your chosen destination. Store the backup and its passphrase separately; Vitruvius cannot recover a forgotten passphrase.`,
        );
        return;
      }

      const exported = await exportBackupInParts({
        state: backup,
        sources,
        passphrase,
        createdAt: new Date().toISOString(),
        backupId: uid(),
        directory: targetDirectory,
        fileStem,
        unavailablePhotos,
        unavailableDocuments,
      }, {
        io: expoBackupFileIO,
        randomBytes,
        confirmUnavailableFiles: notice => askToContinue('Some files are unavailable', notice, 'Back up without them'),
        onProgress,
        confirmPartCount: partCount => askToContinue(`Backup needs ${partCount} files`, multiPartBackupNotice(partCount), 'Continue'),
        share: (uri, partNumber, partCount) => Sharing.shareAsync(uri, {
          dialogTitle: partCount === 1
            ? 'Export Limited Vitruvius Device Backup'
            : `Save backup part ${partNumber} of ${partCount}`,
          mimeType: 'application/vnd.vitruvius.backup+json',
          UTI: 'public.data',
        }),
      });
      onProgress?.(exported.status === 'cancelled' ? 'Backup cancelled. Nothing was saved.' : `Backup finished: ${exported.partCount} file(s) shared.`);
      if (exported.status === 'cancelled') return;
      Alert.alert(
        'Backup share sheet closed',
        `${DEVICE_BACKUP_SCOPE_NOTICE} Confirm that the file was saved in your chosen destination${
          exported.partCount > 1 ? `: all ${exported.partCount} parts, in one place` : ''
        }.${unavailablePhotos.length + unavailableDocuments.length ? ` ${unavailablePhotos.length + unavailableDocuments.length} unavailable file(s) were left out.` : ''} Store the backup and its passphrase separately; Vitruvius cannot recover a forgotten passphrase.`,
      );
    } catch (error) {
      onProgress?.('Backup did not finish.');
      Alert.alert(
        'Device backup failed',
        error instanceof Error
          ? error.message
          : 'The encrypted backup could not be created.',
      );
    } finally {
      await FileSystem.deleteAsync(fileUri, { idempotent: true }).catch(() => undefined);
      if (includeFiles) await deactivateKeepAwake(BACKUP_KEEP_AWAKE_TAG).catch(() => undefined);
    }
  }

  async function applyRestoredData(data: RestoredAppData): Promise<boolean> {
    if (backupRestoreInFlightRef.current) return false;
    backupRestoreInFlightRef.current = true;
    if (savedUpdatesSaveTimer.current) {
      clearTimeout(savedUpdatesSaveTimer.current); savedUpdatesSaveTimer.current = null;
    }
    if (draftSaveTimer.current) {
      clearTimeout(draftSaveTimer.current); draftSaveTimer.current = null;
    }

    try {
      const restored = await backupRestoreRuntime.commit(barriers => {
        const result = buildDeletionSafeRestoreState({
          data, barriers, currentProjectRecords: projectRecords,
          rebuildProjectRecords: restoreProjectRecords,
          referenceDocumentBelongsToProject: (document, name) =>
            referenceDocumentMatchesDeletedProject(document, name, authorityProjectId(name)),
          projectDocumentBelongsToProject: projectDocumentMatchesProject,
          scheduleItemBelongsToProject: scheduleItemMatchesDeletedProject,
          captureMemoryBelongsToProject: (memory, name) =>
            (memory.recommendedProject.value || '').trim().toLowerCase() === name.trim().toLowerCase(),
          serializeCaptureMemories: captureMemoryRepositoryStorageValue,
          createEmptyDraft: createDraft,
        });
        return { values: result.values, result };
      });

      operationalRefreshCommitGuard.invalidate(); // a refresh read before it commits nothing (whole-app audit A4 pass 6 F3 (30 Sep 2026))
      savedUpdatesRef.current = restored.savedUpdates; draftRef.current = restored.draft;
      setSavedUpdates(restored.savedUpdates); setProjectRecords(restored.projectRecords);
      setProjects(restored.projects); setArchivedProjects(restored.archivedProjects);
      setContactBook(restored.contactBook); setProjectAreas(restored.projectAreas);
      setReferenceDocuments(restored.referenceDocuments); setProjectDocuments(restored.projectDocuments);
      setScheduleItems(restored.scheduleItems); setCaptureMemories(restored.captureMemories);
      setDraft(restored.draft);
      markProjectAreasAuthorityReady(true); markReferenceDocumentsAuthorityReady(true); markScheduleItemsAuthorityReady(true);
      setDraftSavedAt(restored.storedDraft?.savedAt || null); setSelectedWorkspaceProject(restored.activeProject);
      Alert.alert(
        'Device backup restored',
        `${DEVICE_BACKUP_RESTORE_NOTICE} Included project data, photos, documents, and confirmed Core memories were decrypted, verified, and restored. Existing deletion records and queued deletions remain enforced.`,
      );
      return true;
    } catch (error) {
      const recoveryBlocked = error instanceof BackupRestoreRecoveryRequiredError;
      if (recoveryBlocked) {
        startupHydration.fail(PROJECTS_STORAGE_KEY, 'backup restore recovery', error);
      }
      Alert.alert(
        recoveryBlocked ? 'Restore recovery required' : 'Restore failed',
        recoveryBlocked
          ? 'The restore was partially written and editing is locked until Retry Recovery succeeds or the app restarts.'
          : 'The backup could not be safely restored. Existing app data and deletion records were not intentionally replaced.',
      );
      return false;
    } finally {
      backupRestoreInFlightRef.current = false;
    }
  }

  async function restoreBackup(passphrase: string, onProgress?: (message: string) => void) {
    if (passphrase.trim().length < COMPLETE_BACKUP_MINIMUM_PASSPHRASE_LENGTH) {
      Alert.alert(
        'Passphrase required',
        `Use the backup passphrase with at least ${COMPLETE_BACKUP_MINIMUM_PASSPHRASE_LENGTH} characters.`,
      );
      return;
    }
    try {
      // A large backup is several part files; select every part at once.
      const result = await DocumentPicker.getDocumentAsync({
        type: ['application/vnd.vitruvius.backup+json', 'application/json', '*/*'],
        copyToCacheDirectory: true,
        multiple: true,
      });

      if (result.canceled) return;

      if (result.assets.length === 0) {
        Alert.alert(
          'Restore failed',
          'No complete Vitruvius backup was selected.',
        );

        return;
      }

      for (const file of result.assets) {
        const fileInfo = await FileSystem.getInfoAsync(file.uri);
        if (isOversizedBackup(file.size) || (
          fileInfo.exists &&
          'size' in fileInfo &&
          isOversizedBackup(fileInfo.size)
        )) {
          Alert.alert(
            'Device backup too large',
            'Choose an encrypted Vitruvius device backup, or backup part, smaller than 128 MB.',
          );

          return;
        }
      }

      const opened = await withBackupKeepAwake(() => openSelectedBackup(
        result.assets.map(file => file.uri),
        passphrase,
        expoBackupFileIO,
        onProgress,
      ));
      const preflight = normalizeBackupData(opened.state, { archive: true });

      if (!preflight.ok) {
        onProgress?.('Restore did not finish.');
        Alert.alert(
          preflight.reason === 'incompatible_version'
            ? 'Incompatible backup'
            : 'Invalid backup',
          preflight.message,
        );
        return;
      }

      Alert.alert(
        'Restore this limited device backup?',
        `${DEVICE_BACKUP_RESTORE_NOTICE} This replaces saved projects, updates, schedules, contacts, photos, documents, and the active draft on this device. Existing deletion records and queued deletions remain enforced.`,
        [
          {
            text: 'Cancel',
            style: 'cancel',
            onPress: () => onProgress?.('Restore cancelled. Nothing was changed.'),
          },
          {
            text: 'Restore',
            style: 'destructive',
            onPress: () => {
              void withBackupKeepAwake(async () => {
                if (!FileSystem.cacheDirectory) {
                  throw new Error('A temporary app folder for the restore could not be found.');
                }
                // Parts are decrypted one at a time into a staging folder;
                // nothing on the device is replaced until every part verified.
                const staged = opened.kind === 'parts'
                  ? await opened.stageAssets(`${FileSystem.cacheDirectory}backup-restore-${uid()}/`)
                  : null;
                try {
                  const materialized = await materializeCompleteBackupState(
                    opened.state,
                    opened.kind === 'single'
                      ? decryptedBytesAssetProvider(opened.decrypted, expoBackupFileIO)
                      : stagedAssetProvider(staged!, expoBackupFileIO),
                    {
                      io: expoBackupFileIO,
                      newId: uid,
                      sanitizeFilename,
                      photoDirectory: ensurePhotoStorageDirectory,
                      referenceDocumentsDirectory: ensureReferenceDocumentsDirectory,
                      ownedProjectDocumentsRoot: OWNED_PROJECT_DOCUMENTS_DIR,
                      cacheDirectory: FileSystem.cacheDirectory,
                      importProjectDocument: importProjectDocumentIntoOwnedStorage,
                    },
                  );
                  // Carried photos have their files now; photos declared
                  // unavailable are accepted here and dropped by normalizeUpdate.
                  const normalized = normalizeBackupData(materialized.state, { archive: true });
                  if (!normalized.ok) {
                    await materialized.cleanup();
                    onProgress?.('Restore did not finish.');
                    Alert.alert('Restore failed', normalized.message);
                    return;
                  }
                  const committed = await applyRestoredData(normalized.data);
                  if (!committed) await materialized.cleanup();
                  onProgress?.(committed ? 'Restore finished.' : 'Restore did not finish.');
                } finally {
                  await staged?.cleanup();
                }
              }).catch(error => {
                onProgress?.('Restore did not finish.');
                Alert.alert(
                  'Restore failed',
                  error instanceof Error
                    ? error.message
                    : 'The device backup could not be safely restored.',
                );
              });
            },
          },
        ],
      );
    } catch (error) {
      onProgress?.('Restore did not finish.');
      Alert.alert(
        'Restore failed',
        error instanceof Error
          ? error.message
          : 'The selected file could not be verified as a complete Vitruvius backup.',
      );
    }
  }


  async function importReferenceDocument() {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['application/pdf', 'image/*'],
        copyToCacheDirectory: true,
      });

      if (result.canceled) return;

      const asset = result.assets[0];

      if (!asset) {
        Alert.alert('Import failed', 'No document was selected.');
        return;
      }
      await preflightExpoFileRead({ uri: asset.uri, reportedSizeBytes: asset.size });

      const directory = await ensureReferenceDocumentsDirectory();
      const originalFileName = filenameFromDocumentAsset(asset);
      const storedFileName = `${uid()}-${sanitizeFilename(originalFileName)}`;
      const targetUri = `${directory}${storedFileName}`;

      await FileSystem.copyAsync({
        from: asset.uri,
        to: targetUri,
      });

      const integrity = await hashExpoFileSha256({
        uri: targetUri,
        maxBytes: MAX_PROJECT_DOCUMENT_FILE_BYTES,
      });

      const extraction = await extractECOSMobileDocument({
        uri: targetUri,
        mimeType: asset.mimeType,
        fileName: originalFileName,
      });

      const nextDocument = normalizeReferenceDocument({
        id: uid(),
        name: originalFileName.replace(/\.[^/.]+$/, ''),
        originalFileName,
        uri: targetUri,
        mimeType: asset.mimeType || null,
        category: 'Other',
        notes: '',
        isCurrent: false,
        importedAt: new Date().toISOString(),
        sizeBytes: integrity.sizeBytes,
        contentSha256: integrity.sha256,
        ...extraction,
        indexedContentSha256: integrity.sha256,
      });

      markReferenceDocumentsAuthorityReady(true);
      referenceDocumentsCurrentRef.current = [
        nextDocument,
        ...referenceDocumentsCurrentRef.current,
      ];
      setReferenceDocuments(referenceDocumentsCurrentRef.current);
      void queueReferenceDocumentRecord(nextDocument);

      Alert.alert(
        'Document imported',
        extraction.extractionStatus === 'complete' || extraction.extractionStatus === 'partial'
          ? `${nextDocument.name} was saved and its searchable text was indexed. Mark the correct revision Current before Core uses it.`
          : `${nextDocument.name} was saved. Mark the correct revision Current before Core uses it.`,
      );
    } catch (error) {
      Alert.alert('Import failed', error instanceof FileSizePreflightError
        ? error.message : 'The selected reference document could not be imported.');
    }
  }

  async function activateReferenceDocument(documentId: string): Promise<boolean> {
    const target = referenceDocumentsCurrentRef.current.find(document => document.id === documentId);
    if (!target || scheduleDocumentIsCurrentEverywhere(target, referenceDocumentsCurrentRef.current) || currentReferenceActivationIdsRef.current.has(documentId)) {
      return Boolean(target && scheduleDocumentIsCurrentEverywhere(target, referenceDocumentsCurrentRef.current)); // retired for some projects (Q15), or a newer partial schedule shows for some (A5 pass 4 #2): made current again
    }
    // A schedule has no ECOS preparation to wait for (audit A5 F4).
    const readiness = buildECOSDocumentReadiness(target);
    if (canonicalReferenceCategory(target) !== 'schedule' && !readiness.canMakeCurrent) {
      Alert.alert('Document is not ready for ECOS', readiness.detail);
      return false;
    }
    currentReferenceActivationIdsRef.current.add(documentId);
    projectDocumentSharedRecordSync.flush(documentId); // text typed just before goes first (whole-app audit A8 pass 2 #7)
    try {
      const outcome = await activateSharedReferenceDocument({
        documentId,
        documents: referenceDocumentsCurrentRef.current,
        client: getSupabaseClient(),
        listDocuments: async () => {
          const result = await listReferenceDocuments();
          return result.ok && !result.stubbed && Array.isArray(result.data)
            ? normalizeReferenceDocuments(result.data)
            : null;
        },
        confirmRetiringProjects: effects => new Promise(resolve => Alert.alert(
          'Change the current schedule?',
          scheduleRetirementMessage(effects), // from the cloud's current flags (whole-app audit A5 pass 3 F2)
          [
            { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
            { text: 'Set Active', onPress: () => resolve(true) },
          ],
          { cancelable: true, onDismiss: () => resolve(false) },
        )),
      });
      if (outcome.status === 'cancelled') return false;
      if (outcome.status === 'refresh_required') {
        Alert.alert(
          'Refresh required',
          'Sign in and refresh the project documents before changing the current revision.',
        );
        return false;
      }
      if (outcome.status !== 'activated') {
        Alert.alert(
          outcome.status === 'not_prepared'
            ? 'Document is not ready for ECOS'
            : 'Current revision was not changed',
          outcome.message,
        );
        return false;
      }
      if (!outcome.documents) {
        Alert.alert(
          'Current revision changed',
          'The shared record was updated, but this device could not refresh it yet. Refresh Project Documents before making another change.',
        );
        return true;
      }
      const deletedIds = deletedDAVERecordIds(
        operationalSyncTombstonesRef.current,
        'reference_document',
      );
      const kept = await requeueReferenceDocumentEditsOutlivingActivation(outcome.documents).catch(() => []); // text typed first outlives the activation's stamp (whole-app audit A8 pass 3 M2)
      const mergedDocuments = reconcileCurrentScheduleDocuments(
        mergeDAVEReferenceDocumentRecoveryRecords({
          local: [...referenceDocumentsCurrentRef.current, ...kept],
          cloud: [...outcome.documents],
          deletedIds,
        }),
      );
      const carried = new Map(scheduleProgressCarriedOnActivation({ items: scheduleItemsCurrentRef.current as unknown as import('./types').ScheduleItem[], documentsBefore: referenceDocumentsCurrentRef.current, documentsAfter: mergedDocuments }).map(item => [item.id, item as unknown as ScheduleItem])); // progress recorded since the import follows the task now shown (A5 pass 4 #3)
      markReferenceDocumentsAuthorityReady(true);
      referenceDocumentsCurrentRef.current = mergedDocuments;
      setReferenceDocuments(mergedDocuments);
      if (carried.size > 0) { markScheduleItemsAuthorityReady(true); scheduleItemsCurrentRef.current = scheduleItemsCurrentRef.current.map(item => carried.get(item.id) || item); setScheduleItems(scheduleItemsCurrentRef.current); carried.forEach(item => { void syncScheduleItemRevision(item, advanceScheduleItemSyncGeneration(item.id)); }); }
      return true;
    } catch {
      Alert.alert(
        'Current revision was not changed',
        'Vitruvius could not verify the shared revision change. Try again shortly.',
      );
      return false;
    } finally {
      currentReferenceActivationIdsRef.current.delete(documentId);
    }
  }

  function markReferenceDocumentCurrent(documentId: string) {
    void activateReferenceDocument(documentId);
  }

  async function ensureVerifiedReferenceDocumentBytes(
    document: ReferenceDocument,
  ): Promise<ReferenceDocument> {
    let resolvedUri = resolveReferenceDocumentUri(document.uri);
    let info = resolvedUri
      ? await FileSystem.getInfoAsync(resolvedUri)
      : null;

    if ((!info?.exists || !resolvedUri) && document.storagePath) {
      const expectedSha256 =
        canonicalReferenceDocumentSha256(document.contentSha256) ||
        canonicalReferenceDocumentSha256(document.webFileFingerprint);
      if (!document.sizeBytes || !expectedSha256) {
        throw new Error(
          'This older cloud document does not include the checksum needed for safe recovery.',
        );
      }
      const restored = await restoreReferenceDocumentBytesFromCloud({
        documentId: document.id,
        storagePath: document.storagePath,
        originalFileName: document.originalFileName,
        expectedSizeBytes: document.sizeBytes,
        expectedSha256,
      });
      resolvedUri = restored.uri;
      info = await FileSystem.getInfoAsync(resolvedUri);
      const readableDocument = {
        ...document,
        uri: restored.uri,
        sizeBytes: restored.sizeBytes,
        contentSha256: restored.sha256,
      };
      saveRestoredReferenceDocumentLocally(restored);
      return readableDocument;
    }

    if (!resolvedUri || !info?.exists) {
      throw new Error(
        'This document is listed in the shared project record, but no accessible verified file is attached.',
      );
    }
    return {
      ...document,
      uri: resolvedUri,
    };
  }

  /** An open keeps the restored file on this phone only: no new edit time, nothing queued (whole-app audit A8 pass 1 F4 (30 Sep 2026)). */
  function saveRestoredReferenceDocumentLocally(restored: ReferenceDocumentByteRestoreResult) {
    const updated = withRestoredReferenceDocumentBytes(referenceDocumentsCurrentRef.current, restored);
    markReferenceDocumentsAuthorityReady(true);
    referenceDocumentsCurrentRef.current = updated;
    setReferenceDocuments(updated);
  }

  async function openReferenceDocument(document: ReferenceDocument) {
    try {
      if (await openGoogleDriveReferenceDocument(document)) return;
      const readableDocument =
        await ensureVerifiedReferenceDocumentBytes(document);

      const canShare = await Sharing.isAvailableAsync();

      if (!canShare) {
        Alert.alert('Document saved', `File: ${document.originalFileName}`);
        return;
      }

      await Sharing.shareAsync(readableDocument.uri, {
        dialogTitle: document.name,
        mimeType: document.mimeType || undefined,
      });
    } catch (error) {
      Alert.alert('Open failed', error instanceof Error && error.message
        ? error.message
        : 'This reference document could not be opened right now.');
    }
  }

  async function ensureVerifiedProjectDocumentBytes(
    document: ProjectDocument,
  ): Promise<ProjectDocument> {
    try {
      await verifyOwnedProjectDocument(document);
      return document;
    } catch (verificationError) {
      const sharedDocument = findSharedReferenceDocumentForProjectDocument(
        document,
        referenceDocumentsCurrentRef.current,
      );
      let sharedRecoveryError: unknown = null;

      if (sharedDocument) {
        try {
          const readableSharedDocument =
            await ensureVerifiedReferenceDocumentBytes(sharedDocument);
          return {
            ...document,
            localUri: readableSharedDocument.uri,
            sizeBytes: readableSharedDocument.sizeBytes || document.sizeBytes,
          };
        } catch (error) {
          sharedRecoveryError = error;
        }
      }

      if (
        OWNED_PROJECT_DOCUMENTS_DIR &&
        document.storagePath &&
        document.ownedFileId &&
        document.ownedFileManifest
      ) {
        const manifest = parseOwnedLocalFileManifest(document.ownedFileManifest);
        const record = manifest.files[document.ownedFileId];
        if (record?.kind === 'project_document') {
          try {
            const restored = await restoreProjectDocumentBytesFromCloud({
              storagePath: document.storagePath,
              ownedRoot: OWNED_PROJECT_DOCUMENTS_DIR,
              record,
            });
            const readableDocument = {
              ...document,
              localUri: restored.uri,
              sizeBytes: restored.sizeBytes,
              updatedAt: new Date().toISOString(),
            };
            await verifyOwnedProjectDocument(readableDocument);
            updateDocumentEverywhere(document.id, () => readableDocument);
            await persistProjectDocumentsImmediately(
              projectDocumentsCurrentRef.current,
            );
            return readableDocument;
          } catch (error) {
            if (!sharedRecoveryError) sharedRecoveryError = error;
          }
        }
      }

      if (sharedRecoveryError) throw sharedRecoveryError;
      throw verificationError;
    }
  }

  async function openProjectDocument(document: ProjectDocument) {
    try {
      const readableDocument = await ensureVerifiedProjectDocumentBytes(document);
      if (!readableDocument.localUri) throw new Error('Verified document path is missing.');
      const info = await FileSystem.getInfoAsync(readableDocument.localUri);

      if (!info.exists) {
        Alert.alert(
          'Document file missing',
          'The document record is still saved, but the verified file could not be recovered.',
        );
        return;
      }

      const canShare = await Sharing.isAvailableAsync();

      if (!canShare) {
        Alert.alert('Document saved', readableDocument.name);
        return;
      }

      await Sharing.shareAsync(readableDocument.localUri, {
        dialogTitle: readableDocument.name,
        mimeType: readableDocument.mimeType || undefined,
      });
    } catch (error) {
      Alert.alert(
        'Download unavailable',
        error instanceof Error && /download/i.test(error.message)
          ? 'The document record is available, but its protected cloud file could not be downloaded. Check the connection and retry. If it still fails, add the original file again so Vitruvius can restore the cloud copy.'
          : 'This device does not have the file, and no verified cloud copy could be recovered. Add the original file again to repair this document record.',
      );
    }
  }

  function updateProjectDocument(
    documentId: string,
    next: Partial<ProjectDocument>,
  ) {
    const changedDocument = updateDocumentEverywhere(documentId, document =>
      normalizeProjectDocument({
        ...document,
        ...next,
        updatedAt: new Date().toISOString(),
      }) as ProjectDocument,
    );
    if (!changedDocument) return;

    void persistProjectDocumentsImmediately(projectDocumentsCurrentRef.current)
      .catch(error => reportStoragePersistenceFailure({
        storageKey: PROJECT_DOCUMENTS_STORAGE_KEY,
        label: 'project document metadata',
        error,
      }));

    const sharedDocument = findSharedReferenceDocumentForProjectDocument(
      changedDocument,
      referenceDocumentsCurrentRef.current,
    );
    if (!sharedDocument) return;

    const projectName = projectsCurrentRef.current.find(
      name => authorityProjectId(name) === changedDocument.projectId,
    ) || null;
    const synchronizedDocument = normalizeReferenceDocument(
      synchronizeSharedReferenceDocumentMetadata({
        document: changedDocument,
        sharedDocument,
        projectName,
        updatedAt: changedDocument.updatedAt,
      }),
    );
    const updatedReferences = referenceDocumentsCurrentRef.current.map(document =>
      document.id === synchronizedDocument.id ? synchronizedDocument : document,
    );
    markReferenceDocumentsAuthorityReady(true);
    referenceDocumentsCurrentRef.current = updatedReferences;
    setReferenceDocuments(updatedReferences);
    projectDocumentSharedRecordSync.queueAfterChange(synchronizedDocument.id, next);
  }

  async function makeProjectScheduleDocumentCurrent(documentId: string, hidingTasksConfirmed = false) {
    const document = projectDocuments.find(item => item.id === documentId);
    if (!document || document.category !== 'Schedule') return;
    // Asked before either path: a schedule with no imported tasks hides the project's on every device (whole-app audit A8 pass 1 F6, 30 Sep 2026).
    const projectName = projects.find(name => authorityProjectId(name) === document.projectId) || null;
    const retirement = await loadECOSScheduleRetirementScope(getSupabaseClient()); // as the cloud retires (owner answer Q15); unknown (null): only this schedule changes here, the cloud settles the rest (A5 pass 4 #5)
    // The same file already imported for the project is made current, unasked, not its task-less copy (whole-app audit A8 pass 2 #2).
    const importedCopy = importedScheduleOfPhoneSchedule(document, projectName, referenceDocuments);
    const warning = hidingTasksConfirmed || importedCopy ? null : scheduleTasksHiddenWarning(document.name, scheduleTasksHiddenByActivation(
      phoneScheduleActivationTarget(document, projectName, referenceDocuments), referenceDocuments, scheduleItems, retirement));
    if (warning) return Alert.alert(warning.title, warning.message, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Import This Schedule', onPress: () => { void reviewProjectScheduleDocumentImport(document, projectName); } },
      { text: 'Make Current', onPress: () => { void makeProjectScheduleDocumentCurrent(documentId, true); } },
    ]);
    const referenceUpdatedAt = new Date().toISOString();

    let referenceDocument = importedCopy || (document.referenceDocumentId
      ? referenceDocuments.find(item => item.id === document.referenceDocumentId)
      : null);
    const alreadyShared = Boolean(referenceDocument);

    try {
      if (!referenceDocument) {
        const readableDocument = await ensureVerifiedProjectDocumentBytes(document);
        if (!readableDocument.localUri) throw new Error('Verified schedule path is missing.');
        const directory = await ensureReferenceDocumentsDirectory();
        const originalFileName = document.name;
        const targetUri = `${directory}${uid()}-${sanitizeFilename(originalFileName)}`;
        await FileSystem.copyAsync({ from: readableDocument.localUri, to: targetUri });

        const matchingProjectDocuments = projectDocuments.filter(item =>
          item.category === 'Schedule' &&
          item.name === document.name &&
          item.mimeType === document.mimeType &&
          item.sizeBytes === document.sizeBytes &&
          Math.abs(Date.parse(item.importedAt) - Date.parse(document.importedAt)) < 5 * 60 * 1000,
        );
        const matchingProjectIds = new Set(
          matchingProjectDocuments.map(item => item.projectId),
        );
        const projectName = matchingProjectIds.size === 1
          ? projects.find(name => authorityProjectId(name) === document.projectId) || null
          : null;
        const ownedRecord = document.ownedFileId
          ? parseOwnedLocalFileManifest(document.ownedFileManifest).files[document.ownedFileId]
          : null;

        referenceDocument = normalizeReferenceDocument({
          id: uid(),
          name: originalFileName.replace(/\.[^/.]+$/, ''),
          originalFileName,
          uri: targetUri,
          mimeType: document.mimeType,
          category: 'Schedules',
          notes: document.note || '',
          isCurrent: true,
          importedAt: document.importedAt,
          projectId: projectName ? document.projectId : null,
          projectName,
          storagePath: document.storagePath,
          sizeBytes: document.sizeBytes,
          contentSha256: ownedRecord?.sha256 || null,
          updatedAt: referenceUpdatedAt,
        });

        const linkedReferenceDocumentId = referenceDocument.id;
        const linkMatchingUploads = (documents: ProjectDocument[]) =>
          documents.map(item => matchingProjectDocuments.some(match => match.id === item.id)
            ? { ...item, referenceDocumentId: linkedReferenceDocumentId }
            : item);
        setProjectDocuments(linkMatchingUploads);
        setDraft(prev => ({
          ...prev,
          documents: linkMatchingUploads(prev.documents || []),
        }));
        setSavedUpdates(prev => prev.map(update => ({
          ...update,
          documents: linkMatchingUploads(update.documents || []),
        })));
      }
    } catch {
      Alert.alert(
        'Current schedule not changed',
        'The schedule file could not be verified and copied into the shared schedule record.',
      );
      return;
    }

    const selectedReferenceDocument = referenceDocument;
    // A schedule already shared is made current by the cloud; a flag flipped
    // here never reached it (audit A5 F4).
    if (alreadyShared && !(await activateReferenceDocument(selectedReferenceDocument.id))) return;
    // By the cloud's rule, not every schedule of every project retired (owner answer Q15).
    const nextReferenceDocuments = alreadyShared ? referenceDocumentsCurrentRef.current
      : scheduleDocumentsAfterActivation(selectedReferenceDocument, referenceDocuments, retirement, referenceUpdatedAt);

    if (!alreadyShared) {
      markReferenceDocumentsAuthorityReady(true);
      setReferenceDocuments(nextReferenceDocuments);
    }

    const updatedAt = referenceUpdatedAt;
    const markCurrent = (documents: ProjectDocument[]) =>
      markCurrentProjectScheduleDocument({
        documents,
        documentId,
        referenceDocumentId: selectedReferenceDocument.id,
        updatedAt,
      });

    setProjectDocuments(markCurrent);
    setDraft(prev => ({
      ...prev,
      documents: markCurrent(prev.documents || []),
    }));
    setSavedUpdates(prev =>
      prev.map(update => ({
        ...update,
        documents: markCurrent(update.documents || []),
      })),
    );

    if (alreadyShared) return;
    referenceDocumentsCurrentRef.current = nextReferenceDocuments;
    const queueResults = await Promise.allSettled(
      nextReferenceDocuments
        .filter(item => !referenceDocuments.includes(item))
        .map(document => queueReferenceDocumentRecord(document)),
    );
    if (queueResults.some(result => result.status === 'rejected')) {
      Alert.alert(
        'Current schedule saved on this device',
        'The shared cloud record could not be updated yet. Use Sync Now when connected.',
      );
    }
  }

  async function reviewProjectScheduleDocumentImport(document: ProjectDocument, projectName: string | null) {
    try {
      const { localUri } = await ensureVerifiedProjectDocumentBytes(document);
      if (!localUri) throw new Error('Verified schedule path is missing.');
      const batch = await prepareScheduleImportFromAsset({ uri: localUri, name: document.name, mimeType: document.mimeType, size: document.sizeBytes }, projectName ? [projectName] : undefined);
      if (!batch) return;
      projectScheduleImportCardRef.current = { batchId: batch.id, documentId: document.id }; // made current once approved (whole-app audit A8 pass 2 #2)
      setIncomingScheduleImportBatch(batch); setScheduleProjectFilter(null); setScreen('Schedule');
    } catch (error) {
      Alert.alert('Schedule review unavailable', error instanceof Error ? error.message : 'The schedule file could not be read on this phone.');
    }
  }

  /** A phone schedule card marked current on this phone, and saved; its shared copy is left as it is. */
  function markProjectScheduleCardCurrent(documentId: string) {
    const updatedAt = new Date().toISOString();
    const markCurrent = (documents: ProjectDocument[]) => markCurrentProjectScheduleDocument({ documents, documentId, updatedAt });
    const next = markCurrent(projectDocumentsCurrentRef.current);
    projectDocumentsCurrentRef.current = next;
    setProjectDocuments(next);
    setDraft(prev => ({ ...prev, documents: markCurrent(prev.documents || []) }));
    setSavedUpdates(prev => prev.map(update => ({ ...update, documents: markCurrent(update.documents || []) })));
    void persistProjectDocumentsImmediately(next).catch(error => reportStoragePersistenceFailure({
      storageKey: PROJECT_DOCUMENTS_STORAGE_KEY, label: 'project document metadata', error }));
  }

  function deleteProjectDocument(documentId: string) {
    const document = projectDocuments.find(item => item.id === documentId);

    if (!document) return;

    const sensitive = isComplianceSensitiveProjectDocument(document);
    const title = sensitive
      ? 'Archive compliance-sensitive document?'
      : 'Delete project document?';
    // The owner chooses this phone only or every device (owner answer Q14, audit A7 pass 4).
    const message = sensitive
      ? `${document.name} is categorized as ${document.category}. It will be hidden from active project documents.`
      : `Delete from This Device removes ${document.name} from this phone; a copy already shared stays on your other devices. Delete from All Devices also removes the shared copy from the iPad, the web and the cloud. Either way it is taken off any field update it was attached to. This cannot be undone.`;
    const sharedRecord = findSharedReferenceDocumentForProjectDocument(document, referenceDocumentsCurrentRef.current);
    const sharedWithAnotherDocument = Boolean(sharedRecord) && projectDocumentsCurrentRef.current.some(item =>
      item.id !== documentId && (item.referenceDocumentId === sharedRecord?.id || item.id === sharedRecord?.id));

    const removeFromDevice = async () => {
      if (sharedRecord) projectDocumentSharedRecordSync.cancel(sharedRecord.id);
      let localFileCleanupStatus: 'deleted' | 'not_recorded' | 'unavailable' =
        'not_recorded';
      if (!sensitive) {
        const cleanup = await deleteOwnedProjectDocument(document);
        localFileCleanupStatus = cleanup.status;
      }
      const archivedAt = new Date().toISOString();
      const removeCard = (prev: ProjectDocument[]) => (
        sensitive
          ? prev.map(item =>
              item.id === documentId
                ? {
                    ...item,
                    isArchived: true,
                    archivedAt,
                    updatedAt: archivedAt,
                  }
                : item,
            )
          : prev.filter(item => item.id !== documentId));
      projectDocumentsCurrentRef.current = removeCard(projectDocumentsCurrentRef.current); // an upload finishing meanwhile saves the list without it (audit A8 pass 3 L3)
      setProjectDocuments(removeCard);
      if (!sensitive && sharedRecord) hiddenSharedDocuments.hide(sharedRecord.id); // no card comes back here (audit A8)
      if (!sensitive) void withdrawUnsentProjectDocumentBridge({ // not uploaded later (audit A7 pass 4)
        bridge: findSharedReferenceDocumentForProjectDocument(document, referenceDocumentsCurrentRef.current),
        remainingDocuments: projectDocumentsCurrentRef.current.filter(item => item.id !== documentId),
        isQueued: async id => (await getOfflineQueue()).some(item => item.entity === 'reference_document' && (item.payload as { id?: string }).id === id),
        withdraw: async id => { await removeOperationalRecordFromSyncQueue('reference_document', id); setReferenceDocuments(prev => prev.filter(item => item.id !== id)); },
      }).catch(() => undefined);

      setDraft(prev => ({
        ...prev,
        documents: (prev.documents || []).filter(
          item => item.id !== documentId,
        ),
      }));

      // An update is shared by every device: one that was sent goes up again without it, whichever delete (A7 pass 5 M1).
      const withoutDocument = (update: ProjectUpdate) => withoutFieldUpdateDocument(update, documentId);
      if (sensitive) setSavedUpdates(prev => prev.map(withoutDocument));
      else resendUpdatesListingDocument(documentId, withoutDocument);

      if (!sensitive && localFileCleanupStatus === 'unavailable') {
        Alert.alert(
          'Document removed',
          'The document record was removed. Its older local file was already unavailable and was left untouched.',
        );
      }
    };
    const removeFromAllDevices = () => {
      if (sharedWithAnotherDocument) {
        Alert.alert('Shared copy kept', 'Another document on this phone uses the same shared copy, so it stays on your other devices.');
      }
      if (!sharedRecord || sharedWithAnotherDocument) return void removeFromDevice();
      void removeReferenceDocumentEverywhere(sharedRecord.id)
        .then(removeFromDevice)
        .catch(() => Alert.alert('Delete failed', `${document.name} could not be saved as deleted. Try again.`));
    };

    Alert.alert(title, message, sensitive
      ? [
          { text: 'Cancel', style: 'cancel' },
          { text: `Archive ${document.category}`, style: 'destructive', onPress: () => void removeFromDevice() },
        ]
      : [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Delete from This Device', style: 'destructive', onPress: () => void removeFromDevice() },
          { text: 'Delete from All Devices', style: 'destructive', onPress: removeFromAllDevices },
        ]);
  }

  // Deleted on every device: the durable deletion record first; the cloud
  // then removes the row, its file and its ECOS index.
  async function removeReferenceDocumentEverywhere(documentId: string) {
    const tombstone = await recordDAVESyncTombstone('reference_document', documentId);
    rememberOperationalTombstones([tombstone]);
    markReferenceDocumentsAuthorityReady(true);
    const updated = referenceDocumentsCurrentRef.current.filter(item => item.id !== documentId);
    referenceDocumentsCurrentRef.current = updated;
    setReferenceDocuments(updated);
    void removeOperationalRecordFromSyncQueue('reference_document', documentId);
  }

  function deleteReferenceDocument(documentId: string) {
    const document = referenceDocuments.find(item => item.id === documentId);

    if (!document) return;

    Alert.alert(
      'Delete reference document?',
      `${document.name} will be removed from this app.`,
      [
        {
          text: 'Cancel',
          style: 'cancel',
        },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            void removeReferenceDocumentEverywhere(documentId)
              .then(() => {
                deleteStoredReferenceDocument(document.uri).catch(() => undefined);
              })
              .catch(() => {
                Alert.alert(
                  'Delete failed',
                  `${document.name} could not be saved as deleted. Try again.`,
                );
              });
          },
        },
      ],
    );
  }

  // The cloud makes the choice; a flag flipped on the phone was undone by the
  // next refresh and never reached the other device (audit A5 F4). A schedule with no
  // imported tasks asks first, as on the phone card (whole-app audit A8 pass 2 #8).
  async function setActiveScheduleDocument(documentId: string) {
    const target = referenceDocumentsCurrentRef.current.find(item => item.id === documentId);
    const retirement = (await loadECOSScheduleRetirementScope(getSupabaseClient())) ?? 'schedule';
    const warning = target && scheduleTasksHiddenWarning(target.name, scheduleTasksHiddenByActivation(
      target, referenceDocumentsCurrentRef.current, scheduleItemsCurrentRef.current, retirement));
    if (!warning) return markReferenceDocumentCurrent(documentId);
    Alert.alert(warning.title, warning.message, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Set Active', onPress: () => markReferenceDocumentCurrent(documentId) },
    ]);
  }

  function deleteScheduleDocument(documentId: string) {
    const document = referenceDocuments.find(item => item.id === documentId);

    if (!document) return;
    // Only the tasks no other schedule contains: one unchanged across revisions stays (audit A5 pass 2).
    const relatedScheduleItems = document.importBatchId
      ? scheduleItemsOnlyInImportBatch(scheduleItems, document, referenceDocuments.filter(scheduleDocumentIsScheduleLike))
      : scheduleItemsOfUnbatchedDocument(scheduleItems, document); // never another schedule's batch by file name (whole-app audit A8 pass 2 #1)
    const sharedCount = document.importBatchId
      ? scheduleItemsForExactImportBatch(scheduleItems, document).length - relatedScheduleItems.length
      : 0;

    Alert.alert(
      'Delete uploaded schedule?',
      `${document.name} will be removed. You can also remove the ${relatedScheduleItems.length} schedule ${relatedScheduleItems.length === 1 ? 'item' : 'items'} only this PDF contains so outdated dates do not confuse Upcoming.${sharedCount > 0 ? ` ${sharedCount} ${sharedCount === 1 ? 'item another schedule also contains stays' : 'items another schedule also contains stay'}.` : ''}${scheduleLookaheadDeleteNote(scheduleItems as unknown as import('./types').ScheduleItem[], document)}`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete PDF Only',
          onPress: () => {
            void removeReferenceDocumentEverywhere(documentId)
              .then(() => {
                deleteStoredReferenceDocument(document.uri).catch(() => undefined);
              })
              .catch(() => {
                Alert.alert(
                  'Delete failed',
                  `${document.name} could not be saved as deleted. Try again.`,
                );
              });
          },
        },
        {
          text: 'Delete PDF + Items',
          style: 'destructive',
          onPress: () => {
            void recordDAVESyncTombstones([
              { entityType: 'reference_document', recordId: documentId },
              ...relatedScheduleItems.map(item => ({
                entityType: 'schedule_item' as const,
                recordId: item.id,
              })),
            ])
              .then(tombstones => {
                const deletedItemIds = new Set(relatedScheduleItems.map(item => item.id));
                relatedScheduleItems.forEach(item => {
                  advanceScheduleItemSyncGeneration(item.id);
                  cancelScheduleItemTextSync(item.id);
                });
                rememberOperationalTombstones(tombstones);
                markReferenceDocumentsAuthorityReady(true); markScheduleItemsAuthorityReady(true);
                const updated = referenceDocumentsCurrentRef.current
                  .filter(item => item.id !== documentId);
                const restored = new Map(scheduleItemsAfterLookaheadDeleted(scheduleItemsCurrentRef.current.filter(item => !deletedItemIds.has(item.id)) as unknown as import('./types').ScheduleItem[], document).map(item => [item.id, item as unknown as ScheduleItem])); // a lookahead's master tasks go back to the master's dates (owner answer Q22)
                const nextScheduleItems = scheduleItemsCurrentRef.current
                  .filter(item => !deletedItemIds.has(item.id)).map(item => restored.get(item.id) || item);
                referenceDocumentsCurrentRef.current = updated;
                scheduleItemsCurrentRef.current = nextScheduleItems;
                setReferenceDocuments(updated);
                setScheduleItems(nextScheduleItems);
                restored.forEach(item => { void syncScheduleItemRevision(item, advanceScheduleItemSyncGeneration(item.id)); });
                dropDeletedPredecessors([...deletedItemIds]); // shared tasks survive (whole-app audit A5 pass 3 F7 (30 Sep 2026))
                return Promise.all([
                  removeOperationalRecordFromSyncQueue('reference_document', documentId),
                  ...relatedScheduleItems.map(item =>
                    removeOperationalRecordFromSyncQueue('schedule_item', item.id)),
                  ...relatedScheduleItems.map(item =>
                    clearScheduleItemSyncConflicts(item.id)),
                ]);
              })
              .then(() => {
                deleteStoredReferenceDocument(document.uri).catch(() => undefined);
              })
              .catch(() => {
                Alert.alert(
                  'Delete failed',
                  `${document.name} and its schedule items could not be saved as deleted. Try again.`,
                );
              });
          },
        },
      ],
    );
  }

  function addScheduleItem(item: Partial<ScheduleItem>) {
    const now = new Date().toISOString();
    const next = normalizeScheduleItem({
      ...item,
      id: uid(),
      progressSource: 'project_manager',
      progressConfirmedAt: now,
      progressConfirmedBy: displayName.trim() || 'Project manager',
      createdAt: now,
      updatedAt: now,
    });

    markScheduleItemsAuthorityReady(true);
    scheduleItemsCurrentRef.current = [next, ...scheduleItemsCurrentRef.current];
    setScheduleItems(prev => [next, ...prev]);
    const syncGeneration = advanceScheduleItemSyncGeneration(next.id);
    void syncScheduleItemRevision(next, syncGeneration);
  }

  async function syncScheduleItemRevision(
    item: ScheduleItem,
    generation?: number,
    changedFields?: readonly (keyof ScheduleItem)[],
  ): Promise<boolean> {
    try {
      const result = await runScheduleItemCloudSync(item, changedFields);
      const itemStillExists = scheduleItemsCurrentRef.current.some(
        candidate => candidate.id === item.id,
      );
      const generationIsCurrent = (
        generation === undefined ||
        scheduleItemSyncGenerationsRef.current.get(item.id) === generation
      );
      if (!itemStillExists || !generationIsCurrent) return false;

      if (result.uploaded === 1 && result.queued === 0 && result.conflicts === 0) {
        settleScheduleItemTextSync(
          scheduleItemTextSyncLifecycleRef.current,
          item.id,
        );
        scheduleItemSyncWarningsRef.current.delete(item.id);
        return true;
      }

      if (result.conflicts > 0) {
        settleScheduleItemTextSync(
          scheduleItemTextSyncLifecycleRef.current,
          item.id,
        );
        if (!scheduleItemSyncWarningsRef.current.has(item.id)) {
          scheduleItemSyncWarningsRef.current.add(item.id);
          Alert.alert(
            'Task changed on another device',
            'Vitruvius protected both versions. Open Settings and choose which task copy to keep before making another change.',
          );
        }
        return false;
      }

      requestPendingChangesUpload('schedule_item_save_pending');
      if (!scheduleItemSyncWarningsRef.current.has(item.id)) {
        scheduleItemSyncWarningsRef.current.add(item.id);
        Alert.alert(
          'Task saved on this device',
          'Vitruvius is still retrying this task’s cloud sync. Other devices will update after the cloud accepts it.',
        );
      }
      return false;
    } catch {
      const itemStillExists = scheduleItemsCurrentRef.current.some(
        candidate => candidate.id === item.id,
      );
      const generationIsCurrent = (
        generation === undefined ||
        scheduleItemSyncGenerationsRef.current.get(item.id) === generation
      );
      if (!itemStillExists || !generationIsCurrent) return false;

      requestPendingChangesUpload('schedule_item_save_error');
      if (!scheduleItemSyncWarningsRef.current.has(item.id)) {
        scheduleItemSyncWarningsRef.current.add(item.id);
        Alert.alert(
          'Task saved on this device',
          'Vitruvius is still retrying this task’s cloud sync. Other devices will update after the cloud accepts it.',
        );
      }
      return false;
    }
  }

  function cancelScheduleItemTextSync(itemId: string) {
    cancelScheduleItemTextSyncLifecycle(
      scheduleItemTextSyncLifecycleRef.current,
      itemId,
    );
  }

  function advanceScheduleItemSyncGeneration(itemId: string): number {
    const generation = (scheduleItemSyncGenerationsRef.current.get(itemId) || 0) + 1;
    scheduleItemSyncGenerationsRef.current.set(itemId, generation);
    return generation;
  }

  function queueDebouncedScheduleItemTextSync(
    itemId: string,
    generation: number,
  ) {
    if (scheduleItemSyncGenerationsRef.current.get(itemId) !== generation) return;
    scheduleScheduleItemTextSync({
      lifecycle: scheduleItemTextSyncLifecycleRef.current,
      itemId,
      generation,
      currentGeneration: () =>
        scheduleItemSyncGenerationsRef.current.get(itemId),
      onReady: (readyItemId, readyGeneration) => {
        const latest = scheduleItemsCurrentRef.current.find(
          candidate => candidate.id === readyItemId,
        );
        if (latest) void syncScheduleItemRevision(latest, readyGeneration);
      },
    });
  }

  function updateScheduleItem(
    itemId: string,
    next: Partial<ScheduleItem>,
    workflowRequest?: ProjectItemWorkflowMutationRequest,
  ) {
    const current = scheduleItemsCurrentRef.current.find(item => item.id === itemId);
    if (!current) return;
    const now = new Date().toISOString();
    const progressChanged = (
      typeof next.percentComplete === 'number' && next.percentComplete !== current.percentComplete
    ) || (
      typeof next.status === 'string' && next.status !== current.status
    );
    const progress = progressChanged
      ? reconcileScheduleProgressEdit(current, {
          ...(typeof next.status === 'string' && next.status !== current.status
            ? { status: next.status }
            : {}),
          ...(typeof next.percentComplete === 'number' &&
          next.percentComplete !== current.percentComplete
            ? { percentComplete: next.percentComplete }
            : {}),
        })
      : null;
    const candidate = normalizeScheduleItem(
      {
        ...current,
        ...next,
        ...(progress || {}),
        updatedAt: now,
        ...(progressChanged ? {
          progressSource: 'project_manager' as const,
          progressConfirmedAt: now,
          progressConfirmedBy: displayName.trim() || 'Project manager',
          completionVerification: next.completionVerification ?? null,
        } : {}),
      },
      { preserveEditedNotes: typeof next.notes === 'string' },
    );
    const workflowMutation = resolveProjectItemWorkflowMutation({
      current,
      candidate,
      request: workflowRequest,
      now,
    });
    if (!workflowMutation.ok) {
      Alert.alert('Workflow action required', workflowMutation.message);
      return;
    }
    const updated = normalizeScheduleItem(
      workflowMutation.item,
      { preserveEditedNotes: typeof next.notes === 'string' },
    );
    const syncGeneration = advanceScheduleItemSyncGeneration(itemId);
    const changedFields = (Object.keys(updated) as Array<keyof ScheduleItem>)
      .filter(field => (
        JSON.stringify(updated[field]) !== JSON.stringify(current[field])
      ));
    markScheduleItemsAuthorityReady(true);
    scheduleItemsCurrentRef.current = scheduleItemsCurrentRef.current.map(
      item => item.id === itemId ? updated : item,
    );
    setScheduleItems(prev => prev.map(item => item.id === itemId ? updated : item));
    const textOnlyChange = scheduleItemChangeUsesDebouncedSync(next);

    if (textOnlyChange) {
      markScheduleItemTextSyncPending(
        scheduleItemTextSyncLifecycleRef.current,
        itemId,
      );
      void queueScheduleItemRecord(updated, true, changedFields)
        .then(() => queueDebouncedScheduleItemTextSync(itemId, syncGeneration))
        .catch(() => {
          if (
            scheduleItemSyncGenerationsRef.current.get(itemId) === syncGeneration
          ) {
            cancelScheduleItemTextSync(itemId);
          }
          Alert.alert(
            'Task not saved',
            'Vitruvius could not protect this task edit on the device. Try again.',
          );
        });
      return;
    }

    cancelScheduleItemTextSync(itemId);
    void syncScheduleItemRevision(updated, syncGeneration, changedFields);
  }

  async function saveScheduleItemChanges(itemId: string): Promise<boolean> {
    Keyboard.dismiss();
    // Pressing Save dismisses the active native input. Give its onBlur commit
    // one frame to update the authoritative ref and durable queue first.
    await delay(80);
    const latest = scheduleItemsCurrentRef.current.find(item => item.id === itemId);
    if (!latest) return false;

    cancelScheduleItemTextSync(itemId);
    const generation = scheduleItemSyncGenerationsRef.current.get(itemId);
    return syncScheduleItemRevision(latest, generation);
  }

  /** This phone's own deletions reach the realtime applier at once, not at the next refresh (audit A7 pass 3). */
  function rememberOperationalTombstones(tombstones: readonly DAVESyncTombstone[]) {
    const keys = new Set(tombstones.map(tombstone => `${tombstone.entityType}:${tombstone.recordId}`));
    const next = [
      ...operationalSyncTombstonesRef.current.filter(tombstone => !keys.has(`${tombstone.entityType}:${tombstone.recordId}`)),
      ...tombstones,
    ];
    operationalSyncTombstonesRef.current = next;
    setOperationalSyncTombstones(next);
  }

  /** Surviving tasks drop the deleted ones from their dependencies, through the normal task update (audit A5; batch A5 pass 3 F7). */
  function dropDeletedPredecessors(deletedItemIds: readonly string[]) {
    dependencyChangesForDeletedTask(scheduleItemsCurrentRef.current, deletedItemIds).forEach(change => {
      scheduleItemSyncWarningsRef.current.add(change.id); // no alert per successor offline (A5 pass 2)
      updateScheduleItem(change.id, { dependencies: change.dependencies });
    });
  }

  function deleteScheduleItem(itemId: string) {
    const item = scheduleItemsCurrentRef.current.find(
      scheduleItem => scheduleItem.id === itemId,
    );
    if (!item) return;

    Alert.alert(
      'Delete schedule item?',
      'This removes the schedule item from every signed-in device.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            advanceScheduleItemSyncGeneration(itemId);
            cancelScheduleItemTextSync(itemId);
            void recordDAVESyncTombstone('schedule_item', itemId)
              .then(tombstone => {
                rememberOperationalTombstones([tombstone]);
                return Promise.all([
                  removeOperationalRecordFromSyncQueue('schedule_item', itemId),
                  clearScheduleItemSyncConflicts(itemId),
                ]);
              })
              .then(() => {
                markScheduleItemsAuthorityReady(true);
                scheduleItemsCurrentRef.current =
                  scheduleItemsCurrentRef.current.filter(
                    scheduleItem => scheduleItem.id !== itemId,
                  );
                setScheduleItems(prev => prev.filter(scheduleItem => scheduleItem.id !== itemId));
                dropDeletedPredecessors([itemId]);
              })
              .catch(() => {
                Alert.alert(
                  'Delete failed',
                  `${item.taskName} could not be saved as deleted. Try again.`,
                );
              });
          },
        },
      ],
    );
  }
  async function prepareScheduleImportFromAsset(
    file: {
      uri: string;
      name?: string | null;
      mimeType?: string | null;
      size?: number | null;
    },
    selectedProjectNames: readonly string[] = activeProjects.length ? activeProjects : projects,
  ): Promise<PIEScheduleImportBatch | null> {
    const fileName = file.name?.trim() || 'Imported schedule';
    const mimeType = file.mimeType || '';
    const archivedKeys = new Set(
      archivedProjectsCurrentRef.current.map(name => name.trim().toLowerCase()),
    );
    const deletedKeys = new Set(
      deletedProjectNamesRef.current.map(name => name.trim().toLowerCase()),
    );
    const activeNameByKey = new Map(
      projectsCurrentRef.current
        .filter(name => {
          const key = name.trim().toLowerCase();
          return key && !archivedKeys.has(key) && !deletedKeys.has(key);
        })
        .map(name => [name.trim().toLowerCase(), name.trim()] as const),
    );
    const scopeProjects = Array.from(new Set(
      selectedProjectNames
        .map(name => activeNameByKey.get(name.trim().toLowerCase()) || '')
        .filter(Boolean),
    ));
    if (!scopeProjects.length) {
      Alert.alert(
        'Choose an active project',
        'A schedule can only be analyzed for an active project you explicitly select.',
      );
      return null;
    }

    const scopedProjectRecords = scopeProjects.map(projectName => {
      const record = projectRecordsCurrentRef.current.find(candidate =>
        candidate.name.trim().toLowerCase() === projectName.toLowerCase(),
      );
      const importIdentity = authorityProjectId(projectName);
      return {
        id: record?.id || importIdentity,
        importIdentity,
        name: projectName,
      };
    });
    const scopedAreasByProject = new Map(scopeProjects.map(projectName => {
      const areas = projectAreasForProject({
        projectAreas: projectAreasCurrentRef.current,
        projectName,
        scheduleItems: scheduleItemsCurrentRef.current,
        updates: savedUpdatesRef.current,
      });
      return [projectName, areas] as const;
    }));
    const scopedProjectAreas = Array.from(new Map(
      [...scopedAreasByProject.values()]
        .flat()
        .map(area => [area.id, area] as const),
    ).values());
    const selectedScopeProjects = scopedProjectRecords.map(project => {
      const existingChildNames = scheduleItemsCurrentRef.current
        .filter(item =>
          (item.scheduleProjectName || item.projectName).trim().toLowerCase() ===
            project.name.toLowerCase(),
        )
        .flatMap(item => [item.projectName, item.locationName]);
      return {
        ...project,
        aliases: [
          ...(scopedAreasByProject.get(project.name) || []).map(area => area.name),
          ...existingChildNames,
        ],
      };
    });
    const unavailableScopeProjects = [
      ...archivedProjectsCurrentRef.current.map(name => ({
        id: projectRecordsCurrentRef.current.find(record =>
          record.name.trim().toLowerCase() === name.trim().toLowerCase(),
        )?.id || authorityProjectId(name),
        name,
        state: 'archived' as const,
      })),
      ...deletedProjectNamesRef.current.map(name => ({
        id: projectRecordsCurrentRef.current.find(record =>
          record.name.trim().toLowerCase() === name.trim().toLowerCase(),
        )?.id || authorityProjectId(name),
        name,
        state: 'deleted' as const,
      })),
    ];
    const sourcePayload = await prepareExpoFileUploadPayload({
      uri: file.uri,
      reportedSizeBytes: file.size,
    });
    const sourceIdentity = resolveScheduleImportSourceIdentity({ // after a delete, the next generation (audit A5)
      bytes: sourcePayload.data,
      projects: scopedProjectRecords,
      documentIdIsDeleted: id => deletedDAVERecordIds(operationalSyncTombstonesRef.current, 'reference_document').includes(id),
    });
    const alreadyImported = scheduleImportAlreadyAdded({ // an import, not a card's own shared copy (whole-app audit A8 pass 3 M1)
      documents: referenceDocumentsCurrentRef.current, scheduleItems: scheduleItemsCurrentRef.current,
      documentId: sourceIdentity.documentId, contentSha256: sourceIdentity.contentSha256, projectNames: scopeProjects,
    });
    if (alreadyImported) {
      Alert.alert(
        'Schedule already added',
        'This exact schedule is already saved for the selected projects. Open the existing schedule source instead of importing a duplicate.',
      );
      return null;
    }

    const isPdf = mimeType.includes('pdf') || fileName.toLowerCase().endsWith('.pdf');
    const directory = await ensureReferenceDocumentsDirectory();
    const originalFileName = isPdf && !fileName.toLowerCase().endsWith('.pdf')
      ? `${fileName}.pdf`
      : fileName;
    const targetUri =
      `${directory}${sourceIdentity.documentId}-${sanitizeFilename(originalFileName)}`;
    await FileSystem.deleteAsync(targetUri, { idempotent: true });
    await FileSystem.copyAsync({ from: file.uri, to: targetUri });
    const onlyProject = scopeProjects.length === 1 ? scopeProjects[0] : null;
    const scheduleDocument = normalizeReferenceDocument({
      id: sourceIdentity.documentId,
      name: originalFileName.replace(/\.[^/.]+$/, ''),
      originalFileName,
      uri: targetUri,
      mimeType: file.mimeType || (isPdf ? 'application/pdf' : 'text/plain'),
      category: 'Schedules',
      notes: 'Schedule uploaded for task extraction and project manager review.',
      isCurrent: true,
      importedAt: new Date().toISOString(),
      projectId: onlyProject ? authorityProjectId(onlyProject) : null,
      projectName: onlyProject,
      projectNames: scopeProjects,
      importBatchId: sourceIdentity.batchId,
      sizeBytes: sourcePayload.sizeBytes,
      contentSha256: sourceIdentity.contentSha256,
    });
    const validateAndBindItems = (
      sourceItems: ScheduleItem[],
      extractionWarnings: readonly string[] = [],
    ) => {
      const validation = validateScheduleImportScope({
        items: sourceItems,
        selectedProjects: selectedScopeProjects,
        selectedProjectAreas: selectedScopeProjects.map(project => ({
          projectId: project.id,
          areas: (scopedAreasByProject.get(project.name) || []).map(area => ({
            id: area.id,
            name: area.name,
          })),
        })),
        unavailableProjects: unavailableScopeProjects,
      });
      return {
        items: bindStableScheduleImportItemIds(validation.items, sourceIdentity),
        warnings: [
          ...extractionWarnings.map(value => value.trim()).filter(Boolean),
          ...validation.warnings.map(value => value.message),
        ],
      };
    };

    if (!isPdf) {
      const contents = await FileSystem.readAsStringAsync(targetUri);
      const normalizedImport = normalizeScheduleImport({
        contents, sourceName: fileName, mimeType,
        projects: scopeProjects,
        projectAreas: scopedProjectAreas as unknown as Parameters<typeof normalizeScheduleImport>[0]['projectAreas'],
      });
      const imported = normalizedImport.items as unknown as ScheduleItem[];
      if (!imported.length) {
        await deleteStoredReferenceDocument(targetUri);
        Alert.alert(
          'No schedule items found',
          'Use a CSV or text file with at least a task name and date. Recommended columns: Task, Project, Location, Start, Finish, Owner, and Status.',
        );
        return null;
      }
      const validated = validateAndBindItems(imported);
      const items = dedupeScheduleImportItems(
        validated.items as unknown as import('./types').ScheduleItem[],
      );
      return {
        id: sourceIdentity.batchId,
        kind: 'schedule_file',
        sourceCount: 1,
        sourceLabel: fileName,
        message: `${items.length} schedule ${items.length === 1 ? 'item' : 'items'} prepared. Import confidence: ${normalizedImport.extractionConfidencePercent}%.`,
        items,
        documents: [scheduleDocument],
        warnings: validated.warnings,
      };
    }

    let extractedItems: ScheduleItem[] = [];
    let extractionMethod = '';
    let extractionIssue = '';
    let extractionWarnings: string[] = [];
    if (isDavePdfTextExtractionAvailable()) {
      try {
        const extractedPdf = await withScheduleImportTimeout(
          extractTextFromPdf(targetUri), 20_000,
          `PDF text extraction timed out for ${originalFileName}.`,
        );
        if (extractedPdf.format === 'microsoft_project_tsv') {
          extractedItems = normalizeMicrosoftProjectPdfRows({
            contents: extractedPdf.text, sourceName: originalFileName,
            projects: scopeProjects,
            projectAreas: scopedProjectAreas as unknown as Parameters<typeof normalizeMicrosoftProjectPdfRows>[0]['projectAreas'],
          }) as unknown as ScheduleItem[];
          extractionMethod = 'structured Microsoft Project rows';
        } else {
          const normalizedImport = normalizeScheduleImport({
            contents: extractedPdf.text, sourceName: originalFileName,
            mimeType: file.mimeType || 'application/pdf', projects: scopeProjects,
            projectAreas: scopedProjectAreas as unknown as Parameters<typeof normalizeScheduleImport>[0]['projectAreas'],
          });
          extractedItems = (normalizedImport.items as unknown as ScheduleItem[])
            .filter(item => Boolean(item.startDate || item.finishDate || item.milestone))
            .map(item => ({ ...item, importedFrom: originalFileName }));
          extractionMethod = 'local PDF text';
        }
      } catch {
        extractedItems = [];
      }
    }
    if (!extractedItems.length) {
      try {
        const extracted = await extractSchedulePdfWithServer({
          uri: targetUri, fileName: originalFileName,
          mimeType: file.mimeType || 'application/pdf',
          projects: scopeProjects,
          projectRecords: scopedProjectRecords,
          projectAreas: scopedProjectAreas,
          idempotencyKey: sourceIdentity.idempotencyKey,
        });
        extractedItems = extracted.items;
        extractionWarnings = extracted.warnings;
        extractionMethod = 'schedule service';
      } catch (error) {
        extractionIssue = error instanceof Error ? error.message : 'Automatic schedule extraction could not finish.';
      }
    }
    if (extractedItems.length > 0) {
      const validated = validateAndBindItems(extractedItems, extractionWarnings);
      const items = dedupeScheduleImportItems(
        validated.items as unknown as import('./types').ScheduleItem[],
      );
      return {
        id: sourceIdentity.batchId,
        kind: 'schedule_file',
        sourceCount: 1,
        sourceLabel: originalFileName,
        message: `${items.length} possible schedule ${items.length === 1 ? 'item' : 'items'} extracted using ${extractionMethod || 'schedule extraction'}. Confirm the highlighted fields before adding them.`,
        items,
        documents: [scheduleDocument],
        warnings: validated.warnings,
      };
    }
    const reviewItem = {
      ...normalizeScheduleItem({
        taskName: 'New Schedule Item', projectName: onlyProject || '', locationName: '',
        startDate: '', finishDate: '', milestone: 'Imported PDF Schedule', owner: '',
        status: 'Not Started', notes: '', importedFrom: originalFileName,
        importedAt: new Date().toISOString(),
      }),
      taskName: '',
    };
    const validatedReview = validateAndBindItems(
      [reviewItem] as unknown as ScheduleItem[],
    );
    return {
      id: sourceIdentity.batchId,
      kind: 'schedule_file',
      sourceCount: 1,
      sourceLabel: originalFileName,
      message: `The PDF was saved, but no dated activities were extracted. ${extractionIssue || 'Enter the actual task name and complete every highlighted field below.'}`,
      items: validatedReview.items as unknown as import('./types').ScheduleItem[],
      documents: [scheduleDocument],
      warnings: validatedReview.warnings,
    };
  }

  async function importScheduleFile(
    onProcessingStart: () => void = () => undefined,
  ): Promise<PIEScheduleImportBatch | null> {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['application/pdf', 'text/csv', 'text/plain', 'application/vnd.ms-excel', 'application/json'],
        copyToCacheDirectory: true,
      });
      if (result.canceled) return null;
      const file = result.assets[0];
      if (!file) return null;
      await preflightExpoFileRead({ uri: file.uri, reportedSizeBytes: file.size });
      onProcessingStart();
      return await prepareScheduleImportFromAsset(file);
    } catch (error) {
      Alert.alert(
        'Import failed',
        error instanceof Error ? error.message : 'The schedule file could not be imported. Try a PDF, CSV, or plain text schedule file.',
      );
      return null;
    }
  }

  async function importScheduleCommunicationScreenshot(
    onProcessingStart: () => void = () => undefined,
  ): Promise<PIEScheduleImportBatch | null> {
    if (!scheduleScreenshotOcrAvailable) {
      Alert.alert(
        'Screenshot recognition unavailable',
        Platform.OS === 'ios'
          ? 'This installed app does not yet include local screenshot recognition. Install the updated app build, then import the screenshots again.'
          : 'Message and email screenshot recognition is currently available only on iPhone and iPad. Use a schedule file or add the task manually on this device.',
      );
      return null;
    }

    const stagedDocuments: ReferenceDocument[] = [];

    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert(
          'Photo access needed',
          'Allow photo access to select a screenshot of a text message or email.',
        );
        return null;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsMultipleSelection: true,
        selectionLimit: 20,
        orderedSelection: true,
        quality: 1,
      });
      if (result.canceled || !result.assets.length) return null;

      onProcessingStart();

      const directory = await ensureReferenceDocumentsDirectory();
      const importedAt = new Date().toISOString();
      const extractedItems: ScheduleItem[] = [];

      for (const [index, asset] of result.assets.entries()) {
        await preflightExpoFileRead({ uri: asset.uri, reportedSizeBytes: asset.fileSize });
        const mimeType = asset.mimeType || 'image/jpeg';
        const originalFileName = asset.fileName || filenameFromUri(asset.uri, index, mimeType);
        const storedFileName = `${uid()}-${sanitizeFilename(originalFileName)}`;
        const targetUri = `${directory}${storedFileName}`;
        await FileSystem.copyAsync({ from: asset.uri, to: targetUri });

        stagedDocuments.push(normalizeReferenceDocument({
          id: uid(),
          name: `Schedule message - ${originalFileName.replace(/\.[^/.]+$/, '')}`,
          originalFileName,
          uri: targetUri,
          mimeType,
          category: 'Other',
          notes: '[Schedule communication screenshot] Imported for local text recognition and schedule review.',
          isCurrent: false,
          importedAt,
        }));

        let sourceItems: ScheduleItem[] = [];
        if (isDaveTextRecognitionAvailable()) {
          try {
            const recognized = await withScheduleImportTimeout(
              recognizeTextFromImage(targetUri),
              20_000,
              `Text recognition timed out for ${originalFileName}.`,
            );
            const communicationImport = extractScheduleItemsFromCommunicationText({
              text: recognized.text,
              sourceName: originalFileName,
              projects,
              projectAreas: projectAreas as unknown as Parameters<typeof extractScheduleItemsFromCommunicationText>[0]['projectAreas'],
              recognitionConfidence: recognized.averageConfidence,
            });
            sourceItems = communicationImport.items as unknown as ScheduleItem[];
          } catch {
            sourceItems = [];
          }
        }

        extractedItems.push(...sourceItems);
      }

      const items = dedupeScheduleImportItems(extractedItems as unknown as import('./types').ScheduleItem[]);
      if (!items.length) {
        await Promise.all(stagedDocuments.map(document =>
          deleteStoredReferenceDocument(document.uri).catch(() => undefined),
        ));
        Alert.alert(
          'No schedule activities found',
          'The selected images did not contain a clear task or schedule commitment. Try screenshots with the complete message and date visible.',
        );
        return null;
      }

      return {
        id: uid(),
        kind: 'message_screenshots',
        sourceCount: result.assets.length,
        sourceLabel: `${result.assets.length} message ${result.assets.length === 1 ? 'screenshot' : 'screenshots'}`,
        message: `${items.length} possible schedule ${items.length === 1 ? 'activity' : 'activities'} prepared from ${result.assets.length} ${result.assets.length === 1 ? 'image' : 'images'}. Duplicates were removed.`,
        items,
        documents: stagedDocuments,
      };
    } catch (error) {
      await Promise.all(stagedDocuments.map(document =>
        deleteStoredReferenceDocument(document.uri).catch(() => undefined),
      ));
      Alert.alert(
        'Screenshot review failed',
        error instanceof Error
          ? error.message
          : 'The screenshot could not be read. Try a clear screenshot with the complete message visible.',
      );
      return null;
    }
  }
  async function approveScheduleImport(batch: PIEScheduleImportBatch): Promise<void> {
    let scheduleSyncItems: ScheduleItem[] = [];
    let referenceDocumentSyncRecords: ReferenceDocument[] = [];
    const archivedKeys = new Set(
      archivedProjectsCurrentRef.current.map(name => name.trim().toLowerCase()),
    );
    const deletedKeys = new Set(
      deletedProjectNamesRef.current.map(name => name.trim().toLowerCase()),
    );
    const activeProjectRecords = projectsCurrentRef.current
      .filter(name => {
        const key = name.trim().toLowerCase();
        return key && !archivedKeys.has(key) && !deletedKeys.has(key);
      })
      .map(name => {
        const record = projectRecordsCurrentRef.current.find(candidate =>
          candidate.name.trim().toLowerCase() === name.trim().toLowerCase(),
        );
        return {
          id: record?.id || authorityProjectId(name),
          name,
        };
      });
    const documentScopeKeys = new Set(
      batch.documents
        .flatMap(document => document.projectNames || [])
        .map(name => name.trim().toLowerCase())
        .filter(Boolean),
    );
    const selectedProjectRecords = documentScopeKeys.size
      ? activeProjectRecords.filter(project =>
          documentScopeKeys.has(project.name.trim().toLowerCase()),
        )
      : activeProjectRecords;
    const scopeValidation = validateScheduleImportScope({
      items: batch.items,
      selectedProjects: selectedProjectRecords,
      selectedProjectAreas: selectedProjectRecords.map(project => ({
        projectId: project.id,
        areas: projectAreasForProject({
          projectAreas: projectAreasCurrentRef.current,
          projectName: project.name,
          scheduleItems: scheduleItemsCurrentRef.current,
          updates: savedUpdatesRef.current,
        }).map(area => ({ id: area.id, name: area.name })),
      })),
      unavailableProjects: [
        ...archivedProjectsCurrentRef.current.map(name => ({
          id: projectRecordsCurrentRef.current.find(record =>
            record.name.trim().toLowerCase() === name.trim().toLowerCase(),
          )?.id || authorityProjectId(name),
          name,
          state: 'archived' as const,
        })),
        ...deletedProjectNamesRef.current.map(name => ({
          id: projectRecordsCurrentRef.current.find(record =>
            record.name.trim().toLowerCase() === name.trim().toLowerCase(),
          )?.id || authorityProjectId(name),
          name,
          state: 'deleted' as const,
        })),
      ],
    });
    const approvalBlocker = scheduleImportApprovalBlocker(scopeValidation, batch.items);
    if (approvalBlocker) throw new ScheduleImportReviewError(approvalBlocker);

    const approvedBatch = bindPIEScheduleImportBatchProvenance({
      ...batch,
      items: scopeValidation.items,
      warnings: [
        ...(batch.warnings || []),
        ...scopeValidation.warnings.map(value => value.message),
      ],
    });
    const approvedItems = canonicalizeScheduleIdentityItems(
      approvedBatch.items.map(item =>
        normalizeScheduleItem(item as unknown as Partial<ScheduleItem>),
      ),
      projectAreasCurrentRef.current,
      identityCorrections,
      daveRegisteredIdentityNames({ projectNames: projectsCurrentRef.current, projectAreas: projectAreasCurrentRef.current }),
    );

    let synchronizedItems = scheduleItemsCurrentRef.current;
    if (approvedItems.length) {
      ensureScheduleParentProjects(approvedItems);
      // Unchanged tasks move to this import and changed tasks keep the
      // manager's confirmed progress (audit A5: a re-import hid most tasks).
      const merged = mergeApprovedScheduleImportItems({
        existing: scheduleItemsCurrentRef.current as unknown as import('./types').ScheduleItem[],
        imported: approvedItems as unknown as import('./types').ScheduleItem[],
        completionMatch: findExactScheduleTaskForCompletionClaim,
        isCurrent: scheduleItemsVisibleBeforeImport(scheduleItemsCurrentRef.current, referenceDocumentsCurrentRef.current, approvedBatch.id),
        overlay: scheduleImportAddsToMaster(approvedBatch, referenceDocumentsCurrentRef.current), // a lookahead restates the master's tasks in place (owner answer Q22)
        mergeCompletion: (item, importedItem) => normalizeScheduleItem(
          mergeReportedCompletionClaim(item, importedItem) as unknown as Partial<ScheduleItem>,
        ) as unknown as import('./types').ScheduleItem,
      });
      const next = merged.next as unknown as ScheduleItem[];
      const additions = merged.additions.map(item =>
        normalizeScheduleItem(item as unknown as Partial<ScheduleItem>));
      synchronizedItems = reconcileDAVEScheduleRecords([...additions, ...next]);
      const previousById = new Map(
        scheduleItemsCurrentRef.current.map(item => [item.id, item]),
      );
      scheduleSyncItems = synchronizedItems
        .filter(item => JSON.stringify(item) !== JSON.stringify(previousById.get(item.id)));
    }

    // Labelled by the approved rows' projects (a later Accept Selected widens
    // the saved one); no other schedule is demoted, since each project picks
    // its own current schedule (audit A5 pass 2).
    const labelledDocuments = scheduleDocumentsAfterApproval({
      documents: referenceDocumentsCurrentRef.current,
      approvedDocuments: approvedBatch.documents,
      approvedItems: approvedItems as unknown as import('./types').ScheduleItem[],
      updatedAt: new Date().toISOString(),
    });
    const previousDocuments = new Set<ReferenceDocument>(referenceDocumentsCurrentRef.current);
    const synchronizedDocuments = labelledDocuments.map(document =>
      previousDocuments.has(document) ? document : normalizeReferenceDocument(document));
    const previousDocumentById = new Map(
      referenceDocumentsCurrentRef.current.map(document => [document.id, document]),
    );
    referenceDocumentSyncRecords = synchronizedDocuments
      .filter(document =>
        JSON.stringify(document) !== JSON.stringify(previousDocumentById.get(document.id)),
      );

    const syncResult = await runScheduleImportCloudSync({
      scheduleItems: scheduleSyncItems,
      referenceDocuments: referenceDocumentSyncRecords,
    });
    if (!syncResult.durablyQueued) {
      throw new Error(
        syncResult.errors[0] ||
        'The reviewed schedule could not be protected for recovery. Try saving it again.',
      );
    }

    const supersededScheduleItemIds = new Set(syncResult.supersededScheduleItemIds);
    const supersededReferenceDocumentIds = new Set(
      syncResult.supersededReferenceDocumentIds,
    );
    const uploadedReferenceDocumentsById = new Map(
      (syncResult.uploadedReferenceDocuments || []).map(document => [
        document.id,
        document,
      ]),
    );
    const cloudAlignedSynchronizedDocuments = uploadedReferenceDocumentsById.size
      ? synchronizedDocuments.map(document =>
          uploadedReferenceDocumentsById.get(document.id) || document,
        )
      : synchronizedDocuments;
    const appliedSynchronizedItems = supersededScheduleItemIds.size
      ? synchronizedItems.filter(item => !supersededScheduleItemIds.has(item.id))
      : synchronizedItems;
    const appliedSynchronizedDocuments = supersededReferenceDocumentIds.size
      ? cloudAlignedSynchronizedDocuments.filter(document =>
          !supersededReferenceDocumentIds.has(document.id),
        )
      : cloudAlignedSynchronizedDocuments;
    const protectedDeletionCount =
      supersededScheduleItemIds.size + supersededReferenceDocumentIds.size;

    if (approvedItems.length) {
      markScheduleItemsAuthorityReady(true);
      scheduleItemsCurrentRef.current = appliedSynchronizedItems;
      setScheduleItems(appliedSynchronizedItems);
    }
    if (referenceDocumentSyncRecords.length > 0) {
      markReferenceDocumentsAuthorityReady(true);
      referenceDocumentsCurrentRef.current = appliedSynchronizedDocuments;
      setReferenceDocuments(appliedSynchronizedDocuments);
    }
    // "Import This Schedule" from a phone card: the card is current, as its import is; it stayed
    // "Make Current Schedule", which then hid the imported tasks (whole-app audit A8 pass 2 #2).
    const importedCard = projectScheduleImportCardRef.current;
    if (importedCard?.batchId === batch.id) {
      projectScheduleImportCardRef.current = null;
      if (!approvedBatch.documents.some(document => supersededReferenceDocumentIds.has(document.id))) markProjectScheduleCardCurrent(importedCard.documentId);
    }

    if (protectedDeletionCount > 0) {
      Alert.alert(
        protectedDeletionCount === 1
          ? 'Deleted schedule record stayed deleted'
          : 'Deleted schedule records stayed deleted',
        `${protectedDeletionCount} ${
          protectedDeletionCount === 1 ? 'record in this import was' : 'records in this import were'
        } deleted earlier on this or another device, so ${
          protectedDeletionCount === 1 ? 'it was' : 'they were'
        } not added back. Add a task by hand if it is still needed. Any other unfinished cloud work will retry automatically.`,
      );
    } else if (!syncResult.fullySynced) {
      Alert.alert(
        'Schedule saved on this device',
        'The reviewed schedule is protected in the local recovery queue. Vitruvius will retry any unfinished cloud work automatically.',
      );
    }
  }

  function ensureScheduleParentProjects(
    items: ScheduleItem[],
    options: { allowDeletedProjects?: boolean; reopenArchivedParents?: boolean } = {},
  ) {
    // Audit P1-57: creating a missing parent project is separate from archive
    // state. Only an explicit user transition (e.g. approving an import into
    // that project) may reopen an archived project; background schedule
    // mutations never do.
    const { allowDeletedProjects = false, reopenArchivedParents = false } = options;
    const discoveredParentNames = scheduleParentProjectNames(
      items as unknown as import('./types').ScheduleItem[],
    );
    if (allowDeletedProjects) {
      discoveredParentNames.forEach(clearProjectDeletion);
    }
    const deletedKeys = new Set(
      deletedProjectNamesRef.current.map(name => name.toLowerCase()),
    );
    const parentNames = discoveredParentNames.filter(
      name => allowDeletedProjects || !deletedKeys.has(name.toLowerCase()),
    );
    if (!parentNames.length) return;

    const { missingNames, reopeningNames } = resolveScheduleParentActions({
      parentNames,
      existingProjects: projects,
      archivedProjects,
      reopenArchivedParents,
    });

    if (missingNames.length) {
      setProjects(previous => mergeProjectNames(previous, missingNames));
      setProjectRecords(previous => [
        ...missingNames
          .filter(name => !previous.some(project => project.name.toLowerCase() === name.toLowerCase()))
          .map(name => ({ name })),
        ...previous,
      ]);
    }

    if (reopeningNames.length) {
      const reopeningKeys = new Set(reopeningNames.map(name => name.toLowerCase()));
      setArchivedProjects(previous => previous.filter(
        project => !reopeningKeys.has(project.toLowerCase()),
      ));
      reopeningNames.forEach(name => setCloudProjectArchived(name, false));
    }

    missingNames.forEach(name => {
      const key = name.toLowerCase();
      if (scheduleParentProjectsQueuedRef.current.has(key)) return;
      scheduleParentProjectsQueuedRef.current.add(key);
      saveCloudProject(name);
    });
  }

  function cancelScheduleImport(batch: PIEScheduleImportBatch) {
    if (projectScheduleImportCardRef.current?.batchId === batch.id) projectScheduleImportCardRef.current = null;
    batch.documents.forEach(document => {
      deleteStoredReferenceDocument(document.uri).catch(() => undefined);
    });
  }

  function openSavedUpdate(update: ProjectUpdate, returnScreen: AppScreen = 'SavedUpdates') {
    const lifecycle = lifecycleStatusForUpdate(update);
    updateDetailReturnScreenRef.current = returnScreen;

    if (!isResumableFieldUpdateStatus(lifecycle)) {
      // Audit P1-56: opening any update binds the workspace to that update's
      // project, so Back, Talk, and reports target the right project.
      setSelectedWorkspaceProject(update.projectName);
      setSelectedDetailUpdate(update);
      setScreen('UpdateDetail', { backTarget: returnScreen });
      return;
    }

    if (draftRef.current.id === update.id) {
      // Already open as the draft, possibly with newer edits than the saved
      // copy: go to it. Replacing it discarded those edits and deleted their
      // photo files (whole-app audit A4, 29 Sep 2026).
      setSelectedWorkspaceProject(update.projectName);
      setScreen(screenForUpdateResume(draftRef.current));
      return;
    }

    if (hasDraftContent(draft)) {
      const photoCount = draft.photos.length;
      Alert.alert(
        'Unfinished update found',
        `Opening a saved update will replace the current unfinished draft (${draft.projectName || 'no project'}, ${photoCount} photo${photoCount === 1 ? '' : 's'}).`,
        [
          {
            text: 'Cancel',
            style: 'cancel',
          },
          {
            text: 'Open Saved Update',
            style: 'destructive',
            onPress: () => {
              const discardedDraft = draftRef.current;

              draftRef.current = update;
              setDraft(update);
              setSelectedWorkspaceProject(update.projectName);
              setScreen(screenForUpdateResume(update));

              void discardDraftAfterReplacement(discardedDraft);
            },
          },
        ],
      );

      return;
    }

    setDraft(update);
    setSelectedWorkspaceProject(update.projectName);
    setScreen(screenForUpdateResume(update));
  }

  function deleteSavedUpdate(updateId: string, onConfirmed?: () => void) {
    const update = savedUpdatesRef.current.find(item => item.id === updateId);
    if (!update) return;
    const updateLocation = [
      update.projectName,
      update.selectedAreaName,
      update.scheduleTaskName,
      formatDisplayDate(update.date),
    ].filter(Boolean).join(' · ');

    Alert.alert(
      'Permanently delete this update?',
      `This removes the saved field update for ${updateLocation || 'this project'} from this phone and stops it affecting project status. Its cloud record will be deleted automatically when sync is available. Warnings caused only by this update will clear. Original evidence files may remain in secure audit storage. This cannot be undone.`,
      [
        {
          text: 'Cancel',
          style: 'cancel',
        },
        {
          text: 'Delete Update',
          style: 'destructive',
          onPress: async () => {
            if (updateDeletionInFlightRef.current) return;
            const currentUpdates = savedUpdatesRef.current;
            const deletedUpdate = currentUpdates.find(
              update => update.id === updateId,
            );
            if (!deletedUpdate) return;
            updateDeletionInFlightRef.current = true;

            const tombstone = buildUpdateTombstone(
              deletedUpdate,
              'delete_update_everywhere',
            );

            try {
              const deletion = await persistAndQueueProjectUpdateDeletion({
                update: deletedUpdate,
                tombstone,
                getCurrentUpdates: () => savedUpdatesRef.current,
                getCurrentTombstones: () => deletedUpdateTombstonesRef.current,
                updatesStorageKey: UPDATES_STORAGE_KEY,
                tombstonesStorageKey: DELETED_UPDATES_STORAGE_KEY,
              });
              const { remainingUpdates, nextTombstones } = deletion;

              savedUpdatesRef.current = remainingUpdates;
              deletedUpdateTombstonesRef.current = nextTombstones;
              setDeletedUpdateTombstones(nextTombstones);
              setSavedUpdates(remainingUpdates);

              // The deleted update was open as the draft: the draft goes
              // too, or its next save would be dropped by the barrier behind
              // "Field update saved" (whole-app audit A4, 29 Sep 2026).
              const openDraftDeleted = draftRef.current.id === updateId;
              if (openDraftDeleted) clearOpenDraft(deletedUpdate.projectName);

              void deleteUnreferencedPhotosFromUpdate(
                deletedUpdate,
                [
                  ...(openDraftDeleted ? [] : [draftRef.current]),
                  ...remainingUpdates,
                ],
              );
              if (deletion.phase === 'barrier_committed') {
                void reconcileProjectUpdateDeletionJournal(nextTombstones).catch(() => undefined);
                Alert.alert('Update removed', 'The deletion barrier is saved and the update no longer affects project status. Remaining device or cloud cleanup will retry automatically.');
              }
              onConfirmed?.();
            } catch {
              Alert.alert(
                'Update not deleted',
                'No deletion barrier could be saved, so nothing was removed. Please try again.',
              );
            } finally {
              updateDeletionInFlightRef.current = false;
            }
          },
        },
      ],
    );
  }

  function archiveSavedUpdate(updateId: string, onConfirmed?: () => void) {
    Alert.alert(
      'Archive cloud-synced update?',
      'This hides the update from default views without deleting its cloud record.',
      [
        {
          text: 'Cancel',
          style: 'cancel',
        },
        {
          text: 'Archive',
          onPress: () => {
            const archivedAt = new Date().toISOString();
            const update = savedUpdates.find(item => item.id === updateId);
            if (update) {
              const tombstone = buildUpdateTombstone(update, 'archive_sent_update', archivedAt);
              setDeletedUpdateTombstones(prev =>
                upsertDeletedUpdateTombstone(prev, tombstone),
              );
              void reconcileProjectUpdateDeletionJournal([tombstone]);
            }
            setSavedUpdates(prev =>
              prev.map(update =>
                update.id === updateId
                  ? {
                      ...update,
                      isArchived: true,
                      archivedAt,
                      deleteDiagnostics: {
                        updateId: update.id,
                        localId: update.stableSendId || update.id,
                        cloudIdPresent: true,
                        lifecycleStatus: lifecycleStatusForUpdate(update),
                        pendingSync: false,
                        tombstoned: true,
                        deletedAt: archivedAt,
                        sourceAfterReload: 'local',
                        mergeDecision: 'tombstoned',
                        orphanedPhotoCountIgnored: 0,
                      },
                    }
                  : update,
              ),
            );

            onConfirmed?.();
          },
        },
      ],
    );
  }

  function requestBuildUpdate() {
    continueToReview();
  }

  const resumedSavedDraft = savedUpdates.some(
    update =>
      update.id === draft.id &&
      lifecycleStatusForUpdate(update) !== 'sent' &&
      lifecycleStatusForUpdate(update) !== 'queued',
  );

  function deleteResumedSavedDraft() {
    const projectName = draft.projectName;

    // deleteSavedUpdate clears the open draft itself when it is the deleted update.
    deleteSavedUpdate(draft.id, () => {
      setSelectedWorkspaceProject(projectName);
      setScreen(updateDetailReturnScreenRef.current);
    });
  }

  const unfinishedDraft =
    hasDraftContent(draft) ? draft : null;

  const contentTopPadding = appShellContentTopPadding({
    layout: appShellLayout,
    safeAreaTop: insets.top,
    platform: Platform.OS,
  });
  const contentStyle = useMemo(
    () => [
      styles.content,
      {
        paddingTop: contentTopPadding,
      },
    ],
    [contentTopPadding],
  );

  const authoritativeScheduleItems = useMemo(
    () => selectAuthoritativeScheduleItems({
      scheduleItems: scheduleItems as unknown as Parameters<typeof selectAuthoritativeScheduleItems>[0]['scheduleItems'],
      scheduleDocuments: referenceDocuments as unknown as Parameters<typeof selectAuthoritativeScheduleItems>[0]['scheduleDocuments'],
    }) as unknown as ScheduleItem[],
    [referenceDocuments, scheduleItems],
  );

  const layer4EvidenceCatalog = useMemo<PIEEvidenceReference[]>(() => {
    const projectId = authorityProjectId(selectedWorkspaceProject);
    const organizationId = layer4Identity?.organizationId || 'unverified';
    const updateEvidence = projectUpdatesForParentProject(
      activeSavedUpdates,
      selectedWorkspaceProject,
      authoritativeScheduleItems,
    )
      .flatMap(update => {
        const updateReference: PIEEvidenceReference = {
          id: `update-${update.id}`,
          sourceType: 'project_update',
          organizationId,
          projectId,
          summary: update.notes || `${update.projectName} field update`,
          capturedAt: update.date,
          versionId: update.date,
          contentHash: `${update.id}:${update.date}:${update.photos.length}`,
        };
        const photoReferences = update.photos.map(photo => ({
          id: `photo-${photo.id}`,
          sourceType: 'photo' as const,
          organizationId,
          projectId,
          summary: photo.caption || `Photo from ${update.selectedAreaName || update.projectName}`,
          capturedAt: photo.locationCapturedAt || update.date,
          uri: photo.uri,
          versionId: photo.locationCapturedAt || update.date,
          contentHash: `${photo.id}:${photo.uri}:${photo.caption}`,
        }));
        return [updateReference, ...photoReferences];
      });
    const scheduleEvidence = authoritativeScheduleItems
      .filter(item =>
        [item.projectName, item.scheduleProjectName, item.locationName]
          .some(value => value?.trim().toLowerCase() === selectedWorkspaceProject.trim().toLowerCase()),
      )
      .map(item => ({
        id: `schedule-${item.id}`,
        sourceType: 'schedule_item' as const,
        organizationId,
        projectId,
        summary: `${item.taskName}: ${item.status} (${item.percentComplete}% complete)`,
        capturedAt: item.importedAt || item.createdAt || item.finishDate || item.startDate,
        versionId: item.importedAt || item.createdAt || item.finishDate || item.startDate || null,
        contentHash: `${item.id}:${item.status}:${item.percentComplete}:${item.finishDate}`,
      }));

    return [...updateEvidence, ...scheduleEvidence];
  }, [activeSavedUpdates, authoritativeScheduleItems, layer4Identity?.organizationId, selectedWorkspaceProject]);

  useEffect(() => {
    if (!startupHydrationReady) return;
    let active = true;
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    let refreshGeneration = 0;
    let lastRefreshStartedAt = 0;
    // Field fix 2026-07-18: auth events can arrive in bursts (each identity
    // resolve touches the Supabase client, which can itself emit events).
    // A minimum interval and an in-flight guard make this cycle-proof.
    const MIN_REFRESH_INTERVAL_MS = 2000;

    async function refreshLayer4Identity(generation: number) {
      lastRefreshStartedAt = Date.now();
      const resolution = await resolvePIELayer4ActorContext();
      if (!active || generation !== refreshGeneration) return;
      const state = await loadPIEDecisionLedgerForOrganization(resolution.context.organizationId);
      if (!active || generation !== refreshGeneration) return;
      // Commit identity and its organization-scoped ledger together only after
      // both reads succeed. A failed/account-switched read therefore leaves no
      // prior account decisions visible in the new session.
      setDecisionLedger(state.decisions);
      setDecisionLedgerMigrationStatus(state.migrationStatus);
      setLayer4Identity(resolution.context);
      setLayer4IdentityReady(true);
    }

    function scheduleIdentityRefresh(clearIdentity = true) {
      if (refreshTimer) clearTimeout(refreshTimer);
      refreshGeneration += 1;
      const generation = refreshGeneration;
      // The same account's hourly token refresh keeps what Reports shows while
      // it re-reads, instead of "Loading Project Data" (whole-app audit A6 pass 6 #5).
      if (clearIdentity) {
        setLayer4Identity(null);
        setLayer4IdentityReady(false);
        setDecisionLedger([]);
        setDecisionLedgerMigrationStatus(null);
      }
      const elapsed = Date.now() - lastRefreshStartedAt;
      const delay = Math.max(0, MIN_REFRESH_INTERVAL_MS - elapsed);
      refreshTimer = setTimeout(() => {
        refreshTimer = null;
        void refreshLayer4Identity(generation).catch(() => undefined);
      }, delay);
    }

    scheduleIdentityRefresh();
    let lastUserId: string | null | undefined;
    const unsubscribe = subscribeToAuthStateChange((event, session) => {
      // Defer client work until after Supabase's auth callback has returned.
      // A sign-out or another account drops photo analyses in progress; the
      // hourly token refresh and a name save do not (whole-app audit A1 pass 1).
      // A transient null (an offline start, owner answer Q13) is not an account.
      const change = workspaceAccountChange(lastUserId, event, session?.user?.id);
      if (!change) return;
      const { firstEvent, accountChanged } = change;
      lastUserId = change.userId;
      if (accountChanged) photoAnalysisCoordinator.clear();
      // The account's name is taken at startup or with another account, not
      // from the echo of this phone's own save, which trimmed the field while
      // it was being typed ("David " then "Famularo" became "DavidFamularo").
      const accountName = accountDisplayNameForUser(session?.user);
      if (accountName && (firstEvent || accountChanged)) setDisplayName(accountName);
      scheduleIdentityRefresh(accountChanged);
      // Updates stamped "Sign in required to sync" re-sync after a sign-in
      // anywhere, not only the photo-analysis modal (whole-app audit A4,
      // 29 Sep 2026). Deferred, as above.
      if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
        setTimeout(() => startAutomaticSyncBackgroundTask('signed_in', hydrateQueuedUpdates), 0);
      }
      // Another account must not inherit this one's report narrative or
      // approval (audit A6, pass 2), whether or not a sign-out came first (A1).
      if (accountChanged) forgetAllReportSessionState();
      if (accountChanged) forgetFieldNoteDraft(); // nobody's unsaved field note carries over (audit A2 M3)
    });

    return () => {
      active = false;
      if (refreshTimer) clearTimeout(refreshTimer);
      photoAnalysisCoordinator.clear();
      unsubscribe();
    };
  }, [photoAnalysisCoordinator, startupHydrationReady]);

  async function createAutomatedDecisionSnapshot(
    judgment: PIEExecutiveJudgmentRecord | null | undefined,
    silent = false,
  ) {
    if (!judgment || !layer4Identity?.permissions.includes('create_decision_candidate')) return;

    try {
      const result = createDecisionSnapshotFromJudgment({
        judgment,
        existingDecisions: decisionLedger,
        actor: layer4Identity.actor,
        evidence: layer4EvidenceCatalog,
      });
      if (!result.created || !result.decision) return;
      const proposalCommit =
        await localPIEDecisionHistoryActions.persistProposal(result.decision);
      const automated = automateLayer4DecisionLifecycle({
        decision: proposalCommit.decision,
        actor: layer4Identity.actor,
        evidence: layer4EvidenceCatalog,
      });
      if (!automated.decision) return;
      const automatedDecision = automated.decision;
      const next = [
        automatedDecision,
        ...proposalCommit.decisions.filter(item => item.id !== automatedDecision.id),
      ];
      setDecisionLedger(next);
      // A newly proposed decision normally remains unchanged by the lifecycle
      // review. If a future low-risk automatic transition does modify it, keep
      // that later version in the same organization ledger. The proposal was
      // already saved and queued first, preserving its immutable baseline.
      if (automatedDecision !== proposalCommit.decision) {
        await savePIEDecisionLedgerForOrganization(
          layer4Identity.organizationId,
          next,
        );
      }
    } catch {
      if (!silent) {
        Alert.alert('Decision review unavailable', 'This decision could not be prepared for review yet.');
      }
    }
  }

  const reportAvailableProjectNames = useMemo(
    () => scheduleOverviewProjectNames(
      activeProjects,
      authoritativeScheduleItems as unknown as import('./types').ScheduleItem[],
      archivedProjects,
    ),
    [activeProjects, authoritativeScheduleItems, archivedProjects],
  );
  const {
    reportType,
    reportFormat,
    selectedProjectNames: selectedReportProjectNames,
    setReportFormat,
    changeReportType,
    toggleReportProject,
  } = useReportSelection({
    availableProjectNames: reportAvailableProjectNames,
    selectedWorkspaceProject,
    initialProjectName: DEFAULT_PROJECTS[0],
  });

  const talkCandidateTasks = useMemo(() => {
    if (!talkProjectName) return [];

    return [...scheduleTasksForParentProject(
      talkProjectName,
      authoritativeScheduleItems as unknown as import('./types').ScheduleItem[],
    )]
      .sort((left, right) => {
        const completionOrder = Number(scheduleTaskIsComplete(left)) - Number(scheduleTaskIsComplete(right));
        return completionOrder || left.taskName.localeCompare(right.taskName);
      })
      .map(item => ({
        id: item.id,
        taskName: item.taskName,
        detail: `${item.locationName || 'No area'} · ${item.status} · ${item.percentComplete}%`,
        isComplete: scheduleTaskIsComplete(item),
      }));
  }, [authoritativeScheduleItems, talkProjectName]);

  function projectIntelligenceForTalk(projectName: string, taskId: string | null = null,
    talkReferenceDocuments: readonly ReferenceDocument[] = referenceDocuments) {
    return buildECOSTalkProjectIntelligence({
      projectId: authorityProjectId(projectName),
      projectName,
      taskId,
      updates: activeSavedUpdates,
      scheduleItems: authoritativeScheduleItems,
      projectDocuments,
      referenceDocuments: talkReferenceDocuments,
      captureMemories,
    });
  }

  function openTalk() {
    if (keptTalkCapture.reopen()) return; // a kept unconfirmed memory comes back first
    const contextualProject = talkContextProjectForScreen(
      screen,
      selectedWorkspaceProject,
      selectedReportProjectNames[0] || null,
    );
    setTalkProjectName(contextualProject || '');
    setTalkTaskId(null);
    talkSession.start();
    setTalkAnswer(null);
    setTalkTypedOpen(false);
    setTalkVoiceOpen(true);
  }

  function openGuidedTaskFromTalk() {
    const projectName = talkProjectName.trim();
    if (!projectName) return;
    setTalkVoiceOpen(false);
    setTalkTypedOpen(false);
    setTalkTaskId(null);
    setScheduleEntryFilter('All');
    setScheduleProjectFilter(projectName);
    setScheduleAddGuided(true);
    setScheduleAddProjectName(projectName);
    setScreen('Schedule');
  }

  function navigateFromTalk(
    target: DAVEConversationNavigationTarget,
    projectName: string,
  ) {
    if (target === 'overview') {
      setScreen('Home');
      return;
    }
    if (target === 'tasks') {
      setScheduleProjectFilter(projectName || null);
      setScreen('Schedule');
      return;
    }
    if (target === 'reports') {
      setScreen('Reports');
      return;
    }
    openProjectWorkspace(projectName);
  }

  function openTalkSupportingEvidence(
    projectName: string,
    citation: DAVEAskEvidence,
  ) {
    // Proof is a child view: the Talk answer stays and returns when it closes.
    if (citation.sourceType === 'document' && citation.documentCitation) {
      if (ecosDocumentProofClaimFromEvidence(citation)) {
        void ecosDocumentEvidence.openEvidence(citation);
        return;
      }
      // Talk answers are local; their document matches carry no proof claim (audit A9 pass 1 #3).
      // A follow-up's bare words are never sent, and Talk closes only once Ask ECOS starts (A9 pass 2 F2/F4).
      const question = talkAnswer?.askECOSQuestion || null;
      const notChecked = 'Talk found this in a project document, but Ask ECOS has not checked it, so its page cannot open here.';
      if (!ecosProjectQuestion.canAskFor(projectName)) {
        Alert.alert('Not checked by Ask ECOS', `${notChecked} Ask ECOS can check documents only for a synchronized project, and this project is not synchronized.`);
      } else if (!question) {
        Alert.alert('Not checked by Ask ECOS', `${notChecked} Ask the full question in Ask ECOS for checked proof.`);
      } else {
        Alert.alert('Not checked by Ask ECOS', `${notChecked} Ask ECOS can check it with this question: “${question}”`, [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Ask in Ask ECOS', onPress: () => { if (ecosProjectQuestion.askFor(projectName, question)) setTalkAnswer(null); } },
        ]);
      }
      return;
    }
    const intelligence = projectIntelligenceForTalk(projectName);
    const destination = resolveDAVEAskEvidenceNavigation(intelligence, citation);
    setTalkAnswer(null);
    setSelectedWorkspaceProject(projectName);

    if (destination.target === 'schedule') {
      setScheduleEntryFilter('All');
      setScheduleProjectFilter(projectName || null);
      setScreen('Schedule');
      return;
    }
    if (destination.target === 'project_documents') {
      setScreen('ProjectDocuments');
      return;
    }
    if (destination.target === 'capture') {
      createNewUpdate(projectName);
      return;
    }
    if (destination.target === 'update_detail') {
      const sourceUpdate = savedUpdates.find(update =>
        update.id === destination.sourceRecordId ||
        update.photos.some(photo => photo.id === destination.sourceRecordId),
      );
      if (sourceUpdate) {
        updateDetailReturnScreenRef.current = screen;
        setSelectedDetailUpdate(sourceUpdate);
        setScreen('UpdateDetail', { backTarget: screen });
        return;
      }
    }
    openProjectWorkspace(projectName);
  }

  async function persistTalkAnswer(
    projectName: string,
    question: string,
    answer: DAVEAskAnswer,
    context?: ReturnType<typeof resolveDAVEConversationContext>,
  ) {
    const projectId = authorityProjectId(projectName);
    const createdAt = new Date().toISOString();
    const entry: DAVEAskConversationEntry = {
      id: `ask:${encodeURIComponent(projectId)}:${createdAt}:${uid()}`,
      projectId,
      question,
      answer,
      createdAt,
      contextStatus: context?.status || 'standalone',
      resolvedQuestion: context && context.status !== 'standalone'
        ? context.effectiveQuestion
        : null,
      priorEntryId: context?.priorEntryId || null,
      followUpKind: context?.followUpKind || null,
    };
    talkSession.add(entry); // before saving, so a quick follow-up sees it (audit A9 pass 2 F1)
    await talkHistoryPersistence.append(projectId, entry);
  }

  function reportTalkAnswerPersistenceFailure(projectName: string, error: unknown) {
    reportStoragePersistenceFailure({
      storageKey: daveAskHistoryStorageKey(authorityProjectId(projectName)),
      label: 'Talk history',
      error,
    });
  }

  async function handleTalkInput(
    transcript: string,
    voiceResult?: DAVEVoiceUnderstandingResponse,
  ) {
    const mentionedProject = mentionedDAVEProject(
      transcript,
      reportAvailableProjectNames,
    );
    const projectName = mentionedProject || talkProjectName;
    const taskContextId = mentionedProject && mentionedProject !== talkProjectName
      ? null
      : talkTaskId;
    const projectId = authorityProjectId(projectName);
    // Only answers given since Talk was opened; saved history is not read back (audit A9 pass 2 F1).
    const history = talkSession.history();
    const context = resolveDAVEConversationContext({
      transcript,
      history,
      projectId,
    });
    const talkDocuments = await loadECOSTalkReferenceDocuments({
      client: getSupabaseClient(),
      documents: referenceDocuments,
      question: context.status === 'resolved_follow_up' ? context.effectiveQuestion : transcript,
      projectName,
    });
    const intelligence = projectIntelligenceForTalk(projectName, taskContextId, talkDocuments);
    const initialRoute = routeDAVEConversation({
      transcript,
      intelligence,
      interface: voiceResult ? 'voice' : 'text',
    });
    const route = initialRoute;
    const contextualAnswer = context.status === 'resolved_follow_up'
      ? answerDAVEConversationContext({
          resolution: context,
          intelligence,
          interface: voiceResult ? 'voice' : 'text',
        })
      : null;

    setTalkProjectName(projectName);
    setTalkTaskId(taskContextId);
    setTalkVoiceOpen(false);
    setTalkTypedOpen(false);

    if (context.status === 'ambiguous_follow_up') {
      Alert.alert('One detail needed', context.effectiveQuestion);
      return;
    }

    const askECOSQuestion = askECOSQuestionForTalk(context, history);
    if (contextualAnswer) {
      setTalkAnswer({ projectName, question: transcript.trim(), answer: contextualAnswer, askECOSQuestion });
      void persistTalkAnswer(projectName, transcript.trim(), contextualAnswer, context)
        .catch(error => reportTalkAnswerPersistenceFailure(projectName, error));
      return;
    }

    if (route.intent === 'ask') {
      setTalkAnswer({ projectName, question: transcript.trim(), answer: route.answer, askECOSQuestion });
      void persistTalkAnswer(projectName, transcript.trim(), route.answer, context)
        .catch(error => reportTalkAnswerPersistenceFailure(projectName, error));
      return;
    }

    if (route.intent === 'task_update') {
      const projectTasks = scheduleTasksForParentProject(
        projectName,
        authoritativeScheduleItems as unknown as import('./types').ScheduleItem[],
      ) as unknown as ScheduleItem[];
      const selectedContextTask = taskContextId
        ? projectTasks.find(item => item.id === taskContextId) || null
        : null;
      const candidates = selectedContextTask
        ? [selectedContextTask]
        : findDAVETaskCandidates(route.command, projectTasks);
      if (candidates.length === 0) {
        Alert.alert(
          'Task not found',
          `I couldn't find “${route.command.taskReference}” in ${projectName}. Try the task name shown on the Tasks screen.`,
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Talk Again', onPress: () => setTalkVoiceOpen(true) },
          ],
        );
        return;
      }
      setTalkTaskAction({
        projectName,
        command: route.command,
        candidates,
        selectedTaskId: candidates.length === 1 ? candidates[0].id : null,
      });
      return;
    }

    if (route.intent === 'navigate') {
      navigateFromTalk(route.target, projectName);
      return;
    }

    const understoodFields = voiceResult?.understanding.fields;
    const hasUnderstoodFields = understoodFields
      ? Object.values(understoodFields).some(Boolean)
      : false;
    setTalkCaptureDraft(buildDAVETalkMemoryDraft({
      id: `talk-memory-${uid()}`,
      createdAt: new Date().toISOString(),
      projectName,
      switchedProject: projectName !== talkProjectName,
      transcript: route.transcript,
      fields: hasUnderstoodFields ? understoodFields! : route.suggestedFields,
      voiceResult,
    }));
  }

  function confirmTalkTaskAction() {
    if (!talkTaskAction?.selectedTaskId) return;
    const task = talkTaskAction.candidates.find(item => item.id === talkTaskAction.selectedTaskId);
    if (!task) return;
    const previous = {
      status: task.status as ScheduleStatus,
      percentComplete: task.percentComplete,
    };
    const changes = talkTaskAction.command.changes as Partial<ScheduleItem>;
    updateScheduleItem(task.id, changes);
    const successMessage = `${task.taskName}: ${talkTaskAction.command.changeSummary}.`;
    setTalkTaskAction(null);
    Alert.alert('Task updated', successMessage, [
      {
        text: 'Undo',
        style: 'cancel',
        onPress: () => updateScheduleItem(task.id, previous),
      },
      { text: 'Done' },
    ]);
  }

  const ecosProjectQuestion = useECOSProjectQuestionExperience({
    documentEvidenceVisible: Boolean(ecosDocumentEvidence.state),
    contextualProjectName: talkContextProjectForScreen(
      screen,
      selectedWorkspaceProject,
      selectedReportProjectNames[0] || null,
    ),
    projectRecords,
    candidateProjects: reportAvailableProjectNames,
    onOpenEvidence: (projectName, evidence) => {
      if (evidence.sourceType === 'document' && evidence.documentCitation) {
        void ecosDocumentEvidence.openEvidence(evidence);
        return;
      }
      openTalkSupportingEvidence(projectName, evidence);
    },
  });
  const projectStatusReady = startupHydrationReady;
  const authorityMode = authorityModeForScreen(screen);

  const liveAuthorityInput = useMemo<PIELiveAuthorityInput>(() => {
    const workspaceProjectName =
      authorityMode === 'workspace' || authorityMode === 'reports'
        ? selectedWorkspaceProject
        : null;
    const primaryProjectName =
      overviewProjectName ||
      selectedWorkspaceProject ||
      activeProjects[0] ||
      DEFAULT_PROJECTS[0] ||
      'Current Project';
    const projectName =
      (authorityMode === 'reports' ? selectedReportProjectNames[0] : workspaceProjectName) ||
      (authorityMode === 'capture' || authorityMode === 'capture-review'
        ? captureIntelligenceProjectName(draft) // its parent, not an older task's building (A10 pass 2 F4)
        : primaryProjectName) ||
      primaryProjectName;
    const reportHasProjects = selectedReportProjectNames.length > 0; // none left: no report (audit A6 pass 5)
    const authorityReportType: PIEReportType | undefined =
      authorityMode !== 'reports' || !reportHasProjects
        ? undefined
        : reportFormat === 'executive'
          ? 'executive_summary'
          : reportType;
    const combinedReportScope = authorityMode === 'reports' && reportHasProjects && reportType === 'combined_project_update'
      ? buildCombinedReportAuthorityScope({
          selectedProjectNames: selectedReportProjectNames,
          projectRecords,
          // Recorded field updates only: the open draft had leaked into the
          // report (its photos cited, then declared missing, since the
          // attachments and the Word file read the saved updates); updates
          // of a deleted task stay out (whole-app audit A6, 29 Sep 2026).
          updates: activeSavedUpdates as unknown as import('./types').ProjectUpdate[],
          scheduleItems: authoritativeScheduleItems,
          currentUpdate: null,
          projectAreas, knownScheduleItems: scheduleItems, // every saved task: a revised task's hidden row (A10 pass 2 F1)
          referenceDocuments,
          projectDocuments,
          captureMemories,
          contacts: contactBook,
        })
      : null;
    const dailyReportScope = authorityMode === 'reports' && reportHasProjects && reportType === 'daily_project_update'
      ? buildDailyReportAuthorityScope({
          selectedProjectName: projectName,
          selectedProjectNames: [projectName],
          projectRecords,
          // Recorded field updates only: the open draft had leaked into the
          // report (its photos cited, then declared missing, since the
          // attachments and the Word file read the saved updates); updates
          // of a deleted task stay out (whole-app audit A6, 29 Sep 2026).
          updates: activeSavedUpdates as unknown as import('./types').ProjectUpdate[],
          scheduleItems: authoritativeScheduleItems,
          currentUpdate: null,
          projectAreas, knownScheduleItems: scheduleItems, // every saved task: a revised task's hidden row (A10 pass 2 F1)
          referenceDocuments,
          projectDocuments,
          captureMemories,
          contacts: contactBook,
        })
      : null;
    // Home, workspace and capture: this project's evidence only, as a daily report scopes it (audit round 2 L2).
    const reportEvidenceScope = combinedReportScope || dailyReportScope || buildProjectIntelligenceAuthorityScope({ selectedProjectName: projectName, projectRecords, updates: activeSavedUpdates as unknown as import('./types').ProjectUpdate[], scheduleItems: authoritativeScheduleItems, knownScheduleItems: scheduleItems, currentUpdate: draft, projectAreas, referenceDocuments, projectDocuments, captureMemories, contacts: contactBook });
    const scopedProjectId =
      combinedReportScope?.projectId || authorityProjectId(projectName);
    const verifiedLearningEvents =
      layer4Identity?.cloudTrusted &&
      layer4Identity.organizationStatus === 'verified' &&
      !combinedReportScope
        ? buildVerifiedLearningEventsFromDecisionLedger({
            decisions: decisionLedger,
            organizationId: layer4Identity.organizationId,
            projectId: scopedProjectId,
          })
        : [];

    return {
      organizationId: layer4Identity?.cloudTrusted
        ? layer4Identity.organizationId
        : null,
      projectId: scopedProjectId,
      projectName: reportEvidenceScope?.projectName || projectName,
      projectNames: reportEvidenceScope?.projectNames || [projectName],
      reportType: authorityReportType,
      updates: (
        reportEvidenceScope ? reportEvidenceScope.updates : activeSavedUpdates
      ) as unknown as PIELiveAuthorityInput['updates'],
      scheduleItems: (
        reportEvidenceScope ? reportEvidenceScope.scheduleItems : authoritativeScheduleItems
      ) as unknown as PIELiveAuthorityInput['scheduleItems'],
      currentUpdate: (
        reportEvidenceScope ? reportEvidenceScope.currentUpdate : draft
      ) as unknown as PIELiveAuthorityInput['currentUpdate'],
      projectAreas: (reportEvidenceScope ? reportEvidenceScope.projectAreas : projectAreas) as unknown as PIELiveAuthorityInput['projectAreas'],
      contacts: (reportEvidenceScope ? reportEvidenceScope.contacts : contactBook) as unknown as PIELiveAuthorityInput['contacts'],
      referenceDocuments: (reportEvidenceScope ? reportEvidenceScope.referenceDocuments : referenceDocuments) as unknown as PIELiveAuthorityInput['referenceDocuments'],
      projectDocuments: (reportEvidenceScope ? reportEvidenceScope.projectDocuments : projectDocuments) as unknown as PIELiveAuthorityInput['projectDocuments'],
      captureMemories: reportEvidenceScope ? reportEvidenceScope.captureMemories : captureMemories,
      verifiedLearningEvents,
      // Do not begin live authority work under the anonymous fallback while
      // the signed-in organization is still resolving. Large legacy Reality
      // Models otherwise make startup perform the same expensive pass twice.
      hydrated: projectStatusReady && layer4IdentityReady,
      surface: authoritySurfaceForMode(authorityMode),
      identityTrusted: Boolean(
        layer4Identity?.cloudTrusted &&
        layer4Identity.organizationStatus === 'verified',
      ),
      cloudAvailable: Boolean(
        layer4Identity?.cloudTrusted &&
        layer4Identity.organizationStatus === 'verified',
      ),
      projectTruthPersistencePolicy:
        combinedReportScope?.projectTruthPersistencePolicy || projectTruthPersistencePolicyFor(projectName, projects),
    };
  }, [
    activeProjects,
    authorityMode,
    contactBook,
    decisionLedger,
    draft,
    captureMemories,
    layer4Identity,
    layer4IdentityReady,
    overviewProjectName,
    projectAreas,
    projectDocuments,
    projectRecords,
    projectStatusReady,
    referenceDocuments,
    reportType,
    reportFormat,
    selectedReportProjectNames,
    activeSavedUpdates,
    authoritativeScheduleItems, scheduleItems, projects,
    selectedWorkspaceProject,
  ]);

  const liveDetailUpdate = selectedDetailUpdate
    ? savedUpdates.find(item => item.id === selectedDetailUpdate.id) || selectedDetailUpdate
    : null;

  return (
    <PIELiveAuthorityProvider input={liveAuthorityInput}><SavedFieldUpdatesContext.Provider value={savedUpdates}>
      <StartupHydrationBoundary
        ready={startupHydrationReady}
        failures={startupHydration.failures}
        onRetry={startupHydration.retry}
      >
        <AppShellFrame
          currentScreen={screen}
          onScreenChange={setScreen}
          onTalk={openTalk}
          onAskECOS={ecosProjectQuestion.open}
          taskProjects={scheduleWorkspaceProjectOptions(activeProjects, authoritativeScheduleItems)}
          selectedTaskProject={scheduleProjectFilter}
          onTaskProjectChange={projectName => {
            setScheduleProjectFilter(projectName);
            if (projectName) setSelectedWorkspaceProject(projectName);
          }}
          updateProjects={updateWorkspaceProjectOptions(activeProjects, savedUpdates)}
          selectedUpdateProject={updatesProjectFilter}
          onUpdateProjectChange={projectName => {
            setUpdatesProjectFilter(projectName);
            if (projectName) setSelectedWorkspaceProject(projectName);
          }}
          documentProjects={activeProjects}
          documentCount={referenceDocuments.length}
          selectedDocumentProject={selectedWorkspaceProject}
          onDocumentProjectChange={projectName => {
            if (projectName) setSelectedWorkspaceProject(projectName);
          }}
        >
          <LiveAuthorityStatusBanner />
          <OfflineSignInPendingBanner />
          {screen === 'Home' && (
            <HomeScreen
              contentStyle={contentStyle}
              projects={activeProjects}
              archivedProjects={archivedProjects}
              savedUpdates={activeSavedUpdates}
              scheduleItems={authoritativeScheduleItems}
              displayName={displayName}
              unfinishedDraft={unfinishedDraft}
              draftSavedAt={draftSavedAt}
              projectRecords={projectRecords}
              statusReady={projectStatusReady}
              onResumeDraft={resumeDraft}
              onDiscardDraft={discardDraft}
              onNewUpdate={createNewUpdate}
              onOpenProject={openProjectWorkspace}
              onOpenUpdate={update => openSavedUpdate(update, 'ProjectWorkspace')}
              onAddProject={addProject}
              onReopenProject={reopenProject}
              onOpenDueToday={() => {
                setScheduleEntryFilter('Today');
                setScreen('Schedule');
              }}
              onOpenAllActivity={() => {
                setSavedUpdatesEntryFilter({ tab: 'Sent', withinDays: null });
                setUpdatesProjectFilter(null);
                setScreen('SavedUpdates');
              }}
              onOpenFieldNotes={() => setScreen('FieldNotes')}
              onSettings={() => setScreen('Admin')}
            />
          )}

          {screen === 'SelectProject' && (
            <SelectProjectScreen
              contentStyle={contentStyle}
              projects={activeProjects}
              projectStatsByName={projectStatsByName}
              onSelect={changeDraftProject}
              onAddProject={addAndChangeDraftProject}
            />
          )}

          {screen === 'AddPhotos' && (
            <AddPhotosScreen
              contentStyle={contentStyle}
              update={draft}
              projectAreas={draftProjectAreas}
              selectedArea={currentDraftArea}
              areaSuggestion={draftAreaSuggestion}
              locationNotice={draftLocationNoticeView}
              recipientCount={
                currentContacts.length
              }
              contacts={currentContacts}
              draftSavedAt={draftSavedAt}
              onPickPhotos={pickPhotos}
              onTakePhoto={takePhoto}
              onUpdatePhoto={updatePhoto}
              onRemovePhoto={removePhoto}
              onMovePhoto={movePhoto}
              onPreviewPhoto={setPreviewPhoto}
              onNext={requestBuildUpdate}
              onContacts={openContacts}
              onChangeArea={changeDraftArea}
              onAddDocument={importFieldUpdateDocument}
              onRetryDocumentUpload={retryProjectDocumentUploadAsked}
              onContinueWithoutPhotos={continueWithoutPhotos}
              onRetryPhotoAnalysis={photo => {
                void retryPhotoAnalysis(draft, photo);
              }}
              scheduleRecommendation={getScheduleDrivenWalkRecommendation(
                draft.projectName,
                authoritativeScheduleItems,
              )}
              onDeleteUpdate={resumedSavedDraft ? deleteResumedSavedDraft : undefined}
            />
          )}

          {screen === 'BuildUpdate' && (
            <ScreenScroll contentStyle={contentStyle}>
              <BuildUpdateScreen
                update={draft}
                selectedArea={currentDraftArea}
                draftSavedAt={draftSavedAt}
                pieStatus={draftPIEStatus}
                isSaving={fieldUpdateSaving}
                onNotesChange={notes =>
                  setDraft(prev => ({
                    ...prev,
                    notes,
                    pieSuggestedNoteAccepted:
                      Boolean(prev.pieSuggestedNote) &&
                      notes === prev.pieSuggestedNote,
                  }))
                }
                onSaveUpdate={() => {
                  void saveFieldUpdateFromReview();
                }}
                onEditPhotos={() =>
                  setScreen('AddPhotos')
                }
                onAddDocument={importFieldUpdateDocument}
                onRetryDocumentUpload={retryProjectDocumentUploadAsked}
                onConfirmInterpretation={confirmPIEInterpretation}
                onDismissInterpretation={dismissPIEInterpretation}
                onRetryPhotoAnalysis={photo => {
                  void retryPhotoAnalysis(draft, photo);
                }}
                onDeleteUpdate={resumedSavedDraft ? deleteResumedSavedDraft : undefined}
              />
            </ScreenScroll>
          )}

          {screen === 'ProjectWorkspace' && projectStatusReady && (
            <ProjectWorkspaceScreen
              contentStyle={contentStyle}
              projectId={projectRecords.find(project => project.name.trim().toLowerCase() === selectedWorkspaceProject.trim().toLowerCase())?.id?.trim() || null}
              projectName={selectedWorkspaceProject}
              savedUpdates={activeSavedUpdates}
              captureMemories={captureMemories}
              projectWalkSession={
                activeProjectWalkSession?.projectName.trim().toLowerCase() ===
                selectedWorkspaceProject.trim().toLowerCase()
                  ? activeProjectWalkSession
                  : null
              }
              usedCaptureMemoryIds={[
                ...activeSavedUpdates.flatMap(update => update.sourceCaptureMemoryIds || []),
                ...(draft.sourceCaptureMemoryIds || []),
              ]}
              projectAreas={selectedWorkspaceProjectAreas}
              projectDocuments={projectDocuments}
              scheduleItems={authoritativeScheduleItems}
              contactBook={contactBook}
              coverPhoto={coverPhotoForProject(projectRecords, selectedWorkspaceProject)}
              coverPhotoMode={projectRecords.find(project =>
                project.name.toLowerCase() === selectedWorkspaceProject.toLowerCase()
              )?.coverPhotoMode || 'automatic'}
              coverImage={resolveProjectCoverImage(
                projectRecords,
                selectedWorkspaceProject,
                mostRecentProjectHeroPhoto(
                  projectUpdatesForParentProject(
                    activeSavedUpdates,
                    selectedWorkspaceProject,
                    authoritativeScheduleItems,
                  ),
                  updateSortTime,
                  resolveProjectPhotoUri,
                ),
              )}
              onTakeNewCoverPhoto={() => {
                void takeNewProjectCoverPhoto(selectedWorkspaceProject);
              }}
              onChooseCoverFromLibrary={() => {
                void chooseProjectCoverFromLibrary(selectedWorkspaceProject);
              }}
              onUseBestProjectPhoto={() => useBestProjectPhoto(selectedWorkspaceProject)}
              onRemoveCoverPhoto={() => removeProjectCoverPhoto(selectedWorkspaceProject)}
              onBack={() => setScreen('Home')}
              onNewFieldUpdate={createNewUpdate}
              onNewFieldUpdateForTask={item =>
                createNewUpdateForScheduleTask(selectedWorkspaceProject, item)
              }
              onAddTask={() => {
                setScheduleEntryFilter('All');
                setScheduleAddGuided(false);
                setScheduleAddProjectName(selectedWorkspaceProject);
                setScheduleProjectFilter(selectedWorkspaceProject);
                setScreen('Schedule');
              }}
              onUpdateScheduleItem={updateScheduleItem}
              onSaveScheduleItem={saveScheduleItemChanges}
              onDeleteScheduleItem={deleteScheduleItem}
              onStartProjectWalk={() => startProjectWalk(selectedWorkspaceProject)}
              onFinishProjectWalk={finishProjectWalk}
              onCancelProjectWalk={cancelProjectWalk}
              onPrepareWalkUpdate={memories =>
                prepareProjectWalkFieldUpdate(selectedWorkspaceProject, memories)
              }
              onSaveCaptureMemory={saveCaptureMemory}
              onDeleteCaptureMemory={deleteCaptureMemory}
              onAddArea={name => addProjectArea(name, selectedWorkspaceProject)}
              onUpdateArea={updateProjectArea}
              onDeleteArea={deleteProjectArea}
              onUseCurrentLocationForArea={areaId => {
                void useCurrentLocationForArea(areaId);
              }}
              onOpenUpdates={() => {
                setSavedUpdatesEntryFilter({
                  tab: 'Sent',
                  withinDays: null,
                  project: selectedWorkspaceProject,
                });
                setUpdatesProjectFilter(selectedWorkspaceProject);
                setScreen('SavedUpdates');
              }}
              onOpenUpdate={openSavedUpdate}
              onOpenDocuments={() => setScreen('ProjectDocuments')}
              onRetryQueuedUpdate={retryQueuedUpdate}
              onDeleteProject={deleteProjectPermanently}
              onCloseProject={closeProject}
              isDeletingProject={deletingProjectName === selectedWorkspaceProject}
            />
          )}

          {screen === 'Reports' && projectStatusReady && selectedReportProjectNames.length === 0 && (
            <View style={contentStyle}>
              <EmptyState title="No active project to report on." text="Reopen an archived project or add a project, then come back to Reports." />
            </View>
          )}
          {screen === 'Reports' && projectStatusReady && selectedReportProjectNames.length > 0 && (
            <ReportsScreen
              contentStyle={contentStyle}
              projectName={selectedWorkspaceProject}
              reportType={reportType}
              onReportTypeChange={changeReportType}
              availableProjectNames={reportAvailableProjectNames}
              selectedProjectNames={selectedReportProjectNames}
              onToggleProject={toggleReportProject}
              reportFormat={reportFormat}
              onReportFormatChange={setReportFormat}
              updates={liveAuthorityInput.updates as unknown as Parameters<typeof ReportsScreen>[0]['updates']}
              scheduleItems={liveAuthorityInput.scheduleItems as unknown as Parameters<typeof ReportsScreen>[0]['scheduleItems']}
              currentUpdate={liveAuthorityInput.currentUpdate as unknown as Parameters<typeof ReportsScreen>[0]['currentUpdate']}
              projectAreas={liveAuthorityInput.projectAreas as unknown as Parameters<typeof ReportsScreen>[0]['projectAreas']}
              contacts={liveAuthorityInput.contacts as unknown as Parameters<typeof ReportsScreen>[0]['contacts']}
              referenceDocuments={liveAuthorityInput.referenceDocuments as unknown as Parameters<typeof ReportsScreen>[0]['referenceDocuments']}
              decisionLedger={decisionLedger}
              layer4Identity={layer4Identity}
              decisionLedgerMigrationStatus={decisionLedgerMigrationStatus}
              decisionEvidenceReferences={layer4EvidenceCatalog}
              onCreateDecisionSnapshot={(judgment, silent) => {
                void createAutomatedDecisionSnapshot(judgment, silent);
              }}
              onSavedUpdates={() => {
                setUpdatesProjectFilter(null);
                setScreen('SavedUpdates');
              }}
              onCopyReport={copyReport}
              onEmailReport={emailReport}
              onTextReport={textReport}
              onDownloadWordReport={downloadWordReport}
              onOutlookReport={outlookReport}
              onResolveDrawingPreview={resolveReportDrawingPreview}
              onResolvePhotoPreview={resolveReportPhotoPreview}
            />
          )}

          {screen === 'ProjectDocuments' && (
            <ProjectDocumentsScreen
              contentStyle={contentStyle}
              projectName={selectedWorkspaceProject}
              documents={projectDocuments.filter(document => workspaceScopeNames(selectedWorkspaceProject)
                .some(name => projectDocumentMatchesProject(document, name) ||
                  projectRecords.some(project => project.name === name && project.id === document.projectId)))}
              referenceDocuments={referenceDocuments.filter(document => !hiddenSharedDocuments.hidden.has(document.id))}
              projectNames={workspaceScopeNames(selectedWorkspaceProject)}
              projectIdentities={projectRecords}
              onOpenReference={openReferenceDocument}
              projectAreas={selectedWorkspaceProjectAreas}
              updates={projectUpdatesForScopes(
                activeSavedUpdates,
                workspaceScopeNames(selectedWorkspaceProject),
                authoritativeScheduleItems,
              )}
              onBack={() => setScreen('ProjectWorkspace')}
              onUpload={() => {
                void importProjectDocumentForProject(selectedWorkspaceProject);
              }}
              onTakePhoto={() => {
                void takeProjectDocumentPhoto(selectedWorkspaceProject, false);
              }}
              onOpen={openProjectDocument}
              onUpdate={updateProjectDocument}
              onSetCurrentSchedule={makeProjectScheduleDocumentCurrent}
              onMakeCurrentDocument={markReferenceDocumentCurrent}
              onRetry={retryProjectDocumentUploadAsked}
              onReplaceFile={documentId => {
                void replaceProjectDocumentFile(documentId);
              }}
              onDelete={deleteProjectDocument}
            />
          )}

          {screen === 'Schedule' && projectStatusReady && (
            <ScheduleScreen
              contentStyle={contentStyle}
              screenshotImportAvailable={scheduleScreenshotOcrAvailable}
              cloudDownloadPending={scheduleCloudDownloadPending}
              scheduleItems={authoritativeScheduleItems}
              savedUpdates={activeSavedUpdates}
              projectAreas={projectAreas}
              projects={projects}
              projectRecords={projectRecords}
              scheduleDocuments={referenceDocuments.filter(document =>
                document.category === 'Schedules' ||
                document.notes.includes('[Schedule communication screenshot]'),
              )}
              onBack={() => {
                setScheduleAddProjectName(null);
                setScreen('Home');
              }}
              onOpenDocument={openReferenceDocument}
              onDeleteDocument={deleteScheduleDocument}
              onSetActiveDocument={setActiveScheduleDocument}
              onAdd={addScheduleItem}
              onUpdate={updateScheduleItem}
              onSave={saveScheduleItemChanges}
              onDelete={deleteScheduleItem}
              onImport={importScheduleFile}
              onImportScreenshot={importScheduleCommunicationScreenshot}
              onApproveImport={approveScheduleImport}
              onCancelImport={cancelScheduleImport}
              incomingImportBatch={incomingScheduleImportBatch}
              onIncomingImportConsumed={() => setIncomingScheduleImportBatch(null)}
              onNewFieldUpdateForTask={item =>
                createNewUpdateForScheduleTask(
                  item.scheduleProjectName?.trim() || item.projectName.trim() || selectedWorkspaceProject,
                  item,
                )
              }
              onOpenUpdate={update => openSavedUpdate(update, 'Schedule')}
              initialFilter={scheduleEntryFilter}
              initialAddProjectName={scheduleAddProjectName}
              initialAddGuided={scheduleAddGuided}
              onInitialAddGuidedConsumed={() => setScheduleAddGuided(false)}
              projectFilter={scheduleProjectFilter}
              defaultOwner={displayName}
              currentUserEmail={layer4Identity?.authenticatedEmail || ''}
            />
          )}

          {screen === 'FieldNotes' && <NativeFieldNotesExperience
            contentStyle={contentStyle}
            projects={activeProjects}
            projectRecords={projectRecords}
            projectAreas={projectAreas}
          />}

          {screen === 'Diagnostics' && (
            <ScreenScroll contentStyle={contentStyle}>
              <DiagnosticsScreen
                projectAreas={projectAreas}
                referenceDocuments={referenceDocuments}
                onBack={() => setScreen('Admin')}
              />
            </ScreenScroll>
          )}

          {screen === 'Admin' && (
            <AdminScreen
              contentStyle={contentStyle}
              localProjects={activeProjects}
              savedUpdates={savedUpdates}
              projectAreas={projectAreas}
              scheduleItems={identityAliasCleanup.scheduleItemsForFullSync}
              referenceDocuments={referenceDocuments}
              syncCleanupNotice={syncCleanupNotice}
              displayName={displayName}
              onDisplayNameChange={typeDisplayName}
              onBack={() => setScreen('Home')}
              onDiagnostics={() => setScreen('Diagnostics')}
              onBackup={(passphrase, includeFiles = true, onProgress) => {
                void exportBackup(passphrase, includeFiles, onProgress);
              }}
              onRestore={(passphrase, onProgress) => {
                void restoreBackup(passphrase, onProgress);
              }}
              onAddArea={addProjectArea}
              onUpdateArea={updateProjectArea}
              onDeleteArea={deleteProjectArea}
              onUseCurrentLocationForArea={areaId => {
                void useCurrentLocationForArea(areaId);
              }}
              onRemoveMissingPhotos={removeMissingSyncPhotos}
              onRetryUpdateSync={update => retryQueuedUpdate(update as unknown as ProjectUpdate)}
              onRetryDocumentUploads={() => projectDocumentUploadRetry.run(retryProjectDocumentUpload, { ignoreBackoff: true })}
              failedDocumentCount={projectDocumentsAwaitingUpload(projectDocuments).length}
              onApplyCloudConflictUpdate={update => {
                const cloudUpdate = normalizeStoredUpdateRecord(update);
                // The owner chose the cloud copy: it replaces the local
                // failed one rather than lending it a receipt (audit A4 pass 4);
                // the resolver withdrew the phone's queued copies and wrote it back (pass 5).
                setSavedUpdates(previous => mergeSavedUpdatesWithTombstones({
                  localUpdates: previous.filter(item => item.id !== cloudUpdate.id),
                  cloudUpdates: [cloudUpdate],
                  tombstones: deletedUpdateTombstonesRef.current,
                }));
              }}
              onApplyCloudConflictScheduleItem={item => {
                const resolvedItem = migrateLegacyScheduleItem(
                  normalizeScheduleItem(item),
                );
                const deletedItemIds = new Set(
                  deletedDAVERecordIds(
                    operationalSyncTombstonesRef.current,
                    'schedule_item',
                  ).map(itemId => itemId.trim().toLowerCase()),
                );
                if (deletedItemIds.has(resolvedItem.id.trim().toLowerCase())) {
                  return;
                }
                const currentItems = scheduleItemsCurrentRef.current;
                const nextItems = currentItems.some(
                  candidate => candidate.id === resolvedItem.id,
                )
                  ? currentItems.map(candidate =>
                      candidate.id === resolvedItem.id ? resolvedItem : candidate)
                  : [resolvedItem, ...currentItems];
                scheduleItemsCurrentRef.current = nextItems;
                setScheduleItems(nextItems);
              }}
              onApplyCloudRecovery={recovered => {
                // Audit P1-27: a collection whose cloud read failed arrives
                // empty with a non-null error. Skip it entirely — an empty
                // failed read must never be merged as cloud truth.
                const failed = recovered.collectionErrors;
                if (failed.updates === null) {
                  const cloudUpdates = (recovered.updates as unknown as Partial<ProjectUpdate>[])
                    .map(normalizeUpdate)
                    .map(migrateLegacyProjectUpdate);
                  setSavedUpdates(previous => mergeSavedUpdatesWithTombstones({
                    localUpdates: previous,
                    cloudUpdates,
                    tombstones: deletedUpdateTombstones,
                  }));
                }
                if (failed.projectAreas === null) {
                  setProjectAreas(previous => mergeDAVEProjectAreaRecoveryRecords({
                    local: previous,
                    cloud: normalizeProjectAreas(
                      recovered.projectAreas.filter(isStartupProjectAreaRecord),
                    ),
                    deletedIds: deletedDAVERecordIds(
                      recovered.tombstones,
                      'project_area',
                    ),
                  }));
                  markProjectAreasAuthorityReady(true);
                }
                if (failed.scheduleItems === null) {
                  const safeCloudItems = normalizeScheduleItems(
                    recovered.scheduleItems.filter(isDAVESafeCloudScheduleRecord),
                  ).map(migrateLegacyScheduleItem);
                  setScheduleItems(previous => recoverDAVEScheduleRecords({
                    local: previous,
                    cloud: safeCloudItems,
                    deletedIds: deletedDAVERecordIds(
                      recovered.tombstones,
                      'schedule_item',
                    ),
                    allowCloudOnly: true,
                  }));
                  markScheduleItemsAuthorityReady(true);
                }
                if (failed.referenceDocuments === null) {
                  setReferenceDocuments(previous => reconcileCurrentScheduleDocuments(mergeDAVEReferenceDocumentRecoveryRecords({ // the newer copy wins, as in the refresh (A7 pass 5 L1)
                    local: previous,
                    cloud: normalizeReferenceDocuments(
                      recovered.referenceDocuments.filter(isStartupReferenceDocumentRecord),
                    ),
                    deletedIds: deletedDAVERecordIds(
                      recovered.tombstones,
                      'reference_document',
                    ),
                  })));
                  markReferenceDocumentsAuthorityReady(true);
                }
                if (failed.projects === null) {
                  const cloudProjectRecords = recovered.projects
                    .filter(project => project.name.trim())
                    .map(projectRecordFromCloud);
                  setProjectRecords(previous => {
                    const merged = mergeProjectRecords(
                      [],
                      previous,
                      cloudProjectRecords,
                      deletedProjectNames,
                    );
                    setProjects(merged.map(project => project.name));
                    return merged;
                  });
                }
              }}
              onSaveCaptureMemory={saveCaptureMemory}
            />
          )}

          {screen === 'Contacts' && (
            <ScreenScroll contentStyle={contentStyle}>
              <ContactsScreen
                contactBook={contactBook}
                selectedRecipients={draft.recipients}
                doneLabel={
                  contactsReturnScreen === 'AddPhotos' ||
                  contactsReturnScreen === 'BuildUpdate'
                    ? 'Back to Update'
                    : 'Done'
                }
                onDone={() =>
                  setScreen(contactsReturnScreen)
                }
                onToggleContact={toggleContactRecipient}
                onTogglePhoneContact={togglePhoneContactRecipient}
                onUpdateContactDeliveryChoice={updateContactDeliveryChoice}
              />
            </ScreenScroll>
          )}

          {screen === 'SavedUpdates' && (
            <SavedUpdatesScreen
              contentStyle={contentStyle}
              updates={savedUpdates}
              deletedTaskEvidenceIds={deletedTaskEvidenceIds}
              projectAreas={projectAreas}
              contactBook={contactBook}
              onOpen={openSavedUpdate}
              onDelete={deleteSavedUpdate}
              onArchive={archiveSavedUpdate}
              onRetryPhotoAnalysis={(update, photo) => {
                void retryPhotoAnalysis(update, photo);
              }}
              onRetryQueuedUpdate={retryQueuedUpdate}
              onBack={() => setScreen('Home')}
              initialTab={savedUpdatesEntryFilter?.tab}
              initialWithinDays={savedUpdatesEntryFilter?.withinDays}
              initialProject={savedUpdatesEntryFilter?.project}
              projectFilter={updatesProjectFilter}
              onProjectFilterChange={setUpdatesProjectFilter}
            />
          )}

          {screen === 'UpdateDetail' && liveDetailUpdate && (
            <ScreenScroll contentStyle={contentStyle}>
              <ReadOnlyUpdateDetailScreen
                update={liveDetailUpdate}
                backLabel={updateDetailReturnScreenRef.current === 'Schedule' ? 'Tasks' : updateDetailReturnScreenRef.current === 'ProjectWorkspace' ? 'Project' : 'Updates'}
                onBack={() => setScreen(updateDetailReturnScreenRef.current)}
                onRetry={
                  liveDetailUpdate.status === 'queued' ||
                  liveDetailUpdate.status === 'failed'
                    ? () => {
                        void retryQueuedUpdate(liveDetailUpdate);
                      }
                    : undefined
                }
                onRetryPhotoAnalysis={(update, photo) => {
                  void retryPhotoAnalysis(update, photo);
                }}
                onDelete={() => {
                  deleteSavedUpdate(liveDetailUpdate.id, () =>
                    setScreen(updateDetailReturnScreenRef.current),
                  );
                }}
                onArchive={() => {
                  archiveSavedUpdate(liveDetailUpdate.id, () =>
                    setScreen(updateDetailReturnScreenRef.current),
                  );
                }}
              />
            </ScreenScroll>
          )}

          <OverlayErrorBoundary screen={screen} onError={dismissAllOverlays}>
            <SignInModal
              visible={Boolean(photoAuthRequest)}
              email={photoAuthEmail}
              password={photoAuthPassword}
              message={photoAuthMessage}
              submitting={photoAuthSubmitting}
              onEmailChange={setPhotoAuthEmail}
              onPasswordChange={setPhotoAuthPassword}
              onSubmit={() => {
                void submitPhotoIntelligenceSignIn();
              }}
              developmentSignupEnabled={ENABLE_DEV_AUTH_SIGNUP}
              onDevelopmentSignUp={() => {
                void submitPhotoIntelligenceDevelopmentSignUp();
              }}
              onClose={closePhotoIntelligenceSignIn}
            />

            <Modal
              visible={Boolean(previewPhoto)}
              animationType="fade"
              transparent
              onRequestClose={() => setPreviewPhoto(null)}
            >
              <View style={styles.photoModalBackdrop}>
                <SafeAreaView style={styles.photoModalSafeArea}>
                  <View style={styles.photoModalHeader}>
                    <View style={styles.photoModalTitleWrap}>
                      <Text style={styles.photoModalTitle}>
                        Photo Preview
                      </Text>

                      {previewPhoto?.caption.trim() ? (
                        <Text
                          style={styles.photoModalCaption}
                          numberOfLines={2}
                        >
                          {previewPhoto.caption}
                        </Text>
                      ) : null}
                    </View>

                    <TouchableOpacity
                      style={styles.photoModalCloseButton}
                      onPress={() => setPreviewPhoto(null)}
                      accessibilityLabel="Close photo preview"
                      hitSlop={{ top: 16, bottom: 16, left: 16, right: 16 }}
                    >
                      <Ionicons
                        name="close"
                        size={30}
                        color="#FFFFFF"
                      />
                    </TouchableOpacity>
                  </View>

                  {previewPhoto ? (
                    <Image
                      source={{ uri: previewPhoto.uri }}
                      style={styles.photoModalImage}
                      resizeMode="contain"
                    />
                  ) : null}

                  <View style={styles.photoModalBottomBar}>
                    <TouchableOpacity
                      style={styles.photoModalBottomCloseButton}
                      onPress={() => setPreviewPhoto(null)}
                      accessibilityLabel="Close photo preview"
                    >
                      <Ionicons
                        name="close-circle-outline"
                        size={22}
                        color="#FFFFFF"
                      />

                      <Text style={styles.photoModalBottomCloseText}>
                        Close Photo
                      </Text>
                    </TouchableOpacity>
                  </View>
                </SafeAreaView>
              </View>
            </Modal>

            <DocumentUploadDetailsSheet
              visible={Boolean(documentUploadRequest)}
              projects={documentUploadRequest?.attachToDraft ? [draft.projectName] : activeProjects}
              selectedProjects={documentUploadRequest?.selected ?? EMPTY_SELECTED_PROJECTS}
              categories={PROJECT_DOCUMENT_CATEGORIES}
              selectedCategory={documentUploadRequest?.category || 'Other'}
              drawingControls={documentUploadRequest?.drawingControls}
              replacementDocuments={
                documentUploadRequest?.category === 'Drawing' &&
                documentUploadRequest.selected.size === 1
                  ? referenceDocuments
                      .filter(document => {
                        const projectName = Array.from(documentUploadRequest.selected)[0];
                        return document.isCurrent &&
                          canonicalReferenceCategory(document) === 'drawing' &&
                          (referenceDocumentAppliesToProject(document, projectName) ||
                            document.projectId === authorityProjectId(projectName));
                      })
                      .map(document => ({
                        id: document.id,
                        name: document.name,
                        revision: document.drawingRevision || null,
                        isCurrent: document.isCurrent,
                      }))
                  : []
              }
              onCategoryChange={setDocumentUploadCategory}
              onDrawingControlsChange={setDocumentUploadDrawingControls}
              onToggleProject={toggleDocumentUploadProject}
              onConfirm={confirmDocumentProjectSelection}
              onClose={cancelDocumentProjectSelection}
            />

            {ecosProjectQuestion.sheets}

            <DAVEVoiceCaptureSheet
              visible={talkVoiceOpen}
              projectId={projectRecords.find(project => project.name.trim().toLowerCase() === talkProjectName.trim().toLowerCase())?.id?.trim() || null}
              projectName={talkProjectName}
              candidateProjects={reportAvailableProjectNames}
              candidateTasks={talkCandidateTasks}
              selectedTaskId={talkTaskId}
              candidateLocations={talkProjectAreas.map(area => area.name)}
              title="Talk"
              prompt="What do you need?"
              guidance="Ask a project question, update a task, open a screen, or record something that should be remembered."
              continueLabel="Continue"
              operationLabel="Create a task"
              operationGuidance="Answer guided questions so every task field is reviewed before saving."
              showWalkContext={false}
              onMemoryReady={result => handleTalkInput(result.transcript, result)}
              onProjectChange={projectName => {
                setTalkProjectName(projectName);
                setTalkTaskId(null);
              }}
              onTaskChange={setTalkTaskId}
              onOperation={openGuidedTaskFromTalk}
              onTypeInstead={() => {
                setTalkVoiceOpen(false);
                setTalkTypedOpen(true);
              }}
              onCancel={() => setTalkVoiceOpen(false)}
            />

            <DAVETypedCaptureSheet
              visible={talkTypedOpen}
              projectName={talkProjectName}
              title="Talk"
              prompt="What do you need?"
              guidance="Ask a question, update a task, open a screen, or enter project information to remember."
              placeholder="Example: Mark electrical rough-in complete. Or: What changed today?"
              continueLabel="Continue"
              accessibilityLabel="Talk message"
              operationLabel="Create a task"
              operationGuidance="Answer guided questions so every task field is reviewed before saving."
              onContinue={text => handleTalkInput(text)}
              onOperation={openGuidedTaskFromTalk}
              onCancel={() => setTalkTypedOpen(false)}
            />

            {talkCaptureSheetDraft ? (
              <DAVECaptureConfirmationSheet
                visible
                transcript={talkCaptureSheetDraft.transcript}
                draft={talkCaptureSheetDraft}
                projects={reportAvailableProjectNames}
                locationsForProject={chosen => projectAreasForProject({
                  projectAreas, projectName: chosen, scheduleItems, updates: activeSavedUpdates,
                }).map(area => area.name)}
                sourceLabel={talkCaptureSheetDraft.evidence.some(
                  evidence => evidence.sourceRecordId.startsWith('voice-transcription:'),
                ) ? 'Source transcript' : 'Source note'}
                onSave={async memory => {
                  await saveCaptureMemory(memory);
                  setTalkCaptureDraft(null);
                  Alert.alert('Saved', 'The confirmed project information was added to memory.');
                }}
                onCancel={() => setTalkCaptureDraft(null)}
                onWorkingChange={keptTalkCapture.track}
              />
            ) : null}

            <DAVEConversationAnswerSheet
              visible={Boolean(talkAnswer) && !ecosDocumentEvidence.state}
              projectName={talkAnswer?.projectName || talkProjectName}
              question={talkAnswer?.question || ''}
              answer={talkAnswer?.answer || null}
              onOpenEvidence={citation => openTalkSupportingEvidence(
                talkAnswer?.projectName || talkProjectName,
                citation,
              )}
              onAskAnother={() => {
                setTalkAnswer(null);
                setTalkVoiceOpen(true);
              }}
              onClose={() => setTalkAnswer(null)}
            />

            <ECOSDocumentEvidenceSheet
              visible={Boolean(ecosDocumentEvidence.state)}
              evidence={ecosDocumentEvidence.state?.evidence || null}
              document={ecosDocumentEvidence.state?.document || null}
              imageUri={ecosDocumentEvidence.state?.imageUri || null}
              imageWidth={ecosDocumentEvidence.state?.imageWidth || 0}
              imageHeight={ecosDocumentEvidence.state?.imageHeight || 0}
              imageBounds={ecosDocumentEvidence.state?.imageBounds || null}
              binding={ecosDocumentEvidence.state?.binding || null}
              loading={ecosDocumentEvidence.state?.loading || false}
              error={ecosDocumentEvidence.state?.error || null}
              onOpenDocument={ecosDocumentEvidence.openFullDocument}
              onClose={ecosDocumentEvidence.close}
            />

            <DAVETaskActionConfirmationSheet
              visible={Boolean(talkTaskAction)}
              projectName={talkTaskAction?.projectName || talkProjectName}
              command={talkTaskAction?.command || null}
              candidates={talkTaskAction?.candidates || []}
              selectedTaskId={talkTaskAction?.selectedTaskId || null}
              onSelectTask={taskId => setTalkTaskAction(current => current ? {
                ...current,
                selectedTaskId: taskId,
              } : null)}
              onConfirm={confirmTalkTaskAction}
              onCancel={() => setTalkTaskAction(null)}
            />
          </OverlayErrorBoundary>
        </AppShellFrame>
      </StartupHydrationBoundary>
    </SavedFieldUpdatesContext.Provider></PIELiveAuthorityProvider>
  );
}

type PIELiveAuthorityMode =
  | 'primary'
  | 'capture'
  | 'capture-review'
  | 'workspace'
  | 'reports';

function authorityModeForScreen(screen: Screen): PIELiveAuthorityMode {
  if (screen === 'Reports') return 'reports';
  if (screen === 'BuildUpdate') return 'capture-review';
  if (screen === 'ProjectWorkspace' || screen === 'ProjectDocuments') return 'workspace';
  if (
    screen === 'SelectProject' ||
    screen === 'AddPhotos' ||
    screen === 'Contacts'
  ) {
    return 'capture';
  }
  return 'primary';
}

function authoritySurfaceForMode(
  mode: PIELiveAuthorityMode,
): PIELiveAuthorityInput['surface'] {
  if (mode === 'capture') return 'capture';
  if (mode === 'reports' || mode === 'capture-review') return 'reports';
  if (mode === 'workspace') return 'projects';
  return 'home';
}

function createDecisionSnapshotFromJudgment({
  judgment,
  existingDecisions,
  actor,
  evidence,
  now,
}: {
  judgment: PIEExecutiveJudgmentRecord;
  existingDecisions: PIEDecisionRecord[];
  actor: PIEActor;
  evidence: PIEEvidenceReference[];
  now?: string;
}) {
  return buildLayer4DecisionCandidateFromExecutiveJudgment({
    judgment,
    existingDecisions,
    actor,
    evidence,
    now,
  });
}

function HomeScreen({
  contentStyle,
  projects,
  archivedProjects,
  savedUpdates,
  scheduleItems,
  displayName,
  unfinishedDraft,
  draftSavedAt,
  projectRecords,
  statusReady,
  onResumeDraft,
  onDiscardDraft,
  onNewUpdate,
  onOpenProject,
  onOpenUpdate,
  onAddProject,
  onReopenProject,
  onOpenDueToday,
  onOpenAllActivity,
  onOpenFieldNotes,
  onSettings,
}: {
  contentStyle: StyleProp<ViewStyle>;
  projects: string[];
  archivedProjects: string[];
  savedUpdates: ProjectUpdate[];
  scheduleItems: ScheduleItem[];
  displayName: string;
  unfinishedDraft: ProjectUpdate | null;
  draftSavedAt: string | null;
  projectRecords: ProjectRecord[];
  statusReady: boolean;
  onResumeDraft: () => void;
  onDiscardDraft: () => void;
  onNewUpdate: (projectName?: string) => void;
  onOpenProject: (projectName: string) => void;
  onOpenUpdate: (update: ProjectUpdate) => void;
  onAddProject: (projectName: string) => boolean;
  onReopenProject: (projectName: string) => void;
  onOpenDueToday: () => void;
  onOpenAllActivity: () => void;
  onOpenFieldNotes: () => void;
  onSettings: () => void;
}) {
  const [showAddProject, setShowAddProject] = useState(false);
  const liveAuthority = usePIELiveAuthority();

  if (!statusReady) {
    return (
      <DAVEProjectStatusLoadingScreen
        contentStyle={contentStyle}
        greeting={timeOfDayGreeting(displayName)}
        dateLabel={todayLongDateLabel()}
        onSettings={onSettings}
      />
    );
  }
  const scopedProjects = scheduleOverviewProjectNames(
    projects,
    scheduleItems as unknown as import('./types').ScheduleItem[],
    archivedProjects,
  );
  const overviewRows = buildOverviewProjectRows(
    scopedProjects,
    savedUpdates,
    scheduleItems,
  );
  const attentionRows = overviewRows.filter(row => row.health !== 'Healthy');
  const topPriority = attentionRows[0] || null;
  const commitmentControl = buildVitruviusCommitmentControl({
    scheduleItems,
    updates: savedUpdates,
    projectNames: scopedProjects,
  });
  const currentFocus = commitmentControl.topItem;
  const currentFocusProject = currentFocus?.projectName || topPriority?.project || null;
  const authorityMatchesCurrentFocus = Boolean(
    currentFocus &&
    liveAuthority.projectTruth.projectName.trim().toLowerCase() ===
      currentFocus.projectName.trim().toLowerCase(),
  );
  const authoritativePriority = authorityMatchesCurrentFocus
    ? liveAuthority.projectTruth.briefing.nextActions.find(action => action.trim())?.trim() || null
    : null;
  const currentFocusAction =
    authoritativePriority ||
    currentFocus?.recoveryAction ||
    topPriority?.subtitle ||
    'Your projects have no current attention items.';
  const currentFocusScheduleContext = currentFocus
    ? authorityMatchesCurrentFocus && liveAuthority.projectTruth.schedule.length > 0
      ? `Schedule loaded: ${liveAuthority.projectTruth.schedule.length} activities. ${liveAuthority.projectTruth.briefing.schedule}`
      : `Schedule task: ${currentFocus.timing}.`
    : null;
  const dailyBrief = authorityMatchesCurrentFocus
    ? liveAuthority.projectTruth.intelligence.dailyBrief
    : null;
  const dailyBriefItems = dailyBrief
    ? selectActionableDailyBriefItems(dailyBrief)
    : [];
  const overviewScopedUpdates = Array.from(new Map(
    overviewRows
      .flatMap(row =>
        projectUpdatesForParentProject(savedUpdates, row.project, scheduleItems),
      )
      .map(update => [update.id, update]),
  ).values());
  const overviewScopedTasks = Array.from(new Map(
    scopedProjects
      .flatMap(projectName => scheduleTasksForParentProject(projectName, scheduleItems))
      .map(item => [item.id, item]),
  ).values());
  const overviewCompletedTasks = overviewScopedTasks.filter(scheduleTaskIsComplete);
  const overviewOpenTasks = overviewScopedTasks.filter(item => !scheduleTaskIsComplete(item));

  const dueTodayCount = overviewRows.filter(row => row.dueTodayLabel !== null).length;
  const sentThisWeekCount = overviewScopedUpdates.filter(update => {
    if (lifecycleStatusForUpdate(update) !== 'sent') return false;

    const daysSinceSent = daysUntilDate(update.date);

    return daysSinceSent !== null && daysSinceSent <= 0 && daysSinceSent >= -7;
  }).length;
  const recentActivity = [...overviewScopedUpdates]
    .sort((left, right) => updateSortTime(right) - updateSortTime(left))
    .slice(0, 5);

  function overviewPhotoForProject(projectName: string) {
    const scopedUpdates = projectUpdatesForParentProject(
      savedUpdates,
      projectName,
      scheduleItems,
    );
    return resolveProjectCoverImage(
      projectRecords,
      projectName,
      mostRecentProjectHeroPhoto(scopedUpdates, updateSortTime, resolveProjectPhotoUri),
    );
  }

  return (
    <View style={styles.overviewPageWrap}>
      <LinearGradient
        colors={['#E4E9FA', '#EEEBFB', 'rgba(245,245,247,0)']}
        locations={[0, 0.4, 1]}
        style={styles.overviewPageGradient}
      />

      <ScrollView
        style={styles.appFrame}
        contentContainerStyle={contentStyle}
        keyboardShouldPersistTaps="handled"
      >
      <OverviewResponsiveFrame>
      <View style={styles.overviewGreetingHeader}>
        <View style={styles.overviewGreetingCopy}>
          <Text style={styles.overviewGreetingText}>{timeOfDayGreeting(displayName)}</Text>
          <Text style={styles.overviewGreetingDate}>{todayLongDateLabel()}</Text>
        </View>
        <TouchableOpacity
          style={styles.overviewAskDaveButton}
          onPress={onSettings}
          accessibilityRole="button"
          accessibilityLabel="Open Settings"
          accessibilityHint="Opens app settings"
        >
          <Ionicons name="settings-outline" size={21} color={colors.primary} />
        </TouchableOpacity>
      </View>

      <OverviewFieldNotesCard onPress={onOpenFieldNotes} />

      {unfinishedDraft ? (
        <View style={styles.draftRecoveryCard}>
          <View style={styles.draftRecoveryHeader}>
            <View style={styles.draftIcon}>
              <Ionicons
                name="document-text-outline"
                size={22}
                color={colors.warning}
              />
            </View>

            <View style={styles.rowMain}>
              <Text style={styles.draftRecoveryTitle}>
                Unfinished Update
              </Text>

              <Text style={styles.draftRecoveryProject}>
                {unfinishedDraft.projectName}
              </Text>
            </View>
          </View>

          <View style={styles.draftStatsRow}>
            <Text style={styles.draftStatText}>
              {unfinishedDraft.photos.length} photo
              {unfinishedDraft.photos.length === 1 ? '' : 's'}
            </Text>

            <Text style={styles.draftStatDot}>•</Text>

            <Text style={styles.draftStatText}>
              Last saved {formatSavedTime(draftSavedAt)}
            </Text>
          </View>

          <View style={styles.draftActionRow}>
            <TouchableOpacity
              style={styles.resumeDraftButton}
              onPress={onResumeDraft}
            >
              <Ionicons
                name="play-outline"
                size={18}
                color="#FFFFFF"
              />

              <Text style={styles.resumeDraftText}>
                Resume Draft
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.discardDraftButton}
              onPress={onDiscardDraft}
            >
              <Ionicons
                name="trash-outline"
                size={18}
                color={colors.danger}
              />

              <Text style={styles.discardDraftText}>
                Discard
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : null}

      <View style={styles.overviewHealthCard}>
        <View style={styles.overviewDashboardSectionHeader}>
          <View>
            <Text style={styles.overviewHealthEyebrow}>PORTFOLIO</Text>
            <Text style={styles.overviewHealthTitle}>Project Health</Text>
          </View>
          <Ionicons name="pulse-outline" size={24} color="rgba(255,255,255,0.82)" />
        </View>
        <View style={styles.overviewHealthMetrics}>
          {[
            { label: 'Active Projects', value: scopedProjects.length },
            { label: 'Total Tasks', value: overviewScopedTasks.length },
            { label: 'Completed', value: overviewCompletedTasks.length },
            { label: 'Open', value: overviewOpenTasks.length },
            { label: 'Field Updates', value: overviewScopedUpdates.length },
          ].map(metric => (
            <View key={metric.label} style={styles.overviewHealthMetric}>
              <Text style={styles.overviewHealthMetricValue}>{metric.value}</Text>
              <View
                style={styles.overviewHealthMetricLabelGroup}
                accessible
                accessibilityLabel={metric.label}
              >
                {metric.label.split(' ').map(word => (
                  <Text
                    key={`${metric.label}-${word}`}
                    style={styles.overviewHealthMetricLabel}
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    minimumFontScale={0.82}
                  >
                    {word}
                  </Text>
                ))}
              </View>
            </View>
          ))}
        </View>
      </View>

      <OverviewResponsiveWorkspace>
      <OverviewResponsiveColumn priority="primary">
      <View style={styles.overviewDashboardHeadingRow}>
        <Text style={styles.overviewDashboardHeading}>Current Focus</Text>
      </View>
      <View style={styles.overviewFocusSummary}>
        {[
          { label: 'Overdue', value: commitmentControl.missed, color: colors.danger },
          { label: 'At Risk', value: commitmentControl.atRisk, color: colors.warning },
          { label: 'Verify', value: commitmentControl.needsVerification, color: colors.primary },
        ].map(metric => (
          <View key={metric.label} style={styles.overviewFocusMetric}>
            <Text style={[styles.overviewFocusMetricValue, { color: metric.color }]}>
              {metric.value}
            </Text>
            <Text style={styles.overviewFocusMetricLabel}>{metric.label}</Text>
          </View>
        ))}
      </View>
      <View style={styles.overviewPriorityCard}>
        {currentFocusProject && overviewPhotoForProject(currentFocusProject) ? (
          <ProjectPhotoImage
            {...overviewPhotoForProject(currentFocusProject)!}
            style={styles.overviewPriorityImage}
          />
        ) : currentFocusProject ? (
          <View style={styles.overviewPriorityClearPanel}>
            <View style={styles.overviewPriorityClearIcon}>
              <Ionicons name="image-outline" size={32} color={colors.primary} />
            </View>
            <View style={styles.overviewPriorityClearCopy}>
              <Text style={styles.overviewPriorityClearTitle}>Current focus</Text>
              <Text style={styles.overviewPriorityClearText}>{currentFocusProject}</Text>
              <Text style={styles.overviewPriorityClearText}>No project cover photo is available.</Text>
            </View>
          </View>
        ) : (
          <View style={styles.overviewPriorityClearPanel}>
            <View style={styles.overviewPriorityClearIcon}>
              <Ionicons name="checkmark-circle" size={34} color={colors.success} />
            </View>
            <View style={styles.overviewPriorityClearCopy}>
              <Text style={styles.overviewPriorityClearTitle}>All clear</Text>
              <Text style={styles.overviewPriorityClearText}>
                {scopedProjects.length} project{scopedProjects.length === 1 ? '' : 's'} reviewed
              </Text>
              <Text style={styles.overviewPriorityClearText}>
                {dueTodayCount === 0
                  ? 'Nothing due today'
                  : `${dueTodayCount} project${dueTodayCount === 1 ? '' : 's'} with work due today`}
              </Text>
            </View>
          </View>
        )}
        <View style={styles.overviewPriorityContent}>
          <View style={styles.overviewPriorityBadge}>
            <Ionicons
              name={currentFocusProject ? 'sparkles-outline' : 'checkmark-circle-outline'}
              size={14}
              color={currentFocusProject ? colors.warning : colors.success}
            />
            <Text
              style={[
                styles.overviewPriorityBadgeText,
                !currentFocusProject && styles.overviewPriorityClearBadgeText,
              ]}
            >
              {currentFocus?.stateLabel || (topPriority ? 'NEEDS SETUP' : 'ALL CLEAR')}
            </Text>
          </View>
          <Text style={styles.overviewPriorityProject}>
            {currentFocus?.promise || topPriority?.project || 'No immediate priority'}
          </Text>
          <Text style={styles.overviewPriorityRecommendation}>
            {currentFocusAction}
          </Text>
          <Text style={styles.overviewPrioritySupport}>
            {currentFocus
              ? `Owner: ${currentFocus.owner} · ${currentFocusScheduleContext}`
              : topPriority
                ? `${topPriority.taskCount} ${pluralWord(topPriority.taskCount, 'task')} · ${topPriority.percentComplete}% complete`
              : 'New priorities will appear here as project conditions change.'}
          </Text>
          {currentFocus ? (
            <View style={styles.overviewPriorityObservation}>
              <Ionicons name="checkmark-done-outline" size={16} color={colors.primary} />
              <View style={styles.overviewPriorityObservationCopy}>
                <Text style={styles.overviewPriorityObservationLabel}>DECISION</Text>
                <Text style={styles.overviewPriorityObservationText}>
                  {currentFocus.decisionNeeded}
                </Text>
                <Text style={styles.overviewPriorityObservationLabel}>FIELD CONFIRMATION</Text>
                <Text style={styles.overviewPriorityObservationText}>
                  {currentFocus.proofNeeded}
                </Text>
              </View>
            </View>
          ) : null}
          <TouchableOpacity
            style={styles.overviewPriorityButton}
            onPress={() => currentFocusProject ? onOpenProject(currentFocusProject) : setShowAddProject(true)}
          >
            <Text style={styles.overviewPriorityButtonText}>
              {currentFocus ? 'Review task' : topPriority ? 'Set up project' : 'Add project'}
            </Text>
            <Ionicons name="arrow-forward" size={17} color="#FFFFFF" />
          </TouchableOpacity>
        </View>
      </View>

      {overviewRows.length === 0 ? (
        <>
          <EmptyState
            title="No projects yet."
            text="Add a project to start tracking field updates and schedule attention."
          />
          {showAddProject ? (
            <AddProjectCard
              buttonLabel="Create Project"
              placeholder="New project name"
              onAdd={projectName => {
                const added = onAddProject(projectName);
                if (added) setShowAddProject(false);
                return added;
              }}
            />
          ) : null}
        </>
      ) : null}

      {overviewRows.length > 0 ? (
        <>
          <View style={styles.overviewDashboardHeadingRow}>
            <Text style={styles.overviewDashboardHeading}>Active Projects</Text>
            <TouchableOpacity onPress={() => setShowAddProject(current => !current)}>
              <Text style={styles.overviewDashboardLink}>
                {showAddProject ? 'Cancel' : 'Add project'}
              </Text>
            </TouchableOpacity>
          </View>
          {showAddProject ? (
            <AddProjectCard
              buttonLabel="Create Project"
              placeholder="New project name"
              onAdd={projectName => {
                const added = onAddProject(projectName);
                if (added) setShowAddProject(false);
                return added;
              }}
            />
          ) : null}
          {overviewRows.map(row => {
            const health = row.health;
            const healthColor = health === 'Blocked'
              ? colors.danger
              : health === 'At Risk'
                ? colors.warning
                : health === 'Needs Setup'
                  ? colors.muted
                  : colors.success;
            const photo = overviewPhotoForProject(row.project);
            const lastUpdate = projectUpdatesForParentProject(
              savedUpdates,
              row.project,
              scheduleItems,
            )
              .map(update => update.date)
              .filter((update): update is string => Boolean(update))
              .sort((left, right) => right.localeCompare(left))[0] || null;

            return (
              <TouchableOpacity
                key={row.project}
                style={styles.overviewProjectCard}
                onPress={() => onOpenProject(row.project)}
              >
                {photo ? (
                  <ProjectPhotoImage {...photo} style={styles.overviewProjectImage} />
                ) : (
                  <View style={styles.overviewProjectImagePlaceholder}>
                    <Ionicons name="business-outline" size={28} color={colors.primary} />
                  </View>
                )}
                <View style={styles.overviewProjectContent}>
                  <View style={styles.overviewProjectTitleRow}>
                    <Text style={styles.overviewProjectTitle} numberOfLines={1}>{row.project}</Text>
                    <Text style={[styles.overviewProjectHealth, { color: healthColor }]}>{health}</Text>
                  </View>
                  <Text style={styles.overviewProjectSummary} numberOfLines={2}>{row.subtitle}</Text>
                  {row.needsVerification ? <DAVEProjectNeedsVerificationLabel /> : null}
                  <Text style={styles.overviewProjectActivity}>
                    {row.taskCount} {pluralWord(row.taskCount, 'task')} • {row.percentComplete}% complete
                  </Text>
                  <Text style={styles.overviewProjectActivity}>
                    {lastUpdate
                      ? `Last activity ${relativeUpdateDateLabel(lastUpdate)}`
                      : 'No activity recorded yet'}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color={colors.muted} />
              </TouchableOpacity>
            );
          })}
        </>
      ) : null}

      </OverviewResponsiveColumn>
      <OverviewResponsiveColumn priority="secondary">

      {dailyBriefItems.length > 0 ? (
        <View style={styles.overviewDailyBriefCard}>
          <DailyBriefSection
            title="Daily Brief"
            items={dailyBriefItems}
            emptyText=""
            onOpen={item => {
              if (item.navigationTarget === 'update_detail') {
                const update = savedUpdates.find(candidate => candidate.id === item.sourceRecordId);
                if (update) {
                  onOpenUpdate(update);
                  return;
                }
              }
              if (item.navigationTarget === 'capture') {
                onNewUpdate(liveAuthority.projectTruth.projectName);
                return;
              }
              onOpenProject(liveAuthority.projectTruth.projectName);
            }}
          />
        </View>
      ) : null}

      {archivedProjects.length > 0 ? (
        <View style={styles.phase2BriefCard}>
          <View style={styles.rowMain}>
            <Text style={styles.panelTitle}>Archived Projects</Text>
            <Text style={styles.locationDetailText}>
              Reopen a project to return it to the active portfolio.
            </Text>
            {archivedProjects.map(projectName => (
              <View key={projectName} style={styles.projectSelectorRow}>
                <View style={styles.rowMain}>
                  <Text style={styles.photoControlText}>{projectName}</Text>
                  <Text style={styles.rowSub}>Archived</Text>
                </View>
                <TouchableOpacity
                  style={styles.compactInlineAction}
                  onPress={() => onReopenProject(projectName)}
                  accessibilityRole="button"
                  accessibilityLabel={`Reopen ${projectName}`}
                >
                  <Text style={styles.compactInlineActionText}>Reopen</Text>
                </TouchableOpacity>
              </View>
            ))}
          </View>
        </View>
      ) : null}

      <View style={styles.overviewDashboardHeadingRow}>
        <Text style={styles.overviewDashboardHeading}>Recent Activity</Text>
        <TouchableOpacity onPress={onOpenAllActivity}>
          <Text style={styles.overviewDashboardLink}>View all activity</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.overviewActivityCard}>
        {recentActivity.length > 0 ? recentActivity.map((update, index) => {
          const group = updateTimelineGroup(update.date);
          const previousGroup = index > 0 ? updateTimelineGroup(recentActivity[index - 1].date) : null;
          return (
            <View key={update.id}>
              {group !== previousGroup ? <Text style={styles.overviewActivityGroup}>{group}</Text> : null}
              <TouchableOpacity style={styles.overviewActivityRow} onPress={() => onOpenUpdate(update)}>
                <View style={styles.overviewActivityIcon}>
                  <Ionicons name={update.photos.length > 0 ? 'camera-outline' : 'document-text-outline'} size={17} color={colors.primary} />
                </View>
                <View style={styles.rowMain}>
                  <Text style={styles.overviewActivityProject}>{update.projectName}</Text>
                  <Text style={styles.overviewActivityText} numberOfLines={1}>
                    {update.observedFindings?.[0] || update.notes.trim() || 'Project update recorded.'}
                  </Text>
                </View>
                <Text style={styles.overviewActivityTime}>{relativeUpdateTimestamp(update.date)}</Text>
              </TouchableOpacity>
            </View>
          );
        }) : (
          <Text style={styles.overviewBriefEmpty}>Recent project activity will show up here.</Text>
        )}
      </View>
      </OverviewResponsiveColumn>
      </OverviewResponsiveWorkspace>
      </OverviewResponsiveFrame>
      </ScrollView>
    </View>
  );
}

function Phase2ActivityRow({
  item,
  onPress,
  onRetry,
}: {
  item: Phase2ActivityItem;
  onPress: () => void;
  onRetry?: () => void;
}) {
  const statusStyle =
    item.pieStatus === PIE_STATUS_COPY.unavailableRetry ||
    item.pieStatus === PIE_STATUS_COPY.timeoutRetry ||
    item.pieStatus.includes('Retry')
      ? statusStyleForRole('needsRetry')
      : item.pieStatus === PIE_STATUS_COPY.noPriorPhoto ||
          item.pieStatus === PIE_STATUS_COPY.noReliableChange
        ? statusStyleForRole('informational')
        : item.pieStatus === PIE_STATUS_COPY.possibleChanges
          ? statusStyleForRole('possibleFinding')
          : statusStyleForRole('informational');

  return (
    <TouchableOpacity style={styles.activityRow} onPress={onPress}>
      <View style={styles.rowIconBubble}>
        <Ionicons name={statusStyle.icon} size={20} color={statusStyle.color} />
      </View>
      <View style={styles.rowMain}>
        <Text style={styles.projectName}>{item.projectName}</Text>
        <Text style={styles.rowSub}>
          {item.dateLabel} | {item.areaLabel}
        </Text>
        <Text style={styles.rowSub}>
          {item.photoCount} photo{item.photoCount === 1 ? '' : 's'} | {item.documentCount} document{item.documentCount === 1 ? '' : 's'} | {item.pieStatus}
        </Text>
      </View>
      {onRetry ? (
        <TouchableOpacity style={styles.phase3ChangeButton} onPress={onRetry}>
          <Text style={styles.dashboardManageText}>Retry</Text>
        </TouchableOpacity>
      ) : (
        <Ionicons name="chevron-forward" size={20} color={colors.muted} />
      )}
    </TouchableOpacity>
  );
}

function SelectProjectScreen({
  contentStyle,
  projects,
  projectStatsByName,
  onSelect,
  onAddProject,
}: {
  contentStyle: StyleProp<ViewStyle>;
  projects: string[];
  projectStatsByName: Record<string, ProjectStats>;
  onSelect: (projectName: string) => void;
  onAddProject: (projectName: string) => boolean;
}) {
  const renderProject = ({ item: project }: { item: string }) => (
    <ProjectDashboardCard
      project={project}
      stats={
        projectStatsForName(projectStatsByName, project)
      }
      actionLabel="Select"
      onPress={() => onSelect(project)}
    />
  );

  return (
    <FlatList
      style={styles.appFrame}
      contentContainerStyle={contentStyle}
      keyboardShouldPersistTaps="handled"
      initialNumToRender={12} maxToRenderPerBatch={12} windowSize={7} removeClippedSubviews={Platform.OS === 'android'}
      data={projects}
      keyExtractor={project => project}
      renderItem={renderProject}
      ListHeaderComponent={
        <>
          <ScreenTitle
            title="Select Project"
            subtitle="Choose the job this update belongs to."
          />

          <AddProjectCard
            buttonLabel="Add and Start"
            placeholder="Example: Building 2400 Roof"
            onAdd={onAddProject}
          />
        </>
      }
      ListEmptyComponent={
        <EmptyState
          title="No projects yet."
          text="Add a project manually to start an update."
        />
      }
    />
  );
}

function ProjectDocumentInlineRow({
  document,
  onRetry,
}: {
  document: ProjectDocument;
  onRetry?: () => void;
}) {
  const canRetry =
    Boolean(onRetry) &&
    (document.status === 'failed' || document.status === 'local');

  return (
    <View style={styles.compactLocationRow}>
      <Ionicons name="document-attach-outline" size={20} color={colors.primary} />
      <View style={styles.rowMain}>
        <Text style={styles.projectName}>{document.name}</Text>
        <Text style={styles.rowSub}>
          {document.category} · {projectDocumentStatusDetail(document)}
        </Text>
      </View>
      {canRetry ? (
        <TouchableOpacity style={styles.phase3ChangeButton} onPress={onRetry}>
          <Text style={styles.dashboardManageText}>Retry</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

type ScheduleDrivenWalkRecommendation = {
  source: 'schedule';
  areaName: string;
  taskName: string;
  reason: string;
};

function getScheduleDrivenWalkRecommendation(
  projectName: string,
  scheduleItems: ScheduleItem[],
): ScheduleDrivenWalkRecommendation | null {
  const candidates = scheduleTasksForParentProject(
    projectName,
    scheduleItems as unknown as import('./types').ScheduleItem[],
  )
    .filter(item => !scheduleTaskIsComplete(item) && item.locationName.trim())
    .sort((left, right) => {
      const leftDays = daysUntilScheduleItem(left) ?? 9999;
      const rightDays = daysUntilScheduleItem(right) ?? 9999;
      const leftPriority = left.priority === 'High' ? -20 : 0;
      const rightPriority = right.priority === 'High' ? -20 : 0;
      return leftDays + leftPriority - (rightDays + rightPriority);
    });
  const task = candidates[0];
  if (!task) return null;
  const days = daysUntilScheduleItem(task);
  const timing = days === null
    ? 'needs field verification'
    : days < 0
      ? `${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} overdue`
      : days === 0
        ? 'due today'
        : `due in ${days} day${days === 1 ? '' : 's'}`;
  return {
    source: 'schedule',
    areaName: task.locationName,
    taskName: task.taskName,
    reason: `${task.taskName} is ${timing}. Capture recommendations prioritize urgent imported schedule work.`,
  };
}

function AddPhotosScreen({
  contentStyle,
  update,
  projectAreas,
  selectedArea,
  areaSuggestion,
  locationNotice,
  recipientCount,
  contacts,
  draftSavedAt,
  onPickPhotos,
  onTakePhoto,
  onUpdatePhoto,
  onRemovePhoto,
  onMovePhoto,
  onPreviewPhoto,
  onNext,
  onContacts,
  onChangeArea,
  onAddDocument,
  onRetryDocumentUpload,
  onContinueWithoutPhotos,
  onRetryPhotoAnalysis,
  scheduleRecommendation,
  onDeleteUpdate,
}: {
  contentStyle: StyleProp<ViewStyle>;
  update: ProjectUpdate;
  projectAreas: ProjectArea[];
  selectedArea: ProjectArea | null;
  areaSuggestion: AreaSuggestion | null;
  locationNotice: DraftLocationNoticeDetail | null;
  recipientCount: number;
  contacts: ProjectContact[];
  draftSavedAt: string | null;
  onPickPhotos: () => void;
  onTakePhoto: (continuityAnchor?: PhotoContinuityAnchor | null) => void;
  onUpdatePhoto: (photoId: string, next: Partial<UpdatePhoto>) => void;
  onRemovePhoto: (photoId: string) => void;
  onMovePhoto: (photoId: string, direction: 'up' | 'down') => void;
  onPreviewPhoto: (photo: UpdatePhoto) => void;
  onNext: () => void;
  onContacts: () => void;
  onChangeArea: (areaId: string) => void;
  onAddDocument: () => void;
  onRetryDocumentUpload: (documentId: string) => void;
  onContinueWithoutPhotos: () => void;
  onRetryPhotoAnalysis: (photo: UpdatePhoto) => void;
  scheduleRecommendation: ScheduleDrivenWalkRecommendation | null;
  onDeleteUpdate?: () => void;
}) {
  const liveAuthority = usePIELiveAuthority();
  const [areaSheetOpen, setAreaSheetOpen] = useState(false);
  const [recipientSheetOpen, setRecipientSheetOpen] = useState(false);
  const [walkCorrectionMemory, setWalkCorrectionMemory] = useState<{
    areaId: string;
    correctionPenalty: number;
  } | null>(null);
  const documents = update.documents || [];
  const areaView = draftAreaPresentation({
    selectedArea,
    selectedAreaName: update.selectedAreaName,
    areaStatus: update.areaStatus,
    areaSuggestion,
    hasScheduleRecommendation: Boolean(scheduleRecommendation),
    correctionPenalty: walkCorrectionMemory?.correctionPenalty,
    locationNotice,
  });
  const { areaName, offeredSuggestion } = areaView;
  const repeatPhotoGuidance =
    liveAuthority.core?.photoRepeatGuidance.find(item =>
      item.needed &&
      item.projectName.trim().toLowerCase() === update.projectName.trim().toLowerCase() &&
      (!item.areaName || item.areaName.trim().toLowerCase() === areaName.trim().toLowerCase())
    ) || null;
  const takeContinuityPhoto = () => {
    const continuityAnchor = repeatPhotoGuidance
      ? createDAVEPhotoContinuityAnchor({
          guidance: repeatPhotoGuidance,
          projectName: update.projectName,
          areaName,
        })
      : null;
    onTakePhoto(continuityAnchor);
  };

  return (
    <ScrollView
      style={styles.appFrame}
      contentContainerStyle={contentStyle}
      keyboardShouldPersistTaps="handled"
    >
      <ScreenTitle
        title={update.projectName}
        subtitle="New Field Update"
      />

      <FieldUpdateStepIndicator current="Evidence" pieStatus="pending" />

      <DraftSavedIndicator savedAt={draftSavedAt} />

      {update.scheduleTaskName ? (
        <View style={styles.taskUpdateContextCard}>
          <Text style={styles.projectTaskEyebrow}>TASK UPDATE</Text>
          <Text style={styles.panelTitle}>{update.scheduleTaskName}</Text>
          <Text style={styles.locationDetailText}>
            {update.scheduleProjectName || update.projectName}
            {areaName ? ` · ${areaName}` : ''}
          </Text>
        </View>
      ) : null}

      <Text style={styles.phase3MainTitle}>Capture Evidence</Text>

      <View style={styles.phase3AutoCard}>
        <Text style={styles.panelTitle}>Current Area</Text>
        <Text style={styles.bodyText}>{areaName}</Text>
        <Text style={styles.locationDetailText}>
          Why: {areaView.reason}
        </Text>
        {areaView.locationNotice ? (
          <Text style={styles.locationDetailText}>{areaView.locationNotice}</Text>
        ) : null}
        {!areaView.locationNotice && areaView.confidenceScore < 60 ? (
          <Text style={styles.locationDetailText}>Location is uncertain. Choose the project area before relying on this recommendation.</Text>
        ) : null}
        {offeredSuggestion ? (
          <SecondaryButton
            label={`Accept Suggested Area: ${offeredSuggestion.area.name}`}
            icon="location-outline"
            onPress={() => onChangeArea(offeredSuggestion.area.id)}
          />
        ) : null}
        {scheduleRecommendation ? (
          <View style={styles.taskUpdateContextCard}>
            <Text style={styles.projectTaskEyebrow}>Next Area to Visit</Text>
            <Text style={styles.panelTitle}>{scheduleRecommendation.areaName}</Text>
            <Text style={styles.locationDetailText}>{scheduleRecommendation.reason}</Text>
          </View>
        ) : null}
      </View>

      {repeatPhotoGuidance ? (
        <View style={styles.phase3AutoCard}>
          <View style={styles.areaStatusLine}>
            <Ionicons name="scan-outline" size={20} color={colors.primary} />
            <Text style={styles.panelTitle}>Match the Previous View</Text>
          </View>
          {repeatPhotoGuidance.referencePhotoUri ? (
            <Image
              source={{ uri: repeatPhotoGuidance.referencePhotoUri }}
              style={styles.repeatPhotoReferenceImage}
              resizeMode="cover"
              accessibilityLabel="Previous project photo to match"
            />
          ) : null}
          <Text style={styles.bodyText}>{repeatPhotoGuidance.instruction}</Text>
          <Text style={styles.locationDetailText}>
            {repeatPhotoGuidance.alignmentGuide}
          </Text>
          <Text style={styles.locationDetailText}>
            Why: {repeatPhotoGuidance.reason}
          </Text>
        </View>
      ) : null}

      <PrimaryButton
        label={repeatPhotoGuidance ? 'Match Reference & Take Photo' : 'Take Photo'}
        icon="camera-outline"
        onPress={takeContinuityPhoto}
      />

      <SecondaryButton
        label="Choose From Library"
        icon="images-outline"
        onPress={onPickPhotos}
      />

      <View style={styles.phase3AutoCard}>
        <AreaRow
          areaName={areaView.areaRowName}
          status={areaView.areaRowStatus}
          onChange={() => setAreaSheetOpen(true)}
        />
        <RecipientSummaryRow
          recipientCount={recipientCount}
          contacts={contacts}
          onChange={() => setRecipientSheetOpen(true)}
        />
      </View>

      <View style={styles.phase3SummaryCard}>
        <ProgressStat number={update.photos.length} label="Photos" />
        <View style={styles.progressDivider} />
        <ProgressStat number={documents.length} label="Documents" />
      </View>

      {update.photos.length > 0 ? (
        <View style={styles.phase3AutoCard}>
          <Text style={styles.panelTitle}>Photo saved.</Text>
          <Text style={styles.locationDetailText}>
            Next Suggested Action: add another view if it changes the project record, add a note for context, or finish capture for review.
          </Text>
          <View style={styles.sendRow}>
            <SecondaryButton label="Add Another Photo" icon="camera-outline" onPress={takeContinuityPhoto} compact />
            <SecondaryButton label="Add Note" icon="create-outline" onPress={onNext} compact />
          </View>
        </View>
      ) : null}

      {update.photos.map((photo, index) => (
        <PhotoCard
          key={photo.id}
          projectName={update.projectName}
          photo={photo}
          index={index}
          onUpdate={next => onUpdatePhoto(photo.id, next)}
          onRemove={() => onRemovePhoto(photo.id)}
          onMoveUp={() => onMovePhoto(photo.id, 'up')}
          onMoveDown={() => onMovePhoto(photo.id, 'down')}
          onPreview={() => onPreviewPhoto(photo)}
          onRetryAnalysis={() => onRetryPhotoAnalysis(photo)}
          onSignInForAnalysis={() => onRetryPhotoAnalysis(photo)}
          canMoveUp={index > 0}
          canMoveDown={index < update.photos.length - 1}
        />
      ))}

      {documents.length > 0 ? (
        documents.map(document => (
          <ProjectDocumentInlineRow
            key={document.id}
            document={document}
            onRetry={() => onRetryDocumentUpload(document.id)}
          />
        ))
      ) : null}

      <SecondaryButton
        label="Add Document"
        icon="document-attach-outline"
        onPress={onAddDocument}
      />

      {update.photos.length > 0 || documents.length > 0 ? (
        <PrimaryButton
          label="Continue"
          icon="arrow-forward-outline"
          onPress={onNext}
        />
      ) : (
        <SecondaryButton
          label="Continue Without Photos"
          icon="arrow-forward-outline"
          onPress={onContinueWithoutPhotos}
        />
      )}

      {onDeleteUpdate ? (
        <SecondaryButton
          label="Delete Saved Update"
          icon="trash-outline"
          onPress={onDeleteUpdate}
        />
      ) : null}

      <AreaSelectionSheet
        visible={areaSheetOpen}
        projectAreas={projectAreas}
        suggestedArea={areaSuggestion?.area || selectedArea}
        selectedAreaId={update.selectedAreaId || null}
        onSelect={areaId => {
          setWalkCorrectionMemory({ areaId, correctionPenalty: 10 });
          onChangeArea(areaId);
          setAreaSheetOpen(false);
        }}
        onClose={() => setAreaSheetOpen(false)}
      />

      <RecipientSelectionSheet
        visible={recipientSheetOpen}
        contacts={contacts}
        recipientCount={recipientCount}
        onOpenContacts={() => {
          setRecipientSheetOpen(false);
          onContacts();
        }}
        onClose={() => setRecipientSheetOpen(false)}
      />
    </ScrollView>
  );
}

function FieldUpdateStepIndicator({
  current,
  pieStatus,
}: {
  current: 'Evidence' | 'Photo Analysis' | 'Review';
  pieStatus: 'pending' | 'in_progress' | 'complete';
}) {
  const steps = ['Evidence', 'Photo Analysis', 'Review'] as const;

  return (
    <View style={styles.phase3StepRow}>
      {steps.map(step => {
        const active = current === step;
        const complete =
          step === 'Evidence' && current !== 'Evidence' ||
          step === 'Photo Analysis' && pieStatus === 'complete';

        return (
          <View
            key={step}
            style={[
              styles.phase3StepPill,
              active && styles.phase3StepPillActive,
              complete && styles.phase3StepPillComplete,
            ]}
          >
            <Text
              style={[
                styles.phase3StepText,
                (active || complete) && styles.phase3StepTextActive,
              ]}
            >
              {step}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

function AreaRow({
  areaName,
  status,
  onChange,
}: {
  areaName: string;
  status?: ProjectUpdate['areaStatus'];
  onChange: () => void;
}) {
  const statusLabel = status === 'confirmed'
    ? 'Area auto-detected'
    : status === 'suggested' ? 'Area suggested' : 'Selected area';

  return (
    <View style={styles.phase3CompactRow}>
      <View style={styles.rowMain}>
        <Text style={styles.phase2SelectorLabel}>Area</Text>
        <Text style={styles.projectName}>
          {statusLabel} · {areaName}
        </Text>
      </View>
      <TouchableOpacity style={styles.phase3ChangeButton} onPress={onChange}>
        <Text style={styles.dashboardManageText}>Change</Text>
      </TouchableOpacity>
    </View>
  );
}
function RecipientSummaryRow({
  recipientCount,
  contacts,
  onChange,
}: {
  recipientCount: number;
  contacts: ProjectContact[];
  onChange: () => void;
}) {
  const label =
    recipientCount > 0
      ? `Site Team · ${recipientCount} people`
      : 'None selected';

  return (
    <View style={styles.phase3CompactRow}>
      <View style={styles.rowMain}>
        <Text style={styles.phase2SelectorLabel}>Recipients</Text>
        <Text style={styles.projectName}>{label}</Text>
        <Text style={styles.rowSub}>
          {/* Nothing sends an update to them; the list is kept with the update (owner answer Q18). */}
          Optional · kept with the update; the app does not send it to them
        </Text>
      </View>
      <TouchableOpacity style={styles.phase3ChangeButton} onPress={onChange}>
        <Text style={styles.dashboardManageText}>
          {recipientCount > 0 ? 'Change' : 'Add'}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

function AreaSelectionSheet({
  visible,
  projectAreas,
  suggestedArea,
  selectedAreaId,
  onSelect,
  onClose,
}: {
  visible: boolean;
  projectAreas: ProjectArea[];
  suggestedArea: ProjectArea | null;
  selectedAreaId: string | null;
  onSelect: (areaId: string) => void;
  onClose: () => void;
}) {
  const [searchText, setSearchText] = useState('');
  const [showAll, setShowAll] = useState(false);
  const search = searchText.trim().toLowerCase();
  // Only the actual GPS/location-based suggestion belongs under "Suggested" -
  // padding this out with arbitrary areas (e.g. the first two in the list)
  // mislabels them as relevant when they aren't.
  const suggestedRows = suggestedArea ? [suggestedArea] : [];
  const allRows = projectAreas.filter(area => {
    if (!search) return true;
    return area.name.toLowerCase().includes(search);
  });

  return (
    <ProjectActionSheet visible={visible} title="Change Area" onClose={onClose}>
      <View style={styles.projectSearchBox}>
        <Ionicons name="search-outline" size={19} color={colors.muted} />
        <TextInput
          style={styles.projectSearchInput}
          value={searchText}
          onChangeText={setSearchText}
          placeholder="Search area"
          placeholderTextColor={colors.muted}
        />
      </View>

      <Text style={styles.sectionLabel}>Suggested</Text>
      <AreaSelectionRow
        name="Unassigned / Unknown Area"
        selected={!selectedAreaId}
        onPress={() => onSelect('')}
      />
      {suggestedRows.map(area => (
        <AreaSelectionRow
          key={area.id}
          name={area.name}
          selected={selectedAreaId === area.id}
          onPress={() => onSelect(area.id)}
        />
      ))}

      {showAll || search ? (
        <>
          <Text style={styles.sectionLabel}>All Areas</Text>
          {allRows.map(area => (
            <AreaSelectionRow
              key={area.id}
              name={area.name}
              selected={selectedAreaId === area.id}
              onPress={() => onSelect(area.id)}
            />
          ))}
        </>
      ) : (
        <SecondaryButton
          label="Show All Areas"
          icon="list-outline"
          onPress={() => setShowAll(true)}
        />
      )}
    </ProjectActionSheet>
  );
}

function AreaSelectionRow({
  name,
  selected,
  onPress,
}: {
  name: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      style={[
        styles.projectSelectorRow,
        selected && styles.projectSelectorRowSelected,
      ]}
      onPress={onPress}
    >
      <View style={styles.rowMain}>
        <Text style={styles.projectName}>{name}</Text>
      </View>
      {selected ? (
        <Ionicons name="checkmark-circle" size={22} color={colors.primary} />
      ) : null}
    </TouchableOpacity>
  );
}

function RecipientSelectionSheet({
  visible,
  contacts,
  recipientCount,
  onOpenContacts,
  onClose,
}: {
  visible: boolean;
  contacts: ProjectContact[];
  recipientCount: number;
  onOpenContacts: () => void;
  onClose: () => void;
}) {
  return (
    <ProjectActionSheet visible={visible} title="Recipients" onClose={onClose}>
      <Text style={styles.bodyText}>
        Project defaults, area defaults, email contacts, text contacts, and recent recipients use the saved contact list.
      </Text>
      <View style={styles.compactStatsRow}>
        <Text style={styles.compactStatText}>{recipientCount} selected</Text>
        <Text style={styles.compactStatText}>{contacts.length} recent</Text>
      </View>
      <SecondaryButton
        label="Open Contacts"
        icon="people-outline"
        onPress={onOpenContacts}
      />
    </ProjectActionSheet>
  );
}

function PhotoCard({
  projectName,
  photo,
  index,
  onUpdate,
  onRemove,
  onMoveUp,
  onMoveDown,
  onPreview,
  onRetryAnalysis,
  onSignInForAnalysis,
  canMoveUp,
  canMoveDown,
}: {
  projectName: string;
  photo: UpdatePhoto;
  index: number;
  onUpdate: (
    next: Partial<UpdatePhoto>,
  ) => void;
  onRemove: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onPreview: () => void;
  onRetryAnalysis: () => void;
  onSignInForAnalysis: () => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
}) {
  return (
    <View style={styles.photoCard}>
      <View style={styles.photoHeader}>
        <TouchableOpacity
          onPress={onPreview}
          accessibilityLabel={`Preview photo ${index + 1}`}
        >
          <Image
            source={{ uri: resolveProjectPhotoDisplayUri(photo) }}
            style={styles.photoThumb}
          />

          <View style={styles.photoPreviewBadge}>
            <Ionicons
              name="expand-outline"
              size={13}
              color="#FFFFFF"
            />
          </View>
        </TouchableOpacity>

        <View style={styles.photoMeta}>
          <Text style={styles.photoTitle}>
            Photo {index + 1}
          </Text>

          <Text style={styles.bodyText}>
            {photo.caption.trim()
              ? 'Ready for update'
              : 'Needs field note'}
          </Text>
        </View>

        <TouchableOpacity
          style={styles.iconOnlyDangerButton}
          onPress={onRemove}
        >
          <Ionicons
            name="trash-outline"
            size={19}
            color={colors.danger}
          />
        </TouchableOpacity>
      </View>

      {photo.photoIntelligence ? (
        <RootPhotoIntelligenceCard
          result={photo.photoIntelligence}
          projectName={projectName}
          photo={photo}
          onRetry={
            photo.photoIntelligence.status === 'analysis_failed_retry' ||
            photo.photoIntelligence.status === 'comparison_unavailable'
              ? onRetryAnalysis
              : undefined
          }
          onSignInRequired={
            pieResultRequiresSupabaseSignIn(photo.photoIntelligence)
              ? onSignInForAnalysis
              : undefined
          }
          onReview={review => onUpdate({
            photoIntelligence: {
              ...photo.photoIntelligence!,
              userReview: review,
              userReviewedAt: new Date().toISOString(),
            },
          })}
        />
      ) : null}

      <Text style={styles.label}>
        Category
      </Text>

      <View style={styles.categoryGrid}>
        {CATEGORIES.map(category => (
          <TouchableOpacity
            key={category}
            style={[
              styles.categoryChip,
              photo.category === category &&
                styles.categoryChipActive,
            ]}
            onPress={() =>
              onUpdate({ category })
            }
          >
            <Ionicons
              name={CATEGORY_ICONS[category]}
              size={15}
              color={
                photo.category === category
                  ? '#FFFFFF'
                  : colors.primary
              }
            />

            <Text
              style={[
                styles.categoryText,
                photo.category === category &&
                  styles.categoryTextActive,
              ]}
            >
              {category}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.label}>
        Field note
      </Text>

      <TextInput
        style={styles.input}
        value={photo.caption}
        onChangeText={caption =>
          onUpdate({ caption })
        }
        placeholder="Example: Concrete transition area completed."
        placeholderTextColor={colors.muted}
        multiline
      />

      {isActionCategory(photo.category) ? (
        <View style={styles.actionPanel}>
          <View style={styles.actionPanelHeader}>
            <Ionicons
              name="checkbox-outline"
              size={19}
              color={colors.primary}
            />

            <Text style={styles.actionPanelTitle}>
              Action Item
            </Text>
          </View>

          <Text style={styles.label}>
            Action required
          </Text>

          <TextInput
            style={styles.input}
            value={photo.actionRequired}
            onChangeText={actionRequired =>
              onUpdate({ actionRequired })
            }
            placeholder="Example: Obtain asphalt repair proposal."
            placeholderTextColor={colors.muted}
            multiline
          />

          <Text style={styles.label}>
            Owner
          </Text>

          <TextInput
            style={styles.input}
            value={photo.actionOwner}
            onChangeText={actionOwner =>
              onUpdate({ actionOwner })
            }
            placeholder="Example: Matt"
            placeholderTextColor={colors.muted}
            autoCapitalize="words"
          />

          <Text style={styles.label}>
            Due date
          </Text>

          <TextInput
            style={styles.input}
            value={photo.actionDueDate}
            onChangeText={actionDueDate =>
              onUpdate({ actionDueDate })
            }
            placeholder="YYYY-MM-DD"
            placeholderTextColor={colors.muted}
            keyboardType="numbers-and-punctuation"
            maxLength={10}
          />

          {photo.actionDueDate.trim() &&
          !parseDueDate(photo.actionDueDate) ? (
            <Text style={styles.dateHelpError}>
              Enter the date as YYYY-MM-DD.
            </Text>
          ) : null}

          <Text style={styles.label}>
            Status
          </Text>

          <View style={styles.statusGrid}>
            {ACTION_STATUSES.map(status => (
              <TouchableOpacity
                key={status}
                style={[
                  styles.statusButton,
                  photo.actionStatus === status &&
                    styles.statusButtonActive,
                ]}
                onPress={() =>
                  onUpdate({
                    actionStatus: status,
                  })
                }
              >
                <Text
                  style={[
                    styles.statusButtonText,
                    photo.actionStatus === status &&
                      styles.statusButtonTextActive,
                  ]}
                >
                  {status}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      ) : null}

      <View style={styles.photoControlRow}>
        <TouchableOpacity
          style={styles.photoControlButton}
          onPress={onPreview}
        >
          <Ionicons
            name="expand-outline"
            size={17}
            color={colors.primary}
          />

          <Text style={styles.photoControlText}>
            View
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.photoControlButton,
            !canMoveUp &&
              styles.photoControlButtonDisabled,
          ]}
          onPress={onMoveUp}
          disabled={!canMoveUp}
        >
          <Ionicons
            name="arrow-up-outline"
            size={17}
            color={
              canMoveUp
                ? colors.primary
                : colors.tertiaryText
            }
          />

          <Text
            style={[
              styles.photoControlText,
              !canMoveUp &&
                styles.photoControlTextDisabled,
            ]}
          >
            Up
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.photoControlButton,
            !canMoveDown &&
              styles.photoControlButtonDisabled,
          ]}
          onPress={onMoveDown}
          disabled={!canMoveDown}
        >
          <Ionicons
            name="arrow-down-outline"
            size={17}
            color={
              canMoveDown
                ? colors.primary
                : colors.tertiaryText
            }
          />

          <Text
            style={[
              styles.photoControlText,
              !canMoveDown &&
                styles.photoControlTextDisabled,
            ]}
          >
            Down
          </Text>
        </TouchableOpacity>
      </View>

    </View>
  );
}

function RootPhotoIntelligenceCard({
  result,
  projectName,
  photo,
  onRetry,
  onSignInRequired,
  onReview,
}: {
  result: PIEPhotoIntelligenceDisplayState;
  projectName?: string;
  photo?: UpdatePhoto;
  onRetry?: () => void;
  onSignInRequired?: () => void;
  onReview?: (review: 'confirmed' | 'incorrect' | 'not_useful') => void;
}) {
  const [showDetails, setShowDetails] = useState(false);
  if (result.status === 'no_suitable_prior_photo') {
    const comparisonArea = photo?.selectedAreaName?.trim() || projectName?.trim() || 'this area';

    return (
      <View style={styles.locationPanel}>
        <View style={styles.locationPanelHeader}>
          <View style={styles.rowIconBubble}>
            <Ionicons name="images-outline" size={20} color={colors.success} />
          </View>
          <View style={styles.rowMain}>
            <Text style={styles.panelTitle}>Baseline saved</Text>
            <Text style={styles.rowSub}>{comparisonArea} is ready for future photo comparisons.</Text>
          </View>
        </View>
        <Text style={styles.bodyText}>
          Take the next photo from a similar angle to compare visible construction changes.
        </Text>
      </View>
    );
  }

  if (result.status !== 'analysis_complete' && result.status !== 'completed_with_limitations') {
    return (
      <View style={styles.locationPanel}>
        <View style={styles.locationPanelHeader}>
          <View style={styles.rowIconBubble}>
            <Ionicons
              name={result.status === 'analyzing' ? 'sync-outline' : 'image-outline'}
              size={20}
              color={result.status === 'analysis_failed_retry' ? colors.warning : colors.primary}
            />
          </View>
          <View style={styles.rowMain}>
            <Text style={styles.panelTitle}>{pieUserStatus(result)}</Text>
            <Text style={styles.rowSub}>{result.summary}</Text>
          </View>
        </View>
        {onRetry ? (
          <TouchableOpacity
            style={styles.photoControlButton}
            onPress={onRetry}
            accessibilityLabel="Retry photo analysis"
          >
            <Ionicons name="refresh-outline" size={17} color={colors.primary} />
            <Text style={styles.photoControlText}>Retry Analysis</Text>
          </TouchableOpacity>
        ) : null}
        {onSignInRequired ? (
          <TouchableOpacity
            style={styles.photoControlButton}
            onPress={onSignInRequired}
            accessibilityLabel="Sign in to enable photo intelligence"
          >
            <Ionicons name="person-circle-outline" size={17} color={colors.primary} />
            <Text style={styles.photoControlText}>Sign in to enable photo intelligence</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    );
  }

  const priorUpdateUsed = priorUpdateUsedForPIEResult(result);
  const reviewCandidate = photoDisplayResultIsReviewCandidate(result);
  const primaryFinding = result.visibleChange || result.changedFromPrior || result.summary;
  const firstConcern = result.possibleConcerns?.[0] || null;
  const whyItMatters = firstConcern
    ? `Review this visible concern: ${firstConcern}`
    : result.projectProgress === 'supported'
      ? 'This visible change may support progress after normal scope and project-evidence checks.'
      : 'This is a visible change only. Confirm it before it is used in project reports or decisions.';
  const nextAction = result.userReview === 'confirmed'
    ? 'Confirmed for project intelligence.'
    : result.userReview === 'incorrect'
      ? 'Marked incorrect and excluded from project intelligence.'
      : result.userReview === 'not_useful'
        ? 'Marked not useful and excluded from project intelligence.'
        : result.repeatPhotoGuidance || 'Confirm, mark incorrect, or mark not useful.';

  return (
    <View style={styles.locationPanel}>
      <View style={styles.locationPanelHeader}>
        <View style={styles.rowIconBubble}>
          <Ionicons
            name="sparkles-outline"
            size={20}
            color={colors.success}
          />
        </View>

        <View style={styles.rowMain}>
          <Text style={styles.panelTitle}>{pieUserStatus(result)}</Text>
          <Text style={styles.rowSub}>
            {reviewCandidate ? 'Review the visible finding before it is used elsewhere.' : result.summary}
          </Text>
        </View>
      </View>
      <PhotoComparisonPreviewRow result={result} photo={photo} projectName={projectName} localUri={resolveProjectPhotoUri} />
      <PIEDetailLine label="What changed" value={primaryFinding} />
      {reviewCandidate ? <PIEDetailLine label="Why it matters" value={whyItMatters} /> : null}
      {reviewCandidate ? <PIEDetailLine label="Next action" value={nextAction} /> : null}
      {reviewCandidate && onReview ? (
        <View style={styles.photoComparisonReviewRow}>
          {([
            ['confirmed', 'Confirm'],
            ['incorrect', 'Incorrect'],
            ['not_useful', 'Not useful'],
          ] as const).map(([review, label]) => (
            <TouchableOpacity
              key={review}
              style={[
                styles.compactInlineAction,
                result.userReview === review && styles.photoComparisonReviewActionSelected,
              ]}
              onPress={() => onReview(review)}
              accessibilityRole="button"
              accessibilityState={{ selected: result.userReview === review }}
            >
              <Text style={[styles.compactInlineActionText,
                result.userReview === review && styles.photoComparisonReviewActionTextSelected]}>{label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      ) : null}
      <TouchableOpacity
        style={styles.photoComparisonDetailsButton}
        onPress={() => setShowDetails(current => !current)}
        accessibilityRole="button"
        accessibilityState={{ expanded: showDetails }}
      >
        <Text style={styles.dashboardManageText}>{showDetails ? 'Hide Details' : 'Details'}</Text>
      </TouchableOpacity>
      {showDetails ? (
        <View>
          {result.location ? <PIEDetailLine label="Location" value={result.location} /> : null}
          {result.comparisonConfidence ? <PIEDetailLine label="Confidence" value={pieConfidenceSentence(result.comparisonConfidence)} /> : null}
          {result.comparability ? <PIEDetailLine label="Comparability" value={pieComparabilitySentence(result.comparability)} /> : null}
          {result.captureLimitations.length > 0 ? <PIEDetailLine label="Limitations" value={result.captureLimitations.join(' ')} /> : null}
          {priorUpdateUsed ? <PIEDetailLine label="Prior update" value={priorUpdateUsed} /> : null}
          <PIEDetailLine label="Analysis time" value={analysisTimeTextForPIEResult(result.updatedAt)} />
          <Text style={styles.locationDetailText}>{result.authorityMessage}</Text>
        </View>
      ) : null}
    </View>
  );
}

function pieConfidenceSentence(confidence: string): string {
  switch (confidence) {
    case 'high':
      return 'High confidence in this finding.';
    case 'medium':
      return 'Moderate confidence in this finding.';
    case 'low':
      return 'Low confidence in this finding — treat it cautiously.';
    default:
      return `Evidence support: ${confidence}`;
  }
}

function pieComparabilitySentence(comparability: string): string {
  switch (comparability) {
    case 'strong':
      return 'These photos are a strong, reliable comparison.';
    case 'probable':
      return 'These photos are probably comparable, with some limitations.';
    case 'weak':
      return 'These photos are only weakly comparable — differences may reflect camera or angle changes rather than real changes.';
    case 'not_comparable':
      return "These photos couldn't be reliably compared.";
    default:
      return `Comparability: ${comparability}`;
  }
}

function pieInterpretationCaveat(confidence: string, comparability: string): string {
  const cautious =
    confidence === 'low' ||
    comparability === 'weak' ||
    comparability === 'not_comparable';

  if (cautious) {
    return 'This finding carries real uncertainty. Treat both the observation and this interpretation with caution, and verify directly before relying on it.';
  }

  const confident =
    confidence === 'high' &&
    (comparability === 'strong' || comparability === 'probable');

  if (confident) {
    return 'High confidence in this observation. The interpretation above is still a judgment call — confirm it reflects real project context before using it as a claim.';
  }

  return 'Suggestion only, moderate confidence. Confirm this interpretation before using it as a message claim.';
}

function PIEDetailLine({ label, value }: { label: string; value: string }) {
  return (
    <Text style={styles.locationDetailText}>
      {label}: {value}
    </Text>
  );
}

function PIEFindingRow({
  role,
  title,
  detail,
  confirmed,
  dismissed,
  onConfirm,
  onDismiss,
}: {
  role: StatusStyleRole;
  title: string;
  detail?: string | null;
  confirmed?: boolean;
  dismissed?: boolean;
  onConfirm?: () => void;
  onDismiss?: () => void;
}) {
  const statusStyle = statusStyleForRole(role);

  return (
    <View
      style={[
        styles.pieFindingRow,
        { backgroundColor: statusStyle.backgroundColor },
      ]}
    >
      <Ionicons name={statusStyle.icon} size={19} color={statusStyle.color} />
      <View style={styles.rowMain}>
        <Text style={[styles.projectName, { color: statusStyle.color }]}>
          {title}
        </Text>
        {detail ? (
          <Text style={styles.bodyText}>{detail}</Text>
        ) : null}
        {confirmed ? (
          <Text style={styles.locationDetailText}>Confirmed for message</Text>
        ) : dismissed ? (
          <Text style={styles.locationDetailText}>Dismissed</Text>
        ) : null}
        {onConfirm || onDismiss ? (
          <View style={styles.pieInterpretationActionRow}>
            {onConfirm ? (
              <TouchableOpacity
                style={styles.compactInlineAction}
                onPress={onConfirm}
                accessibilityRole="button"
                accessibilityLabel={`Confirm ${title}`}
              >
                <Text style={styles.compactInlineActionText}>Confirm</Text>
              </TouchableOpacity>
            ) : null}
            {onDismiss ? (
              <TouchableOpacity
                style={styles.compactInlineAction}
                onPress={onDismiss}
                accessibilityRole="button"
                accessibilityLabel={`Dismiss ${title}`}
              >
                <Text style={styles.compactInlineActionText}>Dismiss</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        ) : null}
      </View>
    </View>
  );
}

function pieUserStatus(result: PIEPhotoIntelligenceDisplayState) {
  const authCopy = authStatusCopyForPIEResult(result);
  if (authCopy) return authCopy;

  if (result.status === 'analyzing') return PIE_STATUS_COPY.checking;
  if (result.status === 'no_suitable_prior_photo') return PIE_STATUS_COPY.noPriorPhoto;
  if (result.status === 'analysis_failed_retry' || result.status === 'comparison_unavailable') {
    return PIE_STATUS_COPY.unavailableRetry;
  }
  if (result.visibleChange || (result.additions?.length || 0) > 0 || (result.removals?.length || 0) > 0) {
    return PIE_STATUS_COPY.possibleChanges;
  }
  if (result.projectProgress === 'unsupported') return PIE_STATUS_COPY.noReliableChange;
  return PIE_STATUS_COPY.noReliableChange;
}

function BuildUpdateScreen({
  update,
  selectedArea,
  draftSavedAt,
  pieStatus,
  isSaving,
  onNotesChange,
  onSaveUpdate,
  onEditPhotos,
  onAddDocument,
  onRetryDocumentUpload,
  onConfirmInterpretation,
  onDismissInterpretation,
  onRetryPhotoAnalysis,
  onDeleteUpdate,
}: {
  update: ProjectUpdate;
  selectedArea: ProjectArea | null;
  draftSavedAt: string | null;
  pieStatus: { status: FieldUpdatePIEStatus; summary: string };
  isSaving: boolean;
  onNotesChange: (notes: string) => void;
  onSaveUpdate: () => void;
  onEditPhotos: () => void;
  onAddDocument: () => void;
  onRetryDocumentUpload: (documentId: string) => void;
  onConfirmInterpretation: (interpretation: string) => void;
  onDismissInterpretation: (interpretation: string) => void;
  onRetryPhotoAnalysis: (photo: UpdatePhoto) => void;
  onDeleteUpdate?: () => void;
}) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const documents = update.documents || [];
  const areaName =
    selectedArea?.name ||
    update.selectedAreaName ||
    'Unassigned / Unknown Area';
  const pieResults = pieResultsForUpdate(update);
  const firstResult = pieResults[0];
  const firstPriorUpdateUsed = priorUpdateUsedForPIEResult(firstResult);
  const hasSafety = updateHasSafetyConcern(update);
  const hasBlocker = updateHasBlocker(update);
  const photoAssessment = photoAssessmentForUpdate(update);
  const failedPhoto = update.photos.find(
    photo =>
      photo.photoIntelligence?.status === 'analysis_failed_retry' ||
      photo.photoIntelligence?.status === 'comparison_unavailable',
  );
  const observedFindings = uniqueStrings([
    ...observedFindingsForUpdateBrief(update),
    ...observedFindingsForPIEResult(firstResult),
  ]);
  const possibleInterpretations = uniqueStrings([
    ...(updateSupportsPIEInterpretations(update, pieStatus)
      ? update.possibleInterpretations || []
      : []),
    ...possibleInterpretationsForPIEResult(firstResult),
  ]);
  const confirmedInterpretations = new Set(update.confirmedInterpretations || []);
  const dismissedInterpretations = new Set(update.dismissedInterpretations || []);

  return (
    <View>
      <ScreenTitle
        title={update.projectName}
        subtitle="Update Preview"
      />

      <DraftSavedIndicator
        savedAt={draftSavedAt}
      />

      <View style={styles.phase4PieCard}>
        <Text style={styles.panelTitle}>Photo Analysis</Text>
        {hasSafety ? (
          <View style={styles.phase4SafetyFinding}>
            <Ionicons name="warning-outline" size={20} color={colors.warning} />
            <View style={styles.rowMain}>
              <Text style={styles.phase4SafetyTitle}>Safety concern detected</Text>
              <Text style={styles.bodyText}>
                {firstResult?.possibleConcerns?.[0] || 'Safety was marked for review.'}
              </Text>
            </View>
          </View>
        ) : null}
        <Text style={styles.projectName}>{pieStatus.summary}</Text>

        {observedFindings.length > 0 ? (
          <>
            <Text style={styles.sectionLabelNoMargin}>Observed findings</Text>
            {observedFindings.slice(0, 4).map(finding => (
              <PIEFindingRow
                key={finding}
                role={hasSafety && finding.toLowerCase().includes('safety') ? 'safety' : 'possibleFinding'}
                title={finding}
              />
            ))}
          </>
        ) : null}

        {possibleInterpretations.length > 0 ? (
          <>
            <Text style={styles.sectionLabelNoMargin}>Possible interpretations</Text>
            {possibleInterpretations.map(interpretation => {
              const confirmed = confirmedInterpretations.has(interpretation);
              const dismissed = dismissedInterpretations.has(interpretation);

              return (
                <PIEFindingRow
                  key={interpretation}
                  role={hasSafety && interpretation.toLowerCase().includes('safety') ? 'safety' : 'interpretation'}
                  title={interpretation}
                  detail={pieInterpretationCaveat(
                    firstResult?.comparisonConfidence ?? '',
                    firstResult?.comparability ?? '',
                  )}
                  confirmed={confirmed}
                  dismissed={dismissed}
                  onConfirm={dismissed ? undefined : () => onConfirmInterpretation(interpretation)}
                  onDismiss={confirmed ? undefined : () => onDismissInterpretation(interpretation)}
                />
              );
            })}
          </>
        ) : null}

        <PIEFindingRow
          role={hasSafety ? 'safety' : photoAssessment.state === 'assessed_clear' ? 'confirmedClear' : 'possibleFinding'}
          title={
            hasSafety
              ? 'Safety concern requires review'
              : photoAssessmentReviewCopy(photoAssessment.state, 'safety concern')
          }
        />
        <PIEFindingRow
          role={hasBlocker ? 'interpretation' : photoAssessment.state === 'assessed_clear' ? 'confirmedClear' : 'possibleFinding'}
          title={
            hasBlocker
              ? 'Possible blocker requires review'
              : photoAssessmentReviewCopy(photoAssessment.state, 'blocker')
          }
        />
        {firstResult?.comparisonConfidence ? (
          <Text style={styles.locationDetailText}>
            {pieConfidenceSentence(firstResult.comparisonConfidence)}
          </Text>
        ) : null}
        {firstResult?.comparability ? (
          <Text style={styles.locationDetailText}>
            {pieComparabilitySentence(firstResult.comparability)}
          </Text>
        ) : null}
        {pieStatus.status === 'analyzing' ? (
          <Text style={styles.locationDetailText}>
            Photo analysis is still in progress.
          </Text>
        ) : null}
        {failedPhoto ? (
          <TouchableOpacity
            style={styles.photoControlButton}
            onPress={() => onRetryPhotoAnalysis(failedPhoto)}
          >
            <Ionicons name="refresh-outline" size={17} color={colors.primary} />
            <Text style={styles.photoControlText}>Retry</Text>
          </TouchableOpacity>
        ) : null}
        <TouchableOpacity
          style={styles.photoControlButton}
          onPress={() => setDetailsOpen(prev => !prev)}
        >
          <Ionicons name={detailsOpen ? 'chevron-up-outline' : 'chevron-down-outline'} size={17} color={colors.primary} />
          <Text style={styles.photoControlText}>View Details</Text>
        </TouchableOpacity>
        {detailsOpen ? (
          <View style={styles.phase4DetailBlock}>
            {firstResult?.currentObservation ? (
              <PIEDetailLine label="Current observation" value={firstResult.currentObservation} />
            ) : null}
            {firstResult?.changedFromPrior ? (
              <PIEDetailLine label="Prior comparison" value={firstResult.changedFromPrior} />
            ) : null}
            {(firstResult?.additions || []).length > 0 ? (
              <PIEDetailLine label="Additions" value={(firstResult?.additions || []).join(', ')} />
            ) : null}
            {(firstResult?.removals || []).length > 0 ? (
              <PIEDetailLine label="Removals" value={(firstResult?.removals || []).join(', ')} />
            ) : null}
            {firstResult?.possibleProgress ? (
              <PIEDetailLine label="Possible progress" value={firstResult.possibleProgress} />
            ) : null}
            {(firstResult?.possibleConcerns || []).length > 0 ? (
              <PIEDetailLine label="Possible concerns" value={(firstResult?.possibleConcerns || []).join(' ')} />
            ) : null}
            {firstResult?.comparisonConfidence ? (
              <Text style={styles.locationDetailText}>
                {pieConfidenceSentence(firstResult.comparisonConfidence)}
              </Text>
            ) : null}
            {firstResult?.comparability ? (
              <Text style={styles.locationDetailText}>
                {pieComparabilitySentence(firstResult.comparability)}
              </Text>
            ) : null}
            {firstPriorUpdateUsed ? (
              <PIEDetailLine label="Prior update used" value={firstPriorUpdateUsed} />
            ) : null}
            {firstResult?.updatedAt ? (
              <PIEDetailLine label="Analysis timestamp" value={analysisTimeTextForPIEResult(firstResult.updatedAt)} />
            ) : null}
            {(firstResult?.visualGroundingRegions || []).length > 0 ? (
              <PIEDetailLine
                label="Visual grounding"
                value={(firstResult?.visualGroundingRegions || []).join(', ')}
              />
            ) : null}
            {documents.length > 0 ? (
              <PIEDetailLine label="Referenced documents" value={documents.map(document => document.name).join(', ')} />
            ) : null}
          </View>
        ) : null}
      </View>

      {update.quickContext ? (
        <View style={styles.compactLocationRow}>
          <Ionicons name="pricetag-outline" size={20} color={colors.primary} />
          <View style={styles.rowMain}>
            <Text style={styles.projectName}>Quick Context</Text>
            <Text style={styles.rowSub}>{update.quickContext}</Text>
          </View>
        </View>
      ) : null}

      <Text style={styles.sectionLabel}>Photos ({update.photos.length})</Text>
      {update.photos.length > 0 ? (
        <View style={styles.phase3ThumbRow}>
          {update.photos.map(photo => (
            <ProjectPhotoImage key={photo.id} photo={photo} localUri={resolveProjectPhotoUri(photo)} style={styles.phase3Thumb} />
          ))}
        </View>
      ) : (
        <Text style={styles.mutedNote}>No photos attached</Text>
      )}
      <TouchableOpacity style={styles.photoControlButton} onPress={onEditPhotos}>
        <Ionicons name="images-outline" size={17} color={colors.primary} />
        <Text style={styles.photoControlText}>Edit</Text>
      </TouchableOpacity>

      {documents.length > 0 ? (
        <>
          <Text style={styles.sectionLabel}>Documents ({documents.length})</Text>
          {documents.map(document => (
            <View key={document.id}>
              <ProjectDocumentInlineRow
                document={document}
                onRetry={() => onRetryDocumentUpload(document.id)}
              />
              <TouchableOpacity style={styles.phase3ChangeButton} onPress={onAddDocument}>
                <Text style={styles.dashboardManageText}>Edit</Text>
              </TouchableOpacity>
            </View>
          ))}
        </>
      ) : null}

      <View style={styles.panel}>
        <View style={styles.sectionHeaderRow}>
          <View>
            <Text style={styles.label}>
              Notes (optional)
            </Text>
            {update.pieSuggestedNoteAccepted ? (
              <Text style={styles.locationDetailText}>
                Suggested — edit or clear
              </Text>
            ) : null}
          </View>
          {update.pieSuggestedNoteAccepted ? (
            <TouchableOpacity
              style={styles.phase3ChangeButton}
              onPress={() => onNotesChange('')}
            >
              <Text style={styles.dashboardManageText}>Clear</Text>
            </TouchableOpacity>
          ) : null}
        </View>

        <TextInput
          style={[
            styles.input,
            styles.notesInput,
          ]}
          value={update.notes}
          onChangeText={onNotesChange}
          placeholder="Add any additional context for this update"
          placeholderTextColor={colors.muted}
          multiline
        />
      </View>

      <PrimaryButton
        label={isSaving ? 'Saving…' : 'Save Field Update'}
        icon="checkmark-circle-outline"
        onPress={onSaveUpdate}
        disabled={isSaving}
      />

      <View style={styles.sendRow}>
        <SecondaryButton
          label="Edit Photos"
          icon="images-outline"
          onPress={onEditPhotos}
          compact
        />
        <SecondaryButton
          label="Add Document"
          icon="document-attach-outline"
          onPress={onAddDocument}
          compact
        />
      </View>

      {onDeleteUpdate ? (
        <SecondaryButton
          label="Delete Saved Update"
          icon="trash-outline"
          onPress={onDeleteUpdate}
        />
      ) : null}

    </View>
  );
}

function ReadOnlyUpdateDetailScreen({
  update,
  backLabel,
  onBack,
  onRetry,
  onRetryPhotoAnalysis,
  onDelete,
  onArchive,
  embedded = false,
  onResume,
}: {
  update: ProjectUpdate;
  backLabel: string;
  onBack: () => void;
  onRetry?: () => void;
  onRetryPhotoAnalysis?: (update: ProjectUpdate, photo: UpdatePhoto) => void;
  onDelete: () => void;
  onArchive: () => void;
  embedded?: boolean;
  onResume?: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const lifecycle = lifecycleStatusForUpdate(update);
  const pieStatus = updatePIEAnalysisStatus(update);
  const documents = update.documents || [];
  const timing = flowTimingForUpdate(update);
  const pieSummary = summarizePIEStatusForUpdate(update);
  const pieResults = pieResultsForUpdate(update);
  const firstResult = pieResults[0];
  const observedFindings = observedFindingsForUpdateBrief(update);
  const possibleInterpretations = uniqueStrings([
    ...(updateSupportsPIEInterpretations(update, pieSummary)
      ? update.possibleInterpretations || []
      : []),
    ...pieResults.flatMap(result => possibleInterpretationsForPIEResult(result)),
  ]);
  const baselineOnly = pieSummary.status === 'no_prior_photo';
  const failedPhoto = update.photos.find(
    photo =>
      photo.photoIntelligence?.status === 'analysis_failed_retry' ||
      photo.photoIntelligence?.status === 'comparison_unavailable',
  );

  return (
    <View>
      {!embedded ? <TouchableOpacity style={styles.phase2BackButton} onPress={onBack}>
        <Ionicons name="chevron-back" size={21} color={colors.primary} />
        <Text style={styles.dashboardManageText}>{backLabel}</Text>
      </TouchableOpacity> : null}
      <ScreenTitle
        title={update.projectName}
        subtitle="Update Detail"
        actionIcon="ellipsis-horizontal"
        onActionPress={() => setMenuOpen(true)}
        actionAccessibilityLabel="Update options"
      />
      <UpdateOverflowMenu
        visible={menuOpen}
        lifecycle={lifecycle}
        onClose={() => setMenuOpen(false)}
        onDelete={onDelete}
        onArchive={onArchive}
      />
      <View style={styles.panel}>
        <Text style={styles.projectName}>{lifecycle}</Text>
        <Text style={styles.rowSub}>
          {formatDisplayDate(update.date)}
          {update.selectedAreaName ? ` · ${update.selectedAreaName}` : ''}
        </Text>
        {pieStatus ? (
          <Text style={styles.bodyText}>{pieStatus}</Text>
        ) : update.photos.length === 0 ? (
          <Text style={styles.bodyText}>No photos attached</Text>
        ) : null}
        {onRetry ? (
          <TouchableOpacity style={styles.photoControlButton} onPress={onRetry}>
            <Ionicons name="refresh-outline" size={17} color={colors.primary} />
            <Text style={styles.photoControlText}>Retry Sync</Text>
          </TouchableOpacity>
        ) : null}
        {onResume ? <PrimaryButton label="Resume Update" icon="create-outline" onPress={onResume} /> : null}
      </View>
      <UpdateDeleteControl onDelete={onDelete} />
      <View style={styles.panel}>
        <Text style={styles.panelTitle}>Photo Analysis</Text>
        <Text style={styles.projectName}>
          {pieSummary.summary}
        </Text>
        {firstResult?.comparisonConfidence ? (
          <Text style={styles.locationDetailText}>
            {pieConfidenceSentence(firstResult.comparisonConfidence)}
          </Text>
        ) : null}
        {firstResult?.comparability ? (
          <Text style={styles.locationDetailText}>
            {pieComparabilitySentence(firstResult.comparability)}
          </Text>
        ) : null}
        {baselineOnly ? (
          <>
            <Text style={styles.sectionLabelNoMargin}>Information</Text>
            <Text style={styles.locationDetailText}>
              Baseline saved for future comparison.
            </Text>
          </>
        ) : null}
        {observedFindings.length > 0 ? (
          <>
            <Text style={styles.sectionLabelNoMargin}>Observed findings</Text>
            {observedFindings.slice(0, 4).map(finding => (
              <PIEFindingRow
                key={finding}
                role="possibleFinding"
                title={`Observed: ${finding}`}
              />
            ))}
          </>
        ) : null}
        {possibleInterpretations.length > 0 ? (
          <>
            <Text style={styles.sectionLabelNoMargin}>Possible interpretations</Text>
            {possibleInterpretations.map(interpretation => (
              <PIEFindingRow
                key={interpretation}
                role="interpretation"
                title={interpretation}
                detail={pieInterpretationCaveat(
                  firstResult?.comparisonConfidence ?? '',
                  firstResult?.comparability ?? '',
                )}
              />
            ))}
          </>
        ) : null}
        {failedPhoto && onRetryPhotoAnalysis ? (
          <TouchableOpacity
            style={styles.photoControlButton}
            onPress={() => onRetryPhotoAnalysis(update, failedPhoto)}
          >
            <Ionicons name="refresh-outline" size={17} color={colors.primary} />
            <Text style={styles.photoControlText}>Retry Analysis</Text>
          </TouchableOpacity>
        ) : null}
      </View>
      <View style={styles.panel}>
        <Text style={styles.panelTitle}>60-Second Flow</Text>
        <Text style={styles.bodyText}>
          {timing.elapsedSeconds === null
            ? 'Timing markers will appear after this update is cloud synced or queued.'
            : `${timing.elapsedSeconds}s from New Field Update to cloud synced or queued. Target: ${timing.targetSeconds}s.`}
        </Text>
        {timing.canSendWhileAnalysisPending ? (
          <Text style={styles.locationDetailText}>
            Save was available while photos were still being checked.
          </Text>
        ) : null}
      </View>
      {update.photos.length > 0 ? (
        <>
          <Text style={styles.sectionLabel}>Photos ({update.photos.length})</Text>
          <View style={styles.phase3ThumbRow}>
            {update.photos.map(photo => (
              <ProjectPhotoImage key={photo.id} photo={photo} localUri={resolveProjectPhotoUri(photo)} style={styles.phase3Thumb} />
            ))}
          </View>
        </>
      ) : null}
      {documents.length > 0 ? (
        <>
          <Text style={styles.sectionLabel}>Documents ({documents.length})</Text>
          {documents.map(document => (
            <ProjectDocumentInlineRow key={document.id} document={document} />
          ))}
        </>
      ) : null}
      {update.notes.trim() ? (
        <View style={styles.panel}>
          <Text style={styles.panelTitle}>Notes</Text>
          <Text style={styles.bodyText}>{update.notes}</Text>
        </View>
      ) : null}
    </View>
  );
}

type ProjectTaskFilter = 'All' | 'At Risk' | 'Due Soon' | 'Complete';

function ProjectTaskControlPanel({
  projectName,
  scheduleItems,
  savedUpdates,
  onUpdate,
  onSave,
  onDelete,
  onNewFieldUpdate,
  onAddTask,
}: {
  projectName: string;
  scheduleItems: ScheduleItem[];
  savedUpdates: ProjectUpdate[];
  onUpdate: (
    itemId: string,
    next: Partial<ScheduleItem>,
    workflowRequest?: ProjectItemWorkflowMutationRequest,
  ) => void;
  onSave: (itemId: string) => Promise<boolean>;
  onDelete: (itemId: string) => void;
  onNewFieldUpdate: (item: ScheduleItem) => void;
  onAddTask: () => void;
}) {
  const [filter, setFilter] = useState<ProjectTaskFilter>('All');
  const [expanded, setExpanded] = useState(false);
  const [completedGroupOpen, setCompletedGroupOpen] = useState(false);
  const operationalScheduleItems = useMemo(
    () => operationalScheduleItemsForProject(projectName, scheduleItems),
    [projectName, scheduleItems],
  );
  const scopedFieldUpdates = useMemo(
    () => projectUpdatesForParentProject(
      savedUpdates,
      projectName,
      scheduleItems,
    ),
    [projectName, savedUpdates, scheduleItems],
  );
  const rollup = useMemo(
    () => buildDAVEProjectScheduleRollup({
      projectName,
      items: scheduleItems as unknown as import('./types').ScheduleItem[],
    }),
    [projectName, scheduleItems],
  );
  const reconciliation = useMemo(
    () => buildPIEScheduleReconciliation({
      scheduleItems: operationalScheduleItems as unknown as NonNullable<Parameters<typeof buildPIEScheduleReconciliation>[0]>['scheduleItems'],
      updates: scopedFieldUpdates as unknown as NonNullable<Parameters<typeof buildPIEScheduleReconciliation>[0]>['updates'],
    }),
    [operationalScheduleItems, scopedFieldUpdates],
  );
  const attentionItems = useMemo(
    () => buildPhase2AttentionItems(scopedFieldUpdates, null),
    [scopedFieldUpdates],
  );
  const confirmedBlockingUpdate = findCurrentDAVEConfirmedBlocker(scopedFieldUpdates);
  const operationalStatus = deriveDAVEProjectOperationalStatus({
    scheduleHealth: rollup.health,
    scheduleReason: rollup.healthReason,
    reconciliationWarnings: reconciliation.warnings,
    hasConfirmedBlocker: Boolean(confirmedBlockingUpdate),
    confirmedBlockerReason: confirmedBlockingUpdate
      ? daveConfirmedBlockerReason(confirmedBlockingUpdate)
      : null,
    hasAttention: attentionItems.length > 0,
    attentionReason: attentionItems[0]?.detail || attentionItems[0]?.title || null,
    hasScheduleData: rollup.taskCount > 0,
    hasFieldData: scopedFieldUpdates.length > 0,
  });
  const fieldMatches = new Map(
    reconciliation.matches.map(match => [match.scheduleItemId, match]),
  );
  const fieldWarnings = new Map<string, PIEScheduleReconciliationWarning[]>();
  reconciliation.warnings.forEach(warning => {
    fieldWarnings.set(warning.scheduleItemId, [
      ...(fieldWarnings.get(warning.scheduleItemId) || []),
      warning,
    ]);
  });
  const filteredTasks = rollup.tasks.filter(item => {
    const days = daysUntilScheduleItem(item);
    const isComplete = scheduleTaskIsComplete(item);
    if (filter === 'Complete') return isComplete;
    if (filter === 'Due Soon') {
      return !isComplete && days !== null && days >= 0 && days <= 7;
    }
    if (filter === 'At Risk') {
      return item.status === 'Waiting' || (
        !isComplete && days !== null && days <= 7
      );
    }
    return true;
  });
  const visibleTasks = expanded
    ? filteredTasks
    : rollup.tasks.filter(item => !scheduleTaskIsComplete(item)).slice(0, 5);
  const incompleteTasks = visibleTasks.filter(item => !scheduleTaskIsComplete(item));
  const completedTasks = visibleTasks.filter(scheduleTaskIsComplete);
  const groupedTasks = incompleteTasks.reduce((groups, item) => {
    const groupName = scheduleTaskGroupName(
      item as unknown as import('./types').ScheduleItem,
    );
    groups.set(groupName, [...(groups.get(groupName) || []), item]);
    return groups;
  }, new Map<string, ScheduleItem[]>());
  if (completedTasks.length > 0) {
    groupedTasks.set('Completed', completedTasks);
  }
  return (
    <View style={styles.projectTaskPanel}>
      <DAVEProjectTaskOperationalSummary
        status={operationalStatus.status}
        scheduleStatus={rollup.health}
        percentComplete={rollup.percentComplete}
        operationalReason={operationalStatus.reason}
        scheduleReason={rollup.healthReason}
        needsVerification={operationalStatus.needsVerification}
        verificationSummary={operationalStatus.primaryWarning?.summary || null}
      />
      <SecondaryButton
        label="Add Task"
        icon="add-circle-outline"
        onPress={onAddTask}
      />
      <View style={styles.projectTaskMetrics}>
        {[
          ['Tasks', rollup.taskCount],
          ['Complete', rollup.completedCount],
          ['Open', rollup.openCount],
        ].map(([label, value]) => (
          <View key={String(label)} style={styles.projectTaskMetric}>
            <Text style={styles.projectTaskMetricValue}>{value}</Text>
            <Text style={styles.projectTaskMetricLabel}>{label}</Text>
          </View>
        ))}
      </View>
      {rollup.openCount > 0 ? (
        <Text style={styles.projectTaskForecast}>
          Open work: {rollup.overdueCount} overdue · {rollup.dueSoonCount} due soon · {rollup.scheduledLaterCount} scheduled later
          {rollup.undatedCount > 0 ? ` · ${rollup.undatedCount} without a date` : ''}
        </Text>
      ) : null}
      {rollup.forecastFinishDate ? (
        <Text style={styles.projectTaskForecast}>
          Current scheduled finish: {formatAppDate(rollup.forecastFinishDate)}
        </Text>
      ) : null}

      {expanded ? (
        <View style={styles.projectTaskFilters}>
          {(['All', 'At Risk', 'Due Soon', 'Complete'] as ProjectTaskFilter[]).map(option => (
            <TouchableOpacity
              key={option}
              style={[
                styles.projectTaskFilterButton,
                filter === option && styles.projectTaskFilterButtonActive,
              ]}
              onPress={() => setFilter(option)}
              accessibilityRole="button"
              accessibilityState={{ selected: filter === option }}
            >
              <Text style={[
                styles.projectTaskFilterText,
                filter === option && styles.projectTaskFilterTextActive,
              ]}>
                {option}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      ) : (
        <Text style={styles.locationDetailText}>
          Showing the most important open tasks first.
        </Text>
      )}

      {Array.from(groupedTasks.entries()).map(([groupName, tasks]) => {
        const groupComplete = tasks.every(scheduleTaskIsComplete);
        const groupOpen = !groupComplete || completedGroupOpen;
        const groupTaskLabel = `${tasks.length} ${tasks.length === 1 ? 'task' : 'tasks'}`;

        return (
          <View key={groupName} style={styles.projectTaskGroup}>
            <TouchableOpacity
              style={[
                styles.projectTaskGroupHeader,
                groupComplete && styles.projectTaskGroupHeaderComplete,
              ]}
              onPress={groupComplete
                ? () => setCompletedGroupOpen(open => !open)
                : undefined}
              disabled={!groupComplete}
              accessibilityRole={groupComplete ? 'button' : 'header'}
              accessibilityLabel={`${groupName}, ${groupTaskLabel}${groupComplete ? ', 100% complete' : ''}`}
              accessibilityState={groupComplete ? { expanded: groupOpen } : undefined}
            >
              <View style={styles.rowMain}>
                <Text style={styles.projectTaskGroupTitle}>{groupName}</Text>
                <Text style={styles.projectTaskGroupDetail}>
                  {groupComplete ? `100% complete · ${groupTaskLabel}` : groupTaskLabel}
                </Text>
              </View>
              {groupComplete ? (
                <Ionicons
                  name={groupOpen ? 'chevron-up' : 'chevron-down'}
                  size={21}
                  color={colors.success}
                />
              ) : null}
            </TouchableOpacity>

            {groupOpen ? tasks.map(item => (
              <ScheduleItemRow
                key={item.id}
                item={item}
                fieldWarnings={fieldWarnings.get(item.id) || []}
                onUpdate={(next, workflowRequest) =>
                  onUpdate(item.id, next, workflowRequest)}
                onSave={() => onSave(item.id)}
                onDelete={() => onDelete(item.id)}
                onAddFieldUpdate={() => onNewFieldUpdate(item)}
              />
            )) : null}
          </View>
        );
      })}

      {visibleTasks.length === 0 ? (
        <Text style={styles.projectTaskEmpty}>No tasks match this filter.</Text>
      ) : null}

      {rollup.taskCount > 5 || expanded ? (
        <SecondaryButton
          label={expanded ? 'Show Fewer Tasks' : `View All Tasks (${rollup.taskCount})`}
          icon={expanded ? 'chevron-up-outline' : 'chevron-down-outline'}
          onPress={() => {
            setExpanded(current => !current);
            setFilter('All');
          }}
        />
      ) : null}
    </View>
  );
}

function ProjectWorkspaceScreen({
  contentStyle,
  projectId,
  projectName,
  savedUpdates,
  captureMemories,
  projectWalkSession,
  usedCaptureMemoryIds,
  projectAreas,
  projectDocuments,
  scheduleItems,
  contactBook,
  coverPhoto,
  coverPhotoMode,
  coverImage,
  onTakeNewCoverPhoto,
  onChooseCoverFromLibrary,
  onUseBestProjectPhoto,
  onRemoveCoverPhoto,
  onBack,
  onNewFieldUpdate,
  onNewFieldUpdateForTask,
  onAddTask,
  onUpdateScheduleItem,
  onSaveScheduleItem,
  onDeleteScheduleItem,
  onStartProjectWalk,
  onFinishProjectWalk,
  onCancelProjectWalk,
  onPrepareWalkUpdate,
  onSaveCaptureMemory,
  onDeleteCaptureMemory,
  onAddArea,
  onUpdateArea,
  onDeleteArea,
  onUseCurrentLocationForArea,
  onOpenUpdates,
  onOpenUpdate,
  onOpenDocuments,
  onRetryQueuedUpdate,
  onDeleteProject,
  onCloseProject,
  isDeletingProject,
}: {
  contentStyle: StyleProp<ViewStyle>;
  projectId: string | null;
  projectName: string;
  savedUpdates: ProjectUpdate[];
  captureMemories: readonly DAVEConfirmedCaptureMemory[];
  projectWalkSession: DAVEProjectWalkSession | null;
  usedCaptureMemoryIds: readonly string[];
  projectAreas: ProjectArea[];
  projectDocuments: ProjectDocument[];
  scheduleItems: ScheduleItem[];
  contactBook: ContactBook;
  coverPhoto: ProjectCoverPhoto | null;
  coverPhotoMode: 'automatic' | 'manual';
  coverImage: ProjectCoverImage | null; // may be cloud-only (A4 pass 7 M2)
  onTakeNewCoverPhoto: () => void;
  onChooseCoverFromLibrary: () => void;
  onUseBestProjectPhoto: () => void;
  onRemoveCoverPhoto: () => void;
  onBack: () => void;
  onNewFieldUpdate: (projectName?: string) => void;
  onNewFieldUpdateForTask: (item: ScheduleItem) => void;
  onAddTask: () => void;
  onUpdateScheduleItem: (itemId: string, next: Partial<ScheduleItem>) => void;
  onSaveScheduleItem: (itemId: string) => Promise<boolean>;
  onDeleteScheduleItem: (itemId: string) => void;
  onStartProjectWalk: () => Promise<boolean>;
  onFinishProjectWalk: (sessionId: string) => void;
  onCancelProjectWalk: (sessionId: string) => void;
  onPrepareWalkUpdate: (memories: readonly DAVEConfirmedCaptureMemory[]) => void;
  onSaveCaptureMemory: (
    memory: DAVEConfirmedCaptureMemory,
    walkSessionId?: string,
  ) => Promise<void>;
  onDeleteCaptureMemory: (memoryId: string) => Promise<void>;
  onAddArea: (name: string) => boolean;
  onUpdateArea: (areaId: string, next: Partial<ProjectArea>) => void;
  onDeleteArea: (areaId: string) => void;
  onUseCurrentLocationForArea: (areaId: string) => void;
  onOpenUpdates: () => void;
  onOpenUpdate: (update: ProjectUpdate) => void;
  onOpenDocuments: () => void;
  onRetryQueuedUpdate: (update: ProjectUpdate) => void;
  onDeleteProject: (projectName: string) => void;
  onCloseProject: (projectName: string) => void;
  isDeletingProject: boolean;
}) {
  const liveAuthority = usePIELiveAuthority();
  const projectScopeNames = useMemo(
    () => scheduleProjectScopeNames(
      projectName,
      scheduleItems as unknown as import('./types').ScheduleItem[],
    ),
    [projectName, scheduleItems],
  );
  const projectUpdates = useMemo(
    () => projectUpdatesForParentProject(
      savedUpdates,
      projectName,
      scheduleItems,
    ),
    [projectName, savedUpdates, scheduleItems],
  );
  const workspaceProjectStats = useMemo(
    () => projectStatsForUpdates(projectUpdates),
    [projectUpdates],
  );
  const scopedProjectDocuments = useMemo(
    () => projectDocumentsForScopes(projectScopeNames, projectDocuments),
    [projectScopeNames, projectDocuments],
  );
  const scopedScheduleItems = useMemo(
    () => scheduleTasksForParentProject(
      projectName,
      scheduleItems as unknown as import('./types').ScheduleItem[],
    ) as unknown as ScheduleItem[],
    [projectName, scheduleItems],
  );
  const intelligenceUpdates = useMemo(
    () => projectUpdates.map(update => ({ ...update, projectName })),
    [projectName, projectUpdates],
  );
  const intelligenceDocuments = useMemo(
    () => scopedProjectDocuments.map(document => ({
      ...document,
      projectId: authorityProjectId(projectName),
    })),
    [projectName, scopedProjectDocuments],
  );
  const intelligenceScheduleItems = useMemo(
    () => scopedScheduleItems.map(item => ({ ...item, projectName })),
    [projectName, scopedScheduleItems],
  );
  const unusedWalkMemories = unusedConfirmedProjectWalkMemories({
    projectName,
    memories: captureMemories,
    usedMemoryIds: usedCaptureMemoryIds,
  });
  const projectWalkMemoryIds = new Set(projectWalkSession?.memoryIds || []);
  const legacyUnusedWalkMemories = unusedWalkMemories.filter(
    memory => !projectWalkMemoryIds.has(memory.id),
  );
  const projectCaptureMemories = useMemo(
    () => captureMemories
      .filter(memory => {
        const memoryProject = memory.recommendedProject.value?.trim().toLowerCase();
        return Boolean(memoryProject && projectScopeNames.some(
          scope => scope.trim().toLowerCase() === memoryProject,
        ));
      })
      .sort((left, right) => right.confirmedAt.localeCompare(left.confirmedAt)),
    [captureMemories, projectScopeNames],
  );
  const projectDocumentCount = scopedProjectDocuments.length;
  const projectActivity = buildPhase2ActivityItems(
    projectUpdates,
    null,
    projectDocuments,
  );
  const notesCount = projectUpdates.filter(update => update.notes.trim()).length;
  const issuesCount = workspaceProjectStats.openActions + workspaceProjectStats.overdueActions;
  const projectIntelligence = liveAuthority.projectTruth.intelligence;
  const [voiceCaptureOpen, setVoiceCaptureOpen] = useState(false);
  const [typedCaptureOpen, setTypedCaptureOpen] = useState(false);
  const [projectOptionsOpen, setProjectOptionsOpen] = useState(false);
  const [captureDraft, setCaptureDraft] = useState<DAVECaptureMemory | null>(null);
  const [selectedCaptureMemory, setSelectedCaptureMemory] = useState<DAVEConfirmedCaptureMemory | null>(null);
  const [areaMappingOpen, setAreaMappingOpen] = useState(false);
  const areaSetupStats = useMemo(
    () => projectAreaSetupStats(projectAreas),
    [projectAreas],
  );
  const [projectWalkContext, setProjectWalkContext] = useState<DAVEProjectWalkContext>(() =>
    buildDAVEProjectWalkContext({
      projectName,
      projectAreas,
      location: { status: 'checking' },
      updates: intelligenceUpdates,
      scheduleItems: intelligenceScheduleItems,
      intelligence: projectIntelligence,
    }),
  );
  const projectWalkLocationRequest = useRef(0);
  const projectWalkStartInFlight = useRef(false);

  function contextForProjectWalk(location: DAVEProjectWalkLocationInput) {
    return buildDAVEProjectWalkContext({
      projectName,
      projectAreas,
      location,
      updates: intelligenceUpdates,
      scheduleItems: intelligenceScheduleItems,
      intelligence: projectIntelligence,
    });
  }

  async function beginProjectWalkCapture() {
    const request = ++projectWalkLocationRequest.current;
    setProjectWalkContext(contextForProjectWalk({ status: 'checking' }));
    setVoiceCaptureOpen(true);

    if (!projectAreas.some(area => hasSavedAreaLocation(area))) return;
    try {
      const snapshot = await getCurrentLocationSnapshot();
      if (request !== projectWalkLocationRequest.current) return;
      // An approximate fix (Precise Location off) is used nowhere (GPS
      // review pass 26): it must not name the walk's area or seed the
      // capture memory.
      setProjectWalkContext(contextForProjectWalk(
        !snapshot
          ? { status: 'unavailable' }
          : snapshot.preciseLocationOff
            ? { status: 'unavailable', reason: 'precise-location-off' }
            : {
                status: 'resolved',
                latitude: snapshot.latitude,
                longitude: snapshot.longitude,
                accuracyMeters: snapshot.accuracy,
              },
      ));
    } catch {
      if (request !== projectWalkLocationRequest.current) return;
      setProjectWalkContext(contextForProjectWalk({ status: 'unavailable' }));
    }
  }

  async function startProjectWalkCapture() {
    if (projectWalkStartInFlight.current) return;
    projectWalkStartInFlight.current = true;
    try {
      if (await onStartProjectWalk()) {
        await beginProjectWalkCapture();
      }
    } catch (error) {
      Alert.alert(
        'Unable to start walk',
        error instanceof Error ? error.message : 'The Project Walk could not be started.',
      );
    } finally {
      projectWalkStartInFlight.current = false;
    }
  }

  function closeProjectWalkCapture() {
    projectWalkLocationRequest.current += 1;
    setVoiceCaptureOpen(false);
  }

  return (
    <ScrollView
      style={styles.appFrame}
      contentContainerStyle={contentStyle}
      keyboardShouldPersistTaps="handled"
    >
      <TouchableOpacity
        style={styles.phase2BackButton}
        onPress={onBack}
        accessibilityRole="button"
        accessibilityLabel="Back to Overview"
      >
        <Ionicons name="chevron-back" size={21} color={colors.primary} />
        <Text style={styles.dashboardManageText}>Overview</Text>
      </TouchableOpacity>

      <ScreenTitle
        title={projectName}
        subtitle="Project control and task updates"
        actionIcon="ellipsis-horizontal"
        onActionPress={() => setProjectOptionsOpen(true)}
        actionAccessibilityLabel="Open project options"
      />

      <View style={styles.projectWorkspaceHero}>
        {coverImage ? (
          <ProjectPhotoImage
            {...coverImage}
            style={styles.projectWorkspaceHeroImage}
            accessibilityLabel={`${projectName} project cover photo`}
          />
        ) : (
          <View style={styles.projectWorkspaceHeroPlaceholder}>
            <Ionicons name="image-outline" size={30} color={colors.muted} />
            <Text style={styles.locationDetailText}>Project cover photo</Text>
          </View>
        )}
      </View>

      <PrimaryButton
        label="New Field Update"
        icon="camera-outline"
        onPress={() => onNewFieldUpdate(projectName)}
      />

      <SecondaryButton
        label={areaMappingOpen
          ? 'Hide Locations & GPS'
          : `Locations & GPS (${areaSetupStats.saved}/${areaSetupStats.total} saved)`}
        icon={areaMappingOpen ? 'chevron-up-outline' : 'map-outline'}
        onPress={() => setAreaMappingOpen(open => !open)}
      />

      {areaMappingOpen ? (
        <ManageAreasPanel
          projectAreas={projectAreas}
          onAddArea={onAddArea}
          onUpdateArea={onUpdateArea}
          onDeleteArea={onDeleteArea}
          onUseCurrentLocationForArea={onUseCurrentLocationForArea}
        />
      ) : null}

      <ProjectTaskControlPanel
        projectName={projectName}
        scheduleItems={scheduleItems}
        savedUpdates={savedUpdates}
        onUpdate={onUpdateScheduleItem}
        onSave={onSaveScheduleItem}
        onDelete={onDeleteScheduleItem}
        onNewFieldUpdate={onNewFieldUpdateForTask}
        onAddTask={onAddTask}
      />

      {projectWalkSession ? (
        <View style={styles.phase2BriefCard}>
          <View style={styles.phase2BriefIcon}>
            <Ionicons name="footsteps-outline" size={21} color={colors.primary} />
          </View>
          <View style={styles.rowMain}>
            <Text style={styles.panelTitle}>Project Walk in progress</Text>
            <Text style={styles.bodyText}>
              {projectWalkSession.memoryIds.length}{' '}
              {projectWalkSession.memoryIds.length === 1 ? 'observation' : 'observations'} saved
            </Text>
            <Text style={styles.locationDetailText}>
              Started {formatSavedTime(projectWalkSession.startedAt)}. Your walk will resume here after restarting the app.
            </Text>
            <SecondaryButton
              label="Add Observation"
              icon="add-circle-outline"
              onPress={() => { void beginProjectWalkCapture(); }}
            />
            {projectWalkSession.memoryIds.length > 0 ? (
              <SecondaryButton
                label="Finish Walk"
                icon="checkmark-circle-outline"
                onPress={() => onFinishProjectWalk(projectWalkSession.id)}
              />
            ) : null}
            <TouchableOpacity
              style={styles.photoControlButton}
              onPress={() => onCancelProjectWalk(projectWalkSession.id)}
              accessibilityRole="button"
              accessibilityLabel="End Project Walk"
            >
              <Ionicons name="close-circle-outline" size={17} color={colors.danger} />
              <Text style={[styles.photoControlText, { color: colors.danger }]}>End Walk</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <SecondaryButton
          label="Start Project Walk"
          icon="footsteps-outline"
          onPress={() => { void startProjectWalkCapture(); }}
        />
      )}

      {legacyUnusedWalkMemories.length > 0 ? (
        <SecondaryButton
          label={`Prepare Walk Update (${legacyUnusedWalkMemories.length})`}
          icon="document-text-outline"
          onPress={() => onPrepareWalkUpdate(legacyUnusedWalkMemories)}
        />
      ) : null}

      <DAVEVoiceCaptureSheet
        visible={voiceCaptureOpen}
        projectId={projectId}
        projectName={projectName}
        walkContext={projectWalkContext}
        candidateLocations={projectAreas.map(area => area.name)}
        onMemoryReady={result => {
          projectWalkLocationRequest.current += 1;
          const createdAt = new Date().toISOString();
          const memoryId = `voice-memory-${uid()}`;
          const proposedFields = result.understanding.status === 'succeeded'
            ? result.understanding.fields
            : { ...result.understanding.fields, generalMemory: result.transcript };
          const transcriptArea = result.understanding.recommendedLocation;
          const gpsArea = projectWalkContext.recommendedArea;
          const areasConflict = Boolean(
            transcriptArea.value && gpsArea &&
            transcriptArea.value.toLowerCase() !== gpsArea.name.toLowerCase(),
          );
          const proposedLocationValue = areasConflict
            ? null
            : transcriptArea.value || gpsArea?.name || null;
          const locationEvidenceId = gpsArea ? `location:${memoryId}:${gpsArea.id}` : null;
          const locationEvidenceIds = [
            ...(transcriptArea.value && transcriptArea.value === proposedLocationValue
              ? [`transcript:${memoryId}`]
              : []),
            ...(gpsArea && gpsArea.name === proposedLocationValue && locationEvidenceId
              ? [locationEvidenceId]
              : []),
          ];
          setCaptureDraft(createCaptureMemory({
            id: memoryId,
            transcript: result.transcript,
            transcriptSourceRecordId: `voice-transcription:${memoryId}`,
            createdAt,
            recommendedProject: {
              value: projectName,
              confidence: 'high',
              confirmed: true,
            },
            recommendedLocation: {
              value: proposedLocationValue,
              confidence: proposedLocationValue
                ? transcriptArea.value
                  ? transcriptArea.confidence
                  : gpsArea?.confidence || 'unknown'
                : 'unknown',
              evidenceIds: locationEvidenceIds,
              confirmed: false,
            },
            fields: proposedFields,
            evidence: gpsArea && locationEvidenceId ? [{
              id: locationEvidenceId,
              kind: 'location_record',
              sourceRecordId: gpsArea.id,
              summary: 'Current device location matched this saved project area during capture.',
            }] : [],
          }));
          closeProjectWalkCapture();
        }}
        onTypeInstead={() => {
          closeProjectWalkCapture();
          setTypedCaptureOpen(true);
        }}
        onCancel={closeProjectWalkCapture}
      />

      <DAVETypedCaptureSheet
        visible={typedCaptureOpen}
        projectName={projectName}
        onContinue={text => {
          const createdAt = new Date().toISOString();
          const memoryId = `typed-memory-${uid()}`;
          setCaptureDraft(createCaptureMemory({
            id: memoryId,
            transcript: text,
            transcriptSourceRecordId: `typed-entry:${memoryId}`,
            createdAt,
            recommendedProject: {
              value: projectName,
              confidence: 'high',
              confirmed: true,
            },
            fields: { generalMemory: text },
          }));
          setTypedCaptureOpen(false);
        }}
        onCancel={() => setTypedCaptureOpen(false)}
      />

      {captureDraft ? (
        <DAVECaptureConfirmationSheet
          visible
          transcript={captureDraft.transcript}
          draft={captureDraft}
          projects={[projectName]}
          locations={projectAreas.map(area => area.name)}
          sourceLabel={captureDraft.evidence.some(
            evidence => evidence.sourceRecordId.startsWith('voice-transcription:'),
          ) ? 'Source transcript' : 'Source note'}
          onSave={async memory => {
            if (projectWalkSession) {
              await onSaveCaptureMemory(memory, projectWalkSession.id);
            } else {
              await onSaveCaptureMemory(memory);
            }
            setCaptureDraft(null);
            if (projectWalkSession) {
              Alert.alert(
                'Observation saved',
                'Add another observation, finish the walk, or return to it later.',
                [
                  { text: 'Later', style: 'cancel' },
                  {
                    text: 'Finish Walk',
                    onPress: () => onFinishProjectWalk(projectWalkSession.id),
                  },
                  {
                    text: 'Add Another',
                    onPress: () => { void beginProjectWalkCapture(); },
                  },
                ],
              );
            }
          }}
          onCancel={() => setCaptureDraft(null)}
        />
      ) : null}

      <DAVECaptureMemoryDetailSheet
        memory={selectedCaptureMemory}
        onClose={() => setSelectedCaptureMemory(null)}
        onDelete={async memoryId => {
          await onDeleteCaptureMemory(memoryId);
          setSelectedCaptureMemory(null);
        }}
      />

      {projectCaptureMemories.length > 0 ? (
        <>
          <Text style={styles.sectionLabel}>Project Memory</Text>
          {projectCaptureMemories.slice(0, 3).map(memory => (
            <TouchableOpacity
              key={memory.id}
              style={styles.savedRow}
              onPress={() => setSelectedCaptureMemory(memory)}
              accessibilityRole="button"
              accessibilityLabel={`Open saved memory from ${formatSavedTime(memory.confirmedAt)}`}
            >
              <View style={styles.rowIconBubble}>
                <Ionicons name="bookmark-outline" size={20} color={colors.primary} />
              </View>
              <View style={styles.rowMain}>
                <Text style={styles.projectName}>Saved Memory</Text>
                <Text style={styles.rowSub}>{formatSavedTime(memory.confirmedAt)}</Text>
                <Text style={styles.locationDetailText} numberOfLines={2}>
                  {memory.fields.commitment ||
                    memory.fields.issue ||
                    memory.fields.decision ||
                    memory.fields.generalMemory ||
                    memory.transcript}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.muted} />
            </TouchableOpacity>
          ))}
        </>
      ) : null}

      <Text style={styles.sectionLabel}>Recent Project Activity</Text>
      {projectActivity.length === 0 ? (
        <EmptyState
          title="Recent project activity will show up here."
          text="Photos, notes, documents, and status changes will appear here."
        />
      ) : (
        projectActivity.slice(0, 3).map(item => (
          <Phase2ActivityRow
            key={item.update.id}
            item={item}
            onPress={() => onOpenUpdate(item.update)}
            onRetry={
              item.update.status === 'queued' || item.update.status === 'failed'
                ? () => onRetryQueuedUpdate(item.update)
                : undefined
            }
          />
        ))
      )}

      {projectActivity.length > 3 ? (
        <SecondaryButton
          label="View All Activity"
          icon="time-outline"
          onPress={onOpenUpdates}
        />
      ) : null}

      <ProjectActionSheet
        visible={projectOptionsOpen}
        title="Project Options"
        onClose={() => setProjectOptionsOpen(false)}
      >
        <MoreOptionRow
          label="Field Activity"
          icon="document-text-outline"
          onPress={() => {
            setProjectOptionsOpen(false);
            onOpenUpdates();
          }}
        />
        <MoreOptionRow
          label="Documents"
          icon="documents-outline"
          onPress={() => {
            setProjectOptionsOpen(false);
            onOpenDocuments();
          }}
        />
        <Text style={styles.sectionLabel}>Cover Photo</Text>
        <MoreOptionRow
          label="Take New Photo"
          icon="camera-outline"
          onPress={() => {
            setProjectOptionsOpen(false);
            onTakeNewCoverPhoto();
          }}
        />
        <MoreOptionRow
          label="Choose From Library"
          icon="images-outline"
          onPress={() => {
            setProjectOptionsOpen(false);
            onChooseCoverFromLibrary();
          }}
        />
        <MoreOptionRow
          label="Use Best Project Photo"
          icon="sparkles-outline"
          onPress={() => {
            setProjectOptionsOpen(false);
            onUseBestProjectPhoto();
          }}
        />
        {coverPhoto ? (
          <MoreOptionRow
            label="Remove Cover Photo"
            icon="trash-outline"
            onPress={() => {
              setProjectOptionsOpen(false);
              onRemoveCoverPhoto();
            }}
          />
        ) : null}
        <Text style={styles.sectionLabel}>Project Management</Text>
        <MoreOptionRow
          label="Close Project"
          icon="archive-outline"
          onPress={() => {
            setProjectOptionsOpen(false);
            onCloseProject(projectName);
          }}
        />
        <Text style={styles.locationDetailText}>
          Closing hides this project from active views. You can reopen it from Archived Projects on Overview.
        </Text>
        <HoldToDeleteButton
          label="Hold to Delete Project"
          holdingLabel="Keep holding…"
          deletingLabel="Deleting…"
          isDeleting={isDeletingProject}
          onConfirm={() => onDeleteProject(projectName)}
        />
        <Text style={styles.locationDetailText}>
          Hold for 3 seconds to delete {projectName}. Its updates, tasks, areas and documents are removed on every device. The name {projectName} can't be used for a new project afterwards.
        </Text>
      </ProjectActionSheet>
    </ScrollView>
  );
}

function ProjectDocumentsScreen({
  contentStyle,
  projectName,
  documents,
  referenceDocuments,
  projectNames,
  projectIdentities,
  onOpenReference,
  projectAreas,
  updates,
  onBack,
  onUpload,
  onTakePhoto,
  onOpen,
  onUpdate,
  onSetCurrentSchedule,
  onMakeCurrentDocument,
  onRetry,
  onReplaceFile,
  onDelete,
}: {
  contentStyle: StyleProp<ViewStyle>;
  projectName: string;
  documents: ProjectDocument[];
  referenceDocuments: ReferenceDocument[];
  projectNames: string[];
  projectIdentities: readonly { id?: string | null; name: string }[];
  onOpenReference: (document: ReferenceDocument) => void;
  projectAreas: ProjectArea[];
  updates: ProjectUpdate[];
  onBack: () => void;
  onUpload: () => void;
  onTakePhoto: () => void;
  onOpen: (document: ProjectDocument) => void;
  onUpdate: (documentId: string, next: Partial<ProjectDocument>) => void;
  onSetCurrentSchedule: (documentId: string) => void;
  onMakeCurrentDocument: (documentId: string) => void;
  onRetry: (documentId: string) => void;
  onReplaceFile: (documentId: string) => void;
  onDelete: (documentId: string) => void;
}) {
  const { sizeClass } = useAppShellLayout();
  const [categoryFilter, setCategoryFilter] =
    useState<ProjectDocumentCategory | null>(null);
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(null);
  const workspaceDocuments = buildMobileDocumentWorkspace({ documents, referenceDocuments, projectNames, projectIdentities });
  const visibleDocuments = filterDAVEDocumentWorkspace({
    documents: workspaceDocuments,
    category: categoryFilter,
  });
  const selectedDocument = resolveDAVEDocumentWorkspaceDocument(
    visibleDocuments,
    selectedDocumentId,
  );

  useEffect(() => {
    const resolvedId = selectedDocument?.id || null;
    if (resolvedId !== selectedDocumentId) setSelectedDocumentId(resolvedId);
  }, [selectedDocument?.id, selectedDocumentId]);

  const renderDocument = ({ item: entry }: { item: MobileDocumentWorkspaceEntry<ProjectDocument> }) => {
    if (entry.kind === 'reference') {
      return <SharedReferenceDocumentCard document={entry.reference} onOpen={onOpenReference} />;
    }
    const item = entry.attachment;
    return (
      <ProjectDocumentCard
        document={item}
        sharedReferenceDocument={findSharedReferenceDocumentForProjectDocument(item, referenceDocuments)}
        scheduleCurrent={phoneScheduleCardIsCurrent(item, projectNames.find(name => projectDocumentMatchesProject(item, name)) || projectName, referenceDocuments)}
        projectAreas={projectAreas}
        updates={updates}
        onOpen={() => onOpen(item)}
        onUpdate={next => onUpdate(item.id, next)}
        onSetCurrentSchedule={() => onSetCurrentSchedule(item.id)}
        onMakeCurrentDocument={onMakeCurrentDocument}
        onRetry={() => onRetry(item.id)}
        onReplaceFile={() => onReplaceFile(item.id)}
        onDelete={() => onDelete(item.id)}
      />
    );
  };

  const listHeader = (
    <ProjectDocumentsHeader
      projectName={projectName}
      categories={PROJECT_DOCUMENT_CATEGORIES}
      selectedCategory={categoryFilter}
      onCategoryChange={setCategoryFilter}
      onBack={onBack}
      onUpload={onUpload}
      onTakePhoto={onTakePhoto}
      showActions={sizeClass !== 'wide'}
    />
  );
  const emptyState = workspaceDocuments.length === 0 ? (
    <EmptyState
      title="No documents yet — upload your first document."
      text="Documents can be linked to the project, an area, or a saved update without blocking photo capture, review, or saving."
    />
  ) : (
    <EmptyState
      title="No documents in this category."
      text="Choose All or change a document category."
    />
  );

  if (sizeClass === 'wide') {
    return (
      <DocumentsWideWorkspace
        documents={visibleDocuments}
        selectedDocumentId={selectedDocument?.id || null}
        onSelectDocument={setSelectedDocumentId}
        masterHeader={listHeader}
        inspectorActions={<ProjectDocumentActions onUpload={onUpload} onTakePhoto={onTakePhoto} wide />}
        emptyState={emptyState}
        inspector={selectedDocument ? renderDocument({ item: selectedDocument }) : emptyState}
      />
    );
  }

  return (
    <FlatList
      style={styles.appFrame}
      contentContainerStyle={contentStyle}
      keyboardShouldPersistTaps="handled"
      initialNumToRender={12} maxToRenderPerBatch={12} windowSize={7} removeClippedSubviews={Platform.OS === 'android'}
      data={visibleDocuments}
      keyExtractor={document => document.id}
      renderItem={renderDocument}
      ListHeaderComponent={listHeader}
      ListEmptyComponent={emptyState}
    />
  );
}

function DiagnosticsScreen({
  projectAreas,
  referenceDocuments,
  onBack,
}: {
  projectAreas: ProjectArea[];
  referenceDocuments: ReferenceDocument[];
  onBack: () => void;
}) {
  const areasWithGps = projectAreas.filter(area => hasSavedAreaLocation(area)).length;

  return (
    <View>
      <ScreenTitle
        title="Admin Diagnostics"
        subtitle="Basic setup status for locations, GPS, documents, and app data."
      />

      <SecondaryButton
        label="Back to Settings"
        icon="arrow-back-outline"
        onPress={onBack}
      />

      <View style={styles.panel}>
        <Text style={styles.panelTitle}>System Check</Text>
        <Text style={styles.bodyText}>
          Project areas configured: {projectAreas.length}
        </Text>
        <Text style={styles.bodyText}>
          GPS locations saved: {areasWithGps} of {projectAreas.length}
        </Text>
        <Text style={styles.bodyText}>
          Reference documents saved: {referenceDocuments.length}
        </Text>
        <Text style={styles.bodyText}>
          Core navigation, storage, GPS setup, and document tracking are available.
        </Text>
      </View>

      <View style={styles.panel}>
        <Text style={styles.panelTitle}>GPS Setup Status</Text>
        {projectAreas.length === 0 ? (
          <Text style={styles.bodyText}>No project areas have been created yet.</Text>
        ) : (
          projectAreas.map(area => (
            <View key={area.id} style={styles.checklistRow}>
              <Ionicons
                name={hasSavedAreaLocation(area) ? 'checkmark-circle' : 'ellipse-outline'}
                size={20}
                color={hasSavedAreaLocation(area) ? colors.success : colors.warning}
              />
              <View style={styles.rowMain}>
                <Text style={styles.projectName}>{area.name}</Text>
                <Text style={styles.rowSub}>
                  {`${areaPointPrecisionLabel(area)} | Radius ${formatFeet(area.radiusFeet)}`}
                </Text>
              </View>
            </View>
          ))
        )}
      </View>
    </View>
  );
}

function ManageAreasPanel({
  projectAreas,
  onAddArea,
  onUpdateArea,
  onDeleteArea,
  onUseCurrentLocationForArea,
}: {
  projectAreas: ProjectArea[];
  onAddArea: (name: string) => boolean;
  onUpdateArea: (areaId: string, next: Partial<ProjectArea>) => void;
  onDeleteArea: (areaId: string) => void;
  onUseCurrentLocationForArea: (areaId: string) => void;
}) {
  const [newAreaName, setNewAreaName] = useState('');
  const [selectedAreaId, setSelectedAreaId] = useState<string | null>(null);
  const stats = projectAreaSetupStats(projectAreas);
  const nextMissingArea = projectAreas.find(area => !hasSavedAreaLocation(area));
  const selectedArea = selectedAreaId
    ? projectAreas.find(area => area.id === selectedAreaId) || null
    : null;

  function submitArea() {
    const added = onAddArea(newAreaName);

    if (added) setNewAreaName('');
  }

  function useNextMissingAreaLocation() {
    if (!nextMissingArea) {
      Alert.alert('GPS setup complete', 'All locations already have saved GPS points.');
      return;
    }

    Alert.alert(
      'Save next missing GPS?',
      `Stand in ${nextMissingArea.name}, then press Save GPS to use your current location for this location.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Save GPS',
          onPress: () => onUseCurrentLocationForArea(nextMissingArea.id),
        },
      ],
    );
  }

  return (
    <View style={styles.panel}>
      <Text style={styles.panelTitle}>Manage Locations</Text>

      <Text style={styles.bodyText}>
        Add work locations and save GPS points. Tap any location below to rename it, update radius, save GPS, or delete it.
      </Text>

      <View style={styles.setupProgressCard}>
        <Text style={styles.projectName}>Location GPS Setup</Text>
        <Text style={styles.rowSub}>
          {stats.saved} of {stats.total} locations have GPS saved ({stats.percent}%).
        </Text>
        {stats.missing > 0 ? (
          <Text style={styles.locationDetailText}>
            {stats.missing} location{stats.missing === 1 ? '' : 's'} still need GPS setup.
          </Text>
        ) : (
          <Text style={styles.locationDetailText}>All locations have saved GPS points.</Text>
        )}
      </View>

      <SecondaryButton
        label={nextMissingArea ? `Save GPS: ${nextMissingArea.name}` : 'All GPS Saved'}
        icon="navigate-outline"
        onPress={useNextMissingAreaLocation}
        compact
      />

      <Text style={styles.sectionLabel}>New Location</Text>
      <View style={styles.addLocationInlineRow}>
        <TextInput
          style={[styles.input, styles.addLocationInlineInput]}
          value={newAreaName}
          onChangeText={setNewAreaName}
          placeholder="Location name"
          placeholderTextColor={colors.muted}
        />

        <TouchableOpacity
          style={[
            styles.addLocationInlineButton,
            !newAreaName.trim() && styles.disabledButton,
          ]}
          onPress={submitArea}
          disabled={!newAreaName.trim()}
        >
          <Ionicons name="add" size={22} color="#FFFFFF" />
        </TouchableOpacity>
      </View>

      <View style={styles.areaListCard}>
        <View style={styles.areaListHeaderRow}>
          <Text style={styles.sectionLabelNoMargin}>Locations</Text>
          <Text style={styles.rowSub}>{projectAreas.length} total</Text>
        </View>

        {projectAreas.map(area => {
          const gpsSaved = hasSavedAreaLocation(area);

          return (
            <TouchableOpacity
              key={area.id}
              style={styles.areaListRow}
              onPress={() => setSelectedAreaId(area.id)}
            >
              <View style={styles.rowIconBubble}>
                <Ionicons
                  name="location-outline"
                  size={20}
                  color={colors.primary}
                />
              </View>

              <View style={styles.rowMain}>
                <Text style={styles.projectName} numberOfLines={1}>
                  {area.name}
                </Text>

                <View style={styles.areaStatusLine}>
                  <View
                    style={[
                      styles.statusDot,
                      gpsSaved ? styles.statusDotSaved : styles.statusDotMissing,
                    ]}
                  />
                  <Text style={styles.rowSub}>
                    {areaPointPrecisionLabel(area)}
                  </Text>
                </View>
              </View>

              <Text style={styles.areaListRadius}>{formatFeet(area.radiusFeet)}</Text>

              <Ionicons
                name="chevron-forward"
                size={19}
                color={colors.tertiaryText}
              />
            </TouchableOpacity>
          );
        })}
      </View>

      <AreaDetailModal
        area={selectedArea}
        visible={Boolean(selectedArea)}
        onClose={() => setSelectedAreaId(null)}
        onUpdate={next => {
          if (selectedArea) onUpdateArea(selectedArea.id, next);
        }}
        onDelete={() => {
          if (!selectedArea) return;
          const areaId = selectedArea.id;
          setSelectedAreaId(null);
          onDeleteArea(areaId);
        }}
        onUseCurrentLocation={() => {
          if (selectedArea) onUseCurrentLocationForArea(selectedArea.id);
        }}
      />
    </View>
  );
}

function AreaDetailModal({
  area,
  visible,
  onClose,
  onUpdate,
  onDelete,
  onUseCurrentLocation,
}: {
  area: ProjectArea | null;
  visible: boolean;
  onClose: () => void;
  onUpdate: (next: Partial<ProjectArea>) => void;
  onDelete: () => void;
  onUseCurrentLocation: () => void;
}) {
  const [radiusText, setRadiusText] = useState(area ? String(area.radiusFeet) : '250');
  // Committed when the field is left or the sheet closes (audit A3).
  const areaName = useCommittedText(area?.name, area?.id, name => onUpdate({ name }));

  // Deliberately keyed on area?.id only, not area?.radiusFeet: this field is
  // actively edited via onUpdate -> a parent state update -> a new `area`
  // prop on every keystroke. Re-syncing whenever radiusFeet changes fights
  // the user's own typing (e.g. a trailing "." gets parsed and echoed back
  // as a whole number, wiping out the decimal they're mid-typing). Only
  // resync when switching to a different area entirely.
  useEffect(() => {
    if (area) setRadiusText(String(area.radiusFeet));
  }, [area?.id]);

  if (!area) return null;

  function closeWithName() {
    areaName.commit();
    onClose();
  }

  function updateRadius(value: string) {
    setRadiusText(value);

    const parsed = Number(value.replace(/[^0-9.]/g, ''));

    if (Number.isFinite(parsed) && parsed > 0) {
      onUpdate({ radiusFeet: parsed });
    }
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={closeWithName}
    >
      <View style={styles.detailModalBackdrop}>
        <View style={[styles.detailModalCardFrame, styles.detailModalCardContent]}>
          <View style={styles.detailModalHeader}>
            <View>
              <Text style={styles.panelTitle}>Location Details</Text>
              <Text style={styles.rowSub}>{area.name}</Text>
            </View>

            <TouchableOpacity
              style={styles.detailCloseButton}
              onPress={closeWithName}
              accessibilityLabel="Close location details"
            >
              <Ionicons name="close" size={22} color={colors.text} />
            </TouchableOpacity>
          </View>

          <Text style={styles.label}>Location name</Text>
          <TextInput
            style={styles.input}
            value={areaName.text}
            onChangeText={areaName.setText}
            onBlur={areaName.commit}
            placeholder="Location name"
            placeholderTextColor={colors.muted}
          />

          <Text style={styles.label}>GPS radius</Text>
          <View style={styles.radiusEditRow}>
            <TextInput
              style={[styles.input, styles.radiusEditInput]}
              value={radiusText}
              onChangeText={updateRadius}
              placeholder="250"
              placeholderTextColor={colors.muted}
              keyboardType="number-pad"
            />
            <Text style={styles.radiusEditUnit}>ft</Text>
          </View>

          <View style={styles.locationSummaryCard}>
            <View style={styles.areaStatusLine}>
              <View
                style={[
                  styles.statusDot,
                  hasSavedAreaLocation(area)
                    ? styles.statusDotSaved
                    : styles.statusDotMissing,
                ]}
              />
              <Text style={styles.projectName}>
                {hasSavedAreaLocation(area) ? 'GPS Saved' : 'GPS Missing'}
              </Text>
            </View>

            {hasSavedAreaLocation(area) ? (
              <>
                <Text style={styles.rowSub}>
                  {area.latitude.toFixed(6)}, {area.longitude.toFixed(6)}
                </Text>
                <Text style={styles.rowSub}>
                  Saved {formatSavedTime(area.locationCapturedAt || null)}
                  {` · ${formatGpsAccuracy(areaPointAccuracyMeters(area)) ?? 'precision not recorded'}`}
                </Text>
              </>
            ) : (
              <Text style={styles.rowSub}>
                Stand in this location and tap Update GPS.
              </Text>
            )}
          </View>

          <View style={styles.locationActionRow}>
            <PrimaryButton
              label="Update GPS"
              icon="navigate-outline"
              onPress={() => {
                areaName.commit();
                onUseCurrentLocation();
              }}
              compact
            />
            <SecondaryButton
              label="Delete"
              icon="trash-outline"
              onPress={() => {
                areaName.commit(); // kept if the delete is cancelled (audit A3 pass 2)
                onDelete();
              }}
              compact
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

function ContactsScreen({
  contactBook,
  selectedRecipients,
  doneLabel,
  onDone,
  onToggleContact,
  onTogglePhoneContact,
  onUpdateContactDeliveryChoice,
}: {
  contactBook: ContactBook;
  selectedRecipients: RecipientSelection;
  doneLabel: string;
  onDone: () => void;
  onToggleContact: (contactId: string) => void;
  onTogglePhoneContact: (contact: ProjectContact) => void;
  onUpdateContactDeliveryChoice: (
    contactId: string,
    next: Partial<ProjectContact>,
  ) => void;
}) {
  const [status, setStatus] = useState<
    'idle' | 'loading' | 'denied' | 'error' | 'unavailable'
  >('idle');

  async function choosePhoneContact() {
    setStatus('loading');

    try {
      if (Platform.OS !== 'ios') {
        const permission = await Contacts.requestPermissionsAsync();

        if (!permission.granted) {
          setStatus('denied');
          return;
        }
      }

      const contact = await Contacts.presentContactPickerAsync();

      if (!contact) {
        setStatus('idle');
        return;
      }

      const projectContact = phoneContactToProjectContact(contact);

      if (!projectContact.email && !projectContact.phone) {
        Alert.alert(
          'No email or phone',
          'Choose a contact with an email address or phone number.',
        );
        setStatus('idle');
        return;
      }

      onTogglePhoneContact(projectContact);
      setStatus('idle');
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes('presentContactPickerAsync')
      ) {
        setStatus('unavailable');
        return;
      }

      setStatus('error');
    }
  }

  const selectedContactIds = useMemo(
    () => new Set(selectedRecipients.contactIds),
    [selectedRecipients.contactIds],
  );

  const selectedContacts = contactBook.contacts.filter(contact =>
    selectedContactIds.has(contact.id),
  );

  return (
    <View>
      <ScreenTitle
        title="Recipients"
        subtitle={`${selectedContacts.length} selected for this update`}
      />

      <Text style={styles.sectionLabel}>
        Selected
      </Text>

      {selectedContacts.length === 0 ? (
        <Text style={styles.mutedNote}>
          Choose people from your phone contacts below.
        </Text>
      ) : (
        selectedContacts.map(contact => (
          <RecipientRow
            key={contact.id}
            contact={contact}
            selected
            onPress={() => onToggleContact(contact.id)}
            onUpdate={next =>
              onUpdateContactDeliveryChoice(contact.id, next)
            }
          />
        ))
      )}

      <Text style={styles.sectionLabel}>
        Phone Contacts
      </Text>

      <SecondaryButton
        label="Choose Contact"
        icon="person-add-outline"
        onPress={() => {
          void choosePhoneContact();
        }}
      />

      {status === 'idle' ? (
        <Text style={styles.mutedNote}>
          Use the phone contact picker to search and choose one recipient at a time.
        </Text>
      ) : null}

      {status === 'loading' ? (
        <Text style={styles.mutedNote}>
          Opening contacts...
        </Text>
      ) : null}

      {status === 'denied' ? (
        <EmptyState
          title="Contacts access needed"
          text="Allow contacts access in Settings, then come back here to choose recipients."
        />
      ) : null}

      {status === 'error' ? (
        <EmptyState
          title="Contacts unavailable"
          text="Phone contacts could not be opened right now."
        />
      ) : null}

      {status === 'unavailable' ? (
        <EmptyState
          title="Rebuild needed"
          text="The installed app does not include the native contacts picker yet. Rebuild the app, then try again."
        />
      ) : null}

      <SecondaryButton
        label={doneLabel}
        icon="arrow-back-outline"
        onPress={onDone}
      />
    </View>
  );
}

function RecipientRow({
  contact,
  selected,
  onPress,
  onUpdate,
}: {
  contact: ProjectContact;
  selected: boolean;
  onPress: () => void;
  onUpdate: (next: Partial<ProjectContact>) => void;
}) {
  const normalized = normalizeContact(contact);
  const emails = normalized.emails || [];
  const phones = normalized.phones || [];

  return (
    <View style={styles.contactRow}>
      <TouchableOpacity
        style={styles.contactRowHeader}
        onPress={onPress}
      >
        <View style={styles.rowIconBubble}>
          <Ionicons
            name={selected ? 'checkmark-circle' : 'person-outline'}
            size={20}
            color={colors.primary}
          />
        </View>

        <View style={styles.rowMain}>
          <Text style={styles.projectName}>
            {normalized.name || 'Unnamed Contact'}
          </Text>

          <Text style={styles.rowSub}>
            {emails.length} email{emails.length === 1 ? '' : 's'} | {phones.length} phone{phones.length === 1 ? '' : 's'}
          </Text>
        </View>

        <Text
          style={[
            styles.contactSelectText,
            selected && styles.contactSelectTextSelected,
          ]}
        >
          {selected ? 'Remove' : 'Add'}
        </Text>
      </TouchableOpacity>

      {emails.length > 0 ? (
        <View style={styles.deliveryChoiceBlock}>
          <Text style={styles.label}>Email kept with the update</Text>

          <View style={styles.choiceChipWrap}>
            {emails.map(email => {
              const active = selectedContactEmail(normalized) === email;

              return (
                <TouchableOpacity
                  key={email}
                  style={[
                    styles.deliveryChoiceChip,
                    active && styles.deliveryChoiceChipActive,
                  ]}
                  onPress={() =>
                    onUpdate({
                      selectedEmail: email,
                      email,
                    })
                  }
                >
                  <Text
                    style={[
                      styles.deliveryChoiceText,
                      active && styles.deliveryChoiceTextActive,
                    ]}
                    numberOfLines={1}
                  >
                    {email}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      ) : null}

      {phones.length > 0 ? (
        <View style={styles.deliveryChoiceBlock}>
          <Text style={styles.label}>Phone kept with the update</Text>

          <View style={styles.choiceChipWrap}>
            {phones.map(phone => {
              const active = selectedContactPhone(normalized) === phone;

              return (
                <TouchableOpacity
                  key={phone}
                  style={[
                    styles.deliveryChoiceChip,
                    active && styles.deliveryChoiceChipActive,
                  ]}
                  onPress={() =>
                    onUpdate({
                      selectedPhone: phone,
                      phone,
                    })
                  }
                >
                  <Text
                    style={[
                      styles.deliveryChoiceText,
                      active && styles.deliveryChoiceTextActive,
                    ]}
                    numberOfLines={1}
                  >
                    {phone}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      ) : null}
    </View>
  );
}

function SavedUpdatesScreen({
  contentStyle,
  updates,
  deletedTaskEvidenceIds,
  projectAreas,
  contactBook,
  onOpen,
  onDelete,
  onArchive,
  onRetryPhotoAnalysis,
  onRetryQueuedUpdate,
  onBack,
  initialTab,
  initialWithinDays,
  initialProject,
  projectFilter,
  onProjectFilterChange,
}: {
  contentStyle: StyleProp<ViewStyle>;
  updates: ProjectUpdate[];
  deletedTaskEvidenceIds: ReadonlySet<string>;
  projectAreas: ProjectArea[];
  contactBook: ContactBook;
  onOpen: (update: ProjectUpdate) => void;
  onDelete: (updateId: string) => void;
  onArchive: (updateId: string) => void;
  onRetryPhotoAnalysis: (update: ProjectUpdate, photo: UpdatePhoto) => void;
  onRetryQueuedUpdate: (update: ProjectUpdate) => void;
  onBack: () => void;
  initialTab?: 'Needs Review' | 'Drafts' | 'Sent' | 'All';
  initialWithinDays?: number | null;
  initialProject?: string | null;
  projectFilter: string | null;
  onProjectFilterChange: (projectName: string | null) => void;
}) {
  const { sizeClass } = useAppShellLayout();
  const [activeTab, setActiveTab] = useState<'Needs Action' | 'Drafts' | 'All Activity'>(
    initialTab === 'Drafts'
      ? 'Drafts'
      : initialTab === 'Sent' || initialTab === 'All'
        ? 'All Activity'
        : 'Needs Action',
  );
  const [searchText, setSearchText] = useState('');
  const [filterOpen, setFilterOpen] = useState(false);
  const [filters, setFilters] = useState<{
    project: string | null;
    areaId: string | null;
    pieStatus: string | null;
    lifecycleStatus: FieldUpdateStatus | null;
    withinDays: number | null;
  }>({
    project: projectFilter ?? initialProject ?? null,
    areaId: null,
    pieStatus: null,
    lifecycleStatus: null,
    withinDays: initialWithinDays ?? null,
  });
  const [selectedUpdateId, setSelectedUpdateId] = useState<string | null>(null);
  const [expandedComparisonId, setExpandedComparisonId] = useState<string | null>(null);

  useEffect(() => {
    setFilters(current => current.project === projectFilter
      ? current
      : { ...current, project: projectFilter });
  }, [projectFilter]);

  const contactNamesById = useMemo(() => {
    const map = new Map<string, string>();
    contactBook.contacts.forEach(contact => {
      map.set(contact.id, normalizeContact(contact).name || '');
    });
    return map;
  }, [contactBook]);

  const filteredUpdates = filterDAVEUpdateWorkspace({
    updates,
    activeTab,
    filters,
    searchText,
    contactNameForId: id => contactNamesById.get(id) || '',
    lifecycleForUpdate: lifecycleStatusForUpdate,
    pieStatusForUpdate: updatePIEAnalysisStatus,
    updateNeedsAction: updateNeedsReview,
    withinDaysMatches: (update, withinDays) => {
      const daysSince = daysUntilDate(update.date);
      return daysSince !== null && daysSince <= 0 && daysSince >= -withinDays;
    },
    updateTime: update => updateDateValue(update.date)?.getTime() || 0,
  });
  const selectedUpdate = resolveUpdateWorkspaceUpdate(filteredUpdates, selectedUpdateId);
  const exactComparison = buildDAVEUpdatePhotoComparison(selectedUpdate, updates);

  useEffect(() => {
    const resolvedId = selectedUpdate?.id || null;
    if (resolvedId !== selectedUpdateId) setSelectedUpdateId(resolvedId);
  }, [selectedUpdate?.id, selectedUpdateId]);

  const emptyTitle =
    activeTab === 'Needs Action'
      ? "✅ You're all caught up."
      : activeTab === 'Drafts'
        ? 'No drafts.'
        : 'No update history yet.';

  function retryUpdate(update: ProjectUpdate) {
    const lifecycle = lifecycleStatusForUpdate(update);

    if (lifecycle === 'queued' || lifecycle === 'failed') {
      onRetryQueuedUpdate(update);
      return;
    }

    // updateCanInlineRetry() also allows retry when PIE is merely stuck
    // ('analyzing' for too long), not just failed - so the target photo can
    // have status 'analyzing' rather than one of the two failure statuses.
    // Matching only the failure statuses here meant a stuck-but-not-failed
    // photo was never found, silently falling back to photos[0] and retrying
    // the wrong photo whenever the stuck one wasn't first in the list.
    const targetPhoto =
      update.photos.find(
        photo =>
          photo.photoIntelligence?.status === 'analysis_failed_retry' ||
          photo.photoIntelligence?.status === 'comparison_unavailable' ||
          photo.photoIntelligence?.status === 'analyzing',
      ) || update.photos[0];

    if (targetPhoto) onRetryPhotoAnalysis(update, targetPhoto);
  }

  function renderUpdateCard(
    update: ProjectUpdate,
    index: number,
    onSelect: () => void,
    selected = false,
  ) {
    const group = updateTimelineGroup(update.date);
    const previousGroup = index > 0 ? updateTimelineGroup(filteredUpdates[index - 1].date) : null;
    const mobileComparisonViewModel = updatePhotoComparisonViewModel(
      buildDAVEUpdatePhotoComparison(update, updates), formatDisplayDate, resolveProjectPhotoUri);

    return (
      <>
        {group !== previousGroup ? <Text style={styles.updateGroupHeader}>{group}</Text> : null}
        <UpdateHistoryCard
          update={update}
          historicalDeletedTask={deletedTaskEvidenceIds.has(update.id)}
          lifecycle={lifecycleStatusForUpdate(update)}
          pieStatus={updatePIEAnalysisStatus(update)}
          onOpen={onSelect}
          onRetry={updateCanInlineRetry(update) ? () => retryUpdate(update) : undefined}
          onDelete={() => onDelete(update.id)}
          onArchive={() => onArchive(update.id)}
          selected={selected}
        />
        {sizeClass !== 'wide' && mobileComparisonViewModel ? (
          <>
            <TouchableOpacity
              style={styles.compactInlineAction}
              onPress={() => setExpandedComparisonId(current =>
                current === update.id ? null : update.id)}
              accessibilityRole="button"
              accessibilityState={{ expanded: expandedComparisonId === update.id }}
              accessibilityLabel={`Compare current and prior photos for ${update.projectName}`}
            >
              <Text style={styles.compactInlineActionText}>
                {expandedComparisonId === update.id ? 'Hide photo comparison' : 'Compare photos'}
              </Text>
            </TouchableOpacity>
            {expandedComparisonId === update.id ? (
              <UpdatePhotoComparison comparison={mobileComparisonViewModel} />
            ) : null}
          </>
        ) : null}
      </>
    );
  }

  const renderUpdate = ({ item, index }: { item: ProjectUpdate; index: number }) =>
    renderUpdateCard(item, index, () => onOpen(item));

  const listHeader = (
    <>
      <TouchableOpacity style={styles.phase2BackButton} onPress={onBack} accessibilityRole="button" accessibilityLabel="Back to Overview">
        <Ionicons name="chevron-back" size={21} color={colors.primary} />
        <Text style={styles.dashboardManageText}>Overview</Text>
      </TouchableOpacity>
      <ScreenTitle title="Field Activity" subtitle="Search field records, drafts, and items that need action." />
      <View style={styles.updateSearchPanel}>
        <View style={styles.updateTopControlRow}>
          <View style={styles.updateSearchBox}>
            <Ionicons name="search-outline" size={19} color={colors.muted} />
            <TextInput style={styles.projectSearchInput} value={searchText} onChangeText={setSearchText} placeholder="Search updates" placeholderTextColor={colors.muted} />
          </View>
          <TouchableOpacity style={styles.updateFilterButton} onPress={() => setFilterOpen(true)} accessibilityRole="button" accessibilityLabel="Filter updates">
            <Ionicons name="filter-outline" size={20} color={colors.primary} />
          </TouchableOpacity>
        </View>
      </View>
      <View style={styles.updateSegmentRow}>
        {(['Needs Action', 'Drafts', 'All Activity'] as const).map(tab => {
          const selected = activeTab === tab;
          return <TouchableOpacity key={tab} style={[styles.updateSegment, selected && styles.updateSegmentSelected]} onPress={() => setActiveTab(tab)} accessibilityRole="tab" accessibilityState={{ selected }} accessibilityLabel={`${tab} updates`}><Text style={[styles.updateSegmentText, selected && styles.updateSegmentTextSelected]}>{tab}</Text></TouchableOpacity>;
        })}
      </View>
      <UpdateFilterSheet visible={filterOpen} updates={updates} projectAreas={projectAreas} filters={filters} onChange={next => {
        setFilters(next);
        onProjectFilterChange(next.project);
      }} onClose={() => setFilterOpen(false)} />
    </>
  );
  const emptyState = (
    <View style={styles.updateEmptyState}>
      <Text style={styles.updateEmptyTitle}>{emptyTitle}</Text>
      <Text style={styles.updateEmptyText}>{activeTab === 'Needs Action' ? 'No field records require action today.' : activeTab === 'Drafts' ? 'Start from Overview or a project when you are ready to capture field work.' : 'Saved field activity will appear here.'}</Text>
    </View>
  );
  // Photo objects, not their `uri` (empty for a cloud-only photo): A4 pass 7 M2.
  const comparison = updatePhotoComparisonViewModel(exactComparison, formatDisplayDate, resolveProjectPhotoUri);

  if (sizeClass === 'wide') {
    return <UpdatesWideWorkspace
      items={filteredUpdates}
      selectedUpdateId={selectedUpdate?.id || null}
      onSelectUpdate={setSelectedUpdateId}
      renderMasterItem={({ item, index, selected, onSelect }) => renderUpdateCard(item, index, onSelect, selected)}
      masterHeader={listHeader}
      comparison={comparison}
      emptyState={emptyState}
      inspector={selectedUpdate ? <ReadOnlyUpdateDetailScreen
        update={selectedUpdate}
        backLabel="Updates"
        onBack={() => undefined}
        embedded
        onResume={isResumableFieldUpdateStatus(lifecycleStatusForUpdate(selectedUpdate)) ? () => onOpen(selectedUpdate) : undefined}
        onRetry={['queued', 'failed'].includes(lifecycleStatusForUpdate(selectedUpdate)) ? () => onRetryQueuedUpdate(selectedUpdate) : undefined}
        onRetryPhotoAnalysis={onRetryPhotoAnalysis}
        onDelete={() => onDelete(selectedUpdate.id)}
        onArchive={() => onArchive(selectedUpdate.id)}
      /> : emptyState}
    />;
  }

  return (
    <FlatList
      style={styles.appFrame}
      contentContainerStyle={contentStyle}
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      initialNumToRender={12} maxToRenderPerBatch={12} windowSize={7} removeClippedSubviews={Platform.OS === 'android'}
      data={filteredUpdates}
      keyExtractor={update => update.id}
      renderItem={renderUpdate}
      ListHeaderComponent={listHeader}
      ListEmptyComponent={emptyState}
    />
  );
}

function UpdateFilterSheet({
  visible,
  updates,
  projectAreas,
  filters,
  onChange,
  onClose,
}: {
  visible: boolean;
  updates: ProjectUpdate[];
  projectAreas: ProjectArea[];
  filters: {
    project: string | null;
    areaId: string | null;
    pieStatus: string | null;
    lifecycleStatus: FieldUpdateStatus | null;
    withinDays: number | null;
  };
  onChange: (filters: {
    project: string | null;
    areaId: string | null;
    pieStatus: string | null;
    lifecycleStatus: FieldUpdateStatus | null;
    withinDays: number | null;
  }) => void;
  onClose: () => void;
}) {
  const projects = Array.from(new Set(updates.map(update => update.projectName))).filter(Boolean);
  const pieStatuses = Array.from(
    new Set(updates.map(updatePIEAnalysisStatus).filter(Boolean) as string[]),
  );

  return (
    <ProjectActionSheet visible={visible} title="Filter Updates" onClose={onClose}>
      <Text style={styles.sectionLabel}>Project</Text>
      <FilterOption
        label="All Projects"
        selected={!filters.project}
        onPress={() => onChange({ ...filters, project: null })}
      />
      {projects.map(project => (
        <FilterOption
          key={project}
          label={project}
          selected={filters.project === project}
          onPress={() => onChange({ ...filters, project })}
        />
      ))}

      <Text style={styles.sectionLabel}>Area</Text>
      <FilterOption
        label="All Areas"
        selected={!filters.areaId}
        onPress={() => onChange({ ...filters, areaId: null })}
      />
      {projectAreas.map(area => (
        <FilterOption
          key={area.id}
          label={area.name}
          selected={filters.areaId === area.id}
          onPress={() => onChange({ ...filters, areaId: area.id })}
        />
      ))}

      <Text style={styles.sectionLabel}>Cloud status</Text>
      {(['draft', 'ready_to_send', 'queued', 'sent', 'failed'] as FieldUpdateStatus[]).map(status => (
        <FilterOption
          key={status}
          label={fieldUpdateLifecycleLabel(status)}
          selected={filters.lifecycleStatus === status}
          onPress={() => onChange({ ...filters, lifecycleStatus: status })}
        />
      ))}

      <Text style={styles.sectionLabel}>Analysis status</Text>
      {pieStatuses.map(status => (
        <FilterOption
          key={status}
          label={status}
          selected={filters.pieStatus === status}
          onPress={() => onChange({ ...filters, pieStatus: status })}
        />
      ))}

      <Text style={styles.sectionLabel}>Photo status</Text>
      <Text style={styles.bodyText}>Photo, document, date, and cloud status all come from the same saved field record.</Text>

      <SecondaryButton
        label="Clear Filters"
        icon="close-circle-outline"
        onPress={() =>
          onChange({
            project: null,
            areaId: null,
            pieStatus: null,
            lifecycleStatus: null,
            withinDays: null,
          })
        }
      />
    </ProjectActionSheet>
  );
}

function FilterOption({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      style={[
        styles.projectSelectorRow,
        selected && styles.projectSelectorRowSelected,
      ]}
      onPress={onPress}
    >
      <View style={styles.rowMain}>
        <Text style={styles.projectName}>{label}</Text>
      </View>
      {selected ? (
        <Ionicons name="checkmark-circle" size={22} color={colors.primary} />
      ) : null}
    </TouchableOpacity>
  );
}

function UpdateHistoryCard({
  update,
  historicalDeletedTask = false,
  lifecycle,
  pieStatus,
  onOpen,
  onRetry,
  onDelete,
  onArchive,
  selected = false,
}: {
  update: ProjectUpdate;
  historicalDeletedTask?: boolean;
  lifecycle: FieldUpdateStatus;
  pieStatus: string | null;
  onOpen: () => void;
  onRetry?: () => void;
  onDelete: () => void;
  onArchive: () => void;
  selected?: boolean;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const documents = update.documents || [];
  const thumbnail = useProjectPhotoDisplayUri(update.photos[0], resolveProjectPhotoUri(update.photos[0] || {}));
  const statusLine =
    lifecycle === 'queued'
      ? queuedStatusCopyForUpdate(update)
      : lifecycle === 'ready_to_send'
        ? 'Ready to sync'
        : lifecycle === 'failed'
          ? queuedStatusCopyForUpdate(update)
          : pieStatus ||
            (update.photos.length === 0
              ? update.notes.trim() || (documents.length > 0 ? countLabel(documents.length, 'document') : 'No photos attached')
              : null);
  const updateType = update.quickContext || (update.photos.length > 0 ? 'Photo update' : 'Project update');
  const summary =
    update.observedFindings?.[0] ||
    statusLine ||
    update.notes.trim() ||
    (documents.length > 0
      ? `${countLabel(documents.length, 'document')} added to this update.`
      : 'Project update recorded.');
  const statusLabel = fieldUpdateLifecycleLabel(lifecycle);

  return (
    <TouchableOpacity
      style={[styles.updateCard, selected && { borderColor: colors.primary, borderLeftWidth: 5, backgroundColor: colors.primarySoft }]}
      onPress={onOpen}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={`${update.projectName}. ${summary}. ${updateType}. ${statusLabel}. ${historicalDeletedTask ? `${DELETED_TASK_EVIDENCE_LABEL}. ` : ''}${relativeUpdateTimestamp(update.date)}`}
    >
      <View style={styles.updateCardMedia}>
        {thumbnail.uri ? (
          <Image source={{ uri: thumbnail.uri }} onError={thumbnail.onError} style={styles.updateCardThumb} />
        ) : (
          <View style={styles.updateCardThumbPlaceholder}>
            <Ionicons name="document-text-outline" size={28} color={colors.primary} />
          </View>
        )}
        <Text style={styles.updatePhotoStatusPill}>{statusLabel}</Text>
      </View>

      <View style={styles.rowMain}>
        <Text style={styles.updateCardProject} numberOfLines={1}>{update.projectName}</Text>
        <Text style={styles.updateCardSummary} numberOfLines={2}>{summary}</Text>
        {historicalDeletedTask ? (
          <Text style={styles.updateHistoricalEvidenceLabel}>
            {DELETED_TASK_EVIDENCE_LABEL}
          </Text>
        ) : null}
        <View style={styles.updateCardMetaRow}>
          <Text style={styles.updateCardType}>{updateType}</Text>
          <Text style={styles.updateCardMetaDot}>•</Text>
          <Text style={styles.updateCardTime}>{relativeUpdateTimestamp(update.date)}</Text>
        </View>
        {onRetry ? (
          <TouchableOpacity style={styles.photoControlButton} onPress={onRetry}>
            <Ionicons name="refresh-outline" size={17} color={colors.primary} />
            <Text style={styles.photoControlText}>Retry</Text>
          </TouchableOpacity>
        ) : null}
        {__DEV__ && update.deleteDiagnostics ? (
          <Text style={styles.rowSub}>
            Delete state: {update.deleteDiagnostics.sourceAfterReload} ·{' '}
            {update.deleteDiagnostics.mergeDecision} · ignored photos{' '}
            {update.deleteDiagnostics.orphanedPhotoCountIgnored}
          </Text>
        ) : null}
        {__DEV__ && update.syncDiagnostics ? (
          <Text style={styles.rowSub}>
            cloud insert attempted {String(update.syncDiagnostics.cloudUpdateInsertAttempted)} · photo upload attempted{' '}
            {String(update.syncDiagnostics.photoStorageUploadAttempted)} · storage bucket{' '}
            {update.syncDiagnostics.storageBucketName || 'unknown'} · bucket exists{' '}
            {update.syncDiagnostics.storageBucketExists} · storage category{' '}
            {update.syncDiagnostics.storageFailureCategory || 'none'} · storage status{' '}
            {update.syncDiagnostics.storageHttpStatus ?? 'none'} · storage code{' '}
            {update.syncDiagnostics.storageErrorCode || 'none'} · retry attempt{' '}
            {update.syncDiagnostics.retryAttemptNumber ?? 'none'} · local file exists{' '}
            {String(update.syncDiagnostics.localFileExists)} · local file readable{' '}
            {String(update.syncDiagnostics.localFileReadable)} · byte size{' '}
            {update.syncDiagnostics.fileByteSizeCategory} · payload{' '}
            {update.syncDiagnostics.uploadPayloadType} · content type{' '}
            {update.syncDiagnostics.storageContentType || 'unknown'} · path category{' '}
            {update.syncDiagnostics.objectPathCategory || 'unknown'} · database after upload{' '}
            {String(update.syncDiagnostics.databaseSyncRanAfterUpload)} · failed operation{' '}
            {update.syncDiagnostics.failedOperationName || 'none'} · target{' '}
            {update.syncDiagnostics.failedLogicalTarget || 'none'} · RLS denied{' '}
            {String(update.syncDiagnostics.rlsDenied)} · user id present{' '}
            {String(update.syncDiagnostics.authenticatedUserIdPresent)} · project id present{' '}
            {String(update.syncDiagnostics.projectIdPresent)} · organization id present{' '}
            {String(update.syncDiagnostics.organizationIdPresent)} · membership{' '}
            {update.syncDiagnostics.membershipCheckResult || 'unknown'} · rls/auth{' '}
            {String(update.syncDiagnostics.rlsOrAuthFailureDetected)}
            {' '}· Rollup source: local-first saved updates | queued included: yes | workspace/card shared: yes
          </Text>
        ) : null}
      </View>

      <View style={styles.updateCardActions}>
        <TouchableOpacity
          style={styles.iconOnlyButton}
          onPress={() => setMenuOpen(true)}
          accessibilityRole="button"
          accessibilityLabel={`More options for ${update.projectName} update`}
        >
          <Ionicons name="ellipsis-horizontal" size={20} color={colors.text} />
        </TouchableOpacity>
        <Ionicons name="chevron-forward" size={22} color={colors.muted} />
      </View>

      <UpdateOverflowMenu
        visible={menuOpen}
        lifecycle={lifecycle}
        onClose={() => setMenuOpen(false)}
        onDelete={onDelete}
        onArchive={onArchive}
      />
    </TouchableOpacity>
  );
}

function UpdateOverflowMenu({
  visible,
  lifecycle,
  onClose,
  onDelete,
  onArchive,
}: {
  visible: boolean;
  lifecycle: FieldUpdateStatus;
  onClose: () => void;
  onDelete: () => void;
  onArchive: () => void;
}) {
  const cloudSynced = lifecycle === 'sent';
  const deleteLabel = 'Delete This Update';

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <View style={styles.projectSelectorBackdrop}>
        <TouchableOpacity style={styles.projectSelectorScrim} onPress={onClose} />
        <View style={styles.updateOverflowSheet}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.panelTitle}>Update Options</Text>
            <TouchableOpacity style={styles.iconOnlyButton} onPress={onClose}>
              <Ionicons name="close-outline" size={22} color={colors.text} />
            </TouchableOpacity>
          </View>
          {cloudSynced ? (
            <MoreOptionRow
              label="Archive cloud-synced update"
              icon="archive-outline"
              onPress={() => {
                onClose();
                onArchive();
              }}
            />
          ) : null}
          <MoreOptionRow
            label={deleteLabel}
            icon="trash-outline"
            onPress={() => {
              onClose();
              onDelete();
            }}
          />
        </View>
      </View>
    </Modal>
  );
}

function ScheduleScreen({
  contentStyle,
  screenshotImportAvailable,
  cloudDownloadPending = false,
  scheduleItems,
  savedUpdates,
  projectAreas,
  projects,
  projectRecords,
  scheduleDocuments,
  onBack,
  onOpenDocument,
  onDeleteDocument,
  onSetActiveDocument,
  onAdd,
  onUpdate,
  onSave,
  onDelete,
  onImport,
  onImportScreenshot,
  onApproveImport,
  onCancelImport,
  incomingImportBatch,
  onIncomingImportConsumed,
  onNewFieldUpdateForTask,
  onOpenUpdate,
  initialFilter,
  initialAddProjectName,
  initialAddGuided,
  onInitialAddGuidedConsumed,
  projectFilter,
  defaultOwner,
  currentUserEmail,
}: {
  contentStyle: StyleProp<ViewStyle>;
  screenshotImportAvailable: boolean;
  cloudDownloadPending?: boolean;
  scheduleItems: ScheduleItem[];
  savedUpdates: ProjectUpdate[];
  projectAreas: ProjectArea[];
  projects: string[];
  projectRecords: readonly ProjectRecord[];
  scheduleDocuments: ReferenceDocument[];
  onBack: () => void;
  onOpenDocument: (document: ReferenceDocument) => void;
  onDeleteDocument: (documentId: string) => void;
  onSetActiveDocument: (documentId: string) => void;
  onAdd: (item: Partial<ScheduleItem>) => void;
  onUpdate: (
    itemId: string,
    next: Partial<ScheduleItem>,
    workflowRequest?: ProjectItemWorkflowMutationRequest,
  ) => void;
  onSave: (itemId: string) => Promise<boolean>;
  onDelete: (itemId: string) => void;
  onImport: (onProcessingStart: () => void) => Promise<PIEScheduleImportBatch | null>;
  onImportScreenshot: (onProcessingStart: () => void) => Promise<PIEScheduleImportBatch | null>;
  onApproveImport: (batch: PIEScheduleImportBatch) => Promise<void>;
  onCancelImport: (batch: PIEScheduleImportBatch) => void;
  incomingImportBatch: PIEScheduleImportBatch | null;
  onIncomingImportConsumed: () => void;
  onNewFieldUpdateForTask: (item: ScheduleItem) => void;
  onOpenUpdate: (update: ProjectUpdate) => void;
  initialFilter?: ScheduleTaskFilter;
  initialAddProjectName?: string | null;
  initialAddGuided?: boolean;
  onInitialAddGuidedConsumed?: () => void;
  projectFilter?: string | null;
  defaultOwner?: string;
  currentUserEmail?: string;
}) {
  const { sizeClass } = useAppShellLayout();
  const scheduleScreenInsets = useSafeAreaInsets();
  const isWideWorkspace = sizeClass === 'wide';
  const [workspaceView, setWorkspaceView] = useState<ScheduleWorkspaceView>('Tasks');
  const [taskView, setTaskView] = useState<ScheduleTaskView>('Open Tasks');
  const [taskFilter, setTaskFilter] = useState<ScheduleTaskFilter>(initialFilter || 'Attention');
  const [itemTypeFilter, setItemTypeFilter] = useState<ProjectItemType | 'All'>('All');
  const [collapsedMobileTaskAreas, setCollapsedMobileTaskAreas] = useState<Set<string>>(
    () => new Set(),
  );
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [selectedAreaKey, setSelectedAreaKey] = useState<string | null>(null);
  const [planningTaskId, setPlanningTaskId] = useState<string | null>(null);
  const [scheduleManagementOpen, setScheduleManagementOpen] = useState(false);
  const [showAdd, setShowAdd] = useState(Boolean(initialAddProjectName));
  const [sourcesOpen, setSourcesOpen] = useState(false);

  useEffect(() => {
    if (!initialAddProjectName) return;
    setWorkspaceView('Tasks');
    setShowAdd(true);
  }, [initialAddProjectName]);

  useEffect(() => { if (incomingImportBatch) setScheduleManagementOpen(true); }, [incomingImportBatch]);

  const workspaceScheduleItems = useMemo(
    () => scheduleItemsForWorkspaceProject(
      scheduleItems,
      isWideWorkspace ? projectFilter || null : null,
    ),
    [isWideWorkspace, projectFilter, scheduleItems],
  );
  const workspaceSavedUpdates = useMemo(
    () => isWideWorkspace && projectFilter
      ? projectUpdatesForParentProject(
          savedUpdates,
          projectFilter,
          scheduleItems,
        )
      : savedUpdates,
    [isWideWorkspace, projectFilter, savedUpdates, scheduleItems],
  );

  const scheduleReconciliation = useMemo(
    () => buildPIEScheduleReconciliation({
      scheduleItems: workspaceScheduleItems,
      updates: workspaceSavedUpdates,
    }),
    [workspaceSavedUpdates, workspaceScheduleItems],
  );
  const actionableScheduleWarnings = useMemo(
    () => scheduleReconciliation.warnings.filter(scheduleWarningIsUserActionable),
    [scheduleReconciliation.warnings],
  );
  const dependencyNetwork = useMemo(
    () => buildPIEScheduleDependencyNetwork(
      workspaceScheduleItems as unknown as import('./types').ScheduleItem[],
    ),
    [workspaceScheduleItems],
  );
  const dependencyNodeByItemId = useMemo(
    () => new Map(dependencyNetwork.nodes.map(node => [node.scheduleItemId, node])),
    [dependencyNetwork],
  );
  const actionInbox = useMemo(
    () => buildDAVEActionInbox({
      scheduleItems: workspaceScheduleItems as unknown as import('./types').ScheduleItem[],
      updates: workspaceSavedUpdates as unknown as import('./types').ProjectUpdate[],
      reconciliationWarnings: actionableScheduleWarnings,
      dependencyNodes: dependencyNetwork.nodes,
    }),
    [actionableScheduleWarnings, dependencyNetwork.nodes, workspaceSavedUpdates, workspaceScheduleItems],
  );
  const attentionScheduleItemIds = useMemo(
    () => new Set(actionInbox.items.flatMap(item => item.scheduleItemId ? [item.scheduleItemId] : [])),
    [actionInbox.items],
  );
  const scheduleFieldResults = useMemo(() => {
    const matches = new Map<string, PIEScheduleFieldMatch>();
    const warnings = new Map<string, PIEScheduleReconciliationWarning[]>();

    scheduleReconciliation.matches.forEach(match => {
      matches.set(match.scheduleItemId, match);
    });
    actionableScheduleWarnings.forEach(warning => {
      warnings.set(warning.scheduleItemId, [
        ...(warnings.get(warning.scheduleItemId) || []),
        warning,
      ]);
    });

    return { matches, warnings };
  }, [actionableScheduleWarnings, scheduleReconciliation.matches]);

  const sortedItems = useMemo(() => [...workspaceScheduleItems].sort((a, b) => {
    const aComplete = scheduleTaskIsComplete(a);
    const bComplete = scheduleTaskIsComplete(b);
    if (aComplete !== bComplete) return Number(aComplete) - Number(bComplete);

    const aDays = daysUntilScheduleItem(a);
    const bDays = daysUntilScheduleItem(b);

    if (aDays === null && bDays === null) return 0;
    if (aDays === null) return 1;
    if (bDays === null) return -1;

    if (aDays !== bDays) return aDays - bDays;

    const priorityRank: Record<SchedulePriority, number> = { High: 0, Medium: 1, Low: 2 };
    return priorityRank[a.priority] - priorityRank[b.priority] ||
      a.taskName.localeCompare(b.taskName);
  }), [workspaceScheduleItems]);

  const dueSoon = useMemo(() => sortedItems.filter(item => {
    if (scheduleTaskIsComplete(item)) return false;
    const days = daysUntilScheduleItem(item);
    return days !== null && days >= 0 && days <= 7;
  }), [sortedItems]);

  const overdue = useMemo(() => sortedItems.filter(item => {
    if (scheduleTaskIsComplete(item)) return false;
    const days = daysUntilScheduleItem(item);
    return days !== null && days < 0;
  }), [sortedItems]);

  const openTaskCount = useMemo(
    () => sortedItems.filter(item => !scheduleTaskIsComplete(item)).length,
    [sortedItems],
  );
  const completedTaskCount = sortedItems.length - openTaskCount;
  const myWork = useMemo(
    () => buildVitruviusMyWork({
      items: sortedItems,
      displayName: defaultOwner,
      email: currentUserEmail,
    }),
    [currentUserEmail, defaultOwner, sortedItems],
  );
  const myWorkTaskIds = useMemo(
    () => new Set(myWork.items.map(row => row.item.id)),
    [myWork.items],
  );
  const myReviews = useMemo(
    () => buildVitruviusReviewQueue({
      items: sortedItems,
      displayName: defaultOwner,
      email: currentUserEmail,
    }),
    [currentUserEmail, defaultOwner, sortedItems],
  );
  const myReviewTaskIds = useMemo(
    () => new Set(myReviews.items.map(item => item.id)),
    [myReviews.items],
  );
  const attentionTaskIds = useMemo(() => new Set(sortedItems
    .filter(item => {
      if (scheduleTaskIsComplete(item)) return false;
      const days = daysUntilScheduleItem(item);
      const dependency = dependencyNodeByItemId.get(item.id);
      return (
        (days !== null && days <= 7) ||
        item.status === 'Waiting' ||
        (item.priority === 'High' && days === null) ||
        scheduleItemNeedsCompletionVerification(
          item as unknown as import('./types').ScheduleItem,
        ) ||
        Boolean(scheduleFieldResults.warnings.get(item.id)?.length) ||
        Boolean(dependency?.blocked || dependency?.unresolvedPredecessors.length) ||
        attentionScheduleItemIds.has(item.id)
      );
    })
    .map(item => item.id)), [
    attentionScheduleItemIds,
    dependencyNodeByItemId,
    scheduleFieldResults.warnings,
    sortedItems,
  ]);
  const filteredItems = useMemo(() => sortedItems.filter(item => {
    if (
      itemTypeFilter !== 'All' &&
      normalizeProjectItemType(item.itemType) !== itemTypeFilter
    ) return false;
    const complete = scheduleTaskIsComplete(item);
    if (taskView === 'Completed Tasks') return complete;
    if (complete) return false;
    if (taskFilter === 'All') return true;
    const days = daysUntilScheduleItem(item);
    if (taskFilter === 'Today') return days === 0;
    if (taskFilter === '7 Days') return days !== null && days >= 0 && days <= 7;
    if (taskFilter === 'Overdue') return days !== null && days < 0;
    if (taskFilter === 'My Work') return myWorkTaskIds.has(item.id);
    if (taskFilter === 'My Reviews') return myReviewTaskIds.has(item.id);
    return attentionTaskIds.has(item.id);
  }), [
    attentionTaskIds,
    myReviewTaskIds,
    myWorkTaskIds,
    sortedItems,
    taskFilter,
    taskView,
    itemTypeFilter,
  ]);

  const groupedTaskSections = useMemo(
    () => groupScheduleWorkspaceItemsByProjectAndArea(filteredItems),
    [filteredItems],
  );
  const taskAreaSummaries = useMemo(
    () => new Map(groupedTaskSections.map(section => {
      const areaKey = scheduleWorkspaceAreaKey(section);
      return [areaKey, buildDAVETaskAreaSummary({
        projectName: section.projectName,
        areaName: section.areaName,
        tasks: section.data,
      })];
    })),
    [groupedTaskSections],
  );
  const selectedAreaSummary = selectedAreaKey
    ? taskAreaSummaries.get(selectedAreaKey) || null
    : null;
  const mobileTaskSections = useMemo(
    () => groupedTaskSections.map(section => {
      const areaKey = `${section.projectName.trim().toLowerCase()}::${section.areaName.trim().toLowerCase()}`;
      const collapsed = collapsedMobileTaskAreas.has(areaKey);
      return {
        ...section,
        areaKey,
        areaTaskCount: section.data.length,
        collapsed,
        data: collapsed ? [] : section.data,
      };
    }),
    [collapsedMobileTaskAreas, groupedTaskSections],
  );
  const taskViewLabel = taskView === 'Completed Tasks'
    ? 'Completed Tasks'
    : taskFilter === 'My Work'
      ? 'My Work'
    : taskFilter === 'My Reviews'
      ? 'My Reviews'
    : taskFilter === 'All'
      ? 'Open Tasks'
      : `${taskFilter} Tasks`;

  const selectedTask = resolveScheduleWorkspaceTask(filteredItems, selectedTaskId);
  const planningTask = workspaceScheduleItems.find(item => item.id === planningTaskId) || null;
  const taskControls = (
    <ScheduleTaskListControls
      scopeLabel={isWideWorkspace ? projectFilter || 'All Projects' : undefined}
      taskCount={workspaceScheduleItems.length}
      dueSoonCount={dueSoon.length}
      overdueCount={overdue.length}
      needsActionCount={attentionTaskIds.size}
      myWorkCount={myWork.counts.open}
      myReviewCount={myReviews.items.length}
      openTaskCount={openTaskCount}
      completedTaskCount={completedTaskCount}
      activeView={taskView}
      activeFilter={taskFilter}
      activeItemType={itemTypeFilter}
      onItemTypeChange={itemType => {
        setItemTypeFilter(itemType);
        setSelectedTaskId(null);
        setSelectedAreaKey(null);
      }}
      onViewChange={view => {
        setTaskView(view);
        setSelectedTaskId(null);
        setSelectedAreaKey(null);
      }}
      onFilterChange={filter => {
        setTaskFilter(filter);
        setSelectedTaskId(null);
        setSelectedAreaKey(null);
      }}
      onNeedsAttentionPress={() => {
        setWorkspaceView('Tasks');
        setTaskView('Open Tasks');
        setTaskFilter('Attention');
        setSelectedTaskId(null);
        setSelectedAreaKey(null);
      }}
      onMyWorkPress={() => {
        setWorkspaceView('Tasks');
        setTaskView('Open Tasks');
        setTaskFilter('My Work');
        setSelectedTaskId(null);
        setSelectedAreaKey(null);
      }}
      onMyReviewsPress={() => {
        setWorkspaceView('Tasks');
        setTaskView('Open Tasks');
        setTaskFilter('My Reviews');
        setSelectedTaskId(null);
        setSelectedAreaKey(null);
      }}
      onAddTask={() => setShowAdd(true)}
      workspaceView={workspaceView}
      onWorkspaceViewChange={view => {
        setWorkspaceView(view);
        setSelectedTaskId(null);
        setPlanningTaskId(null);
      }}
    />
  );
  const scheduleTools = (
    <>
          <View style={styles.panel}>
            <Text style={styles.panelTitle}>Share Schedule</Text>
            <Text style={styles.rowSub}>
              Send the current task dates to a calendar or share a 3-week lookahead spreadsheet.
            </Text>
            <View style={styles.inlineActionRow}>
              <TouchableOpacity
                style={styles.compactInlineAction}
                onPress={() => {
                  void shareScheduleCalendar(workspaceScheduleItems);
                }}
                accessibilityRole="button"
                accessibilityLabel="Share schedule calendar"
              >
                <Ionicons name="calendar-outline" size={17} color={colors.primary} />
                <Text style={styles.compactInlineActionText}>Calendar</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.compactInlineAction}
                onPress={() => {
                  void shareScheduleLookahead(workspaceScheduleItems);
                }}
                accessibilityRole="button"
                accessibilityLabel="Share 3-week lookahead"
              >
                <Ionicons name="share-outline" size={17} color={colors.primary} />
                <Text style={styles.compactInlineActionText}>3-Week Lookahead</Text>
              </TouchableOpacity>
            </View>
          </View>

          {actionableScheduleWarnings.length > 0 ||
          dependencyNetwork.blockedItemCount > 0 ||
          dependencyNetwork.unresolvedReferenceCount > 0 ||
          dependencyNetwork.cycles.length > 0 ? (
          <View style={styles.panel}>
            <View style={styles.areaStatusLine}>
              <Ionicons
                name={actionableScheduleWarnings.length > 0
                  ? 'warning-outline'
                  : 'checkmark-circle-outline'}
                size={20}
                color={actionableScheduleWarnings.length > 0
                  ? colors.warning
                  : colors.success}
              />
              <Text style={styles.panelTitle}>Plan vs Field</Text>
            </View>

            {actionableScheduleWarnings.length > 0 ? (
              <Text style={styles.bodyText}>
                {actionableScheduleWarnings.length} current schedule-to-field {pluralWord(actionableScheduleWarnings.length, 'conflict')} need attention.
              </Text>
            ) : null}
            {dependencyNetwork.blockedItemCount > 0 || dependencyNetwork.unresolvedReferenceCount > 0 ? (
              <Text style={styles.bodyText}>
                Dependency check: {dependencyNetwork.blockedItemCount} blocked {pluralWord(dependencyNetwork.blockedItemCount, 'task')}
                {dependencyNetwork.unresolvedReferenceCount > 0
                  ? `; ${dependencyNetwork.unresolvedReferenceCount} predecessor ${pluralWord(dependencyNetwork.unresolvedReferenceCount, 'reference')} still needs mapping.`
                  : '.'}
              </Text>
            ) : null}
            {dependencyNetwork.cycles.length > 0 ? (
              <Text style={[styles.bodyText, { color: colors.danger }]}>A circular dependency was found. Correct it before relying on downstream dates.</Text>
            ) : null}

            {actionableScheduleWarnings.slice(0, 3).map(warning => (
              <View key={warning.id} style={styles.compactLocationRow}>
                <View style={styles.rowIconBubble}>
                  <Ionicons
                    name={warning.severity === 'critical' || warning.severity === 'high'
                      ? 'alert-circle-outline'
                      : 'information-circle-outline'}
                    size={20}
                    color={warning.severity === 'critical' || warning.severity === 'high'
                      ? colors.danger
                      : colors.warning}
                  />
                </View>
                <View style={styles.rowMain}>
                  <Text style={styles.projectName}>{warning.title}</Text>
                  <Text style={styles.rowSub}>{warning.summary}</Text>
                  <Text style={styles.rowSub}>{warning.suggestedAction}</Text>
                </View>
              </View>
            ))}
          </View>
          ) : null}

          <TouchableOpacity
            style={styles.panel}
            onPress={() => setScheduleManagementOpen(open => !open)}
            accessibilityRole="button"
            accessibilityState={{ expanded: scheduleManagementOpen }}
          >
            <View style={styles.rowIconBubble}>
              <Ionicons name="calendar-outline" size={20} color={colors.primary} />
            </View>
            <View style={styles.rowMain}>
              <Text style={styles.panelTitle}>Manage Schedule</Text>
              <Text style={styles.rowSub}>Import and review schedule sources</Text>
            </View>
            <Ionicons name={scheduleManagementOpen ? 'chevron-up' : 'chevron-down'} size={20} color={colors.muted} />
          </TouchableOpacity>

          {scheduleManagementOpen ? (
            <ScheduleImportFlow
              screenshotImportAvailable={screenshotImportAvailable}
              onImportFile={onImport}
              onImportScreenshots={onImportScreenshot}
              onAddManually={() => setShowAdd(true)}
              onApprove={onApproveImport}
              onCancel={onCancelImport}
              incomingBatch={incomingImportBatch}
              onIncomingBatchConsumed={onIncomingImportConsumed}
              roleContext={{ documents: scheduleDocuments, items: scheduleItems as unknown as import('./types').ScheduleItem[] }}
            />
          ) : null}

          {scheduleManagementOpen && scheduleDocuments.length ? (
            <View style={styles.panel}>
              <TouchableOpacity
                style={styles.sectionHeaderRow}
                onPress={() => setSourcesOpen(open => !open)}
                accessibilityRole="button"
                accessibilityState={{ expanded: sourcesOpen }}
              >
                <View style={styles.rowMain}>
                  <Text style={styles.panelTitle}>Schedule Sources</Text>
                  <Text style={styles.rowSub}>
                    {scheduleDocuments.filter(document => document.category === 'Schedules' && document.isCurrent).length} current ·{' '}
                    {scheduleDocuments.filter(document => document.category === 'Schedules' && !document.isCurrent).length} prior
                    {scheduleDocuments.some(document => document.notes.includes('[Schedule communication screenshot]'))
                      ? ` · ${scheduleDocuments.filter(document => document.notes.includes('[Schedule communication screenshot]')).length} supporting`
                      : ''}
                  </Text>
                </View>
                <Ionicons
                  name={sourcesOpen ? 'chevron-up-outline' : 'chevron-down-outline'}
                  size={20}
                  color={colors.primary}
                />
              </TouchableOpacity>

              {sourcesOpen ? <Text style={styles.bodyText}>
                Keep only the current Gantt schedule active. Message screenshots are supporting sources and never replace the active schedule.
              </Text> : null}

              {sourcesOpen ? scheduleDocuments.map(document => {
                const isScreenshot = document.notes.includes('[Schedule communication screenshot]');

                return (
                <View key={document.id} style={styles.compactLocationRow}>
                  <View style={styles.rowIconBubble}>
                    <Ionicons
                      name={isScreenshot ? 'image-outline' : 'document-text-outline'}
                      size={20}
                      color={colors.primary}
                    />
                  </View>

                  <View style={styles.rowMain}>
                    <Text style={styles.projectName}>{document.name}</Text>
                    <Text style={styles.rowSub} numberOfLines={1}>
                      {document.originalFileName}
                    </Text>
                    <Text style={styles.rowSub}>
                      Imported {formatSavedTime(document.importedAt)} • {isScreenshot
                        ? 'Supporting message screenshot'
                        : document.isCurrent || scheduleDocumentAddsToMaster(document) ? scheduleDocumentCurrentLabel(document, 'Active schedule', scheduleDocuments) : 'Inactive'}
                    </Text>
                  </View>

                  <View style={styles.compactActionColumn}>
                    <TouchableOpacity
                      style={styles.compactInlineAction}
                      onPress={() => onOpenDocument(document)}
                      accessibilityRole="button"
                      accessibilityLabel={`Open ${document.name}`}
                    >
                      <Text style={styles.compactInlineActionText}>Open</Text>
                    </TouchableOpacity>
                    {!isScreenshot && !scheduleDocumentIsCurrentEverywhere(document, scheduleDocuments) ? (
                      <TouchableOpacity
                        style={styles.compactInlineAction}
                        onPress={() => onSetActiveDocument(document.id)}
                        accessibilityRole="button"
                        accessibilityLabel={`Set ${document.name} as the active schedule`}
                      >
                        <Text style={styles.compactInlineActionText}>Set Active</Text>
                      </TouchableOpacity>
                    ) : null}
                    <TouchableOpacity
                      style={styles.compactInlineAction}
                      onPress={() => onDeleteDocument(document.id)}
                      accessibilityRole="button"
                      accessibilityLabel={`Delete ${document.name}`}
                    >
                      <Text style={[styles.compactInlineActionText, { color: colors.danger }]}>Delete</Text>
                    </TouchableOpacity>
                  </View>
                </View>
                );
              }) : null}
            </View>
          ) : null}
    </>
  );
  const emptyState = taskView === 'Open Tasks' && taskFilter === 'My Work'
    ? (
        <EmptyState
          title="No work assigned to you"
          text="Open tasks assigned to your name or signed-in email will appear here."
        />
      )
    : taskView === 'Open Tasks' && taskFilter === 'My Reviews'
      ? (
          <EmptyState
            title="No reviews waiting for you"
            text="Records that name you as an approver and need a decision will appear here."
          />
        )
    : sortedItems.length > 0
      ? (
          <EmptyState
            title="No tasks match this view"
            text="Choose another task filter or project to review more work."
          />
        )
      : (
          // Not "import one" while the cloud's tasks have not arrived (audit A2 M5).
          <EmptyState
            title={cloudDownloadPending ? 'Tasks not downloaded yet' : 'No schedule items yet'}
            text={cloudDownloadPending
              ? 'The first download from the cloud did not finish. Vitruvius keeps retrying; Settings › Sync Now retries now.'
              : 'Import a CSV/text schedule or add a schedule item manually.'}
          />
        );
  const taskEditor = (
    <ScheduleTaskEditorModal
      visible={showAdd}
      projects={projects}
      projectRecords={projectRecords}
      projectAreas={projectAreas}
      scheduleItems={scheduleItems}
      initialProjectName={initialAddProjectName || (isWideWorkspace ? projectFilter : null)}
      initiallyGuided={Boolean(initialAddGuided)}
      defaultOwner={defaultOwner}
      onClose={() => {
        setShowAdd(false);
        onInitialAddGuidedConsumed?.();
      }}
      onSubmit={onAdd}
    />
  );
  const planningTaskEditor = (
    <Modal
      visible={Boolean(planningTask)}
      animationType="slide"
      transparent
      onRequestClose={() => setPlanningTaskId(null)}
    >
      <View style={styles.sheetModalBackdrop}>
        <View
          style={[
            styles.sheetModalSafeArea,
            {
              paddingTop: scheduleScreenInsets.top,
              paddingBottom: scheduleScreenInsets.bottom,
            },
          ]}
        >
          <View style={styles.sheetModalHeader}>
            <View style={styles.sheetModalTitleWrap}>
              <Text style={styles.sheetModalTitle}>Schedule Task</Text>
              <Text style={styles.sheetModalCaption}>
                {planningTask
                  ? `${planningTask.projectName}${planningTask.locationName ? ` • ${planningTask.locationName}` : ''}`
                  : ''}
              </Text>
            </View>
            <TouchableOpacity
              style={styles.sheetModalCloseButton}
              onPress={() => afterTextInputBlur(() => setPlanningTaskId(null))}
              accessibilityRole="button"
              accessibilityLabel="Close schedule task"
            >
              <Ionicons name="close" size={26} color={colors.text} />
            </TouchableOpacity>
          </View>

          <ScrollView
            style={styles.appFrame}
            contentContainerStyle={[styles.content, { paddingTop: 8, paddingBottom: 24 }]}
            contentInsetAdjustmentBehavior="automatic"
            keyboardShouldPersistTaps="handled"
          >
            {planningTask ? (
              <ScheduleItemRow
                item={planningTask}
                scheduleItems={scheduleItems}
                projectAreas={projectAreas}
                dependencyNode={dependencyNodeByItemId.get(planningTask.id) || null}
                fieldWarnings={scheduleFieldResults.warnings.get(planningTask.id) || []}
                expanded
                activityAuthor={defaultOwner}
                onUpdate={(next, workflowRequest) =>
                  onUpdate(planningTask.id, next, workflowRequest)}
                onSave={() => onSave(planningTask.id)}
                onDelete={() => {
                  onDelete(planningTask.id);
                  setPlanningTaskId(null);
                }}
                onAddFieldUpdate={() => {
                  setPlanningTaskId(null);
                  onNewFieldUpdateForTask(planningTask);
                }}
              />
            ) : null}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );

  if (workspaceView !== 'Tasks') {
    return (
      <>
        <ScrollView
          style={styles.appFrame}
          contentContainerStyle={contentStyle}
          contentInsetAdjustmentBehavior="automatic"
        >
          {taskControls}
          <MobileSchedulePlanning
            items={workspaceScheduleItems}
            view={workspaceView}
            onOpenTask={item => setPlanningTaskId(item.id)}
          />
        </ScrollView>
        {taskEditor}
        {planningTaskEditor}
      </>
    );
  }

  if (isWideWorkspace) {
    return (
      <>
        <ScheduleWideWorkspace
          items={filteredItems}
          selectedTaskId={selectedAreaSummary ? null : selectedTask?.id || null}
          selectedAreaKey={selectedAreaKey}
          onSelectTask={taskId => {
            setSelectedTaskId(taskId);
            setSelectedAreaKey(null);
          }}
          onSelectArea={section => {
            setSelectedTaskId(null);
            setSelectedAreaKey(scheduleWorkspaceAreaKey(section));
          }}
          masterHeader={(
            <>
              {taskControls}
              <Text style={styles.sectionLabel}>{taskViewLabel}</Text>
              <Text style={styles.rowSub}>
                {filteredItems.length} {pluralWord(filteredItems.length, 'task')} in this view.
              </Text>
            </>
          )}
          inspector={selectedTask && !selectedAreaSummary ? (
            // One row per task: a reused row carried a typed Owner onto the
            // next task picked (audit A2 M3). An area header shows its summary (A2 pass 2 L3).
            <ScheduleItemRow
              key={selectedTask.id}
              item={selectedTask}
              scheduleItems={scheduleItems}
              projectAreas={projectAreas}
              dependencyNode={dependencyNodeByItemId.get(selectedTask.id) || null}
              fieldWarnings={scheduleFieldResults.warnings.get(selectedTask.id) || []}
              expanded
              activityAuthor={defaultOwner}
              onUpdate={(next, workflowRequest) =>
                onUpdate(selectedTask.id, next, workflowRequest)}
              onSave={() => onSave(selectedTask.id)}
              onDelete={() => onDelete(selectedTask.id)}
              onAddFieldUpdate={() => onNewFieldUpdateForTask(selectedTask)}
            />
          ) : selectedAreaSummary ? (
            <ScheduleTaskAreaSummaryPanel
              summary={selectedAreaSummary}
              onOpenTask={taskId => {
                setSelectedTaskId(taskId);
                setSelectedAreaKey(null);
              }}
            />
          ) : emptyState}
          inspectorFooter={taskView === 'Open Tasks' ? scheduleTools : null}
          emptyState={emptyState}
        />
        {taskEditor}
      </>
    );
  }

  return (
    <>
      <SectionList
        style={styles.appFrame}
        contentContainerStyle={contentStyle}
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        initialNumToRender={12} maxToRenderPerBatch={Platform.OS === 'ios' ? 16 : 12} windowSize={Platform.OS === 'ios' ? 21 : 7} removeClippedSubviews={Platform.OS === 'android'}
        sections={mobileTaskSections}
        keyExtractor={item => item.id}
        renderItem={({ item }) => (
          <ScheduleItemRow
            item={item}
            scheduleItems={scheduleItems}
            projectAreas={projectAreas}
            dependencyNode={dependencyNodeByItemId.get(item.id) || null}
            fieldWarnings={scheduleFieldResults.warnings.get(item.id) || []}
            activityAuthor={defaultOwner}
            onUpdate={(next, workflowRequest) =>
              onUpdate(item.id, next, workflowRequest)}
            onSave={() => onSave(item.id)}
            onDelete={() => onDelete(item.id)}
            onAddFieldUpdate={() => onNewFieldUpdateForTask(item)}
          />
        )}
        renderSectionHeader={({ section }) => (
          <ScheduleTaskGroupHeader
            section={section}
            collapsed={section.collapsed}
            selected={section.areaKey === selectedAreaKey}
            taskCount={section.areaTaskCount}
            summary={section.areaKey === selectedAreaKey
              ? taskAreaSummaries.get(section.areaKey) || null
              : null}
            onPress={() => {
              setSelectedAreaKey(current => current === section.areaKey ? null : section.areaKey);
              setCollapsedMobileTaskAreas(current => {
                const next = new Set(current);
                if (next.has(section.areaKey)) next.delete(section.areaKey);
                else next.add(section.areaKey);
                return next;
              });
            }}
          />
        )}
        ListHeaderComponent={(
          <>
            {taskControls}
            {taskView === 'Open Tasks' ? scheduleTools : null}
            <Text style={styles.sectionLabel}>{taskViewLabel}</Text>
            <Text style={styles.rowSub}>
              {filteredItems.length} {pluralWord(filteredItems.length, 'task')} in this view.
            </Text>
          </>
        )}
        ListEmptyComponent={emptyState}
        stickySectionHeadersEnabled={false}
        keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
      />
      {taskEditor}
    </>
  );
}

function ScheduleItemRow({
  item,
  scheduleItems = [],
  projectAreas = [],
  dependencyNode,
  fieldWarnings,
  expanded: expandedOverride,
  activityAuthor,
  onUpdate,
  onSave,
  onDelete,
  onAddFieldUpdate,
}: {
  item: ScheduleItem;
  scheduleItems?: ScheduleItem[];
  projectAreas?: ProjectArea[];
  dependencyNode?: PIEScheduleDependencyNode | null;
  fieldWarnings?: PIEScheduleReconciliationWarning[];
  expanded?: boolean;
  activityAuthor?: string;
  onUpdate: (
    next: Partial<ScheduleItem>,
    workflowRequest?: ProjectItemWorkflowMutationRequest,
  ) => void;
  onSave?: () => Promise<boolean>;
  onDelete: () => void;
  onAddFieldUpdate?: () => void;
}) {
  const [internalExpanded, setInternalExpanded] = useState(false);
  const [areaSheetOpen, setAreaSheetOpen] = useState(false);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'synced' | 'pending'>('idle');
  // Staged by task id until Save: it survives a task switch, a collapse or a tab switch (audit A5).
  const [progressDraft, setProgressDraft] = useScheduleProgressDraft(item.id, reconcileScheduleProgress(item.status, item.percentComplete));
  const saveAttemptRef = useRef(0);
  const progressDraftDirty =
    progressDraft.status !== item.status ||
    progressDraft.percentComplete !== item.percentComplete;
  const displayedItem: ScheduleItem = progressDraftDirty
    ? { ...item, ...progressDraft }
    : item;
  const expanded = expandedOverride ?? internalExpanded;
  const toggleExpanded = () => {
    if (expandedOverride === undefined) { // Lets a focused field save first (audit A2 pass 3 M1).
      afterTextInputBlur(() => setInternalExpanded(current => !current));
    }
  };
  const [verificationNote, setVerificationNote] = useState('');
  const normalizedItemType = normalizeProjectItemType(item.itemType);
  const isStructuredProjectItem = normalizedItemType !== 'Task';
  const isStructuredProjectItemClosed =
    isStructuredProjectItem &&
    projectItemWorkflowIsClosed(
      item as unknown as import('./types').ScheduleItem,
    );
  const needsCompletionVerification = scheduleItemNeedsCompletionVerification(
    item as unknown as import('./types').ScheduleItem,
  );
  const completionVerificationLabel = scheduleCompletionVerificationLabel(
    item as unknown as import('./types').ScheduleItem,
  );
  const days = daysUntilScheduleItem(displayedItem);
  const itemComplete = scheduleTaskIsComplete(displayedItem);
  const committedItemComplete = scheduleTaskIsComplete(item);
  const isOverdue = days !== null && days < 0 && !itemComplete;
  const isDueSoon = days !== null && days >= 0 && days <= 7 && !itemComplete;
  const timingStatus = itemComplete
    ? displayedItem.finishDate
      ? `Completed · Finish date ${formatAppDate(displayedItem.finishDate)}`
      : 'Completed'
    : displayedItem.finishDate
      ? dueStatusText(displayedItem.finishDate, displayedItem.projectTimeZone || DEFAULT_PROJECT_TIME_ZONE)
      : 'No finish date';
  const compactStartDateLabel = displayedItem.startDate?.trim()
    ? formatCompactAppDate(displayedItem.startDate)
    : null;
  const compactFinishDateLabel = displayedItem.finishDate?.trim()
    ? formatCompactAppDate(displayedItem.finishDate)
    : null;
  const compactScheduleDateLabel = [
    compactStartDateLabel ? `Start ${compactStartDateLabel}` : null,
    compactFinishDateLabel
      ? `${itemComplete ? 'Finished' : 'Due'} ${compactFinishDateLabel}`
      : null,
  ]
    .filter((label): label is string => Boolean(label))
    .join(' • ');
  const priorityColor = item.priority === 'High' ? colors.danger : item.priority === 'Low' ? colors.success : colors.warning;
  const statusColor = itemComplete ? colors.success : displayedItem.status === 'In Progress' ? colors.warning : displayedItem.status === 'Waiting' ? colors.muted : colors.primary;
  const blockerNames = (dependencyNode?.blockingPredecessorIds || []).map(blockerId =>
    scheduleItems.find(candidate => candidate.id === blockerId)?.taskName || blockerId,
  );
  const fieldWarning = fieldWarnings?.find(scheduleWarningIsUserActionable) || null;
  const itemProjectAreas = projectAreasForProject({
    projectAreas,
    projectName: item.scheduleProjectName?.trim() || item.projectName,
    scheduleItems,
  });
  const selectedArea = itemProjectAreas.find(area => area.name.trim().toLowerCase() === item.locationName.trim().toLowerCase()) || null;

  function stageProgressEdit(next: {
    status?: ScheduleItem['status'];
    percentComplete?: number;
  }) {
    setProgressDraft(current => reconcileScheduleProgressEdit(current, next));
    setSaveState('idle');
  }

  async function saveTaskChanges() {
    if (!onSave || saveState === 'saving') return;
    const attempt = saveAttemptRef.current + 1;
    saveAttemptRef.current = attempt;
    setSaveState('saving');
    const pendingTimer = setTimeout(() => {
      if (saveAttemptRef.current === attempt) {
        setSaveState('pending');
      }
    }, 12000);
    try {
      if (progressDraftDirty) {
        onUpdate(progressDraft);
      }
      const synced = await onSave();
      if (saveAttemptRef.current === attempt) {
        setSaveState(synced ? 'synced' : 'pending');
      }
    } catch {
      if (saveAttemptRef.current === attempt) {
        setSaveState('pending');
      }
    } finally {
      clearTimeout(pendingTimer);
    }
  }

  return (
    <View style={[styles.savedRow, styles.scheduleItemCard]}>
      <View style={styles.scheduleItemHeader}>
        <TouchableOpacity
          style={styles.rowIconBubble}
          onPress={toggleExpanded}
          accessibilityRole="button"
          accessibilityLabel={`Open ${item.taskName}`}
        >
          <Ionicons
            name={isOverdue ? 'alert-circle-outline' : isDueSoon ? 'time-outline' : 'calendar-outline'}
            size={20}
            color={isOverdue ? colors.danger : isDueSoon ? colors.warning : colors.primary}
          />
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.rowMain, styles.scheduleItemHeaderText]}
          onPress={toggleExpanded}
        >
          <Text style={[styles.projectName, styles.scheduleItemTitle]}>{item.taskName}</Text>
          <Text style={[styles.rowSub, styles.scheduleItemContext]}>
            {item.projectName || 'No project'}{item.locationName ? ` • ${item.locationName}` : ''}
          </Text>
          <Text style={[styles.rowSub, styles.scheduleItemContext]}>
            {timingStatus}{item.contractor ? ` • ${item.contractor}` : ''}
          </Text>
          {compactScheduleDateLabel ? (
            <Text
              style={[styles.rowSub, styles.scheduleItemContext]}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.88}
              accessibilityLabel={compactScheduleDateLabel}
            >
              {compactScheduleDateLabel}
            </Text>
          ) : null}
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.iconOnlyDangerButton}
          onPress={onDelete}
          accessibilityRole="button"
          accessibilityLabel={`Delete ${item.taskName}`}
        >
          <Ionicons name="trash-outline" size={19} color={colors.danger} />
        </TouchableOpacity>
      </View>
      <TouchableOpacity
        style={styles.scheduleItemBody}
        onPress={toggleExpanded}
      >
        <View style={styles.scheduleMetaRow}>
          <ProjectItemTypeBadge item={item} />
          <View style={[styles.statusPill, { backgroundColor: `${statusColor}1A` }]}>
            <Text style={[styles.statusPillText, { color: statusColor }]}>{displayedItem.status}</Text>
          </View>
          <View style={[styles.statusPill, { backgroundColor: `${priorityColor}1A` }]}>
            <Text style={[styles.statusPillText, { color: priorityColor }]}>{item.priority}</Text>
          </View>
          <Text style={styles.percentText}>{displayedItem.percentComplete}%{progressDraftDirty ? ' · Unsaved' : ''}</Text>
        </View>
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${displayedItem.percentComplete}%` }]} />
        </View>
        <ProjectItemNextAction item={item} />
        {completionVerificationLabel ? (
          <View style={styles.scheduleVerificationCard}>
            <View style={styles.areaStatusLine}>
              <Ionicons
                name={needsCompletionVerification ? 'help-circle-outline' : 'checkmark-circle-outline'}
                size={19}
                color={needsCompletionVerification ? colors.warning : colors.success}
              />
              <Text style={styles.scheduleVerificationTitle}>{completionVerificationLabel}</Text>
            </View>
            <Text style={styles.scheduleVerificationText}>
              {needsCompletionVerification
                ? 'A message or email reported this work complete. The schedule remains unchanged until you verify it.'
                : item.completionVerification?.verificationNote || 'The project manager reviewed this completion report.'}
            </Text>
          </View>
        ) : null}
        {dependencyNode && (
          dependencyNode.blocked ||
          dependencyNode.unresolvedPredecessors.length > 0
        ) ? (
          <View style={styles.scheduleFieldEvidenceCard}>
            <View style={styles.areaStatusLine}>
              <Ionicons
                name={dependencyNode.cycle ? 'warning-outline' : 'git-branch-outline'}
                size={18}
                color={dependencyNode.cycle ? colors.danger : colors.warning}
              />
              <Text style={styles.scheduleFieldEvidenceTitle}>Dependency Check</Text>
            </View>
            {dependencyNode.blockedReason ? (
              <Text style={styles.scheduleFieldEvidenceText}>{dependencyNode.blockedReason}</Text>
            ) : null}
            {blockerNames.length > 0 ? (
              <Text style={styles.scheduleFieldEvidenceAction}>
                Waiting on: {blockerNames.join(', ')}
              </Text>
            ) : null}
            {dependencyNode.unresolvedPredecessors.length > 0 ? (
              <Text style={styles.scheduleFieldEvidenceAction}>
                Map predecessor: {dependencyNode.unresolvedPredecessors.join(', ')}
              </Text>
            ) : null}
          </View>
        ) : null}
        {fieldWarning ? (
          <View style={styles.scheduleFieldEvidenceCard}>
            <Text style={styles.scheduleFieldEvidenceTitle}>Schedule Alert</Text>
            <Text style={styles.scheduleFieldEvidenceText}>
              {fieldWarning.summary}
            </Text>
            <Text style={styles.scheduleFieldEvidenceAction}>
              {fieldWarning.suggestedAction}
            </Text>
            {!expanded ? (
              <Text style={styles.scheduleFieldEvidenceAction}>
                Tap this task to review its status and corrective actions.
              </Text>
            ) : null}
          </View>
        ) : null}
        {expanded ? (
          <View style={styles.areaManagerCard}>
            <AreaRow areaName={selectedArea?.name || item.locationName || 'Unassigned / Unknown Area'} onChange={() => setAreaSheetOpen(true)} />
            {fieldWarning ? (
              <View style={styles.scheduleVerificationActions}>
                <Text style={styles.panelTitle}>Resolve schedule alert</Text>
                <Text style={styles.rowSub}>
                  Correct the status or percentage below, add a verification update, or confirm that the current schedule status is still accurate.
                </Text>
                <SecondaryButton
                  label="Confirm Current Schedule Status"
                  icon="checkmark-circle-outline"
                  onPress={() => onUpdate({
                    progressSource: 'project_manager',
                    progressConfirmedAt: new Date().toISOString(),
                    progressConfirmedBy: activityAuthor || 'Project manager',
                  })}
                />
              </View>
            ) : null}
            {needsCompletionVerification && !isStructuredProjectItem ? (
              <View style={styles.scheduleVerificationActions}>
                <Text style={styles.panelTitle}>Verify completion</Text>
                <Text style={styles.rowSub}>
                  Confirm only if you have seen the completed work or have reliable supporting evidence.
                </Text>
                <TextInput
                  style={[styles.input, styles.notesInput]}
                  value={verificationNote}
                  onChangeText={setVerificationNote}
                  placeholder="Optional verification note"
                  placeholderTextColor={colors.muted}
                  multiline
                  inputAccessoryViewID="vitruvius-keyboard-done"
                />
                <PrimaryButton
                  label="Confirm Completed"
                  icon="checkmark-circle-outline"
                  onPress={() => {
                    const verified = verifyScheduleItemCompletion(
                      item as unknown as import('./types').ScheduleItem,
                      {
                        verifiedAt: new Date().toISOString(),
                        verifiedBy: 'Project manager',
                        note: verificationNote,
                      },
                    );
                    onUpdate(verified as unknown as Partial<ScheduleItem>);
                    setVerificationNote('');
                  }}
                />
                {onAddFieldUpdate ? (
                  <SecondaryButton
                    label="Capture Verification Photo"
                    icon="camera-outline"
                    onPress={onAddFieldUpdate}
                  />
                ) : null}
                <SecondaryButton
                  label="Not Complete"
                  icon="close-circle-outline"
                  onPress={() => {
                    const rejected = rejectScheduleItemCompletion(
                      item as unknown as import('./types').ScheduleItem,
                      {
                        rejectedAt: new Date().toISOString(),
                        rejectedBy: 'Project manager',
                        note: verificationNote,
                      },
                    );
                    onUpdate(rejected as unknown as Partial<ScheduleItem>);
                    setVerificationNote('');
                  }}
                />
              </View>
            ) : null}
            {onAddFieldUpdate && (!needsCompletionVerification || isStructuredProjectItem) ? (
              <PrimaryButton
                label="Add Field Update"
                icon="camera-outline"
                onPress={onAddFieldUpdate}
              />
            ) : null}
            <NativeDateField
              label="Start Date"
              value={item.startDate}
              onChange={startDate => onUpdate({ startDate })}
              testID={`schedule-start-date-${item.id}`}
            />
            <NativeDateField
              label="Finish / Due Date"
              value={item.finishDate}
              onChange={finishDate => onUpdate({ finishDate })}
              testID={`schedule-finish-date-${item.id}`}
            />
            <ScheduleCommittedTextField
              label="Owner"
              value={item.owner}
              placeholder="PLZ owner / internal owner"
              onCommit={owner => onUpdate({ owner })}
              labelStyle={styles.label}
              inputStyle={styles.input}
              mutedColor={colors.muted}
            />

            <ScheduleCommittedTextField
              label="Contractor"
              value={item.contractor}
              placeholder="Contractor / responsible company"
              onCommit={contractor => onUpdate({ contractor })}
              labelStyle={styles.label}
              inputStyle={styles.input}
              mutedColor={colors.muted}
            />

            <ScheduleCommittedPercentField
              value={displayedItem.percentComplete}
              maximum={isStructuredProjectItem ? 99 : 100}
              disabled={isStructuredProjectItemClosed}
              onCommit={percentComplete => stageProgressEdit({ percentComplete })}
              labelStyle={styles.label}
              inputStyle={styles.input}
              mutedColor={colors.muted}
            />

            <Text style={styles.label}>Priority</Text>
            <View style={styles.statusGrid}>
              {SCHEDULE_PRIORITIES.map(priority => (
                <TouchableOpacity
                  key={priority}
                  style={[
                    styles.statusButton,
                    item.priority === priority && styles.statusButtonActive,
                  ]}
                  onPress={() => onUpdate({ priority })}
                >
                  <Text
                    style={[
                      styles.statusButtonText,
                      item.priority === priority && styles.statusButtonTextActive,
                    ]}
                  >
                    {priority}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.label}>Status</Text>
            <Text style={styles.rowSub}>
              Percentage sets the normal status automatically: 0% is Not Started, 1–99% is In Progress, and 100% is Complete. Choose Waiting only when work is on hold.
            </Text>
            <View style={styles.statusGrid}>
              {SCHEDULE_STATUSES.map(status => {
                const directStatusChangeDisabled =
                  isStructuredProjectItem &&
                  (isStructuredProjectItemClosed || status === 'Complete');
                return (
                  <TouchableOpacity
                    key={status}
                    style={[
                      styles.statusButton,
                      displayedItem.status === status && styles.statusButtonActive,
                      directStatusChangeDisabled && { opacity: 0.55 },
                    ]}
                    onPress={() => stageProgressEdit({ status })}
                    disabled={directStatusChangeDisabled}
                  >
                    <Text
                      style={[
                        styles.statusButtonText,
                        displayedItem.status === status && styles.statusButtonTextActive,
                      ]}
                    >
                      {status}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            {isStructuredProjectItem ? (
              <Text style={styles.rowSub}>
                {isStructuredProjectItemClosed
                  ? `Use the structured workflow below to reopen this ${normalizedItemType}.`
                  : `Use the structured workflow below to close this ${normalizedItemType}.`}
              </Text>
            ) : null}

            <ProjectItemDetailsEditor item={item} activityAuthor={activityAuthor} onUpdate={onUpdate} />
            {onSave ? (
              <>
                <PrimaryButton
                  label={
                    saveState === 'saving'
                      ? 'Saving Task Changes…'
                      : saveState === 'synced'
                        ? 'Task Saved and Synced'
                        : saveState === 'pending'
                          ? 'Saved on Device — Retry Sync'
                          : 'Save Task Changes'
                  }
                  icon={
                    saveState === 'synced'
                      ? 'checkmark-circle-outline'
                      : saveState === 'pending'
                        ? 'cloud-offline-outline'
                        : 'save-outline'
                  }
                  onPress={() => {
                    void saveTaskChanges();
                  }}
                  disabled={saveState === 'saving'}
                />
                <Text style={styles.rowSub}>
                  Save confirms the percentage, status, owner, area, and notes, then checks that the cloud accepted this exact task revision.
                </Text>
              </>
            ) : null}
            <AreaSelectionSheet visible={areaSheetOpen} projectAreas={itemProjectAreas}
              suggestedArea={selectedArea} selectedAreaId={selectedArea?.id || null}
              onSelect={areaId => {
                const area = itemProjectAreas.find(candidate => candidate.id === areaId) || null;
                onUpdate({ locationName: area?.name || '' });
                setAreaSheetOpen(false);
              }} onClose={() => setAreaSheetOpen(false)} />
          </View>
        ) : null}
      </TouchableOpacity>
      {committedItemComplete && onAddFieldUpdate && !expanded ? (
        <View style={{ paddingHorizontal: 12, paddingBottom: 12 }}>
          <SecondaryButton
            label="Add Photo or Note"
            icon="camera-outline"
            onPress={onAddFieldUpdate}
          />
        </View>
      ) : null}
    </View>
  );
}

function scheduleWarningIsUserActionable(warning: PIEScheduleReconciliationWarning) {
  return warning.type === 'schedule_status_conflict' ||
    warning.type === 'field_progress_not_reflected' ||
    warning.type === 'field_issue_threatens_schedule';
}

function ProjectDashboardCard({
  project,
  stats,
  actionLabel = 'Update',
  onPress,
  onClose,
}: {
  project: string;
  stats: ProjectStats;
  actionLabel?: string;
  onPress: () => void;
  onClose?: () => void;
}) {
  return (
    <View style={styles.dashboardCard}>
      <TouchableOpacity onPress={onPress}>
        <View style={styles.dashboardHeader}>
          <View style={styles.rowIconBubble}>
            <Ionicons
              name="business-outline"
              size={20}
              color={colors.primary}
            />
          </View>

          <View style={styles.rowMain}>
            <Text style={styles.projectName}>
              {project}
            </Text>

            <Text style={styles.rowSub}>
              Last update:{' '}
              {stats.lastUpdate
                ? formatDisplayDate(
                    stats.lastUpdate,
                  )
                : 'None yet'}
            </Text>
          </View>
        </View>

        <View style={styles.statsGrid}>
          <MiniStat
            label="Open Entries"
            value={stats.openActions}
          />

          <MiniStat
            label="Overdue"
            value={stats.overdueActions}
            danger={stats.overdueActions > 0}
          />

          <MiniStat
            label="Due 7 Days"
            value={stats.dueThisWeek}
          />

          <MiniStat
            label="Photos"
            value={stats.photos}
          />
        </View>
      </TouchableOpacity>

      <View style={styles.cardActions}>
        <TouchableOpacity
          style={styles.smallAction}
          onPress={onPress}
        >
          <Text style={styles.smallActionText}>
            {actionLabel}
          </Text>
        </TouchableOpacity>

        {onClose ? (
          <TouchableOpacity
            style={[
              styles.smallAction,
              styles.smallActionDanger,
            ]}
            onPress={onClose}
          >
            <Text
              style={
                styles.smallActionDangerText
              }
            >
              Close
            </Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  );
}

function AddProjectCard({
  buttonLabel,
  placeholder,
  onAdd,
}: {
  buttonLabel: string;
  placeholder: string;
  onAdd: (projectName: string) => boolean;
}) {
  const [projectName, setProjectName] =
    useState('');

  function submit() {
    const added = onAdd(projectName);

    if (added) setProjectName('');
  }

  return (
    <View style={styles.addProjectCard}>
      <Text style={styles.panelTitle}>
        Add project manually
      </Text>

      <TextInput
        style={styles.input}
        value={projectName}
        onChangeText={setProjectName}
        placeholder={placeholder}
        placeholderTextColor={colors.muted}
      />

      <PrimaryButton
        label={buttonLabel}
        icon="checkmark-circle-outline"
        onPress={submit}
        disabled={!projectName.trim()}
      />
    </View>
  );
}

function DraftSavedIndicator({
  savedAt,
}: {
  savedAt: string | null;
}) {
  if (!savedAt) return null;

  return (
    <View style={styles.draftSavedIndicator}>
      <Ionicons
        name="cloud-done-outline"
        size={16}
        color={colors.success}
      />

      <Text style={styles.draftSavedText}>
        Draft saved automatically at{' '}
        {formatSavedTime(savedAt)}
      </Text>
    </View>
  );
}

function ScreenTitle({
  title,
  subtitle,
  actionIcon,
  onActionPress,
  actionAccessibilityLabel,
}: {
  title: string;
  subtitle: string;
  actionIcon?: IconName;
  onActionPress?: () => void;
  actionAccessibilityLabel?: string;
}) {
  return (
    <View style={styles.screenTitleRow}>
      <View style={styles.screenTitle}>
        <Text style={styles.title}>
          {title}
        </Text>

        <Text style={styles.subtitle}>
          {subtitle}
        </Text>
      </View>

      {actionIcon && onActionPress ? (
        <TouchableOpacity
          style={styles.screenTitleActionButton}
          onPress={onActionPress}
          accessibilityLabel={actionAccessibilityLabel}
          hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
        >
          <Ionicons name={actionIcon} size={22} color={colors.primary} />
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

function PrimaryButton({
  label,
  icon,
  onPress,
  disabled,
  compact,
}: {
  label: string;
  icon?: IconName;
  onPress: () => void;
  disabled?: boolean;
  compact?: boolean;
}) {
  return (
    <TouchableOpacity
      style={[
        styles.primaryButton,
        compact && styles.compactButton,
        disabled && styles.disabledButton,
      ]}
      onPress={onPress}
      disabled={disabled}
    >
      <View style={styles.buttonContent}>
        {icon ? (
          <Ionicons
            name={icon}
            size={20}
            color="#FFFFFF"
          />
        ) : null}

        <Text
          style={styles.primaryButtonText}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.82}
        >
          {label}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

function SecondaryButton({
  label,
  icon,
  onPress,
  compact,
}: {
  label: string;
  icon?: IconName;
  onPress: () => void;
  compact?: boolean;
}) {
  return (
    <TouchableOpacity
      style={[
        styles.secondaryButton,
        compact && styles.compactButton,
      ]}
      onPress={onPress}
    >
      <View style={styles.buttonContent}>
        {icon ? (
          <Ionicons
            name={icon}
            size={20}
            color={colors.primary}
          />
        ) : null}

        <Text
          style={styles.secondaryButtonText}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.82}
        >
          {label}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

function ProgressStat({
  number,
  label,
}: {
  number: number;
  label: string;
}) {
  return (
    <View style={styles.progressStat}>
      <Text style={styles.progressNumber}>
        {number}
      </Text>

      <Text style={styles.progressText}>
        {label}
      </Text>
    </View>
  );
}

function MiniStat({
  label,
  value,
  danger = false,
}: {
  label: string;
  value: number;
  danger?: boolean;
}) {
  return (
    <View
      style={[
        styles.miniStat,
        danger && styles.miniStatDanger,
      ]}
    >
      <Text
        style={[
          styles.miniStatValue,
          danger && styles.miniStatValueDanger,
        ]}
      >
        {value}
      </Text>

      <Text style={styles.miniStatLabel}>
        {label}
      </Text>
    </View>
  );
}

function EmptyState({
  title,
  text,
}: {
  title: string;
  text: string;
}) {
  return (
    <View style={styles.emptyState}>
      <Text style={styles.emptyTitle}>
        {title}
      </Text>

      <Text style={styles.bodyText}>
        {text}
      </Text>
    </View>
  );
}

function statusStyleForRole(role: StatusStyleRole) {
  const config = STATUS_ICON_COLOR_MAP[role];
  const color =
    config.colorRole === 'insight'
      ? colors.insight
      : colors[config.colorRole];
  const backgroundColor =
    config.backgroundRole === 'insightSoft'
      ? colors.insightSoft
      : colors[config.backgroundRole];

  return {
    icon: config.icon,
    color,
    backgroundColor,
  };
}
