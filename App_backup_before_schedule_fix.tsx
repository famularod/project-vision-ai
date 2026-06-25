import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
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
import type { ReactNode } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Linking,
  Modal,
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
  | 'BuildUpdate'
  | 'Projects'
  | 'SavedUpdates'
  | 'Contacts'
  | 'Diagnostics'
  | 'ReferenceDocuments'
  | 'Schedule'
  | 'Upcoming';

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

function mergeProjectNames(base: string[], saved: string[]) {
  const names: string[] = [];

  [...saved, ...base].forEach(name => {
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

function normalizeAiScheduleDate(value: unknown) {
  if (typeof value !== 'string') return '';

  const trimmed = value.trim();

  if (!trimmed) return '';

  const parsed = parseFlexibleDate(trimmed);

  if (!parsed) return '';

  return formatAppDate(parsed);
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

  const pdfBase64 = await FileSystem.readAsStringAsync(pdfUri, {
    encoding: FileSystem.EncodingType.Base64,
  });

  const response = await fetch(trimmedEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      fileName,
      mimeType: 'application/pdf',
      fileBase64: pdfBase64,
      instruction:
        'Extract Gantt schedule tasks and milestones. Return strict JSON with an items array. Each item should include taskName, projectName, locationName, startDate, finishDate, milestone, owner, status, and notes. Dates should be MM/DD/YYYY when possible.',
      knownProjects: projects,
      knownLocations: projectAreas.map(area => area.name),
    }),
  });

  if (!response.ok) {
    throw new Error(`AI extractor failed with HTTP ${response.status}`);
  }

  const payload = await response.json();

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
    AsyncStorage.getItem(UPDATES_STORAGE_KEY)
      .then(value => {
        if (!value) return;

        const parsed = JSON.parse(value);

        setSavedUpdates(
          Array.isArray(parsed)
            ? parsed.map(normalizeUpdate)
            : [],
        );
      })
      .catch(() =>
        Alert.alert(
          'Storage error',
          'Saved updates could not be loaded.',
        ),
      )
      .finally(() => setUpdatesLoaded(true));
  }, []);

  useEffect(() => {
    AsyncStorage.getItem(PROJECTS_STORAGE_KEY)
      .then(value => {
        if (!value) return;

        const parsed = JSON.parse(value);

        if (Array.isArray(parsed)) {
          setProjects(
            mergeProjectNames(DEFAULT_PROJECTS, parsed),
          );
        }
      })
      .catch(() =>
        Alert.alert(
          'Storage error',
          'Saved projects could not be loaded.',
        ),
      )
      .finally(() => setProjectsLoaded(true));
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

    return true;
  }

  function changeDraftProject(projectName: string) {
    setDraft(prev => ({
      ...prev,
      projectName,
    }));
    setScreen('AddPhotos');
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

    setSavedUpdates(prev => {
      const saved = {
        ...draft,
        id: draft.id || uid(),
      };

      return [
        saved,
        ...prev.filter(
          item => item.id !== saved.id,
        ),
      ];
    });

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
            <HomeScreen
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
              onSchedule={() => setScreen('Schedule')}
              onNewUpdate={() => createNewUpdate()}
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
            <SavedUpdatesScreen
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

          <BottomTabs
            current={screen}
            onChange={setScreen}
            onNew={() => createNewUpdate()}
          />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
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

function HomeScreen({
  contentStyle,
  projects,
  savedUpdates,
  projectStatsByName,
  unfinishedDraft,
  draftSavedAt,
  referenceDocumentCount,
  onResumeDraft,
  onDiscardDraft,
  onNewUpdate,
  onUpdateProject,
  onViewProjects,
  onReferenceDocuments,
  onSchedule,
}: {
  contentStyle: StyleProp<ViewStyle>;
  projects: string[];
  savedUpdates: ProjectUpdate[];
  projectStatsByName: Record<string, ProjectStats>;
  unfinishedDraft: ProjectUpdate | null;
  draftSavedAt: string | null;
  referenceDocumentCount: number;
  onResumeDraft: () => void;
  onDiscardDraft: () => void;
  onNewUpdate: () => void;
  onUpdateProject: (projectName: string) => void;
  onViewProjects: () => void;
  onReferenceDocuments: () => void;
  onSchedule: () => void;
}) {
  const totals = projects.reduce(
    (summary, project) => {
      const stats = projectStatsByName[project] || EMPTY_PROJECT_STATS;

      summary.updates += stats.updates;
      summary.photos += stats.photos;
      summary.openActions += stats.openActions;
      summary.overdueActions += stats.overdueActions;
      summary.dueThisWeek += stats.dueThisWeek;

      return summary;
    },
    {
      updates: 0,
      photos: 0,
      openActions: 0,
      overdueActions: 0,
      dueThisWeek: 0,
    },
  );

  const projectsNeedingAttention = projects
    .map(project => ({
      project,
      stats: projectStatsByName[project] || EMPTY_PROJECT_STATS,
    }))
    .filter(
      item =>
        item.stats.overdueActions > 0 ||
        item.stats.openActions > 0 ||
        item.stats.dueThisWeek > 0,
    )
    .sort((a, b) => {
      if (b.stats.overdueActions !== a.stats.overdueActions) {
        return b.stats.overdueActions - a.stats.overdueActions;
      }

      if (b.stats.dueThisWeek !== a.stats.dueThisWeek) {
        return b.stats.dueThisWeek - a.stats.dueThisWeek;
      }

      return b.stats.openActions - a.stats.openActions;
    })
    .slice(0, 5);

  const recentUpdates = savedUpdates.slice(0, 5);

  return (
    <ScrollView
      style={styles.appFrame}
      contentContainerStyle={contentStyle}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.headerCompact}>
        <Text style={styles.kicker}>
          Project Photo Update Tool
        </Text>

        <Text style={styles.title}>
          Dashboard
        </Text>

        <Text style={styles.subtitle}>
          What needs attention right now.
        </Text>
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

      <View style={styles.dashboardSummaryCard}>
        <View style={styles.dashboardSummaryHeader}>
          <View>
            <Text style={styles.panelTitle}>
              Executive Summary
            </Text>

            <Text style={styles.bodyText}>
              {projects.length} active project
              {projects.length === 1 ? '' : 's'} under management
            </Text>
          </View>

          <TouchableOpacity
            style={styles.dashboardManageButton}
            onPress={onViewProjects}
          >
            <Text style={styles.dashboardManageText}>
              Manage
            </Text>
          </TouchableOpacity>
        </View>

        <View style={styles.dashboardMetricGrid}>
          <DashboardMetric
            label="Open Issues"
            value={totals.openActions}
            icon="alert-circle-outline"
            danger={totals.openActions > 0}
          />

          <DashboardMetric
            label="Overdue"
            value={totals.overdueActions}
            icon="time-outline"
            danger={totals.overdueActions > 0}
          />

          <DashboardMetric
            label="Due 7 Days"
            value={totals.dueThisWeek}
            icon="calendar-outline"
          />

          <DashboardMetric
            label="Photos"
            value={totals.photos}
            icon="images-outline"
          />

          <DashboardMetric
            label="Updates"
            value={totals.updates}
            icon="document-text-outline"
          />

          <DashboardMetric
            label="Documents"
            value={referenceDocumentCount}
            icon="documents-outline"
          />
        </View>
      </View>

      <Text style={styles.sectionLabel}>
        Quick Actions
      </Text>

      <View style={styles.quickActionGrid}>
        <QuickActionButton
          label="New Update"
          icon="camera-outline"
          onPress={onNewUpdate}
          primary
        />

        <QuickActionButton
          label="Find Project"
          icon="search-outline"
          onPress={onViewProjects}
        />

        <QuickActionButton
          label="Documents"
          icon="documents-outline"
          onPress={onReferenceDocuments}
        />

        <QuickActionButton
          label="Schedule"
          icon="calendar-outline"
          onPress={onSchedule}
        />
      </View>

      <Text style={styles.sectionLabel}>
        Projects Needing Attention
      </Text>

      {projectsNeedingAttention.length === 0 ? (
        <EmptyState
          title="No urgent project items"
          text="Open issues, overdue items, and due-this-week actions will appear here."
        />
      ) : (
        projectsNeedingAttention.map(item => (
          <ProjectAttentionCard
            key={item.project}
            project={item.project}
            stats={item.stats}
            onPress={() => onUpdateProject(item.project)}
          />
        ))
      )}

      <Text style={styles.sectionLabel}>
        Recent Activity
      </Text>

      {recentUpdates.length === 0 ? (
        <EmptyState
          title="No updates yet"
          text="Create the first project update to start building project history."
        />
      ) : (
        recentUpdates.map(update => (
          <ActivityRow
            key={update.id}
            update={update}
          />
        ))
      )}
    </ScrollView>
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
        projectStatsByName[project] || EMPTY_PROJECT_STATS
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
          title="No active projects"
          text="Add a project manually to start an update."
        />
      }
    />
  );
}

