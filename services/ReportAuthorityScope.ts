import type {
  ContactBook,
  ProjectArea,
  ProjectUpdate,
  ReferenceDocument,
  ScheduleItem,
} from '../types';
import type { DAVEConfirmedCaptureMemory } from './DAVECaptureMemory';
import type { DAVEDailyBriefDocument } from './DAVEDailyBrief';
import type { ProjectRecord } from './ProjectCoverPhotoService';
import { projectAreasForProject } from './DAVEProjectAreaScope';

export const COMBINED_REPORT_PROJECT_TRUTH_POLICY = 'ephemeral_portfolio' as const;

type CombinedReportAuthorityScopeInput = {
  selectedProjectNames: readonly string[];
  projectRecords: readonly ProjectRecord[];
  updates: readonly ProjectUpdate[];
  scheduleItems: readonly ScheduleItem[];
  currentUpdate?: ProjectUpdate | null;
  projectAreas?: readonly ProjectArea[];
  referenceDocuments?: readonly ReferenceDocument[];
  projectDocuments?: readonly DAVEDailyBriefDocument[];
  captureMemories?: readonly DAVEConfirmedCaptureMemory[];
  contacts?: ContactBook;
};

export type DailyReportAuthorityScope = Pick<
  CombinedReportAuthorityScope,
  | 'projectName'
  | 'projectNames'
  | 'updates'
  | 'scheduleItems'
  | 'currentUpdate'
  | 'projectAreas'
  | 'referenceDocuments'
  | 'projectDocuments'
  | 'captureMemories'
  | 'contacts'
>;

export type CombinedReportAuthorityScope = {
  projectId: string;
  projectName: string;
  projectNames: string[];
  updates: ProjectUpdate[];
  scheduleItems: ScheduleItem[];
  currentUpdate: ProjectUpdate | null;
  projectAreas: ProjectArea[];
  referenceDocuments: ReferenceDocument[];
  projectDocuments: DAVEDailyBriefDocument[];
  captureMemories: DAVEConfirmedCaptureMemory[];
  contacts: ContactBook;
  projectIdentityKeys: string[];
  projectTruthPersistencePolicy: typeof COMBINED_REPORT_PROJECT_TRUTH_POLICY;
};

/**
 * Builds a fail-closed portfolio scope for combined reports. Parent-project
 * fields and exact schedule IDs are authority; area/location labels never are.
 */
export function buildCombinedReportAuthorityScope(
  input: CombinedReportAuthorityScopeInput,
): CombinedReportAuthorityScope {
  const projectNames = uniqueDisplayNames(input.selectedProjectNames);
  if (projectNames.length === 0) {
    throw new Error('A combined report requires at least one selected project.');
  }

  const evidenceScope = buildEvidenceScope(input, projectNames, false);
  const supportingScope = buildSupportingEvidenceScope(input, projectNames, evidenceScope);

  const projectIdentityKeys = projectNames
    .map(projectName => immutableProjectIdentityKey(projectName, input.projectRecords))
    .filter((value, index, values) => values.indexOf(value) === index)
    .sort();

  return {
    projectId: `portfolio:${encodeURIComponent(JSON.stringify(projectIdentityKeys))}`,
    projectName: 'Combined Project Portfolio',
    projectNames,
    updates: evidenceScope.updates,
    scheduleItems: evidenceScope.scheduleItems,
    currentUpdate: evidenceScope.currentUpdate,
    ...supportingScope,
    projectIdentityKeys,
    projectTruthPersistencePolicy: COMBINED_REPORT_PROJECT_TRUTH_POLICY,
  };
}

/**
 * Daily reports may recover legacy area-only evidence only when the complete
 * schedule proves that area belongs to exactly one parent project.
 */
export function buildDailyReportAuthorityScope(
  input: CombinedReportAuthorityScopeInput & { selectedProjectName: string },
): DailyReportAuthorityScope {
  const projectName = cleanText(input.selectedProjectName);
  if (!projectName) throw new Error('A daily report requires one selected project.');
  const evidenceScope = buildEvidenceScope(input, [projectName], true);
  const supportingScope = buildSupportingEvidenceScope(input, [projectName], evidenceScope);
  return {
    projectName,
    projectNames: [projectName],
    updates: evidenceScope.updates,
    scheduleItems: evidenceScope.scheduleItems,
    currentUpdate: evidenceScope.currentUpdate,
    ...supportingScope,
  };
}

type ProjectIntelligenceScopeCache = {
  key: readonly unknown[];
  scope: DailyReportAuthorityScope;
  belongsToScope: (update: ProjectUpdate) => boolean;
};
let lastProjectIntelligenceScope: ProjectIntelligenceScopeCache | null = null;

