import { loadCloudProjects, saveCloudProject } from './services/projectService';
import { loadCloudUpdates, saveCloudUpdate } from './services/updateService';
import { BottomNavigation } from './components/BottomNavigation';
import { HomeDashboard } from './components/HomeDashboard';
import { PhotoPreviewModal } from './components/PhotoPreviewModal';
import { ProjectSelector } from './components/ProjectSelector';
import { ScreenScroll } from './components/ScreenScroll';
import {
  AddPhotosScreen,
  BuildUpdateScreen,
} from './screens/BuildUpdateScreen';
import { AIExecutiveBriefScreen } from './screens/AIExecutiveBriefScreen';
import { AIProjectCoachScreen } from './screens/AIProjectCoachScreen';
import { ConstructionTimelineScreen } from './screens/ConstructionTimelineScreen';
import { ContactsScreen } from './screens/ContactsScreen';
import { DiagnosticsScreen } from './screens/DiagnosticsScreen';
import { DocumentsScreen } from './screens/DocumentsScreen';
import { ExecutiveKPIDashboardScreen } from './screens/ExecutiveKPIDashboardScreen';
import { HistoryScreen } from './screens/HistoryScreen';
import { ProjectHealthDashboard } from './screens/ProjectHealthDashboard';
import { ProjectRiskMatrixScreen } from './screens/ProjectRiskMatrixScreen';
import { ProjectsScreen } from './screens/ProjectsScreen';
import { ScheduleScreen } from './screens/ScheduleScreen';
import { UpcomingScreen } from './screens/UpcomingScreen';
import { WeeklyExecutiveReportScreen } from './screens/WeeklyExecutiveReportScreen';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Clipboard from 'expo-clipboard';
import * as Contacts from 'expo-contacts';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import * as MailComposer from 'expo-mail-composer';
import * as Sharing from 'expo-sharing';
import * as SMS from 'expo-sms';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Linking,
  Platform,
  StyleSheet,
  View,
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
  | 'BuildUpdate'
  | 'Projects'
  | 'SavedUpdates'
  | 'Contacts'
  | 'Diagnostics'
  | 'ReferenceDocuments'
  | 'Schedule'
  | 'Upcoming'
  | 'AIProjectCoach'
  | 'AIExecutiveBrief'
  | 'ProjectHealthDashboard'
  | 'WeeklyExecutiveReport'
  | 'ExecutiveKPIDashboard'
  | 'ConstructionTimeline'
  | 'ProjectRiskMatrix';

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
};

