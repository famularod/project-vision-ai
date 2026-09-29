/**
 * GPS precision in the units the app works in.
 *
 * GPS review, 29 Sep 2026: expo-location reports a fix's accuracy in meters,
 * but the area suggestion added it to distances in feet and the status line
 * printed it as feet. Fixes were also taken at the "balanced" setting
 * (iOS hundred-meter accuracy), so a saved area point could be off by
 * roughly the width of the area itself, and nothing recorded how precise
 * each point was.
 */
import type { ProjectArea } from '../types';

export const METERS_TO_FEET = 3.28084;

/**
 * A saved area point less precise than this is offered a retry before it is
 * kept: areas are 100-250 ft circles, and the point is their centre.
 */
export const AREA_POINT_ACCURACY_LIMIT_FEET = 65;

export function gpsAccuracyFeet(accuracyMeters: number | null | undefined): number | null {
  return typeof accuracyMeters === 'number' && Number.isFinite(accuracyMeters) && accuracyMeters >= 0
    ? accuracyMeters * METERS_TO_FEET
    : null;
}

/** "±16 ft", or null when the fix carried no accuracy. */
export function formatGpsAccuracy(accuracyMeters: number | null | undefined): string | null {
  const feet = gpsAccuracyFeet(accuracyMeters);
  return feet === null ? null : `±${Math.max(1, Math.round(feet)).toLocaleString('en-US')} ft`;
}

/** Inside the area's circle even at the far edge of the fix's error. */
export function isConfidentlyInsideArea(input: Readonly<{
  distanceFeet: number;
  accuracyMeters: number | null | undefined;
  radiusFeet: number;
}>): boolean {
  return input.distanceFeet + (gpsAccuracyFeet(input.accuracyMeters) ?? 0) <= input.radiusFeet;
}

/** The fix's whole error margin lies outside the area's circle. */
export function isConfidentlyOutsideArea(input: Readonly<{
  distanceFeet: number;
  accuracyMeters: number | null | undefined;
  radiusFeet: number;
}>): boolean {
  return input.distanceFeet - (gpsAccuracyFeet(input.accuracyMeters) ?? 0) > input.radiusFeet;
}

/** How much nearer the closest project must be to win outright. */
export function clearWinnerMarginFeet(
  minimumFeet: number,
  accuracyMeters: number | null | undefined,
): number {
  return Math.max(minimumFeet, (gpsAccuracyFeet(accuracyMeters) ?? 0) * 2);
}

export function isAreaPointImprecise(accuracyMeters: number | null | undefined): boolean {
  const feet = gpsAccuracyFeet(accuracyMeters);
  return feet === null || feet > AREA_POINT_ACCURACY_LIMIT_FEET;
}

/**
 * How long home-screen detection reuses a fix: a minute for a precise one,
 * 15 s for a poor one, so data changes do not restart multi-second fixes
 * (pass 1) and a poor fix does not decide for a whole minute (passes 7-8).
 */
export function overviewFixMaxAgeMs(accuracyMeters: number | null | undefined): number {
  return isAreaPointImprecise(accuracyMeters) ? 15_000 : 60_000;
}

type AreaPointPrecision = Pick<ProjectArea, 'locationAccuracyMeters' | 'locationAccuracyCapturedAt'>;

export type AreaGpsSaveDecision = 'location-denied' | 'precise-off' | 'imprecise' | 'save';

/** What Save GPS does with a fix (review passes 1 and 11). */
export function areaGpsSaveDecision(
  fix: Readonly<{ accuracy: number | null; preciseLocationOff?: boolean }> | null,
): AreaGpsSaveDecision {
  if (!fix) return 'location-denied';
  if (fix.preciseLocationOff) return 'precise-off';
  return isAreaPointImprecise(fix.accuracy) ? 'imprecise' : 'save';
}

/** The fields "Save GPS" writes onto an area. */
export function areaPointFromFix(fix: Readonly<{
  latitude: number;
  longitude: number;
  accuracy: number | null;
  capturedAt: string;
}>): Pick<ProjectArea, 'latitude' | 'longitude' | 'locationCapturedAt'> & AreaPointPrecision {
  const known = gpsAccuracyFeet(fix.accuracy) !== null;
  return {
    latitude: fix.latitude,
    longitude: fix.longitude,
    locationCapturedAt: fix.capturedAt,
    locationAccuracyMeters: known ? fix.accuracy : null,
    locationAccuracyCapturedAt: known ? fix.capturedAt : null,
  };
}

/**
 * The saved point's precision, only while it still belongs to that point.
 * Review, 29 Sep 2026: an older build that saves a new point keeps the
 * previous precision fields, and a sync merge can take the point from one
 * copy and the rest from another. The capture time ties the two together.
 */
export function areaPointAccuracyMeters(
  area: Pick<ProjectArea, 'locationCapturedAt'> & AreaPointPrecision,
): number | null {
  const meters = area.locationAccuracyMeters;
  return typeof meters === 'number' &&
    Number.isFinite(meters) &&
    meters >= 0 &&
    typeof area.locationCapturedAt === 'string' &&
    area.locationCapturedAt !== '' &&
    area.locationAccuracyCapturedAt === area.locationCapturedAt
    ? meters
    : null;
}

/** The precision keys to store with an area: both, or neither. */
export function areaPointPrecisionFields(
  area: Pick<ProjectArea, 'locationCapturedAt'> & AreaPointPrecision,
): AreaPointPrecision {
  const meters = areaPointAccuracyMeters(area);
  return meters === null
    ? {}
    : { locationAccuracyMeters: meters, locationAccuracyCapturedAt: area.locationCapturedAt };
}

export const PRECISE_LOCATION_OFF_TITLE = 'Precise Location is off';
export const PRECISE_LOCATION_OFF_MESSAGE =
  'Vitruvius only gets an approximate location, which cannot place you in a work area. Turn on Precise Location for Vitruvius in Settings, then try again.';

export function areaPointSavedMessage(accuracyMeters: number | null | undefined): string {
  const accuracy = formatGpsAccuracy(accuracyMeters);
  return accuracy
    ? `This location now uses your current GPS point, accurate to ${accuracy}.`
    : 'This location now uses your current GPS point.';
}

export function areaPointImpreciseMessage(accuracyMeters: number | null | undefined): string {
  const accuracy = formatGpsAccuracy(accuracyMeters);
  return accuracy
    ? `GPS is only accurate to ${accuracy} here. Step into the open and try again, or save this point anyway.`
    : 'The phone did not say how accurate this GPS point is. Try again, or save it anyway.';
}

/** The precision part of an area's line on the Locations list. */
export function areaPointPrecisionLabel(
  area: Pick<ProjectArea, 'locationCapturedAt'> & AreaPointPrecision,
): string {
  if (!area.locationCapturedAt) return 'GPS missing';
  const accuracy = formatGpsAccuracy(areaPointAccuracyMeters(area));
  return accuracy ? `GPS saved ${accuracy}` : 'GPS saved, precision not recorded';
}
