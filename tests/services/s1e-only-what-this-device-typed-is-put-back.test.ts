/**
 * S1e (14 Oct 2026; the final review's F2, Low, caused by 36e2117f, S1d). While Make Current works on the iPhone, the
 * iPad types a note on the same card in two goes; the iPhone has received the first words, not the second, when its
 * press ends. S1d took any card whose words changed on the iPhone during the press as typed there, so the iPhone (which
 * typed nothing) put back the iPad's OLDER words, stamped newest, and sent them: the later words were lost everywhere,
 * no message (case F).
 * Now only what THIS device typed during the press is put back (its card text sync records each edit it makes itself,
 * field by field); a value merely received from another device never is, and a card this device did not type on is
 * left exactly as the cloud has it. The reviewer's other S1d shapes are kept: E1 / E2 two devices pressing at once, H
 * typed on the old master's card, G a card nobody typed on. S1d's own shapes are in
 * s1d-note-typed-while-make-current-is-on-its-way.test.ts.
 * The rig is the reviewer's (notes/p6-b232/hrvF-s1d.test.ts), with this phone's own typing recorded as the app records
 * it. Synthetic data.
 */
const mockStorageValues = new Map<string, string>();
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn((key: string) => Promise.resolve(mockStorageValues.get(key) ?? null)),
  setItem: jest.fn((key: string, value: string) => { mockStorageValues.set(key, value); return Promise.resolve(); }),
  removeItem: jest.fn((key: string) => { mockStorageValues.delete(key); return Promise.resolve(); }),
  getAllKeys: jest.fn(() => Promise.resolve([...mockStorageValues.keys()])),
}));

const ok = <T>(data: T) => Promise.resolve({ ok: true, configured: true, stubbed: false, data });
const mockCloud = new Map<string, Record<string, unknown>>();
let mockListOverride: (() => Record<string, unknown>[]) | null = null;
const mockUpsertReferenceDocument = jest.fn(async (document: Record<string, unknown>) => {
  const { cloudUpdatedAt: _c, ...documentData } = document;
  mockCloud.set(String(document.id), { ...documentData, cloudUpdatedAt: '2026-10-14T12:00:09.000Z' });
  return { ok: true, configured: true, stubbed: false, data: document };
});
jest.mock('../../services/SupabaseService', () => ({
  listProjects: () => ok([{ id: '11111111-1111-4111-8111-111111111111', name: 'Alpha' }]),
  listArchivedProjects: () => ok([]),
  listReferenceDocuments: () => ok(mockListOverride ? mockListOverride() : [...mockCloud.values()].map(row => ({ ...row }))),
  upsertReferenceDocument: (document: Record<string, unknown>) => mockUpsertReferenceDocument(document),
  listDAVESyncTombstones: () => ok([]),
  upsertDAVESyncTombstone: () => ok(null),
  upsertDAVESyncTombstones: (tombstones: unknown[]) => ok(tombstones),
  listDAVEStorageCleanupIntents: () => ok([]),
  removeProtectedStorageObject: () => ok(null),
  recordDAVEStorageCleanupAttempt: () => ok(null),
  getSupabaseConfigurationStatus: () => ({ configured: true, message: 'Configured.' }),
}));

import { getOfflineQueue, queueReferenceDocumentRecord, requeueReferenceDocumentEditsOutlivingActivation, uploadPendingChanges } from '../../services/SyncService';
import { mergeDAVEReferenceDocumentRecoveryRecords } from '../../services/DAVECloudRecovery';
import { reconcileCurrentScheduleDocuments, scheduleDocumentIsCurrentEverywhere } from '../../services/PIEScheduleReconciliation';
import { activateSharedReferenceDocument, withDetailsTypedDuringActivation } from '../../services/SharedDocumentActivation';
import type { ReferenceDocument } from '../../types';

