/**
 * Work-area defaults and normalization.
 *
 * Extracted from App.tsx 2026-09-20 as the first slice of the normalizer
 * extraction. App.tsx was at 20,994 of its 21,066-line ratchet, and this
 * behaviour is testable on its own once it stops needing the whole
 * native-module mock set to import.
 *
 * Behaviour is unchanged, including the fallback to the first seeded area's
 * coordinates when a record carries none.
 */
import type { ProjectArea } from '../types';
import { optionalString, uid } from './RecordValues';

export const DEFAULT_PROJECT_AREAS: ProjectArea[] = [
  {
    id: 'area-building-2321',
    name: 'Building 2321',
    building: '2321',
    latitude: 37.3349,
    longitude: -122.009,
    radiusFeet: 250,
  },
  {
    id: 'area-building-2375',
    name: 'Building 2375',
    building: '2375',
    latitude: 37.3354,
    longitude: -122.0084,
    radiusFeet: 250,
  },
  {
    id: 'area-canopy-a',
    name: 'Canopy A',
    latitude: 37.335,
    longitude: -122.0078,
    radiusFeet: 175,
  },
  {
    id: 'area-canopy-b',
    name: 'Canopy B',
    latitude: 37.3346,
    longitude: -122.0074,
    radiusFeet: 175,
  },
  {
    id: 'area-canopy-c',
    name: 'Canopy C',
    latitude: 37.3342,
    longitude: -122.007,
    radiusFeet: 175,
  },
  {
    id: 'area-h2-room',
    name: 'H2 Room',
    building: 'H2',
    latitude: 37.3339,
    longitude: -122.0082,
    radiusFeet: 150,
  },
  {
    id: 'area-pump-house',
    name: 'Pump House',
    latitude: 37.3335,
    longitude: -122.0087,
    radiusFeet: 175,
  },
  {
    id: 'area-tank-farm',
    name: 'Tank Farm',
    latitude: 37.3331,
    longitude: -122.0092,
    radiusFeet: 300,
  },
  {
    id: 'area-wastewater',
    name: 'Wastewater Area',
    latitude: 37.3328,
    longitude: -122.0079,
    radiusFeet: 250,
  },
  {
    id: 'area-north-lot',
    name: 'North Lot',
    latitude: 37.336,
    longitude: -122.0088,
    radiusFeet: 400,
  },
  {
    id: 'area-east-driveway',
    name: 'East Driveway',
    latitude: 37.3347,
    longitude: -122.0065,
    radiusFeet: 300,
  },
  {
    id: 'area-other',
    name: 'Other',
    latitude: 37.3349,
    longitude: -122.008,
    radiusFeet: 100,
  },
];

export function normalizeProjectArea(value: Partial<ProjectArea>): ProjectArea {
  return {
    // Carry through fields this build does not manage; see normalizeUpdate.
    ...value,
    id: typeof value.id === 'string' ? value.id : uid(),
    name:
      typeof value.name === 'string' && value.name.trim()
        ? value.name.trim()
        : 'New Area',
    projectName: optionalString(value.projectName)?.trim() || null,
    building:
      typeof value.building === 'string' && value.building.trim()
        ? value.building.trim()
        : undefined,
    latitude:
      typeof value.latitude === 'number' &&
      Number.isFinite(value.latitude)
        ? value.latitude
        : DEFAULT_PROJECT_AREAS[0].latitude,
    longitude:
      typeof value.longitude === 'number' &&
      Number.isFinite(value.longitude)
        ? value.longitude
        : DEFAULT_PROJECT_AREAS[0].longitude,
    radiusFeet:
      typeof value.radiusFeet === 'number' &&
      Number.isFinite(value.radiusFeet) &&
      value.radiusFeet > 0
        ? value.radiusFeet
        : 250,
    locationCapturedAt: optionalString(value.locationCapturedAt),
    updatedAt: optionalString(value.updatedAt),
  };
}
