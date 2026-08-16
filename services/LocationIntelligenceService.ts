import type {
  ProjectArea,
  ProjectUpdate,
  ScheduleItem,
  UpdatePhoto,
} from '../types';

export type ProjectLocationConfidence = 'low' | 'medium' | 'high';
export type ProjectPresenceStatus = 'on-site' | 'off-site' | 'unknown';
export type ProjectLocationSource =
  | 'current-draft'
  | 'typed-update'
  | 'photo'
  | 'schedule'
  | 'project-area'
  | 'none';

export type ProjectLocationIntelligence = {
  projectName: string;
  currentArea: string | null;
  buildingName: string | null;
  gpsStatus: string;
  lastKnownLocation: string;
  presenceStatus: ProjectPresenceStatus;
  presenceLabel: string;
  confidence: ProjectLocationConfidence;
  confidenceScore: number;
  needsConfirmation: boolean;
  confirmationPrompt: string | null;
  source: ProjectLocationSource;
  evidence: string[];
};

export type AnalyzeProjectLocationIntelligenceParams = {
  projectName: string;
  updates: ProjectUpdate[];
  scheduleItems: ScheduleItem[];
  currentUpdate?: ProjectUpdate | null;
  projectAreas?: ProjectArea[];
  now?: Date;
};

export type DetectLikelyActiveProjectParams = Omit<
  AnalyzeProjectLocationIntelligenceParams,
  'projectName'
> & {
  projectNames: string[];
};

type LocationCandidate = {
  areaId: string | null;
  areaName: string | null;
  gpsLatitude: number | null;
  gpsLongitude: number | null;
  gpsAccuracy: number | null;
  distanceFromSelectedAreaFeet: number | null;
  locationCapturedAt: string | null;
  occurredAt: string | null;
  source: ProjectLocationSource;
};

const UNKNOWN_LOCATION = 'Unknown';

export function analyzeProjectLocationIntelligence({
  projectName,
  updates,
  scheduleItems,
  currentUpdate,
  projectAreas = [],
  now = new Date(),
}: AnalyzeProjectLocationIntelligenceParams): ProjectLocationIntelligence {
  const projectUpdates = relatedProjectUpdates({
    projectName,
    updates,
    currentUpdate,
  });
  const projectScheduleItems = relatedScheduleItems(projectName, scheduleItems);
  const candidates = locationCandidates(projectUpdates);
  const latestCandidate = candidates[0] ?? null;
  const scheduleArea = firstScheduleArea(projectScheduleItems);
  const currentArea =
    latestCandidate?.areaName ||
    scheduleArea ||
    null;
  const matchedArea = findMatchedArea({
    projectAreas,
    areaId: latestCandidate?.areaId ?? null,
    areaName: currentArea,
  });
  const buildingName = matchedArea?.building?.trim() || null;
  const gpsCaptured = Boolean(
    latestCandidate?.gpsLatitude !== null &&
      latestCandidate?.gpsLatitude !== undefined &&
      latestCandidate?.gpsLongitude !== null &&
      latestCandidate?.gpsLongitude !== undefined,
  );
  const areaHasGps = Boolean(matchedArea?.locationCapturedAt);
  const lastKnownLocation = locationLabel({
    buildingName,
    areaName: currentArea,
    gpsCaptured,
  });
  const presenceStatus = projectPresenceStatus({
    candidate: latestCandidate,
    matchedArea,
  });
  const confidenceScore = locationConfidenceScore({
    projectName,
    currentArea,
    scheduleArea,
    buildingName,
    gpsCaptured,
    areaHasGps,
    latestCandidate,
    now,
  });
  const confidence = confidenceLevel(confidenceScore);
  const source =
    latestCandidate?.source ||
    (scheduleArea ? 'schedule' : matchedArea ? 'project-area' : 'none');
  const evidence = locationEvidence({
    currentArea,
    buildingName,
    gpsCaptured,
    areaHasGps,
    scheduleArea,
    latestCandidate,
    presenceStatus,
    confidenceScore,
  });
  const needsConfirmation =
    confidence !== 'high' && lastKnownLocation !== UNKNOWN_LOCATION;

  return {
    projectName,
    currentArea,
    buildingName,
    gpsStatus: gpsStatus({
      gpsCaptured,
      areaHasGps,
      accuracy: latestCandidate?.gpsAccuracy ?? null,
      currentArea,
    }),
    lastKnownLocation,
    presenceStatus,
    presenceLabel: presenceLabel(presenceStatus),
    confidence,
    confidenceScore,
    needsConfirmation,
    confirmationPrompt: needsConfirmation
      ? `I believe you're at ${confirmationLocationLabel({
          buildingName,
          areaName: currentArea,
          fallback: lastKnownLocation,
        })}. Is that correct?`
      : null,
    source,
    evidence,
  };
}

