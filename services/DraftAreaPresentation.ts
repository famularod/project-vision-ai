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
import { PRECISE_LOCATION_OFF_MESSAGE, PRECISE_LOCATION_OFF_TITLE } from './GpsPrecision';

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
 */
export type DraftLocationNoticeKind = 'capturing' | 'denied' | 'failed' | 'precise-off' | 'no-area';

/** The notice, and the draft whose fix produced it. */
export type DraftLocationNotice = Readonly<{ draftId: string; kind: DraftLocationNoticeKind }>;

/** The notice once a fix has landed: none when it suggests an area. */
export function draftLocationNoticeAfterFix(input: Readonly<{
  preciseLocationOff?: boolean;
  reliableSuggestion: AreaSuggestion | null;
}>): DraftLocationNoticeKind | null {
  if (input.preciseLocationOff) return 'precise-off';
  return input.reliableSuggestion ? null : 'no-area';
}

export function draftLocationNoticeText(kind: DraftLocationNoticeKind): string {
  switch (kind) {
    case 'capturing':
      return 'Capturing GPS...';
    case 'denied':
      return 'Location permission denied. Choose Project Area manually.';
    case 'failed':
      return 'GPS could not be captured. Choose Project Area manually.';
    case 'precise-off':
      return `${PRECISE_LOCATION_OFF_TITLE}. ${PRECISE_LOCATION_OFF_MESSAGE}`;
    case 'no-area':
      return 'GPS is not inside a saved work area. Choose the project area.';
  }
}

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
  locationNotice?: DraftLocationNoticeKind | null;
}>): DraftAreaPresentation {
  const { selectedArea, areaSuggestion } = input;
  const areaName = selectedArea?.name || input.selectedAreaName || UNASSIGNED_AREA_NAME;
  const suggestionIsShown = Boolean(areaSuggestion && selectedArea?.id === areaSuggestion.area.id);
  const pendingSuggestion = !selectedArea && areaSuggestion ? areaSuggestion : null;
  // A suggestion answers the question; "not inside a saved area" matters
  // only while no area is chosen; denied, failed and Precise Location off
  // stay, since they explain every update until the setting changes.
  const noticeKind = input.locationNotice ?? null;
  const locationNotice = noticeKind && !areaSuggestion && !(noticeKind === 'no-area' && selectedArea)
    ? draftLocationNoticeText(noticeKind)
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
