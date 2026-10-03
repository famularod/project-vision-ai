jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async () => null),
  setItem: jest.fn(async () => undefined),
  removeItem: jest.fn(async () => undefined),
  getAllKeys: jest.fn(async () => []),
  multiGet: jest.fn(async () => []),
}));

import { act, renderHook } from '@testing-library/react-native';
import { buildProjectDeletionCascade } from '../../services/ProjectDeletionTransaction';
import { createDAVEOperationalRealtimeApplier } from '../../services/DAVEOperationalRealtimeApplication';
import {
  deletedProjectNameMessage,
  projectNameAvailability,
  queuedProjectNameChanges,
} from '../../services/ProjectNameRules';
import { useCommittedText } from '../../hooks/use-committed-text';

const fs = jest.requireActual('fs') as typeof import('fs');
const path = jest.requireActual('path') as typeof import('path');
const app = fs.readFileSync(path.resolve(__dirname, '../../App.tsx'), 'utf8');

// Whole-app audit A3 (projects, work areas, contacts), pass 1 (30 Sep 2026).
describe('a deleted project’s name is refused with the reason; an archived one is offered for reopening', () => {
  const availability = (projectName: string, extra: Partial<Parameters<typeof projectNameAvailability>[0]> = {}) =>
    projectNameAvailability({
      projectName,
      projects: ['Roof 2400'],
      archivedProjects: ['Pad East'],
      deletedProjectNames: ['Tower B'],
      tombstones: [
        { entityType: 'project', recordId: 'Old Yard', deletedAt: '2026-09-01T12:00:00.000Z' },
        { entityType: 'project_area', recordId: 'Gate 3', deletedAt: '2026-09-01T12:00:00.000Z' },
      ],
      ...extra,
    });

  it('reads a synced deletion record, the local deleted list, the archive and the project list in that order', () => {
    expect(availability(' old yard ')).toEqual({ kind: 'deleted', deletedAt: '2026-09-01T12:00:00.000Z' });
    expect(availability('TOWER B')).toEqual({ kind: 'deleted', deletedAt: null });
    expect(availability('pad east')).toEqual({ kind: 'archived', projectName: 'Pad East' });
    expect(availability('roof 2400')).toEqual({ kind: 'exists' });
    // Another kind of deletion record never blocks a project name.
    expect(availability('Gate 3')).toEqual({ kind: 'available' });
    expect(availability('Roof 2500')).toEqual({ kind: 'available' });
    // Deleted wins over archived and listed.
    expect(availability('Pad East', { deletedProjectNames: ['pad east'] }).kind).toBe('deleted');
  });

  it('says why and what to do instead', () => {
    expect(deletedProjectNameMessage('Old Yard', 'Sep 1, 2026')).toBe(
      'Old Yard was deleted on Sep 1, 2026. A deleted project\'s name cannot be used again yet, because the deletion is still recorded on every device. Use a different name, for example with the year added.',
    );
    expect(deletedProjectNameMessage('Tower B', null)).toMatch(/^Tower B was deleted\. A deleted/);
  });

  it('is wired in addProject before the "Already added" check, and a deleted name is no longer cleared there', () => {
    const start = app.indexOf('\nfunction addProject(projectName: string) {');
    const body = app.slice(start, app.indexOf('\n  function addAndChangeDraftProject(', start));
    expect(body).toMatch(/const availability = projectNameAvailability\(\{\n\s+projectName: trimmed, projects, archivedProjects,\n\s+deletedProjectNames: deletedProjectNamesRef\.current, tombstones: operationalSyncTombstonesRef\.current,/);
    expect(body).toContain("Alert.alert('Name not available', deletedProjectNameMessage(trimmed, deletedOn));");
    expect(body).toMatch(/availability\.kind === 'archived'[\s\S]*?'Project is archived'[\s\S]*?text: 'Reopen', onPress: \(\) => reopenProject\(availability\.projectName\)/);
    expect(body.indexOf("availability.kind === 'deleted'")).toBeLessThan(body.indexOf("'Already added'"));
    expect(body).not.toContain('clearProjectDeletion(');
  });
});

describe('deleting a project takes the updates kept as historical evidence for its deleted tasks', () => {
  const cascadeFor = (updates: Array<Record<string, unknown>>) => buildProjectDeletionCascade({
    projectName: 'Target',
    authorityProjectId: 'project-target',
    deletedAt: '2026-09-30T12:00:00.000Z',
    projectRecords: [{ name: 'Target' }, { name: 'Other' }],
    archivedProjects: [],
    deletedProjectNames: [],
    updates,
    updateTombstones: [],
    updateDeletionIntents: [],
    projectDocuments: [],
    referenceDocuments: [],
    projectAreas: [],
    scheduleItems: [{ id: 'task-live', projectName: 'Target' }, { id: 'task-other', projectName: 'Other' }],
    daveSyncTombstones: [],
    draft: { draft: { projectName: 'Other' }, savedAt: 'old' },
    draftBelongsToProject: false,
    replacementDraft: { draft: { projectName: 'Other' }, savedAt: 'now' },
    cloudIntents: [],
    fileCleanupIntents: [],
    newFileCleanupIntents: [],
    buildUpdateTombstone: (update: { id: string }, deletedAt: string) => ({ updateId: update.id, deletedAt }),
  } as never);

  it('removes an update whose task no longer exists when it names the project, and leaves the rest', () => {
    const cascade = cascadeFor([
      { id: 'u-live', projectName: 'Target', scheduleItemId: 'task-live' },
      { id: 'u-historical', projectName: 'Target', scheduleItemId: 'task-gone' },
      { id: 'u-historical-parent', projectName: 'Container', scheduleProjectName: 'Target', scheduleItemId: 'task-gone-2' },
      { id: 'u-other-historical', projectName: 'Other', scheduleItemId: 'task-gone-3' },
      // The explicit parent wins over an area label that happens to match.
      { id: 'u-other-parent-historical', projectName: 'Target', scheduleProjectName: 'Other', scheduleItemId: 'task-gone-4' },
      { id: 'u-other', projectName: 'Other', scheduleItemId: 'task-other' },
    ]);
    expect(cascade.removedUpdates.map((update: { id: string }) => update.id).sort()).toEqual(['u-historical', 'u-historical-parent', 'u-live']);
    expect(cascade.remainingUpdates.map((update: { id: string }) => update.id).sort()).toEqual(['u-other', 'u-other-historical', 'u-other-parent-historical']);
    expect(cascade.nextUpdateTombstones.map((tombstone: { updateId: string }) => tombstone.updateId).sort()).toEqual(['u-historical', 'u-historical-parent', 'u-live']);
  });
});

describe('a realtime project row', () => {
  const applierFor = (state: Partial<Record<string, unknown>>) => {
    const commitProjects = jest.fn();
    const apply = createDAVEOperationalRealtimeApplier({
      isActive: () => true,
      snapshot: () => ({
        projects: [], projectRecords: [], archivedProjects: [], deletedProjectNames: [],
        updates: [], deletedUpdates: [], tombstones: [], areas: [], scheduleItems: [], documents: [],
        ...state,
      }),
      getPendingQueue: async () => [],
      normalizeUpdate: (value: unknown) => value,
      normalizeAreas: (value: unknown) => value,
      normalizeSchedule: (value: unknown) => value,
      normalizeDocuments: (value: unknown) => value,
      migrateSchedule: (value: unknown) => value,
      localPhotoUri: () => '',
      mergeProjectNames: (base: string[], ...sources: string[][]) => [...new Set([...sources.flat(), ...base])],
      updateHasPendingLocalWork: () => false,
      mergeUpdates: ({ localUpdates }: { localUpdates: unknown[] }) => localUpdates,
      buildUpdateTombstone: jest.fn(),
      buildCloudDeletionBarrier: jest.fn(),
      upsertDeletedUpdate: (current: unknown[], next: unknown) => [...current, next],
      commitProjects, commitDeletedProjects: jest.fn(), commitUpdates: jest.fn(), commitDeletedUpdates: jest.fn(),
      commitTombstones: jest.fn(), commitAreas: jest.fn(), commitSchedule: jest.fn(), commitDocuments: jest.fn(),
    } as never);
    return { apply, commitProjects };
  };
  const row = (id: string, name: string) => ({ eventType: 'UPDATE' as const, newRow: { id, name, archived: false, updated_at: '2026-09-30T12:00:00.000Z' } });

  it('does not bring back a project this device deleted', async () => {
    const deleted = applierFor({ deletedProjectNames: ['Roof 2400'], projects: ['Other'], projectRecords: [{ name: 'Other' }] });
    expect(await deleted.apply('project', row('p-1', 'Roof 2400') as never)).toBe(true);
    expect(deleted.commitProjects).not.toHaveBeenCalled();
  });

  it('the echo of a project added on this phone replaces its id-less record instead of adding a second row', async () => {
    const own = applierFor({ projects: ['Roof 2400', 'Other'], projectRecords: [{ name: 'Roof 2400' }, { name: 'Other', id: 'p-9' }] });
    await own.apply('project', row('p-1', 'Roof 2400') as never);
    expect(own.commitProjects).toHaveBeenCalledTimes(1);
    const records = own.commitProjects.mock.calls[0][0] as Array<{ id?: string | null; name: string }>;
    expect(records.map(record => [record.id ?? null, record.name])).toEqual([['p-1', 'Roof 2400'], ['p-9', 'Other']]);
    // A later edit of the same project (same id, renamed) still replaces by id.
    const renamed = applierFor({ projects: ['Roof 2400'], projectRecords: [{ id: 'p-1', name: 'Roof 2400' }] });
    await renamed.apply('project', row('p-1', 'Roof 2400 East') as never);
    const next = renamed.commitProjects.mock.calls[0][0] as Array<{ id?: string | null; name: string }>;
    expect(next.map(record => record.name)).toEqual(['Roof 2400 East']);
  });
});

describe('the work-area name field', () => {
  const render = (initial: { name?: string; id?: string }) => {
    const onCommit = jest.fn();
    const hook = renderHook(
      (props: { name?: string; id?: string }) => useCommittedText(props.name, props.id, onCommit),
      { initialProps: initial },
    );
    return { hook, onCommit };
  };

  it('keeps what is typed, spaces included, and commits it once, trimmed, when the field is left', () => {
    const { hook, onCommit } = render({ name: 'Pad', id: 'area-1' });
    act(() => hook.result.current.setText('Pad '));
    act(() => hook.result.current.setText('Pad East '));
    expect(hook.result.current.text).toBe('Pad East ');
    expect(onCommit).not.toHaveBeenCalled();
    act(() => hook.result.current.commit());
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith('Pad East');
  });

  it('an emptied field keeps the saved name; an unchanged one commits nothing', () => {
    const { hook, onCommit } = render({ name: 'Pad East', id: 'area-1' });
    act(() => hook.result.current.setText('   '));
    act(() => hook.result.current.commit());
    expect(hook.result.current.text).toBe('Pad East');
    act(() => hook.result.current.setText(' Pad East '));
    act(() => hook.result.current.commit());
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('an echo of the saved name does not reset the typing; another area does', () => {
    const { hook } = render({ name: 'Pad', id: 'area-1' });
    act(() => hook.result.current.setText('Pad Ea'));
    hook.rerender({ name: 'Pad (synced)', id: 'area-1' });
    expect(hook.result.current.text).toBe('Pad Ea');
    hook.rerender({ name: 'Gate 3', id: 'area-2' });
    expect(hook.result.current.text).toBe('Gate 3');
  });

  it('the sheet commits on blur, on close and before Update GPS', () => {
    expect(app).toContain('const areaName = useCommittedText(area?.name, area?.id, name => onUpdate({ name }));');
    // onBlur only: onEndEditing fires alongside it and would commit twice.
    expect(app).toMatch(/value=\{areaName\.text\}\n\s+onChangeText=\{areaName\.setText\}\n\s+onBlur=\{areaName\.commit\}\n\s+placeholder="Location name"/);
    expect(app).toMatch(/function closeWithName\(\) \{\n\s+areaName\.commit\(\);\n\s+onClose\(\);\n\s+\}/);
    expect(app).toContain('onRequestClose={closeWithName}');
    expect(app).toMatch(/onPress=\{\(\) => \{\n\s+areaName\.commit\(\);\n\s+onUseCurrentLocation\(\);\n\s+\}\}/);
    expect(app).not.toContain('onChangeText={name => onUpdate({ name })}');
  });
});

describe('the startup archived list and a deleted project’s cover photo', () => {
  it('a reopen or deletion still in the offline queue is read from the queue', () => {
    const changes = queuedProjectNameChanges([
      { entity: 'project', operation: 'update', payload: { previousName: 'Pad East', archived: false } },
      { entity: 'project', operation: 'update', payload: { previousName: 'Roof 2400', archived: true } },
      { entity: 'project', operation: 'update', payload: { previousName: 'Old', name: 'New' } },
      { entity: 'project', operation: 'delete', payload: { name: 'Tower B' } },
      { entity: 'project', operation: 'delete', payload: { name: '  ' } },
      { entity: 'project', operation: 'delete', payload: null },
      { entity: 'project_area', operation: 'update', payload: { previousName: 'Gate 3', archived: false } },
    ]);
    expect([...changes.reopenedKeys]).toEqual(['pad east']);
    expect(changes.deletedNames).toEqual(['Tower B']);
  });

  it('is wired into the startup load and the delete flow', () => {
    expect(app).toContain('const queuedProjectChanges = queuedProjectNameChanges(queuedChanges);');
    expect(app).toContain('cloudArchivedProjects.filter(project => !reopenedKeys.has(project.trim().toLowerCase())),');
    expect(app).toMatch(/const deletedCoverPhoto = projectRecords\.find\(project => project\.name\.toLowerCase\(\) === projectName\.toLowerCase\(\)\)\?\.coverPhoto;\n\s+void removeCachedProjectCoverPhoto\(deletedCoverPhoto\)\.catch/);
  });
});
