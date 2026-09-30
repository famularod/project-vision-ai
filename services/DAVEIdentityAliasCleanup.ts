import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  daveIdentityAliasRenamesRegisteredName,
  normalizeDAVEIdentityName,
  type DAVEIdentityCorrection,
} from './DAVEIdentity';
import {
  localDAVEIdentityRepository,
  type DAVEIdentityRepository,
  type DAVEIdentityStorage,
} from './DAVEIdentityRepository';

/**
 * Whole-app audit A11 pass 2 (30 Sep 2026): Confirm Memory saved every area or
 * project correction as a name alias, and the alias renamed every task of the
 * real area on this phone ("Level 2 corridor" became "Roof"). The aliases are
 * removed once per owner; `@dave/` keys live in the owner storage sandbox, so
 * this marker is per owner too.
 */
export const DAVE_IDENTITY_ALIAS_CLEANUP_STORAGE_KEY =
  '@dave/identity-corrections/registered-name-cleanup/v1';

export type DAVERemovedIdentityAlias = Readonly<Pick<
  DAVEIdentityCorrection,
  'kind' | 'rawName' | 'canonicalName' | 'parentProjectName'
>>;

type CleanupMarker = {
  version: 1;
  completedAt: string;
  removedCount: number;
  /** Removed aliases whose tasks still wait for a cloud schedule refresh. */
  awaitingScheduleRefresh: DAVERemovedIdentityAlias[];
};

export type DAVEIdentityAliasCleanupResult = Readonly<{
  alreadyDone: boolean;
  corrections: readonly DAVEIdentityCorrection[];
  removed: readonly DAVEIdentityCorrection[];
  awaitingScheduleRefresh: readonly DAVERemovedIdentityAlias[];
}>;

type CleanupStorage = Pick<DAVEIdentityStorage, 'getItem' | 'setItem'>;

/**
 * Removes saved aliases whose old name is a real project or saved area and
 * keeps spelling-variant aliases. Runs once per owner; an interrupted run
 * simply runs again (deleting is idempotent and the marker is written last).
 */
export async function runDAVEIdentityAliasCleanup({
  registeredNames,
  repository = localDAVEIdentityRepository,
  storage = AsyncStorage,
  now = () => new Date().toISOString(),
}: {
  registeredNames: readonly string[];
  repository?: Pick<DAVEIdentityRepository, 'list' | 'delete'>;
  storage?: CleanupStorage;
  now?: () => string;
}): Promise<DAVEIdentityAliasCleanupResult> {
  const marker = parseMarker(await storage.getItem(DAVE_IDENTITY_ALIAS_CLEANUP_STORAGE_KEY));
  if (marker) {
    return Object.freeze({
      alreadyDone: true,
      corrections: await repository.list(),
      removed: [],
      awaitingScheduleRefresh: marker.awaitingScheduleRefresh,
    });
  }

  const saved = await repository.list();
  const removed = saved.filter(correction =>
    daveIdentityAliasRenamesRegisteredName(correction, registeredNames),
  );
  for (const correction of removed) await repository.delete(correction.id);
  const awaitingScheduleRefresh = removed.map(correction => Object.freeze({
    kind: correction.kind,
    rawName: correction.rawName,
    canonicalName: correction.canonicalName,
    parentProjectName: correction.parentProjectName ?? null,
  }));
  const nextMarker: CleanupMarker = {
    version: 1,
    completedAt: now(),
    removedCount: removed.length,
    awaitingScheduleRefresh,
  };
  await storage.setItem(DAVE_IDENTITY_ALIAS_CLEANUP_STORAGE_KEY, JSON.stringify(nextMarker));
  return Object.freeze({
    alreadyDone: false,
    corrections: Object.freeze(saved.filter(correction => !removed.includes(correction))),
    removed: Object.freeze(removed),
    awaitingScheduleRefresh: Object.freeze(awaitingScheduleRefresh),
  });
}

/** A cloud schedule refresh landed: tasks can take part in Sync Now again. */
export async function markDAVEIdentityAliasCleanupScheduleRefreshed(
  storage: CleanupStorage = AsyncStorage,
) {
  const marker = parseMarker(await storage.getItem(DAVE_IDENTITY_ALIAS_CLEANUP_STORAGE_KEY));
  if (!marker || marker.awaitingScheduleRefresh.length === 0) return;
  await storage.setItem(
    DAVE_IDENTITY_ALIAS_CLEANUP_STORAGE_KEY,
    JSON.stringify({ ...marker, awaitingScheduleRefresh: [] }),
  );
}

type SyncableScheduleItem = {
  projectName: string;
  scheduleProjectName?: string | null;
  locationName: string;
};

/**
 * Until the cloud refresh has given this phone's tasks their true names back,
 * tasks a removed alias may have renamed (or blanked to "Area Not Assigned")
 * stay out of Sync Now, whose upload lets the phone's copy win a tie.
 */
export function scheduleItemsSafeForFullSync<T extends SyncableScheduleItem>(
  items: readonly T[],
  awaitingScheduleRefresh: readonly DAVERemovedIdentityAlias[],
): readonly T[] {
  if (awaitingScheduleRefresh.length === 0) return items;
  return items.filter(item => !awaitingScheduleRefresh.some(alias =>
    aliasMayHaveRenamed(item, alias)));
}

function aliasMayHaveRenamed(item: SyncableScheduleItem, alias: DAVERemovedIdentityAlias) {
  const projectKeys = [item.projectName, item.scheduleProjectName]
    .map(name => normalizeDAVEIdentityName(name))
    .filter(Boolean);
  if (alias.kind === 'project') {
    return [alias.rawName, alias.canonicalName].some(name =>
      projectKeys.includes(normalizeDAVEIdentityName(name)));
  }
  if (alias.parentProjectName) {
    return projectKeys.includes(normalizeDAVEIdentityName(alias.parentProjectName));
  }
  const area = normalizeDAVEIdentityName(item.locationName);
  return !area || [alias.rawName, alias.canonicalName].some(name =>
    normalizeDAVEIdentityName(name) === area);
}

function parseMarker(raw: string | null): CleanupMarker | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<CleanupMarker>;
    if (value?.version !== 1 || typeof value.completedAt !== 'string') return null;
    const awaiting = Array.isArray(value.awaitingScheduleRefresh)
      ? value.awaitingScheduleRefresh.filter(isRemovedAlias)
      : [];
    return {
      version: 1,
      completedAt: value.completedAt,
      removedCount: typeof value.removedCount === 'number' ? value.removedCount : awaiting.length,
      awaitingScheduleRefresh: awaiting,
    };
  } catch {
    // An unreadable marker runs the cleanup again, which is safe.
    return null;
  }
}

function isRemovedAlias(value: unknown): value is DAVERemovedIdentityAlias {
  if (!value || typeof value !== 'object') return false;
  const alias = value as Record<string, unknown>;
  return typeof alias.kind === 'string' &&
    typeof alias.rawName === 'string' &&
    typeof alias.canonicalName === 'string';
}