type ProjectIntelligenceScopeInput =
  Omit<CombinedReportAuthorityScopeInput, 'selectedProjectNames'> & { selectedProjectName: string };

/**
 * Home, workspace and capture intelligence for ONE project (audit round 2
 * L2). They were given every project's updates, tasks and areas, so project
 * A's brief carried project B's overdue task, area and safety concern, and A's
 * saved Project Truth stored B's items. This is the daily report's evidence
 * scope, plus: the open draft when it belongs to the project, the areas the
 * project owns even before anything references them (capture needs them), and
 * the whole contact book (contacts belong to no project).
 *
 * The scope is kept while the saved collections are the same objects, so a
 * draft keystroke only re-checks the draft: new arrays on every keystroke
 * would defeat the authority signature's per-collection cache.
 */
export function buildProjectIntelligenceAuthorityScope(
  input: ProjectIntelligenceScopeInput,
): DailyReportAuthorityScope {
  const key = [
    normalizeKey(input.selectedProjectName),
    input.projectRecords,
    input.updates,
    input.scheduleItems,
    input.projectAreas,
    input.referenceDocuments,
    input.projectDocuments,
    input.captureMemories,
    input.contacts,
  ];
  const cached = lastProjectIntelligenceScope;
  const base = cached && cached.key.length === key.length && cached.key.every((value, index) => value === key[index])
    ? cached
    : buildProjectIntelligenceScopeBase(input, key);
  lastProjectIntelligenceScope = base;
  const currentUpdate = input.currentUpdate && base.belongsToScope(input.currentUpdate)
    ? input.currentUpdate
    : null;
  return currentUpdate === base.scope.currentUpdate ? base.scope : { ...base.scope, currentUpdate };
}

function buildProjectIntelligenceScopeBase(
  input: ProjectIntelligenceScopeInput,
  key: readonly unknown[],
): ProjectIntelligenceScopeCache {
  const projectName = cleanText(input.selectedProjectName);
  if (!projectName) throw new Error('Project intelligence requires one selected project.');
  const withoutDraft = { ...input, selectedProjectNames: [projectName], currentUpdate: null };
  const evidence = buildEvidenceScope(withoutDraft, [projectName], true);
  const supporting = buildSupportingEvidenceScope(withoutDraft, [projectName], evidence);
  const referencedAreas = new Set(supporting.projectAreas);
  const ownedAreas = new Set(projectAreasForProject({
    projectAreas: input.projectAreas || [],
    projectName,
    scheduleItems: evidence.scheduleItems,
    updates: evidence.updates,
  }));
  return {
    key,
    belongsToScope: evidence.belongsToScope,
    scope: {
      projectName,
      projectNames: [projectName],
      updates: evidence.updates,
      scheduleItems: evidence.scheduleItems,
      currentUpdate: null,
      projectAreas: (input.projectAreas || []).filter(area => referencedAreas.has(area) || ownedAreas.has(area)),
      referenceDocuments: supporting.referenceDocuments,
      projectDocuments: supporting.projectDocuments,
      captureMemories: supporting.captureMemories,
      contacts: input.contacts || { contacts: [] },
    },
  };
}

function buildEvidenceScope(
  input: CombinedReportAuthorityScopeInput,
  selectedProjectNames: readonly string[],
  allowUniquelyOwnedLegacyAreas: boolean,
) {
  const selectedProjectKeys = new Set(selectedProjectNames.map(normalizeKey));
  const knownParentKeys = new Set([
    ...selectedProjectKeys,
    ...input.projectRecords.map(record => normalizeKey(record.name)),
    ...input.scheduleItems
      .map(item => cleanText(item.scheduleProjectName))
      .filter((name): name is string => Boolean(name))
      .map(normalizeKey),
  ]);
  const areaOwners = buildScheduleAreaOwners(input.scheduleItems, knownParentKeys);
  const parentForScheduleItem = (item: ScheduleItem) => resolveScheduleParent(
    item,
    knownParentKeys,
    allowUniquelyOwnedLegacyAreas ? areaOwners : null,
  );
  const scopedScheduleItems = input.scheduleItems.filter(item => {
    const parent = parentForScheduleItem(item);
    return Boolean(parent && selectedProjectKeys.has(parent));
  });
  const scopedScheduleSet = new Set(scopedScheduleItems);
  const scheduleById = new Map<string, ScheduleItem[]>();
  input.scheduleItems.forEach(item => {
    const id = cleanText(item.id);
    if (!id) return;
    const matches = scheduleById.get(id) || [];
    matches.push(item);
    scheduleById.set(id, matches);
  });

  const updateBelongsToScope = (update: ProjectUpdate) => {
    // An archived update is out of every report at once (audit round 2 L4).
    if ((update as ProjectUpdate & { isArchived?: boolean }).isArchived === true) return false;
    const scheduleItemId = cleanText(update.scheduleItemId);
    if (scheduleItemId) {
      const matches = scheduleById.get(scheduleItemId) || [];
      return matches.length === 1 && scopedScheduleSet.has(matches[0]);
    }
    const scheduleProjectName = cleanText(update.scheduleProjectName);
    if (scheduleProjectName) {
      return selectedProjectKeys.has(normalizeKey(scheduleProjectName));
    }
    const projectName = cleanText(update.projectName);
    if (!projectName) return false;
    const projectKey = normalizeKey(projectName);
    if (selectedProjectKeys.has(projectKey)) return true;
    if (!allowUniquelyOwnedLegacyAreas) return false;
    const owners = areaOwners.get(projectKey);
    return owners?.size === 1 && owners.has(Array.from(selectedProjectKeys)[0]);
  };

  return {
    updates: input.updates.filter(updateBelongsToScope),
    scheduleItems: scopedScheduleItems,
    currentUpdate: input.currentUpdate && updateBelongsToScope(input.currentUpdate)
      ? input.currentUpdate
      : null,
    belongsToScope: updateBelongsToScope,
  };
}

