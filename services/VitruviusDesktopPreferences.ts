export const VITRUVIUS_DESKTOP_DISPLAY_NAME_KEY =
  'vitruvius.desktop.display-name.v1';

type PreferenceStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export function normalizeVitruviusDisplayName(value: string): string {
  return value.trim().replace(/\s+/g, ' ').slice(0, 50);
}

export function readVitruviusDesktopDisplayName(
  storage: PreferenceStorage | null = browserPreferenceStorage(),
): string {
  if (!storage) return '';
  try {
    return normalizeVitruviusDisplayName(
      storage.getItem(VITRUVIUS_DESKTOP_DISPLAY_NAME_KEY) || '',
    );
  } catch {
    return '';
  }
}

export function writeVitruviusDesktopDisplayName(
  value: string,
  storage: PreferenceStorage | null = browserPreferenceStorage(),
): string {
  const displayName = normalizeVitruviusDisplayName(value);
  if (!storage) return displayName;
  try {
    if (displayName) {
      storage.setItem(VITRUVIUS_DESKTOP_DISPLAY_NAME_KEY, displayName);
    } else {
      storage.removeItem(VITRUVIUS_DESKTOP_DISPLAY_NAME_KEY);
    }
  } catch {
    // The greeting remains usable even when browser storage is unavailable.
  }
  return displayName;
}

export function formatVitruviusDesktopGreeting(
  date = new Date(),
  displayName = '',
): string {
  const hour = date.getHours();
  const greeting = hour < 12
    ? 'Good morning'
    : hour < 18
      ? 'Good afternoon'
      : 'Good evening';
  const name = normalizeVitruviusDisplayName(displayName);
  return name ? `${greeting}, ${name}` : greeting;
}

function browserPreferenceStorage(): PreferenceStorage | null {
  try {
    return typeof globalThis.localStorage === 'undefined'
      ? null
      : globalThis.localStorage;
  } catch {
    return null;
  }
}
