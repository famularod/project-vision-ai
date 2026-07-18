import {
  classifyDAVEBlocker,
  classifyDAVESafety,
} from './DAVEAssertionParser';

export type DAVEBlockerEvidencePhoto = Readonly<{
  id: string;
  category?: string | null;
  actionStatus?: string | null;
  selectedAreaName?: string | null;
}>;

export type DAVEBlockerType = 'blocker' | 'safety';

export type DAVEBlockerLifecycleEvent = Readonly<{
  blockerId: string;
  blockerType: DAVEBlockerType;
  action: 'opened' | 'resolved' | 'reopened';
  projectName: string;
  areaName?: string | null;
  occurredAt?: string | null;
}>;

export type DAVEBlockerEvidenceUpdate = Readonly<{
  id: string;
  projectName: string;
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
  blockerEvents?: readonly DAVEBlockerLifecycleEvent[];
}>;

const PROJECT_SCOPE = '__project__';

/**
 * Finds the newest unresolved, explicitly confirmed blocker. State changes are
 * replayed by stable blocker identity, type, project, and area. Proximity in an
 * area is never sufficient to resolve a different blocker.
 */
export function findCurrentDAVEConfirmedBlocker<
  T extends DAVEBlockerEvidenceUpdate,
>(updates: readonly T[]): T | null {
  const events = updates
    .flatMap((update, updateOrder) => blockerEventsForUpdate(update, updateOrder))
    .sort(compareBlockerEvents);
  const stateByIdentity = new Map<string, DAVEBlockerState<T>>();

  events.forEach(event => {
    stateByIdentity.set(event.identity, {
      active: event.action !== 'resolved',
      event,
    });
  });

  const newestActive = [...stateByIdentity.values()]
    .filter(state => state.active)
    .sort((left, right) => compareBlockerEvents(right.event, left.event))[0];

  return newestActive?.event.update || null;
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
  if (updateHasOpenDAVESafetyConcern(update)) {
    return 'A field update contains a confirmed safety concern that must be resolved.';
  }

  return 'A field update is explicitly tagged as a blocker that prevents work from advancing.';
}

export function updateHasOpenDAVESafetyConcern(
  update: DAVEBlockerEvidenceUpdate,
) {
  return hasActiveBlockerType(update, 'safety');
}

export function updateHasOpenDAVEIssue(update: DAVEBlockerEvidenceUpdate) {
  return (update.photos ?? []).some(photo =>
    validPhotoIdentity(update, photo) &&
    photo.category === 'Open Issue' &&
    photo.actionStatus !== 'Closed',
  );
}

export function updateHasOpenDAVEBlocker(update: DAVEBlockerEvidenceUpdate) {
  return hasActiveBlockerType(update, 'blocker');
}

export function daveUpdateBlockerId(updateId: string) {
  return `update:${updateId.trim()}`;
}

export function davePhotoBlockerId(photoId: string) {
  return `photo:${photoId.trim()}`;
}

type DAVEBlockerEvent<T extends DAVEBlockerEvidenceUpdate> = Readonly<{
  identity: string;
  blockerId: string;
  blockerType: DAVEBlockerType;
  action: DAVEBlockerLifecycleEvent['action'];
  timestamp: number;
  updateOrder: number;
  eventOrder: number;
  update: T;
}>;

type DAVEBlockerState<T extends DAVEBlockerEvidenceUpdate> = Readonly<{
  active: boolean;
  event: DAVEBlockerEvent<T>;
}>;

