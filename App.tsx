import {
  deleteCloudProject,
  loadCloudProjectRecords,
  saveCloudProject,
  saveCloudProjectCoverPhoto,
} from './services/projectService';
import { loadCloudUpdates, saveCloudUpdate } from './services/updateService';
import {
  uploadLocalPhoto,
  uploadLocalPhotoWithDiagnostics,
  uploadPendingChanges,
  removeProjectUpdateFromSyncQueue,
  type MissingSyncPhoto,
  type PhotoStorageUploadFailureCategory,
  type SyncUploadResult,
} from './services/SyncService';
import {
  getCurrentSessionAccessToken,
  signIn,
  signUp,
  uploadPhoto,
} from './services/SupabaseService';
import { AdminScreen } from './screens/AdminScreen';
import { KeyboardAvoidingModalCard } from './components/KeyboardAvoidingModalCard';
import { DAVEAskExperience } from './components/DAVEAskExperience';
import { DAVECaptureConfirmationSheet } from './components/DAVECaptureConfirmationSheet';
import { DAVECaptureMemoryDetailSheet } from './components/DAVECaptureMemoryDetailSheet';
import { DAVETypedCaptureSheet } from './components/DAVETypedCaptureSheet';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import * as Contacts from 'expo-contacts';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as ImagePicker from 'expo-image-picker';
import { LinearGradient } from 'expo-linear-gradient';
import * as Location from 'expo-location';
import * as MailComposer from 'expo-mail-composer';
import * as Sharing from 'expo-sharing';
import * as SMS from 'expo-sms';
import { StatusBar } from 'expo-status-bar';
import {
  analyzeProjectPhotoWithVision,
  buildAnalyzingPhotoIntelligenceState,
  type PIEPhotoIntelligenceDisplayState,
} from './services/PIEPhotoVisionMobileWorkflow';
import {
  attentionCategoryForPhotoCategory,
  buildStableAttentionItemId,
  dedupeAttentionItemsById,
} from './services/PIEAttentionIdentity';
import {
  type DAVEBriefNavigationTarget,
  type DAVEProjectDailyBriefAttentionItem,
  type DAVEProjectDailyBriefItem,
} from './services/DAVEDailyBrief';
import { buildProjectIntelligence } from './services/DAVEIntelligence';
import {
  createCaptureMemory,
  type DAVECaptureMemory,
  type DAVEConfirmedCaptureMemory,
} from './services/DAVECaptureMemory';
import { localDAVECaptureMemoryRepository } from './services/DAVECaptureMemoryRepository';
import {
  cacheSelectedProjectCoverPhoto,
  coverPhotoForProject,
  hydrateProjectCoverPhotoCache,
  mergeProjectRecords,
  normalizeProjectRecords,
  removeCachedProjectCoverPhoto,
  resolveProjectCoverPhotoUri,
  type ProjectCoverPhoto,
  type ProjectRecord,
} from './services/ProjectCoverPhotoService';
import {
  buildSixtySecondFlowTimingResult,
  type SixtySecondFlowTimingResult,
} from './services/SixtySecondFlowInstrumentation';
import {
  PIELiveAuthorityProvider,
  type PIELiveAuthorityInput,
} from './providers/PIELiveAuthorityProvider';
import {
  buildLayer4DecisionCandidateFromExecutiveJudgment,
} from './services/PIELayer4Automation';
import type {
  PIEActor,
  PIEDecisionRecord,
  PIEEvidenceReference,
} from './services/PIEDecisionLedger';
import type { PIEExecutiveJudgmentRecord } from './services/PIEExecutiveJudgmentRepository';
import type { ReactNode } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  AppState,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Linking,
  Modal,
  PanResponder,
  Platform,
  ScrollView,
  StyleProp,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  ViewStyle,
} from 'react-native';
import {
  SafeAreaProvider,
  SafeAreaView,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';

type Screen =
  | 'Home'
  | 'SelectProject'
  | 'AddPhotos'
  | 'PIEAnalysis'
  | 'BuildUpdate'
  | 'Projects'
  | 'ProjectWorkspace'
  | 'SavedUpdates'
  | 'UpdateDetail'
  | 'Contacts'
  | 'Diagnostics'
  | 'ReferenceDocuments'
  | 'ProjectDocuments'
  | 'Schedule'
  | 'Upcoming'
  | 'Admin';

type IconName = keyof typeof Ionicons.glyphMap;

type PhotoCategory =
  | 'Open Issue'
  | 'Safety Concern'
  | 'Update';

type ActionStatus =
  | 'Open'
  | 'In Progress'
  | 'Waiting'
  | 'Closed';

type UpdatePhoto = {
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
  photoIntelligence?: PIEPhotoIntelligenceDisplayState | null;
};

type ProjectUpdate = {
  id: string;
  projectName: string;
  date: string;
  photos: UpdatePhoto[];
  documents?: FieldUpdateDocument[];
  notes: string;
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

type FieldUpdateStatus =
  | 'draft'
  | 'ready_to_send'
  | 'queued'
  | 'sent'
  | 'failed';

type FieldUpdateSyncFailureCategory =
  | 'offline'
  | 'signed_out'
  | 'auth'
  | 'rls_denied'
  | 'storage_upload_failed'
  | 'database_insert_failed'
  | 'malformed_payload'
  | 'unknown';

type FieldUpdateSyncStepResult = 'success' | 'failed' | 'skipped';

type FieldUpdateSyncDiagnostics = {
  networkState: 'online' | 'offline' | 'unknown';
  connectionType: 'wifi' | 'cellular' | 'none' | 'unknown';
  sessionTokenPresent: boolean | null;
  lastSyncAttemptAt: string | null;
  lastSyncResult: 'success' | 'failed' | 'skipped' | null;
  lastSyncFailureCategory: FieldUpdateSyncFailureCategory | null;
  cloudUpdateInsertAttempted: boolean;
  photoStorageUploadAttempted: boolean;
  storageUploadResult: FieldUpdateSyncStepResult;
  databaseUpsertResult: FieldUpdateSyncStepResult;
  rlsOrAuthFailureDetected: boolean;
  retryAvailable: boolean;
  storageBucketName: string | null;
  storageBucketExists: 'yes' | 'no' | 'unknown';
  storageFailureCategory: PhotoStorageUploadFailureCategory | null;
  storageHttpStatus: number | null;
  storageErrorCode: string | null;
  retryAttemptNumber: number | null;
  localFileExists: boolean | null;
  localFileReadable: boolean | null;
  fileByteSizeCategory: 'zero' | 'nonzero' | 'unknown';
  uploadPayloadType: 'ArrayBuffer' | 'Blob' | 'base64' | 'unknown';
  storageContentType: string | null;
  objectPathCategory: string | null;
  databaseSyncRanAfterUpload: boolean | null;
  failedOperationName: string | null;
  failedLogicalTarget: string | null;
  rlsDenied: boolean;
  authenticatedUserIdPresent: boolean | null;
  projectIdPresent: boolean | null;
  organizationIdPresent: boolean | null;
  membershipCheckResult:
    | 'present'
    | 'missing_or_denied'
    | 'not_checked'
    | 'unavailable'
    | null;
  queuedUpdateCount: number;
  projectRollupsIncludeQueuedUpdates: boolean;
  projectCardWorkspaceSameSource: boolean;
};

type FieldUpdateDeleteDiagnostics = {
  updateId: string;
  localId: string;
  cloudIdPresent: boolean;
  lifecycleStatus: FieldUpdateStatus;
  pendingSync: boolean;
  tombstoned: boolean;
  deletedAt: string | null;
  sourceAfterReload: 'local' | 'cloud' | 'pending' | 'orphaned-photo' | 'unknown';
  mergeDecision: 'included' | 'excluded' | 'tombstoned';
  orphanedPhotoCountIgnored: number;
};

type DeletedUpdateTombstone = FieldUpdateDeleteDiagnostics & {
  action:
    | 'delete_failed_update'
    | 'remove_from_device'
    | 'archive_sent_update'
    | 'hide_cloud_update';
};

type FieldUpdatePIEStatus =
  | 'not_started'
  | 'analyzing'
  | 'complete'
  | 'no_prior_photo'
  | 'no_visual_comparison'
  | 'failed'
  | 'taking_longer';

type ProjectDocumentCategory =
  | 'Schedule'
  | 'Permit Card'
  | 'Drawing'
  | 'Scope'
  | 'Contract'
  | 'Inspection'
  | 'Safety'
  | 'Compliance'
  | 'RFI / Field Decision'
  | 'Vendor Document'
  | 'Other';

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
  storagePath?: string | null;
  uploadedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  note?: string | null;
  status: ProjectDocumentStatus;
  archivedAt?: string | null;
  isArchived?: boolean;
  duplicateOf?: string | null;
  uploadAttemptCount?: number;
  lastUploadAttemptAt?: string | null;
  importedAt: string;
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

type ProjectContact = {
  id: string;
  name: string;
  email: string;
  phone: string;
  emails?: string[];
  phones?: string[];
  selectedEmail?: string | null;
  selectedPhone?: string | null;
};

type ContactBook = {
  contacts: ProjectContact[];
};

type RecipientSelection = {
  contactIds: string[];
};

type ProjectArea = {
  id: string;
  name: string;
  building?: string;
  latitude: number;
  longitude: number;
  radiusFeet: number;
  locationCapturedAt?: string | null;
};

type LocationSnapshot = {
  latitude: number;
  longitude: number;
  accuracy: number | null;
  capturedAt: string;
};

type AreaSuggestion = {
  area: ProjectArea;
  distanceFeet: number;
  withinRadius: boolean;
};

type StoredDraft = {
  draft: ProjectUpdate;
  savedAt: string;
};

type ReferenceDocument = {
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

type OverviewProjectSelection = string | null | undefined;

type OverviewDetectionStatus =
  | 'checking'
  | 'detected'
  | 'denied'
  | 'multiple'
  | 'not_applied'
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

type AppBackup = {
  version: number;
  exportedAt: string;
  savedUpdates: ProjectUpdate[];
  projects: string[];
  archivedProjects: string[];
  contacts: ContactBook;
  projectAreas: ProjectArea[];
  referenceDocuments: ReferenceDocument[];
  projectDocuments: ProjectDocument[];
  scheduleItems: ScheduleItem[];
  activeDraft: StoredDraft | null;
};

type RestoredAppData = {
  savedUpdates: ProjectUpdate[];
  projects: string[];
  archivedProjects: string[];
  contactBook: ContactBook;
  projectAreas: ProjectArea[];
  referenceDocuments: ReferenceDocument[];
  projectDocuments: ProjectDocument[];
  scheduleItems: ScheduleItem[];
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
const ARCHIVED_PROJECTS_STORAGE_KEY = 'projectPhotoUpdate.archivedProjects.v2';
const CONTACTS_STORAGE_KEY = 'projectPhotoUpdate.contacts.v2';
const DRAFT_STORAGE_KEY = 'projectPhotoUpdate.activeDraft.v2';
const PROJECT_AREAS_STORAGE_KEY = 'projectPhotoUpdate.projectAreas.v1';
const REFERENCE_DOCUMENTS_STORAGE_KEY = 'projectPhotoUpdate.referenceDocuments.v1';
const PROJECT_DOCUMENTS_STORAGE_KEY = 'projectPhotoUpdate.projectDocuments.v1';
const SCHEDULE_ITEMS_STORAGE_KEY = 'projectPhotoUpdate.scheduleItems.v1';
const SCHEDULE_AI_EXTRACTOR_URL_STORAGE_KEY = 'projectPhotoUpdate.scheduleAiExtractorUrl.v1';
const DISPLAY_NAME_STORAGE_KEY = 'projectPhotoUpdate.displayName.v1';
const ANALYSIS_TIMEOUT_SECONDS = 60;
const PIE_ANALYSIS_PENDING_TIMEOUT_MS = ANALYSIS_TIMEOUT_SECONDS * 1000;
const GPS_CLEAR_WINNER_DISTANCE_FEET = 75;
const BACKUP_VERSION = 1;
const MAX_BACKUP_FILE_BYTES = 5 * 1024 * 1024;
const PHOTO_STORAGE_FOLDER = 'project-photos';
const PHOTO_STORAGE_DIR = FileSystem.documentDirectory
  ? `${FileSystem.documentDirectory}${PHOTO_STORAGE_FOLDER}/`
  : null;
const REFERENCE_DOCUMENTS_FOLDER = 'project-documents';
const REFERENCE_DOCUMENTS_DIR = FileSystem.documentDirectory
  ? `${FileSystem.documentDirectory}${REFERENCE_DOCUMENTS_FOLDER}/`
  : null;
const PROJECT_DOCUMENT_UPLOAD_FOLDER = 'project-documents';
const EMPTY_SELECTED_PROJECTS: Set<string> = new Set();
const LARGE_PROJECT_DOCUMENT_BYTES = 15 * 1024 * 1024;
const GPS_CAPTURE_ENABLED = true;

const DEFAULT_PROJECTS = [
  'Building 2375 Compliance',
  'Building 2321 Driveway',
  'H-2 Room',
  'Fire Pump House',
  'Tank Farm',
  'Racking Project',
];

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
  'Other',
];

const PROJECT_DOCUMENT_CATEGORIES: ProjectDocumentCategory[] = [
  'Schedule',
  'Permit Card',
  'Drawing',
  'Scope',
  'Contract',
  'Inspection',
  'Safety',
  'Compliance',
  'RFI / Field Decision',
  'Vendor Document',
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
  checking: 'DAVE checking photos…',
  preparingSecureAnalysis: 'Preparing secure photo analysis…',
  signInRequired: 'Sign in required for photo intelligence',
  sessionExpired: 'Session expired · Sign in again',
  possibleChanges: 'Possible visual changes found',
  noReliableChange: 'No reliable visual change',
  noPriorPhoto: 'No prior photo to compare',
  unavailableRetry: 'Analysis unavailable · Retry',
  timeoutRetry: 'Analysis taking longer than expected · Retry',
} as const;

const PIE_AUTH_HYDRATION_RETRY_COUNT = 3;
const PIE_AUTH_HYDRATION_RETRY_DELAY_MS = 750;
const DRAFT_LOCATION_CAPTURE_WAIT_MS = 1500;
const ENABLE_DEV_AUTH_SIGNUP =
  process.env.EXPO_PUBLIC_ENABLE_DEV_AUTH_SIGNUP === 'true';

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
const DEFAULT_PROJECT_AREAS: ProjectArea[] = [
  {
    id: 'area-building-2321',
    name: 'Building 2321',
    building: '2321',
    latitude: 37.3349,
    longitude: -122.009,
    radiusFeet: 250,
  },
  {
    id: 'area-building-2375',
    name: 'Building 2375',
    building: '2375',
    latitude: 37.3354,
    longitude: -122.0084,
    radiusFeet: 250,
  },
  {
    id: 'area-canopy-a',
    name: 'Canopy A',
    latitude: 37.335,
    longitude: -122.0078,
    radiusFeet: 175,
  },
  {
    id: 'area-canopy-b',
    name: 'Canopy B',
    latitude: 37.3346,
    longitude: -122.0074,
    radiusFeet: 175,
  },
  {
    id: 'area-canopy-c',
    name: 'Canopy C',
    latitude: 37.3342,
    longitude: -122.007,
    radiusFeet: 175,
  },
  {
    id: 'area-h2-room',
    name: 'H2 Room',
    building: 'H2',
    latitude: 37.3339,
    longitude: -122.0082,
    radiusFeet: 150,
  },
  {
    id: 'area-pump-house',
    name: 'Pump House',
    latitude: 37.3335,
    longitude: -122.0087,
    radiusFeet: 175,
  },
  {
    id: 'area-tank-farm',
    name: 'Tank Farm',
    latitude: 37.3331,
    longitude: -122.0092,
    radiusFeet: 300,
  },
  {
    id: 'area-wastewater',
    name: 'Wastewater Area',
    latitude: 37.3328,
    longitude: -122.0079,
    radiusFeet: 250,
  },
  {
    id: 'area-north-lot',
    name: 'North Lot',
    latitude: 37.336,
    longitude: -122.0088,
    radiusFeet: 400,
  },
  {
    id: 'area-east-driveway',
    name: 'East Driveway',
    latitude: 37.3347,
    longitude: -122.0065,
    radiusFeet: 300,
  },
  {
    id: 'area-other',
    name: 'Other',
    latitude: 37.3349,
    longitude: -122.008,
    radiusFeet: 100,
  },
];

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

const uid = () =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

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

  const dueDate = parseDueDate(photo.actionDueDate);

  if (!dueDate) return false;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return dueDate < today;
}

function isDueThisWeek(photo: UpdatePhoto) {
  if (!isOpenAction(photo)) return false;

  const dueDate = parseDueDate(photo.actionDueDate);

  if (!dueDate) return false;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const sevenDaysFromNow = new Date(today);
  sevenDaysFromNow.setDate(today.getDate() + 7);

  return dueDate >= today && dueDate <= sevenDaysFromNow;
}

function isDueTodayAction(photo: UpdatePhoto) {
  if (!isOpenAction(photo)) return false;

  const dueDate = parseDueDate(photo.actionDueDate);

  if (!dueDate) return false;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return dueDate.getTime() === today.getTime();
}

function mergeProjectNames(base: string[], ...sources: string[][]) {
  const names: string[] = [];

  [...sources.flat(), ...base].forEach(name => {
    const trimmed = typeof name === 'string' ? name.trim() : '';

    if (!trimmed) return;

    const exists = names.some(
      existing => existing.toLowerCase() === trimmed.toLowerCase(),
    );

    if (!exists) names.push(trimmed);
  });

  return names;
}

function optionalNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : null;
}

function optionalString(value: unknown) {
  return typeof value === 'string' && value.trim()
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
    uri: typeof photo.uri === 'string' ? photo.uri : '',
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
    selectedAreaId: optionalString(photo.selectedAreaId),
    selectedAreaName: optionalString(photo.selectedAreaName),
    gpsLatitude: optionalNumber(photo.gpsLatitude),
    gpsLongitude: optionalNumber(photo.gpsLongitude),
    gpsAccuracy: optionalNumber(photo.gpsAccuracy),
    distanceFromSelectedAreaFeet: optionalNumber(
      photo.distanceFromSelectedAreaFeet,
    ),
    locationCapturedAt: optionalString(photo.locationCapturedAt),
    photoIntelligence: photo.photoIntelligence || null,
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

  return {
    id: optionalString(value.id) || uid(),
    projectId,
    areaId: optionalString(value.areaId) || fallback?.areaId || null,
    updateId: optionalString(value.updateId) || fallback?.updateId || null,
    name,
    category: normalizeProjectDocumentCategory(value.category),
    mimeType: optionalString(value.mimeType),
    sizeBytes: optionalFiniteNumber(value.sizeBytes),
    localUri:
      optionalString(value.localUri) ||
      optionalString(value.uri) ||
      null,
    storagePath,
    uploadedAt,
    createdAt,
    updatedAt: optionalString(value.updatedAt) || createdAt,
    note: optionalString(value.note) || optionalString(value.notes),
    status: uploadedAt ? 'uploaded' : status,
    archivedAt: optionalString(value.archivedAt),
    isArchived: optionalBoolean(value.isArchived),
    duplicateOf: optionalString(value.duplicateOf),
    uploadAttemptCount: optionalFiniteNumber(value.uploadAttemptCount) || 0,
    lastUploadAttemptAt: optionalString(value.lastUploadAttemptAt),
    importedAt: optionalString(value.importedAt) || createdAt,
  };
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

function normalizeFieldUpdateSyncDiagnostics(value: unknown): FieldUpdateSyncDiagnostics | null {
  if (!isRecord(value)) return null;
  const failureCategory =
    value.lastSyncFailureCategory === 'offline' ||
    value.lastSyncFailureCategory === 'signed_out' ||
    value.lastSyncFailureCategory === 'auth' ||
    value.lastSyncFailureCategory === 'rls_denied' ||
    value.lastSyncFailureCategory === 'storage_upload_failed' ||
    value.lastSyncFailureCategory === 'database_insert_failed' ||
    value.lastSyncFailureCategory === 'malformed_payload' ||
    value.lastSyncFailureCategory === 'unknown'
      ? value.lastSyncFailureCategory
      : null;

  return {
    networkState:
      value.networkState === 'online' ||
      value.networkState === 'offline' ||
      value.networkState === 'unknown'
        ? value.networkState
        : 'unknown',
    connectionType:
      value.connectionType === 'wifi' ||
      value.connectionType === 'cellular' ||
      value.connectionType === 'none' ||
      value.connectionType === 'unknown'
        ? value.connectionType
        : 'unknown',
    sessionTokenPresent:
      typeof value.sessionTokenPresent === 'boolean'
        ? value.sessionTokenPresent
        : null,
    lastSyncAttemptAt: optionalString(value.lastSyncAttemptAt),
    lastSyncResult:
      value.lastSyncResult === 'success' ||
      value.lastSyncResult === 'failed' ||
      value.lastSyncResult === 'skipped'
        ? value.lastSyncResult
        : null,
    lastSyncFailureCategory: failureCategory,
    cloudUpdateInsertAttempted: value.cloudUpdateInsertAttempted === true,
    photoStorageUploadAttempted: value.photoStorageUploadAttempted === true,
    storageUploadResult:
      value.storageUploadResult === 'success' ||
      value.storageUploadResult === 'failed' ||
      value.storageUploadResult === 'skipped'
        ? value.storageUploadResult
        : 'skipped',
    databaseUpsertResult:
      value.databaseUpsertResult === 'success' ||
      value.databaseUpsertResult === 'failed' ||
      value.databaseUpsertResult === 'skipped'
        ? value.databaseUpsertResult
        : 'skipped',
    rlsOrAuthFailureDetected: value.rlsOrAuthFailureDetected === true,
    retryAvailable: value.retryAvailable !== false,
    storageBucketName: optionalString(value.storageBucketName),
    storageBucketExists:
      value.storageBucketExists === 'yes' ||
      value.storageBucketExists === 'no' ||
      value.storageBucketExists === 'unknown'
        ? value.storageBucketExists
        : 'unknown',
    storageFailureCategory:
      value.storageFailureCategory === 'bucket_missing' ||
      value.storageFailureCategory === 'rls_denied' ||
      value.storageFailureCategory === 'auth_missing' ||
      value.storageFailureCategory === 'invalid_path' ||
      value.storageFailureCategory === 'invalid_payload' ||
      value.storageFailureCategory === 'unsupported_content_type' ||
      value.storageFailureCategory === 'file_unreadable' ||
      value.storageFailureCategory === 'stale_local_uri' ||
      value.storageFailureCategory === 'network' ||
      value.storageFailureCategory === 'unknown_storage_error'
        ? value.storageFailureCategory
        : null,
    storageHttpStatus:
      typeof value.storageHttpStatus === 'number' &&
      Number.isFinite(value.storageHttpStatus)
        ? value.storageHttpStatus
        : null,
    storageErrorCode: optionalString(value.storageErrorCode),
    retryAttemptNumber:
      typeof value.retryAttemptNumber === 'number' &&
      Number.isFinite(value.retryAttemptNumber)
        ? value.retryAttemptNumber
        : null,
    localFileExists:
      typeof value.localFileExists === 'boolean'
        ? value.localFileExists
        : null,
    localFileReadable:
      typeof value.localFileReadable === 'boolean'
        ? value.localFileReadable
        : null,
    fileByteSizeCategory:
      value.fileByteSizeCategory === 'zero' ||
      value.fileByteSizeCategory === 'nonzero' ||
      value.fileByteSizeCategory === 'unknown'
        ? value.fileByteSizeCategory
        : 'unknown',
    uploadPayloadType:
      value.uploadPayloadType === 'ArrayBuffer' ||
      value.uploadPayloadType === 'Blob' ||
      value.uploadPayloadType === 'base64' ||
      value.uploadPayloadType === 'unknown'
        ? value.uploadPayloadType
        : 'unknown',
    storageContentType: optionalString(value.storageContentType),
    objectPathCategory: optionalString(value.objectPathCategory),
    databaseSyncRanAfterUpload:
      typeof value.databaseSyncRanAfterUpload === 'boolean'
        ? value.databaseSyncRanAfterUpload
        : null,
    failedOperationName: optionalString(value.failedOperationName),
    failedLogicalTarget: optionalString(value.failedLogicalTarget),
    rlsDenied: value.rlsDenied === true,
    authenticatedUserIdPresent:
      typeof value.authenticatedUserIdPresent === 'boolean'
        ? value.authenticatedUserIdPresent
        : null,
    projectIdPresent:
      typeof value.projectIdPresent === 'boolean'
        ? value.projectIdPresent
        : null,
    organizationIdPresent:
      typeof value.organizationIdPresent === 'boolean'
        ? value.organizationIdPresent
        : null,
    membershipCheckResult:
      value.membershipCheckResult === 'present' ||
      value.membershipCheckResult === 'missing_or_denied' ||
      value.membershipCheckResult === 'not_checked' ||
      value.membershipCheckResult === 'unavailable'
        ? value.membershipCheckResult
        : null,
    queuedUpdateCount:
      typeof value.queuedUpdateCount === 'number' &&
      Number.isFinite(value.queuedUpdateCount)
        ? value.queuedUpdateCount
        : 0,
    projectRollupsIncludeQueuedUpdates: value.projectRollupsIncludeQueuedUpdates !== false,
    projectCardWorkspaceSameSource: value.projectCardWorkspaceSameSource !== false,
  };
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

function normalizeUpdate(update: Partial<ProjectUpdate>): ProjectUpdate {
  const updateId = typeof update.id === 'string' ? update.id : uid();
  const projectName =
    typeof update.projectName === 'string'
      ? update.projectName
      : DEFAULT_PROJECTS[0];

  return {
    id: updateId,
    projectName,
    date: typeof update.date === 'string' ? update.date : isoToday(),
    photos: Array.isArray(update.photos)
      ? update.photos.map(normalizePhoto).filter(photo => photo.uri)
      : [],
    documents: normalizeFieldUpdateDocuments(update.documents, {
      projectId: authorityProjectId(projectName),
      areaId: optionalString(update.selectedAreaId),
      updateId,
    }),
    notes: typeof update.notes === 'string' ? update.notes : '',
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

function hasReachableContactInfo(contact: Contacts.ExistingContact) {
  return Boolean(contactEmails(contact).length || contactPhones(contact).length);
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

function normalizeProjectArea(value: Partial<ProjectArea>): ProjectArea {
  return {
    id: typeof value.id === 'string' ? value.id : uid(),
    name:
      typeof value.name === 'string' && value.name.trim()
        ? value.name.trim()
        : 'New Area',
    building:
      typeof value.building === 'string' && value.building.trim()
        ? value.building.trim()
        : undefined,
    latitude:
      typeof value.latitude === 'number' &&
      Number.isFinite(value.latitude)
        ? value.latitude
        : DEFAULT_PROJECT_AREAS[0].latitude,
    longitude:
      typeof value.longitude === 'number' &&
      Number.isFinite(value.longitude)
        ? value.longitude
        : DEFAULT_PROJECT_AREAS[0].longitude,
    radiusFeet:
      typeof value.radiusFeet === 'number' &&
      Number.isFinite(value.radiusFeet) &&
      value.radiusFeet > 0
        ? value.radiusFeet
        : 250,
    locationCapturedAt: optionalString(value.locationCapturedAt),
  };
}

function hasSavedAreaLocation(area: ProjectArea) {
  return Boolean(area.locationCapturedAt);
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

function mergeProjectAreas(saved: ProjectArea[]) {
  const areas: ProjectArea[] = [];

  [...saved, ...DEFAULT_PROJECT_AREAS].forEach(area => {
    const normalized = normalizeProjectArea(area);
    const exists = areas.some(
      existing => existing.id === normalized.id,
    );

    if (!exists) areas.push(normalized);
  });

  return areas;
}

function normalizeProjectAreas(value: unknown) {
  if (!Array.isArray(value)) return DEFAULT_PROJECT_AREAS;

  return mergeProjectAreas(
    value.map(item => normalizeProjectArea(item as Partial<ProjectArea>)),
  );
}


function normalizeReferenceDocument(value: Partial<ReferenceDocument>): ReferenceDocument {
  const category =
    typeof value.category === 'string' && value.category.trim()
      ? value.category.trim()
      : 'Other';

  return {
    id: typeof value.id === 'string' ? value.id : uid(),
    name:
      typeof value.name === 'string' && value.name.trim()
        ? value.name.trim()
        : typeof value.originalFileName === 'string' && value.originalFileName.trim()
          ? value.originalFileName.trim()
          : 'Reference Document',
    originalFileName:
      typeof value.originalFileName === 'string' && value.originalFileName.trim()
        ? value.originalFileName.trim()
        : 'reference-document',
    uri: typeof value.uri === 'string' ? value.uri : '',
    mimeType: optionalString(value.mimeType),
    category: REFERENCE_DOCUMENT_CATEGORIES.includes(category)
      ? category
      : 'Other',
    notes: typeof value.notes === 'string' ? value.notes : '',
    isCurrent: Boolean(value.isCurrent),
    importedAt:
      typeof value.importedAt === 'string'
        ? value.importedAt
        : new Date().toISOString(),
  };
}

function normalizeReferenceDocuments(value: unknown) {
  if (!Array.isArray(value)) return [];

  return value
    .map(item => normalizeReferenceDocument(item as Partial<ReferenceDocument>))
    .filter(document => document.uri);
}

async function ensureReferenceDocumentsDirectory() {
  if (!REFERENCE_DOCUMENTS_DIR) {
    throw new Error('Reference document storage is unavailable.');
  }

  const info = await FileSystem.getInfoAsync(REFERENCE_DOCUMENTS_DIR);

  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(REFERENCE_DOCUMENTS_DIR, {
      intermediates: true,
    });
  }

  return REFERENCE_DOCUMENTS_DIR;
}

function isStoredReferenceDocument(uri: string) {
  return Boolean(REFERENCE_DOCUMENTS_DIR && uri.startsWith(REFERENCE_DOCUMENTS_DIR));
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

function distanceBetweenCoordinatesFeet(
  from: Pick<LocationSnapshot, 'latitude' | 'longitude'>,
  to: Pick<ProjectArea, 'latitude' | 'longitude'>,
) {
  const earthRadiusFeet = 20902231;
  const toRadians = (value: number) => (value * Math.PI) / 180;
  const latitudeDelta = toRadians(to.latitude - from.latitude);
  const longitudeDelta = toRadians(to.longitude - from.longitude);
  const fromLatitude = toRadians(from.latitude);
  const toLatitude = toRadians(to.latitude);

  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(fromLatitude) *
      Math.cos(toLatitude) *
      Math.sin(longitudeDelta / 2) ** 2;

  return (
    earthRadiusFeet *
    2 *
    Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine))
  );
}

function findClosestProjectArea(
  currentLocation: LocationSnapshot | null,
  projectAreas: ProjectArea[],
): AreaSuggestion | null {
  return findProjectAreaSuggestions(currentLocation, projectAreas)[0] || null;
}

function findProjectAreaSuggestions(
  currentLocation: LocationSnapshot | null,
  projectAreas: ProjectArea[],
): AreaSuggestion[] {
  const savedLocationAreas = projectAreas.filter(hasSavedAreaLocation);

  if (!currentLocation || savedLocationAreas.length === 0) {
    if (__DEV__ && currentLocation && projectAreas.length > 0) {
      console.warn(
        'PIE_GPS_MATCH_DIAGNOSTIC no_saved_project_area_coordinates',
        {
          totalProjectAreas: projectAreas.length,
          missingSavedCoordinates: projectAreas.filter(area => !hasSavedAreaLocation(area)).length,
        },
      );
    }

    return [];
  }

  return savedLocationAreas
    .map(area => {
      const distanceFeet = distanceBetweenCoordinatesFeet(
        currentLocation,
        area,
      );

      return {
        area,
        distanceFeet,
        withinRadius: distanceFeet <= area.radiusFeet,
      };
    })
    .sort((a, b) => a.distanceFeet - b.distanceFeet);
}

function likelyProjectCandidatesFromGps(
  currentLocation: LocationSnapshot | null,
  projectAreas: ProjectArea[],
  savedUpdates: ProjectUpdate[],
  activeProjects: string[],
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
    (!second || second.distanceFeet - first.distanceFeet >= GPS_CLEAR_WINNER_DISTANCE_FEET);

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

function locationFieldsFromSnapshot(
  snapshot: LocationSnapshot,
  selectedArea?: ProjectArea | null,
) {
  const distance =
    selectedArea && hasSavedAreaLocation(selectedArea)
      ? distanceBetweenCoordinatesFeet(snapshot, selectedArea)
      : null;

  return {
    selectedAreaId: selectedArea?.id || null,
    selectedAreaName: selectedArea?.name || null,
    gpsLatitude: snapshot.latitude,
    gpsLongitude: snapshot.longitude,
    gpsAccuracy: snapshot.accuracy,
    distanceFromSelectedAreaFeet: distance,
    locationCapturedAt: snapshot.capturedAt,
  };
}

async function getCurrentLocationSnapshot(): Promise<LocationSnapshot | null> {
  const permission =
    await Location.requestForegroundPermissionsAsync();

  if (!permission.granted) return null;

  const location = await Location.getCurrentPositionAsync({
    accuracy: Location.Accuracy.Balanced,
  });

  return {
    latitude: location.coords.latitude,
    longitude: location.coords.longitude,
    accuracy: location.coords.accuracy,
    capturedAt: new Date().toISOString(),
  };
}


function normalizeDateInput(value: string) {
  const digits = value.replace(/\D/g, '').slice(0, 8);

  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;

  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
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

  return null;
}

function formatAppDate(value: string) {
  const date = parseFlexibleDate(value);

  if (!date) return value.trim();

  return `${zeroPad(date.getMonth() + 1)}/${zeroPad(date.getDate())}/${date.getFullYear()}`;
}

function daysUntilDate(value: string) {
  const target = parseFlexibleDate(value);

  if (!target) return null;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return Math.round((target.getTime() - today.getTime()) / 86400000);
}

function isScheduleItemDueToday(item: ScheduleItem) {
  if (item.status === 'Complete') return false;

  return daysUntilDate(item.finishDate) === 0;
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

function dueStatusText(value: string) {
  const days = daysUntilDate(value);

  if (days === null) return 'No valid finish date';
  if (days < 0) return `Overdue by ${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'}`;
  if (days === 0) return 'Due today';
  if (days === 1) return 'Due tomorrow';
  if (days <= 7) return `Due in ${days} days`;

  return `Due ${formatAppDate(value)}`;
}


function pluralWord(count: number, singular: string, plural = `${singular}s`) {
  return count === 1 ? singular : plural;
}

function countLabel(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${pluralWord(count, singular, plural)}`;
}

function photoAttachmentLabel(count: number) {
  if (count === 0) return 'No photos attached';
  if (count === 1) return 'Photo Attached';
  return `${count} Photos Attached`;
}

function normalizeScheduleItem(value: Partial<ScheduleItem>): ScheduleItem {
  return {
    id: typeof value.id === 'string' ? value.id : uid(),
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
    percentComplete:
      typeof value.percentComplete === 'number' && Number.isFinite(value.percentComplete)
        ? Math.max(0, Math.min(100, Math.round(value.percentComplete)))
        : 0,
    priority: SCHEDULE_PRIORITIES.includes(value.priority as SchedulePriority)
      ? (value.priority as SchedulePriority)
      : 'Medium',
    status: SCHEDULE_STATUSES.includes(value.status as ScheduleStatus)
      ? (value.status as ScheduleStatus)
      : 'Not Started',
    notes: typeof value.notes === 'string' ? value.notes : '',
    importedFrom: optionalString(value.importedFrom),
    importedAt: optionalString(value.importedAt),
    createdAt:
      typeof value.createdAt === 'string'
        ? value.createdAt
        : new Date().toISOString(),
  };
}

function normalizeScheduleItems(value: unknown) {
  if (!Array.isArray(value)) return [];

  return value
    .map(item => normalizeScheduleItem(item as Partial<ScheduleItem>))
    .filter(item => item.taskName.trim());
}

function csvCells(line: string) {
  const cells: string[] = [];
  let current = '';
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];

    if (char === '"') {
      quoted = !quoted;
      continue;
    }

    if (char === ',' && !quoted) {
      cells.push(current.trim());
      current = '';
      continue;
    }

    current += char;
  }

  cells.push(current.trim());
  return cells;
}

function parseScheduleText(contents: string, sourceName: string) {
  const importedAt = new Date().toISOString();
  const lines = contents
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);

  if (!lines.length) return [];

  const firstCells = csvCells(lines[0]).map(cell => cell.toLowerCase());
  const hasHeader = firstCells.some(cell =>
    ['task', 'task name', 'milestone', 'project', 'location', 'start', 'finish', 'due', 'owner', 'status'].includes(cell),
  );
  const headers = hasHeader ? firstCells : [];
  const dataLines = hasHeader ? lines.slice(1) : lines;

  function cell(cells: string[], names: string[], fallbackIndex: number) {
    const headerIndex = headers.findIndex(header => names.includes(header));

    if (headerIndex >= 0) return cells[headerIndex] || '';

    return cells[fallbackIndex] || '';
  }

  return dataLines
    .map(line => {
      const cells = csvCells(line);
      const taskName = cell(cells, ['task', 'task name', 'activity', 'item'], 0);

      if (!taskName) return null;

      return normalizeScheduleItem({
        taskName,
        projectName: cell(cells, ['project', 'project name'], 1),
        locationName: cell(cells, ['location', 'area', 'work area'], 2),
        startDate: cell(cells, ['start', 'start date'], 3),
        finishDate: cell(cells, ['finish', 'finish date', 'due', 'due date'], 4),
        milestone: cell(cells, ['milestone'], 5),
        owner: cell(cells, ['owner', 'responsible'], 6),
        status: (cell(cells, ['status'], 7) as ScheduleStatus) || 'Not Started',
        notes: cell(cells, ['notes', 'comments'], 8),
        importedFrom: sourceName,
        importedAt,
      });
    })
    .filter(Boolean) as ScheduleItem[];
}


function cleanPdfExtractedText(value: string) {
  const parentheticalText = Array.from(
    value.matchAll(/\((?:\\.|[^\\)])*\)/g),
  )
    .map(match =>
      match[0]
        .slice(1, -1)
        .replace(/\\\(/g, '(')
        .replace(/\\\)/g, ')')
        .replace(/\\n/g, ' ')
        .replace(/\\r/g, ' ')
        .replace(/\\t/g, ' ')
        .replace(/\\/g, ''),
    )
    .join('\n');

  return `${value}\n${parentheticalText}`
    .replace(/\r/g, '\n')
    .replace(/[\u0000-\u001F]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeExtractedScheduleDate(value: string) {
  const match = value.trim().match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2}|\d{4})$/);

  if (!match) return '';

  const month = match[1].padStart(2, '0');
  const day = match[2].padStart(2, '0');
  const year = match[3].length === 2 ? `20${match[3]}` : match[3];

  return formatAppDate(`${month}/${day}/${year}`);
}

function wordsNearDate(text: string, dateIndex: number) {
  const start = Math.max(0, dateIndex - 120);
  const end = Math.min(text.length, dateIndex + 80);

  return text
    .slice(start, end)
    .replace(/\b\d{1,2}[\/-]\d{1,2}[\/-](\d{2}|\d{4})\b/g, ' ')
    .replace(/\b(Start|Finish|Due|Duration|Predecessors|Successors|Calendar|Task Name|Milestone|Owner|Status)\b/gi, ' ')
    .replace(/[^a-zA-Z0-9 #&/.,'-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function bestScheduleLabelFromContext(context: string) {
  const parts = context
    .split(/\s{2,}|[|•]+/)
    .map(part => part.trim())
    .filter(part => part.length >= 4 && /[a-zA-Z]/.test(part));

  const candidate = parts[parts.length - 1] || context;

  return candidate
    .replace(/^[-–—:.,\s]+/, '')
    .replace(/[-–—:.,\s]+$/, '')
    .slice(0, 90)
    .trim();
}

function findNameMatch(value: string, names: string[]) {
  const lower = value.toLowerCase();

  return names.find(name => name && lower.includes(name.toLowerCase())) || '';
}

function extractScheduleItemsFromPdfText(
  rawPdfText: string,
  sourceName: string,
  projects: string[],
  projectAreas: ProjectArea[],
) {
  const importedAt = new Date().toISOString();
  const cleaned = cleanPdfExtractedText(rawPdfText);
  const datePattern = /\b\d{1,2}[\/-]\d{1,2}[\/-](?:\d{2}|\d{4})\b/g;
  const matches = Array.from(cleaned.matchAll(datePattern));
  const items: ScheduleItem[] = [];
  const seen = new Set<string>();

  matches.forEach((match, index) => {
    const finishDate = normalizeExtractedScheduleDate(match[0]);

    if (!finishDate) return;

    const context = wordsNearDate(cleaned, match.index || 0);
    const taskName = bestScheduleLabelFromContext(context);

    if (!taskName || taskName.length < 4) return;

    const previousMatch = matches[index - 1];
    const startDate =
      previousMatch &&
      typeof previousMatch.index === 'number' &&
      typeof match.index === 'number' &&
      match.index - previousMatch.index < 80
        ? normalizeExtractedScheduleDate(previousMatch[0])
        : '';

    const locationName = findNameMatch(
      `${context} ${taskName}`,
      projectAreas.map(area => area.name),
    );
    const projectName = findNameMatch(
      `${context} ${taskName}`,
      projects,
    );
    const key = `${taskName.toLowerCase()}|${finishDate}|${locationName}`;

    if (seen.has(key)) return;

    seen.add(key);
    items.push(
      normalizeScheduleItem({
        taskName,
        projectName,
        locationName,
        startDate,
        finishDate,
        milestone: '',
        owner: '',
        status: 'Not Started',
        notes:
          'Best-effort extraction from imported Gantt PDF. Review task name, location, and dates before relying on this item.',
        importedFrom: sourceName,
        importedAt,
      }),
    );
  });

  return items.slice(0, 75);
}

type AiScheduleExtractedItem = {
  taskName?: string;
  projectName?: string | null;
  locationName?: string | null;
  startDate?: string | null;
  finishDate?: string | null;
  dueDate?: string | null;
  milestone?: string | null;
  owner?: string | null;
  contractor?: string | null;
  percentComplete?: number | string | null;
  priority?: string | null;
  status?: string | null;
  notes?: string | null;
  confidence?: string | null;
  sourcePage?: number | null;
};

function normalizeAiScheduleStatus(value: unknown): ScheduleStatus {
  if (typeof value !== 'string') return 'Not Started';

  const lower = value.trim().toLowerCase();

  if (lower.includes('complete') || lower.includes('done')) return 'Complete';
  if (lower.includes('progress') || lower.includes('active')) return 'In Progress';
  if (lower.includes('wait') || lower.includes('hold')) return 'Waiting';
  if (lower.includes('schedule') || lower.includes('planned') || lower.includes('not started')) return 'Not Started';

  return 'Not Started';
}

function normalizeAiSchedulePriority(value: unknown, finishDate: string): SchedulePriority {
  if (typeof value === 'string') {
    const lower = value.trim().toLowerCase();

    if (lower.includes('high')) return 'High';
    if (lower.includes('low')) return 'Low';
    if (lower.includes('medium') || lower.includes('normal')) return 'Medium';
  }

  const days = daysUntilDate(finishDate);

  if (days !== null && days < 0) return 'High';
  if (days !== null && days <= 7) return 'High';

  return 'Medium';
}

function percentFromAiItem(item: AiScheduleExtractedItem) {
  const direct = item.percentComplete;

  if (typeof direct === 'number' && Number.isFinite(direct)) {
    return Math.max(0, Math.min(100, Math.round(direct)));
  }

  const text = [direct, item.notes, item.status]
    .filter(value => typeof value === 'string')
    .join(' ');
  const match = text.match(/(\d{1,3})\s*%/);

  if (!match) return 0;

  return Math.max(0, Math.min(100, Number(match[1])));
}

function contractorFromAiItem(item: AiScheduleExtractedItem) {
  if (typeof item.contractor === 'string' && item.contractor.trim()) {
    return item.contractor.trim();
  }

  if (typeof item.owner === 'string' && item.owner.trim()) {
    return item.owner.trim();
  }

  return '';
}

function normalizeAiScheduleDate(value: unknown) {
  if (typeof value !== 'string') return '';

  const trimmed = value.trim();

  if (!trimmed) return '';

  const parsed = parseFlexibleDate(trimmed);

  if (!parsed) return '';

  return `${zeroPad(parsed.getMonth() + 1)}/${zeroPad(parsed.getDate())}/${parsed.getFullYear()}`;
}

function firstValidAiDate(...values: unknown[]) {
  for (const value of values) {
    const normalized = normalizeAiScheduleDate(value);

    if (normalized) return normalized;
  }

  return '';
}

function scheduleItemsFromAiPayload(payload: unknown, sourceName: string) {
  const importedAt = new Date().toISOString();
  const rawItems =
    payload && typeof payload === 'object' && Array.isArray((payload as { items?: unknown }).items)
      ? ((payload as { items: unknown[] }).items)
      : Array.isArray(payload)
        ? payload
        : [];

  return rawItems
    .map(raw => {
      if (!raw || typeof raw !== 'object') return null;

      const item = raw as AiScheduleExtractedItem;
      const taskName = typeof item.taskName === 'string' ? item.taskName.trim() : '';

      if (!taskName) return null;

      const startDate = firstValidAiDate(item.startDate);
      const finishDate = firstValidAiDate(item.finishDate, item.dueDate, item.startDate);
      const contractor = contractorFromAiItem(item);
      const percentComplete = percentFromAiItem(item);
      const confidenceNote =
        typeof item.confidence === 'string' && item.confidence.trim()
          ? ` Review strength: ${item.confidence.trim()}.`
          : '';
      const sourcePageNote =
        typeof item.sourcePage === 'number' && Number.isFinite(item.sourcePage)
          ? ` Source page: ${item.sourcePage}.`
          : '';

      return normalizeScheduleItem({
        taskName,
        projectName: typeof item.projectName === 'string' ? item.projectName.trim() : '',
        locationName: typeof item.locationName === 'string' ? item.locationName.trim() : '',
        startDate,
        finishDate,
        milestone: typeof item.milestone === 'string' ? item.milestone.trim() : '',
        owner: typeof item.owner === 'string' ? item.owner.trim() : '',
        contractor,
        percentComplete,
        priority: normalizeAiSchedulePriority(item.priority, finishDate),
        status: normalizeAiScheduleStatus(item.status),
        notes:
          typeof item.notes === 'string' && item.notes.trim()
            ? `${item.notes.trim()}${confidenceNote}${sourcePageNote} Review this AI-extracted item before relying on it.`
            : `AI/OCR extraction from imported Gantt PDF.${confidenceNote}${sourcePageNote} Review task name, location, and dates before relying on this item.`,
        importedFrom: sourceName,
        importedAt,
      });
    })
    .filter(Boolean) as ScheduleItem[];
}

async function extractScheduleItemsWithAiEndpoint({
  endpointUrl,
  pdfUri,
  fileName,
  projects,
  projectAreas,
}: {
  endpointUrl: string;
  pdfUri: string;
  fileName: string;
  projects: string[];
  projectAreas: ProjectArea[];
}) {
  const trimmedEndpoint = endpointUrl.trim();

  if (!trimmedEndpoint) return [];

  const formData = new FormData();

  formData.append('file', {
    uri: pdfUri,
    name: fileName || 'schedule.pdf',
    type: 'application/pdf',
  } as any);

  formData.append('projectName', projects[0] || '');
  formData.append('timezone', 'America/Los_Angeles');
  formData.append(
    'locations',
    JSON.stringify(projectAreas.map(area => area.name).filter(Boolean)),
  );

  const response = await fetch(trimmedEndpoint, {
    method: 'POST',
    body: formData,
  });

  const payload = await response.json();

  if (!response.ok) {
    const message =
      payload &&
      typeof payload === 'object' &&
      'error' in payload &&
      typeof (payload as { error?: unknown }).error === 'string'
        ? (payload as { error: string }).error
        : `AI extractor failed with HTTP ${response.status}`;

    throw new Error(message);
  }

  return scheduleItemsFromAiPayload(payload, fileName);
}

function actionItemsFromUpdates(savedUpdates: ProjectUpdate[]) {
  return savedUpdates.flatMap(update =>
    update.photos
      .filter(photo => isOpenAction(photo) && photo.actionDueDate.trim())
      .map(photo => ({
        id: `${update.id}-${photo.id}`,
        projectName: update.projectName,
        locationName: photo.selectedAreaName || update.selectedAreaName || '',
        taskName: photo.actionRequired || photo.caption || photo.category,
        finishDate: photo.actionDueDate,
        owner: photo.actionOwner,
        status: photo.actionStatus,
        dueLabel: dueStatusText(photo.actionDueDate),
      })),
  );
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

function normalizeBackupData(value: unknown): RestoredAppData | null {
  if (!isRecord(value) || typeof value.version !== 'number') {
    return null;
  }

  if (
    !Array.isArray(value.savedUpdates) ||
    !Array.isArray(value.projects) ||
    !Array.isArray(value.archivedProjects)
  ) {
    return null;
  }

  return {
    savedUpdates: value.savedUpdates.map(item =>
      normalizeUpdate(item as Partial<ProjectUpdate>),
    ),
    projects: normalizeStringList(value.projects),
    archivedProjects: normalizeStringList(value.archivedProjects),
    contactBook: normalizeContacts(value.contacts),
    projectAreas: normalizeProjectAreas(value.projectAreas),
    referenceDocuments: normalizeReferenceDocuments(value.referenceDocuments),
    projectDocuments: normalizeProjectDocuments(value.projectDocuments),
    scheduleItems: normalizeScheduleItems(value.scheduleItems),
    storedDraft: normalizeStoredDraft(value.activeDraft),
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
  return Boolean(PHOTO_STORAGE_DIR && uri.startsWith(PHOTO_STORAGE_DIR));
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

async function cleanupStoredPhotoDirectory(
  referencedUpdates: ProjectUpdate[],
) {
  if (!PHOTO_STORAGE_DIR) return;

  try {
    const info = await FileSystem.getInfoAsync(PHOTO_STORAGE_DIR);

    if (!info.exists) return;

    const referencedUris = new Set(
      referencedUpdates.flatMap(update =>
        update.photos.map(photo => photo.uri),
      ),
    );

    const filenames =
      await FileSystem.readDirectoryAsync(PHOTO_STORAGE_DIR);

    await Promise.all(
      filenames.map(filename => {
        const uri = `${PHOTO_STORAGE_DIR}${filename}`;

        if (referencedUris.has(uri)) return Promise.resolve();

        return FileSystem.deleteAsync(uri, {
          idempotent: true,
        }).catch(() => undefined);
      }),
    );
  } catch {
    // Best-effort maintenance; update flows should never fail because of cleanup.
  }
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

function documentCountForProject(
  projectName: string | null,
  documents: ReferenceDocument[],
) {
  if (!projectName) return documents.length;

  const normalizedProject = projectName.toLowerCase();

  return documents.filter(document => {
    const searchable = `${document.name} ${document.originalFileName} ${document.notes}`.toLowerCase();
    return searchable.includes(normalizedProject);
  }).length;
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

// Backs up each photo's actual image file to the project-photos bucket.
// saveCloudUpdate() only writes the update's metadata (caption, category,
// the photo's local-device file path) to the database - without this, a
// photo's image never leaves the phone it was taken on. Fire-and-forget per
// photo: a slow or failed upload shouldn't block the update save/send flow.
function syncUpdatePhotosToCloud(update: ProjectUpdate) {
  update.photos.forEach(photo => {
    void uploadLocalPhoto(update, photo);
  });
}

async function uploadUpdatePhotosForSync(
  update: ProjectUpdate,
): Promise<Pick<
  FieldUpdateSyncWorkAttempt,
  | 'photoStorageUploadAttempted'
  | 'storageUploadResult'
  | 'storageBucketName'
  | 'storageBucketExists'
  | 'storageFailureCategory'
  | 'storageHttpStatus'
  | 'storageErrorCode'
  | 'localFileExists'
  | 'localFileReadable'
  | 'fileByteSizeCategory'
  | 'uploadPayloadType'
  | 'storageContentType'
  | 'objectPathCategory'
  | 'databaseSyncRanAfterUpload'
  | 'errors'
>> {
  if (update.photos.length === 0) {
    return {
      photoStorageUploadAttempted: false,
      storageUploadResult: 'skipped',
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
  }

  const results = await Promise.all(
    update.photos.map(photo => uploadLocalPhotoWithDiagnostics(update, photo)),
  );
  const failures = results.filter(
    result => result.result !== 'uploaded' && result.result !== 'skipped',
  );
  const representativeDiagnostic =
    failures[0]?.diagnostic || results[0]?.diagnostic || null;

  if (failures.length > 0) {
    return {
      photoStorageUploadAttempted: true,
      storageUploadResult: 'failed',
      storageBucketName: representativeDiagnostic?.bucketName || null,
      storageBucketExists: representativeDiagnostic?.bucketExists || 'unknown',
      storageFailureCategory:
        representativeDiagnostic?.failureCategory || 'unknown_storage_error',
      storageHttpStatus: representativeDiagnostic?.httpStatus ?? null,
      storageErrorCode: representativeDiagnostic?.errorCode ?? null,
      localFileExists: representativeDiagnostic?.localFileExists ?? null,
      localFileReadable: representativeDiagnostic?.localFileReadable ?? null,
      fileByteSizeCategory:
        representativeDiagnostic?.fileByteSizeCategory || 'unknown',
      uploadPayloadType: representativeDiagnostic?.uploadPayloadType || 'unknown',
      storageContentType: representativeDiagnostic?.contentType || null,
      objectPathCategory: representativeDiagnostic?.objectPathCategory || null,
      databaseSyncRanAfterUpload: false,
      errors: failures.map(result =>
        result.result === 'missing'
          ? 'Photo storage upload failed: photo file unavailable.'
          : `Photo storage upload failed: ${result.message || 'unknown storage error'}`,
      ),
    };
  }

  return {
    photoStorageUploadAttempted: true,
    storageUploadResult: 'success',
    storageBucketName: representativeDiagnostic?.bucketName || null,
    storageBucketExists: representativeDiagnostic?.bucketExists || 'yes',
    storageFailureCategory: null,
    storageHttpStatus: null,
    storageErrorCode: null,
    localFileExists: representativeDiagnostic?.localFileExists ?? null,
    localFileReadable: representativeDiagnostic?.localFileReadable ?? null,
    fileByteSizeCategory:
      representativeDiagnostic?.fileByteSizeCategory || 'unknown',
    uploadPayloadType: representativeDiagnostic?.uploadPayloadType || 'unknown',
    storageContentType: representativeDiagnostic?.contentType || null,
    objectPathCategory: representativeDiagnostic?.objectPathCategory || null,
    databaseSyncRanAfterUpload: false,
    errors: [],
  };
}

async function runFieldUpdateCloudSync(
  update: ProjectUpdate,
): Promise<{
  syncResult: SyncUploadResult;
  workAttempt: FieldUpdateSyncWorkAttempt;
}> {
  const photoAttempt = await uploadUpdatePhotosForSync(update);
  const workAttempt: FieldUpdateSyncWorkAttempt = {
    cloudUpdateInsertAttempted: false,
    photoStorageUploadAttempted: photoAttempt.photoStorageUploadAttempted,
    storageUploadResult: photoAttempt.storageUploadResult,
    databaseUpsertResult: 'skipped',
    storageBucketName: photoAttempt.storageBucketName,
    storageBucketExists: photoAttempt.storageBucketExists,
    storageFailureCategory: photoAttempt.storageFailureCategory,
    storageHttpStatus: photoAttempt.storageHttpStatus,
    storageErrorCode: photoAttempt.storageErrorCode,
    localFileExists: photoAttempt.localFileExists,
    localFileReadable: photoAttempt.localFileReadable,
    fileByteSizeCategory: photoAttempt.fileByteSizeCategory,
    uploadPayloadType: photoAttempt.uploadPayloadType,
    storageContentType: photoAttempt.storageContentType,
    objectPathCategory: photoAttempt.objectPathCategory,
    databaseSyncRanAfterUpload: false,
    errors: [...photoAttempt.errors],
  };

  await saveCloudUpdate(update);
  workAttempt.cloudUpdateInsertAttempted = true;

  const syncResult = await uploadPendingChanges();
  workAttempt.databaseSyncRanAfterUpload = workAttempt.storageUploadResult === 'success';
  workAttempt.databaseUpsertResult =
    syncResult.configured && syncResult.errors.length === 0 && syncResult.queued === 0
      ? 'success'
      : 'failed';

  return {
    syncResult,
    workAttempt,
  };
}

function projectDocumentStatusDetail(document: ProjectDocument) {
  if (document.status === 'failed') {
    return 'Document upload failed · Retry';
  }

  if (document.status === 'uploading') {
    return 'Document upload pending';
  }

  if (document.status === 'uploaded') {
    return `Uploaded ${formatSavedTime(document.uploadedAt || document.updatedAt)}`;
  }

  return 'Local only · not included as an uploaded attachment';
}

function isComplianceSensitiveProjectDocument(document: ProjectDocument) {
  return COMPLIANCE_SENSITIVE_DOCUMENT_CATEGORIES.includes(document.category);
}

function buildProjectDocumentMetadataBrief(
  projectName: string,
  documents: ProjectDocument[],
) {
  const scoped = projectDocumentsForProject(projectName, documents);
  const uploaded = scoped.filter(document => document.status === 'uploaded').length;
  const pending = scoped.filter(document =>
    document.status === 'local' || document.status === 'uploading',
  ).length;
  const failed = scoped.filter(document => document.status === 'failed').length;

  if (scoped.length === 0) return 'No project documents linked yet.';

  return `${scoped.length} project document${scoped.length === 1 ? '' : 's'} linked: ${uploaded} uploaded, ${pending} local or pending, ${failed} failed.`;
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

  if (!result) return false;
  if (!pieResultHasCompletedVisualComparison(result)) return false;

  return Boolean(
    result.visibleChange ||
      (result.additions?.length || 0) > 0 ||
      (result.removals?.length || 0) > 0 ||
      observedFindingsForPIEResult(result).length > 0,
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

  const intelligence = update.photos
    .map(photo => photo.photoIntelligence)
    .filter(Boolean) as PIEPhotoIntelligenceDisplayState[];

  const authCopy = authStatusCopyForPIEResults(intelligence);
  if (authCopy) return authCopy;

  if (intelligence.some(result => result.status === 'analyzing')) {
    return PIE_STATUS_COPY.checking;
  }

  if (
    intelligence.length > 0 &&
    intelligence.every(result => result.status === 'no_suitable_prior_photo')
  ) {
    return PIE_STATUS_COPY.noPriorPhoto;
  }

  if (
    intelligence.some(
      result =>
        result.status === 'analysis_failed_retry' ||
        result.status === 'comparison_unavailable',
    )
  ) {
    return PIE_STATUS_COPY.unavailableRetry;
  }

  if (update.photos.some(photoHasVisualChange)) {
    return PIE_STATUS_COPY.possibleChanges;
  }

  if (intelligence.length > 0) {
    return PIE_STATUS_COPY.noReliableChange;
  }

  return PIE_STATUS_COPY.checking;
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

  if (results.length === 0 || results.some(isPreparingSecurePhotoAnalysisResult)) {
    return {
      status: 'analyzing',
      summary: authCopy || PIE_STATUS_COPY.preparingSecureAnalysis,
    };
  }

  if (results.some(result => result.status === 'analyzing')) {
    return {
      status: 'analyzing',
      summary: PIE_STATUS_COPY.checking,
    };
  }

  if (results.every(result => result.status === 'no_suitable_prior_photo')) {
    return {
      status: 'no_prior_photo',
      summary: PIE_STATUS_COPY.noPriorPhoto,
    };
  }

  if (
    results.some(
      result =>
        result.status === 'analysis_failed_retry' ||
        result.status === 'comparison_unavailable',
    )
  ) {
    return {
      status: 'failed',
      summary: authCopy || PIE_STATUS_COPY.unavailableRetry,
    };
  }

  const changed = update.photos.some(photoHasVisualChange);

  return {
    status: 'complete',
    summary: changed
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
  if (!result || !pieResultHasCompletedVisualComparison(result) || pieResultIsBaselineOnly(result)) return [];

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

function buildSuggestedObservedNote(observedFindings: string[]) {
  const observedOnly = uniqueStrings(observedFindings)
    .filter(item => item.trim())
    .filter(item => !/possible|progress|blocker|quality|concern|ahead|behind|delay|risk/i.test(item))
    .slice(0, 3);

  if (observedOnly.length === 0) return null;

  return observedOnly.join(', ');
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

function buildPreviewLine(
  update: ProjectUpdate,
  contacts: ProjectContact[],
) {
  const areaName = update.selectedAreaName || 'Unassigned area';
  const recipientText =
    contacts.length > 0
      ? `Site Team · ${contacts.length} people`
      : 'recipients';

  return `${areaName} update to ${recipientText}`;
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
        ? `\n\nDAVE Summary: ${pieStatus.summary}`
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
  if (update.safetyFlag || update.quickContext === 'Safety') return true;

  return update.photos.some(photo => photo.category === 'Safety Concern');
}

function updateHasBlocker(update: ProjectUpdate) {
  return (
    Boolean(update.blockerFlag) ||
    update.quickContext === 'Blocker' ||
    update.photos.some(photo => photo.category === 'Open Issue')
  );
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

  return (
    lifecycle === 'queued' ||
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
  const seen = new Set<string>();
  const merged: ProjectUpdate[] = [];

  const considerUpdate = (
    update: ProjectUpdate,
    sourceAfterReload: FieldUpdateDeleteDiagnostics['sourceAfterReload'],
  ) => {
    const tombstone = tombstoneById.get(update.id);
    const localArchiveCanStayHidden =
      tombstone?.action === 'archive_sent_update' && sourceAfterReload === 'local';

    if (tombstone && !localArchiveCanStayHidden) return;
    if (seen.has(update.id)) return;

    seen.add(update.id);

    const lifecycleStatus = lifecycleStatusForUpdate(update);
    merged.push({
      ...update,
      isArchived: update.isArchived || tombstone?.action === 'archive_sent_update',
      archivedAt: update.archivedAt || tombstone?.deletedAt || null,
      deleteDiagnostics: {
        updateId: update.id,
        localId: update.stableSendId || update.id,
        cloudIdPresent: sourceAfterReload === 'cloud' || lifecycleStatus === 'sent',
        lifecycleStatus,
        pendingSync: updateNeedsAutomaticSyncRetry(update),
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

function upsertDeletedUpdateTombstone(
  tombstones: DeletedUpdateTombstone[],
  tombstone: DeletedUpdateTombstone,
) {
  return [
    tombstone,
    ...tombstones.filter(item => item.updateId !== tombstone.updateId),
  ];
}

function classifySyncFailureCategory(
  errors: string[],
): FieldUpdateSyncFailureCategory {
  const message = errors.join(' ').toLowerCase();

  if (!message.trim()) return 'unknown';
  // Highest-confidence, most specific signals are checked first so a message
  // that happens to also mention "network" or "fetch" (common in wrapped
  // fetch/auth errors) is never misclassified as offline. Generic
  // offline/network wording is checked last, only once nothing more
  // specific has matched.
  if (/row level|rls|policy|permission denied|42501|violates row-level/.test(message)) return 'rls_denied';
  if (/signed out|sign in|no user|session unavailable|storage_unavailable/.test(message)) return 'signed_out';
  if (/auth|jwt|token|unauthorized|forbidden|401|403/.test(message)) return 'auth';
  if (/malformed|invalid|schema|column|not null|constraint|payload/.test(message)) return 'malformed_payload';
  if (/database|insert|upsert|postgres|postgrest|supabase/.test(message)) return 'database_insert_failed';
  if (/photo|storage|bucket|object|upload/.test(message)) return 'storage_upload_failed';
  if (/offline|network|connection|fetch|timeout|unreachable|internet/.test(message)) return 'offline';
  return 'unknown';
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

type FieldUpdateSyncWorkAttempt = {
  cloudUpdateInsertAttempted: boolean;
  photoStorageUploadAttempted: boolean;
  storageUploadResult: FieldUpdateSyncStepResult;
  databaseUpsertResult: FieldUpdateSyncStepResult;
  storageBucketName: string | null;
  storageBucketExists: 'yes' | 'no' | 'unknown';
  storageFailureCategory: PhotoStorageUploadFailureCategory | null;
  storageHttpStatus: number | null;
  storageErrorCode: string | null;
  localFileExists: boolean | null;
  localFileReadable: boolean | null;
  fileByteSizeCategory: 'zero' | 'nonzero' | 'unknown';
  uploadPayloadType: 'ArrayBuffer' | 'Blob' | 'base64' | 'unknown';
  storageContentType: string | null;
  objectPathCategory: string | null;
  databaseSyncRanAfterUpload: boolean | null;
  errors: string[];
};

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
      : classifySyncFailureCategory(
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
  if (diagnostics.lastSyncResult === 'success') return 'sent';
  if (diagnostics.lastSyncFailureCategory === 'offline') return 'queued';
  return 'failed';
}

function queuedStatusCopyForUpdate(update: ProjectUpdate) {
  const category = update.syncDiagnostics?.lastSyncFailureCategory;
  if (category === 'signed_out') return 'Sign in required to send';
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
  return "Queued — will send when you're back online";
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
    return 'PIEAnalysis';
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
  projectName: string,
  savedUpdates: ProjectUpdate[],
): PIEProjectBriefModel {
  const scopedUpdates = savedUpdates
    .filter(update => projectMatchesScope(update, projectName))
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
  if (/work completed|progress increased|finished|quality issue|schedule.*risk|at risk|completed/.test(normalized)) {
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
  projectName: string,
  savedUpdates: ProjectUpdate[],
) {
  const scopedUpdates = savedUpdates
    .filter(update => projectMatchesScope(update, projectName))
    .sort((a, b) => b.date.localeCompare(a.date));

  if (scopedUpdates.some(update => updateHasSafetyConcern(update))) {
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
    return `Last update sent ${relativeUpdateDateLabel(latest.date)}`;
  }

  if (lifecycleStatusForUpdate(latest) === 'queued') {
    return `Last local update ${relativeUpdateDateLabel(latest.date)}`;
  }

  if (lifecycleStatusForUpdate(latest) === 'failed') {
    return queuedStatusCopyForUpdate(latest);
  }

  if (lifecycleStatusForUpdate(latest) === 'ready_to_send') {
    return 'Draft ready to send';
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
) {
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

  const latestMatch = areaMatches.sort((a, b) =>
    b.date.localeCompare(a.date),
  )[0];

  if (
    latestMatch &&
    activeProjects.some(project => project === latestMatch.projectName)
  ) {
    return latestMatch.projectName;
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
  const dueScheduleItem = scheduleItems.find(
    item =>
      item.projectName.toLowerCase() === projectName.toLowerCase() &&
      isScheduleItemDueToday(item),
  );

  if (dueScheduleItem) {
    return dueScheduleItem.taskName.trim() || 'Schedule item due today';
  }

  const hasDueTodayAction = savedUpdates.some(
    update =>
      projectMatchesScope(update, projectName) &&
      update.photos.some(isDueTodayAction),
  );

  return hasDueTodayAction ? 'Open action item due today' : null;
}

type OverviewProjectRow = {
  project: string;
  needsAttention: boolean;
  severity: 'high' | 'medium';
  subtitle: string;
  dueTodayLabel: string | null;
  observationCount: number;
};

function buildOverviewProjectRows(
  projects: string[],
  savedUpdates: ProjectUpdate[],
  scheduleItems: ScheduleItem[],
): OverviewProjectRow[] {
  return projects.map(project => {
    const attentionItems = buildPhase2AttentionItems(savedUpdates, project);
    const dueTodayLabel = projectDueTodayLabel(project, savedUpdates, scheduleItems);
    const needsAttention = attentionItems.length > 0 || dueTodayLabel !== null;
    const brief = buildPIEProjectBriefModel(project, savedUpdates);
    const subtitle = needsAttention
      ? brief.observations[0]?.text || brief.summary.split('\n')[0]
      : buildProjectCardPIEStatus(project, savedUpdates);

    return {
      project,
      needsAttention,
      severity: attentionItems.length > 0 ? 'high' : 'medium',
      subtitle,
      dueTodayLabel,
      observationCount: brief.observations.length,
    };
  });
}

function mostRecentHeroPhotoUri(
  scopedProjects: string[],
  savedUpdates: ProjectUpdate[],
): string | null {
  const candidateUpdates = savedUpdates
    .filter(
      update =>
        update.photos.length > 0 &&
        scopedProjects.some(project => projectMatchesScope(update, project)),
    )
    .sort((a, b) => updateSortTime(b) - updateSortTime(a));

  return candidateUpdates[0]?.photos[0]?.uri || null;
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
  const items = savedUpdates
    .filter(update => projectMatchesScope(update, projectName))
    .flatMap(update => {
      const recurringContext = recurringOpenItemContext(update, savedUpdates);
      const safetyDraftItem = update.safetyFlag
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
      const blockerItem = updateHasBlocker(update)
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
              title: 'Queued update waiting to send',
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
                  ? 'Sign in required to send. The update is saved locally and can be retried.'
                  : 'Sync failed · Retry. The update is saved locally and can be retried.',
              areaLabel: update.selectedAreaName || 'No area selected',
              dateLabel: formatDisplayDate(update.date),
              priority: ATTENTION_PRIORITY.sendIssue,
              urgent: false,
              retryable: true,
              statusRole: 'needsRetry' as StatusStyleRole,
            }
          : null,
        lifecycle === 'ready_to_send' && update.recipients.contactIds.length === 0
          ? {
              id: `${update.id}-missing-recipients`,
              updateId: update.id,
              actionTarget: 'update' as const,
              projectName: update.projectName,
              title: 'Missing recipients',
              detail: 'Add recipients before sending this update.',
              areaLabel: update.selectedAreaName || 'No area selected',
              dateLabel: formatDisplayDate(update.date),
              priority: ATTENTION_PRIORITY.readyToSend,
              urgent: false,
              retryable: false,
              statusRole: 'informational' as StatusStyleRole,
            }
          : null,
        lifecycle === 'ready_to_send' && update.recipients.contactIds.length > 0
          ? {
              id: `${update.id}-ready-to-send`,
              updateId: update.id,
              actionTarget: 'update' as const,
              projectName: update.projectName,
              title: 'Update ready to send',
              detail: 'Open the update to review recipients and send.',
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
            title: 'DAVE result changed after send',
            detail: `Original message was sent while analysis was unresolved. Current result: ${summarizePIEStatusForUpdate(update).summary}`,
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
          const overdue =
            photo.actionDueDate &&
            photo.actionDueDate < new Date().toISOString().slice(0, 10) &&
            photo.actionStatus !== 'Closed';

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

function projectThumbnailUri(
  projectName: string,
  savedUpdates: ProjectUpdate[],
) {
  return savedUpdates.find(
    update => projectMatchesScope(update, projectName) && update.photos[0]?.uri,
  )?.photos[0]?.uri;
}

export default function App() {
  return (
    <SafeAreaProvider>
      <AppShell />
    </SafeAreaProvider>
  );
}

function AppShell() {
  const insets = useSafeAreaInsets();

  const [screen, setScreen] = useState<Screen>('Home');

  const [savedUpdatesEntryFilter, setSavedUpdatesEntryFilter] = useState<{
    tab: 'Sent';
    withinDays: number;
  } | null>(null);

  const [projectsEntryStatusFilter, setProjectsEntryStatusFilter] =
    useState<'onTrack' | null>(null);

  useEffect(() => {
    if (screen === 'SavedUpdates' && savedUpdatesEntryFilter) {
      setSavedUpdatesEntryFilter(null);
    }

    if (screen === 'Projects' && projectsEntryStatusFilter) {
      setProjectsEntryStatusFilter(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen]);

  const [selectedWorkspaceProject, setSelectedWorkspaceProject] =
    useState(DEFAULT_PROJECTS[0]);

  const [overviewProjectSelection, setOverviewProjectSelection] =
    useState<OverviewProjectSelection>(undefined);
  const [overviewProjectManuallySelected, setOverviewProjectManuallySelected] =
    useState(false);

  const [detectedProjectName, setDetectedProjectName] =
    useState<string | null>(null);
  const [gpsCandidateProjectNames, setGpsCandidateProjectNames] =
    useState<string[]>([]);

  const [projectDetectionStatus, setProjectDetectionStatus] =
    useState<OverviewDetectionStatus>('checking');

  const [savedUpdates, setSavedUpdates] = useState<ProjectUpdate[]>([]);
  const [captureMemories, setCaptureMemories] = useState<DAVEConfirmedCaptureMemory[]>([]);
  const [deletedUpdateTombstones, setDeletedUpdateTombstones] =
    useState<DeletedUpdateTombstone[]>([]);

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

  const [projectDocuments, setProjectDocuments] =
    useState<ProjectDocument[]>([]);

  const [scheduleItems, setScheduleItems] =
    useState<ScheduleItem[]>([]);

  const [scheduleAiExtractorUrl, setScheduleAiExtractorUrl] =
    useState('');

  const [displayName, setDisplayName] =
    useState('');

  const [contactBook, setContactBook] =
    useState<ContactBook>({ contacts: [] });

  const [contactsReturnScreen, setContactsReturnScreen] =
    useState<Screen>('Home');

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
  } | null>(null);

  const [selectedDetailUpdate, setSelectedDetailUpdate] =
    useState<ProjectUpdate | null>(null);

  const [draftSavedAt, setDraftSavedAt] =
    useState<string | null>(null);

  const [updatesLoaded, setUpdatesLoaded] =
    useState(false);
  const [deletedUpdateTombstonesLoaded, setDeletedUpdateTombstonesLoaded] =
    useState(false);

  const [projectsLoaded, setProjectsLoaded] =
    useState(false);

  const [archivedProjectsLoaded, setArchivedProjectsLoaded] =
    useState(false);

  const [projectAreasLoaded, setProjectAreasLoaded] =
    useState(false);

  const [referenceDocumentsLoaded, setReferenceDocumentsLoaded] =
    useState(false);

  const [projectDocumentsLoaded, setProjectDocumentsLoaded] =
    useState(false);

  const [scheduleItemsLoaded, setScheduleItemsLoaded] =
    useState(false);

  const [scheduleAiExtractorUrlLoaded, setScheduleAiExtractorUrlLoaded] =
    useState(false);

  const [displayNameLoaded, setDisplayNameLoaded] =
    useState(false);

  const [contactsLoaded, setContactsLoaded] =
    useState(false);

  const [draftLoaded, setDraftLoaded] =
    useState(false);

  const [draftAreaSuggestion, setDraftAreaSuggestion] =
    useState<AreaSuggestion | null>(null);

  const [locationStatus, setLocationStatus] =
    useState<string | null>(null);

  const draftSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  const savedUpdatesSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  const photoCleanupRan = useRef(false);
  const queuedHydrationInFlight = useRef(false);
  const savedUpdatesRef = useRef(savedUpdates);
  savedUpdatesRef.current = savedUpdates;
  const draftLocationCaptureRef = useRef<ReturnType<typeof captureDraftLocation> | null>(null);
  const [photoAuthRequest, setPhotoAuthRequest] = useState<{
    update: ProjectUpdate;
    photo: UpdatePhoto;
  } | null>(null);
  const [photoAuthEmail, setPhotoAuthEmail] = useState('');
  const [photoAuthPassword, setPhotoAuthPassword] = useState('');
  const [photoAuthMessage, setPhotoAuthMessage] = useState<string | null>(null);
  const [photoAuthSubmitting, setPhotoAuthSubmitting] = useState(false);

useEffect(() => {
  async function loadSavedUpdates() {
    try {
      const [localValue, tombstoneValue] = await Promise.all([
        AsyncStorage.getItem(UPDATES_STORAGE_KEY),
        AsyncStorage.getItem(DELETED_UPDATES_STORAGE_KEY),
      ]);
      const localParsed = localValue ? JSON.parse(localValue) : [];
      const localUpdates = Array.isArray(localParsed)
        ? localParsed.map(normalizeUpdate)
        : [];
      const tombstones = normalizeDeletedUpdateTombstones(
        tombstoneValue ? JSON.parse(tombstoneValue) : [],
      );
      setDeletedUpdateTombstones(tombstones);
      await Promise.all(
        tombstones.map(tombstone =>
          removeProjectUpdateFromSyncQueue(tombstone.updateId),
        ),
      );

      const cloudUpdates = await loadCloudUpdates<ProjectUpdate>();

      setSavedUpdates(mergeSavedUpdatesWithTombstones({
        localUpdates,
        cloudUpdates: cloudUpdates.map(normalizeUpdate),
        tombstones,
      }));
    } catch {
      Alert.alert(
        'Storage error',
        'Saved updates could not be loaded.',
      );
    } finally {
      setUpdatesLoaded(true);
      setDeletedUpdateTombstonesLoaded(true);
    }
  }

  void loadSavedUpdates();
}, []);

useEffect(() => {
  let active = true;

  void localDAVECaptureMemoryRepository.list()
    .then(memories => {
      if (active) setCaptureMemories([...memories]);
    })
    .catch(() => {
      if (active) {
        Alert.alert(
          'Capture memories unavailable',
          'Confirmed project memories could not be loaded from this device.',
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
      const localValue = await AsyncStorage.getItem(PROJECTS_STORAGE_KEY);
      const localProjects = normalizeProjectRecords(localValue ? JSON.parse(localValue) : []);
      const cloudProjects = await loadCloudProjectRecords();
      const mergedRecords = mergeProjectRecords(DEFAULT_PROJECTS, localProjects, cloudProjects);

      setProjectRecords(mergedRecords);
      setProjects(mergedRecords.map(project => project.name));

      void Promise.all(mergedRecords.map(async project => {
        if (!project.coverPhoto?.remotePath) return;
        const hydrated = await hydrateProjectCoverPhotoCache(
          authorityProjectId(project.name),
          project.coverPhoto,
        );
        if (hydrated.localUri === project.coverPhoto?.localUri) return;
        setProjectRecords(previous => previous.map(item =>
          item.name.toLowerCase() === project.name.toLowerCase()
            ? { ...item, coverPhoto: hydrated }
            : item,
        ));
      }));
    } catch {
      Alert.alert(
        'Storage error',
        'Saved projects could not be loaded.',
      );
    } finally {
      setProjectsLoaded(true);
    }
  }

  void loadProjects();
}, []);

  useEffect(() => {
    AsyncStorage.getItem(ARCHIVED_PROJECTS_STORAGE_KEY)
      .then(value => {
        if (!value) return;

        const parsed = JSON.parse(value);

        if (Array.isArray(parsed)) {
          setArchivedProjects(
            mergeProjectNames([], parsed),
          );
        }
      })
      .catch(() =>
        Alert.alert(
          'Storage error',
          'Archived projects could not be loaded.',
        ),
      )
      .finally(() => setArchivedProjectsLoaded(true));
  }, []);

  useEffect(() => {
    AsyncStorage.getItem(PROJECT_AREAS_STORAGE_KEY)
      .then(value => {
        if (!value) return;

        setProjectAreas(
          normalizeProjectAreas(JSON.parse(value)),
        );
      })
      .catch(() =>
        Alert.alert(
          'Storage error',
          'Project areas could not be loaded.',
        ),
      )
      .finally(() => setProjectAreasLoaded(true));
  }, []);


  useEffect(() => {
    AsyncStorage.getItem(REFERENCE_DOCUMENTS_STORAGE_KEY)
      .then(value => {
        if (!value) return;

        setReferenceDocuments(
          normalizeReferenceDocuments(JSON.parse(value)),
        );
      })
      .catch(() =>
        Alert.alert(
          'Storage error',
          'Reference documents could not be loaded.',
        ),
      )
      .finally(() => setReferenceDocumentsLoaded(true));
  }, []);

  useEffect(() => {
    AsyncStorage.getItem(PROJECT_DOCUMENTS_STORAGE_KEY)
      .then(value => {
        if (!value) return;

        setProjectDocuments(
          normalizeProjectDocuments(JSON.parse(value)),
        );
      })
      .catch(() =>
        Alert.alert(
          'Storage error',
          'Project documents could not be loaded.',
        ),
      )
      .finally(() => setProjectDocumentsLoaded(true));
  }, []);

  useEffect(() => {
    AsyncStorage.getItem(SCHEDULE_ITEMS_STORAGE_KEY)
      .then(value => {
        if (!value) return;

        setScheduleItems(
          normalizeScheduleItems(JSON.parse(value)),
        );
      })
      .catch(() =>
        Alert.alert(
          'Storage error',
          'Schedule items could not be loaded.',
        ),
      )
      .finally(() => setScheduleItemsLoaded(true));
  }, []);

  useEffect(() => {
    AsyncStorage.getItem(SCHEDULE_AI_EXTRACTOR_URL_STORAGE_KEY)
      .then(value => {
        setScheduleAiExtractorUrl(value || '');
      })
      .finally(() => setScheduleAiExtractorUrlLoaded(true));
  }, []);

  useEffect(() => {
    AsyncStorage.getItem(DISPLAY_NAME_STORAGE_KEY)
      .then(value => {
        setDisplayName(value || '');
      })
      .finally(() => setDisplayNameLoaded(true));
  }, []);

  useEffect(() => {
    AsyncStorage.getItem(CONTACTS_STORAGE_KEY)
      .then(value => {
        if (!value) return;

        setContactBook(
          normalizeContacts(JSON.parse(value)),
        );
      })
      .catch(() =>
        Alert.alert(
          'Storage error',
          'Contacts could not be loaded.',
        ),
      )
      .finally(() => setContactsLoaded(true));
  }, []);

  useEffect(() => {
    AsyncStorage.getItem(DRAFT_STORAGE_KEY)
      .then(value => {
        if (!value) return;

        const parsed = JSON.parse(value) as Partial<StoredDraft>;

        if (!parsed.draft) return;

        const recoveredDraft = normalizeUpdate(parsed.draft);

        if (hasMeaningfulDraft(recoveredDraft)) {
          setDraft(recoveredDraft);

          setDraftSavedAt(
            typeof parsed.savedAt === 'string'
              ? parsed.savedAt
              : null,
          );
        }
      })
      .catch(() =>
        Alert.alert(
          'Draft recovery error',
          'The unfinished update could not be restored.',
        ),
      )
      .finally(() => setDraftLoaded(true));
  }, []);

  useEffect(() => {
    if (!updatesLoaded) return;

    if (savedUpdatesSaveTimer.current) {
      clearTimeout(savedUpdatesSaveTimer.current);
    }

    savedUpdatesSaveTimer.current = setTimeout(() => {
      savedUpdatesSaveTimer.current = null;

      AsyncStorage.setItem(
        UPDATES_STORAGE_KEY,
        JSON.stringify(savedUpdates),
      ).catch(() => undefined);
    }, 750);

    return () => {
      if (savedUpdatesSaveTimer.current) {
        clearTimeout(savedUpdatesSaveTimer.current);
      }
    };
  }, [savedUpdates, updatesLoaded]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => {
      if (state !== 'background' && state !== 'inactive') return;
      if (!savedUpdatesSaveTimer.current) return;

      clearTimeout(savedUpdatesSaveTimer.current);
      savedUpdatesSaveTimer.current = null;

      AsyncStorage.setItem(
        UPDATES_STORAGE_KEY,
        JSON.stringify(savedUpdatesRef.current),
      ).catch(() => undefined);
    });

    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (!deletedUpdateTombstonesLoaded) return;

    AsyncStorage.setItem(
      DELETED_UPDATES_STORAGE_KEY,
      JSON.stringify(deletedUpdateTombstones),
    ).catch(() => undefined);
  }, [deletedUpdateTombstones, deletedUpdateTombstonesLoaded]);

  useEffect(() => {
    if (!projectsLoaded) return;

    AsyncStorage.setItem(
      PROJECTS_STORAGE_KEY,
      JSON.stringify(projectRecords),
    ).catch(() => undefined);
  }, [projectRecords, projectsLoaded]);

  useEffect(() => {
    if (!archivedProjectsLoaded) return;

    AsyncStorage.setItem(
      ARCHIVED_PROJECTS_STORAGE_KEY,
      JSON.stringify(archivedProjects),
    ).catch(() => undefined);
  }, [archivedProjects, archivedProjectsLoaded]);

  useEffect(() => {
    if (!projectAreasLoaded) return;

    AsyncStorage.setItem(
      PROJECT_AREAS_STORAGE_KEY,
      JSON.stringify(projectAreas),
    ).catch(() => undefined);
  }, [projectAreas, projectAreasLoaded]);


  useEffect(() => {
    if (!referenceDocumentsLoaded) return;

    AsyncStorage.setItem(
      REFERENCE_DOCUMENTS_STORAGE_KEY,
      JSON.stringify(referenceDocuments),
    ).catch(() => undefined);
  }, [referenceDocuments, referenceDocumentsLoaded]);

  useEffect(() => {
    if (!projectDocumentsLoaded) return;

    AsyncStorage.setItem(
      PROJECT_DOCUMENTS_STORAGE_KEY,
      JSON.stringify(projectDocuments),
    ).catch(() => undefined);
  }, [projectDocuments, projectDocumentsLoaded]);

  useEffect(() => {
    if (!scheduleItemsLoaded) return;

    AsyncStorage.setItem(
      SCHEDULE_ITEMS_STORAGE_KEY,
      JSON.stringify(scheduleItems),
    ).catch(() => undefined);
  }, [scheduleItems, scheduleItemsLoaded]);

  useEffect(() => {
    if (!scheduleAiExtractorUrlLoaded) return;

    AsyncStorage.setItem(
      SCHEDULE_AI_EXTRACTOR_URL_STORAGE_KEY,
      scheduleAiExtractorUrl,
    ).catch(() => undefined);
  }, [scheduleAiExtractorUrl, scheduleAiExtractorUrlLoaded]);

  useEffect(() => {
    if (!displayNameLoaded) return;

    AsyncStorage.setItem(DISPLAY_NAME_STORAGE_KEY, displayName).catch(
      () => undefined,
    );
  }, [displayName, displayNameLoaded]);

  useEffect(() => {
    if (!contactsLoaded) return;

    AsyncStorage.setItem(
      CONTACTS_STORAGE_KEY,
      JSON.stringify(contactBook),
    ).catch(() => undefined);
  }, [contactBook, contactsLoaded]);

  useEffect(() => {
    if (!draftLoaded) return;

    if (draftSaveTimer.current) {
      clearTimeout(draftSaveTimer.current);
    }

    draftSaveTimer.current = setTimeout(() => {
      if (!hasMeaningfulDraft(draft)) {
        setDraftSavedAt(null);

        AsyncStorage.removeItem(DRAFT_STORAGE_KEY).catch(
          () => undefined,
        );

        return;
      }

      const savedAt = new Date().toISOString();

      const storedDraft: StoredDraft = {
        draft,
        savedAt,
      };

      setDraftSavedAt(savedAt);

      AsyncStorage.setItem(
        DRAFT_STORAGE_KEY,
        JSON.stringify(storedDraft),
      ).catch(() => undefined);
    }, 750);

    return () => {
      if (draftSaveTimer.current) {
        clearTimeout(draftSaveTimer.current);
      }
    };
  }, [draft, draftLoaded]);

  useEffect(() => {
    if (!updatesLoaded || !draftLoaded || photoCleanupRan.current) {
      return;
    }

    photoCleanupRan.current = true;

    void cleanupStoredPhotoDirectory([draft, ...savedUpdates]);
  }, [updatesLoaded, draftLoaded, draft, savedUpdates]);

  const hasQueuedSyncRetries = useMemo(
    () => savedUpdates.some(update => updateNeedsAutomaticSyncRetry(update)),
    [savedUpdates],
  );

  useEffect(() => {
    if (!updatesLoaded || !hasQueuedSyncRetries) return;

    const timer = setInterval(() => {
      void hydrateQueuedUpdates();
    }, 30000);

    void hydrateQueuedUpdates();

    return () => clearInterval(timer);
  }, [updatesLoaded, hasQueuedSyncRetries]);

  useEffect(() => {
    if (!updatesLoaded) return;

    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') {
        void hydrateQueuedUpdates();
      }
    });

    return () => subscription.remove();
  }, [updatesLoaded, savedUpdates]);

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

  const projectStatsByName = useMemo(
    () => buildProjectStatsByName(savedUpdates),
    [savedUpdates],
  );

  const overviewProjectName =
    overviewProjectSelection === undefined
      ? detectedProjectName
      : overviewProjectSelection;

  useEffect(() => {
    let mounted = true;

    async function detectOverviewProject() {
      if (!GPS_CAPTURE_ENABLED || projectAreas.length === 0) {
        setDetectedProjectName(null);
        setGpsCandidateProjectNames([]);
        setProjectDetectionStatus('none');
        return;
      }

      setProjectDetectionStatus('checking');

      try {
        const snapshot = await getCurrentLocationSnapshot();
        const suggestion = findClosestProjectArea(snapshot, projectAreas);

        if (!mounted) return;

        if (!snapshot) {
          setDetectedProjectName(null);
          setGpsCandidateProjectNames([]);
          setProjectDetectionStatus('denied');
          return;
        }

        const gpsCandidates = likelyProjectCandidatesFromGps(
          snapshot,
          projectAreas,
          savedUpdates,
          activeProjects,
        );

        if (!suggestion?.withinRadius || gpsCandidates.topCandidates.length === 0) {
          setDetectedProjectName(null);
          setGpsCandidateProjectNames([]);
          setProjectDetectionStatus('unmatched');
          return;
        }

        if (gpsCandidates.ambiguous) {
          setDetectedProjectName(null);
          setGpsCandidateProjectNames(
            gpsCandidates.topCandidates.map(candidate => candidate.projectName),
          );
          setProjectDetectionStatus('multiple');
          return;
        }

        const projectName = gpsCandidates.clearProjectName;
        if (overviewProjectManuallySelected) {
          setDetectedProjectName(null);
          setGpsCandidateProjectNames(projectName ? [projectName] : []);
          setProjectDetectionStatus(projectName ? 'not_applied' : 'unmatched');
          return;
        }

        setDetectedProjectName(projectName);
        setGpsCandidateProjectNames(projectName ? [projectName] : []);
        setProjectDetectionStatus(projectName ? 'detected' : 'unmatched');
      } catch {
        if (!mounted) return;

        setDetectedProjectName(null);
        setGpsCandidateProjectNames([]);
        setProjectDetectionStatus('unavailable');
      }
    }

    void detectOverviewProject();

    return () => {
      mounted = false;
    };
  }, [activeProjects, overviewProjectManuallySelected, projectAreas, savedUpdates]);

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

  const currentDraftArea = useMemo(
    () =>
      projectAreas.find(area => area.id === draft.selectedAreaId) ||
      null,
    [projectAreas, draft.selectedAreaId],
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
      const baseSnapshot =
        snapshot ||
        (prev.gpsLatitude !== null &&
        prev.gpsLatitude !== undefined &&
        prev.gpsLongitude !== null &&
        prev.gpsLongitude !== undefined
          ? {
              latitude: prev.gpsLatitude,
              longitude: prev.gpsLongitude,
              accuracy: prev.gpsAccuracy ?? null,
              capturedAt:
                prev.locationCapturedAt || new Date().toISOString(),
            }
          : null);

      const locationFields = baseSnapshot
        ? locationFieldsFromSnapshot(baseSnapshot, area)
        : {
            selectedAreaId: area?.id || null,
            selectedAreaName: area?.name || null,
            gpsLatitude: prev.gpsLatitude ?? null,
            gpsLongitude: prev.gpsLongitude ?? null,
            gpsAccuracy: prev.gpsAccuracy ?? null,
            distanceFromSelectedAreaFeet: null,
            locationCapturedAt: prev.locationCapturedAt ?? null,
          };

      const next = {
        ...prev,
        ...locationFields,
        areaStatus: area ? 'confirmed' as const : 'unknown' as const,
        photos: prev.photos.map(photo => ({
          ...photo,
          ...locationFields,
        })),
      };

      nextDraftAfterAreaChange = next;
      return next;
    });

    if (area && nextDraftAfterAreaChange) {
      void recheckPhotosAfterAreaChange(nextDraftAfterAreaChange);
    }
  }

  async function recheckPhotosAfterAreaChange(updateSnapshot: ProjectUpdate) {
    const photosNeedingRecheck = updateSnapshot.photos.filter(photo => {
      const reason = photo.photoIntelligence?.diagnostics?.noPriorReason;
      return reason === 'missing_area_key' || reason === 'no_same_area';
    });

    for (const photo of photosNeedingRecheck) {
      await analyzePhotoWithAuthHydrationRetry({
        update: updateSnapshot,
        photo,
        priorUpdates: savedUpdatesRef.current,
      });
    }
  }

  async function refreshDraftLocation() {
    if (!GPS_CAPTURE_ENABLED) {
      Alert.alert(
        'GPS rebuild needed',
        'GPS is temporarily disabled so the app will not crash. I added the missing native permissions; rebuild the iPhone app with npx expo run:ios, then GPS can be re-enabled.',
      );

      return;
    }

    Alert.alert(
      'Use GPS location?',
      'If this installed app was not rebuilt after adding Location, iOS may close it. Rebuild once with npx expo run:ios before using GPS.',
      [
        {
          text: 'Cancel',
          style: 'cancel',
        },
        {
          text: 'Use GPS',
          onPress: () => {
            draftLocationCaptureRef.current = captureDraftLocation();
          },
        },
      ],
    );
  }

  async function captureDraftLocation() {
    setLocationStatus('Capturing GPS...');

    try {
      const snapshot = await getCurrentLocationSnapshot();

      if (!snapshot) {
        setDraftAreaSuggestion(null);
        setLocationStatus(
          'Location permission denied. Choose Project Area manually.',
        );
        return null;
      }

      const suggestion = findClosestProjectArea(
        snapshot,
        projectAreas,
      );

      setDraftAreaSuggestion(suggestion);
      setLocationStatus('Area auto-detected');

      setDraft(prev => {
        const selectedArea =
          projectAreas.find(area => area.id === prev.selectedAreaId) ||
          null;
        const locationFields = locationFieldsFromSnapshot(
          snapshot,
          selectedArea,
        );

        return {
          ...prev,
          ...locationFields,
          areaStatus:
            selectedArea
              ? 'confirmed'
              : suggestion?.withinRadius
                ? 'suggested'
                : prev.areaStatus,
        };
      });

      return {
        snapshot,
        suggestion,
      };
    } catch {
      setDraftAreaSuggestion(null);
      setLocationStatus(
        'GPS could not be captured. Choose Project Area manually.',
      );
      return null;
    }
  }

  async function waitForDraftLocationCapture() {
    const pending = draftLocationCaptureRef.current;
    if (!pending) return;

    await Promise.race([
      pending.catch(() => undefined),
      delay(DRAFT_LOCATION_CAPTURE_WAIT_MS),
    ]);
  }

  function confirmSuggestedArea() {
    if (!draftAreaSuggestion) {
      Alert.alert(
        'No suggestion yet',
        'Refresh GPS Location first, then confirm the suggested area.',
      );

      return;
    }

    const snapshot =
      draft.gpsLatitude !== null &&
      draft.gpsLatitude !== undefined &&
      draft.gpsLongitude !== null &&
      draft.gpsLongitude !== undefined
        ? {
            latitude: draft.gpsLatitude,
            longitude: draft.gpsLongitude,
            accuracy: draft.gpsAccuracy ?? null,
            capturedAt:
              draft.locationCapturedAt || new Date().toISOString(),
          }
        : null;

    applyAreaAndLocationToDraft(draftAreaSuggestion.area, snapshot);
    setLocationStatus('Project Area confirmed');
  }

  function changeDraftArea(areaId: string) {
    const area =
      projectAreas.find(item => item.id === areaId) || null;

    applyAreaAndLocationToDraft(area);
    setLocationStatus(
      area
        ? `Project Area set to ${area.name}`
        : 'Project Area cleared',
    );
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
    }));
    setScreen('PIEAnalysis');
  }

  function continueToPIEAnalysis() {
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
    }));
    setScreen('PIEAnalysis');
  }

  function openReviewFromPIEAnalysis() {
    const summary = summarizePIEStatusForUpdate(draft);

    setDraft(prev => ({
      ...prev,
      pieStatus: summary.status,
      pieSummary: summary.summary,
      status: 'ready_to_send',
      workflowTimestamps: {
        ...(prev.workflowTimestamps || {}),
        reviewOpenedAt: new Date().toISOString(),
      },
    }));
    setScreen('BuildUpdate');
  }

  function updateDocumentEverywhere(
    documentId: string,
    updater: (document: ProjectDocument) => ProjectDocument,
  ) {
    setProjectDocuments(prev =>
      prev.map(document =>
        document.id === documentId ? updater(document) : document,
      ),
    );

    setDraft(prev => ({
      ...prev,
      documents: (prev.documents || []).map(document =>
        document.id === documentId ? updater(document) : document,
      ),
    }));

    setSavedUpdates(prev =>
      prev.map(update => ({
        ...update,
        documents: (update.documents || []).map(document =>
          document.id === documentId ? updater(document) : document,
        ),
      })),
    );
  }

  async function retryProjectDocumentUpload(
    documentId: string,
    providedDocument?: ProjectDocument,
  ) {
    const target =
      providedDocument ||
      projectDocuments.find(document => document.id === documentId) ||
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
    }));

    try {
      const result = await uploadPhoto({
        bucket: PROJECT_DOCUMENT_UPLOAD_FOLDER,
        path: storagePath,
        uri: target.localUri,
        contentType: target.mimeType || 'application/octet-stream',
        upsert: true,
      });

      const completedAt = new Date().toISOString();

      updateDocumentEverywhere(documentId, document => ({
        ...document,
        status: result.ok ? 'uploaded' : 'failed',
        storagePath,
        uploadedAt: result.ok ? completedAt : document.uploadedAt,
        updatedAt: completedAt,
      }));
    } catch {
      updateDocumentEverywhere(documentId, document => ({
        ...document,
        status: 'failed',
        updatedAt: new Date().toISOString(),
      }));
    }
  }

  function attachProjectDocumentToDraft(document: ProjectDocument) {
    setProjectDocuments(prev => [document, ...prev]);
    setDraft(prev => ({
      ...prev,
      documents: [document, ...(prev.documents || [])],
    }));

    void retryProjectDocumentUpload(document.id, document);
  }

  function createProjectDocumentFromAsset(asset: {
    uri: string;
    name?: string | null;
    mimeType?: string | null;
    size?: number | null;
  }, context?: {
    projectName?: string;
    areaId?: string | null;
    updateId?: string | null;
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
      category: 'Other',
      mimeType: asset.mimeType || null,
      sizeBytes: typeof asset.size === 'number' ? asset.size : null,
      localUri: asset.uri,
      storagePath: buildProjectDocumentStoragePath(id, projectId, name),
      createdAt: now,
      updatedAt: now,
      importedAt: now,
      status: 'local',
      uploadAttemptCount: 0,
    }) as ProjectDocument;
  }

  function confirmAndAttachProjectDocument(
    document: ProjectDocument,
    duplicate: ProjectDocument | null,
    attachToDraft = true,
  ) {
    if (duplicate) {
      Alert.alert(
        'Possible duplicate document',
        `${document.name} looks like it already exists for this project.`,
        [
          {
            text: 'Cancel',
            style: 'cancel',
          },
          {
            text: 'Upload Anyway',
            onPress: () =>
              attachToDraft
                ? attachProjectDocumentToDraft({
                    ...document,
                    duplicateOf: duplicate.id,
                  })
                : saveProjectDocument({
                    ...document,
                    duplicateOf: duplicate.id,
                  }),
          },
        ],
      );
      return;
    }

    if (attachToDraft) {
      attachProjectDocumentToDraft(document);
      return;
    }

    saveProjectDocument(document);
  }

  function saveProjectDocument(document: ProjectDocument) {
    setProjectDocuments(prev => [document, ...prev]);
    void retryProjectDocumentUpload(document.id, document);
  }

  function promptDocumentProjectSelection(
    asset: {
      uri: string;
      name?: string | null;
      mimeType?: string | null;
      size?: number | null;
    },
    defaultProjectName: string,
  ) {
    setDocumentUploadRequest({
      asset,
      selected: new Set([defaultProjectName]),
    });
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

      return { ...prev, selected: nextSelected };
    });
  }

  function cancelDocumentProjectSelection() {
    setDocumentUploadRequest(null);
  }

  function confirmDocumentProjectSelection() {
    if (!documentUploadRequest) return;

    const { asset, selected } = documentUploadRequest;

    setDocumentUploadRequest(null);

    // Same picked file, one ProjectDocument record per selected project -
    // each project keeps its own independent upload/retry/status lifecycle,
    // matching how documents already work everywhere else in this screen.
    selected.forEach(projectName => {
      const document = createProjectDocumentFromAsset(asset, {
        projectName,
        areaId: null,
        updateId: null,
      });
      const duplicate = duplicateProjectDocumentForAsset(
        projectDocuments,
        document.projectId,
        {
          name: document.name,
          mimeType: document.mimeType,
          size: document.sizeBytes,
        },
      );

      confirmAndAttachProjectDocument(document, duplicate, false);
    });
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

      if (asset.size && asset.size > LARGE_PROJECT_DOCUMENT_BYTES) {
        Alert.alert(
          'Large document',
          'This file may take longer to upload. You can continue the field update while upload runs in the background.',
        );
      }

      const document = createProjectDocumentFromAsset({
        uri: asset.uri,
        name: asset.name,
        mimeType: asset.mimeType,
        size: asset.size,
      });
      const duplicate = duplicateProjectDocumentForAsset(
        projectDocuments,
        document.projectId,
        {
          name: document.name,
          mimeType: document.mimeType,
          size: document.sizeBytes,
        },
      );

      confirmAndAttachProjectDocument(document, duplicate);
    } catch {
      Alert.alert(
        'Document unavailable',
        'The selected document could not be attached to this update.',
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

      if (asset.size && asset.size > LARGE_PROJECT_DOCUMENT_BYTES) {
        Alert.alert(
          'Large document',
          'This file may take longer to upload. You can continue using the project workspace while upload runs in the background.',
        );
      }

      promptDocumentProjectSelection(
        {
          uri: asset.uri,
          name: asset.name,
          mimeType: asset.mimeType,
          size: asset.size,
        },
        projectName,
      );
    } catch {
      Alert.alert(
        'Document unavailable',
        'The selected document could not be added to this project.',
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

      if (!attachToDraft) {
        promptDocumentProjectSelection(photoAsset, projectName);
        return;
      }

      const document = createProjectDocumentFromAsset(photoAsset, {
        projectName,
        areaId: draft.selectedAreaId || null,
        updateId: draft.id,
      });

      confirmAndAttachProjectDocument(document, null, true);
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

  function saveDraftFromReview() {
    const idempotencyKey = draft.idempotencyKey || draft.stableSendId || `send-${draft.id}`;
    const saved: ProjectUpdate = {
      ...draft,
      status: 'draft',
      pieStatus: draftPIEStatus.status,
      pieSummary: draftPIEStatus.summary,
      stableSendId: idempotencyKey,
      idempotencyKey,
      generatedMessage: buildGeneratedUpdateMessage(draft, draftPIEStatus),
    };

    setSavedUpdates(prev => [
      saved,
      ...prev.filter(item => item.id !== saved.id),
    ]);
    saveCloudUpdate(saved);
    syncUpdatePhotosToCloud(saved);
    setSelectedWorkspaceProject(saved.projectName);
    setDraft(createDraft(saved.projectName));
    setDraftSavedAt(null);
    AsyncStorage.removeItem(DRAFT_STORAGE_KEY).catch(() => undefined);
    Alert.alert('Draft saved', 'This field update was saved as a draft.');
    setScreen('ProjectWorkspace');
  }

  async function sendFieldUpdate() {
    const issue = minimumSendDataIssue(draft);

    if (issue) {
      Alert.alert('Cannot send yet', issue, [
        ...(draft.recipients.contactIds.length === 0
          ? [
              {
                text: 'Change Recipients',
                onPress: openContacts,
              },
            ]
          : []),
        {
          text: 'Save Draft',
          onPress: saveDraftFromReview,
        },
        {
          text: 'Edit',
          style: 'cancel',
        },
      ]);

      return;
    }

    const now = new Date().toISOString();
    const pieSummary = summarizePIEStatusForUpdate(draft);
    const idempotencyKey = draft.idempotencyKey || draft.stableSendId || `send-${draft.id}`;
    const sendAttempts = (draft.sendAttempts || 0) + 1;
    const baseUpdate: ProjectUpdate = {
      ...draft,
      status: 'ready_to_send',
      stableSendId: idempotencyKey,
      idempotencyKey,
      sendAttempts,
      lastSendAttemptAt: now,
      pieStatus: pieSummary.status,
      pieSummary: pieSummary.summary,
      generatedMessage: buildGeneratedUpdateMessage(draft, pieSummary),
      workflowTimestamps: {
        ...(draft.workflowTimestamps || {}),
        sendTappedAt: now,
      },
    };

    const queuedUpdate: ProjectUpdate = {
      ...baseUpdate,
      status: 'queued',
    };

    setSavedUpdates(prev => [
      queuedUpdate,
      ...prev.filter(item => item.id !== queuedUpdate.id),
    ]);
    setSelectedWorkspaceProject(queuedUpdate.projectName);

    try {
      const tokenResult = await getCurrentSessionAccessToken();
      const tokenLookup = tokenResult.data;
      const sessionTokenPresent = tokenLookup?.status === 'token_present';
      if (!sessionTokenPresent) {
        const resolvedAt = new Date().toISOString();
        const skippedDiagnostics = buildSkippedSyncDiagnostics(
          tokenLookup?.missingReason === 'signed_out'
            ? 'signed_out'
            : 'auth',
          now,
          1,
          false,
        );
        const finalUpdate: ProjectUpdate = {
          ...queuedUpdate,
          status: 'failed',
          syncDiagnostics: skippedDiagnostics,
          workflowTimestamps: {
            ...(queuedUpdate.workflowTimestamps || {}),
            sendResolvedAt: resolvedAt,
          },
        };
        setSavedUpdates(prev => [
          finalUpdate,
          ...prev.filter(item => item.id !== finalUpdate.id),
        ]);
        Alert.alert(queuedStatusCopyForUpdate(finalUpdate));
        setDraft(createDraft(queuedUpdate.projectName));
        setDraftSavedAt(null);
        AsyncStorage.removeItem(DRAFT_STORAGE_KEY).catch(() => undefined);
        setScreen('ProjectWorkspace');
        return;
      }

      const { syncResult, workAttempt } = await runFieldUpdateCloudSync(queuedUpdate);
      const syncDiagnostics = buildSyncDiagnosticsFromUpload(
        syncResult,
        now,
        sessionTokenPresent,
        workAttempt,
        queuedUpdate.sendAttempts || 1,
      );
      const resolvedAt = new Date().toISOString();
      const finalUpdate: ProjectUpdate = {
        ...queuedUpdate,
        status: statusForSyncDiagnostics(syncDiagnostics),
        syncDiagnostics,
        workflowTimestamps: {
          ...(queuedUpdate.workflowTimestamps || {}),
          sendResolvedAt: resolvedAt,
        },
      };

      setSavedUpdates(prev => [
        finalUpdate,
        ...prev.filter(item => item.id !== finalUpdate.id),
      ]);

      if (finalUpdate.status === 'sent') {
        Alert.alert('Update sent', 'The field update was saved and added to the project workspace.');
      } else {
        Alert.alert(queuedStatusCopyForUpdate(finalUpdate));
      }
    } catch (error) {
      const resolvedAt = new Date().toISOString();
      const failureCategory = classifySyncFailureCategory([
        error instanceof Error ? error.message : 'unknown sync error',
      ]);
      const syncDiagnostics = buildSkippedSyncDiagnostics(
        failureCategory,
        now,
        1,
        null,
      );
      const failedOrQueuedUpdate: ProjectUpdate = {
        ...queuedUpdate,
        status: statusForSyncDiagnostics(syncDiagnostics),
        syncDiagnostics,
        workflowTimestamps: {
          ...(queuedUpdate.workflowTimestamps || {}),
          sendResolvedAt: resolvedAt,
        },
      };
      setSavedUpdates(prev => [
        failedOrQueuedUpdate,
        ...prev.filter(item => item.id !== failedOrQueuedUpdate.id),
      ]);
      Alert.alert(queuedStatusCopyForUpdate(failedOrQueuedUpdate));
    }

    setDraft(createDraft(queuedUpdate.projectName));
    setDraftSavedAt(null);
    AsyncStorage.removeItem(DRAFT_STORAGE_KEY).catch(() => undefined);
    setScreen('ProjectWorkspace');
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

    setSavedUpdates(prev => [
      retryUpdate,
      ...prev.filter(item => item.id !== retryUpdate.id),
    ]);

    try {
      const tokenResult = await getCurrentSessionAccessToken();
      const tokenLookup = tokenResult.data;
      const sessionTokenPresent = tokenLookup?.status === 'token_present';
      if (!sessionTokenPresent) {
        const syncDiagnostics = buildSkippedSyncDiagnostics(
          tokenLookup?.missingReason === 'signed_out'
            ? 'signed_out'
            : 'auth',
          now,
          1,
          false,
        );
        const finalUpdate: ProjectUpdate = {
          ...retryUpdate,
          status: 'failed',
          syncDiagnostics,
          workflowTimestamps: {
            ...(retryUpdate.workflowTimestamps || {}),
            sendResolvedAt: new Date().toISOString(),
          },
        };
        setSavedUpdates(prev => [
          finalUpdate,
          ...prev.filter(item => item.id !== finalUpdate.id),
        ]);
        return;
      }

      const { syncResult, workAttempt } = await runFieldUpdateCloudSync(retryUpdate);
      const syncDiagnostics = buildSyncDiagnosticsFromUpload(
        syncResult,
        now,
        sessionTokenPresent,
        workAttempt,
        retryUpdate.sendAttempts || 1,
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

      setSavedUpdates(prev => [
        finalUpdate,
        ...prev.filter(item => item.id !== finalUpdate.id),
      ]);
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
        ...retryUpdate,
        status: statusForSyncDiagnostics(syncDiagnostics),
        syncDiagnostics,
      };
      setSavedUpdates(prev => [
        failedOrQueuedUpdate,
        ...prev.filter(item => item.id !== failedOrQueuedUpdate.id),
      ]);
    }
  }

  async function hydrateQueuedUpdates() {
    if (queuedHydrationInFlight.current) return;

    const queuedUpdates = savedUpdatesRef.current.filter(updateNeedsAutomaticSyncRetry);

    if (queuedUpdates.length === 0) return;

    queuedHydrationInFlight.current = true;

    try {
      const tokenResult = await getCurrentSessionAccessToken();
      const tokenLookup = tokenResult.data;
      const sessionTokenPresent = tokenLookup?.status === 'token_present';

      const resolvedAt = new Date().toISOString();

      if (!sessionTokenPresent) {
        const syncDiagnostics = buildSkippedSyncDiagnostics(
          tokenLookup?.missingReason === 'signed_out'
            ? 'signed_out'
            : 'auth',
          resolvedAt,
          queuedUpdates.length,
          false,
        );
        const queuedIds = new Set(queuedUpdates.map(update => update.id));

        setSavedUpdates(prev =>
          prev.map(update =>
            queuedIds.has(update.id)
              ? {
                  ...update,
                  status: 'failed',
                  syncDiagnostics,
                  workflowTimestamps: {
                    ...(update.workflowTimestamps || {}),
                    sendResolvedAt:
                      update.workflowTimestamps?.sendResolvedAt || resolvedAt,
                  },
                }
              : update,
          ),
        );
        return;
      }

      for (const update of queuedUpdates) {
        const attemptStartedAt = new Date().toISOString();
        const { syncResult, workAttempt } = await runFieldUpdateCloudSync(update);
        const syncDiagnostics = buildSyncDiagnosticsFromUpload(
          syncResult,
          attemptStartedAt,
          sessionTokenPresent,
          workAttempt,
          update.sendAttempts || null,
        );

        setSavedUpdates(prev =>
          prev.map(item =>
            item.id === update.id
              ? {
                  ...item,
                  status: statusForSyncDiagnostics(syncDiagnostics),
                  syncDiagnostics,
                  workflowTimestamps: {
                    ...(item.workflowTimestamps || {}),
                    sendResolvedAt:
                      item.workflowTimestamps?.sendResolvedAt || resolvedAt,
                  },
                }
              : item,
          ),
        );
      }
    } finally {
      queuedHydrationInFlight.current = false;
    }
  }

  async function removeMissingSyncPhotos(missingPhotos: MissingSyncPhoto[]) {
    const missingByUpdateId = new Map<string, Set<string>>();

    for (const missingPhoto of missingPhotos) {
      const photoIds = missingByUpdateId.get(missingPhoto.updateId) || new Set<string>();
      photoIds.add(missingPhoto.photoId);
      missingByUpdateId.set(missingPhoto.updateId, photoIds);
    }

    setSavedUpdates(prev =>
      prev.map(update => {
        const missingPhotoIds = missingByUpdateId.get(update.id);
        if (!missingPhotoIds) return update;

        return {
          ...update,
          photos: update.photos.filter(photo => !missingPhotoIds.has(photo.id)),
        };
      }),
    );
  }

  function beginDraftForProject(projectName: string) {
    setDraft(createDraft(projectName));
    setSelectedWorkspaceProject(projectName);
    setScreen('AddPhotos');
    draftLocationCaptureRef.current = captureDraftLocation();
  }

  function createNewUpdate(projectName?: string) {
    if (!projectName && activeProjects.length === 0) {
      Alert.alert(
        'No projects yet',
        'Add a new project or reopen an archived project first.',
      );

      setScreen('Projects');

      return;
    }

    const confidentTarget =
      projectName ||
      (activeProjects.length === 1 ? activeProjects[0] : null) ||
      overviewProjectSelection ||
      (projectDetectionStatus === 'detected' ? detectedProjectName : null);

    function proceed() {
      if (confidentTarget) {
        beginDraftForProject(confidentTarget);
      } else {
        setScreen('SelectProject');
      }
    }

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
            onPress: () => {
              const discardedDraft = draft;

              proceed();

              void deleteUnreferencedPhotosFromUpdate(
                discardedDraft,
                savedUpdates,
              );
            },
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

  async function saveCaptureMemory(memory: DAVEConfirmedCaptureMemory) {
    await localDAVECaptureMemoryRepository.save(memory);
    const refreshedMemories = await localDAVECaptureMemoryRepository.list();
    setCaptureMemories([...refreshedMemories]);
  }

  async function deleteCaptureMemory(memoryId: string) {
    const deleted = await localDAVECaptureMemoryRepository.delete(memoryId);
    if (!deleted) throw new Error('The saved memory was already removed.');
    setCaptureMemories(current => current.filter(memory => memory.id !== memoryId));
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
            const discardedDraft = draft;
            const projectName =
              activeProjects[0] || DEFAULT_PROJECTS[0];

            setDraft(createDraft(projectName));
            setDraftSavedAt(null);

            AsyncStorage.removeItem(
              DRAFT_STORAGE_KEY,
            ).catch(() => undefined);

            void deleteUnreferencedPhotosFromUpdate(
              discardedDraft,
              savedUpdates,
            );
          },
        },
      ],
    );
  }

  

  function changeDraftProject(projectName: string) {
    beginDraftForProject(projectName);
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

  const exists = projects.some(
    project =>
      project.toLowerCase() === trimmed.toLowerCase(),
  );

  if (exists) {
    Alert.alert(
      'Already added',
      `${trimmed} is already in your project list.`,
    );

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

  function closeProject(projectName: string) {
    Alert.alert(
      'Close project?',
      `${projectName} will move to Archived Projects.`,
      [
        {
          text: 'Cancel',
          style: 'cancel',
        },
        {
          text: 'Close Project',
          style: 'destructive',
          onPress: () =>
            setArchivedProjects(prev =>
              mergeProjectNames(prev, [projectName]),
            ),
        },
      ],
    );
  }

  function reopenProject(projectName: string) {
    setArchivedProjects(prev =>
      prev.filter(
        project =>
          project.toLowerCase() !==
          projectName.toLowerCase(),
      ),
    );
  }

  async function deleteProjectPermanently(projectName: string) {
    setDeletingProjectName(projectName);

    try {
      await deleteCloudProject(projectName);

      const remainingProjects = projects.filter(
        project => project.toLowerCase() !== projectName.toLowerCase(),
      );
      const remainingActiveProjects = remainingProjects.filter(
        project =>
          !archivedProjects.some(
            archived => archived.toLowerCase() === project.toLowerCase(),
          ),
      );
      const fallbackProject =
        remainingActiveProjects[0] || DEFAULT_PROJECTS[0];

      setProjects(remainingProjects);
      setProjectRecords(prev => prev.filter(
        project => project.name.toLowerCase() !== projectName.toLowerCase(),
      ));
      setArchivedProjects(prev =>
        prev.filter(
          project => project.toLowerCase() !== projectName.toLowerCase(),
        ),
      );
      setSavedUpdates(prev =>
        prev.filter(update => !projectMatchesScope(update, projectName)),
      );
      setProjectDocuments(prev =>
        prev.filter(
          document => !projectDocumentMatchesProject(document, projectName),
        ),
      );
      setScheduleItems(prev =>
        prev.filter(
          item => item.projectName.toLowerCase() !== projectName.toLowerCase(),
        ),
      );

      if (draft.projectName.toLowerCase() === projectName.toLowerCase()) {
        setDraft(createDraft(fallbackProject));
        setDraftSavedAt(null);
        AsyncStorage.removeItem(DRAFT_STORAGE_KEY).catch(() => undefined);
      }

      if (
        overviewProjectSelection &&
        overviewProjectSelection.toLowerCase() === projectName.toLowerCase()
      ) {
        setOverviewProjectSelection(undefined);
        setOverviewProjectManuallySelected(false);
      }

      setSelectedWorkspaceProject(fallbackProject);
      setScreen('Projects');
    } catch {
      Alert.alert(
        'Delete failed',
        `${projectName} could not be deleted. Check your connection and try again.`,
      );
    } finally {
      setDeletingProjectName(null);
    }
  }

  function addProjectArea(name: string) {
    const trimmed = name.trim();

    if (!trimmed) {
      Alert.alert(
        'Area name needed',
        'Enter a project area name first.',
      );

      return false;
    }

    setProjectAreas(prev => [
      {
        id: uid(),
        name: trimmed,
        latitude:
          DEFAULT_PROJECT_AREAS[0].latitude,
        longitude:
          DEFAULT_PROJECT_AREAS[0].longitude,
        radiusFeet: 250,
        locationCapturedAt: null,
      },
      ...prev,
    ]);

    return true;
  }

  function updateProjectArea(
    areaId: string,
    next: Partial<ProjectArea>,
  ) {
    setProjectAreas(prev =>
      prev.map(area =>
        area.id === areaId
          ? normalizeProjectArea({
              ...area,
              ...next,
            })
          : area,
      ),
    );
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
            setProjectAreas(prev =>
              prev.filter(item => item.id !== areaId),
            );

            if (draft.selectedAreaId === areaId) {
              changeDraftArea('');
            }
          },
        },
      ],
    );
  }

  async function useCurrentLocationForArea(areaId: string) {
    if (!GPS_CAPTURE_ENABLED) {
      Alert.alert(
        'GPS rebuild needed',
        'GPS is temporarily disabled so the app will not crash. I added the missing native permissions; rebuild the iPhone app with npx expo run:ios, then GPS can be re-enabled.',
      );

      return;
    }

    Alert.alert(
      'Use current GPS?',
      'If this installed app was not rebuilt after adding Location, iOS may close it. Rebuild once with npx expo run:ios before using GPS.',
      [
        {
          text: 'Cancel',
          style: 'cancel',
        },
        {
          text: 'Use GPS',
          onPress: () => {
            void saveCurrentLocationForArea(areaId);
          },
        },
      ],
    );
  }

  async function saveCurrentLocationForArea(areaId: string) {
    try {
      const snapshot = await getCurrentLocationSnapshot();

      if (!snapshot) {
        Alert.alert(
          'Location access needed',
          'Allow location access, or enter/update this area manually later.',
        );

        return;
      }

      updateProjectArea(areaId, {
        latitude: snapshot.latitude,
        longitude: snapshot.longitude,
        locationCapturedAt: snapshot.capturedAt,
      });

      Alert.alert(
        'Area location saved',
        'This project area now uses your current GPS location.',
      );
    } catch {
      Alert.alert(
        'GPS unavailable',
        'Current location could not be captured right now.',
      );
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
          photos.push(withDraftPhotoContext(await photoFromAsset(asset), draft));
        }

        const nextDraft = {
          ...draft,
          photos: [...draft.photos, ...photos],
          workflowTimestamps: {
            ...(draft.workflowTimestamps || {}),
            cameraActionStartedAt:
              draft.workflowTimestamps?.cameraActionStartedAt ||
              cameraActionStartedAt,
            firstPhotoAddedAt:
              draft.workflowTimestamps?.firstPhotoAddedAt ||
              new Date().toISOString(),
          },
        };
        setDraft(prev => ({
          ...prev,
          photos: [...prev.photos, ...photos],
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

  async function takePhoto() {
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
          photos.push(withDraftPhotoContext(await photoFromAsset(asset), draft));
        }

        const nextDraft = {
          ...draft,
          photos: [...draft.photos, ...photos],
          workflowTimestamps: {
            ...(draft.workflowTimestamps || {}),
            cameraActionStartedAt:
              draft.workflowTimestamps?.cameraActionStartedAt ||
              cameraActionStartedAt,
            firstPhotoAddedAt:
              draft.workflowTimestamps?.firstPhotoAddedAt ||
              new Date().toISOString(),
          },
        };
        setDraft(prev => ({
          ...prev,
          photos: [...prev.photos, ...photos],
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
    return {
      ...photo,
      selectedAreaId: sourceDraft.selectedAreaId ?? null,
      selectedAreaName: sourceDraft.selectedAreaName ?? null,
      gpsLatitude: sourceDraft.gpsLatitude ?? null,
      gpsLongitude: sourceDraft.gpsLongitude ?? null,
      gpsAccuracy: sourceDraft.gpsAccuracy ?? null,
      distanceFromSelectedAreaFeet: sourceDraft.distanceFromSelectedAreaFeet ?? null,
      locationCapturedAt: sourceDraft.locationCapturedAt || new Date().toISOString(),
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
      const result = await analyzeProjectPhotoWithVision({
        update,
        photo,
        priorUpdates,
        retryAttempt,
      });

      applyPhotoIntelligenceResult(photo.id, result);

      if (!photoIntelligenceNeedsAuthHydrationRetry(result)) return;
      if (attempt === PIE_AUTH_HYDRATION_RETRY_COUNT) return;

      await waitForPIEAuthHydrationRetry();
    }
  }

  function applyPhotoIntelligenceResult(
    photoId: string,
    result: PIEPhotoIntelligenceDisplayState,
  ) {
    const applyToUpdate = (update: ProjectUpdate): ProjectUpdate => {
      const nextUpdate = {
        ...update,
        photos: update.photos.map(photo =>
          photo.id === photoId
            ? { ...photo, photoIntelligence: result }
            : photo,
        ),
      };
      const summary = summarizePIEStatusForUpdate(nextUpdate);
      const observedFindings = uniqueStrings([
        ...(update.observedFindings || []),
        ...observedFindingsForPIEResult(result),
      ]);
      const possibleInterpretations = uniqueStrings([
        ...(summary.status === 'complete' ? update.possibleInterpretations || [] : []),
        ...possibleInterpretationsForPIEResult(result),
      ]);
      const suggestedNote = buildSuggestedObservedNote(observedFindings);
      const shouldApplySuggestedNote =
        Boolean(suggestedNote) &&
        (!update.notes.trim() || update.notes === update.pieSuggestedNote);

      return {
        ...nextUpdate,
        pieStatus: summary.status,
        pieSummary: summary.summary,
        observedFindings,
        possibleInterpretations,
        notes: shouldApplySuggestedNote ? suggestedNote || '' : update.notes,
        pieSuggestedNote: suggestedNote,
        pieSuggestedNoteAccepted: shouldApplySuggestedNote,
        pieCompletedAt:
          summary.status !== 'analyzing'
            ? new Date().toISOString()
            : update.pieCompletedAt || null,
      };
    };

    setDraft(prev => applyToUpdate(prev));
    setSavedUpdates(prev => prev.map(applyToUpdate));
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
      setPhotoAuthMessage('Enter the Supabase account email and password.');
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
      void hydrateQueuedUpdates();
      await runPhotoAnalysisRetry(pending.update, pending.photo);
    } finally {
      setPhotoAuthSubmitting(false);
    }
  }

  async function submitPhotoIntelligenceDevelopmentSignUp() {
    if (!photoAuthRequest) return;

    const email = photoAuthEmail.trim();
    if (!email || !photoAuthPassword) {
      setPhotoAuthMessage('Enter an email and password for the development Supabase account.');
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
            : 'Development account was created, but Supabase did not return a signed-in session. If email confirmation is enabled, confirm the email and sign in.',
        );
        return;
      }

      const pending = photoAuthRequest;
      setPhotoAuthRequest(null);
      setPhotoAuthPassword('');
      setPhotoAuthMessage(null);
      void hydrateQueuedUpdates();
      await runPhotoAnalysisRetry(pending.update, pending.photo);
    } finally {
      setPhotoAuthSubmitting(false);
    }
  }

  async function runPhotoAnalysisRetry(update: ProjectUpdate, photo: UpdatePhoto) {
    applyPhotoIntelligenceResult(photo.id, buildAnalyzingPhotoIntelligenceState());

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
    const deletedPhoto = draft.photos.find(
      photo => photo.id === photoId,
    );
    const nextDraft = {
      ...draft,
      photos: draft.photos.filter(photo => photo.id !== photoId),
    };

    setDraft(prev => ({
      ...prev,
      photos: prev.photos.filter(
        photo => photo.id !== photoId,
      ),
    }));

    if (deletedPhoto) {
      void deleteStoredPhotoIfUnused(deletedPhoto.uri, [
        nextDraft,
        ...savedUpdates,
      ]);
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

  async function exportBackup() {
    const targetDirectory =
      FileSystem.cacheDirectory || FileSystem.documentDirectory;

    if (!targetDirectory) {
      Alert.alert(
        'Backup unavailable',
        'A local folder for the backup file could not be found.',
      );

      return;
    }

    const backup: AppBackup = {
      version: BACKUP_VERSION,
      exportedAt: new Date().toISOString(),
      savedUpdates,
      projects,
      archivedProjects,
      contacts: contactBook,
      projectAreas,
      referenceDocuments,
      projectDocuments,
      scheduleItems,
      activeDraft: hasMeaningfulDraft(draft)
        ? {
            draft,
            savedAt: draftSavedAt || new Date().toISOString(),
          }
        : null,
    };

    const fileUri = `${targetDirectory}project-photo-update-backup-${isoToday()}.json`;

    try {
      await FileSystem.writeAsStringAsync(
        fileUri,
        JSON.stringify(backup, null, 2),
      );

      const canShare = await Sharing.isAvailableAsync();

      if (!canShare) {
        Alert.alert(
          'Backup created',
          'The backup file was created, but sharing is not available on this device. Reference document metadata is included; document files remain stored locally on this phone.',
        );

        return;
      }

      await Sharing.shareAsync(fileUri, {
        dialogTitle: 'Backup Project Photo Update Tool',
        mimeType: 'application/json',
        UTI: 'public.json',
      });
    } catch {
      Alert.alert(
        'Backup failed',
        'The backup file could not be created.',
      );
    }
  }

  function applyRestoredData(data: RestoredAppData) {
    const restoredProjects = mergeProjectNames(
      DEFAULT_PROJECTS,
      data.projects,
    );

    setSavedUpdates(data.savedUpdates);
    setProjects(restoredProjects);
    setArchivedProjects(
      mergeProjectNames([], data.archivedProjects),
    );
    setContactBook(data.contactBook);
    setProjectAreas(data.projectAreas);
    setReferenceDocuments(data.referenceDocuments);
    setProjectDocuments(data.projectDocuments);
    setScheduleItems(data.scheduleItems);

    if (data.storedDraft) {
      setDraft(data.storedDraft.draft);
      setDraftSavedAt(data.storedDraft.savedAt);
    } else {
      setDraft(
        createDraft(restoredProjects[0] || DEFAULT_PROJECTS[0]),
      );
      setDraftSavedAt(null);
      AsyncStorage.removeItem(DRAFT_STORAGE_KEY).catch(
        () => undefined,
      );
    }

    Alert.alert(
      'Backup restored',
      'Project data was restored successfully.',
    );
  }

  async function restoreBackup() {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: 'application/json',
        copyToCacheDirectory: true,
      });

      if (result.canceled) return;

      const file = result.assets[0];

      if (!file) {
        Alert.alert(
          'Restore failed',
          'No backup file was selected.',
        );

        return;
      }

      if (isOversizedBackup(file.size)) {
        Alert.alert(
          'Backup too large',
          'Choose a smaller Project Photo Update Tool backup file.',
        );

        return;
      }

      const fileInfo = await FileSystem.getInfoAsync(file.uri);

      if (
        fileInfo.exists &&
        'size' in fileInfo &&
        isOversizedBackup(fileInfo.size)
      ) {
        Alert.alert(
          'Backup too large',
          'Choose a smaller Project Photo Update Tool backup file.',
        );

        return;
      }

      const contents = await FileSystem.readAsStringAsync(file.uri);
      const parsed: unknown = JSON.parse(contents);
      const data = normalizeBackupData(parsed);

      if (!data) {
        Alert.alert(
          'Invalid backup',
          'Choose a valid Project Photo Update Tool backup JSON file.',
        );

        return;
      }

      Alert.alert(
        'Restore backup?',
        'This will replace saved updates, projects, contacts, and the active draft on this phone.',
        [
          {
            text: 'Cancel',
            style: 'cancel',
          },
          {
            text: 'Restore',
            style: 'destructive',
            onPress: () => applyRestoredData(data),
          },
        ],
      );
    } catch {
      Alert.alert(
        'Restore failed',
        'The selected file could not be read as a backup.',
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

      const directory = await ensureReferenceDocumentsDirectory();
      const originalFileName = filenameFromDocumentAsset(asset);
      const storedFileName = `${uid()}-${sanitizeFilename(originalFileName)}`;
      const targetUri = `${directory}${storedFileName}`;

      await FileSystem.copyAsync({
        from: asset.uri,
        to: targetUri,
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
      });

      setReferenceDocuments(prev => [nextDocument, ...prev]);

      Alert.alert('Document imported', `${nextDocument.name} was saved to Reference Documents.`);
    } catch {
      Alert.alert('Import failed', 'The selected reference document could not be imported.');
    }
  }

  function updateReferenceDocument(
    documentId: string,
    next: Partial<ReferenceDocument>,
  ) {
    setReferenceDocuments(prev =>
      prev.map(document =>
        document.id === documentId
          ? normalizeReferenceDocument({
              ...document,
              ...next,
            })
          : document,
      ),
    );
  }

  function markReferenceDocumentCurrent(documentId: string) {
    const target = referenceDocuments.find(document => document.id === documentId);

    setReferenceDocuments(prev =>
      prev.map(document => ({
        ...document,
        isCurrent:
          document.id === documentId
            ? !document.isCurrent
            : target && document.category === target.category
              ? false
              : document.isCurrent,
      })),
    );
  }

  async function openReferenceDocument(document: ReferenceDocument) {
    try {
      const info = await FileSystem.getInfoAsync(document.uri);

      if (!info.exists) {
        Alert.alert('File missing', 'This reference document record exists, but the local file could not be found.');
        return;
      }

      const canShare = await Sharing.isAvailableAsync();

      if (!canShare) {
        Alert.alert('Document saved', `File: ${document.originalFileName}`);
        return;
      }

      await Sharing.shareAsync(document.uri, {
        dialogTitle: document.name,
        mimeType: document.mimeType || undefined,
      });
    } catch {
      Alert.alert('Open failed', 'This reference document could not be opened right now.');
    }
  }

  async function openProjectDocument(document: ProjectDocument) {
    if (!document.localUri) {
      Alert.alert(
        'Document unavailable',
        'This document is saved as metadata only on this device.',
      );
      return;
    }

    try {
      const info = await FileSystem.getInfoAsync(document.localUri);

      if (!info.exists) {
        Alert.alert(
          'Document file missing',
          'The document record is still saved, but the local file could not be found.',
        );
        return;
      }

      const canShare = await Sharing.isAvailableAsync();

      if (!canShare) {
        Alert.alert('Document saved', document.name);
        return;
      }

      await Sharing.shareAsync(document.localUri, {
        dialogTitle: document.name,
        mimeType: document.mimeType || undefined,
      });
    } catch {
      Alert.alert(
        'Open failed',
        'This document could not be opened right now.',
      );
    }
  }

  function updateProjectDocument(
    documentId: string,
    next: Partial<ProjectDocument>,
  ) {
    updateDocumentEverywhere(documentId, document =>
      normalizeProjectDocument({
        ...document,
        ...next,
        updatedAt: new Date().toISOString(),
      }) as ProjectDocument,
    );
  }

  function deleteProjectDocument(documentId: string) {
    const document = projectDocuments.find(item => item.id === documentId);

    if (!document) return;

    const sensitive = isComplianceSensitiveProjectDocument(document);
    const title = sensitive
      ? 'Archive compliance-sensitive document?'
      : 'Delete project document?';
    const message = sensitive
      ? `${document.name} is categorized as ${document.category}. It will be hidden from active project documents.`
      : `${document.name} will be removed from active project documents on this device.`;

    Alert.alert(
      title,
      message,
      [
        {
          text: 'Cancel',
          style: 'cancel',
        },
        {
          text: sensitive ? `Archive ${document.category}` : 'Delete',
          style: 'destructive',
          onPress: () => {
            const archivedAt = new Date().toISOString();

            setProjectDocuments(prev =>
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
                : prev.filter(item => item.id !== documentId),
            );

            setDraft(prev => ({
              ...prev,
              documents: (prev.documents || []).filter(
                item => item.id !== documentId,
              ),
            }));

            setSavedUpdates(prev =>
              prev.map(update => ({
                ...update,
                documents: (update.documents || []).filter(
                  item => item.id !== documentId,
                ),
              })),
            );
          },
        },
      ],
    );
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
            setReferenceDocuments(prev =>
              prev.filter(item => item.id !== documentId),
            );

            if (isStoredReferenceDocument(document.uri)) {
              FileSystem.deleteAsync(document.uri, {
                idempotent: true,
              }).catch(() => undefined);
            }
          },
        },
      ],
    );
  }

  function setActiveScheduleDocument(documentId: string) {
    setReferenceDocuments(prev =>
      prev.map(document =>
        document.category === 'Schedules'
          ? { ...document, isCurrent: document.id === documentId }
          : document,
      ),
    );
  }

  function deleteScheduleDocument(documentId: string) {
    const document = referenceDocuments.find(item => item.id === documentId);

    if (!document) return;

    Alert.alert(
      'Delete uploaded schedule?',
      `${document.name} will be removed. You can also remove schedule items that were extracted or added from this PDF so outdated dates do not confuse Upcoming.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete PDF Only',
          onPress: () => {
            setReferenceDocuments(prev => prev.filter(item => item.id !== documentId));

            if (isStoredReferenceDocument(document.uri)) {
              FileSystem.deleteAsync(document.uri, { idempotent: true }).catch(() => undefined);
            }
          },
        },
        {
          text: 'Delete PDF + Items',
          style: 'destructive',
          onPress: () => {
            setReferenceDocuments(prev => prev.filter(item => item.id !== documentId));
            setScheduleItems(prev =>
              prev.filter(
                item =>
                  item.importedFrom !== document.originalFileName &&
                  item.importedFrom !== document.name,
              ),
            );

            if (isStoredReferenceDocument(document.uri)) {
              FileSystem.deleteAsync(document.uri, { idempotent: true }).catch(() => undefined);
            }
          },
        },
      ],
    );
  }

  function addScheduleItem(item: Partial<ScheduleItem>) {
    const next = normalizeScheduleItem({
      ...item,
      id: uid(),
      createdAt: new Date().toISOString(),
    });

    setScheduleItems(prev => [next, ...prev]);
  }

  function updateScheduleItem(itemId: string, next: Partial<ScheduleItem>) {
    setScheduleItems(prev =>
      prev.map(item =>
        item.id === itemId ? normalizeScheduleItem({ ...item, ...next }) : item,
      ),
    );
  }

  function deleteScheduleItem(itemId: string) {
    Alert.alert(
      'Delete schedule item?',
      'This removes the schedule item from this phone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () =>
            setScheduleItems(prev => prev.filter(item => item.id !== itemId)),
        },
      ],
    );
  }

  async function importScheduleFile() {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: [
          'application/pdf',
          'text/csv',
          'text/plain',
          'application/vnd.ms-excel',
          'application/json',
        ],
        copyToCacheDirectory: true,
      });

      if (result.canceled) return;

      const file = result.assets[0];

      if (!file) return;

      const fileName = file.name || 'Imported schedule';
      const mimeType = file.mimeType || '';
      const isPdf =
        mimeType.includes('pdf') || fileName.toLowerCase().endsWith('.pdf');

      if (isPdf) {
        const directory = await ensureReferenceDocumentsDirectory();
        const originalFileName = filenameFromDocumentAsset(file);
        const storedFileName = `${uid()}-${sanitizeFilename(originalFileName)}`;
        const targetUri = `${directory}${storedFileName}`;

        await FileSystem.copyAsync({
          from: file.uri,
          to: targetUri,
        });

        const scheduleDocument = normalizeReferenceDocument({
          id: uid(),
          name: originalFileName.replace(/\.[^/.]+$/, ''),
          originalFileName,
          uri: targetUri,
          mimeType: file.mimeType || 'application/pdf',
          category: 'Schedules',
          notes:
            'Imported from the Schedule screen. Review this PDF and add extracted schedule tasks or milestones manually as needed.',
          isCurrent: true,
          importedAt: new Date().toISOString(),
        });

        setReferenceDocuments(prev => [scheduleDocument, ...prev.map(document => document.category === 'Schedules' ? { ...document, isCurrent: false } : document)]);

        let extractedItems: ScheduleItem[] = [];
        let extractionMethod = '';
        let aiExtractionFailed = false;

        if (scheduleAiExtractorUrl.trim()) {
          try {
            extractedItems = await extractScheduleItemsWithAiEndpoint({
              endpointUrl: scheduleAiExtractorUrl,
              pdfUri: targetUri,
              fileName: originalFileName,
              projects,
              projectAreas,
            });
            extractionMethod = 'AI/OCR';
          } catch {
            aiExtractionFailed = true;
            extractedItems = [];
          }
        }

        if (extractedItems.length === 0) {
          try {
            const rawPdfText = await FileSystem.readAsStringAsync(targetUri);
            extractedItems = extractScheduleItemsFromPdfText(
              rawPdfText,
              originalFileName,
              projects,
              projectAreas,
            );
            extractionMethod = 'PDF text';
          } catch {
            extractedItems = [];
          }
        }

        if (extractedItems.length > 0) {
          setScheduleItems(prev => [...extractedItems, ...prev]);
          Alert.alert(
            'PDF schedule imported',
            `${extractedItems.length} possible schedule item${extractedItems.length === 1 ? '' : 's'} extracted using ${extractionMethod || 'schedule extraction'}. Review the extracted items, then correct any task names, locations, or dates that do not match the Gantt chart.`,
          );
          return;
        }

        const reviewItem = normalizeScheduleItem({
          taskName: `Review imported PDF schedule: ${scheduleDocument.name}`,
          projectName: activeProjects[0] || projects[0] || '',
          locationName: '',
          startDate: '',
          finishDate: '',
          milestone: 'Imported PDF Schedule',
          owner: '',
          status: 'Not Started',
          notes:
            'The PDF was saved, but readable task/date text could not be extracted automatically. This often happens when a Gantt chart is scanned or flattened. Open the PDF and tap Add Item to enter the key milestones and due dates.',
          importedFrom: originalFileName,
          importedAt: new Date().toISOString(),
        });

        setScheduleItems(prev => [reviewItem, ...prev]);

        Alert.alert(
          'PDF schedule imported',
          scheduleAiExtractorUrl.trim()
            ? 'The PDF was saved, but no tasks were extracted. The AI/OCR endpoint did not return usable schedule items. Open the PDF from Schedule or check the extractor endpoint.'
            : 'The PDF was saved, but no readable dates/tasks were extracted. Add an AI/OCR extractor endpoint in Schedule Import for scanned or flattened Gantt charts, or open the PDF and tap Add Item to enter milestones manually.',
        );
        return;
      }

      const contents = await FileSystem.readAsStringAsync(file.uri);
      const imported = parseScheduleText(contents, fileName);

      if (!imported.length) {
        Alert.alert(
          'No schedule items found',
          'Use a CSV or text file with at least a task name. Recommended columns: Task, Project, Location, Start, Finish, Milestone, Owner, Status, Notes. PDF schedules can also be imported and stored for manual review.',
        );
        return;
      }

      setScheduleItems(prev => [...imported, ...prev]);

      Alert.alert(
        'Schedule imported',
        `${imported.length} schedule item${imported.length === 1 ? '' : 's'} imported.`,
      );
    } catch {
      Alert.alert(
        'Import failed',
        'The schedule file could not be imported. Try a PDF, CSV, or plain text schedule file.',
      );
    }
  }

  function saveUpdate() {
  if (!hasSavableUpdate(draft)) {
    Alert.alert(
      'Update is blank',
      'Add a photo, update notes, field note, or action information before saving.',
    );

    return;
  }

  const invalidDueDateIndex = findInvalidDueDatePhoto(draft);

  if (invalidDueDateIndex >= 0) {
    Alert.alert(
      'Invalid due date',
      `Photo ${invalidDueDateIndex + 1} has a due date that is not in YYYY-MM-DD format.`,
    );

    return;
  }

  const saved = {
    ...draft,
    id: draft.id || uid(),
  };

  setSavedUpdates(prev => [
    saved,
    ...prev.filter(item => item.id !== saved.id),
  ]);

  saveCloudUpdate(saved);
  syncUpdatePhotosToCloud(saved);

  const nextProject =
    activeProjects[0] || DEFAULT_PROJECTS[0];

  setDraft(createDraft(nextProject));
  setDraftSavedAt(null);

  AsyncStorage.removeItem(DRAFT_STORAGE_KEY).catch(
    () => undefined,
  );

  Alert.alert(
    'Saved',
    'This project update was saved.',
  );

  setScreen('SavedUpdates');
}

  function openSavedUpdate(update: ProjectUpdate) {
    const lifecycle = lifecycleStatusForUpdate(update);

    if (lifecycle === 'sent' || lifecycle === 'queued') {
      setSelectedDetailUpdate(update);
      setScreen('UpdateDetail');
      return;
    }

    if (hasDraftContent(draft)) {
      Alert.alert(
        'Unfinished update found',
        'Opening a saved update will replace the current unfinished draft.',
        [
          {
            text: 'Cancel',
            style: 'cancel',
          },
          {
            text: 'Open Saved Update',
            style: 'destructive',
            onPress: () => {
              const discardedDraft = draft;

              setDraft(update);
              setSelectedWorkspaceProject(update.projectName);
              setScreen(screenForUpdateResume(update));

              void deleteUnreferencedPhotosFromUpdate(
                discardedDraft,
                savedUpdates,
              );
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

  function openLatestProjectPhotoDifference(projectName: string) {
    const brief = buildPIEProjectBriefModel(projectName, savedUpdates);
    const targetUpdate = brief.latestUpdate;

    if (!targetUpdate) {
      setScreen('SavedUpdates');
      return;
    }

    setSelectedWorkspaceProject(projectName);
    setSelectedDetailUpdate(targetUpdate);
    setScreen('UpdateDetail');
  }

  function deleteSavedUpdate(updateId: string, onConfirmed?: () => void) {
    const update = savedUpdates.find(item => item.id === updateId);
    const lifecycle = update ? lifecycleStatusForUpdate(update) : 'draft';
    const deleteTitle =
      lifecycle === 'sent'
        ? 'Delete sent update from this device?'
        : lifecycle === 'failed'
          ? 'Delete failed update?'
          : 'Remove update from device?';
    const deleteCopy =
      lifecycle === 'sent'
        ? "This removes the update and its local photos from this device only. It doesn't delete anything already sent, or the record stored in the cloud — this can't be undone on this device. If you just want it out of your default view but still available later, use Archive instead."
        : lifecycle === 'failed'
          ? 'This removes the failed local update from this device and stops retrying it.'
          : 'This removes the local saved copy from this device.';
    const deleteAction =
      lifecycle === 'sent'
        ? 'Delete from Device'
        : lifecycle === 'failed'
          ? 'Delete failed update'
          : 'Remove from device';

    Alert.alert(
      deleteTitle,
      deleteCopy,
      [
        {
          text: 'Cancel',
          style: 'cancel',
        },
        {
          text: deleteAction,
          style: 'destructive',
          onPress: () => {
            const deletedUpdate = savedUpdates.find(
              update => update.id === updateId,
            );
            const remainingUpdates = savedUpdates.filter(
              update => update.id !== updateId,
            );

            if (deletedUpdate) {
              const tombstone = buildUpdateTombstone(
                deletedUpdate,
                lifecycleStatusForUpdate(deletedUpdate) === 'failed'
                  ? 'delete_failed_update'
                  : 'remove_from_device',
              );
              setDeletedUpdateTombstones(prev =>
                upsertDeletedUpdateTombstone(prev, tombstone),
              );
              void removeProjectUpdateFromSyncQueue(deletedUpdate.id);
            }

            setSavedUpdates(remainingUpdates);

            if (deletedUpdate) {
              void deleteUnreferencedPhotosFromUpdate(
                deletedUpdate,
                [draft, ...remainingUpdates],
              );
            }

            onConfirmed?.();
          },
        },
      ],
    );
  }

  function archiveSavedUpdate(updateId: string, onConfirmed?: () => void) {
    Alert.alert(
      'Archive sent update?',
      'Sent updates are communication records. This will hide the update from default views without deleting the record.',
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
              void removeProjectUpdateFromSyncQueue(update.id);
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
    continueToPIEAnalysis();
  }

  const unfinishedDraft =
    hasDraftContent(draft) ? draft : null;

  const contentStyle = useMemo(
    () => [
      styles.content,
      {
        paddingTop: Math.max(
          insets.top + 24,
          Platform.OS === 'ios' ? 72 : 48,
        ),
      },
    ],
    [insets.top],
  );

  const liveAuthorityInput = useMemo<PIELiveAuthorityInput>(() => {
    const projectName =
      draft.projectName ||
      activeProjects[0] ||
      DEFAULT_PROJECTS[0] ||
      'Current Project';

    return {
      organizationId: null,
      projectId: authorityProjectId(projectName),
      projectName,
      projectNames: activeProjects.length ? activeProjects : [projectName],
      updates: savedUpdates as unknown as PIELiveAuthorityInput['updates'],
      scheduleItems: scheduleItems as unknown as PIELiveAuthorityInput['scheduleItems'],
      currentUpdate: draft as unknown as PIELiveAuthorityInput['currentUpdate'],
      projectAreas: projectAreas as unknown as PIELiveAuthorityInput['projectAreas'],
      contacts: contactBook as unknown as PIELiveAuthorityInput['contacts'],
      referenceDocuments: referenceDocuments as unknown as PIELiveAuthorityInput['referenceDocuments'],
      surface: authoritySurfaceForScreen(screen),
      identityTrusted: false,
      cloudAvailable: false,
    };
  }, [
    activeProjects,
    contactBook,
    draft,
    projectAreas,
    referenceDocuments,
    savedUpdates,
    scheduleItems,
    screen,
  ]);

  function selectOverviewProject(projectName: OverviewProjectSelection) {
    setOverviewProjectManuallySelected(true);
    setOverviewProjectSelection(projectName);
  }

  const liveDetailUpdate = selectedDetailUpdate
    ? savedUpdates.find(item => item.id === selectedDetailUpdate.id) || selectedDetailUpdate
    : null;

  return (
    <PIELiveAuthorityProvider input={liveAuthorityInput}>
      <SafeAreaView
        style={styles.shell}
        edges={['left', 'right', 'bottom']}
      >
        <StatusBar style="dark" />

        <KeyboardAvoidingView
          behavior={
            Platform.OS === 'ios'
              ? 'padding'
              : undefined
          }
          style={styles.keyboard}
        >
          <View style={styles.appFrame}>
          {screen === 'Home' && (
            <HomeScreen
              contentStyle={contentStyle}
              projects={activeProjects}
              savedUpdates={savedUpdates}
              scheduleItems={scheduleItems}
              displayName={displayName}
              unfinishedDraft={unfinishedDraft}
              draftSavedAt={draftSavedAt}
              selectedProjectName={overviewProjectName}
              detectedProjectName={detectedProjectName}
              gpsCandidateProjectNames={gpsCandidateProjectNames}
              projectDetectionStatus={projectDetectionStatus}
              projectRecords={projectRecords}
              onResumeDraft={resumeDraft}
              onDiscardDraft={discardDraft}
              onNewUpdate={createNewUpdate}
              onSelectProject={selectOverviewProject}
              onOpenProject={openProjectWorkspace}
              onViewProjects={() => setScreen('Projects')}
              onOpenProjectsOnTrack={() => {
                setProjectsEntryStatusFilter('onTrack');
                setScreen('Projects');
              }}
              onOpenDueToday={() => setScreen('Upcoming')}
              onOpenSentThisWeek={() => {
                setSavedUpdatesEntryFilter({ tab: 'Sent', withinDays: 7 });
                setScreen('SavedUpdates');
              }}
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
              projectAreas={projectAreas}
              selectedArea={currentDraftArea}
              areaSuggestion={draftAreaSuggestion}
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
              onRetryDocumentUpload={documentId => {
                void retryProjectDocumentUpload(documentId);
              }}
              onContinueWithoutPhotos={continueWithoutPhotos}
              onRetryPhotoAnalysis={photo => {
                void retryPhotoAnalysis(draft, photo);
              }}
            />
          )}

          {screen === 'PIEAnalysis' && (
            <ScreenScroll contentStyle={contentStyle}>
              <PIEAnalysisStepScreen
                update={draft}
                pieStatus={draftPIEStatus}
                onAddPhoto={takePhoto}
                onAddDocument={importFieldUpdateDocument}
                onRetryDocumentUpload={documentId => {
                  void retryProjectDocumentUpload(documentId);
                }}
                onContinue={openReviewFromPIEAnalysis}
                onQuickContext={selectQuickContext}
                onRetry={() => {
                  const failedPhoto =
                    draft.photos.find(photo =>
                      photo.photoIntelligence?.status === 'analysis_failed_retry' ||
                      photo.photoIntelligence?.status === 'comparison_unavailable',
                    ) || draft.photos[0];

                  if (failedPhoto) {
                    void retryPhotoAnalysis(draft, failedPhoto);
                  }
                }}
              />
            </ScreenScroll>
          )}

          {screen === 'BuildUpdate' && (
            <ScreenScroll contentStyle={contentStyle}>
              <BuildUpdateScreen
                update={draft}
                selectedArea={currentDraftArea}
                contacts={currentContacts}
                draftSavedAt={draftSavedAt}
                pieStatus={draftPIEStatus}
                onNotesChange={notes =>
                  setDraft(prev => ({
                    ...prev,
                    notes,
                    pieSuggestedNoteAccepted:
                      Boolean(prev.pieSuggestedNote) &&
                      notes === prev.pieSuggestedNote,
                  }))
                }
                onSendUpdate={sendFieldUpdate}
                onSaveDraft={saveDraftFromReview}
                onEditPhotos={() =>
                  setScreen('AddPhotos')
                }
                onContacts={openContacts}
                onSendEmail={() => {
                  void sendEmail();
                }}
                onSendText={() => {
                  void sendText();
                }}
                onCopy={() => {
                  void copyMessage();
                }}
                onAddDocument={importFieldUpdateDocument}
                onRetryDocumentUpload={documentId => {
                  void retryProjectDocumentUpload(documentId);
                }}
                onConfirmInterpretation={confirmPIEInterpretation}
                onDismissInterpretation={dismissPIEInterpretation}
                onShareSheet={() => {
                  void openSystemShareSheet();
                }}
                onRetryPhotoAnalysis={photo => {
                  void retryPhotoAnalysis(draft, photo);
                }}
              />
            </ScreenScroll>
          )}

          {screen === 'Projects' && (
            <ProjectsScreen
              contentStyle={contentStyle}
              activeProjects={activeProjects}
              savedUpdates={savedUpdates}
              projectDocuments={projectDocuments}
              contactBook={contactBook}
              projectStatsByName={projectStatsByName}
              projectRecords={projectRecords}
              onSelect={openProjectWorkspace}
              onAddProject={addProject}
              initialStatusFilter={projectsEntryStatusFilter ?? undefined}
            />
          )}

          {screen === 'ProjectWorkspace' && (
            <ProjectWorkspaceScreen
              contentStyle={contentStyle}
              projectName={selectedWorkspaceProject}
              savedUpdates={savedUpdates}
              captureMemories={captureMemories}
              projectAreas={projectAreas}
              projectDocuments={projectDocuments}
              scheduleItems={scheduleItems}
              contactBook={contactBook}
              projectStats={projectStatsForName(projectStatsByName, selectedWorkspaceProject)}
              coverPhoto={coverPhotoForProject(projectRecords, selectedWorkspaceProject)}
              coverPhotoMode={projectRecords.find(project =>
                project.name.toLowerCase() === selectedWorkspaceProject.toLowerCase()
              )?.coverPhotoMode || 'automatic'}
              coverPhotoUri={resolveProjectCoverPhotoUri(
                projectRecords,
                selectedWorkspaceProject,
                projectThumbnailUri(selectedWorkspaceProject, savedUpdates),
              )}
              onTakeNewCoverPhoto={() => {
                void takeNewProjectCoverPhoto(selectedWorkspaceProject);
              }}
              onChooseCoverFromLibrary={() => {
                void chooseProjectCoverFromLibrary(selectedWorkspaceProject);
              }}
              onUseBestProjectPhoto={() => useBestProjectPhoto(selectedWorkspaceProject)}
              onRemoveCoverPhoto={() => removeProjectCoverPhoto(selectedWorkspaceProject)}
              onBack={() => setScreen('Projects')}
              onNewFieldUpdate={createNewUpdate}
              onSaveCaptureMemory={saveCaptureMemory}
              onDeleteCaptureMemory={deleteCaptureMemory}
              onOpenUpdates={() => setScreen('SavedUpdates')}
              onOpenPhotoDifferences={openLatestProjectPhotoDifference}
              onOpenDocuments={() => setScreen('ProjectDocuments')}
              onOpenDailyBriefItem={item => {
                setSelectedWorkspaceProject(selectedWorkspaceProject);
                if (item.navigationTarget === 'project_documents') {
                  setScreen('ProjectDocuments');
                  return;
                }
                if (item.navigationTarget === 'schedule') {
                  setScreen('Schedule');
                  return;
                }
                if (item.navigationTarget === 'capture') {
                  createNewUpdate(selectedWorkspaceProject);
                  return;
                }
                const sourceUpdate = savedUpdates.find(update => update.id === item.sourceRecordId);
                if (sourceUpdate) {
                  setSelectedDetailUpdate(sourceUpdate);
                  setScreen('UpdateDetail');
                }
              }}
              onRetryQueuedUpdate={retryQueuedUpdate}
              onDeleteProject={deleteProjectPermanently}
              isDeletingProject={deletingProjectName === selectedWorkspaceProject}
            />
          )}

          {screen === 'ProjectDocuments' && (
            <ProjectDocumentsScreen
              contentStyle={contentStyle}
              projectName={selectedWorkspaceProject}
              documents={projectDocumentsForProject(selectedWorkspaceProject, projectDocuments)}
              projectAreas={projectAreas}
              updates={savedUpdates.filter(update => update.projectName === selectedWorkspaceProject)}
              onBack={() => setScreen('ProjectWorkspace')}
              onUpload={() => {
                void importProjectDocumentForProject(selectedWorkspaceProject);
              }}
              onTakePhoto={() => {
                void takeProjectDocumentPhoto(selectedWorkspaceProject, false);
              }}
              onOpen={openProjectDocument}
              onUpdate={updateProjectDocument}
              onRetry={documentId => {
                void retryProjectDocumentUpload(documentId);
              }}
              onDelete={deleteProjectDocument}
            />
          )}

          {screen === 'ReferenceDocuments' && (
            <ReferenceDocumentsScreen
              contentStyle={contentStyle}
              documents={referenceDocuments}
              onBack={() => setScreen('Projects')}
              onImport={importReferenceDocument}
              onUpdate={updateReferenceDocument}
              onToggleCurrent={markReferenceDocumentCurrent}
              onOpen={openReferenceDocument}
              onDelete={deleteReferenceDocument}
            />
          )}

          {screen === 'Schedule' && (
            <ScheduleScreen
              contentStyle={contentStyle}
              scheduleItems={scheduleItems}
              savedUpdates={savedUpdates}
              projectAreas={projectAreas}
              projects={projects}
              scheduleDocuments={referenceDocuments.filter(document => document.category === 'Schedules')}
              onBack={() => setScreen('Home')}
              onOpenDocument={openReferenceDocument}
              onDeleteDocument={deleteScheduleDocument}
              onSetActiveDocument={setActiveScheduleDocument}
              onAdd={addScheduleItem}
              onUpdate={updateScheduleItem}
              onDelete={deleteScheduleItem}
              onImport={importScheduleFile}
              scheduleAiExtractorUrl={scheduleAiExtractorUrl}
              onScheduleAiExtractorUrlChange={setScheduleAiExtractorUrl}
            />
          )}

          {screen === 'Upcoming' && (
            <UpcomingScreen
              contentStyle={contentStyle}
              scheduleItems={scheduleItems}
              savedUpdates={savedUpdates}
              onBack={() => setScreen('Home')}
              onSchedule={() => setScreen('Schedule')}
              onNewUpdate={() => createNewUpdate()}
              autoOpenDueToday
            />
          )}

          {screen === 'Diagnostics' && (
            <ScreenScroll contentStyle={contentStyle}>
              <DiagnosticsScreen
                projectAreas={projectAreas}
                referenceDocuments={referenceDocuments}
                onBack={() => setScreen('Projects')}
              />
            </ScreenScroll>
          )}

          {screen === 'Admin' && (
            <AdminScreen
              contentStyle={contentStyle}
              localProjects={activeProjects}
              savedUpdates={savedUpdates}
              projectAreas={projectAreas}
              scheduleItems={scheduleItems}
              referenceDocuments={referenceDocuments}
              displayName={displayName}
              onDisplayNameChange={setDisplayName}
              onBack={() => setScreen('Home')}
              onDiagnostics={() => setScreen('Diagnostics')}
              onProjectManagement={() => setScreen('Projects')}
              onReferenceDocuments={() => setScreen('ReferenceDocuments')}
              onSchedule={() => setScreen('Schedule')}
              onBackup={() => {
                void exportBackup();
              }}
              onRestore={() => {
                void restoreBackup();
              }}
              onAddArea={addProjectArea}
              onUpdateArea={updateProjectArea}
              onDeleteArea={deleteProjectArea}
              onUseCurrentLocationForArea={areaId => {
                void useCurrentLocationForArea(areaId);
              }}
              onRemoveMissingPhotos={removeMissingSyncPhotos}
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
                  contactsReturnScreen === 'PIEAnalysis' ||
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
              projectAreas={projectAreas}
              contactBook={contactBook}
              onOpen={openSavedUpdate}
              onDelete={deleteSavedUpdate}
              onArchive={archiveSavedUpdate}
              onNewUpdate={() =>
                createNewUpdate()
              }
              onRetryPhotoAnalysis={(update, photo) => {
                void retryPhotoAnalysis(update, photo);
              }}
              onRetryQueuedUpdate={retryQueuedUpdate}
              initialTab={savedUpdatesEntryFilter?.tab}
              initialWithinDays={savedUpdatesEntryFilter?.withinDays}
            />
          )}

          {screen === 'UpdateDetail' && liveDetailUpdate && (
            <ScreenScroll contentStyle={contentStyle}>
              <ReadOnlyUpdateDetailScreen
                update={liveDetailUpdate}
                onBack={() => setScreen('SavedUpdates')}
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
                    setScreen('SavedUpdates'),
                  );
                }}
                onArchive={() => {
                  archiveSavedUpdate(liveDetailUpdate.id, () =>
                    setScreen('SavedUpdates'),
                  );
                }}
              />
            </ScreenScroll>
          )}

          <PhotoIntelligenceSignInModal
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

          <DocumentProjectSelectionSheet
            visible={Boolean(documentUploadRequest)}
            projects={activeProjects}
            selected={documentUploadRequest?.selected ?? EMPTY_SELECTED_PROJECTS}
            onToggle={toggleDocumentUploadProject}
            onConfirm={confirmDocumentProjectSelection}
            onClose={cancelDocumentProjectSelection}
          />

          <BottomTabs
            current={screen}
            onChange={setScreen}
          />
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </PIELiveAuthorityProvider>
  );
}

function authorityProjectId(projectName: string) {
  const normalized = projectName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

  return `project-${normalized || 'unassigned'}`;
}

function authoritySurfaceForScreen(screen: Screen): PIELiveAuthorityInput['surface'] {
  if (screen === 'AddPhotos' || screen === 'PIEAnalysis' || screen === 'SelectProject') {
    return 'capture';
  }

  if (screen === 'BuildUpdate') {
    return 'reports';
  }

  if (screen === 'Projects') {
    return 'projects';
  }

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

function ScreenScroll({
  children,
  contentStyle,
}: {
  children: ReactNode;
  contentStyle: StyleProp<ViewStyle>;
}) {
  return (
    <ScrollView
      style={styles.appFrame}
      contentContainerStyle={contentStyle}
      keyboardShouldPersistTaps="handled"
    >
      {children}
    </ScrollView>
  );
}

function useCountUp(target: number, durationMs: number) {
  const [value, setValue] = useState(0);

  useEffect(() => {
    let frame: number;
    const startedAt = Date.now();

    function step() {
      const elapsed = Date.now() - startedAt;
      const progress = Math.min(1, elapsed / durationMs);

      setValue(Math.round(progress * target));

      if (progress < 1) {
        frame = requestAnimationFrame(step);
      }
    }

    frame = requestAnimationFrame(step);

    return () => cancelAnimationFrame(frame);
  }, [target, durationMs]);

  return value;
}

function useFadeSlideIn(durationMs: number) {
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(anim, {
      toValue: 1,
      duration: durationMs,
      useNativeDriver: true,
    }).start();
  }, [anim, durationMs]);

  return {
    opacity: anim,
    transform: [
      {
        translateY: anim.interpolate({
          inputRange: [0, 1],
          outputRange: [8, 0],
        }),
      },
    ],
  };
}

function HomeScreen({
  contentStyle,
  projects,
  savedUpdates,
  scheduleItems,
  displayName,
  unfinishedDraft,
  draftSavedAt,
  selectedProjectName,
  detectedProjectName,
  gpsCandidateProjectNames,
  projectDetectionStatus,
  projectRecords,
  onResumeDraft,
  onDiscardDraft,
  onNewUpdate,
  onSelectProject,
  onOpenProject,
  onViewProjects,
  onOpenProjectsOnTrack,
  onOpenDueToday,
  onOpenSentThisWeek,
}: {
  contentStyle: StyleProp<ViewStyle>;
  projects: string[];
  savedUpdates: ProjectUpdate[];
  scheduleItems: ScheduleItem[];
  displayName: string;
  unfinishedDraft: ProjectUpdate | null;
  draftSavedAt: string | null;
  selectedProjectName: string | null;
  detectedProjectName: string | null;
  gpsCandidateProjectNames: string[];
  projectDetectionStatus: OverviewDetectionStatus;
  projectRecords: ProjectRecord[];
  onResumeDraft: () => void;
  onDiscardDraft: () => void;
  onNewUpdate: (projectName?: string) => void;
  onSelectProject: (projectName: OverviewProjectSelection) => void;
  onOpenProject: (projectName: string) => void;
  onViewProjects: () => void;
  onOpenProjectsOnTrack: () => void;
  onOpenDueToday: () => void;
  onOpenSentThisWeek: () => void;
}) {
  const scopedProjects = projects;
  const overviewRows = buildOverviewProjectRows(
    scopedProjects,
    savedUpdates,
    scheduleItems,
  );
  const attentionRows = overviewRows.filter(row => row.needsAttention);
  const caughtUpRows = overviewRows.filter(row => !row.needsAttention);
  const blockedRows = attentionRows.filter(row => row.severity === 'high');
  const atRiskRows = attentionRows.filter(row => row.severity !== 'high');
  const topPriority = attentionRows[0] || null;

  const projectStatsByName = buildProjectStatsByName(savedUpdates);
  const dueTodayCount = overviewRows.filter(row => row.dueTodayLabel !== null).length;
  const sentThisWeekCount = savedUpdates.filter(update => {
    if (lifecycleStatusForUpdate(update) !== 'sent') return false;
    if (!scopedProjects.some(project => projectMatchesScope(update, project))) return false;

    const daysSinceSent = daysUntilDate(update.date);

    return daysSinceSent !== null && daysSinceSent <= 0 && daysSinceSent >= -7;
  }).length;
  const allDaveObservations = scopedProjects
    .flatMap(project =>
      buildPIEProjectBriefModel(project, savedUpdates).observations.map(
        observation => ({ ...observation, projectName: project }),
      ),
    )
    .filter(observation => updateTimelineGroup(observation.update.date) === 'Today')
    .sort((a, b) => updateSortTime(b.update) - updateSortTime(a.update));
  const recentActivity = [...savedUpdates]
    .filter(update => scopedProjects.some(project => projectMatchesScope(update, project)))
    .sort((left, right) => updateSortTime(right) - updateSortTime(left))
    .slice(0, 5);

  function overviewPhotoForProject(projectName: string) {
    return resolveProjectCoverPhotoUri(
      projectRecords,
      projectName,
      projectThumbnailUri(projectName, savedUpdates),
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
      <View style={styles.overviewGreetingHeader}>
        <View style={styles.overviewGreetingCopy}>
          <Text style={styles.overviewGreetingText}>{timeOfDayGreeting(displayName)}</Text>
          <Text style={styles.overviewGreetingDate}>{todayLongDateLabel()}</Text>
        </View>
        <TouchableOpacity
          style={styles.overviewAskDaveButton}
          onPress={() => Alert.alert('Ask DAVE', 'Ask DAVE is coming soon.')}
          accessibilityRole="button"
          accessibilityLabel="Ask DAVE"
          accessibilityHint="Shows an Ask DAVE coming soon message"
        >
          <Ionicons name="sparkles-outline" size={17} color={colors.primary} />
          <Text style={styles.overviewAskDaveText}>Ask DAVE</Text>
        </TouchableOpacity>
      </View>

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
            { label: 'Healthy', value: caughtUpRows.length },
            { label: 'At Risk', value: atRiskRows.length },
            { label: 'Blocked', value: blockedRows.length },
          ].map(metric => (
            <View key={metric.label} style={styles.overviewHealthMetric}>
              <Text style={styles.overviewHealthMetricValue}>{metric.value}</Text>
              <Text style={styles.overviewHealthMetricLabel}>{metric.label}</Text>
            </View>
          ))}
        </View>
      </View>

      <View style={styles.overviewDashboardHeadingRow}>
        <Text style={styles.overviewDashboardHeading}>Today's Priority</Text>
      </View>
      <View style={styles.overviewPriorityCard}>
        {topPriority && overviewPhotoForProject(topPriority.project) ? (
          <Image
            source={{ uri: overviewPhotoForProject(topPriority.project)! }}
            style={styles.overviewPriorityImage}
          />
        ) : (
          <View style={styles.overviewPriorityImagePlaceholder}>
            <Ionicons name="flag-outline" size={34} color={colors.primary} />
          </View>
        )}
        <View style={styles.overviewPriorityContent}>
          <View style={styles.overviewPriorityBadge}>
            <Ionicons name="sparkles-outline" size={14} color={colors.warning} />
            <Text style={styles.overviewPriorityBadgeText}>PRIORITY</Text>
          </View>
          <Text style={styles.overviewPriorityProject}>
            {topPriority?.project || 'No immediate priority'}
          </Text>
          <Text style={styles.overviewPriorityRecommendation}>
            {topPriority?.dueTodayLabel || topPriority?.subtitle || 'Your projects have no current attention items.'}
          </Text>
          <Text style={styles.overviewPrioritySupport}>
            {topPriority
              ? 'Based on the latest project records requiring review.'
              : 'DAVE will surface the next evidence-backed item here.'}
          </Text>
          <TouchableOpacity
            style={styles.overviewPriorityButton}
            onPress={() => topPriority ? onOpenProject(topPriority.project) : onViewProjects()}
          >
            <Text style={styles.overviewPriorityButtonText}>
              {topPriority ? 'Review priority' : 'View projects'}
            </Text>
            <Ionicons name="arrow-forward" size={17} color="#FFFFFF" />
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.overviewDashboardHeadingRow}>
        <Text style={styles.overviewDashboardHeading}>DAVE Daily Brief</Text>
        <TouchableOpacity onPress={onOpenSentThisWeek}>
          <Text style={styles.overviewDashboardLink}>See all updates</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.overviewDailyBriefCard}>
        {allDaveObservations.length > 0 ? (
          allDaveObservations.slice(0, 3).map(observation => (
            <TouchableOpacity
              key={observation.id}
              style={styles.overviewBriefRow}
              onPress={() => onOpenProject(observation.projectName)}
            >
              <View style={styles.overviewBriefIcon}>
                <Ionicons name="sparkles-outline" size={16} color={colors.primary} />
              </View>
              <View style={styles.rowMain}>
                <Text style={styles.overviewBriefProject}>{observation.projectName}</Text>
                <Text style={styles.overviewBriefText} numberOfLines={2}>{observation.text}</Text>
              </View>
            </TouchableOpacity>
          ))
        ) : (
          <Text style={styles.overviewBriefEmpty}>No meaningful project changes recorded today.</Text>
        )}
      </View>

      {overviewRows.length === 0 ? (
        <EmptyState
          title="No projects yet."
          text="Add a project to start tracking field updates and schedule attention."
        />
      ) : null}

      {overviewRows.length > 0 ? (
        <>
          <View style={styles.overviewDashboardHeadingRow}>
            <Text style={styles.overviewDashboardHeading}>Active Projects</Text>
            <TouchableOpacity onPress={onViewProjects}>
              <Text style={styles.overviewDashboardLink}>View projects</Text>
            </TouchableOpacity>
          </View>
          {overviewRows.map(row => {
            const health = row.severity === 'high' ? 'Blocked' : row.needsAttention ? 'At Risk' : 'Healthy';
            const healthColor = health === 'Blocked' ? colors.danger : health === 'At Risk' ? colors.warning : colors.success;
            const photo = overviewPhotoForProject(row.project);

            return (
              <TouchableOpacity
                key={row.project}
                style={styles.overviewProjectCard}
                onPress={() => onOpenProject(row.project)}
              >
                {photo ? (
                  <Image source={{ uri: photo }} style={styles.overviewProjectImage} />
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
                  <Text style={styles.overviewProjectActivity}>
                    {projectStatsForName(projectStatsByName, row.project).lastUpdate
                      ? `Last activity ${relativeUpdateDateLabel(projectStatsForName(projectStatsByName, row.project).lastUpdate!)}`
                      : 'No activity recorded yet'}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color={colors.muted} />
              </TouchableOpacity>
            );
          })}
        </>
      ) : null}

      <View style={styles.overviewDashboardHeadingRow}>
        <Text style={styles.overviewDashboardHeading}>Recent Activity</Text>
        <TouchableOpacity onPress={onOpenSentThisWeek}>
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
              <TouchableOpacity style={styles.overviewActivityRow} onPress={() => onOpenProject(update.projectName)}>
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
      </ScrollView>
    </View>
  );
}

function OverviewHeroCard({
  openItemsCount,
  dueTodayCount,
  heroPhotoUri,
}: {
  openItemsCount: number;
  dueTodayCount: number;
  heroPhotoUri: string | null;
}) {
  const animatedStyle = useFadeSlideIn(400);
  const displayedCount = useCountUp(openItemsCount, 700);
  const isClear = openItemsCount === 0;
  const glowColor = isClear ? colors.success : colors.warning;

  return (
    <Animated.View style={[styles.overviewHeroCard, animatedStyle]}>
      <LinearGradient
        colors={['#0B2A6B', '#1E4FBF', '#5B4FC9']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />

      {heroPhotoUri ? (
        <Image
          source={{ uri: heroPhotoUri }}
          style={[StyleSheet.absoluteFill, styles.overviewHeroPhoto]}
        />
      ) : null}

      <LinearGradient
        colors={['rgba(9,16,40,0.15)', 'rgba(9,16,40,0.6)']}
        style={StyleSheet.absoluteFill}
      />

      <View style={styles.overviewHeroContent}>
        <Text style={styles.overviewHeroLabel}>Open Issues</Text>

        <View>
          <Text style={[styles.overviewHeroNumber, { color: glowColor }]}>
            {displayedCount}
          </Text>
          <Text style={styles.overviewHeroCaption}>
            {isClear
              ? 'No open issues logged'
              : `open issue${displayedCount === 1 ? '' : 's'} logged across your projects`}
          </Text>
        </View>

        {dueTodayCount > 0 ? (
          <View style={styles.overviewHeroPill}>
            <Ionicons name="time-outline" size={13} color="#FFC670" />
            <Text style={styles.overviewHeroPillText}>
              {dueTodayCount} due today
            </Text>
          </View>
        ) : null}
      </View>
    </Animated.View>
  );
}

function OverviewBentoCard({
  icon,
  iconColor,
  backgroundColor,
  value,
  label,
  onPress,
}: {
  icon: IconName;
  iconColor: string;
  backgroundColor: string;
  value: number;
  label: string;
  onPress: () => void;
}) {
  const animatedStyle = useFadeSlideIn(400);
  const displayedValue = useCountUp(value, 700);

  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.8} style={styles.overviewBentoCardTouchable}>
      <Animated.View style={[styles.overviewBentoCard, { backgroundColor }, animatedStyle]}>
        <View style={styles.overviewBentoIconWrap}>
          <Ionicons name={icon} size={16} color={iconColor} />
        </View>
        <Text style={styles.overviewBentoNumber}>{displayedValue}</Text>
        <Text style={styles.overviewBentoLabel}>{label}</Text>
      </Animated.View>
    </TouchableOpacity>
  );
}

function DaveObservationsModal({
  visible,
  observations,
  onClose,
  onOpenProject,
}: {
  visible: boolean;
  observations: Array<PIEProjectBriefObservation & { projectName: string }>;
  onClose: () => void;
  onOpenProject: (projectName: string) => void;
}) {
  const insets = useSafeAreaInsets();

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <View style={styles.sheetModalBackdrop}>
        <View
          style={[
            styles.sheetModalSafeArea,
            { paddingTop: insets.top, paddingBottom: insets.bottom },
          ]}
        >
          <View style={styles.sheetModalHeader}>
            <View style={styles.sheetModalTitleWrap}>
              <Text style={styles.sheetModalTitle}>DAVE Observations</Text>
              <Text style={styles.sheetModalCaption}>
                {observations.length} {pluralWord(observations.length, 'observation')}
              </Text>
            </View>
            <TouchableOpacity
              style={styles.sheetModalCloseButton}
              onPress={onClose}
              accessibilityLabel="Close DAVE observations"
            >
              <Ionicons name="close" size={26} color={colors.text} />
            </TouchableOpacity>
          </View>

          <ScrollView
            style={styles.appFrame}
            contentContainerStyle={[styles.content, { paddingTop: 8, paddingBottom: 24 }]}
          >
            {observations.length === 0 ? (
              <EmptyState
                title="No DAVE observations yet."
                text="Findings from photo analysis will appear here once available."
              />
            ) : (
              observations.map(observation => (
                <TouchableOpacity
                  key={observation.id}
                  style={styles.savedRow}
                  onPress={() => {
                    onClose();
                    onOpenProject(observation.projectName);
                  }}
                >
                  <View style={styles.rowIconBubble}>
                    <Ionicons name="bulb-outline" size={20} color={colors.insight} />
                  </View>
                  <View style={styles.rowMain}>
                    <Text style={styles.projectName}>{observation.projectName}</Text>
                    <Text style={styles.rowSub}>{observation.context}</Text>
                    <Text style={styles.bodyText}>{observation.text}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={20} color={colors.muted} />
                </TouchableOpacity>
              ))
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function ProjectSelectorSheet({
  visible,
  projects,
  narrowed,
  selectedProjectName,
  detectedProjectName,
  onSelect,
  onClose,
}: {
  visible: boolean;
  projects: string[];
  narrowed?: boolean;
  selectedProjectName: string | null;
  detectedProjectName: string | null;
  onSelect: (projectName: string | null) => void;
  onClose: () => void;
}) {
  return (
    <ProjectActionSheet visible={visible} title="Choose Project" onClose={onClose}>
      {narrowed ? (
        <Text style={styles.bodyText}>
          GPS found multiple nearby projects. Choose one of these likely matches.
        </Text>
      ) : null}

      {detectedProjectName ? (
        <ProjectSelectorRow
          label={`Detected: ${detectedProjectName}`}
          detail="Use the project nearest your current location."
          selected={selectedProjectName === detectedProjectName}
          onPress={() => onSelect(detectedProjectName)}
        />
      ) : null}

      <ProjectSelectorRow
        label="All Projects"
        detail="Show the full portfolio overview."
        selected={selectedProjectName === null}
        onPress={() => onSelect(null)}
      />

      {projects.map(project => (
        <ProjectSelectorRow
          key={project}
          label={project}
          detail="Open this project overview."
          selected={selectedProjectName === project}
          onPress={() => onSelect(project)}
        />
      ))}
    </ProjectActionSheet>
  );
}

function ProjectActionSheet({
  visible,
  title,
  children,
  onClose,
}: {
  visible: boolean;
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const dragResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_event, gesture) =>
          gesture.dy > 10 && Math.abs(gesture.dy) > Math.abs(gesture.dx) * 1.2,
        onPanResponderRelease: (_event, gesture) => {
          if (gesture.dy > 52) {
            onClose();
          }
        },
      }),
    [onClose],
  );

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.projectSelectorBackdrop}>
        <TouchableOpacity style={styles.projectSelectorScrim} onPress={onClose} />
        <View style={styles.projectSelectorSheet}>
          <View
            style={styles.projectSelectorDragHandleArea}
            {...dragResponder.panHandlers}
          >
            <View style={styles.projectSelectorHandle} />
          </View>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.panelTitle}>{title}</Text>
            <TouchableOpacity style={styles.iconOnlyButton} onPress={onClose}>
              <Ionicons name="close-outline" size={22} color={colors.text} />
            </TouchableOpacity>
          </View>

          <ScrollView
            style={styles.projectSelectorScroll}
            contentContainerStyle={styles.projectSelectorScrollContent}
            keyboardShouldPersistTaps="handled"
            nestedScrollEnabled
            showsVerticalScrollIndicator
          >
            {children}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function PhotoIntelligenceSignInModal({
  visible,
  email,
  password,
  message,
  submitting,
  developmentSignupEnabled,
  onEmailChange,
  onPasswordChange,
  onSubmit,
  onDevelopmentSignUp,
  onClose,
}: {
  visible: boolean;
  email: string;
  password: string;
  message: string | null;
  submitting: boolean;
  developmentSignupEnabled: boolean;
  onEmailChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onSubmit: () => void;
  onDevelopmentSignUp: () => void;
  onClose: () => void;
}) {
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.detailModalBackdrop}>
        <KeyboardAvoidingModalCard
          frameStyle={styles.detailModalCardFrame}
          contentContainerStyle={styles.detailModalCardContent}
        >
          <View style={styles.detailModalHeader}>
            <View style={styles.rowMain}>
              <Text style={styles.panelTitle}>Sign in to enable photo intelligence</Text>
              <Text style={styles.rowSub}>
                DAVE photo comparison needs a signed-in cloud session before it can analyze photos.
              </Text>
              <Text style={styles.rowSub}>
                Use a Supabase Auth email and password. Do not use Apple Developer, Expo, or TestFlight credentials.
              </Text>
            </View>
            <TouchableOpacity style={styles.iconOnlyButton} onPress={onClose}>
              <Ionicons name="close-outline" size={22} color={colors.text} />
            </TouchableOpacity>
          </View>

          <Text style={styles.label}>Email</Text>
          <TextInput
            style={styles.input}
            value={email}
            onChangeText={onEmailChange}
            placeholder="you@example.com"
            placeholderTextColor={colors.muted}
            autoCapitalize="none"
            keyboardType="email-address"
            textContentType="username"
          />

          <Text style={styles.label}>Password</Text>
          <TextInput
            style={styles.input}
            value={password}
            onChangeText={onPasswordChange}
            placeholder="Password"
            placeholderTextColor={colors.muted}
            secureTextEntry
            textContentType="password"
          />

          {message ? (
            <Text style={styles.dateHelpError}>{message}</Text>
          ) : null}

          <PrimaryButton
            label={submitting ? 'Signing in…' : 'Sign in to enable photo intelligence'}
            icon="person-circle-outline"
            onPress={onSubmit}
            disabled={submitting || !email.trim() || !password}
          />
          {developmentSignupEnabled ? (
            <SecondaryButton
              label="Create or sign in development account"
              icon="flask-outline"
              onPress={onDevelopmentSignUp}
            />
          ) : null}
          <SecondaryButton
            label="Not now"
            icon="close-outline"
            onPress={onClose}
          />
        </KeyboardAvoidingModalCard>
      </View>
    </Modal>
  );
}

function ProjectSelectorRow({
  label,
  detail,
  selected,
  onPress,
}: {
  label: string;
  detail: string;
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
        <Text style={styles.rowSub}>{detail}</Text>
      </View>
      {selected ? (
        <Ionicons name="checkmark-circle" size={22} color={colors.primary} />
      ) : (
        <Ionicons name="chevron-forward" size={20} color={colors.muted} />
      )}
    </TouchableOpacity>
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

function AddPhotosScreen({
  contentStyle,
  update,
  projectAreas,
  selectedArea,
  areaSuggestion,
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
}: {
  contentStyle: StyleProp<ViewStyle>;
  update: ProjectUpdate;
  projectAreas: ProjectArea[];
  selectedArea: ProjectArea | null;
  areaSuggestion: AreaSuggestion | null;
  recipientCount: number;
  contacts: ProjectContact[];
  draftSavedAt: string | null;
  onPickPhotos: () => void;
  onTakePhoto: () => void;
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
}) {
  const [areaSheetOpen, setAreaSheetOpen] = useState(false);
  const [recipientSheetOpen, setRecipientSheetOpen] = useState(false);
  const documents = update.documents || [];
  const areaName =
    selectedArea?.name ||
    update.selectedAreaName ||
    areaSuggestion?.area.name ||
    'Unassigned / Unknown Area';

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

      <Text style={styles.phase3MainTitle}>Capture Evidence</Text>

      <PrimaryButton
        label="Take Photo"
        icon="camera-outline"
        onPress={onTakePhoto}
      />

      <SecondaryButton
        label="Choose From Library"
        icon="images-outline"
        onPress={onPickPhotos}
      />

      <View style={styles.phase3AutoCard}>
        <AreaRow
          areaName={areaName}
          status={update.areaStatus || (areaSuggestion ? 'suggested' : 'unknown')}
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

      <AreaSelectionSheet
        visible={areaSheetOpen}
        projectAreas={projectAreas}
        suggestedArea={areaSuggestion?.area || selectedArea}
        selectedAreaId={update.selectedAreaId || null}
        onSelect={areaId => {
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
  current: 'Evidence' | 'DAVE Analysis' | 'Review';
  pieStatus: 'pending' | 'in_progress' | 'complete';
}) {
  const steps = ['Evidence', 'DAVE Analysis', 'Review'] as const;

  return (
    <View style={styles.phase3StepRow}>
      {steps.map(step => {
        const active = current === step;
        const complete =
          step === 'Evidence' && current !== 'Evidence' ||
          step === 'DAVE Analysis' && pieStatus === 'complete';

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
  status: ProjectUpdate['areaStatus'];
  onChange: () => void;
}) {
  const statusLabel =
    status === 'confirmed'
      ? 'Area auto-detected'
      : 'Area suggested';

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
          {contacts.length > 0 ? 'Recent recipients available' : 'Add recipients before sending'}
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

function DocumentProjectSelectionSheet({
  visible,
  projects,
  selected,
  onToggle,
  onConfirm,
  onClose,
}: {
  visible: boolean;
  projects: string[];
  selected: Set<string>;
  onToggle: (projectName: string) => void;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <ProjectActionSheet visible={visible} title="Select Projects" onClose={onClose}>
      <Text style={styles.bodyText}>
        This document will be added to every project you select below.
      </Text>

      {projects.map(projectName => (
        <AreaSelectionRow
          key={projectName}
          name={projectName}
          selected={selected.has(projectName)}
          onPress={() => onToggle(projectName)}
        />
      ))}

      <PrimaryButton
        label={
          selected.size > 0
            ? `Add to ${selected.size} Project${selected.size === 1 ? '' : 's'}`
            : 'Select at least one project'
        }
        icon="checkmark-done-outline"
        onPress={onConfirm}
        disabled={selected.size === 0}
      />
    </ProjectActionSheet>
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

function ProjectAreaPanel({
  update,
  projectAreas,
  selectedArea,
  areaSuggestion,
  locationStatus,
  onConfirmArea,
  onChangeArea,
  onRefreshLocation,
}: {
  update: ProjectUpdate;
  projectAreas: ProjectArea[];
  selectedArea: ProjectArea | null;
  areaSuggestion: AreaSuggestion | null;
  locationStatus: string | null;
  onConfirmArea: () => void;
  onChangeArea: (areaId: string) => void;
  onRefreshLocation: () => void;
}) {
  const hasGps =
    update.gpsLatitude !== null &&
    update.gpsLatitude !== undefined &&
    update.gpsLongitude !== null &&
    update.gpsLongitude !== undefined;

  const savedAreaLocationCount = projectAreas.filter(
    hasSavedAreaLocation,
  ).length;

  const suggestionText = areaSuggestion
    ? areaSuggestion.withinRadius
      ? `Suggested Area: ${areaSuggestion.area.name}`
      : `Closest Area: ${areaSuggestion.area.name}, but you are outside the saved radius.`
    : savedAreaLocationCount === 0
      ? 'No GPS points are saved for project areas yet. You can still select the area manually.'
      : savedAreaLocationCount < projectAreas.length
        ? 'Refresh GPS Location or choose an area manually. GPS suggestions use only areas that have saved GPS points.'
        : 'Refresh GPS Location or choose an area manually.';

  return (
    <View style={styles.locationPanel}>
      <View style={styles.locationPanelHeader}>
        <View style={styles.rowIconBubble}>
          <Ionicons
            name="location-outline"
            size={20}
            color={colors.primary}
          />
        </View>

        <View style={styles.rowMain}>
          <Text style={styles.panelTitle}>
            Project Area
          </Text>

          <Text style={styles.rowSub}>
            {selectedArea
              ? selectedArea.name
              : update.selectedAreaName || 'No area selected'}
          </Text>
        </View>
      </View>

      <Text style={styles.bodyText}>
        {suggestionText}
      </Text>

      {areaSuggestion ? (
        <Text style={styles.locationDetailText}>
          Distance: {formatFeet(areaSuggestion.distanceFeet)} | Radius:{' '}
          {formatFeet(areaSuggestion.area.radiusFeet)}
        </Text>
      ) : null}

      <Text style={styles.locationDetailText}>
        {hasGps
          ? `Area auto-detected${
              update.gpsAccuracy
                ? ` | Accuracy ${formatFeet(update.gpsAccuracy)}`
                : ''
            }`
          : locationStatus || 'Area suggested'}
      </Text>

      {locationStatus && hasGps ? (
        <Text style={styles.locationDetailText}>
          {locationStatus}
        </Text>
      ) : null}

      <View style={styles.locationActionRow}>
        <PrimaryButton
          label="Confirm Area"
          icon="checkmark-circle-outline"
          onPress={onConfirmArea}
          disabled={!areaSuggestion}
          compact
        />

        <SecondaryButton
          label="Refresh GPS"
          icon="navigate-outline"
          onPress={onRefreshLocation}
          compact
        />
      </View>

      <Text style={styles.sectionLabel}>
        Change Area
      </Text>

      <View style={styles.areaChipWrap}>
        {projectAreas.map(area => {
          const selected =
            area.id === update.selectedAreaId ||
            area.id === selectedArea?.id;

          return (
            <TouchableOpacity
              key={area.id}
              style={[
                styles.areaChip,
                selected && styles.areaChipSelected,
              ]}
              onPress={() => onChangeArea(area.id)}
            >
              <Text
                style={[
                  styles.areaChipText,
                  selected && styles.areaChipTextSelected,
                ]}
              >
                {area.name}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
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
            source={{ uri: photo.uri }}
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
}: {
  result: PIEPhotoIntelligenceDisplayState;
  projectName?: string;
  photo?: UpdatePhoto;
  onRetry?: () => void;
  onSignInRequired?: () => void;
}) {
  const priorUpdateUsed = priorUpdateUsedForPIEResult(result);
  const progress =
    result.projectProgress === 'supported'
      ? 'Project progress may be supported'
      : result.projectProgress === 'unsupported'
        ? 'Project progress unsupported'
        : 'Project progress unable to determine';

  const additions = result.additions || [];
  const removals = result.removals || [];
  const concerns =
    result.possibleConcerns && result.possibleConcerns.length > 0
      ? result.possibleConcerns
      : result.captureLimitations;
  const concernsLabel =
    result.possibleConcerns && result.possibleConcerns.length > 0
      ? 'Possible concerns'
      : 'Limitations';

  return (
    <View style={styles.locationPanel}>
      <View style={styles.locationPanelHeader}>
        <View style={styles.rowIconBubble}>
          <Ionicons
            name={
              result.status === 'analyzing'
                ? 'sync-outline'
                : result.status === 'analysis_failed_retry' ||
                  result.status === 'comparison_unavailable'
                  ? 'image-outline'
                  : 'sparkles-outline'
            }
            size={20}
            color={
              result.status === 'analysis_failed_retry'
                ? colors.warning
                : result.status === 'analysis_complete' ||
                  result.status === 'completed_with_limitations'
                  ? colors.success
                  : colors.primary
            }
          />
        </View>

        <View style={styles.rowMain}>
          <Text style={styles.panelTitle}>{pieUserStatus(result)}</Text>
          <Text style={styles.rowSub}>{progress}</Text>
        </View>
      </View>

      <Text style={styles.bodyText}>{result.summary}</Text>

      {result.currentObservation ? (
        <PIEDetailLine label="Current photo" value={result.currentObservation} />
      ) : null}

      {result.changedFromPrior ? (
        <PIEDetailLine label="Changed from prior" value={result.changedFromPrior} />
      ) : null}

      {additions.length > 0 ? (
        <PIEDetailLine label="Additions" value={additions.join(', ')} />
      ) : null}

      {removals.length > 0 ? (
        <PIEDetailLine label="Removals" value={removals.join(', ')} />
      ) : null}

      {result.possibleProgress ? (
        <PIEDetailLine label="Possible progress" value={result.possibleProgress} />
      ) : null}

      {concerns.length > 0 ? (
        <PIEDetailLine label={concernsLabel} value={concerns.join(' ')} />
      ) : null}

      {result.location ? (
        <Text style={styles.locationDetailText}>{result.location}</Text>
      ) : null}

      {result.comparisonConfidence ? (
        <Text style={styles.locationDetailText}>
          {pieConfidenceSentence(result.comparisonConfidence)}
        </Text>
      ) : null}

      {result.comparability ? (
        <Text style={styles.locationDetailText}>
          {pieComparabilitySentence(result.comparability)}
        </Text>
      ) : null}

      {priorUpdateUsed ? (
        <PIEDetailLine label="Prior update used" value={priorUpdateUsed} />
      ) : null}

      <PIEDetailLine label="Analysis time" value={analysisTimeTextForPIEResult(result.updatedAt)} />

      <Text style={styles.locationDetailText}>
        {result.authorityMessage}
      </Text>

      {onRetry ? (
        <TouchableOpacity
          style={styles.photoControlButton}
          onPress={onRetry}
          accessibilityLabel="Retry DAVE photo analysis"
        >
          <Ionicons name="refresh-outline" size={17} color={colors.primary} />
          <Text style={styles.photoControlText}>Retry Analysis</Text>
        </TouchableOpacity>
      ) : null}

      {onSignInRequired ? (
        <TouchableOpacity
          style={styles.photoControlButton}
          onPress={onSignInRequired}
          accessibilityLabel="Sign in to enable DAVE photo intelligence"
        >
          <Ionicons name="person-circle-outline" size={17} color={colors.primary} />
          <Text style={styles.photoControlText}>Sign in to enable photo intelligence</Text>
        </TouchableOpacity>
      ) : null}

      {__DEV__ && result.diagnostics ? (
        <View style={styles.setupProgressCard}>
          <Text style={styles.sectionLabel}>DAVE diagnostics</Text>
          <Text style={styles.locationDetailText}>
            Current project ID: {projectIdForPhotoVisionLabel(projectName) || 'none'}
          </Text>
          <Text style={styles.locationDetailText}>
            Current area ID: {photo?.selectedAreaId || 'none'}
          </Text>
          <Text style={styles.locationDetailText}>
            Current photo reference: {photo?.id || result.diagnostics.currentPhotoAssetId || 'none'}
          </Text>
          <Text style={styles.locationDetailText}>
            Current asset: {result.diagnostics.currentPhotoAssetId || 'none'}
          </Text>
          <Text style={styles.locationDetailText}>
            Prior asset: {result.diagnostics.priorPhotoAssetId || 'none'}
          </Text>
          <Text style={styles.locationDetailText}>
            Current prep: {result.diagnostics.currentPhotoPrepStatus}
          </Text>
          <Text style={styles.locationDetailText}>
            Current prep reason: {result.diagnostics.currentPhotoPrepReason || 'none'}
          </Text>
          <Text style={styles.locationDetailText}>
            Prior prep: {result.diagnostics.priorPhotoPrepStatus}
          </Text>
          <Text style={styles.locationDetailText}>
            Prior prep reason: {result.diagnostics.priorPhotoPrepReason || 'none'}
          </Text>
          <Text style={styles.locationDetailText}>
            Current readable: {result.diagnostics.currentPhotoReadable === null ? 'unknown' : result.diagnostics.currentPhotoReadable ? 'yes' : 'no'}
          </Text>
          <Text style={styles.locationDetailText}>
            Prior readable: {result.diagnostics.priorPhotoReadable === null ? 'unknown' : result.diagnostics.priorPhotoReadable ? 'yes' : 'no'}
          </Text>
          <Text style={styles.locationDetailText}>
            Usable prior found: {result.diagnostics.usablePriorCandidateFound === null ? 'unknown' : result.diagnostics.usablePriorCandidateFound ? 'yes' : 'no'}
          </Text>
          <Text style={styles.locationDetailText}>
            Current project key: {result.diagnostics.currentProjectKey || 'none'}
          </Text>
          <Text style={styles.locationDetailText}>
            Current area key: {result.diagnostics.currentAreaKey || 'none'}
          </Text>
          <Text style={styles.locationDetailText}>
            Prior candidates total: {result.diagnostics.totalPriorCandidateCount}
          </Text>
          <Text style={styles.locationDetailText}>
            After same project: {result.diagnostics.priorCandidatesAfterSameProject}
          </Text>
          <Text style={styles.locationDetailText}>
            After same area: {result.diagnostics.priorCandidatesAfterSameArea}
          </Text>
          <Text style={styles.locationDetailText}>
            After timestamp: {result.diagnostics.priorCandidatesAfterTimestamp}
          </Text>
          <Text style={styles.locationDetailText}>
            After excluding current: {result.diagnostics.priorCandidatesAfterExcludingCurrent}
          </Text>
          <Text style={styles.locationDetailText}>
            After usable image: {result.diagnostics.priorCandidatesAfterUsableImage}
          </Text>
          <Text style={styles.locationDetailText}>
            Selected prior update: {result.diagnostics.selectedPriorUpdateId ? 'yes' : 'no'}
          </Text>
          <Text style={styles.locationDetailText}>
            Selected prior photo: {result.diagnostics.selectedPriorPhotoId ? 'yes' : 'no'}
          </Text>
          <Text style={styles.locationDetailText}>
            Selected prior date: {result.diagnostics.selectedPriorDate || 'none'}
          </Text>
          <Text style={styles.locationDetailText}>
            No prior reason: {result.diagnostics.noPriorReason || 'none'}
          </Text>
          <Text style={styles.locationDetailText}>
            Skipped prior candidates: {result.diagnostics.skippedPriorCandidateCount}
          </Text>
          <Text style={styles.locationDetailText}>
            Image prep failure: {result.diagnostics.imagePrepareFailureReason || 'none'}
          </Text>
          <Text style={styles.locationDetailText}>
            Distinct hashes: {String(result.diagnostics.imageHashesDifferent)}
          </Text>
          <Text style={styles.locationDetailText}>
            Edge invoked: {String(result.diagnostics.executedStages.includes('edge_function_invoked'))}
          </Text>
          <Text style={styles.locationDetailText}>
            Provider: {result.diagnostics.providerResponseStatus || 'unknown'}
          </Text>
          <Text style={styles.locationDetailText}>
            Failure category: {result.diagnostics.failureCategory || 'none'}
          </Text>
          <Text style={styles.locationDetailText}>
            App auth mode: {result.diagnostics.appAuthMode || 'unknown'}
          </Text>
          <Text style={styles.locationDetailText}>
            Supabase user id present: {result.diagnostics.supabaseUserIdPresent === null ? 'unknown' : result.diagnostics.supabaseUserIdPresent ? 'yes' : 'no'}
          </Text>
          <Text style={styles.locationDetailText}>
            Session token present: {result.diagnostics.sessionTokenPresent === null ? 'unknown' : result.diagnostics.sessionTokenPresent ? 'yes' : 'no'}
          </Text>
          <Text style={styles.locationDetailText}>
            Last auth event: {result.diagnostics.lastAuthEvent || 'unknown'}
          </Text>
          <Text style={styles.locationDetailText}>
            Reached without Supabase auth: {result.diagnostics.screenReachedWithoutSupabaseAuth === null ? 'unknown' : result.diagnostics.screenReachedWithoutSupabaseAuth ? 'yes' : 'no'}
          </Text>
          <Text style={styles.locationDetailText}>
            Retry routed to sign-in: {result.diagnostics.retryRoutedToSignIn === null ? 'unknown' : result.diagnostics.retryRoutedToSignIn ? 'yes' : 'no'}
          </Text>
          <Text style={styles.locationDetailText}>
            Supabase auth state: {result.diagnostics.supabaseAuthState || 'unknown'}
          </Text>
          <Text style={styles.locationDetailText}>
            Token lookup result: {result.diagnostics.tokenLookupResult || 'unknown'}
          </Text>
          <Text style={styles.locationDetailText}>
            Token missing reason: {result.diagnostics.tokenMissingReason || 'none'}
          </Text>
          <Text style={styles.locationDetailText}>
            Sign-in client source: {result.diagnostics.signInClientSource || 'unknown'}
          </Text>
          <Text style={styles.locationDetailText}>
            DAVE analysis client source: {result.diagnostics.pieAnalysisClientSource || 'unknown'}
          </Text>
          <Text style={styles.locationDetailText}>
            Auth hydration completed: {result.diagnostics.authHydrationCompleted === null ? 'unknown' : result.diagnostics.authHydrationCompleted ? 'yes' : 'no'}
          </Text>
          <Text style={styles.locationDetailText}>
            Retry fetched fresh token: {result.diagnostics.retryFetchedFreshToken === null ? 'unknown' : result.diagnostics.retryFetchedFreshToken ? 'yes' : 'no'}
          </Text>
          <Text style={styles.locationDetailText}>
            Edge Function invoked: {result.diagnostics.edgeFunctionInvoked ? 'yes' : 'no'}
          </Text>
          <Text style={styles.locationDetailText}>
            Edge Function status: {result.diagnostics.edgeFunctionStatus || 'not invoked'}
          </Text>
          <Text style={styles.locationDetailText}>
            Comparison persisted: {String(Boolean(result.diagnostics.semanticComparisonResultId))}
          </Text>
          <Text style={styles.locationDetailText}>
            Hydrated pair match: {String(result.diagnostics.resultPairMatchesRequestedPair)}
          </Text>
          <Text style={styles.locationDetailText}>
            UI result hydrated: {String(result.diagnostics.executedStages.includes('user_card_render_ready'))}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

function pieConfidenceSentence(confidence: string): string {
  switch (confidence) {
    case 'high':
      return 'DAVE is highly confident in this finding.';
    case 'medium':
      return 'DAVE has moderate confidence in this finding.';
    case 'low':
      return 'DAVE has low confidence in this finding — treat it cautiously.';
    default:
      return `Confidence: ${confidence}`;
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
    return 'DAVE is confident in this observation. The interpretation above is still a judgment call — confirm it reflects real project context before using it as a claim.';
  }

  return 'DAVE suggestion only, moderate confidence. Confirm this interpretation before using it as a message claim.';
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
              <TouchableOpacity style={styles.compactInlineAction} onPress={onConfirm}>
                <Text style={styles.compactInlineActionText}>Confirm</Text>
              </TouchableOpacity>
            ) : null}
            {onDismiss ? (
              <TouchableOpacity style={styles.compactInlineAction} onPress={onDismiss}>
                <Text style={styles.compactInlineActionText}>Dismiss</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        ) : null}
      </View>
    </View>
  );
}

function UpdatePIEStatusSection({
  update,
  onRetryPhotoAnalysis,
  onSignInForPhotoAnalysis,
}: {
  update: ProjectUpdate;
  onRetryPhotoAnalysis: (photo: UpdatePhoto) => void;
  onSignInForPhotoAnalysis?: (photo: UpdatePhoto) => void;
}) {
  const photosWithPIE = update.photos.filter(photo => photo.photoIntelligence);

  if (update.photos.length === 0) return null;

  return (
    <View style={styles.panel}>
      <Text style={styles.panelTitle}>DAVE Photo Review</Text>
      {photosWithPIE.length === 0 ? (
        <Text style={styles.bodyText}>{PIE_STATUS_COPY.checking}</Text>
      ) : (
        photosWithPIE.map((photo, index) => (
          <RootPhotoIntelligenceCard
            key={photo.id}
            result={photo.photoIntelligence as PIEPhotoIntelligenceDisplayState}
            projectName={update.projectName}
            photo={photo}
            onRetry={
              photo.photoIntelligence?.status === 'analysis_failed_retry' ||
              photo.photoIntelligence?.status === 'comparison_unavailable'
                ? () => onRetryPhotoAnalysis(photo)
                : undefined
            }
            onSignInRequired={
              pieResultRequiresSupabaseSignIn(photo.photoIntelligence)
                ? () => (onSignInForPhotoAnalysis || onRetryPhotoAnalysis)(photo)
                : undefined
            }
          />
        ))
      )}
    </View>
  );
}

function SavedUpdatePIESummary({
  update,
  onRetryPhotoAnalysis,
  onSignInForPhotoAnalysis,
}: {
  update: ProjectUpdate;
  onRetryPhotoAnalysis: (update: ProjectUpdate, photo: UpdatePhoto) => void;
  onSignInForPhotoAnalysis?: (update: ProjectUpdate, photo: UpdatePhoto) => void;
}) {
  const firstResult = update.photos.find(photo => photo.photoIntelligence)?.photoIntelligence;
  const firstPriorUpdateUsed = priorUpdateUsedForPIEResult(firstResult);
  const failedPhoto = update.photos.find(
    photo =>
      photo.photoIntelligence?.status === 'analysis_failed_retry' ||
      photo.photoIntelligence?.status === 'comparison_unavailable',
  );

  if (update.photos.length === 0) return null;

  return (
    <View style={styles.setupProgressCard}>
      <Text style={styles.sectionLabelNoMargin}>DAVE Photo Review</Text>
      <Text style={styles.bodyText}>
        {firstResult
          ? pieUserStatus(firstResult)
          : PIE_STATUS_COPY.checking}
      </Text>
      {firstResult?.summary ? (
        <Text style={styles.locationDetailText}>{firstResult.summary}</Text>
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
        <Text style={styles.locationDetailText}>
          Prior update used: {firstPriorUpdateUsed}
        </Text>
      ) : null}
      {failedPhoto ? (
        <TouchableOpacity
          style={styles.photoControlButton}
          onPress={() => onRetryPhotoAnalysis(update, failedPhoto)}
          accessibilityLabel="Retry DAVE photo analysis"
        >
          <Ionicons name="refresh-outline" size={17} color={colors.primary} />
          <Text style={styles.photoControlText}>Retry Analysis</Text>
        </TouchableOpacity>
      ) : null}
      {firstResult && pieResultRequiresSupabaseSignIn(firstResult) && failedPhoto ? (
        <TouchableOpacity
          style={styles.photoControlButton}
          onPress={() => (onSignInForPhotoAnalysis || onRetryPhotoAnalysis)(update, failedPhoto)}
          accessibilityLabel="Sign in to enable DAVE photo intelligence"
        >
          <Ionicons name="person-circle-outline" size={17} color={colors.primary} />
          <Text style={styles.photoControlText}>Sign in to enable photo intelligence</Text>
        </TouchableOpacity>
      ) : null}
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

function projectIdForPhotoVisionLabel(projectName?: string) {
  if (!projectName?.trim()) return null;
  return `project-${projectName.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'unassigned'}`;
}

function PIEAnalysisStepScreen({
  update,
  pieStatus,
  onAddPhoto,
  onAddDocument,
  onRetryDocumentUpload,
  onContinue,
  onQuickContext,
  onRetry,
}: {
  update: ProjectUpdate;
  pieStatus: { status: FieldUpdatePIEStatus; summary: string };
  onAddPhoto: () => void;
  onAddDocument: () => void;
  onRetryDocumentUpload: (documentId: string) => void;
  onContinue: () => void;
  onQuickContext: (context: QuickContext) => void;
  onRetry: () => void;
}) {
  const documents = update.documents || [];
  const firstPrior = update.photos
    .map(photo => priorUpdateUsedForPIEResult(photo.photoIntelligence))
    .find(Boolean);

  return (
    <View>
      <ScreenTitle
        title={update.projectName}
        subtitle="New Field Update"
      />

      <FieldUpdateStepIndicator
        current="DAVE Analysis"
        pieStatus={pieStatus.status === 'complete' ? 'complete' : 'in_progress'}
      />

      <View style={styles.phase2BriefCard}>
        <View style={styles.phase2BriefIcon}>
          <Ionicons
            name={pieStatus.status === 'failed' ? 'warning-outline' : 'sync-outline'}
            size={21}
            color={pieStatus.status === 'failed' ? colors.warning : colors.primary}
          />
        </View>
        <View style={styles.rowMain}>
          <Text style={styles.panelTitle}>
            {pieStatus.status === 'failed'
              ? PIE_STATUS_COPY.unavailableRetry
              : pieStatus.status === 'no_prior_photo'
                ? PIE_STATUS_COPY.noPriorPhoto
                : pieStatus.status === 'no_visual_comparison'
                  ? 'No visual comparison available'
                  : pieStatus.status === 'analyzing'
                    ? PIE_STATUS_COPY.checking
                    : pieStatus.summary}
          </Text>
          <Text style={styles.bodyText}>
            {firstPrior
              ? `Comparing to prior photo from ${firstPrior}. This usually takes 10–30 seconds.`
              : pieStatus.status === 'no_prior_photo'
                ? 'This appears to be the first comparable photo for this project area.'
                : 'DAVE runs in the background. You can continue to Review now.'}
          </Text>
          {pieStatus.status === 'failed' || pieStatus.status === 'taking_longer' ? (
            <TouchableOpacity style={styles.photoControlButton} onPress={onRetry}>
              <Ionicons name="refresh-outline" size={17} color={colors.primary} />
              <Text style={styles.photoControlText}>Retry</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </View>

      <Text style={styles.sectionLabel}>Photos ({update.photos.length})</Text>
      {update.photos.length > 0 ? (
        <View style={styles.phase3ThumbRow}>
          {update.photos.map(photo => (
            <Image key={photo.id} source={{ uri: photo.uri }} style={styles.phase3Thumb} />
          ))}
        </View>
      ) : (
        <Text style={styles.mutedNote}>No photos attached</Text>
      )}
      <SecondaryButton label="Add More" icon="camera-outline" onPress={onAddPhoto} />

      <Text style={styles.sectionLabel}>Documents</Text>
      {documents.length > 0 ? (
        documents.map(document => (
          <ProjectDocumentInlineRow
            key={document.id}
            document={document}
            onRetry={() => onRetryDocumentUpload(document.id)}
          />
        ))
      ) : null}
      <SecondaryButton label="Add Document" icon="document-attach-outline" onPress={onAddDocument} />

      <Text style={styles.sectionLabel}>What best describes what you’re seeing?</Text>
      <View style={styles.phase3ChipWrap}>
        {QUICK_CONTEXTS.map(context => {
          const selected = update.quickContext === context;

          return (
            <TouchableOpacity
              key={context}
              style={[
                styles.phase3ContextChip,
                selected && styles.phase3ContextChipSelected,
              ]}
              onPress={() => onQuickContext(context)}
            >
              <Text
                style={[
                  styles.phase3ContextText,
                  selected && styles.phase3ContextTextSelected,
                ]}
              >
                {context}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <PrimaryButton
        label="Continue to Review"
        icon="arrow-forward-outline"
        onPress={onContinue}
      />
    </View>
  );
}

function BuildUpdateScreen({
  update,
  selectedArea,
  contacts,
  draftSavedAt,
  pieStatus,
  onNotesChange,
  onSendUpdate,
  onSaveDraft,
  onEditPhotos,
  onContacts,
  onSendEmail,
  onSendText,
  onCopy,
  onAddDocument,
  onRetryDocumentUpload,
  onConfirmInterpretation,
  onDismissInterpretation,
  onShareSheet,
  onRetryPhotoAnalysis,
}: {
  update: ProjectUpdate;
  selectedArea: ProjectArea | null;
  contacts: ProjectContact[];
  draftSavedAt: string | null;
  pieStatus: { status: FieldUpdatePIEStatus; summary: string };
  onNotesChange: (notes: string) => void;
  onSendUpdate: () => void;
  onSaveDraft: () => void;
  onEditPhotos: () => void;
  onContacts: () => void;
  onSendEmail: () => void;
  onSendText: () => void;
  onCopy: () => void;
  onAddDocument: () => void;
  onRetryDocumentUpload: (documentId: string) => void;
  onConfirmInterpretation: (interpretation: string) => void;
  onDismissInterpretation: (interpretation: string) => void;
  onShareSheet: () => void;
  onRetryPhotoAnalysis: (photo: UpdatePhoto) => void;
}) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [messageOpen, setMessageOpen] = useState(false);
  const [moreOptionsOpen, setMoreOptionsOpen] = useState(false);
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
  const previewLine = buildPreviewLine(update, contacts);
  const fullMessage = buildGeneratedUpdateMessage(update, pieStatus);
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
        <Text style={styles.panelTitle}>DAVE Summary</Text>
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
          role={hasSafety ? 'safety' : 'confirmedClear'}
          title={hasSafety ? 'Safety concern requires review' : 'No safety concerns detected'}
        />
        <PIEFindingRow
          role={hasBlocker ? 'interpretation' : 'confirmedClear'}
          title={hasBlocker ? 'Possible blocker requires review' : 'No open blockers detected'}
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
            <Image key={photo.id} source={{ uri: photo.uri }} style={styles.phase3Thumb} />
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

      <View style={styles.contactSummary}>
        <Ionicons name="people-outline" size={18} color={colors.primary} />
        <Text style={styles.contactSummaryText}>
          Recipients: {contacts.length > 0 ? `Site Team · ${contacts.length} people` : 'None selected'}
        </Text>
        <TouchableOpacity onPress={onContacts}>
          <Text style={styles.contactSummaryAction}>Change</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.panel}>
        <View style={styles.sectionHeaderRow}>
          <View>
            <Text style={styles.label}>
              Notes (optional)
            </Text>
            {update.pieSuggestedNoteAccepted ? (
              <Text style={styles.locationDetailText}>
                DAVE suggested — edit or clear
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

      <View style={styles.panel}>
        <Text style={styles.panelTitle}>Message Preview</Text>
        <Text style={styles.bodyText}>{previewLine}</Text>
        <TouchableOpacity
          style={styles.photoControlButton}
          onPress={() => setMessageOpen(prev => !prev)}
        >
          <Ionicons name={messageOpen ? 'chevron-up-outline' : 'chevron-down-outline'} size={17} color={colors.primary} />
          <Text style={styles.photoControlText}>View Full Message</Text>
        </TouchableOpacity>
        {messageOpen ? (
          <Text style={styles.previewBody}>{fullMessage}</Text>
        ) : null}
      </View>

      <View style={styles.sendRow}>
        <SecondaryButton
          label="Save"
          icon="bookmark-outline"
          onPress={onSaveDraft}
          compact
        />

        <PrimaryButton
          label="Send Update"
          icon="send-outline"
          onPress={onSendUpdate}
          compact
        />
      </View>

      <SecondaryButton
        label="More Options"
        icon="ellipsis-horizontal-outline"
        onPress={() => setMoreOptionsOpen(true)}
      />

      <MoreOptionsSheet
        visible={moreOptionsOpen}
        onClose={() => setMoreOptionsOpen(false)}
        onEmail={onSendEmail}
        onText={onSendText}
        onCopy={onCopy}
        onEditPhotos={onEditPhotos}
        onAddDocument={onAddDocument}
        onShareSheet={onShareSheet}
      />
    </View>
  );
}

function MoreOptionsSheet({
  visible,
  onClose,
  onEmail,
  onText,
  onCopy,
  onEditPhotos,
  onAddDocument,
  onShareSheet,
}: {
  visible: boolean;
  onClose: () => void;
  onEmail: () => void;
  onText: () => void;
  onCopy: () => void;
  onEditPhotos: () => void;
  onAddDocument: () => void;
  onShareSheet: () => void;
}) {
  function run(action: () => void) {
    onClose();
    action();
  }

  return (
    <ProjectActionSheet visible={visible} title="More Options" onClose={onClose}>
      <MoreOptionRow label="Email" icon="mail-outline" onPress={() => run(onEmail)} />
      <MoreOptionRow label="Text" icon="chatbubble-outline" onPress={() => run(onText)} />
      <MoreOptionRow label="Copy" icon="copy-outline" onPress={() => run(onCopy)} />
      <MoreOptionRow label="Edit Photos" icon="images-outline" onPress={() => run(onEditPhotos)} />
      <MoreOptionRow label="Add Document" icon="document-attach-outline" onPress={() => run(onAddDocument)} />
      {Platform.OS === 'ios' ? (
        <MoreOptionRow label="iOS Share Sheet" icon="share-outline" onPress={() => run(onShareSheet)} />
      ) : null}
    </ProjectActionSheet>
  );
}

function MoreOptionRow({
  label,
  icon,
  onPress,
}: {
  label: string;
  icon: IconName;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity style={styles.projectSelectorRow} onPress={onPress}>
      <View style={styles.rowIconBubble}>
        <Ionicons name={icon} size={20} color={colors.primary} />
      </View>
      <View style={styles.rowMain}>
        <Text style={styles.projectName}>{label}</Text>
      </View>
      <Ionicons name="chevron-forward" size={20} color={colors.muted} />
    </TouchableOpacity>
  );
}

function ReadOnlyUpdateDetailScreen({
  update,
  onBack,
  onRetry,
  onRetryPhotoAnalysis,
  onDelete,
  onArchive,
}: {
  update: ProjectUpdate;
  onBack: () => void;
  onRetry?: () => void;
  onRetryPhotoAnalysis?: (update: ProjectUpdate, photo: UpdatePhoto) => void;
  onDelete: () => void;
  onArchive: () => void;
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
      <TouchableOpacity style={styles.phase2BackButton} onPress={onBack}>
        <Ionicons name="chevron-back" size={21} color={colors.primary} />
        <Text style={styles.dashboardManageText}>Updates</Text>
      </TouchableOpacity>
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
            <Text style={styles.photoControlText}>Retry Send</Text>
          </TouchableOpacity>
        ) : null}
      </View>
      <View style={styles.panel}>
        <Text style={styles.panelTitle}>DAVE Summary</Text>
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
            ? 'Timing markers will appear after this update is sent or queued.'
            : `${timing.elapsedSeconds}s from New Field Update to sent or queued. Target: ${timing.targetSeconds}s.`}
        </Text>
        {timing.canSendWhileAnalysisPending ? (
          <Text style={styles.locationDetailText}>
            Send was available while DAVE was still checking photos.
          </Text>
        ) : null}
      </View>
      {update.photos.length > 0 ? (
        <>
          <Text style={styles.sectionLabel}>Photos ({update.photos.length})</Text>
          <View style={styles.phase3ThumbRow}>
            {update.photos.map(photo => (
              <Image key={photo.id} source={{ uri: photo.uri }} style={styles.phase3Thumb} />
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

function ProjectsScreen({
  contentStyle,
  activeProjects,
  savedUpdates,
  projectDocuments,
  contactBook,
  projectStatsByName,
  projectRecords,
  onSelect,
  onAddProject,
  initialStatusFilter,
}: {
  contentStyle: StyleProp<ViewStyle>;
  activeProjects: string[];
  savedUpdates: ProjectUpdate[];
  projectDocuments: ProjectDocument[];
  contactBook: ContactBook;
  projectStatsByName: Record<string, ProjectStats>;
  projectRecords: ProjectRecord[];
  onSelect: (projectName: string) => void;
  onAddProject: (projectName: string) => boolean;
  initialStatusFilter?: 'onTrack';
}) {
  const [searchText, setSearchText] = useState('');
  const [showAddProject, setShowAddProject] = useState(false);
  const [statusFilter, setStatusFilter] = useState<'onTrack' | null>(
    initialStatusFilter ?? null,
  );
  const search = searchText.trim().toLowerCase();

  const projectRows = activeProjects
    .map(project => ({
      project,
      stats: projectStatsForName(projectStatsByName, project),
      thumbnailUri: resolveProjectCoverPhotoUri(
        projectRecords,
        project,
        projectThumbnailUri(project, savedUpdates),
      ),
      documentCount: projectDocumentCountForProject(project, projectDocuments),
      contactCount: contactBook.contacts.length,
      attentionCount: buildPhase2AttentionItems(savedUpdates, project).length,
    }))
    .filter(item => {
      if (!search) return true;

      return item.project.toLowerCase().includes(search);
    })
    .filter(item => {
      if (statusFilter !== 'onTrack') return true;

      return projectRowStatus(item.attentionCount, item.stats.openActions) === 'On Track';
    })
    .sort((a, b) => {
      if (b.stats.overdueActions !== a.stats.overdueActions) {
        return b.stats.overdueActions - a.stats.overdueActions;
      }
      if (b.stats.openActions !== a.stats.openActions) {
        return b.stats.openActions - a.stats.openActions;
      }

      return a.project.localeCompare(b.project);
    });

  const renderProject = ({ item }: { item: typeof projectRows[number] }) => {
    return (
      <Phase2ProjectCard
        item={item}
        onPress={() => onSelect(item.project)}
      />
    );
  };

  return (
    <FlatList
      style={styles.appFrame}
      contentContainerStyle={contentStyle}
      keyboardShouldPersistTaps="handled"
      data={projectRows}
      keyExtractor={item => `active-${item.project}`}
      renderItem={renderProject}
      ListHeaderComponent={
        <>
          <ScreenTitle
            title="Projects"
            subtitle="Open a project workspace or start a field update."
          />

          <View style={styles.projectFinderPanel}>
            <View style={styles.projectSearchBox}>
              <Ionicons
                name="search-outline"
                size={19}
                color={colors.muted}
              />

              <TextInput
                style={styles.projectSearchInput}
                value={searchText}
                onChangeText={setSearchText}
                placeholder="Search projects"
                placeholderTextColor={colors.muted}
                autoCapitalize="none"
              />

              {searchText.trim() ? (
                <TouchableOpacity
                  style={styles.projectSearchClearButton}
                  onPress={() => setSearchText('')}
                  accessibilityRole="button"
                  accessibilityLabel="Clear project search"
                >
                  <Ionicons
                    name="close-circle"
                    size={21}
                    color={colors.muted}
                  />
                </TouchableOpacity>
              ) : null}
            </View>

            <Text style={styles.locationDetailText}>
              {projectRows.length} open project{projectRows.length === 1 ? '' : 's'} shown
              {statusFilter === 'onTrack' ? ' · showing on-track projects only' : ''}
            </Text>

            {statusFilter === 'onTrack' ? (
              <SecondaryButton
                label="Show all projects"
                icon="close-circle-outline"
                onPress={() => setStatusFilter(null)}
                compact
              />
            ) : null}
          </View>

          <PrimaryButton
            label="New Project"
            icon="add-circle-outline"
            onPress={() => setShowAddProject(prev => !prev)}
          />

          {showAddProject ? (
            <AddProjectCard
              buttonLabel="Create Project"
              placeholder="New project name"
              onAdd={onAddProject}
            />
          ) : null}

          <Text style={styles.sectionLabel}>
            Open Projects
          </Text>
        </>
      }
      ListEmptyComponent={
        <EmptyState
          title={search ? 'No matching projects' : 'No projects yet'}
          text={search
            ? 'Try a different project name or clear the search.'
            : 'Create your first project to begin capturing updates and building DAVE project intelligence.'}
        />
      }
    />
  );
}

function projectRowStatus(
  attentionCount: number,
  openActions: number,
): 'Attention Needed' | 'Waiting' | 'On Track' {
  if (attentionCount > 0) return 'Attention Needed';
  if (openActions > 0) return 'Waiting';

  return 'On Track';
}

function Phase2ProjectCard({
  item,
  onPress,
}: {
  item: {
    project: string;
    stats: ProjectStats;
    thumbnailUri?: string | null;
    documentCount: number;
    contactCount: number;
    attentionCount: number;
  };
  onPress: () => void;
}) {
  const hasActivity = item.stats.updates > 0;
  const status = projectRowStatus(item.attentionCount, item.stats.openActions);
  const tier = !hasActivity
    ? {
        tint: colors.fill,
        iconColor: colors.muted,
        icon: 'business-outline' as const,
        label: 'No activity yet',
      }
    : status === 'Attention Needed'
      ? {
          tint: colors.warningSoft,
          iconColor: colors.warning,
          icon: 'warning-outline' as const,
          label: 'At Risk',
        }
      : status === 'Waiting'
        ? {
            tint: colors.primarySoft,
            iconColor: colors.primary,
            icon: 'time-outline' as const,
            label: 'In Progress',
          }
        : {
            tint: colors.successSoft,
            iconColor: colors.success,
            icon: 'checkmark-circle-outline' as const,
            label: 'Healthy',
          };

  const activitySegments = [
    item.stats.photos > 0
      ? `${item.stats.photos} photo${item.stats.photos === 1 ? '' : 's'}`
      : null,
    item.documentCount > 0
      ? `${item.documentCount} document${item.documentCount === 1 ? '' : 's'}`
      : null,
    item.stats.openActions > 0
      ? `${item.stats.openActions} open item${item.stats.openActions === 1 ? '' : 's'}`
      : null,
  ].filter(Boolean);

  return (
    <TouchableOpacity
      style={styles.phase2ProjectCard}
      onPress={onPress}
    >
      {item.thumbnailUri ? (
        <Image source={{ uri: item.thumbnailUri }} style={styles.phase2ProjectThumb} />
      ) : (
        <View style={styles.phase2ProjectThumbPlaceholder}>
          <Ionicons name={tier.icon} size={28} color={tier.iconColor} />
        </View>
      )}

      <View style={styles.rowMain}>
        <View style={styles.phase2ProjectTitleRow}>
          <Text style={styles.phase2ProjectTitle} numberOfLines={1}>{item.project}</Text>
          <View style={[styles.phase2ProjectStatusPill, { backgroundColor: tier.tint }]}>
            <Text style={[styles.phase2ProjectStatusText, { color: tier.iconColor }]}>{tier.label}</Text>
          </View>
        </View>
        {activitySegments.length > 0 ? (
          <Text style={styles.phase2ProjectSummary} numberOfLines={2}>{activitySegments.join(' · ')}</Text>
        ) : null}
        <Text style={styles.phase2ProjectActivity}>
          {item.stats.lastUpdate
            ? `Last activity ${relativeUpdateDateLabel(item.stats.lastUpdate)}`
            : hasActivity ? 'Activity recorded' : 'No activity recorded yet'}
        </Text>
      </View>

      <Ionicons name="chevron-forward" size={22} color={colors.muted} />
    </TouchableOpacity>
  );
}

function DailyBriefSection({
  title,
  items,
  emptyText,
  onOpen,
}: {
  title: string;
  items: Array<DAVEProjectDailyBriefItem | DAVEProjectDailyBriefAttentionItem>;
  emptyText: string;
  onOpen: (item: DAVEProjectDailyBriefItem | DAVEProjectDailyBriefAttentionItem) => void;
}) {
  return (
    <View>
      <Text style={styles.sectionLabelNoMargin}>{title}</Text>
      {items.length === 0 ? (
        <Text style={styles.locationDetailText}>{emptyText}</Text>
      ) : (
        items.map(item => (
          <TouchableOpacity
            key={item.id}
            style={styles.projectSelectorRow}
            onPress={() => onOpen(item)}
            accessibilityRole="button"
            accessibilityLabel={`${title}: ${item.text}`}
          >
            <View style={styles.rowMain}>
              <Text style={styles.locationDetailText}>• {item.text}</Text>
              {'whyItMatters' in item ? (
                <Text style={styles.rowSub}>{item.whyItMatters} {item.actionText}</Text>
              ) : null}
            </View>
            <Ionicons name="chevron-forward" size={17} color={colors.muted} />
          </TouchableOpacity>
        ))
      )}
    </View>
  );
}

function WorkspaceCardSkeleton() {
  return (
    <View
      style={styles.workspaceSkeleton}
      accessible
      accessibilityLabel="Loading project priority"
    >
      <View style={[styles.workspaceSkeletonLine, { width: '72%' }]} />
      <View style={[styles.workspaceSkeletonLine, { width: '94%' }]} />
      <View style={[styles.workspaceSkeletonLine, { width: '58%' }]} />
    </View>
  );
}

type DAVEWorkspaceOpenItem = {
  navigationTarget: DAVEBriefNavigationTarget;
  sourceRecordId: string;
};

function ProjectWorkspaceScreen({
  contentStyle,
  projectName,
  savedUpdates,
  captureMemories,
  projectAreas,
  projectDocuments,
  scheduleItems,
  contactBook,
  projectStats,
  coverPhoto,
  coverPhotoMode,
  coverPhotoUri,
  onTakeNewCoverPhoto,
  onChooseCoverFromLibrary,
  onUseBestProjectPhoto,
  onRemoveCoverPhoto,
  onBack,
  onNewFieldUpdate,
  onSaveCaptureMemory,
  onDeleteCaptureMemory,
  onOpenUpdates,
  onOpenPhotoDifferences,
  onOpenDocuments,
  onOpenDailyBriefItem,
  onRetryQueuedUpdate,
  onDeleteProject,
  isDeletingProject,
}: {
  contentStyle: StyleProp<ViewStyle>;
  projectName: string;
  savedUpdates: ProjectUpdate[];
  captureMemories: readonly DAVEConfirmedCaptureMemory[];
  projectAreas: ProjectArea[];
  projectDocuments: ProjectDocument[];
  scheduleItems: ScheduleItem[];
  contactBook: ContactBook;
  projectStats: ProjectStats;
  coverPhoto: ProjectCoverPhoto | null;
  coverPhotoMode: 'automatic' | 'manual';
  coverPhotoUri: string | null;
  onTakeNewCoverPhoto: () => void;
  onChooseCoverFromLibrary: () => void;
  onUseBestProjectPhoto: () => void;
  onRemoveCoverPhoto: () => void;
  onBack: () => void;
  onNewFieldUpdate: (projectName?: string) => void;
  onSaveCaptureMemory: (memory: DAVEConfirmedCaptureMemory) => Promise<void>;
  onDeleteCaptureMemory: (memoryId: string) => Promise<void>;
  onOpenUpdates: () => void;
  onOpenPhotoDifferences: (projectName: string) => void;
  onOpenDocuments: () => void;
  onOpenDailyBriefItem: (
    item: DAVEWorkspaceOpenItem,
  ) => void;
  onRetryQueuedUpdate: (update: ProjectUpdate) => void;
  onDeleteProject: (projectName: string) => void;
  isDeletingProject: boolean;
}) {
  const projectUpdates = savedUpdates.filter(
    update => projectMatchesScope(update, projectName),
  );
  const projectDocumentCount = projectDocumentCountForProject(projectName, projectDocuments);
  const projectActivity = buildPhase2ActivityItems(
    savedUpdates,
    projectName,
    projectDocuments,
  );
  const notesCount = projectUpdates.filter(update => update.notes.trim()).length;
  const issuesCount = projectStats.openActions + projectStats.overdueActions;
  const pieBrief = buildPIEProjectBriefModel(projectName, savedUpdates);
  const documentBrief = buildProjectDocumentMetadataBrief(projectName, projectDocuments);
  const projectIntelligence = useMemo(() => buildProjectIntelligence({
    projectId: authorityProjectId(projectName),
    projectName,
    updates: savedUpdates,
    documents: projectDocuments,
    scheduleItems,
    captureMemories,
  }), [projectName, savedUpdates, projectDocuments, scheduleItems, captureMemories]);
  const dailyBrief = projectIntelligence.dailyBrief;
  const evidenceQuality = projectIntelligence.evidenceQuality;
  const actionCenter = projectIntelligence.actionCenter;
  const actionCenterDismissKey = `dave-action-center-dismissed:${authorityProjectId(projectName)}:${isoToday()}`;
  const [actionCenterDismissed, setActionCenterDismissed] = useState<boolean | null>(null);
  const [typedCaptureOpen, setTypedCaptureOpen] = useState(false);
  const [captureDraft, setCaptureDraft] = useState<DAVECaptureMemory | null>(null);
  const [selectedCaptureMemory, setSelectedCaptureMemory] = useState<DAVEConfirmedCaptureMemory | null>(null);

  useEffect(() => {
    let active = true;
    setActionCenterDismissed(null);
    AsyncStorage.getItem(actionCenterDismissKey)
      .then(value => {
        if (active) setActionCenterDismissed(value === 'dismissed');
      })
      .catch(() => {
        if (active) setActionCenterDismissed(false);
      });
    return () => {
      active = false;
    };
  }, [actionCenterDismissKey]);

  const actionCenterSource = actionCenter.supportingEvidence.find(evidence => evidence.sourceType === 'update') ||
    actionCenter.supportingEvidence[0];
  const workspaceFadeStyle = useFadeSlideIn(260);
  const projectHealthIsProblem = dailyBrief.reality.state === 'Blocked' || dailyBrief.reality.state === 'At Risk';
  const projectHealthIsHealthy = dailyBrief.reality.state === 'Moving';
  const projectHealthColor = projectHealthIsProblem
    ? colors.danger
    : projectHealthIsHealthy
      ? colors.success
      : colors.warning;

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
        accessibilityLabel="Back to Projects"
      >
        <Ionicons name="chevron-back" size={21} color={colors.primary} />
        <Text style={styles.dashboardManageText}>Projects</Text>
      </TouchableOpacity>

      <ScreenTitle
        title={projectName}
        subtitle="Project workspace"
      />

      <View style={styles.projectWorkspaceHero}>
        {coverPhotoUri ? (
          <Image
            source={{ uri: coverPhotoUri }}
            style={styles.projectWorkspaceHeroImage}
            accessibilityLabel={`${projectName} project cover photo`}
          />
        ) : (
          <View style={styles.projectWorkspaceHeroPlaceholder}>
            <Ionicons name="image-outline" size={30} color={colors.muted} />
            <Text style={styles.locationDetailText}>Project cover photo</Text>
          </View>
        )}
        <Text style={styles.projectWorkspaceCoverTitle}>Set Project Cover</Text>
        <View style={styles.projectWorkspaceCoverActions}>
          <TouchableOpacity
            style={[styles.photoControlButton, styles.projectWorkspaceCoverButton]}
            onPress={onTakeNewCoverPhoto}
            accessibilityRole="button"
            accessibilityLabel="Take New Photo for project cover"
          >
            <Ionicons name="camera-outline" size={17} color={colors.primary} />
            <Text style={styles.photoControlText}>Take New Photo</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.photoControlButton, styles.projectWorkspaceCoverButton]}
            onPress={onChooseCoverFromLibrary}
            accessibilityRole="button"
            accessibilityLabel="Choose project cover from library"
          >
            <Ionicons name="images-outline" size={17} color={colors.primary} />
            <Text style={styles.photoControlText}>Choose From Library</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.photoControlButton, styles.projectWorkspaceCoverButton]}
            onPress={onUseBestProjectPhoto}
            accessibilityRole="button"
            accessibilityLabel="Use Best Project Photo automatically"
          >
            <Ionicons name="sparkles-outline" size={17} color={colors.primary} />
            <Text style={styles.photoControlText}>Use Best Project Photo</Text>
          </TouchableOpacity>
          {coverPhoto ? (
            <TouchableOpacity
              style={[styles.photoControlButton, styles.projectWorkspaceCoverButton]}
              onPress={onRemoveCoverPhoto}
              accessibilityRole="button"
              accessibilityLabel="Remove Cover Photo"
            >
              <Ionicons name="trash-outline" size={17} color={colors.danger} />
              <Text style={[styles.photoControlText, { color: colors.danger }]}>Remove Cover Photo</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </View>

      <Animated.View style={workspaceFadeStyle}>
      <View style={styles.phase2BriefCard}>
        <View style={[styles.phase2BriefIcon, styles.phase2BriefIconAttention]}>
          <Ionicons name="flag-outline" size={20} color={colors.warning} />
        </View>
        <View style={styles.rowMain}>
          <Text style={styles.panelTitle}>Today's Priority</Text>
          {actionCenterDismissed === null ? (
            <WorkspaceCardSkeleton />
          ) : actionCenterDismissed ? (
            <Text style={styles.locationDetailText}>Dismissed for today.</Text>
          ) : (
            <>
              <TouchableOpacity
                style={styles.projectSelectorRow}
                disabled={!actionCenterSource}
                onPress={() => {
                  if (!actionCenterSource) return;
                  onOpenDailyBriefItem({
                    navigationTarget: actionCenter.navigationTarget,
                    sourceRecordId: actionCenterSource.recordId,
                  });
                }}
                accessibilityRole="button"
                accessibilityLabel={`${actionCenter.priority}. ${actionCenter.reason}`}
              >
                <View style={styles.rowMain}>
                  <Text style={styles.bodyText}>{actionCenter.priority}</Text>
                  <Text style={styles.locationDetailText}>{actionCenter.reason}</Text>
                  {actionCenter.recommendedAction ? (
                    <Text style={styles.photoControlText}>{actionCenter.recommendedAction}</Text>
                  ) : null}
                  {actionCenter.confidence ? (
                    <Text style={styles.rowSub}>Confidence: {actionCenter.confidence}</Text>
                  ) : null}
                  {actionCenter.limitations.map(limitation => (
                    <Text key={limitation} style={styles.rowSub}>{limitation}</Text>
                  ))}
                </View>
                {actionCenterSource ? <Ionicons name="chevron-forward" size={17} color={colors.muted} /> : null}
              </TouchableOpacity>
              {actionCenter.recommendedAction ? (
                <TouchableOpacity
                  style={styles.photoControlButton}
                  onPress={() => {
                    setActionCenterDismissed(true);
                    AsyncStorage.setItem(actionCenterDismissKey, 'dismissed').catch(() => undefined);
                  }}
                >
                  <Text style={styles.photoControlText}>Dismiss for Today</Text>
                </TouchableOpacity>
              ) : null}
            </>
          )}
        </View>
      </View>

      <View style={styles.phase2BriefCard}>
        <View style={styles.phase2BriefIcon}>
          <Ionicons name="sunny-outline" size={21} color={colors.primary} />
        </View>
        <View style={styles.rowMain}>
          <Text style={styles.panelTitle}>DAVE Daily Brief</Text>
          <DailyBriefSection
            title="Changed"
            items={dailyBrief.changedItems}
            emptyText={dailyBrief.emptyStates.changed}
            onOpen={onOpenDailyBriefItem}
          />
          <DailyBriefSection
            title="Uncertain"
            items={dailyBrief.uncertaintyItems}
            emptyText={dailyBrief.emptyStates.uncertainty}
            onOpen={onOpenDailyBriefItem}
          />
          <DailyBriefSection
            title="Needs attention"
            items={dailyBrief.attentionItems}
            emptyText={dailyBrief.emptyStates.attention}
            onOpen={onOpenDailyBriefItem}
          />
          <Text style={styles.sectionLabelNoMargin}>Recommended next action</Text>
          {dailyBrief.recommendedAction ? (
            <TouchableOpacity
              style={styles.photoControlButton}
              onPress={() => onOpenDailyBriefItem(dailyBrief.recommendedAction!)}
            >
              <Ionicons name="arrow-forward-circle-outline" size={17} color={colors.primary} />
              <View style={styles.rowMain}>
                <Text style={styles.photoControlText}>{dailyBrief.recommendedAction.text}</Text>
                <Text style={styles.locationDetailText}>{dailyBrief.recommendedAction.reason}</Text>
              </View>
            </TouchableOpacity>
          ) : (
            <Text style={styles.locationDetailText}>{dailyBrief.emptyStates.recommendation}</Text>
          )}
        </View>
      </View>

      <DAVEAskExperience
        intelligence={projectIntelligence}
        onOpenSupportingRecord={(target, sourceRecordId) => {
          onOpenDailyBriefItem({ navigationTarget: target, sourceRecordId });
        }}
      />

      <View style={styles.phase2BriefCard}>
        <View style={[
          styles.phase2BriefIcon,
          projectHealthIsProblem
            ? styles.phase2BriefIconProblem
            : projectHealthIsHealthy
              ? styles.phase2BriefIconHealthy
              : styles.phase2BriefIconAttention,
        ]}>
          <Ionicons name="shield-checkmark-outline" size={20} color={projectHealthColor} />
        </View>
        <View style={styles.rowMain}>
          <Text style={styles.panelTitle}>Project Health</Text>
          <Text style={styles.bodyText}>
            {dailyBrief.reality.state} · {dailyBrief.reality.confidence} confidence
          </Text>
          <Text style={styles.bodyText}>Evidence Strength: {evidenceQuality.strength}</Text>
          {evidenceQuality.signals.map(signal => (
            <View key={signal.id} style={styles.projectSelectorRow}>
              <View style={styles.rowMain}>
                <Text style={styles.locationDetailText}>{signal.label}: {signal.value}</Text>
                {signal.whyItMatters ? (
                  <Text style={styles.rowSub}>Why it matters: {signal.whyItMatters}</Text>
                ) : null}
              </View>
            </View>
          ))}
          <Text style={styles.locationDetailText}>{evidenceQuality.limitation}</Text>
        </View>
      </View>

      <View style={styles.phase2BriefCard}>
        <View style={styles.phase2BriefIcon}>
          <Ionicons name="time-outline" size={21} color={colors.primary} />
        </View>
        <View style={styles.rowMain}>
          <Text style={styles.panelTitle}>Project Timeline</Text>
          {dailyBrief.reality.recentTimelineEvents.length === 0 ? (
            <Text style={styles.locationDetailText}>
              Capture your first project update to begin building a verified project timeline.
            </Text>
          ) : (
            dailyBrief.reality.recentTimelineEvents.slice(0, 3).map(timelineEvent => {
              const source = timelineEvent.evidence.find(item => item.sourceType === 'update') ||
                timelineEvent.evidence[0];
              const memoryEvidence = timelineEvent.evidence.find(item => item.sourceType === 'memory');
              const sourceMemory = memoryEvidence
                ? captureMemories.find(memory => memory.id === memoryEvidence.recordId) || null
                : null;
              const canOpen = Boolean(sourceMemory || (source && timelineEvent.navigationTarget !== 'project_workspace'));
              const rowContent = (
                <>
                  <View style={styles.rowMain}>
                    <Text style={styles.locationDetailText}>{timelineEvent.title}</Text>
                    <Text style={styles.rowSub}>{formatSavedTime(timelineEvent.timestamp)} · {timelineEvent.evidenceClass}</Text>
                    <Text style={styles.rowSub}>{timelineEvent.summary}</Text>
                  </View>
                  {canOpen ? <Ionicons name="chevron-forward" size={17} color={colors.muted} /> : null}
                </>
              );

              return canOpen ? (
                <TouchableOpacity
                  key={timelineEvent.id}
                  style={styles.projectSelectorRow}
                  onPress={() => {
                    if (sourceMemory) {
                      setSelectedCaptureMemory(sourceMemory);
                      return;
                    }
                    if (!source) return;
                    onOpenDailyBriefItem({
                      navigationTarget: timelineEvent.navigationTarget,
                      sourceRecordId: source.recordId,
                    });
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={`${timelineEvent.title}. ${timelineEvent.summary}`}
                >
                  {rowContent}
                </TouchableOpacity>
              ) : (
                <View key={timelineEvent.id} style={styles.projectSelectorRow}>
                  {rowContent}
                </View>
              );
            })
          )}
        </View>
      </View>
      </Animated.View>

      <View style={styles.phase2BriefCard}>
        <View style={styles.phase2BriefIcon}>
          <Ionicons name="sparkles-outline" size={21} color={colors.primary} />
        </View>
        <View style={styles.rowMain}>
          <Text style={styles.panelTitle}>DAVE Project Brief</Text>
          <Text style={styles.bodyText}>{pieBrief.summary}</Text>
          {pieBrief.observations.length > 0 ? (
            <>
              <Text style={styles.sectionLabelNoMargin}>Latest observations</Text>
              {pieBrief.observations.map(observation => (
                <TouchableOpacity
                  key={observation.id}
                  style={styles.projectSelectorRow}
                  onPress={() => onOpenPhotoDifferences(projectName)}
                >
                  <View style={styles.rowMain}>
                    <Text style={styles.locationDetailText}>
                      Observed: {observation.context} — {observation.text}
                    </Text>
                  </View>
                  <Text style={styles.dashboardManageText}>View</Text>
                </TouchableOpacity>
              ))}
            </>
          ) : pieBrief.lowDetailFallback ? (
            <Text style={styles.locationDetailText}>
              Possible visual changes found. Review details before using in an update.
            </Text>
          ) : null}
          {(pieBrief.observations.length > 0 || pieBrief.lowDetailFallback || pieBrief.analysisUnavailable) ? (
            <TouchableOpacity
              style={styles.photoControlButton}
              onPress={() => onOpenPhotoDifferences(projectName)}
            >
              <Ionicons name="git-compare-outline" size={17} color={colors.primary} />
              <Text style={styles.photoControlText}>View photo differences</Text>
            </TouchableOpacity>
          ) : null}
          <Text style={styles.locationDetailText}>{documentBrief}</Text>
        </View>
      </View>

      <PrimaryButton
        label="New Field Update"
        icon="camera-outline"
        onPress={() => onNewFieldUpdate(projectName)}
      />

      <SecondaryButton
        label="Capture Memory"
        icon="chatbox-ellipses-outline"
        onPress={() => setTypedCaptureOpen(true)}
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
          sourceLabel="Source note"
          onSave={async memory => {
            await onSaveCaptureMemory(memory);
            setCaptureDraft(null);
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

      <Text style={styles.sectionLabel}>Tools</Text>
      <View style={styles.phase2ToolsGrid}>
        <WorkspaceTool
          label="Photos"
          subtitle={`${projectStats.photos} saved`}
          icon="images-outline"
          onPress={onOpenUpdates}
        />
        <WorkspaceTool
          label="Updates"
          subtitle={`${projectStats.updates} total`}
          icon="document-text-outline"
          onPress={onOpenUpdates}
        />
        <WorkspaceTool
          label="Documents"
          subtitle={`${projectDocumentCount} linked`}
          icon="documents-outline"
          onPress={onOpenDocuments}
        />
        <WorkspaceTool
          label="Notes"
          subtitle={`${notesCount} with notes`}
          icon="create-outline"
          onPress={onOpenUpdates}
        />
        <WorkspaceTool
          label="Issues & Actions"
          subtitle={`${issuesCount} open`}
          icon="alert-circle-outline"
          onPress={onOpenUpdates}
        />
        <WorkspaceTool
          label="Recipients"
          subtitle={`${contactBook.contacts.length} saved`}
          icon="people-outline"
          onPress={onOpenUpdates}
        />
      </View>

      <Text style={styles.sectionLabel}>Recent Project Activity</Text>
      {projectActivity.length === 0 ? (
        <EmptyState
          title="Recent project activity will show up here."
          text="Photos, notes, documents, and DAVE status will appear here."
        />
      ) : (
        projectActivity.map(item => (
          <Phase2ActivityRow
            key={item.update.id}
            item={item}
            onPress={onOpenUpdates}
            onRetry={
              item.update.status === 'queued' || item.update.status === 'failed'
                ? () => onRetryQueuedUpdate(item.update)
                : undefined
            }
          />
        ))
      )}

      <Text style={styles.sectionLabel}>Danger Zone</Text>
      <HoldToDeleteButton
        label="Hold to Delete Project"
        holdingLabel="Keep holding…"
        deletingLabel="Deleting…"
        isDeleting={isDeletingProject}
        onConfirm={() => onDeleteProject(projectName)}
      />
      <Text style={styles.locationDetailText}>
        Press and hold for 3 seconds to permanently delete {projectName} and its
        cloud data. Release early to cancel.
      </Text>
    </ScrollView>
  );
}

function WorkspaceTool({
  label,
  subtitle,
  icon,
  onPress,
}: {
  label: string;
  subtitle: string;
  icon: IconName;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity style={styles.phase2ToolCard} onPress={onPress}>
      <View style={styles.rowIconBubble}>
        <Ionicons name={icon} size={20} color={colors.primary} />
      </View>
      <Text style={styles.phase2ToolLabel}>{label}</Text>
      <Text style={styles.rowSub}>{subtitle}</Text>
    </TouchableOpacity>
  );
}

function ProjectDocumentsScreen({
  contentStyle,
  projectName,
  documents,
  projectAreas,
  updates,
  onBack,
  onUpload,
  onTakePhoto,
  onOpen,
  onUpdate,
  onRetry,
  onDelete,
}: {
  contentStyle: StyleProp<ViewStyle>;
  projectName: string;
  documents: ProjectDocument[];
  projectAreas: ProjectArea[];
  updates: ProjectUpdate[];
  onBack: () => void;
  onUpload: () => void;
  onTakePhoto: () => void;
  onOpen: (document: ProjectDocument) => void;
  onUpdate: (documentId: string, next: Partial<ProjectDocument>) => void;
  onRetry: (documentId: string) => void;
  onDelete: (documentId: string) => void;
}) {
  const [categoryFilter, setCategoryFilter] =
    useState<ProjectDocumentCategory | null>(null);
  const visibleDocuments = categoryFilter
    ? documents.filter(document => document.category === categoryFilter)
    : documents;

  const renderDocument = ({ item }: { item: ProjectDocument }) => (
    <ProjectDocumentCard
      document={item}
      projectAreas={projectAreas}
      updates={updates}
      onOpen={() => onOpen(item)}
      onUpdate={next => onUpdate(item.id, next)}
      onRetry={() => onRetry(item.id)}
      onDelete={() => onDelete(item.id)}
    />
  );

  return (
    <FlatList
      style={styles.appFrame}
      contentContainerStyle={contentStyle}
      keyboardShouldPersistTaps="handled"
      data={visibleDocuments}
      keyExtractor={document => document.id}
      renderItem={renderDocument}
      ListHeaderComponent={
        <>
          <TouchableOpacity style={styles.phase2BackButton} onPress={onBack}>
            <Ionicons name="chevron-back" size={21} color={colors.primary} />
            <Text style={styles.dashboardManageText}>Workspace</Text>
          </TouchableOpacity>

          <ScreenTitle
            title="Project Documents"
            subtitle={projectName}
          />

          <PrimaryButton
            label="Upload Document"
            icon="document-attach-outline"
            onPress={onUpload}
          />

          <SecondaryButton
            label="Take Photo of Document"
            icon="camera-outline"
            onPress={onTakePhoto}
          />

          <View style={styles.panel}>
            <Text style={styles.panelTitle}>Document Status</Text>
            <Text style={styles.bodyText}>
              Local only, Document upload pending, Document upload failed · Retry, and Uploaded documents remain visible here. Failed uploads can be retried without duplicating the document record.
            </Text>
          </View>

          <Text style={styles.sectionLabel}>Category</Text>
          <View style={styles.areaChipWrap}>
            <TouchableOpacity
              style={[
                styles.areaChip,
                !categoryFilter && styles.areaChipSelected,
              ]}
              onPress={() => setCategoryFilter(null)}
            >
              <Text
                style={[
                  styles.areaChipText,
                  !categoryFilter && styles.areaChipTextSelected,
                ]}
              >
                All
              </Text>
            </TouchableOpacity>
            {PROJECT_DOCUMENT_CATEGORIES.map(category => {
              const selected = categoryFilter === category;

              return (
                <TouchableOpacity
                  key={category}
                  style={[
                    styles.areaChip,
                    selected && styles.areaChipSelected,
                  ]}
                  onPress={() => setCategoryFilter(category)}
                >
                  <Text
                    style={[
                      styles.areaChipText,
                      selected && styles.areaChipTextSelected,
                    ]}
                  >
                    {category}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </>
      }
      ListEmptyComponent={
        documents.length === 0 ? (
          <EmptyState
            title="No documents yet — upload your first document."
            text="Documents can be linked to the project, an area, or a saved update without blocking photo capture, DAVE review, or sending."
          />
        ) : (
          <EmptyState
            title="No documents in this category."
            text="Choose All or change a document category."
          />
        )
      }
    />
  );
}

function ProjectDocumentCard({
  document,
  projectAreas,
  updates,
  onOpen,
  onUpdate,
  onRetry,
  onDelete,
}: {
  document: ProjectDocument;
  projectAreas: ProjectArea[];
  updates: ProjectUpdate[];
  onOpen: () => void;
  onUpdate: (next: Partial<ProjectDocument>) => void;
  onRetry: () => void;
  onDelete: () => void;
}) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const selectedUpdate = updates.find(update => update.id === document.updateId);
  const selectedArea = projectAreas.find(area => area.id === document.areaId);

  return (
    <View style={styles.photoCard}>
      <View style={styles.photoHeader}>
        <View style={styles.rowIconBubble}>
          <Ionicons
            name={document.mimeType?.includes('image') ? 'image-outline' : 'document-text-outline'}
            size={20}
            color={colors.primary}
          />
        </View>
        <View style={styles.rowMain}>
          <Text style={styles.photoTitle}>{document.name}</Text>
          <Text style={styles.rowSub}>
            {document.category} · {projectDocumentStatusDetail(document)}
          </Text>
          {selectedArea ? (
            <Text style={styles.locationDetailText}>Area: {selectedArea.name}</Text>
          ) : null}
          {selectedUpdate ? (
            <Text style={styles.locationDetailText}>
              Update: {formatDisplayDate(selectedUpdate.date)}
            </Text>
          ) : null}
          {document.note ? (
            <Text style={styles.locationDetailText}>{document.note}</Text>
          ) : null}
        </View>
      </View>

      <View style={styles.photoControlRow}>
        <TouchableOpacity style={styles.photoControlButton} onPress={onOpen}>
          <Ionicons name="eye-outline" size={17} color={colors.primary} />
          <Text style={styles.photoControlText}>View Document</Text>
        </TouchableOpacity>
        {(document.status === 'failed' || document.status === 'local') ? (
          <TouchableOpacity style={styles.photoControlButton} onPress={onRetry}>
            <Ionicons name="refresh-outline" size={17} color={colors.primary} />
            <Text style={styles.photoControlText}>Retry Upload</Text>
          </TouchableOpacity>
        ) : null}
        <TouchableOpacity
          style={styles.photoControlButton}
          onPress={() => setDetailsOpen(prev => !prev)}
        >
          <Ionicons name="options-outline" size={17} color={colors.primary} />
          <Text style={styles.photoControlText}>Edit</Text>
        </TouchableOpacity>
      </View>

      {detailsOpen ? (
        <View style={styles.phase4DetailBlock}>
          <Text style={styles.label}>Rename</Text>
          <TextInput
            style={styles.input}
            value={document.name}
            onChangeText={name => onUpdate({ name })}
            placeholder="Document name"
            placeholderTextColor={colors.muted}
          />

          <Text style={styles.label}>Category</Text>
          <View style={styles.areaChipWrap}>
            {PROJECT_DOCUMENT_CATEGORIES.map(category => {
              const selected = document.category === category;

              return (
                <TouchableOpacity
                  key={category}
                  style={[
                    styles.areaChip,
                    selected && styles.areaChipSelected,
                  ]}
                  onPress={() => onUpdate({ category })}
                >
                  <Text
                    style={[
                      styles.areaChipText,
                      selected && styles.areaChipTextSelected,
                    ]}
                  >
                    {category}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <Text style={styles.label}>Attach to Area</Text>
          <View style={styles.areaChipWrap}>
            <TouchableOpacity
              style={[
                styles.areaChip,
                !document.areaId && styles.areaChipSelected,
              ]}
              onPress={() => onUpdate({ areaId: null })}
            >
              <Text
                style={[
                  styles.areaChipText,
                  !document.areaId && styles.areaChipTextSelected,
                ]}
              >
                No Area
              </Text>
            </TouchableOpacity>
            {projectAreas.map(area => {
              const selected = document.areaId === area.id;

              return (
                <TouchableOpacity
                  key={area.id}
                  style={[
                    styles.areaChip,
                    selected && styles.areaChipSelected,
                  ]}
                  onPress={() => onUpdate({ areaId: area.id })}
                >
                  <Text
                    style={[
                      styles.areaChipText,
                      selected && styles.areaChipTextSelected,
                    ]}
                  >
                    {area.name}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <Text style={styles.label}>Attach to Update</Text>
          <View style={styles.areaChipWrap}>
            <TouchableOpacity
              style={[
                styles.areaChip,
                !document.updateId && styles.areaChipSelected,
              ]}
              onPress={() => onUpdate({ updateId: null })}
            >
              <Text
                style={[
                  styles.areaChipText,
                  !document.updateId && styles.areaChipTextSelected,
                ]}
              >
                No Update
              </Text>
            </TouchableOpacity>
            {updates.slice(0, 8).map(update => {
              const selected = document.updateId === update.id;

              return (
                <TouchableOpacity
                  key={update.id}
                  style={[
                    styles.areaChip,
                    selected && styles.areaChipSelected,
                  ]}
                  onPress={() => onUpdate({ updateId: update.id })}
                >
                  <Text
                    style={[
                      styles.areaChipText,
                      selected && styles.areaChipTextSelected,
                    ]}
                  >
                    {formatDisplayDate(update.date)}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <Text style={styles.label}>Note</Text>
          <TextInput
            style={[styles.input, styles.notesInput]}
            value={document.note || ''}
            onChangeText={note => onUpdate({ note })}
            placeholder="Add note"
            placeholderTextColor={colors.muted}
            multiline
          />

          <TouchableOpacity style={styles.photoControlButton} onPress={onDelete}>
            <Ionicons name="trash-outline" size={17} color={colors.danger} />
            <Text style={[styles.photoControlText, { color: colors.danger }]}>
              Delete
            </Text>
          </TouchableOpacity>
        </View>
      ) : null}
    </View>
  );
}

function ReferenceDocumentsScreen({
  contentStyle,
  documents,
  onBack,
  onImport,
  onUpdate,
  onToggleCurrent,
  onOpen,
  onDelete,
}: {
  contentStyle: StyleProp<ViewStyle>;
  documents: ReferenceDocument[];
  onBack: () => void;
  onImport: () => void;
  onUpdate: (documentId: string, next: Partial<ReferenceDocument>) => void;
  onToggleCurrent: (documentId: string) => void;
  onOpen: (document: ReferenceDocument) => void;
  onDelete: (documentId: string) => void;
}) {
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);

  const filteredDocuments = categoryFilter
    ? documents.filter(document => document.category === categoryFilter)
    : documents;

  const renderDocument = ({ item: document }: { item: ReferenceDocument }) => (
    <ReferenceDocumentCard
      document={document}
      onUpdate={next => onUpdate(document.id, next)}
      onToggleCurrent={() => onToggleCurrent(document.id)}
      onOpen={() => onOpen(document)}
      onDelete={() => onDelete(document.id)}
    />
  );

  return (
    <FlatList
      style={styles.appFrame}
      contentContainerStyle={contentStyle}
      keyboardShouldPersistTaps="handled"
      data={filteredDocuments}
      keyExtractor={document => document.id}
      renderItem={renderDocument}
      ListHeaderComponent={
        <>
          <ScreenTitle
            title="Reference Documents"
            subtitle="Import drawings, PDFs, site plans, and reference files for local use on this phone."
          />

          <SecondaryButton
            label="Back to Projects"
            icon="arrow-back-outline"
            onPress={onBack}
          />

          <PrimaryButton
            label="Import PDF or Image"
            icon="document-attach-outline"
            onPress={onImport}
          />

          <View style={styles.panel}>
            <Text style={styles.panelTitle}>Local Storage</Text>
            <Text style={styles.bodyText}>
              Reference documents are copied into this app on this phone. Backup exports include document metadata only; large PDF and image files remain stored locally on the device.
            </Text>
          </View>

          <Text style={styles.sectionLabel}>Filter by Category</Text>

          <View style={styles.areaChipWrap}>
            <TouchableOpacity
              style={[
                styles.areaChip,
                !categoryFilter && styles.areaChipSelected,
              ]}
              onPress={() => setCategoryFilter(null)}
            >
              <Text
                style={[
                  styles.areaChipText,
                  !categoryFilter && styles.areaChipTextSelected,
                ]}
              >
                All Documents
              </Text>
            </TouchableOpacity>

            {REFERENCE_DOCUMENT_CATEGORIES.map(category => {
              const selected = categoryFilter === category;

              return (
                <TouchableOpacity
                  key={category}
                  style={[
                    styles.areaChip,
                    selected && styles.areaChipSelected,
                  ]}
                  onPress={() => setCategoryFilter(category)}
                >
                  <Text
                    style={[
                      styles.areaChipText,
                      selected && styles.areaChipTextSelected,
                    ]}
                  >
                    {category}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </>
      }
      ListEmptyComponent={
        documents.length === 0 ? (
          <EmptyState
            title="No reference documents"
            text="Import PDFs, drawings, site plans, or images to keep local project references available in the app."
          />
        ) : (
          <EmptyState
            title="No documents in this category"
            text="Choose All Documents or import a file for this category."
          />
        )
      }
    />
  );
}

function ReferenceDocumentCard({
  document,
  onUpdate,
  onToggleCurrent,
  onOpen,
  onDelete,
}: {
  document: ReferenceDocument;
  onUpdate: (next: Partial<ReferenceDocument>) => void;
  onToggleCurrent: () => void;
  onOpen: () => void;
  onDelete: () => void;
}) {
  return (
    <View style={styles.photoCard}>
      <View style={styles.photoHeader}>
        <View style={styles.rowIconBubble}>
          <Ionicons
            name={document.mimeType?.includes('image') ? 'image-outline' : 'document-text-outline'}
            size={20}
            color={colors.primary}
          />
        </View>

        <View style={styles.rowMain}>
          <Text style={styles.photoTitle}>{document.name}</Text>
          <Text style={styles.rowSub}>
            {document.category} | Imported {formatSavedTime(document.importedAt)}
          </Text>
          {document.isCurrent ? (
            <Text style={styles.locationDetailText}>Current reference</Text>
          ) : null}
        </View>
      </View>

      <Text style={styles.label}>Document Name</Text>
      <TextInput
        style={styles.input}
        value={document.name}
        onChangeText={name => onUpdate({ name })}
        placeholder="Document name"
        placeholderTextColor={colors.muted}
      />

      <Text style={styles.label}>Category</Text>
      <View style={styles.areaChipWrap}>
        {REFERENCE_DOCUMENT_CATEGORIES.map(category => {
          const selected = document.category === category;

          return (
            <TouchableOpacity
              key={category}
              style={[
                styles.areaChip,
                selected && styles.areaChipSelected,
              ]}
              onPress={() => onUpdate({ category })}
            >
              <Text
                style={[
                  styles.areaChipText,
                  selected && styles.areaChipTextSelected,
                ]}
              >
                {category}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <Text style={styles.label}>Notes</Text>
      <TextInput
        style={[styles.input, styles.notesInput]}
        value={document.notes}
        onChangeText={notes => onUpdate({ notes })}
        placeholder="Revision, drawing purpose, area covered, or important notes."
        placeholderTextColor={colors.muted}
        multiline
      />

      <Text style={styles.locationDetailText}>
        Original file: {document.originalFileName}
      </Text>

      <View style={styles.sendRow}>
        <PrimaryButton
          label="Open"
          icon="open-outline"
          onPress={onOpen}
          compact
        />

        <SecondaryButton
          label={document.isCurrent ? 'Unmark Current' : 'Mark Current'}
          icon={document.isCurrent ? 'star' : 'star-outline'}
          onPress={onToggleCurrent}
          compact
        />
      </View>

      <SecondaryButton
        label="Delete Document"
        icon="trash-outline"
        onPress={onDelete}
      />
    </View>
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
        label="Back to Projects"
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
                  {hasSavedAreaLocation(area)
                    ? `GPS saved | Radius ${formatFeet(area.radiusFeet)}`
                    : `GPS missing | Radius ${formatFeet(area.radiusFeet)}`}
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
                    {gpsSaved ? 'GPS saved' : 'GPS missing'}
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
      onRequestClose={onClose}
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
              onPress={onClose}
              accessibilityLabel="Close location details"
            >
              <Ionicons name="close" size={22} color={colors.text} />
            </TouchableOpacity>
          </View>

          <Text style={styles.label}>Location name</Text>
          <TextInput
            style={styles.input}
            value={area.name}
            onChangeText={name => onUpdate({ name })}
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
              onPress={onUseCurrentLocation}
              compact
            />
            <SecondaryButton
              label="Delete"
              icon="trash-outline"
              onPress={onDelete}
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
          <Text style={styles.label}>Email to use</Text>

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
          <Text style={styles.label}>Phone to use for text</Text>

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
  projectAreas,
  contactBook,
  onOpen,
  onDelete,
  onArchive,
  onNewUpdate,
  onRetryPhotoAnalysis,
  onRetryQueuedUpdate,
  initialTab,
  initialWithinDays,
}: {
  contentStyle: StyleProp<ViewStyle>;
  updates: ProjectUpdate[];
  projectAreas: ProjectArea[];
  contactBook: ContactBook;
  onOpen: (update: ProjectUpdate) => void;
  onDelete: (updateId: string) => void;
  onArchive: (updateId: string) => void;
  onNewUpdate: () => void;
  onRetryPhotoAnalysis: (update: ProjectUpdate, photo: UpdatePhoto) => void;
  onRetryQueuedUpdate: (update: ProjectUpdate) => void;
  initialTab?: 'Needs Review' | 'Drafts' | 'Sent' | 'All';
  initialWithinDays?: number;
}) {
  const [activeTab, setActiveTab] = useState<'Needs Attention' | 'Drafts' | 'History'>(
    initialTab === 'Drafts'
      ? 'Drafts'
      : initialTab === 'Sent' || initialTab === 'All'
        ? 'History'
        : 'Needs Attention',
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
    project: null,
    areaId: null,
    pieStatus: null,
    lifecycleStatus: null,
    withinDays: initialWithinDays ?? null,
  });

  const contactNamesById = useMemo(() => {
    const map = new Map<string, string>();
    contactBook.contacts.forEach(contact => {
      map.set(contact.id, normalizeContact(contact).name || '');
    });
    return map;
  }, [contactBook]);

  const filteredUpdates = [...updates]
    .filter(update => activeTab === 'History' || !update.isArchived)
    .filter(update => {
      const lifecycle = lifecycleStatusForUpdate(update);

      if (activeTab === 'Needs Attention') return updateNeedsReview(update);
      if (activeTab === 'Drafts') return lifecycle === 'draft';
      if (activeTab === 'History') return lifecycle === 'sent';

      return true;
    })
    .filter(update => {
      if (filters.project && update.projectName !== filters.project) return false;
      if (
        filters.areaId &&
        update.selectedAreaId !== filters.areaId &&
        !update.photos.some(photo => photo.selectedAreaId === filters.areaId)
      ) {
        return false;
      }
      if (filters.lifecycleStatus && lifecycleStatusForUpdate(update) !== filters.lifecycleStatus) {
        return false;
      }
      if (filters.pieStatus && updatePIEAnalysisStatus(update) !== filters.pieStatus) {
        return false;
      }
      if (filters.withinDays !== null) {
        const daysSince = daysUntilDate(update.date);

        if (daysSince === null || daysSince > 0 || daysSince < -filters.withinDays) {
          return false;
        }
      }
      return true;
    })
    .filter(update => {
      const search = searchText.trim().toLowerCase();

      if (!search) return true;

      const recipientNames = update.recipients.contactIds
        .map(id => contactNamesById.get(id) || '')
        .join(' ');
      const searchable = `${update.projectName} ${update.selectedAreaName || ''} ${recipientNames}`.toLowerCase();

      return searchable.includes(search);
    })
    .sort((left, right) => (updateDateValue(right.date)?.getTime() || 0) - (updateDateValue(left.date)?.getTime() || 0));

  const emptyTitle =
    activeTab === 'Needs Attention'
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

  const renderUpdate = ({ item: update, index }: { item: ProjectUpdate; index: number }) => {
    const group = updateTimelineGroup(update.date);
    const previousGroup = index > 0 ? updateTimelineGroup(filteredUpdates[index - 1].date) : null;

    return (
      <>
        {group !== previousGroup ? <Text style={styles.updateGroupHeader}>{group}</Text> : null}
        <UpdateHistoryCard
          update={update}
          lifecycle={lifecycleStatusForUpdate(update)}
          pieStatus={updatePIEAnalysisStatus(update)}
          onOpen={() => onOpen(update)}
          onRetry={updateCanInlineRetry(update) ? () => retryUpdate(update) : undefined}
          onDelete={() => onDelete(update.id)}
          onArchive={() => onArchive(update.id)}
        />
      </>
    );
  };

  return (
    <FlatList
      style={styles.appFrame}
      contentContainerStyle={contentStyle}
      keyboardShouldPersistTaps="handled"
      data={filteredUpdates}
      keyExtractor={update => update.id}
      renderItem={renderUpdate}
      ListHeaderComponent={
        <>
          <ScreenTitle
            title="Updates"
            subtitle="What needs your attention today?"
          />

          <View style={styles.updateSearchPanel}>
            <View style={styles.updateTopControlRow}>
              <View style={styles.updateSearchBox}>
                <Ionicons name="search-outline" size={19} color={colors.muted} />
                <TextInput
                  style={styles.projectSearchInput}
                  value={searchText}
                  onChangeText={setSearchText}
                  placeholder="Search updates"
                  placeholderTextColor={colors.muted}
                />
              </View>
              <TouchableOpacity
                style={styles.updateFilterButton}
                onPress={() => setFilterOpen(true)}
                accessibilityRole="button"
                accessibilityLabel="Filter updates"
              >
                <Ionicons name="filter-outline" size={20} color={colors.primary} />
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.updateSegmentRow}>
            {(['Needs Attention', 'Drafts', 'History'] as const).map(tab => {
              const selected = activeTab === tab;
              return (
                <TouchableOpacity
                  key={tab}
                  style={[
                    styles.updateSegment,
                    selected && styles.updateSegmentSelected,
                  ]}
                  onPress={() => setActiveTab(tab)}
                  accessibilityRole="tab"
                  accessibilityState={{ selected }}
                  accessibilityLabel={`${tab} updates`}
                >
                  <Text
                    style={[
                      styles.updateSegmentText,
                      selected && styles.updateSegmentTextSelected,
                    ]}
                  >
                    {tab}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <UpdateFilterSheet
            visible={filterOpen}
            updates={updates}
            projectAreas={projectAreas}
            filters={filters}
            onChange={setFilters}
            onClose={() => setFilterOpen(false)}
          />
        </>
      }
      ListEmptyComponent={
        <View style={styles.updateEmptyState}>
          <Text style={styles.updateEmptyTitle}>{emptyTitle}</Text>
          <Text style={styles.updateEmptyText}>
            {activeTab === 'Needs Attention'
              ? 'No updates require your attention today.'
              : activeTab === 'Drafts'
                ? 'Start a new update when you are ready to capture field work.'
                : 'Completed and sent updates will appear here.'}
          </Text>
          <Text style={styles.updateEmptyPrompt}>Ready to capture today&apos;s work?</Text>
          <PrimaryButton label="New Update" icon="add-circle-outline" onPress={onNewUpdate} />
        </View>
      }
      ListFooterComponent={
        filteredUpdates.length > 0 ? (
          <View style={styles.updateFooterAction}>
            <PrimaryButton label="New Update" icon="add-circle-outline" onPress={onNewUpdate} />
          </View>
        ) : null
      }
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

      <Text style={styles.sectionLabel}>Lifecycle status</Text>
      {(['draft', 'ready_to_send', 'queued', 'sent', 'failed'] as FieldUpdateStatus[]).map(status => (
        <FilterOption
          key={status}
          label={status}
          selected={filters.lifecycleStatus === status}
          onPress={() => onChange({ ...filters, lifecycleStatus: status })}
        />
      ))}

      <Text style={styles.sectionLabel}>DAVE status</Text>
      {pieStatuses.map(status => (
        <FilterOption
          key={status}
          label={status}
          selected={filters.pieStatus === status}
          onPress={() => onChange({ ...filters, pieStatus: status })}
        />
      ))}

      <Text style={styles.sectionLabel}>Photo status</Text>
      <Text style={styles.bodyText}>Photo status, document status, date, and sent/draft status use the same saved update records and lifecycle fields.</Text>

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
  lifecycle,
  pieStatus,
  onOpen,
  onRetry,
  onDelete,
  onArchive,
}: {
  update: ProjectUpdate;
  lifecycle: FieldUpdateStatus;
  pieStatus: string | null;
  onOpen: () => void;
  onRetry?: () => void;
  onDelete: () => void;
  onArchive: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const documents = update.documents || [];
  const thumbnail = update.photos[0]?.uri;
  const statusLine =
    lifecycle === 'queued'
      ? queuedStatusCopyForUpdate(update)
      : lifecycle === 'ready_to_send'
        ? 'Ready to send'
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
  const statusLabel =
    lifecycle === 'ready_to_send'
      ? 'Ready'
      : lifecycle === 'failed'
        ? 'Failed'
        : lifecycle === 'queued'
          ? 'Queued'
          : lifecycle === 'sent'
            ? 'Sent'
            : 'Draft';

  return (
    <TouchableOpacity
      style={styles.updateCard}
      onPress={onOpen}
      accessibilityRole="button"
      accessibilityLabel={`${update.projectName}. ${summary}. ${updateType}. ${statusLabel}. ${relativeUpdateTimestamp(update.date)}`}
    >
      <View style={styles.updateCardMedia}>
        {thumbnail ? (
          <Image source={{ uri: thumbnail }} style={styles.updateCardThumb} />
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
  const sent = lifecycle === 'sent';
  const deleteLabel = lifecycle === 'sent'
    ? 'Delete sent update'
    : lifecycle === 'failed'
      ? 'Delete failed update'
      : 'Remove from device';

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
          {sent ? (
            <MoreOptionRow
              label="Archive sent update"
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

function DashboardMetric({
  label,
  value,
  icon,
  danger = false,
}: {
  label: string;
  value: number;
  icon: IconName;
  danger?: boolean;
}) {
  return (
    <View
      style={[
        styles.dashboardMetricCard,
        danger && styles.dashboardMetricDanger,
      ]}
    >
      <View style={styles.dashboardMetricIconRow}>
        <Ionicons
          name={icon}
          size={19}
          color={danger ? colors.danger : colors.primary}
        />

        <Text
          style={[
            styles.dashboardMetricValue,
            danger && styles.dashboardMetricValueDanger,
          ]}
        >
          {value.toLocaleString('en-US')}
        </Text>
      </View>

      <Text style={styles.dashboardMetricLabel}>
        {label}
      </Text>
    </View>
  );
}

function QuickActionButton({
  label,
  icon,
  onPress,
  primary = false,
}: {
  label: string;
  icon: IconName;
  onPress: () => void;
  primary?: boolean;
}) {
  return (
    <TouchableOpacity
      style={[
        styles.quickActionButton,
        primary && styles.quickActionButtonPrimary,
      ]}
      onPress={onPress}
    >
      <Ionicons
        name={icon}
        size={22}
        color={primary ? '#FFFFFF' : colors.primary}
      />

      <Text
        style={[
          styles.quickActionText,
          primary && styles.quickActionTextPrimary,
        ]}
        numberOfLines={2}
        adjustsFontSizeToFit
        minimumFontScale={0.8}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
}

function ProjectAttentionCard({
  project,
  stats,
  onPress,
}: {
  project: string;
  stats: ProjectStats;
  onPress: () => void;
}) {
  const urgent = stats.overdueActions > 0;

  return (
    <TouchableOpacity
      style={[
        styles.attentionCard,
        urgent && styles.attentionCardUrgent,
      ]}
      onPress={onPress}
    >
      <View style={styles.rowIconBubble}>
        <Ionicons
          name={urgent ? 'warning-outline' : 'alert-circle-outline'}
          size={20}
          color={urgent ? colors.danger : colors.primary}
        />
      </View>

      <View style={styles.rowMain}>
        <Text style={styles.projectName}>
          {project}
        </Text>

        <Text style={styles.rowSub}>
          {stats.openActions} open | {stats.overdueActions} overdue | {stats.dueThisWeek} due this week
        </Text>
      </View>

      <Ionicons
        name="chevron-forward-outline"
        size={20}
        color={colors.muted}
      />
    </TouchableOpacity>
  );
}

function ActivityRow({
  update,
}: {
  update: ProjectUpdate;
}) {
  return (
    <View style={styles.activityRow}>
      <View style={styles.rowIconBubble}>
        <Ionicons
          name="time-outline"
          size={20}
          color={colors.primary}
        />
      </View>

      <View style={styles.rowMain}>
        <Text style={styles.projectName}>
          {update.projectName}
        </Text>

        <Text style={styles.rowSub}>
          {formatDisplayDate(update.date)} | {update.photos.length} photo
          {update.photos.length === 1 ? '' : 's'}
          {update.selectedAreaName ? ` | ${update.selectedAreaName}` : ''}
        </Text>
      </View>
    </View>
  );
}

function ProjectFinderRow({
  project,
  stats,
  archived,
  favorite,
  onPress,
  onFavorite,
  onClose,
}: {
  project: string;
  stats: ProjectStats;
  archived: boolean;
  favorite: boolean;
  onPress: () => void;
  onFavorite: () => void;
  onClose?: () => void;
}) {
  return (
    <View style={styles.projectFinderRow}>
      <TouchableOpacity
        style={styles.favoriteButton}
        onPress={onFavorite}
      >
        <Ionicons
          name={favorite ? 'star' : 'star-outline'}
          size={22}
          color={favorite ? colors.warning : colors.muted}
        />
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.rowMain}
        onPress={onPress}
      >
        <Text style={styles.projectName}>
          {project}
        </Text>

        <Text style={styles.rowSub}>
          {archived ? 'Archived' : 'Active'} | Last update:{' '}
          {stats.lastUpdate ? formatDisplayDate(stats.lastUpdate) : 'None yet'}
        </Text>

        <View style={styles.compactStatsRow}>
          <Text style={styles.compactStatText}>
            Open {stats.openActions}
          </Text>

          <Text
            style={[
              styles.compactStatText,
              stats.overdueActions > 0 && styles.compactStatDanger,
            ]}
          >
            Overdue {stats.overdueActions}
          </Text>

          <Text style={styles.compactStatText}>
            Due {stats.dueThisWeek}
          </Text>

          <Text style={styles.compactStatText}>
            Photos {stats.photos}
          </Text>
        </View>
      </TouchableOpacity>

      <View style={styles.projectFinderActions}>
        <TouchableOpacity
          style={styles.smallAction}
          onPress={onPress}
        >
          <Text style={styles.smallActionText}>
            {archived ? 'Reopen' : 'Update'}
          </Text>
        </TouchableOpacity>

        {onClose ? (
          <TouchableOpacity
            style={[styles.smallAction, styles.smallActionDanger]}
            onPress={onClose}
          >
            <Text style={styles.smallActionDangerText}>
              Close
            </Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  );
}



function UpcomingScreen({
  contentStyle,
  scheduleItems,
  savedUpdates,
  onBack,
  onSchedule,
  onNewUpdate,
  autoOpenDueToday,
}: {
  contentStyle: StyleProp<ViewStyle>;
  scheduleItems: ScheduleItem[];
  savedUpdates: ProjectUpdate[];
  onBack: () => void;
  onSchedule: () => void;
  onNewUpdate: () => void;
  autoOpenDueToday?: boolean;
}) {
  const insets = useSafeAreaInsets();
  const [selectedSection, setSelectedSection] = useState<{
    title: string;
    items: Array<{
      id: string;
      source: string;
      title: string;
      projectName: string;
      locationName: string;
      owner: string;
      contractor: string;
      dueDate: string;
      status: string;
      percentComplete: number;
      priority: SchedulePriority;
      notes: string;
      days: number | null;
    }>;
  } | null>(null);

  const actionItems = actionItemsFromUpdates(savedUpdates);
  type UpcomingItem = {
    id: string;
    source: string;
    title: string;
    projectName: string;
    locationName: string;
    owner: string;
    contractor: string;
    dueDate: string;
    status: string;
    percentComplete: number;
    priority: SchedulePriority;
    notes: string;
  };

  const combinedItems: UpcomingItem[] = [
    ...scheduleItems
      .filter(item => item.status !== 'Complete')
      .map(item => ({
        id: item.id,
        source: 'Schedule',
        title: item.taskName,
        projectName: item.projectName,
        locationName: item.locationName,
        owner: item.owner,
        contractor: item.contractor,
        dueDate: item.finishDate,
        status: item.status,
        percentComplete: item.percentComplete,
        priority: item.priority,
        notes: item.notes,
      })),
    ...actionItems.map(item => ({
      id: item.id,
      source: 'Action Item',
      title: item.taskName,
      projectName: item.projectName,
      locationName: item.locationName,
      owner: item.owner,
      contractor: '',
      dueDate: item.finishDate,
      status: item.status,
      percentComplete: 0,
      priority: 'High' as SchedulePriority,
      notes: '',
    })),
  ];

  const withDueDates = combinedItems
    .map(item => ({ ...item, days: daysUntilDate(item.dueDate) }))
    .filter(item => item.days !== null)
    .sort((a, b) => (a.days ?? 99999) - (b.days ?? 99999));

  const today = withDueDates.filter(item => item.days === 0);
  const tomorrow = withDueDates.filter(item => item.days === 1);
  const nextSevenDays = withDueDates.filter(
    item => item.days !== null && item.days >= 2 && item.days <= 7,
  );
  const overdue = withDueDates.filter(item => item.days !== null && item.days < 0);
  const later = withDueDates.filter(item => item.days !== null && item.days > 7);

  const renderUpcomingItem = (item: UpcomingItem & { days: number | null }) => (
    <View key={`${item.source}-${item.id}`} style={styles.savedRow}>
      <View style={styles.rowIconBubble}>
        <Ionicons
          name={item.days !== null && item.days < 0 ? 'alert-circle-outline' : item.days === 0 ? 'today-outline' : 'calendar-outline'}
          size={20}
          color={item.days !== null && item.days < 0 ? colors.danger : item.days === 0 ? colors.warning : colors.primary}
        />
      </View>

      <View style={styles.rowMain}>
        <Text style={styles.projectName}>{item.title || 'Untitled item'}</Text>
        <Text style={styles.rowSub}>
          {item.projectName || 'No project'}{item.locationName ? ` • ${item.locationName}` : ''}
        </Text>
        <Text style={styles.rowSub}>
          {dueStatusText(item.dueDate)} • {item.source}{item.contractor ? ` • ${item.contractor}` : item.owner ? ` • ${item.owner}` : ''}
        </Text>
        <View style={styles.scheduleMetaRow}>
          <View style={[styles.statusPill, { backgroundColor: `${colors.primary}1A` }]}>
            <Text style={styles.statusPillText}>{item.status} • {item.percentComplete}%</Text>
          </View>
        </View>
        {item.notes ? (
          <Text style={styles.rowSub} numberOfLines={2}>
            {item.notes}
          </Text>
        ) : null}
      </View>
    </View>
  );

  const openSection = (title: string, items: typeof withDueDates) => {
    setSelectedSection({ title, items });
  };

  useEffect(() => {
    if (autoOpenDueToday && today.length > 0) {
      openSection('Due Today', today);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoOpenDueToday]);

  const renderSection = (title: string, items: typeof withDueDates, emptyText: string) => {
    const previewItems = items.slice(0, 2);
    const hasItems = items.length > 0;

    return (
      <TouchableOpacity
        style={styles.panel}
        activeOpacity={hasItems ? 0.82 : 1}
        onPress={() => hasItems && openSection(title, items)}
      >
        <View style={styles.sectionHeaderRow}>
          <View style={styles.rowMain}>
            <Text style={styles.panelTitle}>{title}</Text>
            {hasItems ? (
              <Text style={styles.rowSub}>
                Tap to view {items.length} {pluralWord(items.length, 'item')}
              </Text>
            ) : null}
          </View>

          <View style={[styles.countPill, title === 'Overdue' && items.length > 0 && styles.countPillDanger]}>
            <Text style={[styles.countPillText, title === 'Overdue' && items.length > 0 && styles.countPillTextDanger]}>
              {items.length}
            </Text>
          </View>
        </View>

        {hasItems ? (
          <>
            {previewItems.map(renderUpcomingItem)}
            {items.length > previewItems.length ? (
              <Text style={styles.inlineLinkText}>
                View all {items.length} {pluralWord(items.length, 'item')}
              </Text>
            ) : null}
          </>
        ) : (
          <Text style={styles.bodyText}>{emptyText}</Text>
        )}
      </TouchableOpacity>
    );
  };

  return (
    <>
      <ScrollView
        style={styles.appFrame}
        contentContainerStyle={contentStyle}
        keyboardShouldPersistTaps="handled"
      >
        <ScreenTitle
          title="Upcoming"
          subtitle="Tap a section to see the schedule items and action items due in that timeframe."
        />

        <SecondaryButton
          label="Back to Overview"
          icon="arrow-back-outline"
          onPress={onBack}
        />

        {withDueDates.length === 0 ? (
          <View style={styles.panel}>
            <Text style={styles.panelTitle}>No dated items yet</Text>
            <Text style={styles.bodyText}>
              Import a schedule PDF, add schedule items from the PDF, or add action item due dates to populate Upcoming.
            </Text>
          </View>
        ) : null}

        {renderSection('Due Today', today, 'No schedule items or action items are due today.')}
        {renderSection('Due Tomorrow', tomorrow, 'No items are due tomorrow.')}
        {renderSection('Next 7 Days', nextSevenDays, 'No additional items are due in the next seven days.')}
        {renderSection('Overdue', overdue, 'No overdue items.')}
        {renderSection('Later', later, 'No later dated items found yet.')}

        <View style={styles.dataActionRow}>
          <PrimaryButton
            label="Open Schedule"
            icon="calendar-outline"
            onPress={onSchedule}
            compact
          />
          <SecondaryButton
            label="Capture Update"
            icon="camera-outline"
            onPress={onNewUpdate}
            compact
          />
        </View>
      </ScrollView>

      <Modal
        visible={Boolean(selectedSection)}
        animationType="slide"
        transparent
        onRequestClose={() => setSelectedSection(null)}
      >
        <View style={styles.sheetModalBackdrop}>
          <View
            style={[
              styles.sheetModalSafeArea,
              { paddingTop: insets.top, paddingBottom: insets.bottom },
            ]}
          >
            <View style={styles.sheetModalHeader}>
              <View style={styles.sheetModalTitleWrap}>
                <Text style={styles.sheetModalTitle}>{selectedSection?.title}</Text>
                <Text style={styles.sheetModalCaption}>
                  {selectedSection?.items.length || 0} {pluralWord(selectedSection?.items.length || 0, 'item')}
                </Text>
              </View>
              <TouchableOpacity
                style={styles.sheetModalCloseButton}
                onPress={() => setSelectedSection(null)}
                accessibilityLabel="Close upcoming list"
              >
                <Ionicons name="close" size={26} color={colors.text} />
              </TouchableOpacity>
            </View>

            <ScrollView
              style={styles.appFrame}
              contentContainerStyle={[styles.content, { paddingTop: 8, paddingBottom: 24 }]}
            >
              {selectedSection?.items.map(renderUpcomingItem)}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </>
  );
}

function ScheduleScreen({
  contentStyle,
  scheduleItems,
  savedUpdates,
  projectAreas,
  projects,
  scheduleDocuments,
  onBack,
  onOpenDocument,
  onDeleteDocument,
  onSetActiveDocument,
  onAdd,
  onUpdate,
  onDelete,
  onImport,
  scheduleAiExtractorUrl,
  onScheduleAiExtractorUrlChange,
}: {
  contentStyle: StyleProp<ViewStyle>;
  scheduleItems: ScheduleItem[];
  savedUpdates: ProjectUpdate[];
  projectAreas: ProjectArea[];
  projects: string[];
  scheduleDocuments: ReferenceDocument[];
  onBack: () => void;
  onOpenDocument: (document: ReferenceDocument) => void;
  onDeleteDocument: (documentId: string) => void;
  onSetActiveDocument: (documentId: string) => void;
  onAdd: (item: Partial<ScheduleItem>) => void;
  onUpdate: (itemId: string, next: Partial<ScheduleItem>) => void;
  onDelete: (itemId: string) => void;
  onImport: () => void;
  scheduleAiExtractorUrl: string;
  onScheduleAiExtractorUrlChange: (value: string) => void;
}) {
  const [showAdd, setShowAdd] = useState(false);
  const [taskName, setTaskName] = useState('');
  const [projectName, setProjectName] = useState(projects[0] || '');
  const [locationName, setLocationName] = useState(projectAreas[0]?.name || '');
  const [startDate, setStartDate] = useState('');
  const [finishDate, setFinishDate] = useState('');
  const [milestone, setMilestone] = useState('');
  const [owner, setOwner] = useState('');
  const [contractor, setContractor] = useState('');
  const [percentComplete, setPercentComplete] = useState('0');
  const [priority, setPriority] = useState<SchedulePriority>('Medium');
  const [status, setStatus] = useState<ScheduleStatus>('Not Started');
  const [notes, setNotes] = useState('');

  const actionItems = actionItemsFromUpdates(savedUpdates);

  const sortedItems = [...scheduleItems].sort((a, b) => {
    const aDays = daysUntilDate(a.finishDate);
    const bDays = daysUntilDate(b.finishDate);

    if (aDays === null && bDays === null) return 0;
    if (aDays === null) return 1;
    if (bDays === null) return -1;

    return aDays - bDays;
  });

  const dueSoon = sortedItems.filter(item => {
    if (item.status === 'Complete') return false;

    const days = daysUntilDate(item.finishDate);

    return days !== null && days >= 0 && days <= 7;
  });

  const overdue = sortedItems.filter(item => {
    if (item.status === 'Complete') return false;

    const days = daysUntilDate(item.finishDate);

    return days !== null && days < 0;
  });

  function resetForm() {
    setTaskName('');
    setProjectName(projects[0] || '');
    setLocationName(projectAreas[0]?.name || '');
    setStartDate('');
    setFinishDate('');
    setMilestone('');
    setOwner('');
    setContractor('');
    setPercentComplete('0');
    setPriority('Medium');
    setStatus('Not Started');
    setNotes('');
  }

  function startScheduleItemFromPdf(document: ReferenceDocument) {
    setTaskName('');
    setProjectName(projects[0] || '');
    setLocationName(projectAreas[0]?.name || '');
    setStartDate('');
    setFinishDate('');
    setMilestone('From PDF Schedule');
    setOwner('');
    setContractor('');
    setPercentComplete('0');
    setPriority('Medium');
    setStatus('Not Started');
    setNotes(`Source PDF: ${document.originalFileName}. Open the PDF, review the Gantt chart, then enter the task name, dates, owner, and location from the schedule.`);
    setShowAdd(true);
  }

  function submitManualItem() {
    if (!taskName.trim()) {
      Alert.alert('Task needed', 'Enter the schedule task or milestone first.');
      return;
    }

    if (finishDate.trim() && !parseFlexibleDate(finishDate)) {
      Alert.alert('Invalid finish date', 'Use MM/DD/YYYY for the finish or due date.');
      return;
    }

    if (startDate.trim() && !parseFlexibleDate(startDate)) {
      Alert.alert('Invalid start date', 'Use MM/DD/YYYY for the start date.');
      return;
    }

    onAdd({
      taskName,
      projectName,
      locationName,
      startDate,
      finishDate,
      milestone,
      owner,
      contractor,
      percentComplete: Number(percentComplete) || 0,
      priority,
      status,
      notes,
    });

    resetForm();
    setShowAdd(false);
  }

  return (
    <FlatList
      style={styles.appFrame}
      contentContainerStyle={contentStyle}
      keyboardShouldPersistTaps="handled"
      data={sortedItems}
      keyExtractor={item => item.id}
      renderItem={({ item }) => (
        <ScheduleItemRow
          item={item}
          onUpdate={next => onUpdate(item.id, next)}
          onDelete={() => onDelete(item.id)}
        />
      )}
      ListHeaderComponent={
        <>
          <ScreenTitle
            title="Schedule"
            subtitle="Track project timelines, milestones, and due-soon work."
          />

          <SecondaryButton
            label="Back to Home"
            icon="arrow-back-outline"
            onPress={onBack}
          />

          <View style={styles.dashboardGrid}>
            <DashboardMetric
              label="Schedule Items"
              value={scheduleItems.length}
              icon="calendar-outline"
            />

            <DashboardMetric
              label="Due 7 Days"
              value={dueSoon.length}
              icon="time-outline"
            />

            <DashboardMetric
              label="Overdue"
              value={overdue.length}
              icon="alert-circle-outline"
              danger={overdue.length > 0}
            />

            <DashboardMetric
              label="Open Actions"
              value={actionItems.length}
              icon="checkbox-outline"
            />
          </View>

          <View style={styles.panel}>
            <Text style={styles.panelTitle}>Schedule Import</Text>
            <Text style={styles.bodyText}>
              Import a PDF Gantt chart. The app will first use your AI/OCR extractor endpoint if one is saved, then fall back to readable PDF text extraction. Scanned or flattened Gantt charts usually require AI/OCR.
            </Text>

            <Text style={styles.label}>AI/OCR extractor endpoint</Text>
            <TextInput
              style={styles.input}
              value={scheduleAiExtractorUrl}
              onChangeText={onScheduleAiExtractorUrlChange}
              placeholder="https://your-secure-schedule-extractor.example.com/extract"
              placeholderTextColor={colors.muted}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
            />

            <Text style={styles.mutedNote}>
              For scanned Gantt PDFs, connect a secure OCR/AI endpoint that accepts the PDF and returns JSON schedule items. Leave blank to use best-effort PDF text extraction only.
            </Text>

            <View style={styles.dataActionRow}>
              <PrimaryButton
                label="Import PDF / CSV"
                icon="cloud-upload-outline"
                onPress={onImport}
                compact
              />

              <SecondaryButton
                label={showAdd ? 'Hide Manual Entry' : 'Add Manually'}
                icon="add-circle-outline"
                onPress={() => setShowAdd(prev => !prev)}
                compact
              />
            </View>
          </View>

          {scheduleDocuments.length ? (
            <View style={styles.panel}>
              <Text style={styles.panelTitle}>Imported Schedule PDFs</Text>
              <Text style={styles.bodyText}>
                Keep only the current Gantt schedule active. Delete or archive outdated uploads so Upcoming is driven by the latest dates.
              </Text>

              {scheduleDocuments.map(document => (
                <View key={document.id} style={styles.compactLocationRow}>
                  <View style={styles.rowIconBubble}>
                    <Ionicons name="document-text-outline" size={20} color={colors.primary} />
                  </View>

                  <View style={styles.rowMain}>
                    <Text style={styles.projectName}>{document.name}</Text>
                    <Text style={styles.rowSub} numberOfLines={1}>
                      {document.originalFileName}
                    </Text>
                    <Text style={styles.rowSub}>
                      Imported {formatSavedTime(document.importedAt)} • {document.isCurrent ? 'Active schedule' : 'Inactive'}
                    </Text>
                  </View>

                  <View style={styles.compactActionColumn}>
                    <TouchableOpacity
                      style={styles.compactInlineAction}
                      onPress={() => onOpenDocument(document)}
                    >
                      <Text style={styles.compactInlineActionText}>Open</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.compactInlineAction}
                      onPress={() => startScheduleItemFromPdf(document)}
                    >
                      <Text style={styles.compactInlineActionText}>Add Item</Text>
                    </TouchableOpacity>
                    {!document.isCurrent ? (
                      <TouchableOpacity
                        style={styles.compactInlineAction}
                        onPress={() => onSetActiveDocument(document.id)}
                      >
                        <Text style={styles.compactInlineActionText}>Set Active</Text>
                      </TouchableOpacity>
                    ) : null}
                    <TouchableOpacity
                      style={styles.compactInlineAction}
                      onPress={() => onDeleteDocument(document.id)}
                    >
                      <Text style={[styles.compactInlineActionText, { color: colors.danger }]}>Delete</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ))}
            </View>
          ) : null}


          {showAdd ? (
            <View style={styles.panel}>
              <Text style={styles.panelTitle}>Add Schedule Item</Text>

              <Text style={styles.label}>Task or milestone</Text>
              <TextInput
                style={styles.input}
                value={taskName}
                onChangeText={setTaskName}
                placeholder="Example: East driveway striping"
                placeholderTextColor={colors.muted}
              />

              <Text style={styles.label}>Project</Text>
              <TextInput
                style={styles.input}
                value={projectName}
                onChangeText={setProjectName}
                placeholder="Project name"
                placeholderTextColor={colors.muted}
              />

              <Text style={styles.label}>Location</Text>
              <TextInput
                style={styles.input}
                value={locationName}
                onChangeText={setLocationName}
                placeholder="Location / work area"
                placeholderTextColor={colors.muted}
              />

              <View style={styles.sendRow}>
                <View style={styles.rowMain}>
                  <Text style={styles.label}>Start</Text>
                  <TextInput
                    style={styles.input}
                    value={startDate}
                    onChangeText={value => setStartDate(normalizeDateInput(value))}
                    placeholder="MM/DD/YYYY"
                    placeholderTextColor={colors.muted}
                    keyboardType="numbers-and-punctuation"
                    maxLength={10}
                  />
                </View>

                <View style={styles.rowMain}>
                  <Text style={styles.label}>Finish / Due</Text>
                  <TextInput
                    style={styles.input}
                    value={finishDate}
                    onChangeText={value => setFinishDate(normalizeDateInput(value))}
                    placeholder="MM/DD/YYYY"
                    placeholderTextColor={colors.muted}
                    keyboardType="numbers-and-punctuation"
                    maxLength={10}
                  />
                </View>
              </View>

              <Text style={styles.label}>Owner</Text>
              <TextInput
                style={styles.input}
                value={owner}
                onChangeText={setOwner}
                placeholder="PLZ owner or internal owner"
                placeholderTextColor={colors.muted}
              />

              <Text style={styles.label}>Contractor</Text>
              <TextInput
                style={styles.input}
                value={contractor}
                onChangeText={setContractor}
                placeholder="Contractor / responsible company"
                placeholderTextColor={colors.muted}
              />

              <Text style={styles.label}>Percent Complete</Text>
              <TextInput
                style={styles.input}
                value={percentComplete}
                onChangeText={value => setPercentComplete(value.replace(/[^0-9]/g, '').slice(0, 3))}
                placeholder="0"
                placeholderTextColor={colors.muted}
                keyboardType="number-pad"
                maxLength={3}
              />

              <Text style={styles.label}>Priority</Text>
              <View style={styles.statusGrid}>
                {SCHEDULE_PRIORITIES.map(itemPriority => (
                  <TouchableOpacity
                    key={itemPriority}
                    style={[
                      styles.statusButton,
                      priority === itemPriority && styles.statusButtonActive,
                    ]}
                    onPress={() => setPriority(itemPriority)}
                  >
                    <Text
                      style={[
                        styles.statusButtonText,
                        priority === itemPriority && styles.statusButtonTextActive,
                      ]}
                    >
                      {itemPriority}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={styles.label}>Milestone</Text>
              <TextInput
                style={styles.input}
                value={milestone}
                onChangeText={setMilestone}
                placeholder="Optional milestone"
                placeholderTextColor={colors.muted}
              />

              <Text style={styles.label}>Status</Text>
              <View style={styles.statusGrid}>
                {SCHEDULE_STATUSES.map(itemStatus => (
                  <TouchableOpacity
                    key={itemStatus}
                    style={[
                      styles.statusButton,
                      status === itemStatus && styles.statusButtonActive,
                    ]}
                    onPress={() => setStatus(itemStatus)}
                  >
                    <Text
                      style={[
                        styles.statusButtonText,
                        status === itemStatus && styles.statusButtonTextActive,
                      ]}
                    >
                      {itemStatus}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={styles.label}>Notes</Text>
              <TextInput
                style={[styles.input, styles.notesInput]}
                value={notes}
                onChangeText={setNotes}
                placeholder="Schedule notes, constraints, or next step."
                placeholderTextColor={colors.muted}
                multiline
              />

              <PrimaryButton
                label="Save Schedule Item"
                icon="checkmark-circle-outline"
                onPress={submitManualItem}
              />
            </View>
          ) : null}

          {dueSoon.length || overdue.length ? (
            <View style={styles.panel}>
              <Text style={styles.panelTitle}>Needs Attention</Text>
              {[...overdue, ...dueSoon].slice(0, 6).map(item => (
                <View key={item.id} style={styles.compactLocationRow}>
                  <View style={styles.rowIconBubble}>
                    <Ionicons
                      name={daysUntilDate(item.finishDate)! < 0 ? 'alert-circle-outline' : 'time-outline'}
                      size={20}
                      color={daysUntilDate(item.finishDate)! < 0 ? colors.danger : colors.warning}
                    />
                  </View>
                  <View style={styles.rowMain}>
                    <Text style={styles.projectName}>{item.taskName}</Text>
                    <Text style={styles.rowSub}>{dueStatusText(item.finishDate)}</Text>
                  </View>
                </View>
              ))}
            </View>
          ) : null}

          {actionItems.length ? (
            <View style={styles.panel}>
              <Text style={styles.panelTitle}>Open Action Items with Due Dates</Text>
              {actionItems.slice(0, 6).map(item => (
                <View key={item.id} style={styles.compactLocationRow}>
                  <View style={styles.rowIconBubble}>
                    <Ionicons name="checkbox-outline" size={20} color={colors.primary} />
                  </View>
                  <View style={styles.rowMain}>
                    <Text style={styles.projectName}>{item.taskName}</Text>
                    <Text style={styles.rowSub}>
                      {item.projectName}{item.locationName ? ` • ${item.locationName}` : ''}
                    </Text>
                    <Text style={styles.rowSub}>{item.dueLabel}</Text>
                  </View>
                </View>
              ))}
            </View>
          ) : null}

          <Text style={styles.sectionLabel}>Timeline Items</Text>
        </>
      }
      ListEmptyComponent={
        <EmptyState
          title="No schedule items yet"
          text="Import a CSV/text schedule or add a schedule item manually."
        />
      }
    />
  );
}

function ScheduleItemRow({
  item,
  onUpdate,
  onDelete,
}: {
  item: ScheduleItem;
  onUpdate: (next: Partial<ScheduleItem>) => void;
  onDelete: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const days = daysUntilDate(item.finishDate);
  const isOverdue = days !== null && days < 0 && item.status !== 'Complete';
  const isDueSoon = days !== null && days >= 0 && days <= 7 && item.status !== 'Complete';
  const priorityColor = item.priority === 'High' ? colors.danger : item.priority === 'Low' ? colors.success : colors.warning;
  const statusColor = item.status === 'Complete' ? colors.success : item.status === 'In Progress' ? colors.warning : item.status === 'Waiting' ? colors.muted : colors.primary;

  return (
    <View style={styles.savedRow}>
      <TouchableOpacity
        style={styles.rowIconBubble}
        onPress={() => setExpanded(prev => !prev)}
      >
        <Ionicons
          name={isOverdue ? 'alert-circle-outline' : isDueSoon ? 'time-outline' : 'calendar-outline'}
          size={20}
          color={isOverdue ? colors.danger : isDueSoon ? colors.warning : colors.primary}
        />
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.rowMain}
        onPress={() => setExpanded(prev => !prev)}
      >
        <Text style={styles.projectName}>{item.taskName}</Text>
        <Text style={styles.rowSub}>
          {item.projectName || 'No project'}{item.locationName ? ` • ${item.locationName}` : ''}
        </Text>
        <Text style={styles.rowSub}>
          {item.finishDate ? dueStatusText(item.finishDate) : 'No finish date'}{item.contractor ? ` • ${item.contractor}` : ''}
        </Text>

        <View style={styles.scheduleMetaRow}>
          <View style={[styles.statusPill, { backgroundColor: `${statusColor}1A` }]}>
            <Text style={[styles.statusPillText, { color: statusColor }]}>{item.status}</Text>
          </View>
          <View style={[styles.statusPill, { backgroundColor: `${priorityColor}1A` }]}>
            <Text style={[styles.statusPillText, { color: priorityColor }]}>{item.priority}</Text>
          </View>
          <Text style={styles.percentText}>{item.percentComplete}%</Text>
        </View>

        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${item.percentComplete}%` }]} />
        </View>

        {expanded ? (
          <View style={styles.areaManagerCard}>
            <Text style={styles.label}>Finish / Due Date</Text>
            <TextInput
              style={styles.input}
              value={item.finishDate}
              onChangeText={finishDate => onUpdate({ finishDate: normalizeDateInput(finishDate) })}
              placeholder="MM/DD/YYYY"
              placeholderTextColor={colors.muted}
              keyboardType="numbers-and-punctuation"
              maxLength={10}
            />

            <Text style={styles.label}>Owner</Text>
            <TextInput
              style={styles.input}
              value={item.owner}
              onChangeText={owner => onUpdate({ owner })}
              placeholder="PLZ owner / internal owner"
              placeholderTextColor={colors.muted}
            />

            <Text style={styles.label}>Contractor</Text>
            <TextInput
              style={styles.input}
              value={item.contractor}
              onChangeText={contractor => onUpdate({ contractor })}
              placeholder="Contractor / responsible company"
              placeholderTextColor={colors.muted}
            />

            <Text style={styles.label}>Percent Complete</Text>
            <TextInput
              style={styles.input}
              value={String(item.percentComplete)}
              onChangeText={value => onUpdate({ percentComplete: Math.max(0, Math.min(100, Number(value.replace(/[^0-9]/g, '')) || 0)) })}
              placeholder="0"
              placeholderTextColor={colors.muted}
              keyboardType="number-pad"
              maxLength={3}
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
            <View style={styles.statusGrid}>
              {SCHEDULE_STATUSES.map(status => (
                <TouchableOpacity
                  key={status}
                  style={[
                    styles.statusButton,
                    item.status === status && styles.statusButtonActive,
                  ]}
                  onPress={() => onUpdate({ status })}
                >
                  <Text
                    style={[
                      styles.statusButtonText,
                      item.status === status && styles.statusButtonTextActive,
                    ]}
                  >
                    {status}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.label}>Notes</Text>
            <TextInput
              style={[styles.input, styles.notesInput]}
              value={item.notes}
              onChangeText={notes => onUpdate({ notes })}
              placeholder="Notes"
              placeholderTextColor={colors.muted}
              multiline
            />
          </View>
        ) : null}
      </TouchableOpacity>

      <TouchableOpacity style={styles.iconOnlyDangerButton} onPress={onDelete}>
        <Ionicons name="trash-outline" size={19} color={colors.danger} />
      </TouchableOpacity>
    </View>
  );
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

function BottomTabs({
  current,
  onChange,
}: {
  current: Screen;
  onChange: (screen: Screen) => void;
}) {
  return (
    <View style={styles.bottomTabs}>
      <TabButton
        label="Overview"
        icon="home-outline"
        active={current === 'Home'}
        onPress={() => onChange('Home')}
      />

      <TabButton
        label="Projects"
        icon="folder-open-outline"
        active={current === 'Projects' || current === 'ProjectWorkspace' || current === 'ProjectDocuments'}
        onPress={() => onChange('Projects')}
      />

      <TabButton
        label="Updates"
        icon="document-text-outline"
        active={current === 'SavedUpdates' || current === 'UpdateDetail'}
        onPress={() => onChange('SavedUpdates')}
      />

      <TabButton
        label="Settings"
        icon="settings-outline"
        active={current === 'Admin'}
        onPress={() => onChange('Admin')}
      />
    </View>
  );
}

function TabButton({
  label,
  icon,
  active,
  onPress,
}: {
  label: string;
  icon: IconName;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      style={styles.tabButton}
      onPress={onPress}
    >
      <Ionicons
        name={icon}
        size={21}
        color={
          active
            ? colors.primary
            : colors.muted
        }
      />

      <Text
        style={[
          styles.tabText,
          active && styles.tabTextActive,
        ]}
      >
        {label}
      </Text>
    </TouchableOpacity>
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

const HOLD_TO_DELETE_DURATION_MS = 3000;
const HOLD_TO_DELETE_TICK_MS = 50;

function HoldToDeleteButton({
  label,
  holdingLabel,
  deletingLabel,
  isDeleting,
  onConfirm,
}: {
  label: string;
  holdingLabel: string;
  deletingLabel: string;
  isDeleting: boolean;
  onConfirm: () => void;
}) {
  const [progress, setProgress] = useState(0);
  const [holding, setHolding] = useState(false);
  const holdTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  function clearHoldTimer() {
    if (holdTimer.current) {
      clearInterval(holdTimer.current);
      holdTimer.current = null;
    }
  }

  function startHold() {
    if (isDeleting) return;

    setHolding(true);
    setProgress(0);

    const startedAt = Date.now();

    holdTimer.current = setInterval(() => {
      const elapsed = Date.now() - startedAt;
      const nextProgress = Math.min(
        100,
        (elapsed / HOLD_TO_DELETE_DURATION_MS) * 100,
      );

      setProgress(nextProgress);

      if (nextProgress >= 100) {
        clearHoldTimer();
        setHolding(false);
        setProgress(0);
        onConfirm();
      }
    }, HOLD_TO_DELETE_TICK_MS);
  }

  function cancelHold() {
    clearHoldTimer();
    setHolding(false);
    setProgress(0);
  }

  useEffect(() => clearHoldTimer, []);

  return (
    <TouchableOpacity
      style={styles.holdToDeleteButton}
      activeOpacity={0.85}
      disabled={isDeleting}
      onPressIn={startHold}
      onPressOut={cancelHold}
    >
      <View
        style={[
          styles.holdToDeleteFill,
          { width: `${progress}%` },
        ]}
      />
      <Ionicons name="trash-outline" size={19} color={colors.danger} />
      <Text style={styles.holdToDeleteText}>
        {isDeleting ? deletingLabel : holding ? holdingLabel : label}
      </Text>
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

const colors = {
  bg: '#F5F5F7',
  card: '#FFFFFF',
  fill: '#F2F2F7',
  text: '#1D1D1F',
  muted: '#6E6E73',
  tertiaryText: '#9A9AA0',
  line: '#E5E5EA',
  primary: '#007AFF',
  primarySoft: '#EAF4FF',
  success: '#34C759',
  successSoft: '#EAF8EE',
  warning: '#FF9500',
  warningSoft: '#FFF4E5',
  insight: '#6B5DD3',
  insightSoft: '#F0EEFF',
  dangerSoft: '#FFECEC',
  danger: '#FF3B30',
};

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

const styles = StyleSheet.create({
  shell: {
    flex: 1,
    backgroundColor: colors.bg,
  },

  keyboard: {
    flex: 1,
  },

  appFrame: {
    flex: 1,
  },

  content: {
    padding: 18,
    paddingBottom: 110,
  },

  header: {
    paddingTop: 10,
    paddingBottom: 22,
  },

  kicker: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 8,
  },

  title: {
    color: colors.text,
    fontSize: 28,
    fontWeight: '800',
    lineHeight: 34,
  },

  subtitle: {
    color: colors.muted,
    fontSize: 15,
    lineHeight: 21,
    marginTop: 7,
    fontWeight: '500',
  },

  screenTitleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },

  screenTitle: {
    flex: 1,
    marginBottom: 16,
  },

  screenTitleActionButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.fill,
    alignItems: 'center',
    justifyContent: 'center',
  },

  sectionLabel: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '700',
    marginTop: 10,
    marginBottom: 10,
    textTransform: 'uppercase',
  },


  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 10,
  },

  countPill: {
    minWidth: 34,
    minHeight: 28,
    borderRadius: 999,
    paddingHorizontal: 10,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },

  countPillDanger: {
    backgroundColor: colors.dangerSoft,
  },

  countPillText: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: '800',
  },

  countPillTextDanger: {
    color: colors.danger,
  },

  mutedNote: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '600',
    marginBottom: 16,
  },

  primaryButton: {
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 14,
    alignItems: 'center',
    marginBottom: 10,
    minHeight: 54,
    justifyContent: 'center',
  },

  holdToDeleteButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.dangerSoft,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.danger,
    paddingVertical: 14,
    paddingHorizontal: 14,
    minHeight: 54,
    marginBottom: 10,
    overflow: 'hidden',
  },

  holdToDeleteFill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: colors.danger,
    opacity: 0.25,
  },

  holdToDeleteText: {
    color: colors.danger,
    fontSize: 16,
    fontWeight: '700',
  },

  secondaryButton: {
    backgroundColor: colors.card,
    borderColor: colors.line,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 14,
    alignItems: 'center',
    marginBottom: 10,
    minHeight: 54,
    justifyContent: 'center',
  },

  compactButton: {
    flex: 1,
    minHeight: 64,
    marginBottom: 0,
  },

  disabledButton: {
    opacity: 0.45,
  },

  buttonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    maxWidth: '100%',
  },

  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
    flexShrink: 1,
  },

  secondaryButtonText: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
    flexShrink: 1,
  },

  panel: {
    backgroundColor: colors.card,
    borderRadius: 8,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: colors.line,
  },

  panelTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 10,
  },

  bodyText: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '500',
  },

  locationPanel: {
    backgroundColor: colors.card,
    borderRadius: 8,
    padding: 14,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: colors.line,
  },

  locationPanelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 10,
  },

  locationDetailText: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '700',
    marginTop: 7,
  },

  locationActionRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 12,
  },

  areaChipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
  },

  areaChip: {
    backgroundColor: colors.fill,
    borderColor: colors.line,
    borderWidth: 1,
    borderRadius: 999,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },

  areaChipSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },

  areaChipText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '800',
  },

  areaChipTextSelected: {
    color: '#FFFFFF',
  },

  areaManagerCard: {
    backgroundColor: colors.fill,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 12,
    marginTop: 12,
  },

  areaNameInput: {
    marginTop: 14,
  },

  draftRecoveryCard: {
    backgroundColor: colors.warningSoft,
    borderWidth: 1,
    borderColor: '#FFD8A3',
    borderRadius: 12,
    padding: 15,
    marginBottom: 14,
  },

  draftRecoveryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
  },

  draftIcon: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },

  draftRecoveryTitle: {
    color: colors.text,
    fontSize: 17,
    fontWeight: '800',
  },

  draftRecoveryProject: {
    color: colors.muted,
    fontSize: 14,
    fontWeight: '600',
    marginTop: 3,
  },

  draftStatsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
    marginBottom: 13,
  },

  draftStatText: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: '700',
  },

  draftStatDot: {
    color: colors.muted,
    fontSize: 13,
    paddingHorizontal: 7,
  },

  draftActionRow: {
    flexDirection: 'row',
    gap: 9,
  },

  resumeDraftButton: {
    flex: 1,
    backgroundColor: colors.warning,
    borderRadius: 9,
    minHeight: 46,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 7,
  },

  resumeDraftText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '800',
  },

  discardDraftButton: {
    backgroundColor: '#FFFFFF',
    borderRadius: 9,
    minHeight: 46,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 7,
  },

  discardDraftText: {
    color: colors.danger,
    fontSize: 15,
    fontWeight: '800',
  },

  draftSavedIndicator: {
    backgroundColor: colors.successSoft,
    borderRadius: 8,
    paddingVertical: 9,
    paddingHorizontal: 11,
    marginBottom: 13,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },

  draftSavedText: {
    color: '#248A3D',
    fontSize: 12,
    fontWeight: '700',
    flex: 1,
  },

  dashboardCard: {
    backgroundColor: colors.card,
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
    borderColor: colors.line,
    borderWidth: 1,
  },

  dashboardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 14,
  },

  statsGrid: {
    flexDirection: 'row',
    gap: 8,
  },

  miniStat: {
    flex: 1,
    backgroundColor: colors.fill,
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
  },

  miniStatDanger: {
    backgroundColor: colors.dangerSoft,
  },

  miniStatValue: {
    color: colors.primary,
    fontSize: 20,
    fontWeight: '800',
  },

  miniStatValueDanger: {
    color: colors.danger,
  },

  miniStatLabel: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: '700',
    marginTop: 2,
  },

  cardActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
  },

  smallAction: {
    backgroundColor: colors.primarySoft,
    borderRadius: 8,
    paddingVertical: 9,
    paddingHorizontal: 10,
  },

  smallActionText: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: '800',
  },

  smallActionDanger: {
    backgroundColor: colors.dangerSoft,
  },

  smallActionDangerText: {
    color: colors.danger,
    fontSize: 13,
    fontWeight: '800',
  },

  addProjectCard: {
    backgroundColor: colors.card,
    borderRadius: 8,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: colors.line,
  },

  projectRow: {
    backgroundColor: colors.card,
    borderRadius: 8,
    padding: 14,
    marginBottom: 10,
    borderColor: colors.line,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },

  savedRow: {
    backgroundColor: colors.card,
    borderRadius: 8,
    padding: 14,
    marginBottom: 10,
    borderColor: colors.line,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },

  contactRow: {
    backgroundColor: colors.card,
    borderRadius: 8,
    padding: 14,
    marginBottom: 10,
    borderColor: colors.line,
    borderWidth: 1,
  },


  contactRowHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    width: '100%',
  },

  deliveryChoiceBlock: {
    marginTop: 12,
    width: '100%',
  },

  choiceChipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },

  deliveryChoiceChip: {
    maxWidth: '100%',
    backgroundColor: colors.fill,
    borderColor: colors.line,
    borderWidth: 1,
    borderRadius: 999,
    paddingVertical: 8,
    paddingHorizontal: 10,
    flexShrink: 1,
  },

  deliveryChoiceChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },

  deliveryChoiceText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '800',
    maxWidth: 230,
  },

  deliveryChoiceTextActive: {
    color: '#FFFFFF',
  },

  rowMain: {
    flex: 1,
  },

  rowIconBubble: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },

  projectName: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '700',
  },

  rowSub: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: '500',
    marginTop: 4,
  },

  contactSummary: {
    backgroundColor: colors.card,
    borderColor: colors.line,
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    marginBottom: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },

  contactSummaryText: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '700',
    flex: 1,
  },

  contactSummaryAction: {
    color: colors.primary,
    fontSize: 14,
    fontWeight: '800',
  },

  contactSelectText: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: '800',
  },

  contactSelectTextSelected: {
    color: colors.danger,
  },

  inlineLink: {
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 6,
    marginBottom: 12,
  },

  inlineLinkText: {
    color: colors.primary,
    fontSize: 15,
    fontWeight: '700',
  },

  progressPanel: {
    backgroundColor: colors.card,
    borderRadius: 8,
    padding: 14,
    marginBottom: 14,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.line,
  },

  progressStat: {
    flex: 1,
    alignItems: 'center',
  },

  progressDivider: {
    width: 1,
    height: 34,
    backgroundColor: colors.line,
  },

  progressNumber: {
    color: colors.primary,
    fontSize: 28,
    fontWeight: '800',
  },

  progressText: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: '600',
    marginTop: 2,
  },

  emptyState: {
    backgroundColor: colors.card,
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: colors.line,
    shadowColor: '#17213A',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },

  emptyTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 6,
  },

  photoCard: {
    backgroundColor: colors.card,
    borderRadius: 8,
    padding: 14,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: colors.line,
  },

  photoHeader: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'center',
    marginBottom: 12,
  },

  photoThumb: {
    width: 72,
    height: 72,
    borderRadius: 8,
    backgroundColor: colors.line,
  },

  photoMeta: {
    flex: 1,
  },

  photoTitle: {
    color: colors.text,
    fontSize: 17,
    fontWeight: '700',
  },

  categoryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
  },

  categoryChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: colors.primarySoft,
    borderRadius: 999,
    paddingVertical: 8,
    paddingHorizontal: 10,
  },

  categoryChipActive: {
    backgroundColor: colors.primary,
  },

  categoryText: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: '800',
  },

  categoryTextActive: {
    color: '#FFFFFF',
  },

  photoPreviewBadge: {
    position: 'absolute',
    right: 4,
    bottom: 4,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(0,0,0,0.65)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  actionPanel: {
    backgroundColor: colors.primarySoft,
    borderWidth: 1,
    borderColor: '#CFE6FF',
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
  },

  actionPanelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    marginBottom: 12,
  },

  actionPanelTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '800',
  },

  statusGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },

  statusButton: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 999,
    paddingVertical: 8,
    paddingHorizontal: 11,
  },

  statusButtonActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },

  statusButtonText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '800',
  },

  statusButtonTextActive: {
    color: '#FFFFFF',
  },

  dateHelpError: {
    color: colors.danger,
    fontSize: 12,
    fontWeight: '700',
    marginTop: -7,
    marginBottom: 10,
  },

  photoControlRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 10,
  },

  photoControlButton: {
    flex: 1,
    minHeight: 42,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.card,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
  },

  photoControlButtonDisabled: {
    backgroundColor: colors.fill,
  },

  photoControlText: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: '800',
  },

  photoControlTextDisabled: {
    color: colors.tertiaryText,
  },

  photoModalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.96)',
  },

  photoModalSafeArea: {
    flex: 1,
  },

  photoModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
  },

  photoModalTitleWrap: {
    flex: 1,
  },

  photoModalTitle: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '800',
  },

  photoModalCaption: {
    color: '#D1D1D6',
    fontSize: 13,
    lineHeight: 18,
    marginTop: 3,
  },

  photoModalCloseButton: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(255,255,255,0.22)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.28)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  sheetModalBackdrop: {
    flex: 1,
    backgroundColor: colors.bg,
  },

  sheetModalSafeArea: {
    flex: 1,
  },

  sheetModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 12,
    gap: 12,
  },

  sheetModalTitleWrap: {
    flex: 1,
  },

  sheetModalTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '800',
  },

  sheetModalCaption: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 18,
    marginTop: 3,
  },

  sheetModalCloseButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.fill,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
  },

  photoModalImage: {
    flex: 1,
    width: '100%',
  },

  photoModalBottomBar: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: Platform.OS === 'ios' ? 12 : 16,
  },

  photoModalBottomCloseButton: {
    minHeight: 54,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.18)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.28)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },

  photoModalBottomCloseText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '800',
  },

  iconOnlyDangerButton: {
    width: 38,
    height: 38,
    borderRadius: 8,
    backgroundColor: colors.dangerSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },

  iconOnlyButton: {
    width: 38,
    height: 38,
    borderRadius: 8,
    backgroundColor: colors.fill,
    alignItems: 'center',
    justifyContent: 'center',
  },

  label: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 8,
  },

  input: {
    minHeight: 46,
    backgroundColor: colors.fill,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 8,
    color: colors.text,
    fontSize: 15,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 12,
  },

  notesInput: {
    minHeight: 90,
    textAlignVertical: 'top',
  },

  previewCard: {
    backgroundColor: colors.card,
    borderRadius: 8,
    padding: 16,
    marginBottom: 14,
    borderColor: colors.line,
    borderWidth: 1,
  },

  previewLabel: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 7,
  },

  subjectText: {
    color: colors.text,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '700',
  },

  divider: {
    height: 1,
    backgroundColor: colors.line,
    marginVertical: 14,
  },

  previewBody: {
    color: colors.text,
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '500',
  },

  sendRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 10,
  },

  dataActionRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 14,
    alignItems: 'stretch',
  },

  sectionLabelNoMargin: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
  },

  addLocationInlineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 12,
  },

  addLocationInlineInput: {
    flex: 1,
    marginBottom: 0,
  },

  addLocationInlineButton: {
    width: 52,
    height: 52,
    borderRadius: 12,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },

  areaListCard: {
    backgroundColor: colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.line,
    overflow: 'hidden',
    marginTop: 8,
  },

  areaListHeaderRow: {
    minHeight: 44,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },

  areaListRow: {
    minHeight: 68,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },

  areaStatusLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 3,
  },

  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },

  statusDotSaved: {
    backgroundColor: colors.success,
  },

  statusDotMissing: {
    backgroundColor: colors.tertiaryText,
  },

  areaListRadius: {
    color: colors.muted,
    fontSize: 14,
    fontWeight: '700',
    minWidth: 58,
    textAlign: 'right',
  },

  detailModalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'flex-end',
  },

  detailModalCardFrame: {
    backgroundColor: colors.card,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 1,
    borderColor: colors.line,
  },

  detailModalCardContent: {
    padding: 18,
    paddingBottom: Platform.OS === 'ios' ? 34 : 18,
  },

  detailModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 14,
  },

  detailCloseButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.fill,
    alignItems: 'center',
    justifyContent: 'center',
  },

  radiusEditRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },

  radiusEditInput: {
    flex: 1,
  },

  radiusEditUnit: {
    color: colors.muted,
    fontSize: 16,
    fontWeight: '800',
    marginBottom: 12,
  },

  locationSummaryCard: {
    backgroundColor: colors.fill,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 12,
    marginBottom: 12,
  },

  setupProgressCard: {
    backgroundColor: colors.primarySoft,
    borderRadius: 8,
    padding: 12,
    marginTop: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#CFE6FF',
  },

  checklistRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },

  checklistText: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '700',
    flex: 1,
  },

  headerCompact: {
    paddingTop: 10,
    paddingBottom: 14,
  },

  dashboardSummaryCard: {
    backgroundColor: colors.card,
    borderRadius: 14,
    padding: 16,
    marginBottom: 14,
    borderColor: colors.line,
    borderWidth: 1,
  },

  dashboardSummaryHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 14,
  },

  dashboardManageButton: {
    backgroundColor: colors.primarySoft,
    borderRadius: 999,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },

  dashboardManageText: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: '800',
  },

  dashboardMetricGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },

  dashboardMetricCard: {
    width: '48%',
    backgroundColor: colors.fill,
    borderRadius: 11,
    paddingVertical: 10,
    paddingHorizontal: 12,
    minHeight: 86,
    borderWidth: 1,
    borderColor: colors.line,
  },

  dashboardMetricDanger: {
    backgroundColor: colors.dangerSoft,
    borderColor: '#FFD1D1',
  },

  dashboardMetricIconRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },

  dashboardMetricValue: {
    color: colors.primary,
    fontSize: 24,
    fontWeight: '900',
  },

  dashboardMetricValueDanger: {
    color: colors.danger,
  },

  dashboardMetricLabel: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '800',
  },

  quickActionGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 14,
  },

  quickActionButton: {
    width: '48%',
    backgroundColor: colors.card,
    borderRadius: 12,
    borderColor: colors.line,
    borderWidth: 1,
    minHeight: 76,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    paddingHorizontal: 10,
  },

  quickActionButtonPrimary: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },

  quickActionText: {
    color: colors.text,
    fontSize: 14,
    lineHeight: 17,
    fontWeight: '800',
    textAlign: 'center',
  },

  quickActionTextPrimary: {
    color: '#FFFFFF',
  },

  attentionCard: {
    backgroundColor: colors.card,
    borderRadius: 11,
    padding: 13,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: colors.line,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },

  attentionCardUrgent: {
    borderColor: '#FFD1D1',
    backgroundColor: '#FFF8F8',
  },

  activityRow: {
    backgroundColor: colors.card,
    borderRadius: 11,
    padding: 13,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: colors.line,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },

  projectFinderPanel: {
    backgroundColor: colors.card,
    borderRadius: 16,
    padding: 15,
    marginBottom: 18,
    borderColor: colors.line,
    borderWidth: 1,
    shadowColor: '#17213A',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },

  phase2SelectorButton: {
    backgroundColor: colors.card,
    borderRadius: 8,
    padding: 14,
    marginBottom: 12,
    borderColor: 'rgba(0,0,0,0.18)',
    borderWidth: 1,
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },

  phase2SelectorLabel: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
  },

  phase2SelectorValue: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '800',
    marginTop: 2,
  },

  phase2BriefCard: {
    backgroundColor: colors.card,
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
    borderColor: colors.line,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    shadowColor: '#17213A',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },

  phase2BriefIcon: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },

  phase2BriefIconAttention: {
    backgroundColor: colors.warningSoft,
  },

  phase2BriefIconHealthy: {
    backgroundColor: colors.successSoft,
  },

  phase2BriefIconProblem: {
    backgroundColor: colors.dangerSoft,
  },

  projectWorkspaceHero: {
    backgroundColor: colors.card,
    borderColor: colors.line,
    borderWidth: 1,
    borderRadius: 14,
    overflow: 'hidden',
    marginBottom: 12,
    shadowColor: '#17213A',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },

  projectWorkspaceHeroImage: {
    width: '100%',
    height: 180,
    resizeMode: 'cover',
  },

  projectWorkspaceHeroPlaceholder: {
    height: 130,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.fill,
  },

  projectWorkspaceCoverActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    padding: 10,
  },

  projectWorkspaceCoverButton: {
    flexBasis: '46%',
    minHeight: 44,
    paddingHorizontal: 8,
  },

  workspaceSkeleton: {
    gap: 9,
    paddingVertical: 8,
  },

  workspaceSkeletonLine: {
    height: 12,
    borderRadius: 6,
    backgroundColor: colors.fill,
  },

  projectWorkspaceCoverTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '700',
    paddingHorizontal: 12,
    paddingTop: 12,
  },

  overviewPageWrap: {
    flex: 1,
  },

  overviewPageGradient: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 280,
  },

  overviewGreetingHeader: {
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 4,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },

  overviewGreetingCopy: {
    flex: 1,
  },

  overviewGreetingText: {
    fontSize: 26,
    fontWeight: '700',
    color: colors.text,
  },

  overviewGreetingDate: {
    fontSize: 13,
    color: colors.muted,
    marginTop: 2,
  },

  overviewAskDaveButton: {
    minHeight: 44,
    borderRadius: 22,
    paddingHorizontal: 13,
    backgroundColor: 'rgba(255,255,255,0.72)',
    borderColor: 'rgba(32,83,158,0.18)',
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    shadowColor: '#17213A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 1,
  },

  overviewAskDaveText: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: '800',
  },

  overviewHealthCard: {
    marginTop: 10,
    marginBottom: 20,
    borderRadius: 20,
    padding: 20,
    backgroundColor: '#123F8C',
    shadowColor: '#0B2A6B',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.2,
    shadowRadius: 16,
    elevation: 5,
  },

  overviewDashboardSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 18,
  },

  overviewHealthEyebrow: {
    color: 'rgba(255,255,255,0.68)',
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1.2,
    marginBottom: 3,
  },

  overviewHealthTitle: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '800',
  },

  overviewHealthMetrics: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
  },

  overviewHealthMetric: {
    flex: 1,
  },

  overviewHealthMetricValue: {
    color: '#FFFFFF',
    fontSize: 25,
    fontWeight: '800',
    marginBottom: 3,
  },

  overviewHealthMetricLabel: {
    color: 'rgba(255,255,255,0.72)',
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '700',
  },

  overviewDashboardHeadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 4,
    marginBottom: 10,
  },

  overviewDashboardHeading: {
    color: colors.text,
    fontSize: 19,
    fontWeight: '800',
  },

  overviewDashboardLink: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: '800',
    paddingVertical: 8,
  },

  overviewPriorityCard: {
    backgroundColor: colors.card,
    borderRadius: 20,
    borderColor: colors.line,
    borderWidth: 1,
    overflow: 'hidden',
    marginBottom: 22,
    shadowColor: '#17213A',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.12,
    shadowRadius: 18,
    elevation: 4,
  },

  overviewPriorityImage: {
    width: '100%',
    height: 176,
    resizeMode: 'cover',
  },

  overviewPriorityImagePlaceholder: {
    height: 130,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },

  overviewPriorityContent: {
    padding: 18,
  },

  overviewPriorityBadge: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: colors.warningSoft,
    borderRadius: 999,
    paddingVertical: 5,
    paddingHorizontal: 9,
    marginBottom: 10,
  },

  overviewPriorityBadgeText: {
    color: colors.warning,
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.7,
  },

  overviewPriorityProject: {
    color: colors.text,
    fontSize: 21,
    fontWeight: '800',
    marginBottom: 6,
  },

  overviewPriorityRecommendation: {
    color: colors.text,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '700',
    marginBottom: 7,
  },

  overviewPrioritySupport: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 19,
    marginBottom: 15,
  },

  overviewPriorityButton: {
    minHeight: 46,
    borderRadius: 12,
    paddingHorizontal: 15,
    backgroundColor: colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },

  overviewPriorityButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
  },

  overviewDailyBriefCard: {
    backgroundColor: colors.card,
    borderRadius: 16,
    borderColor: colors.line,
    borderWidth: 1,
    paddingHorizontal: 15,
    paddingVertical: 4,
    marginBottom: 22,
    shadowColor: '#17213A',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },

  overviewBriefRow: {
    minHeight: 66,
    paddingVertical: 11,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    borderBottomColor: colors.line,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },

  overviewBriefIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },

  overviewBriefProject: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '800',
    marginBottom: 2,
  },

  overviewBriefText: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 18,
  },

  overviewBriefEmpty: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 20,
    paddingVertical: 18,
  },

  overviewProjectCard: {
    minHeight: 116,
    backgroundColor: colors.card,
    borderRadius: 16,
    borderColor: colors.line,
    borderWidth: 1,
    padding: 11,
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    shadowColor: '#17213A',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },

  overviewProjectImage: {
    width: 92,
    height: 92,
    borderRadius: 12,
    resizeMode: 'cover',
  },

  overviewProjectImagePlaceholder: {
    width: 92,
    height: 92,
    borderRadius: 12,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },

  overviewProjectContent: {
    flex: 1,
  },

  overviewProjectTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 5,
  },

  overviewProjectTitle: {
    flex: 1,
    color: colors.text,
    fontSize: 16,
    fontWeight: '800',
  },

  overviewProjectHealth: {
    fontSize: 11,
    fontWeight: '900',
  },

  overviewProjectSummary: {
    color: colors.text,
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 7,
  },

  overviewProjectActivity: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '600',
  },

  overviewActivityCard: {
    backgroundColor: colors.card,
    borderRadius: 16,
    borderColor: colors.line,
    borderWidth: 1,
    paddingHorizontal: 15,
    paddingVertical: 6,
    marginBottom: 12,
    shadowColor: '#17213A',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },

  overviewActivityGroup: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: '900',
    textTransform: 'uppercase',
    letterSpacing: 0.7,
    paddingTop: 12,
    paddingBottom: 3,
  },

  overviewActivityRow: {
    minHeight: 62,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderBottomColor: colors.line,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },

  overviewActivityIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },

  overviewActivityProject: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '800',
    marginBottom: 2,
  },

  overviewActivityText: {
    color: colors.muted,
    fontSize: 12,
  },

  overviewActivityTime: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: '700',
  },

  overviewHeroCard: {
    marginTop: 8,
    borderRadius: 20,
    overflow: 'hidden',
    height: 190,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.18)',
  },

  overviewHeroPhoto: {
    opacity: 0.55,
  },

  overviewHeroContent: {
    flex: 1,
    padding: 18,
    justifyContent: 'space-between',
  },

  overviewHeroLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: 'rgba(255,255,255,0.75)',
  },

  overviewHeroNumber: {
    fontSize: 52,
    fontWeight: '800',
    lineHeight: 56,
  },

  overviewHeroCaption: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.88)',
    marginTop: 2,
  },

  overviewHeroPill: {
    flexDirection: 'row',
    alignSelf: 'flex-start',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(255,255,255,0.16)',
    borderRadius: 20,
    paddingVertical: 5,
    paddingHorizontal: 11,
  },

  overviewHeroPillText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#FFFFFF',
  },

  overviewBentoRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 12,
  },

  overviewBentoCardTouchable: {
    flexBasis: '47%',
    flexGrow: 1,
  },

  overviewBentoCard: {
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.18)',
  },

  overviewBentoIconWrap: {
    width: 30,
    height: 30,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.75)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },

  overviewBentoNumber: {
    fontSize: 22,
    fontWeight: '800',
    color: colors.text,
  },

  overviewBentoLabel: {
    fontSize: 12,
    color: colors.muted,
  },

  overviewSectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 20,
    marginBottom: 6,
  },

  overviewSectionLabel: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: '600',
    textTransform: 'uppercase',
  },

  overviewGroupedList: {
    gap: 8,
  },

  overviewGroupedCell: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.18)',
    overflow: 'hidden',
  },

  overviewGroupedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },

  overviewRowIconBubble: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.7)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  overviewRowSubtitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 1,
  },

  overviewRowSubtitle: {
    fontSize: 13,
    color: colors.muted,
  },

  overviewDueTodayPillWrap: {
    paddingLeft: 58,
    paddingRight: 14,
    paddingBottom: 12,
    marginTop: -2,
  },

  overviewDueTodayPill: {
    flexDirection: 'row',
    alignSelf: 'flex-start',
    alignItems: 'center',
    gap: 5,
    backgroundColor: colors.card,
    borderRadius: 20,
    paddingVertical: 4,
    paddingHorizontal: 10,
  },

  overviewDueTodayText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.warning,
  },

  projectSelectorBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
  },

  projectSelectorScrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(15, 23, 42, 0.34)',
  },

  projectSelectorSheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingHorizontal: 16,
    paddingTop: 6,
    paddingBottom: 28,
    borderColor: colors.line,
    borderWidth: 1,
    maxHeight: '82%',
  },

  projectSelectorDragHandleArea: {
    minHeight: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },

  projectSelectorHandle: {
    width: 42,
    height: 4,
    borderRadius: 999,
    backgroundColor: colors.line,
    alignSelf: 'center',
  },

  projectSelectorScroll: {
    flexGrow: 0,
    flexShrink: 1,
  },

  projectSelectorScrollContent: {
    paddingTop: 2,
    paddingBottom: 8,
  },

  projectSelectorRow: {
    minHeight: 60,
    borderRadius: 8,
    borderColor: colors.line,
    borderWidth: 1,
    padding: 12,
    marginBottom: 9,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },

  projectSelectorRowSelected: {
    backgroundColor: colors.primarySoft,
    borderColor: colors.primary,
  },

  phase2ProjectCard: {
    minHeight: 116,
    borderRadius: 16,
    padding: 11,
    marginBottom: 12,
    borderColor: colors.line,
    borderWidth: 1,
    backgroundColor: colors.card,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    shadowColor: '#17213A',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },

  phase2ProjectThumb: {
    width: 92,
    height: 92,
    borderRadius: 12,
    backgroundColor: colors.fill,
    resizeMode: 'cover',
  },

  phase2ProjectThumbPlaceholder: {
    width: 92,
    height: 92,
    borderRadius: 12,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },

  phase2ProjectTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 6,
  },

  phase2ProjectTitle: {
    flex: 1,
    color: colors.text,
    fontSize: 16,
    fontWeight: '800',
  },

  phase2ProjectStatusPill: {
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },

  phase2ProjectStatusText: {
    fontSize: 10,
    fontWeight: '900',
  },

  phase2ProjectSummary: {
    color: colors.text,
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 7,
  },

  phase2ProjectActivity: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '600',
  },

  phase2BackButton: {
    alignSelf: 'flex-start',
    minHeight: 44,
    borderRadius: 8,
    borderColor: colors.line,
    borderWidth: 1,
    paddingVertical: 8,
    paddingHorizontal: 10,
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: colors.card,
  },

  phase2ToolsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 14,
  },

  phase2ToolCard: {
    width: '48%',
    minHeight: 112,
    borderRadius: 8,
    borderColor: colors.line,
    borderWidth: 1,
    backgroundColor: colors.card,
    padding: 12,
    justifyContent: 'space-between',
  },

  phase2ToolLabel: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '800',
    marginTop: 8,
  },

  phase3StepRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 14,
  },

  phase3StepPill: {
    flex: 1,
    minHeight: 38,
    borderRadius: 8,
    borderColor: colors.line,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.card,
    paddingHorizontal: 6,
  },

  phase3StepPillActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },

  phase3StepPillComplete: {
    backgroundColor: colors.primarySoft,
    borderColor: colors.primary,
  },

  phase3StepText: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '800',
    textAlign: 'center',
  },

  phase3StepTextActive: {
    color: colors.text,
  },

  phase3MainTitle: {
    color: colors.text,
    fontSize: 24,
    fontWeight: '900',
    marginBottom: 12,
  },

  phase3AutoCard: {
    backgroundColor: colors.card,
    borderRadius: 8,
    padding: 12,
    marginBottom: 14,
    borderColor: colors.line,
    borderWidth: 1,
    gap: 10,
  },

  phase3CompactRow: {
    minHeight: 60,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingBottom: 10,
    borderBottomColor: colors.line,
    borderBottomWidth: 1,
  },

  phase3ChangeButton: {
    minHeight: 44,
    borderRadius: 8,
    backgroundColor: colors.primarySoft,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },

  phase3SummaryCard: {
    backgroundColor: colors.card,
    borderRadius: 8,
    borderColor: colors.line,
    borderWidth: 1,
    padding: 14,
    marginBottom: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
  },

  phase3ThumbRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 14,
  },

  phase3Thumb: {
    width: 76,
    height: 76,
    borderRadius: 8,
    backgroundColor: colors.fill,
  },

  phase3ChipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 9,
    marginBottom: 16,
  },

  phase3ContextChip: {
    minHeight: 44,
    borderRadius: 999,
    borderColor: colors.line,
    borderWidth: 1,
    backgroundColor: colors.card,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },

  phase3ContextChipSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },

  phase3ContextText: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '800',
  },

  phase3ContextTextSelected: {
    color: '#FFFFFF',
  },

  phase4PieCard: {
    backgroundColor: colors.card,
    borderRadius: 8,
    padding: 16,
    marginBottom: 14,
    borderColor: colors.line,
    borderWidth: 1,
  },

  phase4SafetyFinding: {
    backgroundColor: colors.dangerSoft,
    borderColor: '#FFD1D1',
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
    flexDirection: 'row',
    gap: 10,
  },

  phase4SafetyTitle: {
    color: colors.danger,
    fontSize: 16,
    fontWeight: '900',
    marginBottom: 4,
  },

  phase4DetailBlock: {
    borderTopColor: colors.line,
    borderTopWidth: 1,
    marginTop: 10,
    paddingTop: 10,
  },

  pieFindingRow: {
    borderRadius: 8,
    padding: 11,
    marginBottom: 9,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },

  pieInterpretationActionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 8,
  },

  updateTopControlRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },

  updateSearchPanel: {
    backgroundColor: colors.card,
    borderRadius: 16,
    padding: 12,
    marginBottom: 12,
    borderColor: colors.line,
    borderWidth: 1,
    shadowColor: '#17213A',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },

  updateSearchBox: {
    flex: 1,
    backgroundColor: colors.fill,
    borderColor: colors.line,
    borderWidth: 1,
    borderRadius: 12,
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    gap: 8,
  },

  updateFilterButton: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: colors.card,
    borderColor: colors.line,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },

  updateFilterSummary: {
    minHeight: 54,
    borderRadius: 8,
    backgroundColor: colors.card,
    borderColor: colors.line,
    borderWidth: 1,
    padding: 12,
    marginBottom: 12,
  },

  updateSegmentRow: {
    flexDirection: 'row',
    backgroundColor: colors.fill,
    borderRadius: 12,
    borderColor: colors.line,
    borderWidth: 1,
    padding: 4,
    marginBottom: 16,
  },

  updateSegment: {
    flex: 1,
    minHeight: 44,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },

  updateSegmentSelected: {
    backgroundColor: colors.primary,
  },

  updateSegmentText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '800',
    textAlign: 'center',
  },

  updateSegmentTextSelected: {
    color: '#FFFFFF',
  },

  updateCard: {
    backgroundColor: colors.card,
    borderRadius: 16,
    borderColor: colors.line,
    borderWidth: 1,
    padding: 12,
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 118,
    shadowColor: '#17213A',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },

  updateGroupHeader: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '800',
    marginTop: 2,
    marginBottom: 9,
  },

  updateCardMedia: {
    width: 104,
    height: 92,
    position: 'relative',
  },

  updateCardThumb: {
    width: 104,
    height: 92,
    borderRadius: 10,
    backgroundColor: colors.fill,
    resizeMode: 'cover',
  },

  updateCardThumbPlaceholder: {
    width: 104,
    height: 92,
    borderRadius: 10,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },

  updatePhotoStatusPill: {
    position: 'absolute',
    left: 7,
    bottom: 7,
    color: '#FFFFFF',
    backgroundColor: 'rgba(10, 34, 61, 0.86)',
    borderRadius: 999,
    paddingVertical: 4,
    paddingHorizontal: 9,
    fontSize: 11,
    fontWeight: '800',
    overflow: 'hidden',
  },

  updateCardProject: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '800',
    marginBottom: 4,
  },

  updateCardSummary: {
    color: colors.text,
    fontSize: 14,
    lineHeight: 19,
    marginBottom: 8,
  },

  updateCardMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 5,
  },

  updateCardType: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: '800',
  },

  updateCardMetaDot: {
    color: colors.muted,
    fontSize: 12,
  },

  updateCardTime: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '600',
  },

  updateCardActions: {
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'space-between',
  },

  updateEmptyState: {
    backgroundColor: colors.card,
    borderRadius: 16,
    borderColor: colors.line,
    borderWidth: 1,
    padding: 20,
    marginBottom: 16,
    shadowColor: '#17213A',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },

  updateEmptyTitle: {
    color: colors.text,
    fontSize: 19,
    fontWeight: '800',
    marginBottom: 7,
  },

  updateEmptyText: {
    color: colors.muted,
    fontSize: 15,
    lineHeight: 21,
    marginBottom: 14,
  },

  updateEmptyPrompt: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 12,
  },

  updateFooterAction: {
    paddingTop: 4,
    paddingBottom: 6,
  },

  updateOverflowSheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 16,
    borderColor: colors.line,
    borderWidth: 1,
  },

  projectSearchBox: {
    backgroundColor: colors.fill,
    borderColor: colors.line,
    borderWidth: 1,
    borderRadius: 10,
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    gap: 8,
    marginBottom: 12,
  },

  projectSearchInput: {
    flex: 1,
    color: colors.text,
    fontSize: 16,
    fontWeight: '600',
    paddingVertical: 8,
  },

  projectSearchClearButton: {
    width: 44,
    height: 44,
    marginRight: -10,
    alignItems: 'center',
    justifyContent: 'center',
  },

  projectFilterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
  },

  projectFilterChip: {
    backgroundColor: colors.fill,
    borderColor: colors.line,
    borderWidth: 1,
    borderRadius: 999,
    paddingVertical: 8,
    paddingHorizontal: 11,
  },

  projectFilterChipSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },

  projectFilterText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '800',
  },

  projectFilterTextSelected: {
    color: '#FFFFFF',
  },

  projectFinderStatsRow: {
    flexDirection: 'row',
    gap: 8,
  },

  projectFinderRow: {
    backgroundColor: colors.card,
    borderRadius: 11,
    padding: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: colors.line,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },

  favoriteButton: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: colors.fill,
    alignItems: 'center',
    justifyContent: 'center',
  },

  compactStatsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 7,
    marginTop: 8,
  },

  compactStatText: {
    color: colors.muted,
    backgroundColor: colors.fill,
    borderRadius: 999,
    paddingVertical: 4,
    paddingHorizontal: 7,
    fontSize: 11,
    fontWeight: '800',
  },

  compactStatDanger: {
    color: colors.danger,
    backgroundColor: colors.dangerSoft,
  },

  projectFinderActions: {
    alignItems: 'flex-end',
    gap: 7,
  },

  bottomTabs: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: colors.card,
    borderTopColor: colors.line,
    borderTopWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingTop: 8,
    paddingBottom:
      Platform.OS === 'ios' ? 24 : 10,
  },

  newTabButtonText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '800',
    marginTop: 2,
  },

  tabButton: {
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
    gap: 3,
  },

  tabText: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: '700',
  },

  tabTextActive: {
    color: colors.primary,
  },

  newTabButton: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 6,
  },


  dashboardGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 14,
  },

  compactLocationRow: {
    backgroundColor: colors.card,
    borderRadius: 10,
    padding: 12,
    marginBottom: 10,
    borderColor: colors.line,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },

  compactActionColumn: {
    alignItems: 'flex-end',
    gap: 6,
    maxWidth: 96,
  },

  compactInlineAction: {
    borderRadius: 999,
    paddingVertical: 5,
    paddingHorizontal: 9,
    backgroundColor: colors.primarySoft,
  },

  compactInlineActionText: {
    color: colors.primary,
    fontSize: 11,
    fontWeight: '800',
  },

  scheduleMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
    flexWrap: 'wrap',
  },
  statusPill: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  statusPillText: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: '800',
  },
  percentText: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: '900',
  },
  progressTrack: {
    height: 8,
    borderRadius: 999,
    backgroundColor: colors.line,
    overflow: 'hidden',
    marginTop: 8,
  },
  progressFill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: colors.primary,
  },

});

type ScheduleStatus =
  | 'Not Started'
  | 'In Progress'
  | 'Waiting'
  | 'Complete';

type SchedulePriority = 'Low' | 'Medium' | 'High';

type ScheduleItem = {
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
