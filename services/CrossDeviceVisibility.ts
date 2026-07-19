export const LEGACY_NON_PROJECT_SHELL_NAMES = [
  'Building 2321 Driveway',
  'Tank Farm',
  'Racking Project',
  'H-2 Room',
  'Fire Pump House',
  '2321 Trash Enclosure',
  'Home testing',
] as const;

const LEGACY_NON_PROJECT_SHELL_KEYS = new Set(
  LEGACY_NON_PROJECT_SHELL_NAMES.map(normalizedName),
);

export function isLegacyNonProjectShellName(value: string | null | undefined) {
  return LEGACY_NON_PROJECT_SHELL_KEYS.has(normalizedName(value));
}

export function legacyNonProjectShellNamesPresent(
  values: readonly { name: string }[],
): string[] {
  return values
    .map(value => value.name.trim())
    .filter(name => isLegacyNonProjectShellName(name));
}

function normalizedName(value: string | null | undefined) {
  return (value || '').trim().toLocaleLowerCase();
}
