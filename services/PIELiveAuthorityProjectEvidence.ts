import type {
  ProjectArea,
  ProjectUpdate,
  ReferenceDocument,
  ScheduleItem,
} from '../types';
import type { DAVEConfirmedCaptureMemory } from './DAVECaptureMemory';
import type { DAVEDailyBriefDocument } from './DAVEDailyBrief';
import { projectAreasForProject } from './DAVEProjectAreaScope';
import { projectUpdatesForParentProject } from './DAVEProjectUpdateScope';
import type { ProjectRecord } from './ProjectCoverPhotoService';
import type {
  CombinedReportAuthorityScope,
  DailyReportAuthorityScope,
} from './ReportAuthorityScope';
import { scheduleTasksForParentProject } from './dave-project-schedule-rollup';

type ReportEvidenceScope = DailyReportAuthorityScope | CombinedReportAuthorityScope;

export type PIELiveAuthorityProjectEvidence = Readonly<{
  updates: ProjectUpdate[];
  scheduleItems: ScheduleItem[];
  currentUpdate: ProjectUpdate | null;
  projectAreas: ProjectArea[];
  referenceDocuments: ReferenceDocument[];
  projectDocuments: DAVEDailyBriefDocument[];
  captureMemories: DAVEConfirmedCaptureMemory[];
}>;

/**
 * Produces one exact project evidence set. Missing or ambiguous project
 * authority returns no project-owned evidence rather than a portfolio-wide
 * fallback.
 */
export function buildExactPIELiveAuthorityProjectEvidence(input: Readonly<{
  reportScope: ReportEvidenceScope | null;
  project: ProjectRecord | null;
  projectRecords: readonly ProjectRecord[];
  updates: readonly ProjectUpdate[];
  scheduleItems: readonly ScheduleItem[];
  currentUpdate: ProjectUpdate | null;
  projectAreas: readonly ProjectArea[];
  referenceDocuments: readonly ReferenceDocument[];
  projectDocuments: readonly DAVEDailyBriefDocument[];
  captureMemories: readonly DAVEConfirmedCaptureMemory[];
}>): PIELiveAuthorityProjectEvidence {
  if (input.reportScope) {
    return copyReportScope(input.reportScope);
  }

  const projectId = immutableProjectId(input.project?.id);
  if (!projectId || !input.project) return emptyEvidence();

  const scheduleItems = scheduleTasksForParentProject(
    input.project.name,
    [...input.scheduleItems],
    projectId,
  );
  const updates = projectUpdatesForParentProject(
    input.updates,
    input.project.name,
    input.scheduleItems,
    projectId,
  );
  const sameNameProjectCount = input.projectRecords.filter(record =>
    normalizeName(record.name) === normalizeName(input.project!.name)
  ).length;

  return {
    updates,
    scheduleItems,
    currentUpdate: immutableProjectId(input.currentUpdate?.projectId) === projectId
      ? input.currentUpdate
      : null,
    projectAreas: sameNameProjectCount === 1
      ? projectAreasForProject({
          projectAreas: input.projectAreas,
          projectName: input.project.name,
          scheduleItems,
          updates,
        })
      : [],
    referenceDocuments: input.referenceDocuments.filter(document =>
      immutableProjectId(document.projectId) === projectId
    ),
    projectDocuments: input.projectDocuments.filter(document =>
      immutableProjectId(document.projectId) === projectId
    ),
    captureMemories: input.captureMemories.filter(memory =>
      immutableProjectId(memory.projectId) === projectId
    ),
  };
}

function copyReportScope(scope: ReportEvidenceScope): PIELiveAuthorityProjectEvidence {
  return {
    updates: [...scope.updates],
    scheduleItems: [...scope.scheduleItems],
    currentUpdate: scope.currentUpdate,
    projectAreas: [...scope.projectAreas],
    referenceDocuments: [...scope.referenceDocuments],
    projectDocuments: [...scope.projectDocuments],
    captureMemories: [...scope.captureMemories],
  };
}

function emptyEvidence(): PIELiveAuthorityProjectEvidence {
  return {
    updates: [],
    scheduleItems: [],
    currentUpdate: null,
    projectAreas: [],
    referenceDocuments: [],
    projectDocuments: [],
    captureMemories: [],
  };
}

function immutableProjectId(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 && value === value.trim()
    ? value
    : null;
}

function normalizeName(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}
