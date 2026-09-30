/**
 * What the Add Photos screen says about the draft's work area.
 *
 * GPS review, 29 Sep 2026 (passes 3-6): once GPS suggestions worked, the
 * screen showed a suggestion as the current area after it was rejected,
 * "Area suggested" with nothing suggested, a GPS reason for an area GPS did
 * not choose, and "Area auto-detected" for a manual pick. The rule now: the
 * current area is the draft's own; a suggestion is offered, and named, until
 * accepted; "auto-detected" means the accepted suggestion.
 */
import type { AreaSuggestion, ProjectArea } from '../types';
import { findProjectAreaSuggestions } from './AreaSuggestion';
import { formatGpsAccuracy, isConfidentlyOutsideArea, PRECISE_LOCATION_OFF_TITLE } from './GpsPrecision';

export const UNASSIGNED_AREA_NAME = 'Unassigned / Unknown Area';
/** The schedule's name for a task without a location (PIEEvidenceFusion). */
export const UNASSIGNED_SCHEDULE_AREA_NAME = 'Unassigned area';

/**
 * An area name, or null for none and for the placeholders that name no area
 * (GPS review passes 12-14: they became recommended areas, sides of the GPS
 * area conflict, and "I believe you're at Unassigned / Unknown Area").
 */
export function namedAreaOrNull(value: string | null | undefined): string | null {
  const name = value?.trim() || '';
  if (!name) return null;
  const key = name.toLowerCase();
  return key === UNASSIGNED_AREA_NAME.toLowerCase() || key === UNASSIGNED_SCHEDULE_AREA_NAME.toLowerCase()
    ? null
    : name;
}

export type DraftAreaStatus = 'confirmed' | 'suggested' | 'unknown';

export type DraftAreaLocationSource =
  | 'exact-gps-area'
  | 'gps-radius'
  | 'gps-pending'
  | 'user-selection'
  | 'schedule'
  | 'last-active-area';

/**
 * Why the draft has no GPS suggestion (GPS review pass 22: the capture path
 * wrote "Location permission denied" and the like into a status nothing
 * rendered, and Precise Location off was explained only by Save GPS).
 * Pass 23: what GPS can say is said, no more. A fix that is not confidently
 * inside an area may still be inside it ("unconfirmed"); "outside every
 * saved work area" is claimed only when the fix is confidently outside all
 * of them; a project with no saved points says so.
 */
export type DraftLocationNoticeKind =
  | 'capturing'
  | 'denied'
  | 'failed'
  | 'precise-off'
  | 'no-mapped-areas'
  | 'unconfirmed'
  | 'no-area';

export type DraftLocationNoticeDetail = Readonly<{
  kind: DraftLocationNoticeKind;
  /** The area GPS may place you in ('unconfirmed'), or the nearest ('no-area'). */
  areaName?: string | null;
  accuracyMeters?: number | null;
  /** How far outside the nearest area's circle the fix is ('no-area'; pass 24: not the distance to its centre). */
  distanceOutsideFeet?: number | null;
}>;

/** A capture's own outcome, kept as state; where the fix places you is derived at render. */
export type DraftCaptureNoticeKind = 'capturing' | 'denied' | 'failed' | 'precise-off';

/**
 * A capture's outcome, the draft whose fix it is, and the capture
 * generation: a later capture supersedes it, as does a save that dropped a
 * pending fix (pass 23: "Capturing GPS..." stayed on an update whose fix
 * landed after its save began, and showed again when that update was
 * reopened).
 */
export type DraftLocationNotice = Readonly<{ draftId: string; generation: number; kind: DraftCaptureNoticeKind }>;

/** The capture outcome that belongs to this draft's latest capture, if any. */
export function currentDraftLocationNotice(input: Readonly<{
  notice: DraftLocationNotice | null;
  draftId: string;
  generation: number;
}>): DraftLocationNotice | null {
  const { notice } = input;
  return notice && notice.draftId === input.draftId && notice.generation === input.generation ? notice : null;
}

/**
 * What a fix says about the project's areas. `suggestions` is every area
 * with a saved point, nearest centre first (findProjectAreaSuggestions).
 * Null when one confidently contains you: that is the suggestion.
 */
