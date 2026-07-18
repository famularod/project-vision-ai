export type DAVEBlockerEvidencePhoto = Readonly<{
  category?: string | null;
  actionStatus?: string | null;
  selectedAreaName?: string | null;
}>;

export type DAVEBlockerEvidenceUpdate = Readonly<{
  id: string;
  date?: string | null;
  notes?: string | null;
  selectedAreaName?: string | null;
  quickContext?: string | null;
  safetyFlag?: boolean;
  blockerFlag?: boolean;
  locationCapturedAt?: string | null;
  workflowTimestamps?: Readonly<{
    sendResolvedAt?: string | null;
    sendTappedAt?: string | null;
    firstPhotoAddedAt?: string | null;
  }> | null;
  photos?: readonly DAVEBlockerEvidencePhoto[];
}>;

const PROJECT_SCOPE = '__project__';
const RESOLUTION_PATTERN =
  /\b(?:blocker|safety concern|hazard|issue)\b.{0,32}\b(?:resolved|cleared|closed|removed)\b|\b(?:resolved|cleared|closed|removed)\b.{0,32}\b(?:blocker|safety concern|hazard|issue)\b/i;

/**
 * Finds the newest unresolved, explicitly confirmed blocker. A later explicit
 * resolution only clears blocker evidence in the same recorded area.
 */
export function findCurrentDAVEConfirmedBlocker<
  T extends DAVEBlockerEvidenceUpdate,
>(updates: readonly T[]): T | null {
  const resolvedScopes = new Set<string>();
  const sortedUpdates = [...updates].sort(
    (left, right) => updateTimestamp(right) - updateTimestamp(left),
  );

  for (const update of sortedUpdates) {
    for (const scope of resolutionScopes(update)) resolvedScopes.add(scope);

    const blockerScopes = confirmedBlockerScopes(update);
    if (blockerScopes.some(scope => !resolvedScopes.has(scope))) return update;
  }

  return null;
}

export function findCurrentDAVEConfirmedBlockerForScopes<
  T extends DAVEBlockerEvidenceUpdate,
>(
  scopeNames: readonly string[],
  updates: readonly T[],
  matchesScope: (update: T, scopeName: string) => boolean,
) {
  return findCurrentDAVEConfirmedBlocker(
    updates.filter(update => scopeNames.some(scope => matchesScope(update, scope))),
  );
}

export function daveConfirmedBlockerReason(
  update: DAVEBlockerEvidenceUpdate,
) {
  if (hasActiveTopLevelSafetyFlag(update) || openSafetyPhotos(update).length > 0) {
    return 'A field update contains a confirmed safety concern that must be resolved.';
  }

  return 'A field update is explicitly tagged as a blocker that prevents work from advancing.';
}

export function updateHasOpenDAVESafetyConcern(
  update: DAVEBlockerEvidenceUpdate,
) {
  return hasActiveTopLevelSafetyFlag(update) || openSafetyPhotos(update).length > 0;
}

export function updateHasOpenDAVEIssue(update: DAVEBlockerEvidenceUpdate) {
  return (update.photos ?? []).some(photo =>
    photo.category === 'Open Issue' && photo.actionStatus !== 'Closed',
  );
}

export function updateHasOpenDAVEBlocker(update: DAVEBlockerEvidenceUpdate) {
  return hasActiveTopLevelBlockerFlag(update) || updateHasOpenDAVEIssue(update);
}

function confirmedBlockerScopes(update: DAVEBlockerEvidenceUpdate) {
  const scopes = new Set<string>();

  if (hasActiveTopLevelSafetyFlag(update) || hasActiveTopLevelBlockerFlag(update)) {
    for (const scope of updateScopeKeys(update)) scopes.add(scope);
  }

  for (const photo of openSafetyPhotos(update)) {
    scopes.add(scopeKey(photo.selectedAreaName || update.selectedAreaName));
  }

  return [...scopes];
}

function resolutionScopes(update: DAVEBlockerEvidenceUpdate) {
  const scopes = new Set<string>();
  const photos = update.photos ?? [];

  for (const photo of photos) {
    if (
      (photo.category === 'Safety Concern' || photo.category === 'Open Issue') &&
      photo.actionStatus === 'Closed'
    ) {
      scopes.add(scopeKey(photo.selectedAreaName || update.selectedAreaName));
    }
  }

  if (RESOLUTION_PATTERN.test(update.notes?.trim() || '')) {
    for (const scope of updateScopeKeys(update)) scopes.add(scope);
  }

  return [...scopes];
}

function openSafetyPhotos(update: DAVEBlockerEvidenceUpdate) {
  return (update.photos ?? []).filter(photo =>
    photo.category === 'Safety Concern' && photo.actionStatus !== 'Closed',
  );
}

function hasActiveTopLevelSafetyFlag(update: DAVEBlockerEvidenceUpdate) {
  const recorded = Boolean(update.safetyFlag) || update.quickContext === 'Safety';
  return recorded && !explicitlyResolved(update, 'Safety Concern');
}

function hasActiveTopLevelBlockerFlag(update: DAVEBlockerEvidenceUpdate) {
  const recorded = Boolean(update.blockerFlag) || update.quickContext === 'Blocker';
  return recorded && !explicitlyResolved(update, 'Open Issue');
}

function explicitlyResolved(
  update: DAVEBlockerEvidenceUpdate,
  category: 'Safety Concern' | 'Open Issue',
) {
  if (RESOLUTION_PATTERN.test(update.notes?.trim() || '')) return true;
  const matchingPhotos = (update.photos ?? []).filter(photo => photo.category === category);
  return matchingPhotos.length > 0 && matchingPhotos.every(photo => photo.actionStatus === 'Closed');
}

function updateScopeKeys(update: DAVEBlockerEvidenceUpdate) {
  const areaNames = [
    update.selectedAreaName,
    ...(update.photos ?? []).map(photo => photo.selectedAreaName),
  ].filter((value): value is string => Boolean(value?.trim()));

  return areaNames.length > 0
    ? [...new Set(areaNames.map(scopeKey))]
    : [PROJECT_SCOPE];
}

function scopeKey(value: string | null | undefined) {
  return value?.trim().toLowerCase() || PROJECT_SCOPE;
}

function updateTimestamp(update: DAVEBlockerEvidenceUpdate) {
  const value = update.workflowTimestamps?.sendResolvedAt ||
    update.workflowTimestamps?.sendTappedAt ||
    update.workflowTimestamps?.firstPhotoAddedAt ||
    update.locationCapturedAt ||
    update.date ||
    '';
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}
