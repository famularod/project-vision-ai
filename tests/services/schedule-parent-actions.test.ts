/**
 * Audit P1-57: schedule mutations must create missing parent projects
 * without ever reopening an archived project. Reopening requires an
 * explicit user transition (reopenArchivedParents: true).
 */

import { resolveScheduleParentActions } from '../../services/PIEScheduleImportBatch';

describe('resolveScheduleParentActions', () => {
  const existingProjects = ['Alpha', 'Beta', 'Gamma'];
  const archivedProjects = ['Beta'];

  it('creates missing parents without touching archive state', () => {
    const actions = resolveScheduleParentActions({
      parentNames: ['Alpha', 'Delta'],
      existingProjects,
      archivedProjects,
      reopenArchivedParents: false,
    });

    expect(actions.missingNames).toEqual(['Delta']);
    expect(actions.reopeningNames).toEqual([]);
  });

  it('never reopens an archived parent from a background schedule mutation', () => {
    const actions = resolveScheduleParentActions({
      parentNames: ['Beta'],
      existingProjects,
      archivedProjects,
      reopenArchivedParents: false,
    });

    expect(actions.reopeningNames).toEqual([]);
    expect(actions.missingNames).toEqual([]);
  });

  it('reopens an archived parent only under an explicit user transition', () => {
    const actions = resolveScheduleParentActions({
      parentNames: ['Beta', 'Delta'],
      existingProjects,
      archivedProjects,
      reopenArchivedParents: true,
    });

    expect(actions.reopeningNames).toEqual(['Beta']);
    expect(actions.missingNames).toEqual(['Delta']);
  });

  it('matches archived and existing names case- and whitespace-insensitively', () => {
    const actions = resolveScheduleParentActions({
      parentNames: [' beta ', 'ALPHA', 'new site'],
      existingProjects,
      archivedProjects,
      reopenArchivedParents: true,
    });

    expect(actions.reopeningNames).toEqual([' beta ']);
    expect(actions.missingNames).toEqual(['new site']);
  });
});