type ProjectUpdate = {
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

type AppBackup = {
  version: number;
  exportedAt: string;
  savedUpdates: ProjectUpdate[];
  projects: string[];
  archivedProjects: string[];
  contacts: ContactBook;
  projectAreas: ProjectArea[];
  referenceDocuments: ReferenceDocument[];
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
const PROJECTS_STORAGE_KEY = 'projectPhotoUpdate.projects.v2';
const ARCHIVED_PROJECTS_STORAGE_KEY = 'projectPhotoUpdate.archivedProjects.v2';
const CONTACTS_STORAGE_KEY = 'projectPhotoUpdate.contacts.v2';
const DRAFT_STORAGE_KEY = 'projectPhotoUpdate.activeDraft.v2';
const PROJECT_AREAS_STORAGE_KEY = 'projectPhotoUpdate.projectAreas.v1';
const REFERENCE_DOCUMENTS_STORAGE_KEY = 'projectPhotoUpdate.referenceDocuments.v1';
const SCHEDULE_ITEMS_STORAGE_KEY = 'projectPhotoUpdate.scheduleItems.v1';
const SCHEDULE_AI_EXTRACTOR_URL_STORAGE_KEY = 'projectPhotoUpdate.scheduleAiExtractorUrl.v1';
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
  return {
    id: uid(),
    projectName,
    date: isoToday(),
    photos: [],
    notes: '',
    recipients: emptyRecipients(),
  };
}

function hasMeaningfulDraft(update: ProjectUpdate) {
  return (
    update.photos.length > 0 ||
    update.notes.trim().length > 0 ||
    update.recipients.contactIds.length > 0
  );
}

function hasDraftContent(update: ProjectUpdate) {
  return update.photos.length > 0 || update.notes.trim().length > 0;
}

function formatDisplayDate(date: string) {
  const [year, month, day] = date.split('-').map(Number);

  return new Date(year, month - 1, day).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
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

function mergeProjectNames(base: string[], ...lists: string[][]) {
  const names: string[] = [];

  [...lists.slice().reverse().flat(), ...base].forEach(name => {
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
  };
}

function normalizeUpdate(update: Partial<ProjectUpdate>): ProjectUpdate {
  return {
    id: typeof update.id === 'string' ? update.id : uid(),
    projectName:
      typeof update.projectName === 'string'
        ? update.projectName
        : DEFAULT_PROJECTS[0],
    date: typeof update.date === 'string' ? update.date : isoToday(),
    photos: Array.isArray(update.photos)
      ? update.photos.map(normalizePhoto).filter(photo => photo.uri)
      : [],
    notes: typeof update.notes === 'string' ? update.notes : '',
    recipients: normalizeRecipientSelection(update.recipients),
    selectedAreaId: optionalString(update.selectedAreaId),
    selectedAreaName: optionalString(update.selectedAreaName),
    gpsLatitude: optionalNumber(update.gpsLatitude),
    gpsLongitude: optionalNumber(update.gpsLongitude),
    gpsAccuracy: optionalNumber(update.gpsAccuracy),
    distanceFromSelectedAreaFeet: optionalNumber(
      update.distanceFromSelectedAreaFeet,
    ),
    locationCapturedAt: optionalString(update.locationCapturedAt),
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
    update.notes.trim().length > 0 ||
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
  const savedLocationAreas = projectAreas.filter(hasSavedAreaLocation);

  if (!currentLocation || savedLocationAreas.length === 0) return null;

  const suggestions = savedLocationAreas
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

  return suggestions[0] || null;
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
          ? ` Confidence: ${item.confidence.trim()}.`
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
    const stats =
      statsByProject[update.projectName] ||
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

    statsByProject[update.projectName] = stats;
  });

  return statsByProject;
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

  const [savedUpdates, setSavedUpdates] = useState<ProjectUpdate[]>([]);

  const [projects, setProjects] =
    useState<string[]>(DEFAULT_PROJECTS);

  const [archivedProjects, setArchivedProjects] =
    useState<string[]>([]);

  const [projectAreas, setProjectAreas] =
    useState<ProjectArea[]>(DEFAULT_PROJECT_AREAS);

  const [referenceDocuments, setReferenceDocuments] =
    useState<ReferenceDocument[]>([]);

  const [scheduleItems, setScheduleItems] =
    useState<ScheduleItem[]>([]);

  const [scheduleAiExtractorUrl, setScheduleAiExtractorUrl] =
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

  const [draftSavedAt, setDraftSavedAt] =
    useState<string | null>(null);

  const [updatesLoaded, setUpdatesLoaded] =
    useState(false);

  const [projectsLoaded, setProjectsLoaded] =
    useState(false);

  const [archivedProjectsLoaded, setArchivedProjectsLoaded] =
    useState(false);

  const [projectAreasLoaded, setProjectAreasLoaded] =
    useState(false);

  const [referenceDocumentsLoaded, setReferenceDocumentsLoaded] =
    useState(false);

  const [scheduleItemsLoaded, setScheduleItemsLoaded] =
    useState(false);

  const [scheduleAiExtractorUrlLoaded, setScheduleAiExtractorUrlLoaded] =
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

  const photoCleanupRan = useRef(false);

useEffect(() => {
  async function loadSavedUpdates() {
    try {
      const localValue = await AsyncStorage.getItem(UPDATES_STORAGE_KEY);
      const localParsed = localValue ? JSON.parse(localValue) : [];
      const localUpdates = Array.isArray(localParsed)
        ? localParsed.map(normalizeUpdate)
        : [];

      const cloudUpdates = await loadCloudUpdates<ProjectUpdate>();

      const merged = [
        ...cloudUpdates.map(normalizeUpdate),
        ...localUpdates,
      ];
      const seen = new Set<string>();
      const deduped = merged.filter(update => {
        if (seen.has(update.id)) return false;
        seen.add(update.id);
        return true;
      });

      setSavedUpdates(deduped);
    } catch {
      Alert.alert(
        'Storage error',
        'Saved updates could not be loaded.',
      );
    } finally {
      setUpdatesLoaded(true);
    }
  }

  void loadSavedUpdates();
}, []);

useEffect(() => {
  async function loadProjects() {
    try {
      const localValue = await AsyncStorage.getItem(PROJECTS_STORAGE_KEY);
      const localProjects = localValue ? JSON.parse(localValue) : [];
      const cloudProjects = await loadCloudProjects();

      setProjects(
        mergeProjectNames(
          DEFAULT_PROJECTS,
          Array.isArray(localProjects) ? localProjects : [],
          cloudProjects,
        ),
      );
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

    AsyncStorage.setItem(
      UPDATES_STORAGE_KEY,
      JSON.stringify(savedUpdates),
    ).catch(() => undefined);
  }, [savedUpdates, updatesLoaded]);

  useEffect(() => {
    if (!projectsLoaded) return;

    AsyncStorage.setItem(
      PROJECTS_STORAGE_KEY,
      JSON.stringify(projects),
    ).catch(() => undefined);
  }, [projects, projectsLoaded]);

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

  function applyAreaAndLocationToDraft(
    area: ProjectArea | null,
    snapshot?: LocationSnapshot | null,
  ) {
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

      return {
        ...prev,
        ...locationFields,
        photos: prev.photos.map(photo => ({
          ...photo,
          ...locationFields,
        })),
      };
    });
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
            void captureDraftLocation();
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
      setLocationStatus('GPS Captured');

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

  function createNewUpdate(projectName?: string) {
    const target = projectName || activeProjects[0];

    if (!target) {
      Alert.alert(
        'No active projects',
        'Add a new project or reopen an archived project first.',
      );

      setScreen('Projects');

      return;
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

              setDraft(createDraft(target));
              setScreen('AddPhotos');

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

    setDraft(createDraft(target));
    setScreen('AddPhotos');
  }

  function resumeDraft() {
    setScreen(
      draft.photos.length > 0
        ? 'AddPhotos'
        : 'BuildUpdate',
    );
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
    setDraft(prev => ({
      ...prev,
      projectName,
    }));
    setScreen('AddPhotos');
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
          photos.push(await photoFromAsset(asset));
        }

        setDraft(prev => ({
          ...prev,
          photos: [...prev.photos, ...photos],
        }));
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
          photos.push(await photoFromAsset(asset));
        }

        setDraft(prev => ({
          ...prev,
          photos: [...prev.photos, ...photos],
        }));
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
      `${message.subject}\n\n${message.body}`,
    );

    Alert.alert(
      'Copied',
      'The update message is ready to paste.',
    );
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
              setScreen('BuildUpdate');

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
    setScreen('BuildUpdate');
  }

  function deleteSavedUpdate(updateId: string) {
    Alert.alert(
      'Delete saved update?',
      'This removes the saved copy from this phone.',
      [
        {
          text: 'Cancel',
          style: 'cancel',
        },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            const deletedUpdate = savedUpdates.find(
              update => update.id === updateId,
            );
            const remainingUpdates = savedUpdates.filter(
              update => update.id !== updateId,
            );

            setSavedUpdates(remainingUpdates);

            if (deletedUpdate) {
              void deleteUnreferencedPhotosFromUpdate(
                deletedUpdate,
                [draft, ...remainingUpdates],
              );
            }
          },
        },
      ],
    );
  }

  function requestBuildUpdate() {
    if (draft.photos.length === 0) {
      setScreen('BuildUpdate');

      return;
    }

    if (
      draft.photos.some(photo =>
        photo.caption.trim(),
      )
    ) {
      setScreen('BuildUpdate');

      return;
    }

    Alert.alert(
      'No captions yet',
      'Build the update anyway, or add captions first?',
      [
        {
          text: 'Add Captions',
          style: 'cancel',
        },
        {
          text: 'Build Update',
          onPress: () =>
            setScreen('BuildUpdate'),
        },
      ],
    );
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

  return (
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
            <HomeDashboard
              contentStyle={contentStyle}
              projects={activeProjects}
              savedUpdates={savedUpdates}
              projectStatsByName={projectStatsByName}
              unfinishedDraft={unfinishedDraft}
              draftSavedAt={draftSavedAt}
              referenceDocumentCount={referenceDocuments.length}
              onResumeDraft={resumeDraft}
              onDiscardDraft={discardDraft}
              onNewUpdate={() => createNewUpdate()}
              onUpdateProject={createNewUpdate}
              onViewProjects={() => setScreen('Projects')}
              onReferenceDocuments={() => setScreen('ReferenceDocuments')}
              onSchedule={() => setScreen('Schedule')}
              onAIProjectCoach={() => setScreen('AIProjectCoach')}
              onAIExecutiveBrief={() => setScreen('AIExecutiveBrief')}
              onProjectHealthDashboard={() => setScreen('ProjectHealthDashboard')}
              onWeeklyExecutiveReport={() => setScreen('WeeklyExecutiveReport')}
              onExecutiveKPIDashboard={() => setScreen('ExecutiveKPIDashboard')}
              onConstructionTimeline={() => setScreen('ConstructionTimeline')}
              onProjectRiskMatrix={() => setScreen('ProjectRiskMatrix')}
            />
          )}

          {screen === 'SelectProject' && (
            <ProjectSelector
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
              locationStatus={locationStatus}
              recipientCount={
                currentContacts.length
              }
              draftSavedAt={draftSavedAt}
              onPickPhotos={pickPhotos}
              onTakePhoto={takePhoto}
              onUpdatePhoto={updatePhoto}
              onRemovePhoto={removePhoto}
              onMovePhoto={movePhoto}
              onPreviewPhoto={setPreviewPhoto}
              onNext={requestBuildUpdate}
              onChangeProject={() =>
                setScreen('SelectProject')
              }
              onContacts={openContacts}
              onConfirmArea={confirmSuggestedArea}
              onChangeArea={changeDraftArea}
              onRefreshLocation={() => {
                void refreshDraftLocation();
              }}
            />
          )}

          {screen === 'BuildUpdate' && (
            <ScreenScroll contentStyle={contentStyle}>
              <BuildUpdateScreen
                update={draft}
                projectAreas={projectAreas}
                selectedArea={currentDraftArea}
                areaSuggestion={draftAreaSuggestion}
                locationStatus={locationStatus}
                subject={message.subject}
                body={message.body}
                contacts={currentContacts}
                draftSavedAt={draftSavedAt}
                onNotesChange={notes =>
                  setDraft(prev => ({
                    ...prev,
                    notes,
                  }))
                }
                onSendEmail={sendEmail}
                onSendText={sendText}
                onCopy={copyMessage}
                onSave={saveUpdate}
                onEditPhotos={() =>
                  setScreen('AddPhotos')
                }
                onContacts={openContacts}
                onConfirmArea={confirmSuggestedArea}
                onChangeArea={changeDraftArea}
                onRefreshLocation={() => {
                  void refreshDraftLocation();
                }}
              />
            </ScreenScroll>
          )}

          {screen === 'Projects' && (
            <ProjectsScreen
              contentStyle={contentStyle}
              activeProjects={activeProjects}
              archivedProjects={
                archivedProjects
              }
              savedUpdates={savedUpdates}
              projectStatsByName={projectStatsByName}
              onSelect={createNewUpdate}
              onAddProject={addProject}
              onCloseProject={closeProject}
              onReopenProject={reopenProject}
              onBackup={exportBackup}
              onRestore={restoreBackup}
              projectAreas={projectAreas}
              onAddArea={addProjectArea}
              onUpdateArea={updateProjectArea}
              onDeleteArea={deleteProjectArea}
              onUseCurrentLocationForArea={
                useCurrentLocationForArea
              }
              onDiagnostics={() => setScreen('Diagnostics')}
              onReferenceDocuments={() => setScreen('ReferenceDocuments')}
              onSchedule={() => setScreen('Schedule')}
              onConstructionTimeline={() => setScreen('ConstructionTimeline')}
            />
          )}

          {screen === 'ReferenceDocuments' && (
            <DocumentsScreen
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
              onSchedule={() => setScreen('Schedule')}
              onNewUpdate={() => createNewUpdate()}
            />
          )}

          {screen === 'AIProjectCoach' && (
            <ScreenScroll contentStyle={contentStyle}>
              <AIProjectCoachScreen
                projectName={draft.projectName}
                updates={savedUpdates}
                scheduleItems={scheduleItems}
                currentUpdate={draft}
                onBack={() => setScreen('Home')}
                onProjectRiskMatrix={() => setScreen('ProjectRiskMatrix')}
              />
            </ScreenScroll>
          )}

          {screen === 'AIExecutiveBrief' && (
            <ScreenScroll contentStyle={contentStyle}>
              <AIExecutiveBriefScreen
                projectName={draft.projectName}
                updates={savedUpdates}
                scheduleItems={scheduleItems}
                currentUpdate={draft}
                onBack={() => setScreen('Home')}
                onWeeklyExecutiveReport={() => setScreen('WeeklyExecutiveReport')}
                onExecutiveKPIDashboard={() => setScreen('ExecutiveKPIDashboard')}
              />
            </ScreenScroll>
          )}

          {screen === 'ExecutiveKPIDashboard' && (
            <ExecutiveKPIDashboardScreen
              contentStyle={contentStyle}
              projects={activeProjects}
              savedUpdates={savedUpdates}
              scheduleItems={scheduleItems}
              referenceDocuments={referenceDocuments}
              currentUpdate={draft}
              onBack={() => setScreen('Home')}
              onProjectHealthDashboard={() => setScreen('ProjectHealthDashboard')}
              onExecutiveBrief={() => setScreen('AIExecutiveBrief')}
              onWeeklyReport={() => setScreen('WeeklyExecutiveReport')}
              onConstructionTimeline={() => setScreen('ConstructionTimeline')}
              onProjectRiskMatrix={() => setScreen('ProjectRiskMatrix')}
            />
          )}

          {screen === 'ProjectRiskMatrix' && (
            <ProjectRiskMatrixScreen
              contentStyle={contentStyle}
              projects={activeProjects}
              savedUpdates={savedUpdates}
              scheduleItems={scheduleItems}
              referenceDocuments={referenceDocuments}
              currentUpdate={draft}
              onBack={() => setScreen('Home')}
              onProjectHealthDashboard={() => setScreen('ProjectHealthDashboard')}
              onExecutiveKPIDashboard={() => setScreen('ExecutiveKPIDashboard')}
              onAIProjectCoach={() => setScreen('AIProjectCoach')}
            />
          )}

          {screen === 'ConstructionTimeline' && (
            <ConstructionTimelineScreen
              contentStyle={contentStyle}
              projects={activeProjects}
              savedUpdates={savedUpdates}
              scheduleItems={scheduleItems}
              referenceDocuments={referenceDocuments}
              currentUpdate={draft}
              onBack={() => setScreen('Home')}
              onProjectHealthDashboard={() => setScreen('ProjectHealthDashboard')}
              onExecutiveKPIDashboard={() => setScreen('ExecutiveKPIDashboard')}
            />
          )}

          {screen === 'WeeklyExecutiveReport' && (
            <WeeklyExecutiveReportScreen
              contentStyle={contentStyle}
              projects={activeProjects}
              savedUpdates={savedUpdates}
              scheduleItems={scheduleItems}
              referenceDocuments={referenceDocuments}
              currentUpdate={draft}
              onBack={() => setScreen('Home')}
            />
          )}

          {screen === 'ProjectHealthDashboard' && (
            <ProjectHealthDashboard
              contentStyle={contentStyle}
              projects={activeProjects}
              savedUpdates={savedUpdates}
              scheduleItems={scheduleItems}
              referenceDocuments={referenceDocuments}
              currentUpdate={draft}
              onBack={() => setScreen('Home')}
              onAIProjectCoach={() => setScreen('AIProjectCoach')}
              onExecutiveBrief={() => setScreen('AIExecutiveBrief')}
              onWeeklyReport={() => setScreen('WeeklyExecutiveReport')}
              onExecutiveKPIDashboard={() => setScreen('ExecutiveKPIDashboard')}
              onConstructionTimeline={() => setScreen('ConstructionTimeline')}
              onProjectRiskMatrix={() => setScreen('ProjectRiskMatrix')}
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
            <HistoryScreen
              contentStyle={contentStyle}
              updates={savedUpdates}
              projectAreas={projectAreas}
              onOpen={openSavedUpdate}
              onDelete={deleteSavedUpdate}
              onNewUpdate={() =>
                createNewUpdate()
              }
            />
          )}

          <PhotoPreviewModal
            photo={previewPhoto}
            onClose={() => setPreviewPhoto(null)}
          />

          <BottomNavigation
            current={screen}
            onChange={setScreen}
            onNew={() => createNewUpdate()}
          />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const colors = {
  bg: '#F5F5F7',
};

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
