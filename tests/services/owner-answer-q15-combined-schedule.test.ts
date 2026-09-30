/**
 * Owner answer Q15 (David, 30 Sep 2026): a combined schedule labelled with
 * projects Alpha and Beta stays current for Beta when a single-project
 * schedule is made current for Alpha. The cloud records Alpha in the combined
 * schedule's retiredForProjectNames (supabase/migrations/
 * 20260930120000_ecos_schedule_per_project_retirement.sql) and clears it when
 * the combined schedule is made current again. Until that migration is
 * applied the cloud retires the whole combined schedule, and everything the
 * owner is told must be true in both states. Synthetic data.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ReferenceDocument, ScheduleItem } from '../../types';
import {
  currentScheduleDocumentsByProject,
  reconcileCurrentScheduleDocuments,
  scheduleDocumentCurrentLabel,
  scheduleDocumentIsCurrentEverywhere,
  scheduleProjectScopeKey,
  selectAuthoritativeScheduleItems,
} from '../../services/PIEScheduleReconciliation';
import {
  activateSharedReferenceDocument,
  phoneScheduleActivationTarget,
  scheduleActivationEffects,
  scheduleActivationNotice,
  scheduleDocumentsAfterActivation,
  scheduleRetirementMessage,
  scheduleTasksHiddenByActivation,
  scheduleTasksHiddenWarning,
} from '../../services/SharedDocumentActivation';
import {
  createDAVEOperationalRealtimeApplier,
  mergeProjectNames,
} from '../../services/DAVEOperationalRealtimeApplication';
import {
  daveReferenceDocumentsNeedingCloudUpload,
  mergeDAVEReferenceDocumentRecoveryRecords,
} from '../../services/DAVECloudRecovery';
import { normalizeReferenceDocument } from '../../services/ReferenceDocumentRepository';
import { buildDAVEProjectTruth } from '../../services/DAVEProjectTruth';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async () => null),
  setItem: jest.fn(async () => undefined),
  removeItem: jest.fn(async () => undefined),
  getAllKeys: jest.fn(async () => []),
  multiGet: jest.fn(async () => []),
}));
jest.mock('expo-file-system/legacy', () => ({ documentDirectory: null }));

const schedule = (id: string, projectNames: string[], extra: Partial<ReferenceDocument> = {}) => ({
  id,
  name: id,
  originalFileName: `${id}.pdf`,
  uri: '',
  category: 'Schedules',
  notes: '',
  isCurrent: false,
  importedAt: '2026-09-01T00:00:00.000Z',
  projectId: null,
  projectName: projectNames.length === 1 ? projectNames[0] : null,
  projectNames,
  cloudUpdatedAt: `rev-${id}`,
  ...extra,
}) as ReferenceDocument;
const task = (id: string, projectName: string, source: ReferenceDocument) => ({
  id, projectName, taskName: `Task ${id}`, locationName: 'Lot', owner: '', startDate: '07/01/2026',
  finishDate: '07/10/2026', milestone: '', status: 'Not Started', percentComplete: 0, notes: '',
  createdAt: '2026-07-01T00:00:00.000Z', sourceDocumentId: source.id, importBatchId: source.importBatchId,
}) as ScheduleItem;

// The combined master was imported after Alpha's own schedule: making Alpha's current is a rollback.
const master = schedule('Master', ['Alpha', 'Beta'], {
  isCurrent: true, importedAt: '2026-09-10T00:00:00.000Z', importBatchId: 'batch-master',
});
const alphaRollback = schedule('Alpha rev 2', ['Alpha'], { importBatchId: 'batch-alpha' });
const items = [
  task('m-a', 'Alpha', master),
  task('m-b', 'Beta', master),
  task('r-a', 'Alpha', alphaRollback),
];
// The cloud's list after Make Current on Alpha rev 2, with and without the migration.
const afterQ15 = [
  { ...master, retiredForProjectNames: ['Alpha'], cloudUpdatedAt: 'later' },
  { ...alphaRollback, isCurrent: true, cloudUpdatedAt: 'later' },
];
const afterOldRpc = [
  { ...master, isCurrent: false, cloudUpdatedAt: 'later' },
  { ...alphaRollback, isCurrent: true, cloudUpdatedAt: 'later' },
];
const visible = (documents: ReferenceDocument[]) =>
  selectAuthoritativeScheduleItems({ scheduleItems: items, scheduleDocuments: documents }).map(item => item.id).sort();

const probeClient = (answer: { data: unknown; error: unknown }) => ({
  rpc: jest.fn(async () => answer),
}) as unknown as SupabaseClient;
const newDatabase = () => probeClient({ data: 'project', error: null });
const oldDatabase = () => probeClient({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } });
const activated = (documentId: string) => jest.fn(async () => ({
  status: 'activated' as const, documentId, updatedAt: 'later', changedCount: 2, message: null,
}));

describe('each project picks its current schedule with the retirement list', () => {
  it('Alpha picks its own schedule although it is older; Beta keeps the combined master', () => {
    const current = currentScheduleDocumentsByProject(afterQ15);
    expect(current.get(scheduleProjectScopeKey('Alpha'))?.id).toBe('Alpha rev 2');
    expect(current.get(scheduleProjectScopeKey('Beta'))?.id).toBe('Master');
    expect(visible(afterQ15)).toEqual(['m-b', 'r-a']);
    // Both stay current on the device: each is some project's schedule.
    expect(reconcileCurrentScheduleDocuments(afterQ15).filter(document => document.isCurrent).map(document => document.id))
      .toEqual(['Master', 'Alpha rev 2']);
  });

  it('without the list the newer master would win Alpha too, so the list is what makes the rollback hold', () => {
    const noList = [master, { ...alphaRollback, isCurrent: true }];
    expect(currentScheduleDocumentsByProject(noList).get(scheduleProjectScopeKey('Alpha'))?.id).toBe('Master');
    expect(visible(noList)).toEqual(['m-a', 'm-b']);
  });

  it('before the migration Beta is left with no schedule tasks, as the phone warned', () => {
    expect(visible(afterOldRpc)).toEqual(['r-a']);
  });

  it('making the master current again brings Alpha back to it', () => {
    const reactivated = [master, { ...alphaRollback, isCurrent: false }];
    expect(visible(reactivated)).toEqual(['m-a', 'm-b']);
    expect(scheduleDocumentIsCurrentEverywhere(master)).toBe(true);
    expect(scheduleDocumentIsCurrentEverywhere(afterQ15[0])).toBe(false);
  });

  it('labels a combined schedule by the projects it is still current for', () => {
    expect(scheduleDocumentCurrentLabel(afterQ15[0], 'Active schedule')).toBe('Active schedule for Beta');
    expect(scheduleDocumentCurrentLabel(master, 'Current')).toBe('Current');
    // A name in the list that is not one of its projects changes nothing.
    expect(scheduleDocumentCurrentLabel({ ...master, retiredForProjectNames: ['Gamma'] }, 'Current')).toBe('Current');
  });

  it('project truth for Alpha no longer counts the master as a current document; Beta still does', () => {
    const documentIds = (projectName: string) => buildDAVEProjectTruth({
      projectId: projectName.toLowerCase(), projectName, updates: [], scheduleItems: [],
      referenceDocuments: afterQ15, now: '2026-09-30T12:00:00.000Z',
    }).evidence.records.map(record => record.id).filter(id => id.startsWith('document:')).sort();
    expect(documentIds('Alpha')).toEqual(['document:Alpha rev 2']);
    expect(documentIds('Beta')).toEqual(['document:Master']);
  });
});

describe('what the phone asks is true before and after the migration', () => {
  const cloud = [master, alphaRollback];

  it('before: making Alpha current retires the master for Beta, and the owner is asked', async () => {
    expect(scheduleActivationEffects(alphaRollback, cloud, 'schedule')).toEqual([{ projectName: 'Beta', fallbackSchedule: null }]);
    const confirm = jest.fn(async () => false);
    const activate = activated(alphaRollback.id);
    await expect(activateSharedReferenceDocument({
      documentId: alphaRollback.id, documents: cloud, client: oldDatabase(), activate,
      listDocuments: async () => cloud, confirmRetiringProjects: confirm,
    })).resolves.toEqual({ status: 'cancelled' });
    expect(scheduleRetirementMessage([{ projectName: 'Beta', fallbackSchedule: null }])).toBe(
      'The schedule now current for Beta will be retired too. ' +
      'Beta is left with no current schedule and shows no schedule tasks until you set one.',
    );
    expect(activate).not.toHaveBeenCalled();
  });

  it('after: the master stays current for Beta, so nothing is asked and the cloud is called once', async () => {
    expect(scheduleActivationEffects(alphaRollback, cloud, 'project')).toEqual([]);
    const confirm = jest.fn(async () => true);
    const activate = activated(alphaRollback.id);
    const client = newDatabase();
    const listDocuments = jest.fn().mockResolvedValueOnce(cloud).mockResolvedValueOnce(afterQ15);
    await expect(activateSharedReferenceDocument({
      documentId: alphaRollback.id, documents: cloud, client, activate, listDocuments, confirmRetiringProjects: confirm,
    })).resolves.toEqual({ status: 'activated', documents: afterQ15 });
    expect(confirm).not.toHaveBeenCalled();
    expect(client.rpc).toHaveBeenCalledWith('ecos_schedule_retirement_scope');
    expect(activate).toHaveBeenCalledTimes(1);
  });

  it('after: a schedule sharing Alpha only by its project id is still retired, and the owner is still asked', () => {
    const kappa = schedule('Kappa', ['Kappa'], { isCurrent: true, projectId: 'proj-alpha' });
    expect(scheduleActivationEffects({ ...alphaRollback, projectId: 'proj-alpha' }, [...cloud, kappa], 'project'))
      .toEqual([{ projectName: 'Kappa', fallbackSchedule: null }]);
  });

  it('asks nothing and changes nothing when the cloud cannot say how it retires schedules', async () => {
    const confirm = jest.fn(async () => true);
    const activate = activated(alphaRollback.id);
    await expect(activateSharedReferenceDocument({
      documentId: alphaRollback.id, documents: cloud, activate, listDocuments: async () => cloud, confirmRetiringProjects: confirm,
      client: probeClient({ data: null, error: { code: '', message: 'TypeError: Network request failed' } }),
    })).resolves.toEqual({ status: 'failed', message: 'The shared schedules could not be read. Try again shortly.' });
    expect(confirm).not.toHaveBeenCalled();
    expect(activate).not.toHaveBeenCalled();
  });

  it('the no-imported-tasks warning counts only the tasks that are hidden in each state', () => {
    const alphaPdf = schedule('Alpha rev 5', ['Alpha'], { importedAt: '2026-09-20T00:00:00.000Z' });
    const masterItems = items.slice(0, 2);
    const before = scheduleTasksHiddenByActivation(alphaPdf, [master, alphaPdf], masterItems, 'schedule');
    const after = scheduleTasksHiddenByActivation(alphaPdf, [master, alphaPdf], masterItems, 'project');
    expect(before).toEqual({ count: 2, scheduleName: 'Master' });
    expect(after).toEqual({ count: 1, scheduleName: 'Master' });
    expect(scheduleTasksHiddenWarning('Alpha rev 5.pdf', after)?.message)
      .toBe('Alpha rev 5.pdf has no imported tasks. The 1 task from Master will be hidden on every device.');
    // The phone PDF not shared yet is worked out the same way.
    const phonePdf = { id: 'phone-pdf', name: 'Alpha rev 5.pdf', referenceDocumentId: null, importedAt: alphaPdf.importedAt };
    expect(scheduleTasksHiddenByActivation(phoneScheduleActivationTarget(phonePdf, 'Alpha', [master]), [master], masterItems, 'project'))
      .toEqual({ count: 1, scheduleName: 'Master' });
  });
});

describe('a schedule made current on the phone before it is shared follows the same rule', () => {
  const alphaOld = schedule('Alpha rev 1', ['Alpha'], { isCurrent: true });
  const gamma = schedule('Gamma', ['Gamma'], { isCurrent: true });
  const pdf = schedule('Alpha rev 5', ['Alpha'], { isCurrent: true, cloudUpdatedAt: null });

  it('after the migration the master stays current for Beta; another project\'s schedule is untouched', () => {
    const next = scheduleDocumentsAfterActivation(pdf, [master, alphaOld, gamma], 'project', 'T');
    expect(next.map(document => [document.id, document.isCurrent, document.retiredForProjectNames ?? null, document.updatedAt ?? null])).toEqual([
      ['Alpha rev 5', true, null, 'T'],
      ['Master', true, ['Alpha'], 'T'],
      ['Alpha rev 1', false, null, 'T'],
      ['Gamma', true, null, null],
    ]);
    expect(next[3]).toBe(gamma);
  });

  it('before the migration the master is retired as the old cloud does; another project\'s schedule is still untouched', () => {
    const next = scheduleDocumentsAfterActivation(pdf, [master, alphaOld, gamma], 'schedule', 'T');
    expect(next.map(document => [document.id, document.isCurrent])).toEqual([
      ['Alpha rev 5', true], ['Master', false], ['Alpha rev 1', false], ['Gamma', true],
    ]);
    expect(next[3]).toBe(gamma);
  });

  it('is what App.tsx does, compiled: only the changed schedules are marked and queued', async () => {
    const fs = jest.requireActual('fs') as typeof import('fs');
    const path = jest.requireActual('path') as typeof import('path');
    const ts = jest.requireActual('typescript') as typeof import('typescript');
    const source = fs.readFileSync(path.resolve(__dirname, '../../App.tsx'), 'utf8');
    const slice = (from: string, to: string) => {
      const start = source.indexOf(`\n  ${from}`) + 1;
      const end = source.indexOf(`\n  ${to}`, start);
      expect(start).toBeGreaterThan(0);
      expect(end).toBeGreaterThan(start);
      return source.slice(start, end);
    };
    const run = async (scope: 'project' | 'schedule' | null) => {
      const phoneDocument = {
        id: 'phone-pdf', projectId: 'alpha-key', name: 'Alpha rev 5.pdf', category: 'Schedule', mimeType: 'application/pdf',
        sizeBytes: 10, referenceDocumentId: null, importedAt: '2026-09-20T00:00:00.000Z',
      };
      const queued: ReferenceDocument[] = [];
      const deps: Record<string, unknown> = {
        projectDocuments: [phoneDocument], projects: ['Alpha'], authorityProjectId: () => 'alpha-key',
        referenceDocuments: [master, alphaOld, gamma], scheduleItems: [task('r-x', 'Alpha', pdf)],
        scheduleTasksHiddenWarning, scheduleTasksHiddenByActivation, phoneScheduleActivationTarget, scheduleDocumentsAfterActivation,
        // Audit A8 pass 2 #2: a PDF already imported is made current instead; this one never was.
        importedScheduleOfPhoneSchedule: () => null,
        loadECOSScheduleRetirementScope: jest.fn(async () => scope), getSupabaseClient: () => null,
        activateReferenceDocument: jest.fn(async () => true),
        ensureVerifiedProjectDocumentBytes: jest.fn(async (verified: object) => ({ ...verified, localUri: 'file:///verified.pdf' })),
        ensureReferenceDocumentsDirectory: jest.fn(async () => 'file:///docs/'),
        FileSystem: { copyAsync: jest.fn(async () => undefined) }, uid: () => 'new-ref', sanitizeFilename: (name: string) => name,
        parseOwnedLocalFileManifest: () => ({ files: {} }),
        normalizeReferenceDocument: (value: ReferenceDocument) => value,
        setProjectDocuments: jest.fn(), setDraft: jest.fn(), setSavedUpdates: jest.fn(),
        markReferenceDocumentsAuthorityReady: jest.fn(), setReferenceDocuments: jest.fn(),
        markCurrentProjectScheduleDocument: ({ documents }: { documents: unknown[] }) => documents,
        referenceDocumentsCurrentRef: { current: [] as ReferenceDocument[] },
        queueReferenceDocumentRecord: jest.fn(async (document: ReferenceDocument) => { queued.push(document); }),
        Alert: { alert: jest.fn() },
      };
      const body = `${slice('async function makeProjectScheduleDocumentCurrent(', 'async function reviewProjectScheduleDocumentImport(')}\n` +
        `${slice('async function reviewProjectScheduleDocumentImport(', 'function deleteProjectDocument(')}\n` +
        'module.exports = { makeProjectScheduleDocumentCurrent };';
      const js = ts.transpileModule(body, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
      }).outputText;
      const mod = { exports: {} as { makeProjectScheduleDocumentCurrent: (documentId: string) => Promise<void> } };
      new Function('module', 'exports', ...Object.keys(deps), js)(mod, mod.exports, ...Object.values(deps));
      await mod.exports.makeProjectScheduleDocumentCurrent('phone-pdf');
      return {
        queued: queued.map(document => [document.id, document.isCurrent, document.retiredForProjectNames ?? null]),
        current: (deps.referenceDocumentsCurrentRef as { current: ReferenceDocument[] }).current,
      };
    };
    const after = await run('project');
    expect(after.queued).toEqual([
      ['new-ref', true, null],
      ['Master', true, ['Alpha']],
      ['Alpha rev 1', false, null],
    ]);
    expect(after.current.find(document => document.id === 'Gamma')).toBe(gamma);
    // Before the migration, and offline (unknown), as the old cloud does it: the master is retired, Gamma is not.
    for (const scope of ['schedule', null] as const) {
      expect((await run(scope)).queued).toEqual([
        ['new-ref', true, null],
        ['Master', false, null],
        ['Alpha rev 1', false, null],
      ]);
    }
  });
});

describe('Set Active is offered again on a combined schedule retired for some of its projects', () => {
  it('App.tsx activateReferenceDocument, compiled, goes to the cloud for it and not for one current everywhere', async () => {
    const fs = jest.requireActual('fs') as typeof import('fs');
    const path = jest.requireActual('path') as typeof import('path');
    const ts = jest.requireActual('typescript') as typeof import('typescript');
    const app = fs.readFileSync(path.resolve(__dirname, '../../App.tsx'), 'utf8');
    const start = app.indexOf('\n  async function activateReferenceDocument(') + 1;
    const end = app.indexOf('\n  function markReferenceDocumentCurrent(', start);
    const run = async (phone: ReferenceDocument[]) => {
      const activate = activated('Master');
      const deps: Record<string, unknown> = {
        referenceDocumentsCurrentRef: { current: phone }, currentReferenceActivationIdsRef: { current: new Set<string>() },
        buildECOSDocumentReadiness: () => ({ canMakeCurrent: true, detail: '' }), canonicalReferenceCategory: () => 'schedule',
        activateSharedReferenceDocument: (input: Parameters<typeof activateSharedReferenceDocument>[0]) =>
          activateSharedReferenceDocument({ ...input, activate }),
        scheduleRetirementMessage, scheduleDocumentIsCurrentEverywhere, getSupabaseClient: newDatabase,
        listReferenceDocuments: async () => ({ ok: true, stubbed: false, data: phone }), normalizeReferenceDocuments: (rows: unknown) => rows,
        deletedDAVERecordIds: () => [], operationalSyncTombstonesRef: { current: [] },
        mergeDAVEReferenceDocumentRecoveryRecords: ({ cloud }: { cloud: ReferenceDocument[] }) => cloud,
        reconcileCurrentScheduleDocuments: (documents: ReferenceDocument[]) => documents,
        markReferenceDocumentsAuthorityReady: jest.fn(), setReferenceDocuments: jest.fn(),
        Alert: { alert: jest.fn() },
      };
      const js = ts.transpileModule(`module.exports = ${app.slice(start, end).trim()}`, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
      }).outputText;
      const mod = { exports: {} as unknown as (documentId: string) => Promise<boolean> };
      new Function('module', 'exports', ...Object.keys(deps), js)(mod, mod.exports, ...Object.values(deps));
      const result = await (mod.exports as unknown as (documentId: string) => Promise<boolean>)('Master');
      return { result, activate };
    };
    const retired = await run(afterQ15);
    expect(retired.result).toBe(true);
    expect(retired.activate).toHaveBeenCalledWith({ client: expect.anything(), documentId: 'Master', expectedUpdatedAt: 'later' });
    const everywhere = await run([master, alphaRollback]);
    expect(everywhere.result).toBe(true);
    expect(everywhere.activate).not.toHaveBeenCalled();
  });
});

describe('the web notice after Make Current is true in both states', () => {
  it('names the projects, and the combined schedule that stays current only when the cloud says it did', () => {
    const before = [master, alphaRollback];
    expect(scheduleActivationNotice(alphaRollback, before, 'project')).toBe(
      '“Alpha rev 2” is now the current schedule for Alpha. “Master” stays current for Beta. ' +
      'Earlier schedules remain available as history.',
    );
    expect(scheduleActivationNotice(alphaRollback, before, 'schedule')).toBe(
      '“Alpha rev 2” is now the current schedule for Alpha. Earlier schedules remain available as history.',
    );
    // Making the master current again says nothing about staying current.
    expect(scheduleActivationNotice(afterQ15[0], afterQ15, 'project')).toBe(
      '“Master” is now the current schedule for Alpha, Beta. Earlier schedules remain available as history.',
    );
  });
});

describe('the retirement list travels like the current flag', () => {
  it('survives normalization only when present, so other documents normalize as before', () => {
    expect(normalizeReferenceDocument(afterQ15[0]).retiredForProjectNames).toEqual(['Alpha']);
    expect('retiredForProjectNames' in normalizeReferenceDocument(master)).toBe(false);
    expect('retiredForProjectNames' in normalizeReferenceDocument({ ...master, retiredForProjectNames: [' '] })).toBe(false);
  });

  it('the cloud\'s list wins every merge, and a difference in it alone uploads nothing', () => {
    const localNewer = { ...master, updatedAt: '2026-09-30T13:00:00.000Z', notes: 'edited here' };
    const cloudRetired = { ...afterQ15[0], updatedAt: '2026-09-30T12:00:00.000Z' };
    const [merged] = mergeDAVEReferenceDocumentRecoveryRecords({ local: [localNewer], cloud: [cloudRetired] });
    expect(merged).toMatchObject({ notes: 'edited here', retiredForProjectNames: ['Alpha'] });
    const [cleared] = mergeDAVEReferenceDocumentRecoveryRecords({
      local: [{ ...cloudRetired, updatedAt: '2026-09-30T13:00:00.000Z' }], cloud: [{ ...master, updatedAt: '2026-09-30T12:00:00.000Z' }],
    });
    expect('retiredForProjectNames' in cleared).toBe(false);
    const stored = { storagePath: 'owner/master.pdf' };
    expect(daveReferenceDocumentsNeedingCloudUpload({
      local: [{ ...master, ...stored }], cloud: [{ ...afterQ15[0], ...stored }],
    })).toEqual([]);
    // A change the owner made still uploads.
    expect(daveReferenceDocumentsNeedingCloudUpload({
      local: [{ ...master, ...stored, notes: 'edited', updatedAt: '2026-09-30T13:00:00.000Z' }], cloud: [{ ...afterQ15[0], ...stored }],
    })).toHaveLength(1);
  });
});

describe('realtime re-reads when only the retirement list changes', () => {
  const ACTIVATED_AT = '2026-09-30T12:00:00.000Z';
  const documentRow = (document: ReferenceDocument) => ({
    eventType: 'UPDATE' as const, oldRow: null, raw: null,
    newRow: { id: document.id, updated_at: ACTIVATED_AT, document_data: document },
  });
  function harness(documents: ReferenceDocument[]) {
    const state = {
      projects: [], projectRecords: [], archivedProjects: [], deletedProjectNames: [],
      updates: [], deletedUpdates: [], tombstones: [] as unknown[], areas: [], scheduleItems: [], documents,
    };
    const commitDocuments = jest.fn((next: ReferenceDocument[]) => { state.documents = next; });
    const apply = createDAVEOperationalRealtimeApplier({
      isActive: () => true, snapshot: () => ({ ...state }), getPendingQueue: async () => [],
      normalizeUpdate: (value: unknown) => value, normalizeAreas: (value: unknown[]) => value,
      normalizeSchedule: (value: unknown[]) => value, normalizeDocuments: (value: unknown[]) => value,
      migrateSchedule: (value: unknown) => value, localPhotoUri: () => '', mergeProjectNames,
      updateHasPendingLocalWork: () => false, mergeUpdates: ({ localUpdates }: { localUpdates: unknown[] }) => localUpdates,
      buildUpdateTombstone: jest.fn(), buildCloudDeletionBarrier: jest.fn(),
      upsertDeletedUpdate: (current: unknown[], next: unknown) => [...current, next],
      commitProjects: jest.fn(), commitDeletedProjects: jest.fn(), commitUpdates: jest.fn(), commitDeletedUpdates: jest.fn(),
      commitTombstones: jest.fn(), commitAreas: jest.fn(), commitSchedule: jest.fn(), commitDocuments,
    } as never);
    return { state, apply, commitDocuments };
  }

  it.each([
    ['recorded', master, afterQ15[0]],
    ['cleared', afterQ15[0], master],
  ])('a combined schedule whose list was %s asks for a re-read though its flag did not change', async (_change, local, cloud) => {
    const { apply, commitDocuments } = harness([local, alphaRollback]);
    await expect(apply('reference_document', documentRow(cloud) as never)).resolves.toBe(false);
    expect(commitDocuments).not.toHaveBeenCalled();
  });

  it('an echo with the same list still merges in place', async () => {
    const { apply, commitDocuments } = harness([afterQ15[0], afterQ15[1]]);
    await expect(apply('reference_document', documentRow({ ...afterQ15[0], notes: 'echo' }) as never)).resolves.toBe(true);
    expect(commitDocuments).toHaveBeenCalledTimes(1);
  });
});
