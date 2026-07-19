type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && Boolean(value.trim());
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || value === null || typeof value === 'string';
}

function isOptionalFiniteNumber(value: unknown): boolean {
  return value === undefined || value === null || (
    typeof value === 'number' && Number.isFinite(value)
  );
}

function isOptionalStringArray(value: unknown): boolean {
  return value === undefined || value === null || (
    Array.isArray(value) && value.every(item => typeof item === 'string')
  );
}

function hasValidOptionalStringFields(
  record: UnknownRecord,
  fields: readonly string[],
): boolean {
  return fields.every(field => isOptionalString(record[field]));
}

function isStartupPhotoRecord(value: unknown): boolean {
  if (!isRecord(value) || !isNonEmptyString(value.uri)) return false;
  return hasValidOptionalStringFields(value, [
    'id',
    'caption',
    'category',
    'actionRequired',
    'actionOwner',
    'actionDueDate',
    'actionStatus',
    'fileName',
    'mimeType',
    'cloudStoragePath',
    'cloudRecoveredAt',
    'cloudSignedUrlExpiresAt',
    'selectedAreaId',
    'selectedAreaName',
    'locationCapturedAt',
  ]) && [
    'gpsLatitude',
    'gpsLongitude',
    'gpsAccuracy',
    'distanceFromSelectedAreaFeet',
  ].every(field => isOptionalFiniteNumber(value[field]));
}

function isStartupProjectDocumentRecord(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const hasName = isNonEmptyString(value.name) || isNonEmptyString(value.originalFileName);
  const hasStableIdentityOrFile = [
    value.id,
    value.localUri,
    value.uri,
    value.storagePath,
    value.ownedFileId,
  ].some(isNonEmptyString);
  if (!hasName || !hasStableIdentityOrFile) return false;
  return hasValidOptionalStringFields(value, [
    'id',
    'projectId',
    'areaId',
    'updateId',
    'name',
    'originalFileName',
    'category',
    'mimeType',
    'localUri',
    'uri',
    'ownedFileId',
    'storagePath',
    'uploadedAt',
    'createdAt',
    'updatedAt',
    'note',
    'notes',
    'status',
    'archivedAt',
    'duplicateOf',
    'lastUploadAttemptAt',
    'importedAt',
  ]) && [
    'sizeBytes',
    'uploadAttemptCount',
  ].every(field => isOptionalFiniteNumber(value[field]));
}

function isStartupInterpretationDecision(value: unknown): boolean {
  return isRecord(value) &&
    isNonEmptyString(value.interpretation) &&
    (value.decision === 'confirmed' || value.decision === 'dismissed') &&
    isOptionalStringArray(value.observations);
}

/**
 * Validates the minimum durable identity and every nested collection that the
 * live normalizer would otherwise silently discard. Optional legacy fields
 * remain optional and are still migrated by the existing normalizer.
 */
export function isStartupSavedUpdateRecord(value: unknown): boolean {
  if (!isRecord(value) || !isNonEmptyString(value.id)) return false;
  if (!hasValidOptionalStringFields(value, [
    'projectName',
    'date',
    'notes',
    'sourceWalkSessionId',
    'scheduleItemId',
    'scheduleTaskName',
    'scheduleProjectName',
    'selectedAreaId',
    'selectedAreaName',
    'locationCapturedAt',
    'pieSummary',
    'pieSuggestedNote',
    'pieStartedAt',
    'pieCompletedAt',
    'stableSendId',
    'idempotencyKey',
    'lastSendAttemptAt',
    'generatedMessage',
    'archivedAt',
  ])) return false;

  if (value.photos !== undefined && value.photos !== null && (
    !Array.isArray(value.photos) || !value.photos.every(isStartupPhotoRecord)
  )) return false;
  if (value.documents !== undefined && value.documents !== null && (
    !Array.isArray(value.documents) || !value.documents.every(isStartupProjectDocumentRecord)
  )) return false;
  if (!isOptionalStringArray(value.sourceCaptureMemoryIds)) return false;
  for (const field of [
    'observedFindings',
    'possibleInterpretations',
    'confirmedInterpretations',
    'dismissedInterpretations',
  ]) {
    if (!isOptionalStringArray(value[field])) return false;
  }
  if (value.interpretationDecisionLog !== undefined && value.interpretationDecisionLog !== null && (
    !Array.isArray(value.interpretationDecisionLog) ||
    !value.interpretationDecisionLog.every(isStartupInterpretationDecision)
  )) return false;
  if (value.recipients !== undefined && value.recipients !== null) {
    if (!isRecord(value.recipients) || !isOptionalStringArray(value.recipients.contactIds)) {
      return false;
    }
  }
  if (value.workflowTimestamps !== undefined && value.workflowTimestamps !== null) {
    if (!isRecord(value.workflowTimestamps) || !hasValidOptionalStringFields(
      value.workflowTimestamps,
      [
        'startedAt',
        'cameraActionStartedAt',
        'firstPhotoAddedAt',
        'reviewOpenedAt',
        'sendTappedAt',
        'sendResolvedAt',
      ],
    )) return false;
  }
  return [
    'gpsLatitude',
    'gpsLongitude',
    'gpsAccuracy',
    'distanceFromSelectedAreaFeet',
    'sendAttempts',
  ].every(field => isOptionalFiniteNumber(value[field]));
}