export function detectLikelyActiveProjectByLocation({
  projectNames,
  updates,
  scheduleItems,
  currentUpdate,
  projectAreas = [],
  now = new Date(),
}: DetectLikelyActiveProjectParams): ProjectLocationIntelligence | null {
  const ranked = projectNames
    .map(projectName =>
      analyzeProjectLocationIntelligence({
        projectName,
        updates,
        scheduleItems,
        currentUpdate,
        projectAreas,
        now,
      }),
    )
    .filter(location => location.confidenceScore > 0)
    .sort((left, right) => right.confidenceScore - left.confidenceScore);

  return ranked[0] ?? null;
}

function relatedProjectUpdates({
  projectName,
  updates,
  currentUpdate,
}: {
  projectName: string;
  updates: ProjectUpdate[];
  currentUpdate?: ProjectUpdate | null;
}) {
  const related = updates.filter(update =>
    projectNameMatches(update.projectName, projectName),
  );

  if (
    currentUpdate &&
    projectNameMatches(currentUpdate.projectName, projectName)
  ) {
    related.unshift(currentUpdate);
  }

  return related.sort(
    (left, right) =>
      dateTimeValue(right.locationCapturedAt || right.date) -
      dateTimeValue(left.locationCapturedAt || left.date),
  );
}

function relatedScheduleItems(projectName: string, scheduleItems: ScheduleItem[]) {
  return scheduleItems.filter(item =>
    projectNameMatches(item.projectName, projectName),
  );
}

function locationCandidates(updates: ProjectUpdate[]): LocationCandidate[] {
  return updates
    .flatMap(update => [
      updateLocationCandidate(update),
      ...update.photos.map(photo => photoLocationCandidate(photo, update)),
    ])
    .filter((candidate): candidate is LocationCandidate => Boolean(candidate))
    .sort(
      (left, right) =>
        dateTimeValue(right.locationCapturedAt || right.occurredAt) -
        dateTimeValue(left.locationCapturedAt || left.occurredAt),
    );
}

function updateLocationCandidate(update: ProjectUpdate): LocationCandidate | null {
  const hasArea = Boolean(update.selectedAreaId || update.selectedAreaName?.trim());
  const hasGps = hasGpsCoordinates(update);

  if (!hasArea && !hasGps) return null;

  return {
    areaId: update.selectedAreaId ?? null,
    areaName: update.selectedAreaName?.trim() || null,
    gpsLatitude: update.gpsLatitude ?? null,
    gpsLongitude: update.gpsLongitude ?? null,
    gpsAccuracy: update.gpsAccuracy ?? null,
    distanceFromSelectedAreaFeet: update.distanceFromSelectedAreaFeet ?? null,
    locationCapturedAt: update.locationCapturedAt ?? null,
    occurredAt: update.date,
    source: update.id.startsWith('draft-') ? 'current-draft' : 'typed-update',
  };
}

function photoLocationCandidate(
  photo: UpdatePhoto,
  update: ProjectUpdate,
): LocationCandidate | null {
  const hasArea = Boolean(
    photo.selectedAreaId ||
      photo.selectedAreaName?.trim() ||
      update.selectedAreaId ||
      update.selectedAreaName?.trim(),
  );
  const hasGps = hasGpsCoordinates(photo);

  if (!hasArea && !hasGps) return null;

  return {
    areaId: photo.selectedAreaId ?? update.selectedAreaId ?? null,
    areaName:
      photo.selectedAreaName?.trim() ||
      update.selectedAreaName?.trim() ||
      null,
    gpsLatitude: photo.gpsLatitude ?? update.gpsLatitude ?? null,
    gpsLongitude: photo.gpsLongitude ?? update.gpsLongitude ?? null,
    gpsAccuracy: photo.gpsAccuracy ?? update.gpsAccuracy ?? null,
    distanceFromSelectedAreaFeet:
      photo.distanceFromSelectedAreaFeet ??
      update.distanceFromSelectedAreaFeet ??
      null,
    locationCapturedAt:
      photo.locationCapturedAt ?? update.locationCapturedAt ?? null,
    occurredAt: update.date,
    source: 'photo',
  };
}

function firstScheduleArea(scheduleItems: ScheduleItem[]) {
  return (
    scheduleItems
      .map(item => item.locationName.trim())
      .find(Boolean) || null
  );
}

function findMatchedArea({
  projectAreas,
  areaId,
  areaName,
}: {
  projectAreas: ProjectArea[];
  areaId: string | null;
  areaName: string | null;
}) {
  return (
    (areaId ? projectAreas.find(area => area.id === areaId) : null) ||
    (areaName
      ? projectAreas.find(
          area =>
            area.name.trim().toLowerCase() ===
            areaName.trim().toLowerCase(),
        )
      : null) ||
    null
  );
}

function projectPresenceStatus({
  candidate,
  matchedArea,
}: {
  candidate: LocationCandidate | null;
  matchedArea: ProjectArea | null | undefined;
}): ProjectPresenceStatus {
  if (
    !candidate ||
    !matchedArea ||
    typeof candidate.distanceFromSelectedAreaFeet !== 'number' ||
    !Number.isFinite(candidate.distanceFromSelectedAreaFeet)
  ) {
    return 'unknown';
  }

  return candidate.distanceFromSelectedAreaFeet <= matchedArea.radiusFeet
    ? 'on-site'
    : 'off-site';
}

