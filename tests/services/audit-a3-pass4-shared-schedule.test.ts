jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async () => null),
  setItem: jest.fn(async () => undefined),
  removeItem: jest.fn(async () => undefined),
  getAllKeys: jest.fn(async () => []),
  multiGet: jest.fn(async () => []),
}));

import {
  buildProjectDeletionCascade,
  withoutDeletedSharedProject,
} from '../../services/ProjectDeletionTransaction';
import {
  buildOperationalProjectIdentityAuthority,
  resolveOperationalReferenceDocumentScope,
} from '../../services/OperationalProjectIdentity';

const fs = jest.requireActual('fs') as typeof import('fs');
const path = jest.requireActual('path') as typeof import('path');
const app = fs.readFileSync(path.resolve(__dirname, '../../App.tsx'), 'utf8');

const A_ID = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
const B_ID = '5c2d8e1f-3a4b-4c5d-8e6f-7a8b9c0d1e2f';
const C_ID = '7d6c5b4a-3f2e-4d1c-9b8a-7f6e5d4c3b2a';

// Whole-app audit A3 pass 4 (30 Sep 2026), finding 2: a combined schedule
// kept after one of its projects is deleted still carried that project's id,
// and every later upload was refused as "no longer matches an active cloud
// project".
describe('a shared schedule follows its remaining project', () => {
  const cascadeFor = (
    referenceDocuments: Array<Record<string, unknown>>,
    projectRecords: Array<{ name: string; id?: string | null }>,
  ) => buildProjectDeletionCascade({
    projectName: 'A',
    authorityProjectId: 'project-a',
    deletedAt: '2026-09-30T12:00:00.000Z',
    projectRecords,
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

  it('takes the next project\'s cloud id when the phone knows it, and lists the rewritten document', () => {
    const shared = { id: 'combined', projectId: A_ID, projectName: 'A', projectNames: ['A', 'B', 'C'] };
    const cascade = cascadeFor([shared], [{ name: 'A', id: A_ID }, { name: 'B', id: B_ID }, { name: 'C', id: C_ID }]);
    const kept = { ...shared, projectId: B_ID, projectName: 'B', projectNames: ['B', 'C'] };
    expect(cascade.remainingReferenceDocuments).toEqual([kept]);
    expect(cascade.sharedReferenceDocuments).toEqual([kept]);
    expect(cascade.removedReferenceDocuments).toEqual([]);
  });

  it('clears the id when the next project\'s cloud id is not known, and the name decides at upload', () => {
    const shared = { id: 'combined', projectId: A_ID, projectName: 'A', projectNames: ['A', 'B'] };
    expect(cascadeFor([shared], [{ name: 'A', id: A_ID }, { name: 'B' }]).remainingReferenceDocuments)
      .toEqual([{ ...shared, projectId: null, projectName: 'B', projectNames: ['B'] }]);
    // The phone's name key of the deleted project goes too.
    expect(withoutDeletedSharedProject({ id: 'x', projectId: 'project-a', projectName: 'A', projectNames: ['A', 'B'] }, 'A'))
      .toEqual({ id: 'x', projectId: null, projectName: 'B', projectNames: ['B'] });
  });

  it('keeps an id that already names the remaining project, and a document with no id', () => {
    expect(withoutDeletedSharedProject(
      { id: 'x', projectId: B_ID, projectName: 'B', projectNames: ['B', 'A'] }, 'A', [{ name: 'B', id: B_ID }],
    )).toEqual({ id: 'x', projectId: B_ID, projectName: 'B', projectNames: ['B'] });
    expect(withoutDeletedSharedProject(
      { id: 'x', projectId: 'project-b', projectName: 'B', projectNames: ['B', 'A'] }, 'A',
    )).toEqual({ id: 'x', projectId: 'project-b', projectName: 'B', projectNames: ['B'] });
    expect(withoutDeletedSharedProject(
      { id: 'x', projectId: null, projectName: 'A', projectNames: ['A', 'B'] }, 'A',
    )).toEqual({ id: 'x', projectId: null, projectName: 'B', projectNames: ['B'] });
  });
});

describe('the delete cascade withdraws the project\'s queued work (audit A3 pass 4, 1b and 2)', () => {
  it('asks the queue to drop the cover and reopen and rewrite shared copies after the local delete', () => {
    const start = app.indexOf('  async function deleteProjectPermanently(projectName: string) {');
    const body = app.slice(start, app.indexOf('\n  function addProjectArea(', start));
    const withdraw = body.indexOf('withdrawQueuedChangesOfDeletedProject(projectName, projectRecords)');
    expect(withdraw).toBeGreaterThan(body.indexOf('const { cascade, fallbackProject, replacementDraft } = deletionResult;'));
    expect(withdraw).toBeLessThan(body.indexOf('projectDeletionRuntime.processPendingCloudIntents()'));
  });
});

describe('the upload check sets aside a shared document\'s deleted-project id only', () => {
  const authority = buildOperationalProjectIdentityAuthority([
    { id: B_ID, name: 'B' },
    { id: C_ID, name: 'C' },
  ]);

  it('uploads a copy the cloud\'s delete left with the old id under its remaining projects', () => {
    expect(resolveOperationalReferenceDocumentScope(
      { projectId: A_ID, projectName: 'B', projectNames: ['B', 'C'] }, authority,
    )).toEqual({ ok: true, scope: { projectId: B_ID, projectName: 'B', projectNames: ['B', 'C'] } });
    expect(resolveOperationalReferenceDocumentScope(
      { projectId: A_ID, projectName: null, projectNames: ['C'] }, authority,
    )).toEqual({ ok: true, scope: { projectId: C_ID, projectName: 'C', projectNames: ['C'] } });
  });

  it('still refuses every other disagreement', () => {
    // No project list: the id is the only identity.
    expect(resolveOperationalReferenceDocumentScope({ projectId: A_ID, projectName: 'B' }, authority))
      .toMatchObject({ ok: false, code: 'project_identity_invalid' });
    // A name on the list is not an active project (closed or deleted).
    expect(resolveOperationalReferenceDocumentScope(
      { projectId: A_ID, projectName: 'B', projectNames: ['B', 'Gone'] }, authority,
    )).toMatchObject({ ok: false, code: 'project_identity_invalid' });
    // The project name is not on the list.
    expect(resolveOperationalReferenceDocumentScope(
      { projectId: A_ID, projectName: 'Gone', projectNames: ['B'] }, authority,
    )).toMatchObject({ ok: false, code: 'project_identity_invalid' });
    // An active project's id that disagrees with the name is still a mismatch.
    expect(resolveOperationalReferenceDocumentScope(
      { projectId: C_ID, projectName: 'B', projectNames: ['B'] }, authority,
    )).toMatchObject({ ok: false, code: 'project_identity_mismatch' });
    // An id that is not a cloud id at all.
    expect(resolveOperationalReferenceDocumentScope(
      { projectId: 'not-a-uuid', projectName: 'B', projectNames: ['B'] }, authority,
    )).toMatchObject({ ok: false, code: 'project_identity_invalid' });
  });
});
