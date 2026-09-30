jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async () => null),
  setItem: jest.fn(async () => undefined),
  removeItem: jest.fn(async () => undefined),
  getAllKeys: jest.fn(async () => []),
  multiGet: jest.fn(async () => []),
}));

import {
  buildProjectDeletionCascade,
  referenceDocumentDeletedWithProject,
} from '../../services/ProjectDeletionTransaction';

const fs = jest.requireActual('fs') as typeof import('fs');
const path = jest.requireActual('path') as typeof import('path');
const app = fs.readFileSync(path.resolve(__dirname, '../../App.tsx'), 'utf8');

// Whole-app audit A3 pass 3 (30 Sep 2026). A schedule imported for A, B and C
// kept B and C in the cloud when A was deleted, with B as its project name.
// Deleting B later on the phone matched only that name: it removed the
// schedule, deleted its file and wrote a deletion record that hid it from C
// on both devices, while the cloud still kept it for C.
describe('deleting a project keeps a document shared with other projects', () => {
  const master = {
    id: 'doc-master', projectId: null, projectName: 'B', projectNames: ['B', 'C'], uri: 'file:///docs/master.pdf',
  };
  const cascadeFor = (referenceDocuments: Array<Record<string, unknown>>) => buildProjectDeletionCascade({
    projectName: 'B',
    authorityProjectId: 'project-b',
    deletedAt: '2026-09-30T12:00:00.000Z',
    projectRecords: [{ name: 'B' }, { name: 'C' }],
    archivedProjects: [],
    deletedProjectNames: [],
    updates: [],
    updateTombstones: [],
    updateDeletionIntents: [],
    projectDocuments: [],
    referenceDocuments,
    projectAreas: [],
    scheduleItems: [],
    daveSyncTombstones: [],
    draft: null,
    draftBelongsToProject: false,
    replacementDraft: null,
    cloudIntents: [],
    fileCleanupIntents: [],
    newFileCleanupIntents: [],
    buildUpdateTombstone: (update: { id: string }, deletedAt: string) => ({ updateId: update.id, deletedAt }),
  } as never);

  it('drops only this project from the list, as the cloud does, and writes no deletion record', () => {
    const cascade = cascadeFor([
      master,
      { id: 'doc-b-only', projectId: null, projectName: 'B', projectNames: ['B'] },
      { id: 'doc-c-lists-b', projectId: null, projectName: 'C', projectNames: ['C', ' b ', 'D'] },
      { id: 'doc-other', projectId: null, projectName: 'D', projectNames: ['D'] },
    ]);
    expect(cascade.remainingReferenceDocuments).toEqual([
      { ...master, projectName: 'C', projectNames: ['C'] },
      { id: 'doc-c-lists-b', projectId: null, projectName: 'C', projectNames: ['C', 'D'] },
      { id: 'doc-other', projectId: null, projectName: 'D', projectNames: ['D'] },
    ]);
    expect(cascade.removedReferenceDocuments.map((document: { id: string }) => document.id)).toEqual(['doc-b-only']);
    const documentTombstones = cascade.nextDAVESyncTombstones
      .filter((tombstone: { entityType: string }) => tombstone.entityType === 'reference_document')
      .map((tombstone: { recordId: string }) => tombstone.recordId);
    expect(documentTombstones).toEqual(['doc-b-only']);
  });

  it('still removes a document that names only this project, by name or by its id', () => {
    const cascade = cascadeFor([
      { id: 'by-name', projectName: 'B' },
      { id: 'by-id', projectId: 'project-b', projectName: null },
      { id: 'single-list', projectName: 'B', projectNames: ['b'] },
    ]);
    expect(cascade.remainingReferenceDocuments).toEqual([]);
    expect(cascade.removedReferenceDocuments.map((document: { id: string }) => document.id))
      .toEqual(['by-name', 'by-id', 'single-list']);
  });

  it('leaves a shared schedule\'s file out of the delete cleanup', () => {
    expect(referenceDocumentDeletedWithProject(master, 'B', 'project-b')).toBe(false);
    expect(referenceDocumentDeletedWithProject({ id: 'x', projectName: 'B', projectNames: ['B'] }, 'B', 'project-b')).toBe(true);
    const start = app.indexOf('const explicitlyOwnedReferenceDocuments = referenceDocuments.filter(document =>');
    expect(start).toBeGreaterThan(0);
    expect(app.slice(start, start + 200)).toContain('referenceDocumentDeletedWithProject(');
  });
});
