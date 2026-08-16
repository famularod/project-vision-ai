import type { ProjectUpdate, ReferenceDocument, ScheduleItem } from '../types';
import type { DAVEConfirmedCaptureMemory } from './DAVECaptureMemory';
import type { DAVEDailyBriefDocument } from './DAVEDailyBrief';
import type { DAVEProjectIntelligence } from './DAVEIntelligence';
import { buildDAVEProjectTruth } from './DAVEProjectTruth';
import { projectUpdatesForParentProject } from './DAVEProjectUpdateScope';
import { scheduleProjectScopeNames } from './PIEScheduleImportBatch';
import { scheduleTasksForParentProject } from './dave-project-schedule-rollup';

type ECOSTalkProjectIntelligenceInput = Readonly<{
  projectId: string;
  projectName: string;
  taskId?: string | null;
  legacyNameScopeIsUnambiguous: boolean;
  updates: readonly ProjectUpdate[];
  scheduleItems: readonly ScheduleItem[];
  projectDocuments: readonly DAVEDailyBriefDocument[];
  referenceDocuments: readonly ReferenceDocument[];
  captureMemories: readonly DAVEConfirmedCaptureMemory[];
}>;

/** Builds one project-scoped, evidence-backed intelligence view for Talk. */
export function buildECOSTalkProjectIntelligence({
  projectId,
  projectName,
  taskId = null,
  legacyNameScopeIsUnambiguous,
  updates,
  scheduleItems,
  projectDocuments,
  referenceDocuments,
  captureMemories,
}: ECOSTalkProjectIntelligenceInput): DAVEProjectIntelligence {
  const legacyProjectId = projectAuthorityId(projectName);
  const usesBoundedLegacyAuthority = legacyNameScopeIsUnambiguous && projectId === legacyProjectId;
  const selectedProjectId = usesBoundedLegacyAuthority ? undefined : projectId;
  const mutableScheduleItems = [...scheduleItems];
  const safeCaptureMemories = captureMemories.filter(memory => memory.projectId === projectId);
  const projectScheduleItems = scheduleTasksForParentProject(
    projectName,
    mutableScheduleItems,
    selectedProjectId,
  );
  const scopeNames = scheduleProjectScopeNames(projectName, projectScheduleItems);
  const scopedUpdates = projectUpdatesForParentProject(
    updates,
    projectName,
    mutableScheduleItems,
    selectedProjectId,
  )
    .map(update => ({ ...update, projectName }));
  const scopeIds = new Set<string>([projectId]);
  // Legacy name-derived document identities remain readable only when the
  // selected project itself is that legacy identity. An immutable cloud ID
  // must never widen to another same-name project's documents.
  if (projectId === legacyProjectId) {
    scopeNames.forEach(name => {
      scopeIds.add(name);
      scopeIds.add(projectAuthorityId(name));
    });
  }
  const scopedDocuments = projectDocuments
    .filter(document => !document.isArchived && Boolean(document.projectId && scopeIds.has(document.projectId)))
    .map(document => ({ ...document, projectId }));
  const normalizedProjectScheduleItems = projectScheduleItems
    .map(item => ({ ...item, projectName }));

  return buildDAVEProjectTruth({
    projectId,
    projectName,
    updates: scopedUpdates,
    scheduleItems: taskId
      ? normalizedProjectScheduleItems.filter(item => item.id === taskId)
      : normalizedProjectScheduleItems,
    projectDocuments: scopedDocuments,
    referenceDocuments: [...referenceDocuments],
    captureMemories: safeCaptureMemories,
  }).intelligence;
}

function projectAuthorityId(projectName: string) {
  const normalized = projectName.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `project-${normalized || 'unassigned'}`;
}
