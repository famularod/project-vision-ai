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
  updates,
  scheduleItems,
  projectDocuments,
  referenceDocuments,
  captureMemories,
}: ECOSTalkProjectIntelligenceInput): DAVEProjectIntelligence {
  const mutableScheduleItems = [...scheduleItems];
  const scopeNames = scheduleProjectScopeNames(projectName, mutableScheduleItems);
  const scopedUpdates = (scheduleItems.length > 0
    ? projectUpdatesForParentProject(updates, projectName, scheduleItems)
    : updates.filter(update => scopeNames.some(name => sameName(update.projectName, name))))
    .map(update => ({ ...update, projectName }));
  const scopeIds = new Set(scopeNames.flatMap(name => [name, projectAuthorityId(name)]));
  const scopedDocuments = projectDocuments
    .filter(document => !document.isArchived && Boolean(document.projectId && scopeIds.has(document.projectId)))
    .map(document => ({ ...document, projectId }));
  const projectScheduleItems = scheduleTasksForParentProject(projectName, mutableScheduleItems)
    .map(item => ({ ...item, projectName }));

  return buildDAVEProjectTruth({
    projectId,
    projectName,
    updates: scopedUpdates,
    scheduleItems: taskId
      ? projectScheduleItems.filter(item => item.id === taskId)
      : projectScheduleItems,
    projectDocuments: scopedDocuments,
    referenceDocuments: [...referenceDocuments],
    captureMemories,
  }).intelligence;
}

function sameName(left: string | null | undefined, right: string | null | undefined) {
  return (left || '').trim().toLowerCase() === (right || '').trim().toLowerCase();
}

function projectAuthorityId(projectName: string) {
  const normalized = projectName.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `project-${normalized || 'unassigned'}`;
}
