import type { ProjectArea } from '../types';
import type {
  DAVEDailyBriefScheduleItem,
  DAVEDailyBriefUpdate,
  DAVEBriefSourceType,
} from './DAVEDailyBrief';
import type { DAVEProjectIntelligence } from './DAVEIntelligence';
import {
  DEFAULT_PROJECT_TIME_ZONE,
  plainDateDueState,
  type ProjectTimeZone,
} from './ProjectDateTime';

export const DAVE_PROJECT_WALK_VERSION = 'dave-project-walk/1.0' as const;

const CLEAR_AREA_DISTANCE_FEET = 75;
const METERS_TO_FEET = 3.28084;

export type DAVEProjectWalkLocationInput =
  | Readonly<{ status: 'checking' }>
  | Readonly<{ status: 'unavailable' }>
  | Readonly<{
      status: 'resolved';
      latitude: number;
      longitude: number;
      accuracyMeters: number | null;
    }>;

export type DAVEProjectWalkLocationStatus =
  | 'checking'
  | 'matched'
  | 'ambiguous'
  | 'outside_mapped_area'
  | 'unavailable'
  | 'not_configured';

export type DAVEProjectWalkPrompt = Readonly<{
  guidance: string;
  whyItMatters: string;
  sourceType: DAVEBriefSourceType;
  sourceRecordId: string;
  areaSpecific: boolean;
}>;

export type DAVEProjectWalkContext = Readonly<{
  schemaVersion: typeof DAVE_PROJECT_WALK_VERSION;
  projectName: string;
  locationStatus: DAVEProjectWalkLocationStatus;
  locationMessage: string;
  recommendedArea: Readonly<{
    id: string;
    name: string;
    confidence: 'high' | 'medium';
    distanceFeet: number;
  }> | null;
  prompt: DAVEProjectWalkPrompt;
}>;

export type DAVEProjectWalkScheduleItem = DAVEDailyBriefScheduleItem & Readonly<{
  locationName?: string;
  finishDate?: string;
  priority?: string;
}>;

export type BuildDAVEProjectWalkContextInput = Readonly<{
  projectName: string;
  projectAreas: readonly ProjectArea[];
  location: DAVEProjectWalkLocationInput;
  updates: readonly DAVEDailyBriefUpdate[];
  scheduleItems: readonly DAVEProjectWalkScheduleItem[];
  intelligence: DAVEProjectIntelligence;
  now?: string;
  projectTimeZone?: ProjectTimeZone | string;
}>;

type PromptCandidate = DAVEProjectWalkPrompt & Readonly<{
  rank: number;
  tieBreak: string;
}>;

export function buildDAVEProjectWalkContext(
  input: BuildDAVEProjectWalkContextInput,
): DAVEProjectWalkContext {
  const location = resolveLocation(input.projectAreas, input.location);
  const prompt = selectPrompt({
    ...input,
    areaName: location.recommendedArea?.name ?? null,
  });

  return deepFreeze({
    schemaVersion: DAVE_PROJECT_WALK_VERSION,
    projectName: clean(input.projectName),
    locationStatus: location.status,
    locationMessage: location.message,
    recommendedArea: location.recommendedArea,
    prompt,
  });
}