export function draftPlacementNotice(input: Readonly<{
  accuracyMeters: number | null | undefined;
  suggestions: readonly AreaSuggestion[];
}>): DraftLocationNoticeDetail | null {
  if (input.suggestions.some(item => item.withinRadius)) return null;
  if (input.suggestions.length === 0) return { kind: 'no-mapped-areas' };
  const accuracyMeters = input.accuracyMeters ?? null;
  const possible = input.suggestions.find(item => !isConfidentlyOutsideArea({
    distanceFeet: item.distanceFeet,
    accuracyMeters,
    radiusFeet: item.area.radiusFeet,
  }));
  if (possible) return { kind: 'unconfirmed', areaName: possible.area.name, accuracyMeters };
  // The area whose edge is nearest, not whose centre is (pass 25: a small
  // area's centre can be nearer while a large area's edge is much closer).
  const gap = (item: AreaSuggestion) => item.distanceFeet - item.area.radiusFeet;
  const nearest = input.suggestions.reduce((best, item) => (gap(item) < gap(best) ? item : best));
  return {
    kind: 'no-area',
    areaName: nearest.area.name,
    distanceOutsideFeet: Math.max(0, gap(nearest)),
    accuracyMeters,
  };
}

/**
 * The notice Add Photos shows for a draft: its latest capture's outcome
 * (capturing, denied, failed, Precise Location off), else what the draft's
 * own fix says about the project's areas as they are now. Derived at
 * render, like the suggestion: areas arrive, change and go after the
 * capture, and a failed save must not hide it (pass 24).
 */
export function currentDraftLocationNoticeView(input: Readonly<{
  notice: DraftLocationNotice | null;
  generation: number;
  draft: Readonly<{
    id: string;
    gpsLatitude?: number | null;
    gpsLongitude?: number | null;
    gpsAccuracy?: number | null;
  }>;
  areas: readonly ProjectArea[];
}>): DraftLocationNoticeDetail | null {
  const { draft } = input;
  const stored = currentDraftLocationNotice({ notice: input.notice, draftId: draft.id, generation: input.generation });
  if (stored) return stored;
  if (typeof draft.gpsLatitude !== 'number' || typeof draft.gpsLongitude !== 'number') return null;
  const fix = { latitude: draft.gpsLatitude, longitude: draft.gpsLongitude, accuracy: draft.gpsAccuracy ?? null };
  return draftPlacementNotice({
    accuracyMeters: fix.accuracy,
    suggestions: findProjectAreaSuggestions(fix, input.areas, { diagnose: false }),
  });
}

/** Add Photos has no re-fix, so this does not say "try again" (pass 23); the approximate fix is not written to the update (pass 25). */
export const PRECISE_LOCATION_OFF_DRAFT_MESSAGE =
  `${PRECISE_LOCATION_OFF_TITLE}. Vitruvius only gets an approximate location, which cannot place you in a work area, so this update has no GPS. Turn on Precise Location for Vitruvius in Settings; your next update will use it.`;

export function draftLocationNoticeText(notice: DraftLocationNoticeDetail): string {
  const accuracy = formatGpsAccuracy(notice.accuracyMeters);
  const gps = accuracy ? `GPS (${accuracy})` : 'GPS';
  switch (notice.kind) {
    case 'capturing':
      return 'Capturing GPS...';
    case 'denied':
      return 'Location permission denied. Choose Project Area manually.';
    case 'failed':
      return 'GPS could not be captured. Choose Project Area manually.';
    case 'precise-off':
      return PRECISE_LOCATION_OFF_DRAFT_MESSAGE;
    case 'no-mapped-areas':
      return 'This project has no work area with a saved GPS point yet, so GPS cannot suggest one. Choose the project area.';
    case 'unconfirmed':
      return `${gps} may place you in ${notice.areaName} but cannot confirm it. Choose the project area.`;
    case 'no-area':
      return notice.areaName && typeof notice.distanceOutsideFeet === 'number'
        ? `${gps} places you about ${formatFeet(notice.distanceOutsideFeet)} outside the nearest saved work area, ${notice.areaName}. Choose the project area.`
        : `${gps} places you outside every saved work area. Choose the project area.`;
  }
}

