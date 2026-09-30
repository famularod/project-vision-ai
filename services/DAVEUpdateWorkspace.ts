import { storedPhotoComparisonConfidence } from './PhotoAssessment';

export type DAVEUpdateWorkspaceTab =
  | 'Needs Action'
  | 'Drafts'
  | 'All Activity';

export type DAVEUpdateWorkspaceFilters = {
  project: string | null;
  areaId: string | null;
  pieStatus: string | null;
  lifecycleStatus: string | null;
  withinDays: number | null;
};

export type DAVEUpdateWorkspaceRecord = {
  id: string;
  projectName: string;
  date: string;
  selectedAreaId?: string | null;
  selectedAreaName?: string | null;
  isArchived?: boolean;
  recipients: { contactIds: string[] };
  photos: Array<{
    id: string;
    uri: string;
    /** 'unavailable': the sync found no file to upload, so the cloud holds none either. */
    cloudRecoveryStatus?: 'cached' | 'signed_url' | 'unavailable' | null;
    selectedAreaId?: string | null;
    photoIntelligence?: {
      title?: string | null;
      summary?: string | null;
      visibleChange?: string | null;
      currentObservation?: string | null;
      changedFromPrior?: string | null;
      comparisonConfidence?: string | null;
      comparability?: string | null;
      currentPhotoAssetId?: string | null;
      priorPhotoAssetId?: string | null;
      userReview?: 'confirmed' | 'incorrect' | 'not_useful' | null;
      diagnostics?: {
        selectedPriorPhotoId?: string | null;
      } | null;
    } | null;
  }>;
};

export type DAVEUpdatePhotoComparison<
  TPhoto = DAVEUpdateWorkspaceRecord['photos'][number],
> = {
  /**
   * The photos themselves, so each side can show a photo this device holds
   * only in the cloud (whole-app audit A4 pass 7 M2): a photo taken on the
   * other device has no path here, and its `uri` is empty.
   */
  currentPhoto: TPhoto;
  priorPhoto: TPhoto;
  currentPhotoId: string;
  currentPhotoUri: string;
  currentUpdateId: string;
  currentUpdateDate: string;
  priorPhotoId: string;
  priorPhotoUri: string;
  priorUpdateId: string;
  priorUpdateDate: string;
  summary: string | null;
  comparisonConfidence: string | null;
  comparability: string | null;
};

type FilterInput<T extends DAVEUpdateWorkspaceRecord> = {
  updates: T[];
  activeTab: DAVEUpdateWorkspaceTab;
  filters: DAVEUpdateWorkspaceFilters;
  searchText: string;
  contactNameForId: (contactId: string) => string;
  lifecycleForUpdate: (update: T) => string;
  pieStatusForUpdate: (update: T) => string | null;
  updateNeedsAction: (update: T) => boolean;
  withinDaysMatches: (update: T, withinDays: number) => boolean;
  updateTime: (update: T) => number;
};

export function filterDAVEUpdateWorkspace<
  T extends DAVEUpdateWorkspaceRecord,
>({
  updates,
  activeTab,
  filters,
  searchText,
  contactNameForId,
  lifecycleForUpdate,
  pieStatusForUpdate,
  updateNeedsAction,
  withinDaysMatches,
  updateTime,
}: FilterInput<T>): T[] {
  const search = normalize(searchText);

  return [...updates]
    .filter(update => activeTab === 'All Activity' || !update.isArchived)
    .filter(update => {
      const lifecycle = lifecycleForUpdate(update);
      if (activeTab === 'Needs Action') return updateNeedsAction(update);
      if (activeTab === 'Drafts') return lifecycle === 'draft';
      return true;
    })
    .filter(update => {
      if (filters.project && !sameProject(update.projectName, filters.project)) {
        return false;
      }
      if (
        filters.areaId &&
        update.selectedAreaId !== filters.areaId &&
        !update.photos.some(photo => photo.selectedAreaId === filters.areaId)
      ) {
        return false;
      }
      if (
        filters.lifecycleStatus &&
        lifecycleForUpdate(update) !== filters.lifecycleStatus
      ) {
        return false;
      }
      if (
        filters.pieStatus &&
        pieStatusForUpdate(update) !== filters.pieStatus
      ) {
        return false;
      }
      if (
        filters.withinDays !== null &&
        !withinDaysMatches(update, filters.withinDays)
      ) {
        return false;
      }
      return true;
    })
    .filter(update => {
      if (!search) return true;
      const recipientNames = update.recipients.contactIds
        .map(contactNameForId)
        .join(' ');
      return normalize(
        `${update.projectName} ${update.selectedAreaName || ''} ${recipientNames}`,
      ).includes(search);
    })
    .sort((left, right) => updateTime(right) - updateTime(left));
}

