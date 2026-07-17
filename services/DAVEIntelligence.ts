import { buildProjectActionCenter, type DAVEProjectActionCenter } from './DAVEProjectActionCenter';
import { buildProjectCommitments, type DAVEProjectCommitment } from './DAVEProjectCommitments';
import {
  buildProjectDailyBrief,
  type DAVEDailyBriefDocument,
  type DAVEDailyBriefScheduleItem,
  type DAVEDailyBriefUpdate,
  type DAVEProjectDailyBrief,
} from './DAVEDailyBrief';
import { buildProjectEvidenceQuality, type DAVEProjectEvidenceQuality } from './DAVEProjectEvidenceQuality';
import { buildProjectReality, type DAVEProjectReality } from './DAVEProjectReality';
import type { DAVEProjectTimelineEvent } from './DAVEProjectTimeline';
import type { DAVEConfirmedCaptureMemory } from './DAVECaptureMemory';
import {
  buildDAVEProjectScheduleRollup,
  scheduleTaskIsComplete,
  type DAVEProjectScheduleHealth,
} from './dave-project-schedule-rollup';
import type { ScheduleItem } from '../types';
import { parseFlexibleDate } from '../utils/date';

export type BuildProjectIntelligenceInput = {
  projectId: string;
  projectName: string;
  projectCreatedAt?: string | null;
  updates: DAVEDailyBriefUpdate[];
  documents: DAVEDailyBriefDocument[];
  scheduleItems: DAVEDailyBriefScheduleItem[];
  captureMemories?: readonly DAVEConfirmedCaptureMemory[];
  now?: string;
  staleAfterDays?: number;
};

export type DAVEProjectIntelligence = {
  schemaVersion: 'dave-intelligence/1.0';
  projectId: string;
  generatedAt: string;
  projectReality: DAVEProjectReality;
  timeline: DAVEProjectTimelineEvent[];
  dailyBrief: DAVEProjectDailyBrief;
  actionCenter: DAVEProjectActionCenter;
  commitments: DAVEProjectCommitment[];
  evidenceQuality: DAVEProjectEvidenceQuality;
  scheduleSummary: DAVEProjectScheduleSummary;
};

export type DAVEProjectScheduleTaskSummary = {
  id: string;
  taskName: string;
  status: string;
  percentComplete: number;
  finishDate: string | null;
  owner: string | null;
};

export type DAVEProjectScheduleSummary = {
  health: DAVEProjectScheduleHealth;
  healthReason: string;
  taskCount: number;
  completedCount: number;
  overdueCount: number;
  dueSoonCount: number;
  waitingCount: number;
  percentComplete: number;
  forecastFinishDate: string | null;
  overdueTasks: DAVEProjectScheduleTaskSummary[];
  dueSoonTasks: DAVEProjectScheduleTaskSummary[];
};

export function buildProjectIntelligence(input: BuildProjectIntelligenceInput): DAVEProjectIntelligence {
  const projectReality = buildProjectReality({
    projectId: input.projectId,
    projectName: input.projectName,
    projectCreatedAt: input.projectCreatedAt,
    updates: input.updates,
    documents: input.documents,
    scheduleItems: input.scheduleItems,
    captureMemories: input.captureMemories,
    now: input.now,
  });
  const timeline = projectReality.timelineEvents;
  const dailyBrief = buildProjectDailyBrief({
    reality: projectReality,
    timeline,
    staleAfterDays: input.staleAfterDays,
  });
  const actionCenter = buildProjectActionCenter({ reality: projectReality });
  const commitments = buildProjectCommitments({ reality: projectReality });
  const evidenceQuality = buildProjectEvidenceQuality({ reality: projectReality });
  const scheduleSummary = buildScheduleSummary(input);

  return deepFreeze({
    schemaVersion: 'dave-intelligence/1.0',
    projectId: projectReality.projectId,
    generatedAt: projectReality.generatedAt,
    projectReality,
    timeline,
    dailyBrief,
    actionCenter,
    commitments,
    evidenceQuality,
    scheduleSummary,
  });
}

