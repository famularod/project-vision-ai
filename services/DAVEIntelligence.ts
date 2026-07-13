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
  });
}

function deepFreeze<T>(value: T, seen = new Set<object>()): T {
  if (!value || typeof value !== 'object') return value;
  const objectValue = value as object;
  if (seen.has(objectValue)) return value;
  seen.add(objectValue);
  Object.values(objectValue).forEach(item => deepFreeze(item, seen));
  return Object.freeze(value);
}
