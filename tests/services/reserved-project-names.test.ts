import fs from 'fs';
import path from 'path';

import { LEGACY_NON_PROJECT_SHELL_NAMES } from '../../services/CrossDeviceVisibility';
import {
  isReservedLegacyProjectName,
  LEGACY_WORK_CONTAINER_PROJECT_NAMES,
} from '../../services/ReservedProjectNames';

describe('reserved legacy project names', () => {
  it('reserves every name the startup deletion list removes, ignoring case and outer spaces', () => {
    for (const name of [...LEGACY_WORK_CONTAINER_PROJECT_NAMES, ...LEGACY_NON_PROJECT_SHELL_NAMES]) {
      expect(isReservedLegacyProjectName(name)).toBe(true);
      expect(isReservedLegacyProjectName(`  ${name.toUpperCase()}  `)).toBe(true);
      expect(isReservedLegacyProjectName(name.toLowerCase())).toBe(true);
    }
  });

  it('allows ordinary project names, including the parent projects', () => {
    expect(isReservedLegacyProjectName('2321 Compliance Project')).toBe(false);
    expect(isReservedLegacyProjectName('2375 Compliance Project')).toBe(false);
    expect(isReservedLegacyProjectName('Canopy D')).toBe(false);
    expect(isReservedLegacyProjectName('Tank Farm Phase 2')).toBe(false);
    expect(isReservedLegacyProjectName('')).toBe(false);
    expect(isReservedLegacyProjectName('   ')).toBe(false);
    expect(isReservedLegacyProjectName(null)).toBe(false);
    expect(isReservedLegacyProjectName(undefined)).toBe(false);
  });

  it('stays in step with the work-container migration table in App.tsx', () => {
    const app = fs.readFileSync(path.join(__dirname, '..', '..', 'App.tsx'), 'utf8');
    const start = app.indexOf('const LEGACY_WORK_CONTAINER_MIGRATIONS = [');
    expect(start).toBeGreaterThanOrEqual(0);
    const table = app.slice(start, app.indexOf('] as const;', start));
    const legacyNames = [...table.matchAll(/legacyName: '([^']+)'/g)].map(match => match[1]);

    expect(legacyNames.length).toBeGreaterThan(0);
    expect(legacyNames).toEqual([...LEGACY_WORK_CONTAINER_PROJECT_NAMES]);
  });
});