export function isStartupDeletedUpdateRecord(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return isNonEmptyString(value.updateId) || isNonEmptyString(value.localId);
}

/** Legacy string projects and newer record-shaped projects are both valid. */
export function isStartupProjectRecord(value: unknown): boolean {
  if (isNonEmptyString(value)) return true;
  if (!isRecord(value) || !isNonEmptyString(value.name)) return false;
  if (value.coverPhoto !== undefined && value.coverPhoto !== null) {
    if (!isRecord(value.coverPhoto) || !isNonEmptyString(value.coverPhoto.updatedAt)) return false;
    if (!isNonEmptyString(value.coverPhoto.localUri) && !isNonEmptyString(value.coverPhoto.remotePath)) {
      return false;
    }
  }
  return isOptionalString(value.id) &&
    isOptionalString(value.coverPhotoUpdatedAt) &&
    isOptionalString(value.coverPhotoMode);
}

export function isStartupProjectName(value: unknown): boolean {
  return isNonEmptyString(value);
}

/** Legacy areas may lack an id/radius, but must carry their real name/GPS. */
export function isStartupProjectAreaRecord(value: unknown): boolean {
  return isRecord(value) &&
    isNonEmptyString(value.name) &&
    typeof value.latitude === 'number' && Number.isFinite(value.latitude) &&
    typeof value.longitude === 'number' && Number.isFinite(value.longitude) &&
    isOptionalString(value.id) &&
    isOptionalString(value.building) &&
    isOptionalString(value.locationCapturedAt) &&
    isOptionalFiniteNumber(value.radiusFeet) &&
    (value.radiusFeet === undefined || value.radiusFeet === null || (
      typeof value.radiusFeet === 'number' && value.radiusFeet > 0
    ));
}

/** Legacy reference documents may lack an id and use originalFileName as name. */
export function isStartupReferenceDocumentRecord(value: unknown): boolean {
  if (!isRecord(value) || !isNonEmptyString(value.uri)) return false;
  if (!isNonEmptyString(value.name) && !isNonEmptyString(value.originalFileName)) return false;
  return hasValidOptionalStringFields(value, [
    'id',
    'name',
    'originalFileName',
    'uri',
    'mimeType',
    'category',
    'notes',
    'importedAt',
    'projectId',
    'projectName',
    'importBatchId',
  ]);
}

export function isStartupStandaloneProjectDocumentRecord(value: unknown): boolean {
  return isStartupProjectDocumentRecord(value);
}

/** Legacy schedule rows may lack an id, but must retain their real task name. */
export function isStartupScheduleItemRecord(value: unknown): boolean {
  if (!isRecord(value) || !isNonEmptyString(value.taskName)) return false;
  if (!hasValidOptionalStringFields(value, [
    'id',
    'scheduleProjectName',
    'projectTimeZone',
    'projectName',
    'locationName',
    'taskName',
    'startDate',
    'finishDate',
    'milestone',
    'owner',
    'contractor',
    'priority',
    'status',
    'notes',
    'importedFrom',
    'importedAt',
    'importBatchId',
    'sourceDocumentId',
    'createdAt',
  ])) return false;
  return ['durationDays', 'percentComplete'].every(field =>
    isOptionalFiniteNumber(value[field]),
  );
}

function isStartupContactRecord(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const meaningful = [value.name, value.email, value.phone]
    .some(isNonEmptyString) ||
    (Array.isArray(value.emails) && value.emails.some(isNonEmptyString)) ||
    (Array.isArray(value.phones) && value.phones.some(isNonEmptyString));
  if (!meaningful) return false;
  return hasValidOptionalStringFields(value, [
    'id',
    'name',
    'email',
    'phone',
    'selectedEmail',
    'selectedPhone',
  ]) && isOptionalStringArray(value.emails) && isOptionalStringArray(value.phones);
}

/** Supports both the current {contacts: []} shape and legacy project maps. */
export function isStartupContactBook(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if ('contacts' in value) {
    return Array.isArray(value.contacts) && value.contacts.every(isStartupContactRecord);
  }
  return Object.values(value).every(group =>
    Array.isArray(group) && group.every(isStartupContactRecord),
  );
}

export function salvageStartupContactBook(value: unknown): Readonly<{
  value: unknown;
  isolatedRecordCount: number;
}> | null {
  if (!isRecord(value)) return null;
  if ('contacts' in value) {
    if (!Array.isArray(value.contacts)) return null;
    const contacts = value.contacts.filter(isStartupContactRecord);
    return {
      value: { contacts },
      isolatedRecordCount: value.contacts.length - contacts.length,
    };
  }
  const groups: UnknownRecord = {};
  let isolatedRecordCount = 0;
  Object.entries(value).forEach(([project, group]) => {
    if (Array.isArray(group)) {
      const contacts = group.filter(isStartupContactRecord);
      groups[project] = contacts;
      isolatedRecordCount += group.length - contacts.length;
    } else {
      isolatedRecordCount += 1;
    }
  });
  return { value: groups, isolatedRecordCount };
}

export function isStartupDraftEnvelope(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (value.savedAt !== undefined && !isOptionalString(value.savedAt)) return false;
  if (!('draft' in value)) return true;
  if (value.draft === null || value.draft === undefined) return false;
  return isStartupSavedUpdateRecord(value.draft);
}
