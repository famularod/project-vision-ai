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

/** The fields "Save GPS" writes onto an area. */
export function areaPointFromFix(fix: Readonly<{
  latitude: number;
  longitude: number;
  accuracy: number | null;
  capturedAt: string;
}>): Pick<ProjectArea, 'latitude' | 'longitude' | 'locationCapturedAt' | 'locationAccuracyMeters'> {
  return {
    latitude: fix.latitude,
    longitude: fix.longitude,
    locationCapturedAt: fix.capturedAt,
    locationAccuracyMeters: gpsAccuracyFeet(fix.accuracy) === null ? null : fix.accuracy,
  };
}

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
  area: Pick<ProjectArea, 'locationCapturedAt' | 'locationAccuracyMeters'>,
): string {
  if (!area.locationCapturedAt) return 'GPS missing';
  const accuracy = formatGpsAccuracy(area.locationAccuracyMeters);
  return accuracy ? `GPS saved ${accuracy}` : 'GPS saved, precision not recorded';
}
