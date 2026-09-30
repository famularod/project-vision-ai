import { LEGACY_NON_PROJECT_SHELL_NAMES } from './CrossDeviceVisibility';
import { legacyProjectNameKey } from './OperationalProjectIdentity';

// Project names from an earlier version of the app. On every launch App.tsx
// adds these names to the deleted-project list (the work-container names from
// LEGACY_WORK_CONTAINER_MIGRATIONS and the shell names above), so a new
// project given one of them would disappear on the next launch. The migration
// table itself must stay in App.tsx, so these names are repeated here; a test
// fails if the two lists drift apart.
export const LEGACY_WORK_CONTAINER_PROJECT_NAMES = [
  '2321 North Side Lot',
  '3 Hour Fire wall',
  'Building 2321  East Driveway',
  'Building 2375 Compliance',
  'Canopy A',
  'Canopy B',
  'Canopy C',
] as const;

export const RESERVED_LEGACY_PROJECT_NAME_MESSAGE =
  'That name is reserved from an earlier version of the app. Please choose a different name.';

// Same comparison the startup deletion list uses: surrounding spaces and
// letter case are ignored, spaces inside the name are not.
const RESERVED_LEGACY_PROJECT_KEYS = new Set(
  [...LEGACY_WORK_CONTAINER_PROJECT_NAMES, ...LEGACY_NON_PROJECT_SHELL_NAMES].map(reservedKey),
);

// The launch-time document migration matches by document key, which ignores
// punctuation and spacing, so "3-Hour Fire Wall" or "Canopy-A" would have
// its documents moved to the old parent project on every launch (audit A3
// pass 3). Those names are reserved as well.
const RESERVED_LEGACY_DOCUMENT_KEYS = new Set(
  [...LEGACY_WORK_CONTAINER_PROJECT_NAMES, ...LEGACY_NON_PROJECT_SHELL_NAMES].map(legacyProjectNameKey),
);

export function isReservedLegacyProjectName(name: string | null | undefined) {
  const key = reservedKey(name);
  return key.length > 0 &&
    (RESERVED_LEGACY_PROJECT_KEYS.has(key) || RESERVED_LEGACY_DOCUMENT_KEYS.has(legacyProjectNameKey(key)));
}

function reservedKey(value: string | null | undefined) {
  return (value || '').trim().toLocaleLowerCase();
}
