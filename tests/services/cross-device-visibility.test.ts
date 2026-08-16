import {
  isLegacyNonProjectShellName,
  legacyNonProjectShellNamesPresent,
  LEGACY_NON_PROJECT_SHELL_NAMES,
} from '../../services/CrossDeviceVisibility';

describe('cross-device project visibility', () => {
  it('recognizes only the known task-only project shells', () => {
    for (const name of LEGACY_NON_PROJECT_SHELL_NAMES) {
      expect(isLegacyNonProjectShellName(`  ${name.toUpperCase()}  `)).toBe(true);
    }

    expect(isLegacyNonProjectShellName('2321 Compliance Project')).toBe(false);
    expect(isLegacyNonProjectShellName('2375 Compliance Project')).toBe(false);
  });

  it('selects exact task-only shells while preserving cloud names and order', () => {
    expect(legacyNonProjectShellNamesPresent([
      { name: '2321 Compliance Project' },
      { name: ' H-2 Room ' },
      { name: 'Fire Pump House' },
      { name: '2375 Compliance Project' },
    ])).toEqual(['H-2 Room', 'Fire Pump House']);
  });
});