function blockerEventsForUpdate<T extends DAVEBlockerEvidenceUpdate>(
  update: T,
  updateOrder: number,
) {
  const events: DAVEBlockerEvent<T>[] = [];
  const projectName = update.projectName?.trim();
  if (!projectName || !update.id.trim()) return events;

  let eventOrder = 0;
  const appendEvent = ({
    blockerId,
    blockerType,
    action,
    eventProjectName,
    areaName,
    occurredAt,
  }: {
    blockerId: string;
    blockerType: DAVEBlockerType;
    action: DAVEBlockerLifecycleEvent['action'];
    eventProjectName: string;
    areaName?: string | null;
    occurredAt?: string | null;
  }) => {
    const identity = blockerIdentity({
      blockerId,
      blockerType,
      projectName: eventProjectName,
      areaName,
    });
    if (!identity) return;

    events.push({
      identity,
      blockerId,
      blockerType,
      action,
      timestamp: timestampValue(occurredAt, updateTimestamp(update)),
      updateOrder,
      eventOrder,
      update,
    });
    eventOrder += 1;
  };

  const updateAreaName = update.selectedAreaName;
  if (update.safetyFlag || update.quickContext === 'Safety') {
    appendEvent({
      blockerId: daveUpdateBlockerId(update.id),
      blockerType: 'safety',
      action: 'opened',
      eventProjectName: projectName,
      areaName: updateAreaName,
    });
    if (notesResolveSafety(update.notes)) {
      appendEvent({
        blockerId: daveUpdateBlockerId(update.id),
        blockerType: 'safety',
        action: 'resolved',
        eventProjectName: projectName,
        areaName: updateAreaName,
      });
    }
  }

  if (update.blockerFlag || update.quickContext === 'Blocker') {
    appendEvent({
      blockerId: daveUpdateBlockerId(update.id),
      blockerType: 'blocker',
      action: 'opened',
      eventProjectName: projectName,
      areaName: updateAreaName,
    });
    if (notesResolveBlocker(update.notes)) {
      appendEvent({
        blockerId: daveUpdateBlockerId(update.id),
        blockerType: 'blocker',
        action: 'resolved',
        eventProjectName: projectName,
        areaName: updateAreaName,
      });
    }
  }

  for (const photo of update.photos ?? []) {
    if (!validPhotoIdentity(update, photo)) continue;
    const blockerType = photo.category === 'Safety Concern'
      ? 'safety'
      : photo.category === 'Open Issue'
        ? 'blocker'
        : null;
    if (!blockerType) continue;

    appendEvent({
      blockerId: davePhotoBlockerId(photo.id),
      blockerType,
      action: photo.actionStatus === 'Closed' ? 'resolved' : 'opened',
      eventProjectName: projectName,
      areaName: photo.selectedAreaName || updateAreaName,
    });
  }

  for (const event of update.blockerEvents ?? []) {
    appendEvent({
      blockerId: event.blockerId,
      blockerType: event.blockerType,
      action: event.action,
      eventProjectName: event.projectName,
      areaName: event.areaName,
      occurredAt: event.occurredAt,
    });
  }

  return events;
}

function hasActiveBlockerType(
  update: DAVEBlockerEvidenceUpdate,
  blockerType: DAVEBlockerType,
) {
  const events = blockerEventsForUpdate(update, 0)
    .filter(event => event.blockerType === blockerType)
    .sort(compareBlockerEvents);
  const activeByIdentity = new Map<string, boolean>();
  events.forEach(event => {
    activeByIdentity.set(event.identity, event.action !== 'resolved');
  });
  return [...activeByIdentity.values()].some(Boolean);
}

function compareBlockerEvents<T extends DAVEBlockerEvidenceUpdate>(
  left: DAVEBlockerEvent<T>,
  right: DAVEBlockerEvent<T>,
) {
  return left.timestamp - right.timestamp ||
    left.updateOrder - right.updateOrder ||
    left.eventOrder - right.eventOrder;
}

function notesResolveSafety(notes: string | null | undefined) {
  return classifyDAVESafety(notes?.trim() || '') === 'no_issue_observed';
}

function notesResolveBlocker(notes: string | null | undefined) {
  return classifyDAVEBlocker(notes?.trim() || '') === 'resolved';
}

function blockerIdentity({
  blockerId,
  blockerType,
  projectName,
  areaName,
}: {
  blockerId: string;
  blockerType: DAVEBlockerType;
  projectName: string;
  areaName?: string | null;
}) {
  const stableId = blockerId.trim();
  const projectScope = scopeKey(projectName);
  if (!stableId || projectScope === PROJECT_SCOPE) return null;

  return [
    blockerType,
    projectScope,
    scopeKey(areaName),
    stableId.toLowerCase(),
  ].join(':');
}

function scopeKey(value: string | null | undefined) {
  return value?.trim().toLowerCase() || PROJECT_SCOPE;
}

function validPhotoIdentity(
  update: DAVEBlockerEvidenceUpdate,
  photo: DAVEBlockerEvidencePhoto,
) {
  return Boolean(update.projectName?.trim() && photo.id?.trim());
}

function timestampValue(value: string | null | undefined, fallback: number) {
  if (!value) return fallback;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : fallback;
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
