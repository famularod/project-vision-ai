import {
  formatVitruviusDesktopGreeting,
  readVitruviusDesktopDisplayName,
  VITRUVIUS_DESKTOP_DISPLAY_NAME_KEY,
  writeVitruviusDesktopDisplayName,
} from '../../services/VitruviusDesktopPreferences';

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
}

describe('Vitruvius desktop preferences', () => {
  it('saves a normalized display name and uses it in the greeting', () => {
    const storage = memoryStorage();

    expect(writeVitruviusDesktopDisplayName('  David   Famularo  ', storage))
      .toBe('David Famularo');
    expect(storage.getItem(VITRUVIUS_DESKTOP_DISPLAY_NAME_KEY))
      .toBe('David Famularo');
    expect(readVitruviusDesktopDisplayName(storage)).toBe('David Famularo');
    expect(
      formatVitruviusDesktopGreeting(
        new Date('2026-07-25T08:00:00'),
        'David Famularo',
      ),
    ).toBe('Good morning, David Famularo');
  });

  it('clears the saved preference and keeps a useful generic greeting', () => {
    const storage = memoryStorage();
    writeVitruviusDesktopDisplayName('David', storage);

    expect(writeVitruviusDesktopDisplayName('   ', storage)).toBe('');
    expect(readVitruviusDesktopDisplayName(storage)).toBe('');
    expect(
      formatVitruviusDesktopGreeting(new Date('2026-07-25T20:00:00'), ''),
    ).toBe('Good evening');
  });
});
