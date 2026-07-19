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
      diagnostics?: {
        selectedPriorPhotoId?: string | null;
      } | null;
    } | null;
  }>;
};

export type DAVEUpdatePhotoComparison = {
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

export function buildDAVEUpdatePhotoComparison<
  T extends DAVEUpdateWorkspaceRecord,
>(currentUpdate: T | null, updates: T[]): DAVEUpdatePhotoComparison | null {
  if (!currentUpdate) return null;

  for (const currentPhoto of currentUpdate.photos) {
    const intelligence = currentPhoto.photoIntelligence;
    if (!intelligence) continue;

    const selectedPriorPhotoId = intelligence.diagnostics?.selectedPriorPhotoId?.trim();
    const priorAssetId = intelligence.priorPhotoAssetId?.trim();
    const exactPrior = updates
      .filter(update => sameProject(update.projectName, currentUpdate.projectName))
      .flatMap(update => update.photos.map(photo => ({ update, photo })))
      .find(({ update, photo }) => {
        if (update.id === currentUpdate.id && photo.id === currentPhoto.id) return false;
        if (selectedPriorPhotoId && photo.id === selectedPriorPhotoId) return true;
        return Boolean(
          priorAssetId &&
          photo.photoIntelligence?.currentPhotoAssetId === priorAssetId,
        );
      });

    if (!exactPrior) continue;

    return {
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
      comparisonConfidence: firstText(intelligence.comparisonConfidence),
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
