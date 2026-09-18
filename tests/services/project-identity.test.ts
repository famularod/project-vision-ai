import {
  createProjectId,
  createProjectIdentity,
  isProjectId,
  portfolioScopeFor,
  projectIdForPersistence,
  projectScopeFor,
  renameProjectIdentity,
  requireProjectId,
  requireProjectPersistenceScope,
  restoreProjectRecords,
  scopeContainsProject,
} from '../../services/ProjectIdentity';

const PROJECT_A_ID = requireProjectId('11111111-1111-4111-8111-111111111111');
const PROJECT_B_ID = requireProjectId('22222222-2222-4222-8222-222222222222');

describe('ProjectIdentity', () => {
  it('creates and validates cryptographically supplied UUID identities', () => {
    const id = createProjectId(() => 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA');

    expect(id).toBe('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    expect(isProjectId(id)).toBe(true);
    expect(isProjectId('project-name-slug')).toBe(false);
    expect(() => requireProjectId('project-unassigned')).toThrow(/immutable project UUID/i);
  });

  it('does not derive identity from punctuation or non-ASCII display names', () => {
    const slash = createProjectIdentity('Site A/B', PROJECT_A_ID);
    const dash = createProjectIdentity('Site A-B', PROJECT_B_ID);
    const nonAscii = createProjectIdentity('現場 2375', PROJECT_A_ID);

    expect(slash.id).not.toBe(dash.id);
    expect(nonAscii.id).toBe(PROJECT_A_ID);
    expect(nonAscii.name).toBe('現場 2375');
  });

  it('preserves immutable identity when a project is renamed', () => {
    const original = createProjectIdentity('Original Name', PROJECT_A_ID);
    const renamed = renameProjectIdentity(original, 'Renamed Project');

    expect(renamed.id).toBe(original.id);
    expect(renamed.name).toBe('Renamed Project');
    expect(original.name).toBe('Original Name');
  });

  it('keeps project and portfolio persistence scopes distinct', () => {
    const project = createProjectIdentity('Project A', PROJECT_A_ID);
    const projectScope = projectScopeFor(project);
    const portfolioScope = portfolioScopeFor('portfolio-1', [PROJECT_A_ID, PROJECT_B_ID, PROJECT_A_ID]);

    expect(scopeContainsProject(projectScope, PROJECT_A_ID)).toBe(true);
    expect(scopeContainsProject(projectScope, PROJECT_B_ID)).toBe(false);
    expect(scopeContainsProject(portfolioScope, PROJECT_B_ID)).toBe(true);
    expect(portfolioScope.projectIds).toEqual([PROJECT_A_ID, PROJECT_B_ID]);
    expect(projectIdForPersistence(projectScope)).toBe(PROJECT_A_ID);
    expect(projectIdForPersistence(portfolioScope)).toBeNull();
    expect(() => requireProjectPersistenceScope(portfolioScope)).toThrow(/Portfolio authority/i);
  });

  it('rejects blank display and portfolio identifiers', () => {
    expect(() => createProjectIdentity('   ', PROJECT_A_ID)).toThrow(/display name/i);
    expect(() => portfolioScopeFor('  ', [PROJECT_A_ID])).toThrow(/portfolio identifier/i);
  });
});

describe('restoreProjectRecords (audit P1-41)', () => {
  it('drops records absent from the restore so they cannot resurrect', () => {
    const previous = [{ name: 'Old Site', coverPhoto: 'x' }, { name: 'Kept Site' }];

    const restored = restoreProjectRecords(previous, ['Kept Site', 'New Site']);

    expect(restored.map(record => record.name)).toEqual(['Kept Site', 'New Site']);
  });

  it('preserves existing record metadata for restored names', () => {
    const previous = [{ name: 'Kept Site', coverPhoto: 'cover.jpg' }];

    const restored = restoreProjectRecords(previous, ['kept site']);

    expect(restored[0]).toEqual({ name: 'Kept Site', coverPhoto: 'cover.jpg' });
  });

  it('creates bare records for names with no prior record', () => {
    expect(restoreProjectRecords([], ['Fresh Site'])).toEqual([{ name: 'Fresh Site' }]);
  });
});

describe('restoreProjectRecords with full backup records (BAK-01)', () => {
  it('restores id, cover photo and project data from the backup on a fresh device', () => {
    const backup = [
      { id: 'uuid-2375', name: '2375 Compliance Project', coverPhoto: { remotePath: 'covers/2375.jpg', updatedAt: '2026-08-01T00:00:00.000Z' }, data: { building: '2375' } },
    ];
    const restored = restoreProjectRecords([], ['2375 Compliance Project'], backup);
    expect(restored[0]).toEqual(backup[0]);
  });

  it('keeps the local record when the device already has one', () => {
    const local = [{ id: 'uuid-local', name: 'Kept Site', data: { note: 'newer' } }];
    const backup = [{ id: 'uuid-old', name: 'kept site', data: { note: 'older' }, coverPhoto: { updatedAt: 'x' } }];
    const restored = restoreProjectRecords(local, ['Kept Site'], backup);
    expect(restored[0]).toMatchObject({ id: 'uuid-local', data: { note: 'newer' }, coverPhoto: { updatedAt: 'x' } });
  });

  it('still works for older backups that carry names only', () => {
    expect(restoreProjectRecords([], ['Fresh Site'], null)).toEqual([{ name: 'Fresh Site' }]);
  });
});