function resolveLocation(
  projectAreas: readonly ProjectArea[],
  location: DAVEProjectWalkLocationInput,
) {
  const mappedAreas = projectAreas.filter(area =>
    Boolean(area.locationCapturedAt) &&
    finite(area.latitude) &&
    finite(area.longitude) &&
    finite(area.radiusFeet) &&
    area.radiusFeet > 0,
  );
  if (mappedAreas.length === 0) {
    return locationResult('not_configured', 'No project areas have saved field GPS yet.', null);
  }
  if (location.status === 'checking') {
    return locationResult('checking', 'Checking which mapped area is nearby…', null);
  }
  if (location.status === 'unavailable') {
    return locationResult('unavailable', 'Location is unavailable. Choose the area during review.', null);
  }

  const matches = mappedAreas
    .map(area => ({ area, distanceFeet: distanceFeet(location, area) }))
    .sort((a, b) => a.distanceFeet - b.distanceFeet);
  const withinRadius = matches.filter(match => match.distanceFeet <= match.area.radiusFeet);
  const first = withinRadius[0];
  const second = withinRadius[1];
  if (!first) {
    return locationResult(
      'outside_mapped_area',
      'You are outside the saved project-area boundaries. Choose the area during review.',
      null,
    );
  }
  if (second && second.distanceFeet - first.distanceFeet < CLEAR_AREA_DISTANCE_FEET) {
    return locationResult(
      'ambiguous',
      'More than one mapped area is nearby. Choose the area during review.',
      null,
    );
  }

  const accuracyFeet = finite(location.accuracyMeters)
    ? Math.max(0, location.accuracyMeters) * METERS_TO_FEET
    : null;
  const confidence = accuracyFeet !== null &&
    accuracyFeet <= CLEAR_AREA_DISTANCE_FEET &&
    first.distanceFeet + accuracyFeet <= first.area.radiusFeet
    ? 'high' as const
    : 'medium' as const;
  return locationResult(
    'matched',
    `Likely area: ${first.area.name}. Confirm or correct it before saving.`,
    {
      id: first.area.id,
      name: first.area.name,
      confidence,
      distanceFeet: first.distanceFeet,
    },
  );
}

function locationResult(
  status: DAVEProjectWalkLocationStatus,
  message: string,
  recommendedArea: DAVEProjectWalkContext['recommendedArea'],
) {
  return { status, message, recommendedArea };
}

function selectPrompt(
  input: BuildDAVEProjectWalkContextInput & Readonly<{ areaName: string | null }>,
): DAVEProjectWalkPrompt {
  const projectKey = key(input.projectName);
  const areaKey = key(input.areaName ?? '');
  const updates = input.updates.filter(update => key(update.projectName) === projectKey);
  const nowDate = validDate(input.now) ?? new Date();
  const candidates: PromptCandidate[] = [];

  if (areaKey) {
    for (const update of updates) {
      for (const photo of update.photos) {
        if (key(photo.selectedAreaName || update.selectedAreaName || '') !== areaKey) continue;
        if (!isOpenIssue(photo.category, photo.actionStatus)) continue;
        const action = clean(photo.actionRequired);
        const safety = photo.category === 'Safety Concern';
        const overdue = isPastDate(photo.actionDueDate, nowDate, input.projectTimeZone);
        candidates.push({
          rank: safety ? 0 : overdue ? 1 : 3,
          tieBreak: `${update.date}:${photo.id}`,
          guidance: safety
            ? action
              ? `Confirm the current safety status: ${action}`
              : 'Confirm the current safety condition and responsible owner.'
            : action
              ? `Confirm the current status of: ${action}`
              : 'Check the recorded open issue and capture its current status.',
          whyItMatters: safety
            ? `A saved photo in ${input.areaName} records a safety concern that is not closed.`
            : overdue
              ? `A saved action in ${input.areaName} is still open after its recorded due date.`
              : `A saved photo in ${input.areaName} records an unresolved issue.`,
          sourceType: safety ? 'issue' : 'photo',
          sourceRecordId: photo.id,
          areaSpecific: true,
        });
      }
    }

    for (const item of input.scheduleItems) {
      if (key(item.projectName) !== projectKey || key(item.locationName ?? '') !== areaKey) continue;
      if (key(item.status) === 'complete') continue;
      const overdue = isPastDate(
        item.finishDate,
        nowDate,
        item.projectTimeZone || input.projectTimeZone,
      );
      const highPriority = key(item.priority ?? '') === 'high';
      candidates.push({
        rank: overdue ? 1 : highPriority || key(item.status) === 'waiting' ? 2 : 5,
        tieBreak: `${item.finishDate || '9999-12-31'}:${item.id}`,
        guidance: `Check the current field status of ${clean(item.taskName) || 'the scheduled work'}.`,
        whyItMatters: overdue
          ? `The schedule records this ${input.areaName} work as unfinished after ${item.finishDate}.`
          : `The schedule records this ${input.areaName} work as ${clean(item.status) || 'not complete'}.`,
        sourceType: 'schedule',
        sourceRecordId: item.id,
        areaSpecific: true,
      });
    }

    for (const commitment of input.intelligence.commitments) {
      if (commitment.status === 'Completed') continue;
      const update = updates.find(item => item.id === commitment.sourceUpdateId);
      const photo = update?.photos.find(item => item.id === commitment.sourcePhotoId);
      const commitmentArea = photo?.selectedAreaName || update?.selectedAreaName || '';
      if (key(commitmentArea) !== areaKey) continue;
      candidates.push({
        rank: commitment.status === 'Overdue' ? 1 : 4,
        tieBreak: `${commitment.dueDate || '9999-12-31'}:${commitment.id}`,
        guidance: `Confirm the current status of the commitment: ${commitment.description}`,
        whyItMatters: commitment.status === 'Overdue'
          ? 'The recorded due date has passed and no completed status is saved.'
          : 'The commitment remains open in the project record.',
        sourceType: commitment.sourceMemoryId
          ? 'memory'
          : commitment.sourcePhotoId
            ? 'photo'
            : 'update',
        sourceRecordId: commitment.sourceMemoryId || commitment.sourcePhotoId || commitment.sourceUpdateId,
        areaSpecific: true,
      });
    }
  }

  const selectedAreaPrompt = candidates
    .sort((a, b) => a.rank - b.rank || a.tieBreak.localeCompare(b.tieBreak))[0];
  if (selectedAreaPrompt) return withoutRanking(selectedAreaPrompt);

  const actionCenter = input.intelligence.actionCenter;
  const source = actionCenter.supportingEvidence[0];
  if (source && actionCenter.recommendedAction) {
    return {
      guidance: actionCenter.recommendedAction,
      whyItMatters: actionCenter.reason,
      sourceType: source.sourceType,
      sourceRecordId: source.recordId,
      areaSpecific: false,
    };
  }

  const uncertainty = input.intelligence.dailyBrief.uncertaintyItems[0];
  if (uncertainty) {
    return {
      guidance: `Capture what you can verify about: ${uncertainty.text}`,
      whyItMatters: uncertainty.limitations[0] || 'Current field evidence would reduce project uncertainty.',
      sourceType: uncertainty.sourceType,
      sourceRecordId: uncertainty.sourceRecordId,
      areaSpecific: false,
    };
  }

  return {
    guidance: input.areaName
      ? `Record what changed, what is blocked, or what needs follow-up in ${input.areaName}.`
      : 'Record what changed, what is blocked, or what needs follow-up here.',
    whyItMatters: 'A current field observation strengthens the project record without assuming work is complete.',
    sourceType: 'project',
    sourceRecordId: input.intelligence.projectId,
    areaSpecific: Boolean(input.areaName),
  };
}

