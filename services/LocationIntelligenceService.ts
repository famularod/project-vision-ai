import { distanceBetweenCoordinatesFeet, findClosestProjectArea, hasSavedAreaLocation } from './AreaSuggestion';
import { projectAreasForProject } from './DAVEProjectAreaScope';
import { formatGpsAccuracy, isConfidentlyInsideArea, isConfidentlyOutsideArea } from './GpsPrecision';
import { namedAreaOrNull } from './DraftAreaPresentation';
import { fixIsCurrent } from './DraftPhotoGps';
import type {
  ProjectArea,
  ProjectUpdate,
  ScheduleItem,
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

type LocationFixEvidence = {
  latitude: number;
  longitude: number;
  accuracy: number | null;
  capturedAt: string;
};

/**
 * One update as location evidence (GPS review pass 15 reworked this; the
 * summary was written when fixes never landed):
 * - its area is the update's named area (placeholders name none), else the
 *   saved area its current fix is confidently inside;
 * - its fix counts only while current: taken at most 30 minutes before now;
 * - it is as recent as its latest activity (its fix and its photos, when
 *   they were added), which orders updates; library photos count here, as
 *   work on the update, but never as GPS;
 * - an update with neither an area nor a current fix is not evidence.
 */
type LocationCandidate = {
  areaId: string | null;
  areaName: string | null;
  fix: LocationFixEvidence | null;
  activityAt: string | null;
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
  // This project's areas only (GPS review pass 16: another project's area on
  // a shared site became the current area).
  const scopedAreas = projectAreasForProject({
    projectAreas,
    projectName,
    // Every project's tasks and updates, as the draft passes: ownership of a
    // legacy area is inferred from who uses it.
    scheduleItems,
    updates: currentUpdate ? [currentUpdate, ...updates] : updates,
  });
  const candidates = locationCandidates({
    updates: projectUpdates,
    currentUpdate: currentUpdate ?? null,
    projectAreas: scopedAreas,
    now,
  });
  const latestCandidate = candidates[0] ?? null;
  const scheduleArea = firstScheduleArea(projectScheduleItems);
  // The schedule only stands in when no update is evidence at all (pass 15:
  // it named the current area for a placeholder draft at up to 100%).
  const currentArea = latestCandidate
    ? latestCandidate.areaName
    : scheduleArea;
  const matchedArea = findMatchedArea({
    projectAreas: scopedAreas,
    areaId: latestCandidate?.areaId ?? null,
    areaName: currentArea,
  });
  const buildingName = matchedArea?.building?.trim() || null;
  const gpsCaptured = Boolean(latestCandidate?.fix);
  const areaHasGps = Boolean(matchedArea?.locationCapturedAt);
  const lastKnownLocation = locationLabel({
    buildingName,
    areaName: currentArea,
    gpsCaptured,
  });
  const presenceStatus = projectPresenceStatus({
    fix: latestCandidate?.fix ?? null,
    matchedArea,
  });
  // A fix adds confidence only when it supports the current area (pass 16:
  // a fix far from the named area still scored +22).
  const gpsSupportsArea = presenceStatus === 'on-site';
  const confidenceScore = locationConfidenceScore({
    projectName,
    currentArea,
    scheduleArea,
    buildingName,
    gpsCaptured: gpsSupportsArea,
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
  // Only a named area can be confirmed (pass 15: "I believe you're at GPS
  // captured").
  // An off-site fix contradicts the named area, however high the rest
  // scores (pass 17).
  const needsConfirmation = Boolean(currentArea) && (confidence !== 'high' || presenceStatus === 'off-site');

  return {
    projectName,
    currentArea,
    buildingName,
    gpsStatus: gpsStatus({
      gpsCaptured,
      areaHasGps,
      accuracy: latestCandidate?.fix?.accuracy ?? null,
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
    projectNameMatches(update.projectName, projectName) &&
    // The open draft stands for its saved copy (pass 15).
    update.id !== currentUpdate?.id,
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

function locationCandidates({
  updates,
  currentUpdate,
  projectAreas,
  now,
}: {
  updates: ProjectUpdate[];
  currentUpdate: ProjectUpdate | null;
  projectAreas: ProjectArea[];
  now: Date;
}): LocationCandidate[] {
  return updates
    .map(update => updateLocationCandidate(update, update === currentUpdate, projectAreas, now))
    .filter((candidate): candidate is LocationCandidate => Boolean(candidate))
    .sort((left, right) => dateTimeValue(right.activityAt) - dateTimeValue(left.activityAt));
}

function updateLocationCandidate(
  update: ProjectUpdate,
  isOpenDraft: boolean,
  projectAreas: ProjectArea[],
  now: Date,
): LocationCandidate | null {
  const fix = currentFix(update, now);
  const updateArea = namedAreaOrNull(update.selectedAreaName);
  const photoWithArea = updateArea
    ? null
    : update.photos.find(photo => namedAreaOrNull(photo.selectedAreaName)) ?? null;
  const namedArea = updateArea || namedAreaOrNull(photoWithArea?.selectedAreaName) || null;
  const fixArea = !namedArea && fix ? areaContainingFix(fix, projectAreas) : null;
  const areaName = namedArea || fixArea?.name || null;

  if (!areaName && !fix) return null;

  return {
    areaId: updateArea
      ? update.selectedAreaId ?? null
      : photoWithArea
        ? photoWithArea.selectedAreaId ?? null
        : fixArea?.id ?? null,
    areaName,
    fix,
    activityAt:
      latestTime([update.locationCapturedAt, ...update.photos.map(photo => photo.locationCapturedAt)]) ??
      update.date,
    source: isOpenDraft ? 'current-draft' : 'typed-update',
  };
}

/**
 * The update's fix (or, with none, its latest camera photo's own GPS) if it
 * was taken at most 30 minutes before now: a fix says where you are only
 * while it is recent (passes 13 and 15: an old fix read as current GPS and
 * "On Site"). Library photos never give GPS.
 */
function currentFix(update: ProjectUpdate, now: Date): LocationFixEvidence | null {
  const photoFix = update.photos
    .filter(photo => !photo.pickedFromLibrary && hasGpsCoordinates(photo))
    .sort((left, right) => dateTimeValue(right.locationCapturedAt) - dateTimeValue(left.locationCapturedAt))[0];
  const source = hasGpsCoordinates(update)
    ? { lat: update.gpsLatitude, lng: update.gpsLongitude, acc: update.gpsAccuracy, at: update.locationCapturedAt }
    : photoFix
      ? { lat: photoFix.gpsLatitude, lng: photoFix.gpsLongitude, acc: photoFix.gpsAccuracy, at: photoFix.locationCapturedAt }
      : null;
  if (!source || typeof source.lat !== 'number' || typeof source.lng !== 'number') return null;
  if (!fixIsCurrent(source.at, now.getTime())) return null;
  return {
    latitude: source.lat,
    longitude: source.lng,
    accuracy: typeof source.acc === 'number' ? source.acc : null,
    capturedAt: source.at as string,
  };
}

/** The project's saved area a fix is confidently inside (the draft's and fusion's rule; pass 16). */
function areaContainingFix(fix: LocationFixEvidence, projectAreas: ProjectArea[]): ProjectArea | null {
  const containing = findClosestProjectArea(fix, projectAreas, { diagnose: false });
  return containing?.withinRadius ? containing.area : null;
}

function latestTime(values: Array<string | null | undefined>): string | null {
  return values
    .filter((value): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value)))
    .reduce<string | null>(
      (latest, value) => (latest === null || Date.parse(value) > Date.parse(latest) ? value : latest),
      null,
    );
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

/**
 * On or off site only from a current fix, and only when its error margin
 * does not straddle the area's edge (pass 15: a stale fix read "On Site";
 * a 1-3 km fix with Precise Location off read "Off Site"); never from a fix
 * with no usable accuracy (pass 1 low, G-L1).
 */
function projectPresenceStatus({
  fix,
  matchedArea,
}: {
  fix: LocationFixEvidence | null;
  matchedArea: ProjectArea | null | undefined;
}): ProjectPresenceStatus {
  if (!fix || !matchedArea || !hasSavedAreaLocation(matchedArea)) return 'unknown';
  const placement = {
    distanceFeet: distanceBetweenCoordinatesFeet(fix, matchedArea),
    accuracyMeters: fix.accuracy,
    radiusFeet: matchedArea.radiusFeet,
  };
  if (isConfidentlyInsideArea(placement)) return 'on-site';
  if (isConfidentlyOutsideArea(placement)) return 'off-site';
  return 'unknown';
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

  if (currentArea && latestCandidate?.areaName) score += 28;
  if (gpsCaptured) score += 22;
  if (areaHasGps) score += 15;
  if (buildingName) score += 10;
  if (scheduleArea) score += 10;

  const latestAgeDays = daysSince(latestCandidate?.activityAt, now);

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
    // accuracy is the fix's, in meters (GPS review, 29 Sep 2026).
    const precision = formatGpsAccuracy(accuracy);
    return precision ? `Captured, accuracy ${precision}` : 'Captured';
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