function buildScheduleSummary(input: BuildProjectIntelligenceInput): DAVEProjectScheduleSummary {
  const now = validDate(input.now) ?? new Date();
  const scheduleItems = input.scheduleItems.map(item => normalizeScheduleItem(item, input.projectName));
  const rollup = buildDAVEProjectScheduleRollup({
    projectName: input.projectName,
    items: scheduleItems,
    now,
  });
  const incomplete = rollup.tasks.filter(item => !scheduleTaskIsComplete(item));
  const relativeDays = (value: string) => {
    const parsed = parseFlexibleDate(value);
    if (!parsed) return null;
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);
    parsed.setHours(0, 0, 0, 0);
    return Math.round((parsed.getTime() - today.getTime()) / 86_400_000);
  };
  const taskSummary = (item: ScheduleItem): DAVEProjectScheduleTaskSummary => ({
    id: item.id,
    taskName: item.taskName,
    status: item.status,
    percentComplete: item.percentComplete,
    finishDate: item.finishDate || null,
    owner: item.owner || null,
  });
  const byFinishDate = (left: ScheduleItem, right: ScheduleItem) =>
    (parseFlexibleDate(left.finishDate)?.getTime() ?? Number.MAX_SAFE_INTEGER) -
    (parseFlexibleDate(right.finishDate)?.getTime() ?? Number.MAX_SAFE_INTEGER);

  return {
    health: rollup.health,
    healthReason: rollup.healthReason,
    taskCount: rollup.taskCount,
    completedCount: rollup.completedCount,
    overdueCount: rollup.overdueCount,
    dueSoonCount: rollup.dueSoonCount,
    waitingCount: rollup.waitingCount,
    percentComplete: rollup.percentComplete,
    forecastFinishDate: rollup.forecastFinishDate,
    overdueTasks: incomplete
      .filter(item => (relativeDays(item.finishDate) ?? 0) < 0)
      .sort(byFinishDate)
      .slice(0, 5)
      .map(taskSummary),
    dueSoonTasks: incomplete
      .filter(item => {
        const days = relativeDays(item.finishDate);
        return days !== null && days >= 0 && days <= 7;
      })
      .sort(byFinishDate)
      .slice(0, 5)
      .map(taskSummary),
  };
}

function normalizeScheduleItem(
  item: DAVEDailyBriefScheduleItem,
  projectName: string,
): ScheduleItem {
  const status: ScheduleItem['status'] = item.status === 'Complete' ||
    item.status === 'In Progress' || item.status === 'Waiting'
    ? item.status
    : 'Not Started';
  const priority: ScheduleItem['priority'] = item.priority === 'High' || item.priority === 'Medium'
    ? item.priority
    : 'Low';
  return {
    id: item.id,
    scheduleProjectName: item.scheduleProjectName ?? item.projectName,
    projectName: item.projectName,
    locationName: item.locationName || '',
    taskName: item.taskName,
    startDate: item.startDate || '',
    finishDate: item.finishDate || '',
    milestone: item.milestone || '',
    owner: item.owner || '',
    contractor: item.contractor || '',
    durationDays: item.durationDays ?? null,
    percentComplete: typeof item.percentComplete === 'number'
      ? item.percentComplete
      : status === 'Complete' ? 100 : 0,
    priority,
    status,
    notes: item.notes || '',
    importedAt: item.importedAt || null,
    createdAt: item.createdAt,
  };
}

function validDate(value: string | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function deepFreeze<T>(value: T, seen = new Set<object>()): T {
  if (!value || typeof value !== 'object') return value;
  const objectValue = value as object;
  if (seen.has(objectValue)) return value;
  seen.add(objectValue);
  Object.values(objectValue).forEach(item => deepFreeze(item, seen));
  return Object.freeze(value);
}