const fs = jest.requireActual('fs') as typeof import('fs');
const path = jest.requireActual('path') as typeof import('path');
const ts = jest.requireActual('typescript') as typeof import('typescript');
const app = fs.readFileSync(path.resolve(__dirname, '../../App.tsx'), 'utf8');
const said: string[] = [];
const say = (line: string) => { said.push(line); };

const UPLOADED_AT = '2026-10-14T11:59:00.000Z'; // the shared copy reached the cloud (this device has not heard back)
const TYPED_AT = '2026-10-14T12:00:00.000Z';
const ACTIVATED_AT = '2026-10-14 12:00:01.234567+00';
const ACTIVATED_ROW_AT = '2026-10-14T12:00:01.234567+00:00';

const sched = (id: string, notes: string, extra: Partial<ReferenceDocument> = {}): ReferenceDocument => ({
  id, name: id, originalFileName: `${id}.pdf`, uri: '', storagePath: `project-documents/alpha/${id}.pdf`, category: 'Schedules', notes,
  isCurrent: false, importedAt: '2026-10-14T11:58:00.000Z', projectId: null, projectName: 'Alpha', projectNames: ['Alpha'],
  updatedAt: UPLOADED_AT, cloudUpdatedAt: UPLOADED_AT, ...extra,
}) as ReferenceDocument;
const MASTER = () => sched('alpha-master', '', { isCurrent: true, importedAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z', cloudUpdatedAt: '2026-09-01T00:00:00.000Z', importBatchId: 'batch-master' } as Partial<ReferenceDocument>);

function cloudBefore() {
  for (const doc of [MASTER(), sched('rev6', 'Rev 6 from the GC'), sched('rev7', 'Rev 7 for review')]) {
    const { cloudUpdatedAt, ...data } = doc;
    mockCloud.set(doc.id, { ...data, cloudUpdatedAt });
  }
}
function activateInCloud(id: string) {
  const row = mockCloud.get(id)!;
  mockCloud.set(id, { ...row, isCurrent: true, updatedAt: ACTIVATED_AT, cloudUpdatedAt: ACTIVATED_ROW_AT });
  const master = mockCloud.get('alpha-master')!;
  mockCloud.set('alpha-master', { ...master, isCurrent: false, updatedAt: ACTIVATED_AT, cloudUpdatedAt: ACTIVATED_ROW_AT });
}

function otherDeviceActivatesRev7(stamp: string) {
  // hrvF: the iPad presses Make Current on rev7 (same project) at about the same moment: the cloud's activation.
  const at = stamp.replace('T', ' ').replace('Z', '+00');
  for (const id of ['rev6', 'rev7', 'alpha-master']) {
    const row = mockCloud.get(id)!;
    mockCloud.set(id, { ...row, isCurrent: id === 'rev7', updatedAt: at, cloudUpdatedAt: stamp });
  }
}
function componentFunction(name: string): string {
  const match = new RegExp(`\\n  (?:async )?function ${name}\\(`).exec(app);
  if (!match) throw new Error(`App.tsx has no component function ${name}`);
  const open = app.indexOf(' {\n', match.index) + 1;
  let depth = 0;
  for (let index = open; index < app.length; index += 1) {
    if (app[index] === '{') depth += 1;
    if (app[index] === '}') { depth -= 1; if (depth === 0) return app.slice(match.index + 3, index + 1); }
  }
  throw new Error('unbalanced function');
}

/** S1e: what this phone typed itself, field by field and when, as its card text sync records it (noteOwnEdit). */
const ownEdits = new Map<string, Map<string, { value: unknown; at: number }>>();
const typedHere = (id: string, fields: Record<string, unknown>) => {
  const kept = ownEdits.get(id) ?? new Map<string, { value: unknown; at: number }>();
  Object.entries(fields).forEach(([name, value]) => kept.set(name, { value, at: Date.now() }));
  ownEdits.set(id, kept);
};
const ownEditsSince = (time: number) => new Map([...ownEdits].flatMap(([id, fields]) => {
  const since = Object.fromEntries([...fields].filter(([, edit]) => edit.at >= time).map(([name, edit]) => [name, edit.value]));
  return Object.keys(since).length > 0 ? [[id, since] as const] : [];
}));
beforeEach(() => { mockStorageValues.clear(); mockCloud.clear(); mockUpsertReferenceDocument.mockClear(); mockListOverride = null; ownEdits.clear(); });

const TYPED_DURING_AT = '2026-10-14T12:00:01.000Z'; // typed after the press read the cloud, before the activation ran
const duringNote = 'Rev 6 - Lot 4 pour moved to Thursday';
async function press(label: string, local: ReferenceDocument[], opts: { staleUploadPass?: boolean; passInsideActivation?: boolean; typeDuring?: 'queued' | 'pending'; typeOnMaster?: boolean; otherDevice?: 'inside' | 'after-list'; ipadTwice?: boolean } = {}) {
  cloudBefore();
  const alerts: string[] = [];
  const referenceDocumentsCurrentRef = { current: local };
  const cloudList = () => [...mockCloud.values()].map(row => ({ ...row })) as unknown as ReferenceDocument[];
  let expected = '';
  const deps: Record<string, unknown> = {
    referenceDocumentsCurrentRef, currentReferenceActivationIdsRef: { current: new Set<string>() },
    scheduleDocumentIsCurrentEverywhere,
    buildECOSDocumentReadiness: () => ({ canMakeCurrent: true, detail: '' }), canonicalReferenceCategory: () => 'schedule',
    projectDocumentSharedRecordSync: {
      flush: (id: string) => {
        void queueReferenceDocumentRecord(referenceDocumentsCurrentRef.current.find(document => document.id === id)!, false);
        return true;
      },
      // S1d: the card's text sync queues the shared copy as this list holds it, as App.tsx's own does (its onReady).
      queueNow: (id: string) => { void queueReferenceDocumentRecord(referenceDocumentsCurrentRef.current.find(document => document.id === id)!, false); },
      // S1e: the details this phone typed itself since a time (the card text sync's record of its own edits).
      ownEditsSince,
    },
    activateSharedReferenceDocument: (args: Parameters<typeof activateSharedReferenceDocument>[0]) => activateSharedReferenceDocument({
      ...args,
      loadRetirementScope: async () => 'project',
      activate: async ({ documentId, expectedUpdatedAt }) => {
        expected = expectedUpdatedAt;
        await new Promise(resolve => setTimeout(resolve, 5));
        const preList = cloudList() as unknown as Record<string, unknown>[];
        if (opts.typeDuring) {
          // hrv6s: he types on the card while the press is on its way (the card stays editable): the card's edit
          // writes the shared copy in this list (updateProjectDocument), and its upload is queued once typing pauses.
          const typed = { ...referenceDocumentsCurrentRef.current.find(document => document.id === 'rev6')!, notes: duringNote, updatedAt: TYPED_DURING_AT };
          referenceDocumentsCurrentRef.current = referenceDocumentsCurrentRef.current.map(document => (document.id === 'rev6' ? typed : document));
          typedHere('rev6', { notes: duringNote }); // typed on THIS phone's card
          if (opts.typeDuring === 'queued') await queueReferenceDocumentRecord(typed, false);
        }
        if (opts.typeOnMaster) {
          referenceDocumentsCurrentRef.current = referenceDocumentsCurrentRef.current.map(document => (document.id === 'alpha-master' ? { ...document, notes: 'Old master: keep for the claim', updatedAt: TYPED_DURING_AT } : document));
          typedHere('alpha-master', { notes: 'Old master: keep for the claim' }); // typed on THIS phone's card
        }
        if (opts.ipadTwice) {
          // hrvF: the iPad edits rev6's note twice while the press is on its way; the phone hears the first by its live
          // feed (as the realtime merge leaves it: the iPad's note and stamp), not yet the second.
          const n2At = '2026-10-14T12:00:00.500Z'; const n3At = '2026-10-14T12:00:00.800Z';
          mockCloud.set('rev6', { ...mockCloud.get('rev6')!, notes: 'iPad: pour moved', updatedAt: n2At, cloudUpdatedAt: n2At });
          referenceDocumentsCurrentRef.current = referenceDocumentsCurrentRef.current.map(document => (document.id === 'rev6' ? { ...document, notes: 'iPad: pour moved', updatedAt: n2At, cloudUpdatedAt: n2At } : document));
          mockCloud.set('rev6', { ...mockCloud.get('rev6')!, notes: 'iPad: pour moved to Friday, crane booked', updatedAt: n3At, cloudUpdatedAt: n3At });
        }
        activateInCloud(documentId);
        if (opts.otherDevice === 'inside') otherDeviceActivatesRev7('2026-10-14T12:00:01.500Z');
        if (opts.passInsideActivation) { mockListOverride = () => preList; const r = await uploadPendingChanges(); mockListOverride = null; say(`${label}: the pass that read the list before the activation wrote after it: ${JSON.stringify(r.itemOutcomes)}; cloud rev6 current ${mockCloud.get('rev6')?.isCurrent}, notes "${mockCloud.get('rev6')?.notes}"`); }
        return { status: 'activated', documentId, updatedAt: ACTIVATED_ROW_AT, changedCount: 2, message: null } as never;
      },
    }),
    getSupabaseClient: () => ({}), listReferenceDocuments: async () => ({ ok: true, data: cloudList() }),
    normalizeReferenceDocuments: (rows: unknown) => rows, scheduleRetirementMessage: () => '',
    Alert: { alert: (title: string, message?: string) => alerts.push(`${title} | ${message || ''}`) },
    deletedDAVERecordIds: () => [], operationalSyncTombstonesRef: { current: [] },
    requeueReferenceDocumentEditsOutlivingActivation, mergeDAVEReferenceDocumentRecoveryRecords, reconcileCurrentScheduleDocuments,
    scheduleProgressCarriedOnActivation: () => [], scheduleItemsCurrentRef: { current: [] },
    markReferenceDocumentsAuthorityReady: () => undefined, setReferenceDocuments: () => undefined,
    // S1d: what is typed during the press is put back on the shared copy and sent.
    withDetailsTypedDuringActivation,
  };
  const js = ts.transpileModule(`${componentFunction('activateReferenceDocument')}\nmodule.exports = activateReferenceDocument;`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const mod = { exports: {} as unknown as (id: string) => Promise<boolean> };
  new Function('module', 'exports', ...Object.keys(deps), js)(mod, mod.exports, ...Object.values(deps));

  const preActivationList = cloudList();
  const result = await mod.exports('rev6');
  if (opts.otherDevice === 'after-list') otherDeviceActivatesRev7('2026-10-14T12:00:05.000Z');
  const phone = referenceDocumentsCurrentRef.current.find(document => document.id === 'rev6');
  say(`${label}: press resolved ${result}; activation asked with revision "${expected}"; alerts ${JSON.stringify(alerts)}`);
  say(`${label}: THIS PHONE'S LIST after the press: rev6 notes "${phone?.notes}", current ${phone?.isCurrent}`);
  const queued = await getOfflineQueue();
  say(`${label}: queue after the press: ${JSON.stringify(queued.map(item => ({ id: item.id, notes: (item.payload as { documentData?: ReferenceDocument }).documentData?.notes, isCurrent: (item.payload as { documentData?: ReferenceDocument }).documentData?.isCurrent, updatedAt: (item.payload as { documentData?: ReferenceDocument }).documentData?.updatedAt })))}`);
  // hrv6s: the pause in typing comes after the press: the hook queues the shared copy as this list now holds it.
  if (opts.typeOnMaster) await queueReferenceDocumentRecord(referenceDocumentsCurrentRef.current.find(document => document.id === 'alpha-master')!, false);
  if (opts.typeDuring === 'pending') await queueReferenceDocumentRecord(referenceDocumentsCurrentRef.current.find(document => document.id === 'rev6')!, false);
  if (opts.staleUploadPass) mockListOverride = () => preActivationList as unknown as Record<string, unknown>[];
  const uploadResult = await uploadPendingChanges();
  mockListOverride = null;
  say(`${label}: upload result ${JSON.stringify(uploadResult).slice(0, 600)}; queue left ${JSON.stringify((await getOfflineQueue()).map(item => [item.id, item.lastError]))}`);
  const cloud = mockCloud.get('rev6');
  const master = mockCloud.get('alpha-master');
  say(`${label}: THE CLOUD after the upload (what the iPad and the desktop get): rev6 notes "${cloud?.notes}", rev6 current ${cloud?.isCurrent}; master current ${master?.isCurrent}; upserts ${mockUpsertReferenceDocument.mock.calls.length}`);
  return { result, phone, cloud, master, alerts, upserts: mockUpsertReferenceDocument.mock.calls.length };
}


const ROW = (id: string) => mockCloud.get(id) as Record<string, unknown> | undefined;
describe('S1e: only what this device typed during the press is put back', () => {
  it('F: nothing typed on the phone; the iPad edits rev6 twice during the press (the phone heard the first only): the newer words stay everywhere', async () => {
    const t = await press('F', [MASTER(), sched('rev6', 'Rev 6 from the GC'), sched('rev7', 'Rev 7 for review')], { ipadTwice: true });
    expect([ROW('rev6')?.notes, ROW('rev6')?.isCurrent, t.upserts]).toEqual(['iPad: pour moved to Friday, crane booked', true, 0]);
  });
  it('E1: the iPad makes rev7 current just after the phone\'s press read the cloud\'s answer: the phone\'s note reaches the cloud, rev7 stays current', async () => {
    await press('E1', [MASTER(), sched('rev6', 'Rev 6 from the GC'), sched('rev7', 'Rev 7 for review')], { typeDuring: 'pending', otherDevice: 'after-list' });
    expect([ROW('rev6')?.notes, ROW('rev6')?.isCurrent, ROW('rev7')?.isCurrent, ROW('alpha-master')?.isCurrent]).toEqual([duringNote, false, true, false]);
  });
  it('E2: the iPad makes rev7 current while the phone\'s press is on its way: the same', async () => {
    await press('E2', [MASTER(), sched('rev6', 'Rev 6 from the GC'), sched('rev7', 'Rev 7 for review')], { typeDuring: 'pending', otherDevice: 'inside' });
    expect([ROW('rev6')?.notes, ROW('rev6')?.isCurrent, ROW('rev7')?.isCurrent, ROW('alpha-master')?.isCurrent]).toEqual([duringNote, false, true, false]);
  });
  it('H: typed on the OLD master\'s card during the press: the note goes up, the master stays retired', async () => {
    await press('H', [MASTER(), sched('rev6', 'Rev 6 from the GC'), sched('rev7', 'Rev 7 for review')], { typeOnMaster: true });
    expect([ROW('alpha-master')?.notes, ROW('alpha-master')?.isCurrent, ROW('rev6')?.isCurrent, ROW('rev6')?.notes, ROW('rev7')?.notes]).toEqual(['Old master: keep for the claim', false, true, 'Rev 6 from the GC', 'Rev 7 for review']);
  });
  it('G: a card nobody typed on is untouched (rev7: no upload, its note and stamp as the cloud had them)', async () => {
    await press('G', [MASTER(), sched('rev6', 'Rev 6 from the GC'), sched('rev7', 'Rev 7 for review')], { typeDuring: 'pending' });
    expect(mockUpsertReferenceDocument.mock.calls.map(call => (call[0] as { id: string }).id)).not.toContain('rev7');
    expect([ROW('rev7')?.notes, ROW('rev7')?.cloudUpdatedAt]).toEqual(['Rev 7 for review', UPLOADED_AT]);
  });
});