export function updateWorkspaceProjectOptions<
  T extends Pick<DAVEUpdateWorkspaceRecord, 'projectName'>,
>(projects: string[], updates: T[]): string[] {
  const choices = new Map<string, string>();
  [...projects, ...updates.map(update => update.projectName)].forEach(value => {
    const display = value.trim();
    const key = normalize(display);
    if (key && !choices.has(key)) choices.set(key, display);
  });
  return [...choices.values()].sort((left, right) => left.localeCompare(right));
}

export function resolveUpdateWorkspaceUpdate<
  T extends Pick<DAVEUpdateWorkspaceRecord, 'id'>,
>(updates: T[], selectedUpdateId: string | null): T | null {
  return updates.find(update => update.id === selectedUpdateId) || updates[0] || null;
}

/**
 * The exact prior photo an analysis recorded (its chosen photo id, or its
 * asset id), from the same project's updates. Shared by the Updates
 * comparison and the Before/After row of a photo being edited.
 */
export function findDAVEExactPriorPhoto<T extends DAVEUpdateWorkspaceRecord>(
  updates: readonly T[],
  projectName: string,
  current: Readonly<{ updateId: string | null; photoId: string }>,
  intelligence: NonNullable<DAVEUpdateWorkspaceRecord['photos'][number]['photoIntelligence']>,
): { update: T; photo: T['photos'][number] } | undefined {
  const selectedPriorPhotoId = intelligence.diagnostics?.selectedPriorPhotoId?.trim();
  const priorAssetId = intelligence.priorPhotoAssetId?.trim();
  return updates
    .filter(update => sameProject(update.projectName, projectName))
    .flatMap(update => update.photos.map(photo => ({ update, photo })))
    .find(({ update, photo }) => {
      // No update id (a photo being edited): its own saved copy is not its prior.
      if ((current.updateId === null || update.id === current.updateId) && photo.id === current.photoId) return false;
      if (selectedPriorPhotoId && photo.id === selectedPriorPhotoId) return true;
      return Boolean(
        priorAssetId &&
        photo.photoIntelligence?.currentPhotoAssetId === priorAssetId,
      );
    });
}

/**
 * The first photo of the update with an analysed prior photo, both shown side
 * by side. A pair where either photo is marked 'unavailable' is passed over
 * for the next one: nothing was uploaded for that photo, so its side was a
 * blank image, signed again and again while on screen (whole-app audit A4
 * pass 8 F4, 30 Sep 2026).
 */
export function buildDAVEUpdatePhotoComparison<
  T extends DAVEUpdateWorkspaceRecord,
>(currentUpdate: T | null, updates: T[]): DAVEUpdatePhotoComparison<T['photos'][number]> | null {
  if (!currentUpdate) return null;

  for (const currentPhoto of currentUpdate.photos) {
    const intelligence = currentPhoto.photoIntelligence;
    if (!intelligence) continue;
    if (intelligence.userReview === 'incorrect' || intelligence.userReview === 'not_useful') continue;
    if (currentPhoto.cloudRecoveryStatus === 'unavailable') continue;

    const exactPrior = findDAVEExactPriorPhoto(
      updates,
      currentUpdate.projectName,
      { updateId: currentUpdate.id, photoId: currentPhoto.id },
      intelligence,
    );

    if (!exactPrior || exactPrior.photo.cloudRecoveryStatus === 'unavailable') continue;

    return {
      currentPhoto,
      priorPhoto: exactPrior.photo,
      currentPhotoId: currentPhoto.id,
      currentPhotoUri: currentPhoto.uri,
      currentUpdateId: currentUpdate.id,
      currentUpdateDate: currentUpdate.date,
      priorPhotoId: exactPrior.photo.id,
      priorPhotoUri: exactPrior.photo.uri,
      priorUpdateId: exactPrior.update.id,
      priorUpdateDate: exactPrior.update.date,
      summary: firstText(
        intelligence.changedFromPrior,
        intelligence.visibleChange,
        intelligence.currentObservation,
        intelligence.summary,
      ),
      comparisonConfidence: firstText(storedPhotoComparisonConfidence(intelligence)),
      comparability: firstText(intelligence.comparability),
    };
  }

  return null;
}

function sameProject(left: string, right: string) {
  return normalize(left) === normalize(right);
}

function normalize(value: string) {
  return value.trim().toLowerCase();
}

function firstText(...values: Array<string | null | undefined>) {
  return values.map(value => value?.trim()).find(Boolean) || null;
}