function locationConfidenceScore({
  projectName,
  currentArea,
  scheduleArea,
  buildingName,
  gpsCaptured,
  areaHasGps,
  latestCandidate,
  now,
}: {
  projectName: string;
  currentArea: string | null;
  scheduleArea: string | null;
  buildingName: string | null;
  gpsCaptured: boolean;
  areaHasGps: boolean;
  latestCandidate: LocationCandidate | null;
  now: Date;
}) {
  let score = projectName.trim() ? 20 : 0;

  if (currentArea && latestCandidate) score += 28;
  if (gpsCaptured) score += 22;
  if (areaHasGps) score += 15;
  if (buildingName) score += 10;
  if (scheduleArea) score += 10;

  const latestAgeDays = daysSince(latestCandidate?.locationCapturedAt || latestCandidate?.occurredAt, now);

  if (latestAgeDays !== null && latestAgeDays <= 14) score += 5;

  return Math.max(0, Math.min(100, Math.round(score)));
}

function confidenceLevel(score: number): ProjectLocationConfidence {
  if (score >= 75) return 'high';
  if (score >= 45) return 'medium';

  return 'low';
}

function gpsStatus({
  gpsCaptured,
  areaHasGps,
  accuracy,
  currentArea,
}: {
  gpsCaptured: boolean;
  areaHasGps: boolean;
  accuracy: number | null;
  currentArea: string | null;
}) {
  if (gpsCaptured) {
    return accuracy
      ? `Captured, accuracy ${Math.round(accuracy).toLocaleString('en-US')} ft`
      : 'Captured';
  }

  if (areaHasGps) return 'Area GPS saved';
  if (currentArea) return 'GPS not set for this area';

  return 'GPS not available';
}

function locationLabel({
  buildingName,
  areaName,
  gpsCaptured,
}: {
  buildingName: string | null;
  areaName: string | null;
  gpsCaptured: boolean;
}) {
  if (buildingName && areaName) return `${buildingName} - ${areaName}`;
  if (areaName) return areaName;
  if (buildingName) return buildingName;
  if (gpsCaptured) return 'GPS captured';

  return UNKNOWN_LOCATION;
}

function confirmationLocationLabel({
  buildingName,
  areaName,
  fallback,
}: {
  buildingName: string | null;
  areaName: string | null;
  fallback: string;
}) {
  if (buildingName && areaName) return `${buildingName} – ${areaName}`;

  return fallback;
}

function presenceLabel(status: ProjectPresenceStatus) {
  if (status === 'on-site') return 'On Site';
  if (status === 'off-site') return 'Off Site';

  return 'Unknown';
}

function locationEvidence({
  currentArea,
  buildingName,
  gpsCaptured,
  areaHasGps,
  scheduleArea,
  latestCandidate,
  presenceStatus,
  confidenceScore,
}: {
  currentArea: string | null;
  buildingName: string | null;
  gpsCaptured: boolean;
  areaHasGps: boolean;
  scheduleArea: string | null;
  latestCandidate: LocationCandidate | null;
  presenceStatus: ProjectPresenceStatus;
  confidenceScore: number;
}) {
  const evidence: string[] = [];

  if (currentArea) evidence.push(`Current area signal: ${currentArea}.`);
  if (buildingName) evidence.push(`Building context: ${buildingName}.`);
  if (gpsCaptured) evidence.push('Latest project activity includes GPS coordinates.');
  if (areaHasGps) evidence.push('Matched project area has saved GPS context.');
  if (scheduleArea) evidence.push(`Schedule includes location: ${scheduleArea}.`);
  if (latestCandidate?.source) evidence.push(`Latest location source: ${latestCandidate.source}.`);
  if (presenceStatus !== 'unknown') evidence.push(`Presence status: ${presenceLabel(presenceStatus)}.`);

  evidence.push(`Location confidence: ${confidenceScore}%.`);

  return evidence;
}

function hasGpsCoordinates(value: {
  gpsLatitude?: number | null;
  gpsLongitude?: number | null;
}) {
  return (
    typeof value.gpsLatitude === 'number' &&
    Number.isFinite(value.gpsLatitude) &&
    typeof value.gpsLongitude === 'number' &&
    Number.isFinite(value.gpsLongitude)
  );
}

function projectNameMatches(left?: string | null, right?: string | null) {
  return Boolean(
    left?.trim() &&
      right?.trim() &&
      left.trim().toLowerCase() === right.trim().toLowerCase(),
  );
}

function daysSince(value: string | null | undefined, now: Date) {
  const time = dateTimeValue(value);

  if (!time) return null;

  return Math.max(
    0,
    Math.floor((now.getTime() - time) / (1000 * 60 * 60 * 24)),
  );
}

function dateTimeValue(value: string | null | undefined) {
  if (!value) return 0;

  const time = new Date(value).getTime();

  return Number.isFinite(time) ? time : 0;
}
