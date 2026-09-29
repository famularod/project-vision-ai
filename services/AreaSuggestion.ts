/**
 * Which saved work area a GPS fix places you in.
 *
 * Moved out of App.tsx during the GPS review, 29 Sep 2026, so the rules the
 * review passes settled are unit-tested rather than pinned by source text.
 */
import type { AreaSuggestion, ProjectArea } from '../types';
import { isConfidentlyInsideArea } from './GpsPrecision';

export type GpsPoint = Readonly<{ latitude: number; longitude: number }>;
export type GpsFix = GpsPoint & Readonly<{ accuracy: number | null }>;

export function hasSavedAreaLocation(area: Pick<ProjectArea, 'locationCapturedAt'>): boolean {
  return Boolean(area.locationCapturedAt);
}

export function distanceBetweenCoordinatesFeet(from: GpsPoint, to: GpsPoint): number {
  const earthRadiusFeet = 20902231;
  const toRadians = (value: number) => (value * Math.PI) / 180;
  const latitudeDelta = toRadians(to.latitude - from.latitude);
  const longitudeDelta = toRadians(to.longitude - from.longitude);
  const fromLatitude = toRadians(from.latitude);
  const toLatitude = toRadians(to.latitude);

  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(fromLatitude) *
      Math.cos(toLatitude) *
      Math.sin(longitudeDelta / 2) ** 2;

  return (
    earthRadiusFeet *
    2 *
    Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine))
  );
}

/** Every area with a saved point, nearest centre first. */
export function findProjectAreaSuggestions(
  currentLocation: GpsFix | null,
  projectAreas: readonly ProjectArea[],
  options: Readonly<{ diagnose?: boolean }> = {},
): AreaSuggestion[] {
  const savedLocationAreas = projectAreas.filter(hasSavedAreaLocation);

  if (!currentLocation || savedLocationAreas.length === 0) {
    const diagnose = options.diagnose ?? true;
    if (diagnose && typeof __DEV__ !== 'undefined' && __DEV__ && currentLocation && projectAreas.length > 0) {
      console.warn(
        'PIE_GPS_MATCH_DIAGNOSTIC no_saved_project_area_coordinates',
        {
          totalProjectAreas: projectAreas.length,
          missingSavedCoordinates: projectAreas.filter(area => !hasSavedAreaLocation(area)).length,
        },
      );
    }

    return [];
  }

  return savedLocationAreas
    .map(area => {
      const distanceFeet = distanceBetweenCoordinatesFeet(currentLocation, area);

      return {
        area,
        distanceFeet,
        withinRadius: isConfidentlyInsideArea({
          distanceFeet,
          accuracyMeters: currentLocation.accuracy,
          radiusFeet: area.radiusFeet,
        }),
      };
    })
    .sort((a, b) => a.distanceFeet - b.distanceFeet);
}

/**
 * The nearest area that confidently contains you, else the nearest area: a
 * small area close by must not hide a larger one you are inside (review
 * pass 3). For one project's areas (the draft, the location summary and
 * fusion scope them; pass 16); home-screen detection across projects gates
 * on the nearest centre instead (review pass 4).
 */
export function findClosestProjectArea(
  currentLocation: GpsFix | null,
  projectAreas: readonly ProjectArea[],
  options: Readonly<{ diagnose?: boolean }> = {},
): AreaSuggestion | null {
  const suggestions = findProjectAreaSuggestions(currentLocation, projectAreas, options);
  return suggestions.find(suggestion => suggestion.withinRadius) || suggestions[0] || null;
}

export type HomeDetectionStatus = 'unmatched' | 'multiple' | 'detected';

/**
 * Home-screen project detection from one fix, across every project's areas.
 * The clear winner comes from the areas you are confidently inside. Walking
 * the areas by nearest centre up to the winner's first area you are
 * confidently inside, an area you are not confidently inside keeps the
 * result uncertain when it is another project's (or no known project's);
 * the winner's own adjacent areas do not (review passes 4 and 20: an
 * adjacent area of the same project made you "unmatched" while you stood in
 * a mapped area; pass 21: checking only the single nearest centre let one
 * of them hide another project's area between it and the area you were in).
 */
export function homeDetectionDecision(input: Readonly<{
  /** Every area with a saved point, nearest centre first (findProjectAreaSuggestions). */
  suggestions: readonly AreaSuggestion[];
  clearProjectName: string | null;
  ambiguous: boolean;
  hasCandidates: boolean;
  projectForArea: (area: ProjectArea) => string | null;
}>): Readonly<{ status: HomeDetectionStatus; projectName: string | null }> {
  const unmatched = { status: 'unmatched', projectName: null } as const;
  if (!input.hasCandidates || input.suggestions.length === 0) return unmatched;
  if (input.ambiguous) return { status: 'multiple', projectName: null };
  const projectName = input.clearProjectName;
  if (!projectName) return unmatched;
  for (const suggestion of input.suggestions) {
    const owner = input.projectForArea(suggestion.area);
    if (suggestion.withinRadius) {
      if (owner === projectName) return { status: 'detected', projectName };
      continue;
    }
    if (owner !== projectName) return unmatched;
  }
  return unmatched;
}

/** A suggestion, and the draft whose fix produced it (review pass 3). */
export type DraftAreaSuggestionEntry = Readonly<{ draftId: string; suggestion: AreaSuggestion }>;

/**
 * The draft's suggestion as it stands now: only for the draft that produced
 * it, only while the area still exists with a saved point (review pass 4),
 * and only while the draft's fix is still confidently inside the area's
 * current point and radius (review pass 5).
 */
export function currentDraftAreaSuggestion(input: Readonly<{
  entry: DraftAreaSuggestionEntry | null;
  draft: Readonly<{
    id: string;
    gpsLatitude?: number | null;
    gpsLongitude?: number | null;
    gpsAccuracy?: number | null;
  }>;
  areas: readonly ProjectArea[];
}>): AreaSuggestion | null {
  const { entry, draft } = input;
  if (!entry || entry.draftId !== draft.id) return null;
  const area = input.areas.find(item => item.id === entry.suggestion.area.id);
  if (!area || !hasSavedAreaLocation(area)) return null;
  if (typeof draft.gpsLatitude !== 'number' || typeof draft.gpsLongitude !== 'number') return null;
  const distanceFeet = distanceBetweenCoordinatesFeet(
    { latitude: draft.gpsLatitude, longitude: draft.gpsLongitude },
    area,
  );
  const withinRadius = isConfidentlyInsideArea({
    distanceFeet,
    accuracyMeters: draft.gpsAccuracy,
    radiusFeet: area.radiusFeet,
  });
  return withinRadius ? { area, distanceFeet, withinRadius } : null;
}