function buildSupportingEvidenceScope(
  input: CombinedReportAuthorityScopeInput,
  selectedProjectNames: readonly string[],
  evidenceScope: ReturnType<typeof buildEvidenceScope>,
) {
  const selectedNameKeys = new Set(selectedProjectNames.map(normalizeKey));
  const selectedIdentityKeys = new Set<string>();
  selectedProjectNames.forEach(name => {
    selectedIdentityKeys.add(normalizeKey(name));
    selectedIdentityKeys.add(normalizeKey(legacyProjectId(name)));
  });
  input.projectRecords.forEach(record => {
    if (!selectedNameKeys.has(normalizeKey(record.name))) return;
    addOptionalKey(selectedIdentityKeys, record.id);
  });

  const scopedUpdatesAndCurrent = [
    ...evidenceScope.updates,
    ...(evidenceScope.currentUpdate ? [evidenceScope.currentUpdate] : []),
  ];
  const scopedUpdateIds = new Set(scopedUpdatesAndCurrent.map(update => update.id));
  const scopedAreaIds = new Set<string>();
  const scopedAreaNames = new Set<string>();
  scopedUpdatesAndCurrent.forEach(update => {
    addOptionalKey(scopedAreaIds, update.selectedAreaId);
    addOptionalKey(scopedAreaNames, update.selectedAreaName);
    update.photos.forEach(photo => {
      addOptionalKey(scopedAreaIds, photo.selectedAreaId);
      addOptionalKey(scopedAreaNames, photo.selectedAreaName);
    });
  });
  evidenceScope.scheduleItems.forEach(item => {
    addOptionalKey(scopedAreaNames, item.locationName);
  });

  const sourceDocumentIds = new Set<string>();
  const sourceBatchIds = new Set<string>();
  evidenceScope.scheduleItems.forEach(item => {
    addOptionalKey(sourceDocumentIds, item.sourceDocumentId);
    addOptionalKey(sourceBatchIds, item.importBatchId);
  });

  const referenceDocuments = (input.referenceDocuments || []).filter(document => {
    // Generated reports are outputs of project truth, never inputs to it. If a
    // saved report were admitted here, approving it would change its own
    // source fingerprint and immediately make the approval appear stale.
    if (normalizeKey(document.category) === 'report') return false;
    const explicitProjectId = cleanText(document.projectId);
    const explicitProjectName = cleanText(document.projectName);
    const explicitProjectNames = (document.projectNames ?? [])
      .map(cleanText)
      .filter((name): name is string => Boolean(name));
    if (explicitProjectId && !selectedIdentityKeys.has(normalizeKey(explicitProjectId))) return false;
    if (explicitProjectName && !selectedNameKeys.has(normalizeKey(explicitProjectName))) return false;
    if (explicitProjectNames.length > 0 && !explicitProjectNames.some(name => selectedNameKeys.has(normalizeKey(name)))) return false;
    if (explicitProjectId || explicitProjectName || explicitProjectNames.length > 0) return true;
    const documentId = cleanText(document.id);
    const importBatchId = cleanText(document.importBatchId);
    return Boolean(
      (documentId && sourceDocumentIds.has(normalizeKey(documentId))) ||
      (importBatchId && sourceBatchIds.has(normalizeKey(importBatchId))),
    );
  });
  const projectDocuments = (input.projectDocuments || []).filter(document => {
    const projectId = cleanText(document.projectId);
    if (projectId) return selectedIdentityKeys.has(normalizeKey(projectId));
    const updateId = cleanText(document.updateId);
    return Boolean(updateId && scopedUpdateIds.has(updateId));
  });
  const captureMemories = (input.captureMemories || []).filter(memory => {
    const projectName = cleanText(memory.recommendedProject.value);
    return Boolean(projectName && selectedNameKeys.has(normalizeKey(projectName)));
  });
  const recipientIds = new Set(
    scopedUpdatesAndCurrent.flatMap(update => update.recipients.contactIds),
  );
  const areaNameCounts = new Map<string, number>();
  (input.projectAreas || []).forEach(area => {
    const key = normalizeKey(area.name);
    areaNameCounts.set(key, (areaNameCounts.get(key) || 0) + 1);
  });

  return {
    projectAreas: (input.projectAreas || []).filter(area =>
      scopedAreaIds.has(normalizeKey(area.id)) || (
        scopedAreaNames.has(normalizeKey(area.name)) &&
        areaNameCounts.get(normalizeKey(area.name)) === 1
      ),
    ),
    referenceDocuments,
    projectDocuments,
    captureMemories,
    contacts: {
      contacts: (input.contacts?.contacts || []).filter(contact => recipientIds.has(contact.id)),
    },
  };
}