function withoutRanking(candidate: PromptCandidate): DAVEProjectWalkPrompt {
  const { rank: _rank, tieBreak: _tieBreak, ...prompt } = candidate;
  return prompt;
}

function isOpenIssue(category: string, status: string | undefined) {
  return (category === 'Open Issue' || category === 'Safety Concern') && status !== 'Closed';
}

function isPastDate(
  value: string | null | undefined,
  now: Date,
  projectTimeZone: ProjectTimeZone | string = DEFAULT_PROJECT_TIME_ZONE,
) {
  return plainDateDueState(value, now, projectTimeZone) === 'overdue';
}

function validDateOnly(value: string | null | undefined) {
  const text = clean(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const parsed = new Date(`${text}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === text ? text : null;
}

function validDate(value: string | undefined) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function distanceFeet(
  from: Pick<Extract<DAVEProjectWalkLocationInput, { status: 'resolved' }>, 'latitude' | 'longitude'>,
  to: Pick<ProjectArea, 'latitude' | 'longitude'>,
) {
  const earthRadiusFeet = 20902231;
  const radians = (value: number) => (value * Math.PI) / 180;
  const latitudeDelta = radians(to.latitude - from.latitude);
  const longitudeDelta = radians(to.longitude - from.longitude);
  const haversine = Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(radians(from.latitude)) * Math.cos(radians(to.latitude)) * Math.sin(longitudeDelta / 2) ** 2;
  return earthRadiusFeet * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function clean(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function key(value: string) {
  return clean(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function deepFreeze<T>(value: T, seen = new Set<object>()): T {
  if (!value || typeof value !== 'object') return value;
  const objectValue = value as object;
  if (seen.has(objectValue)) return value;
  seen.add(objectValue);
  Object.values(objectValue).forEach(item => deepFreeze(item, seen));
  return Object.freeze(value);
}