function formatFeet(value: number): string {
  return `${Math.round(value).toLocaleString('en-US')} ft`;
}

/** Notices about where GPS thinks you are; moot once an area is named. */
const PLACEMENT_NOTICES: ReadonlySet<DraftLocationNoticeKind> = new Set(['no-mapped-areas', 'unconfirmed', 'no-area']);

export type DraftAreaPresentation = Readonly<{
  /** The draft's own area: what Review shows and the save stores. */
  areaName: string;
  /** A suggestion to offer ("Accept Suggested Area: …"), or null. */
  offeredSuggestion: AreaSuggestion | null;
  /** The suggestion is the draft's selected area. */
  suggestionIsShown: boolean;
  areaRowName: string;
  areaRowStatus: DraftAreaStatus;
  locationSource: DraftAreaLocationSource;
  confidenceScore: number;
  reason: string;
  /** Why there is no GPS suggestion, when that is worth a line; else null. */
  locationNotice: string | null;
}>;

export function draftAreaPresentation(input: Readonly<{
  selectedArea: Pick<ProjectArea, 'id' | 'name'> | null;
  selectedAreaName?: string | null;
  areaStatus?: DraftAreaStatus | null;
  areaSuggestion: AreaSuggestion | null;
  hasScheduleRecommendation: boolean;
  correctionPenalty?: number;
  locationNotice?: DraftLocationNoticeDetail | null;
}>): DraftAreaPresentation {
  const { selectedArea, areaSuggestion } = input;
  const areaName = selectedArea?.name || input.selectedAreaName || UNASSIGNED_AREA_NAME;
  const suggestionIsShown = Boolean(areaSuggestion && selectedArea?.id === areaSuggestion.area.id);
  const pendingSuggestion = !selectedArea && areaSuggestion ? areaSuggestion : null;
  // A suggestion answers the question; where GPS thinks you are matters
  // only while no area is named (a mapped pick or a task's location; pass
  // 23); denied, failed and Precise Location off stay, since they explain
  // every update until the setting changes.
  const notice = input.locationNotice ?? null;
  const locationNotice = notice && !areaSuggestion && !(PLACEMENT_NOTICES.has(notice.kind) && namedAreaOrNull(areaName))
    ? draftLocationNoticeText(notice)
    : null;
  const rowNamesSuggestion = Boolean(
    pendingSuggestion && input.areaStatus === 'suggested' && areaName === UNASSIGNED_AREA_NAME,
  );
  const locationSource: DraftAreaLocationSource = suggestionIsShown
    ? areaSuggestion?.withinRadius ? 'exact-gps-area' : 'gps-radius'
    : pendingSuggestion
      ? 'gps-pending'
      : selectedArea
        ? 'user-selection'
        : input.hasScheduleRecommendation
          ? 'schedule'
          : 'last-active-area';
  const baseScore = suggestionIsShown
    ? areaSuggestion?.withinRadius ? 90 : 70
    : pendingSuggestion ? 60 : selectedArea ? 80 : 45;

  return {
    areaName,
    offeredSuggestion: areaSuggestion && !suggestionIsShown ? areaSuggestion : null,
    suggestionIsShown,
    areaRowName: rowNamesSuggestion && pendingSuggestion ? pendingSuggestion.area.name : areaName,
    areaRowStatus: suggestionIsShown
      ? 'confirmed'
      : pendingSuggestion && input.areaStatus === 'suggested'
        ? 'suggested'
        : 'unknown',
    locationSource,
    confidenceScore: Math.max(0, baseScore - (input.correctionPenalty || 0)),
    reason: locationReason(locationSource, pendingSuggestion),
    locationNotice,
  };
}

function locationReason(source: DraftAreaLocationSource, pending: AreaSuggestion | null): string {
  switch (source) {
    case 'exact-gps-area':
      return 'GPS places you inside this saved area.';
    case 'gps-pending':
      return pending
        ? `GPS places you in ${pending.area.name}. Accept it to use it for this update.`
        : 'This is your current confirmed selection.';
    case 'gps-radius':
      return 'This is the nearest saved area within the GPS recommendation range.';
    case 'schedule':
      return 'The imported schedule identifies this as the most urgent area.';
    default:
      return 'This is your current confirmed selection.';
  }
}