function AddPhotosScreen({
  contentStyle,
  update,
  projectAreas,
  selectedArea,
  areaSuggestion,
  locationStatus,
  recipientCount,
  draftSavedAt,
  onPickPhotos,
  onTakePhoto,
  onUpdatePhoto,
  onRemovePhoto,
  onMovePhoto,
  onPreviewPhoto,
  onNext,
  onChangeProject,
  onContacts,
  onConfirmArea,
  onChangeArea,
  onRefreshLocation,
}: {
  contentStyle: StyleProp<ViewStyle>;
  update: ProjectUpdate;
  projectAreas: ProjectArea[];
  selectedArea: ProjectArea | null;
  areaSuggestion: AreaSuggestion | null;
  locationStatus: string | null;
  recipientCount: number;
  draftSavedAt: string | null;
  onPickPhotos: () => void;
  onTakePhoto: () => void;
  onUpdatePhoto: (
    photoId: string,
    next: Partial<UpdatePhoto>,
  ) => void;
  onRemovePhoto: (photoId: string) => void;
  onMovePhoto: (
    photoId: string,
    direction: 'up' | 'down',
  ) => void;
  onPreviewPhoto: (photo: UpdatePhoto) => void;
  onNext: () => void;
  onChangeProject: () => void;
  onContacts: () => void;
  onConfirmArea: () => void;
  onChangeArea: (areaId: string) => void;
  onRefreshLocation: () => void;
}) {
  const captionedCount = update.photos.filter(
    photo => photo.caption.trim(),
  ).length;

  const renderPhoto = ({
    item: photo,
    index,
  }: {
    item: UpdatePhoto;
    index: number;
  }) => (
    <PhotoCard
      photo={photo}
      index={index}
      onUpdate={next =>
        onUpdatePhoto(photo.id, next)
      }
      onRemove={() =>
        onRemovePhoto(photo.id)
      }
      onMoveUp={() =>
        onMovePhoto(photo.id, 'up')
      }
      onMoveDown={() =>
        onMovePhoto(photo.id, 'down')
      }
      onPreview={() =>
        onPreviewPhoto(photo)
      }
      canMoveUp={index > 0}
      canMoveDown={
        index < update.photos.length - 1
      }
    />
  );

  return (
    <FlatList
      style={styles.appFrame}
      contentContainerStyle={contentStyle}
      keyboardShouldPersistTaps="handled"
      data={update.photos}
      keyExtractor={photo => photo.id}
      renderItem={renderPhoto}
      ListHeaderComponent={
        <>
          <ScreenTitle
            title="Add Photos"
            subtitle={update.projectName}
          />

          <DraftSavedIndicator
            savedAt={draftSavedAt}
          />

          <ProjectAreaPanel
            update={update}
            projectAreas={projectAreas}
            selectedArea={selectedArea}
            areaSuggestion={areaSuggestion}
            locationStatus={locationStatus}
            onConfirmArea={onConfirmArea}
            onChangeArea={onChangeArea}
            onRefreshLocation={onRefreshLocation}
          />

          <View style={styles.contactSummary}>
            <Ionicons
              name="people-outline"
              size={18}
              color={colors.primary}
            />

            <Text style={styles.contactSummaryText}>
              {recipientCount} recipient
              {recipientCount === 1 ? '' : 's'} selected
            </Text>

            <TouchableOpacity onPress={onContacts}>
              <Text
                style={styles.contactSummaryAction}
              >
                Select
              </Text>
            </TouchableOpacity>
          </View>

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

          <TouchableOpacity
            style={styles.inlineLink}
            onPress={onChangeProject}
          >
            <Ionicons
              name="swap-horizontal-outline"
              size={17}
              color={colors.primary}
            />

            <Text style={styles.inlineLinkText}>
              Change Project
            </Text>
          </TouchableOpacity>

          <View style={styles.progressPanel}>
            <ProgressStat
              number={update.photos.length}
              label="Photos"
            />

            <View style={styles.progressDivider} />

            <ProgressStat
              number={captionedCount}
              label="Captioned"
            />
          </View>

          {update.photos.length > 0 ? (
            <PrimaryButton
              label="Build Update"
              icon="document-text-outline"
              onPress={onNext}
            />
          ) : null}
        </>
      }
      ListEmptyComponent={
        <EmptyState
          title="No photos yet"
          text="Add photos, or continue without photos and write the update notes."
        />
      }
      ListFooterComponent={
        <PrimaryButton
          label={
            update.photos.length === 0
              ? 'Continue Without Photos'
              : 'Build Update'
          }
          icon="document-text-outline"
          onPress={onNext}
        />
      }
    />
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
          ? `GPS Captured${
              update.gpsAccuracy
                ? ` | Accuracy ${formatFeet(update.gpsAccuracy)}`
                : ''
            }`
          : locationStatus || 'GPS not captured yet'}
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
  photo,
  index,
  onUpdate,
  onRemove,
  onMoveUp,
  onMoveDown,
  onPreview,
  canMoveUp,
  canMoveDown,
}: {
  photo: UpdatePhoto;
  index: number;
  onUpdate: (
    next: Partial<UpdatePhoto>,
  ) => void;
  onRemove: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onPreview: () => void;
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

function BuildUpdateScreen({
  update,
  projectAreas,
  selectedArea,
  areaSuggestion,
  locationStatus,
  subject,
  body,
  contacts,
  draftSavedAt,
  onNotesChange,
  onSendEmail,
  onSendText,
  onCopy,
  onSave,
  onEditPhotos,
  onContacts,
  onConfirmArea,
  onChangeArea,
  onRefreshLocation,
}: {
  update: ProjectUpdate;
  projectAreas: ProjectArea[];
  selectedArea: ProjectArea | null;
  areaSuggestion: AreaSuggestion | null;
  locationStatus: string | null;
  subject: string;
  body: string;
  contacts: ProjectContact[];
  draftSavedAt: string | null;
  onNotesChange: (notes: string) => void;
  onSendEmail: () => void;
  onSendText: () => void;
  onCopy: () => void;
  onSave: () => void;
  onEditPhotos: () => void;
  onContacts: () => void;
  onConfirmArea: () => void;
  onChangeArea: (areaId: string) => void;
  onRefreshLocation: () => void;
}) {
  const hasPhotos = update.photos.length > 0;

  const emailCount = contacts.filter(
    contact => contact.email.trim(),
  ).length;

  const phoneCount = contacts.filter(
    contact => contact.phone.trim(),
  ).length;

  return (
    <View>
      <ScreenTitle
        title="Build Update"
        subtitle={
          hasPhotos
            ? `${update.projectName} - ${update.photos.length} photos`
            : `${update.projectName} - no photos`
        }
      />

      <DraftSavedIndicator
        savedAt={draftSavedAt}
      />

      <ProjectAreaPanel
        update={update}
        projectAreas={projectAreas}
        selectedArea={selectedArea}
        areaSuggestion={areaSuggestion}
        locationStatus={locationStatus}
        onConfirmArea={onConfirmArea}
        onChangeArea={onChangeArea}
        onRefreshLocation={onRefreshLocation}
      />

      <View style={styles.contactSummary}>
        <Ionicons
          name="people-outline"
          size={18}
          color={colors.primary}
        />

        <Text style={styles.contactSummaryText}>
          Selected: {emailCount} email |{' '}
          {phoneCount} text
        </Text>

        <TouchableOpacity onPress={onContacts}>
          <Text
            style={styles.contactSummaryAction}
          >
            Select
          </Text>
        </TouchableOpacity>
      </View>

      <View style={styles.panel}>
        <Text style={styles.label}>
          {hasPhotos ? 'Extra notes' : 'Update notes'}
        </Text>

        <TextInput
          style={[
            styles.input,
            styles.notesInput,
          ]}
          value={update.notes}
          onChangeText={onNotesChange}
          placeholder={
            hasPhotos
              ? 'Optional blockers, next steps, or decisions needed.'
              : 'Summary, status, blockers, next steps, or decisions needed.'
          }
          placeholderTextColor={colors.muted}
          multiline
        />
      </View>

      <View style={styles.sendRow}>
        <PrimaryButton
          label="Email"
          icon="mail-outline"
          onPress={onSendEmail}
          compact
        />

        <SecondaryButton
          label="Text"
          icon="chatbubble-outline"
          onPress={onSendText}
          compact
        />
      </View>

      <View style={styles.sendRow}>
        <SecondaryButton
          label="Copy"
          icon="copy-outline"
          onPress={onCopy}
          compact
        />

        <SecondaryButton
          label="Save"
          icon="bookmark-outline"
          onPress={onSave}
          compact
        />
      </View>

      <SecondaryButton
        label="Edit Photos"
        icon="images-outline"
        onPress={onEditPhotos}
      />

      <View style={styles.previewCard}>
        <Text style={styles.previewLabel}>
          Subject
        </Text>

        <Text style={styles.subjectText}>
          {subject}
        </Text>

        <View style={styles.divider} />

        <Text style={styles.previewLabel}>
          Body
        </Text>

        <Text style={styles.previewBody}>
          {body}
        </Text>
      </View>
    </View>
  );
}

function ProjectsScreen({
  contentStyle,
  activeProjects,
  archivedProjects,
  savedUpdates,
  projectStatsByName,
  projectAreas,
  onSelect,
  onAddProject,
  onCloseProject,
  onReopenProject,
  onBackup,
  onRestore,
  onAddArea,
  onUpdateArea,
  onDeleteArea,
  onUseCurrentLocationForArea,
  onDiagnostics,
  onReferenceDocuments,
  onSchedule,
}: {
  contentStyle: StyleProp<ViewStyle>;
  activeProjects: string[];
  archivedProjects: string[];
  savedUpdates: ProjectUpdate[];
  projectStatsByName: Record<string, ProjectStats>;
  projectAreas: ProjectArea[];
  onSelect: (projectName: string) => void;
  onAddProject: (projectName: string) => boolean;
  onCloseProject: (projectName: string) => void;
  onReopenProject: (projectName: string) => void;
  onBackup: () => void;
  onRestore: () => void;
  onAddArea: (name: string) => boolean;
  onUpdateArea: (areaId: string, next: Partial<ProjectArea>) => void;
  onDeleteArea: (areaId: string) => void;
  onUseCurrentLocationForArea: (areaId: string) => void;
  onDiagnostics: () => void;
  onReferenceDocuments: () => void;
  onSchedule: () => void;
}) {
  const [searchText, setSearchText] = useState('');
  const [projectFilter, setProjectFilter] = useState<
    'All' | 'Favorites' | 'Open' | 'Overdue' | 'Due Soon' | 'Archived'
  >('All');
  const [favoriteProjects, setFavoriteProjects] = useState<string[]>([]);
  const [favoritesLoaded, setFavoritesLoaded] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem('projectPhotoUpdate.favoriteProjects.v1')
      .then(value => {
        if (!value) return;

        const parsed = JSON.parse(value);

        if (Array.isArray(parsed)) {
          setFavoriteProjects(
            parsed.filter(item => typeof item === 'string'),
          );
        }
      })
      .catch(() => undefined)
      .finally(() => setFavoritesLoaded(true));
  }, []);

  useEffect(() => {
    if (!favoritesLoaded) return;

    AsyncStorage.setItem(
      'projectPhotoUpdate.favoriteProjects.v1',
      JSON.stringify(favoriteProjects),
    ).catch(() => undefined);
  }, [favoriteProjects, favoritesLoaded]);

  function toggleFavorite(projectName: string) {
    setFavoriteProjects(prev => {
      const exists = prev.some(
        item => item.toLowerCase() === projectName.toLowerCase(),
      );

      if (exists) {
        return prev.filter(
          item => item.toLowerCase() !== projectName.toLowerCase(),
        );
      }

      return [projectName, ...prev];
    });
  }

  const activeProjectSet = new Set(
    activeProjects.map(project => project.toLowerCase()),
  );
  const archivedProjectSet = new Set(
    archivedProjects.map(project => project.toLowerCase()),
  );
  const search = searchText.trim().toLowerCase();

  const projectRows = [
    ...activeProjects.map(project => ({
      project,
      archived: false,
      stats: projectStatsByName[project] || EMPTY_PROJECT_STATS,
    })),
    ...archivedProjects.map(project => ({
      project,
      archived: true,
      stats: projectStatsByName[project] || EMPTY_PROJECT_STATS,
    })),
  ]
    .filter(item => {
      const favorite = favoriteProjects.some(
        project => project.toLowerCase() === item.project.toLowerCase(),
      );

      if (projectFilter === 'Favorites' && !favorite) return false;
      if (projectFilter === 'Open' && item.archived) return false;
      if (projectFilter === 'Archived' && !item.archived) return false;
      if (projectFilter === 'Overdue' && item.stats.overdueActions === 0) {
        return false;
      }
      if (projectFilter === 'Due Soon' && item.stats.dueThisWeek === 0) {
        return false;
      }

      if (!search) return true;

      return item.project.toLowerCase().includes(search);
    })
    .sort((a, b) => {
      const aFavorite = favoriteProjects.some(
        project => project.toLowerCase() === a.project.toLowerCase(),
      );
      const bFavorite = favoriteProjects.some(
        project => project.toLowerCase() === b.project.toLowerCase(),
      );

      if (aFavorite !== bFavorite) return aFavorite ? -1 : 1;
      if (a.archived !== b.archived) return a.archived ? 1 : -1;
      if (b.stats.overdueActions !== a.stats.overdueActions) {
        return b.stats.overdueActions - a.stats.overdueActions;
      }
      if (b.stats.openActions !== a.stats.openActions) {
        return b.stats.openActions - a.stats.openActions;
      }

      return a.project.localeCompare(b.project);
    });

  const totalPhotos = savedUpdates.reduce(
    (sum, update) => sum + update.photos.length,
    0,
  );
  const totalOpenActions = Object.values(projectStatsByName).reduce(
    (sum, stats) => sum + stats.openActions,
    0,
  );
  const totalOverdue = Object.values(projectStatsByName).reduce(
    (sum, stats) => sum + stats.overdueActions,
    0,
  );

  const renderProject = ({ item }: { item: typeof projectRows[number] }) => {
    const favorite = favoriteProjects.some(
      project => project.toLowerCase() === item.project.toLowerCase(),
    );

    return (
      <ProjectFinderRow
        project={item.project}
        stats={item.stats}
        archived={item.archived}
        favorite={favorite}
        onPress={() =>
          item.archived ? onReopenProject(item.project) : onSelect(item.project)
        }
        onFavorite={() => toggleFavorite(item.project)}
        onClose={
          item.archived ? undefined : () => onCloseProject(item.project)
        }
      />
    );
  };

  return (
    <FlatList
      style={styles.appFrame}
      contentContainerStyle={contentStyle}
      keyboardShouldPersistTaps="handled"
      data={projectRows}
      keyExtractor={item => `${item.archived ? 'archived' : 'active'}-${item.project}`}
      renderItem={renderProject}
      ListHeaderComponent={
        <>
          <ScreenTitle
            title="Projects"
            subtitle="Search, favorite, update, archive, and manage project setup."
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
                <TouchableOpacity onPress={() => setSearchText('')}>
                  <Ionicons
                    name="close-circle"
                    size={20}
                    color={colors.muted}
                  />
                </TouchableOpacity>
              ) : null}
            </View>

            <View style={styles.projectFilterRow}>
              {(['All', 'Favorites', 'Open', 'Overdue', 'Due Soon', 'Archived'] as const).map(filter => {
                const selected = projectFilter === filter;

                return (
                  <TouchableOpacity
                    key={filter}
                    style={[
                      styles.projectFilterChip,
                      selected && styles.projectFilterChipSelected,
                    ]}
                    onPress={() => setProjectFilter(filter)}
                  >
                    <Text
                      style={[
                        styles.projectFilterText,
                        selected && styles.projectFilterTextSelected,
                      ]}
                    >
                      {filter}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <View style={styles.projectFinderStatsRow}>
              <MiniStat label="Active" value={activeProjectSet.size} />
              <MiniStat label="Archived" value={archivedProjectSet.size} />
              <MiniStat label="Open" value={totalOpenActions} danger={totalOpenActions > 0} />
              <MiniStat label="Overdue" value={totalOverdue} danger={totalOverdue > 0} />
            </View>

            <Text style={styles.locationDetailText}>
              {projectRows.length} project{projectRows.length === 1 ? '' : 's'} shown | {totalPhotos.toLocaleString('en-US')} total photos
            </Text>
          </View>

          <AddProjectCard
            buttonLabel="Add Project"
            placeholder="New project name"
            onAdd={onAddProject}
          />

          <SecondaryButton
            label="Reference Documents"
            icon="documents-outline"
            onPress={onReferenceDocuments}
          />

          <ManageAreasPanel
            projectAreas={projectAreas}
            onAddArea={onAddArea}
            onUpdateArea={onUpdateArea}
            onDeleteArea={onDeleteArea}
            onUseCurrentLocationForArea={onUseCurrentLocationForArea}
          />

          <View style={styles.panel}>
            <Text style={styles.panelTitle}>
              Data Management
            </Text>

            <Text style={styles.bodyText}>
              JSON backup protects project data and local photo references. It does not copy image files outside this app.
            </Text>

            <View style={styles.dataActionRow}>
              <SecondaryButton
                label="Backup"
                icon="download-outline"
                onPress={onBackup}
                compact
              />

              <SecondaryButton
                label="Restore"
                icon="cloud-upload-outline"
                onPress={onRestore}
                compact
              />
            </View>

            <SecondaryButton
              label="Run Diagnostics"
              icon="pulse-outline"
              onPress={onDiagnostics}
            />
          </View>

          <Text style={styles.sectionLabel}>
            Project Finder
          </Text>
        </>
      }
      ListEmptyComponent={
        <EmptyState
          title="No matching projects"
          text="Change the search or filter, or add a new project."
        />
      }
    />
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
  const [results, setResults] = useState<DiagnosticResult[]>([]);
  const [running, setRunning] = useState(false);
  const [completedManualIds, setCompletedManualIds] = useState<string[]>([]);
  const areaStats = projectAreaSetupStats(projectAreas);
  const manualStats = manualChecklistStats(completedManualIds);
  const rating = diagnosticsSummaryRating(results, projectAreas, completedManualIds);
  const groupedTests = groupedManualTests();
  const report = formatDiagnosticReport(results, projectAreas, completedManualIds, referenceDocuments);

  useEffect(() => {
    AsyncStorage.getItem(MANUAL_TEST_STORAGE_KEY)
      .then(value => {
        if (!value) return;
        const parsed = JSON.parse(value);
        if (Array.isArray(parsed)) {
          setCompletedManualIds(parsed.filter(id => typeof id === 'string'));
        }
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    AsyncStorage.setItem(
      MANUAL_TEST_STORAGE_KEY,
      JSON.stringify(completedManualIds),
    ).catch(() => undefined);
  }, [completedManualIds]);

  async function runDiagnostics() {
    setRunning(true);
    try {
      const nextResults = await runAdminDiagnostics(projectAreas, referenceDocuments);
      setResults(nextResults);
    } finally {
      setRunning(false);
    }
  }

  async function copyReport() {
    await Clipboard.setStringAsync(report);
    Alert.alert('Copied', 'The diagnostic report is ready to paste.');
  }

  async function emailReport() {
    const available = await MailComposer.isAvailableAsync();
    if (!available) {
      Alert.alert('Email unavailable', 'Email composition is not available on this device.');
      return;
    }

    await MailComposer.composeAsync({
      subject: 'Project Photo Update Tool Diagnostic Report',
      body: report,
    });
  }

  async function testContactPicker() {
    try {
      const permission = await Contacts.requestPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Contacts access needed', 'Allow contacts access in Settings, then run the contact picker test again.');
        return;
      }

      const contact = await Contacts.presentContactPickerAsync();
      setResults(prev => [
        makeDiagnosticResult(
          'Manual contact picker test',
          'Pass',
          contact ? 'Contact picker opened and a contact was selected.' : 'Contact picker opened and was cancelled without selecting a contact.',
        ),
        ...prev,
      ]);
    } catch {
      setResults(prev => [
        makeDiagnosticResult(
          'Manual contact picker test',
          'Fail',
          'Contact picker could not be opened. Rebuild the app if native contact access was added recently.',
        ),
        ...prev,
      ]);
    }
  }

  function toggleManualCheck(id: string) {
    setCompletedManualIds(prev =>
      prev.includes(id)
        ? prev.filter(item => item !== id)
        : [...prev, id],
    );
  }

  return (
    <View>
      <ScreenTitle
        title="Admin Diagnostics"
        subtitle="Run phone-based checks and track manual function testing."
      />

      <SecondaryButton
        label="Back to Projects"
        icon="arrow-back-outline"
        onPress={onBack}
      />

      <View style={styles.panel}>
        <Text style={styles.panelTitle}>{rating}</Text>
        <Text style={styles.bodyText}>
          Project Area GPS Setup: {areaStats.saved} of {areaStats.total} saved ({areaStats.percent}%).
        </Text>
        <Text style={styles.bodyText}>
          Manual Testing: {manualStats.completed} of {manualStats.total} complete ({manualStats.percent}%).
        </Text>
      </View>

      <PrimaryButton
        label={running ? 'Running Diagnostics...' : 'Run Diagnostics'}
        icon="pulse-outline"
        onPress={() => {
          void runDiagnostics();
        }}
        disabled={running}
      />

      <View style={styles.sendRow}>
        <SecondaryButton
          label="Copy Report"
          icon="copy-outline"
          onPress={() => {
            void copyReport();
          }}
          compact
        />
        <SecondaryButton
          label="Email Report"
          icon="mail-outline"
          onPress={() => {
            void emailReport();
          }}
          compact
        />
      </View>

      <SecondaryButton
        label="Test Contact Picker"
        icon="person-add-outline"
        onPress={() => {
          void testContactPicker();
        }}
      />

      <View style={styles.panel}>
        <Text style={styles.panelTitle}>Project Area GPS Setup</Text>
        <Text style={styles.bodyText}>
          Stand in each work area and use Manage Areas to save the current GPS location. GPS suggestions use only areas that have saved GPS points.
        </Text>
        {projectAreas.map(area => (
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
                  ? `GPS Saved | ${formatSavedTime(area.locationCapturedAt || null)} | Radius ${formatFeet(area.radiusFeet)}`
                  : `GPS Missing | Radius ${formatFeet(area.radiusFeet)}`}
              </Text>
            </View>
          </View>
        ))}
      </View>

      <Text style={styles.sectionLabel}>Automated Checks</Text>
      {results.length === 0 ? (
        <EmptyState
          title="No diagnostics yet"
          text="Tap Run Diagnostics to check storage, permissions, GPS, messaging, backup, and data validation."
        />
      ) : (
        results.map(result => (
          <View key={result.id} style={styles.savedRow}>
            <View style={styles.rowIconBubble}>
              <Ionicons
                name={
                  result.status === 'Pass'
                    ? 'checkmark-circle-outline'
                    : result.status === 'Warning'
                      ? 'warning-outline'
                      : 'close-circle-outline'
                }
                size={20}
                color={
                  result.status === 'Pass'
                    ? colors.success
                    : result.status === 'Warning'
                      ? colors.warning
                      : colors.danger
                }
              />
            </View>
            <View style={styles.rowMain}>
              <Text style={styles.projectName}>{result.status}: {result.name}</Text>
              <Text style={styles.rowSub}>{result.details}</Text>
              <Text style={styles.rowSub}>{formatSavedTime(result.timestamp)}</Text>
            </View>
          </View>
        ))
      )}

      <Text style={styles.sectionLabel}>Manual Function Test Checklist</Text>
      {Object.keys(groupedTests).map(group => (
        <View key={group} style={styles.panel}>
          <Text style={styles.panelTitle}>{group}</Text>
          {groupedTests[group].map(item => {
            const checked = completedManualIds.includes(item.id);
            return (
              <TouchableOpacity
                key={item.id}
                style={styles.checklistRow}
                onPress={() => toggleManualCheck(item.id)}
              >
                <Ionicons
                  name={checked ? 'checkbox-outline' : 'square-outline'}
                  size={22}
                  color={checked ? colors.success : colors.muted}
                />
                <Text style={styles.checklistText}>{item.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      ))}

      <View style={styles.panel}>
        <Text style={styles.panelTitle}>Run Full Test Update Helper</Text>
        <Text style={styles.bodyText}>
          Complete these steps in order: select or create project, select area, capture GPS, take or import photo, add caption, select category, add action item, assign owner, add due date, build update, save update, then open the saved update.
        </Text>
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

  useEffect(() => {
    if (area) setRadiusText(String(area.radiusFeet));
  }, [area?.id, area?.radiusFeet]);

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
        <View style={styles.detailModalCard}>
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
  onOpen,
  onDelete,
  onNewUpdate,
}: {
  contentStyle: StyleProp<ViewStyle>;
  updates: ProjectUpdate[];
  projectAreas: ProjectArea[];
  onOpen: (update: ProjectUpdate) => void;
  onDelete: (updateId: string) => void;
  onNewUpdate: () => void;
}) {
  const [areaFilterId, setAreaFilterId] = useState<string | null>(
    null,
  );

  const filteredUpdates = areaFilterId
    ? updates.filter(
        update =>
          update.selectedAreaId === areaFilterId ||
          update.photos.some(
            photo => photo.selectedAreaId === areaFilterId,
          ),
      )
    : updates;

  const renderUpdate = ({ item: update }: { item: ProjectUpdate }) => (
    <View
      key={update.id}
      style={styles.savedRow}
    >
      <View style={styles.rowIconBubble}>
        <Ionicons
          name="document-text-outline"
          size={20}
          color={colors.primary}
        />
      </View>

      <TouchableOpacity
        style={styles.rowMain}
        onPress={() =>
          onOpen(update)
        }
      >
        <Text style={styles.projectName}>
          {update.projectName}
        </Text>

        <Text style={styles.rowSub}>
          {formatDisplayDate(update.date)} - {countLabel(update.photos.length, 'photo')}
        </Text>

        {update.selectedAreaName ? (
          <Text style={styles.rowSub}>
            Area: {update.selectedAreaName}
          </Text>
        ) : null}
      </TouchableOpacity>

      <TouchableOpacity
        style={
          styles.iconOnlyDangerButton
        }
        onPress={() =>
          onDelete(update.id)
        }
      >
        <Ionicons
          name="trash-outline"
          size={19}
          color={colors.danger}
        />
      </TouchableOpacity>
    </View>
  );

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
            title="Saved Updates"
            subtitle="Open a saved update to copy, send, or revise it."
          />

          <Text style={styles.sectionLabel}>
            Filter by Area
          </Text>

          <View style={styles.areaChipWrap}>
            <TouchableOpacity
              style={[
                styles.areaChip,
                !areaFilterId && styles.areaChipSelected,
              ]}
              onPress={() => setAreaFilterId(null)}
            >
              <Text
                style={[
                  styles.areaChipText,
                  !areaFilterId && styles.areaChipTextSelected,
                ]}
              >
                All Areas
              </Text>
            </TouchableOpacity>

            {projectAreas.map(area => {
              const selected = areaFilterId === area.id;

              return (
                <TouchableOpacity
                  key={area.id}
                  style={[
                    styles.areaChip,
                    selected && styles.areaChipSelected,
                  ]}
                  onPress={() => setAreaFilterId(area.id)}
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
        </>
      }
      ListEmptyComponent={
        updates.length === 0 ? (
          <EmptyState
            title="No saved updates"
            text="Save an update after building the message preview."
          />
        ) : (
          <EmptyState
            title="No updates for this area"
            text="Choose All Areas or save an update tagged to this project area."
          />
        )
      }
      ListFooterComponent={
        <PrimaryButton
          label="New Update"
          icon="add-circle-outline"
          onPress={onNewUpdate}
        />
      }
    />
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
  onSchedule,
  onNewUpdate,
}: {
  contentStyle: StyleProp<ViewStyle>;
  scheduleItems: ScheduleItem[];
  savedUpdates: ProjectUpdate[];
  onSchedule: () => void;
  onNewUpdate: () => void;
}) {
  const [selectedSection, setSelectedSection] = useState<{
    title: string;
    items: Array<{
      id: string;
      source: string;
      title: string;
      projectName: string;
      locationName: string;
      owner: string;
      dueDate: string;
      status: string;
      notes: string;
      days: number | null;
    }>;
  } | null>(null);

  const actionItems = actionItemsFromUpdates(savedUpdates);
  const combinedItems = [
    ...scheduleItems
      .filter(item => item.status !== 'Complete')
      .map(item => ({
        id: item.id,
        source: 'Schedule',
        title: item.taskName,
        projectName: item.projectName,
        locationName: item.locationName,
        owner: item.owner,
        dueDate: item.finishDate,
        status: item.status,
        notes: item.notes,
      })),
    ...actionItems.map(item => ({
      id: item.id,
      source: 'Action Item',
      title: item.taskName,
      projectName: item.projectName,
      locationName: item.locationName,
      owner: item.owner,
      dueDate: item.finishDate,
      status: item.status,
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

  const renderUpcomingItem = (item: typeof withDueDates[number]) => (
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
          {dueStatusText(item.dueDate)} • {item.source}{item.owner ? ` • ${item.owner}` : ''}
        </Text>
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
        <View style={styles.photoModalBackdrop}>
          <SafeAreaView style={styles.photoModalSafeArea}>
            <View style={styles.photoModalHeader}>
              <View style={styles.photoModalTitleWrap}>
                <Text style={styles.photoModalTitle}>{selectedSection?.title}</Text>
                <Text style={styles.photoModalCaption}>
                  {selectedSection?.items.length || 0} {pluralWord(selectedSection?.items.length || 0, 'item')}
                </Text>
              </View>
              <TouchableOpacity
                style={styles.photoModalCloseButton}
                onPress={() => setSelectedSection(null)}
                accessibilityLabel="Close upcoming list"
              >
                <Ionicons name="close" size={30} color="#FFFFFF" />
              </TouchableOpacity>
            </View>

            <ScrollView
              style={styles.appFrame}
              contentContainerStyle={[styles.content, { paddingTop: 8, paddingBottom: 24 }]}
            >
              {selectedSection?.items.map(renderUpcomingItem)}
            </ScrollView>
          </SafeAreaView>
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
                placeholder="Owner / contractor"
                placeholderTextColor={colors.muted}
              />

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
          {item.finishDate ? dueStatusText(item.finishDate) : 'No finish date'} • {item.status}
        </Text>

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
              placeholder="Owner / contractor"
              placeholderTextColor={colors.muted}
            />

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
  onNew,
}: {
  current: Screen;
  onChange: (screen: Screen) => void;
  onNew: () => void;
}) {
  return (
    <View style={styles.bottomTabs}>
      <TabButton
        label="Home"
        icon="home-outline"
        active={current === 'Home'}
        onPress={() => onChange('Home')}
      />

      <TabButton
        label="Locations"
        icon="location-outline"
        active={current === 'Projects'}
        onPress={() => onChange('Projects')}
      />

      <TouchableOpacity
        style={styles.newTabButton}
        onPress={onNew}
      >
        <Ionicons
          name="camera-outline"
          size={24}
          color="#FFFFFF"
        />
        <Text style={styles.newTabButtonText}>Capture</Text>
      </TouchableOpacity>

      <TabButton
        label="History"
        icon="time-outline"
        active={current === 'SavedUpdates'}
        onPress={() => onChange('SavedUpdates')}
      />

      <TabButton
        label="Upcoming"
        icon="calendar-outline"
        active={current === 'Upcoming'}
        onPress={() => onChange('Upcoming')}
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
}: {
  title: string;
  subtitle: string;
}) {
  return (
    <View style={styles.screenTitle}>
      <Text style={styles.title}>
        {title}
      </Text>

      <Text style={styles.subtitle}>
        {subtitle}
      </Text>
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
  dangerSoft: '#FFECEC',
  danger: '#FF3B30',
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
    fontSize: 31,
    fontWeight: '800',
    lineHeight: 37,
  },

  subtitle: {
    color: colors.muted,
    fontSize: 15,
    lineHeight: 21,
    marginTop: 7,
    fontWeight: '500',
  },

  screenTitle: {
    marginBottom: 12,
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
    borderRadius: 10,
    paddingVertical: 15,
    paddingHorizontal: 16,
    alignItems: 'center',
    marginBottom: 10,
    minHeight: 54,
    justifyContent: 'center',
  },

  secondaryButton: {
    backgroundColor: colors.card,
    borderColor: colors.line,
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 15,
    paddingHorizontal: 16,
    alignItems: 'center',
    marginBottom: 10,
    minHeight: 54,
    justifyContent: 'center',
  },

  compactButton: {
    flex: 1,
    minHeight: 62,
    marginBottom: 0,
  },

  disabledButton: {
    opacity: 0.45,
  },

  buttonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },

  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
  },

  secondaryButtonText: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
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
    paddingHorizontal: 11,
  },

  areaChipSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },

  areaChipText: {
    color: colors.text,
    fontSize: 12,
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
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },


  contactRowHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },

  deliveryChoiceBlock: {
    marginTop: 12,
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
  },

  deliveryChoiceChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },

  deliveryChoiceText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '800',
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
    borderRadius: 8,
    padding: 18,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: colors.line,
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

  detailModalCard: {
    backgroundColor: colors.card,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 18,
    paddingBottom: Platform.OS === 'ios' ? 34 : 18,
    borderWidth: 1,
    borderColor: colors.line,
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
    padding: 12,
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
    fontSize: 25,
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
    gap: 10,
    marginBottom: 14,
  },

  quickActionButton: {
    flex: 1,
    backgroundColor: colors.card,
    borderRadius: 12,
    borderColor: colors.line,
    borderWidth: 1,
    minHeight: 84,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 8,
  },

  quickActionButtonPrimary: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },

  quickActionText: {
    color: colors.text,
    fontSize: 13,
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
    borderRadius: 14,
    padding: 14,
    marginBottom: 14,
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
});

type ScheduleStatus =
  | 'Not Started'
  | 'In Progress'
  | 'Waiting'
  | 'Complete';

type ScheduleItem = {
  id: string;
  projectName: string;
  locationName: string;
  taskName: string;
  startDate: string;
  finishDate: string;
  milestone: string;
  owner: string;
  status: ScheduleStatus;
  notes: string;
  importedFrom?: string | null;
  importedAt?: string | null;
  createdAt: string;
};