function buildScheduleAreaOwners(
  scheduleItems: readonly ScheduleItem[],
  knownParentKeys: ReadonlySet<string>,
) {
  const areaOwners = new Map<string, Set<string>>();
  scheduleItems.forEach(item => {
    const explicitParent = cleanText(item.scheduleProjectName);
    const projectName = cleanText(item.projectName);
    const parentKey = explicitParent
      ? normalizeKey(explicitParent)
      : projectName && knownParentKeys.has(normalizeKey(projectName))
        ? normalizeKey(projectName)
        : null;
    if (!parentKey) return;
    [item.locationName, projectName && normalizeKey(projectName) !== parentKey ? projectName : null]
      .map(cleanText)
      .filter((name): name is string => Boolean(name))
      .forEach(areaName => {
        const key = normalizeKey(areaName);
        const owners = areaOwners.get(key) || new Set<string>();
        owners.add(parentKey);
        areaOwners.set(key, owners);
      });
  });
  return areaOwners;
}

function resolveScheduleParent(
  item: ScheduleItem,
  knownParentKeys: ReadonlySet<string>,
  legacyAreaOwners: ReadonlyMap<string, ReadonlySet<string>> | null,
) {
  const explicitParent = cleanText(item.scheduleProjectName);
  if (explicitParent) return normalizeKey(explicitParent);
  const projectName = cleanText(item.projectName);
  if (projectName && knownParentKeys.has(normalizeKey(projectName))) {
    return normalizeKey(projectName);
  }
  if (!legacyAreaOwners) return null;
  const possibleOwners = new Set<string>();
  [projectName, cleanText(item.locationName)].forEach(areaName => {
    if (!areaName) return;
    legacyAreaOwners.get(normalizeKey(areaName))?.forEach(owner => possibleOwners.add(owner));
  });
  return possibleOwners.size === 1 ? Array.from(possibleOwners)[0] : null;
}

function immutableProjectIdentityKey(
  projectName: string,
  projectRecords: readonly ProjectRecord[],
) {
  const matches = projectRecords.filter(record =>
    normalizeKey(record.name) === normalizeKey(projectName),
  );
  const immutableIds = matches
    .map(record => cleanText(record.id))
    .filter((id): id is string => Boolean(id));
  if (matches.length === 1 && immutableIds.length === 1) {
    return `id:${immutableIds[0]}`;
  }
  return `legacy-name:${normalizeKey(projectName)}`;
}

function uniqueDisplayNames(names: readonly string[]) {
  const displayByKey = new Map<string, string>();
  names.forEach(name => {
    const cleaned = cleanText(name);
    if (cleaned && !displayByKey.has(normalizeKey(cleaned))) {
      displayByKey.set(normalizeKey(cleaned), cleaned);
    }
  });
  return Array.from(displayByKey.values());
}

function cleanText(value: string | null | undefined) {
  const cleaned = value?.trim();
  return cleaned || null;
}

function normalizeKey(value: string) {
  return value.trim().toLowerCase();
}

function addOptionalKey(target: Set<string>, value: string | null | undefined) {
  const cleaned = cleanText(value);
  if (cleaned) target.add(normalizeKey(cleaned));
}

function legacyProjectId(projectName: string) {
  return `project-${projectName.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'unassigned'}`;
}
