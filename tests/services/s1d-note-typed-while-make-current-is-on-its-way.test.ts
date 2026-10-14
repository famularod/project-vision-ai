/**
 * S1d (14 Oct 2026; review pass 6's H6S-2, Low). On the iPhone or iPad, a schedule PDF card already shared: he presses
 * Make Current Schedule and, while it is still on its way (after it has read the cloud, before the cloud answers),
 * types a note on the card and stops. The schedule became current everywhere, his card showed the note, but the
 * phone's shared copy went back to the old note and the iPad and the computer never got it; no message.
 *   D1 (caused by 381f8b2f, 3.1): no cloud stamp here, the note's upload queued before the press ended.
 *   D2 (the same road): no stamp here, the pause that queues the note comes after the press.
 *   D4 (older, the same on 4cc31af5): the stamp held here, the pause after the press.
 *   D3 (control, kept already): the stamp held here, queued before the press ended.
 * Now: what was typed on a card while the press was on its way is put back on the shared copy the press leaves on
 * this device, stamped after the activation, and sent; the note reaches every device after the press in all four.
 * The rig is the reviewer's (notes/p6-b232/hrv6s-typed6.test.ts, from S1c's and A8 pass 3's): the real SyncService
 * queue and upload, the real activateSharedReferenceDocument (only its activation call and the retirement scope
 * given), App.tsx's activateReferenceDocument compiled, the typing put inside the activation call. Synthetic data.
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
  for (const doc of [MASTER(), sched('rev6', 'Rev 6 from the GC')]) {
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

/** S1e (14 Oct, the final review's F2): what this phone typed itself, as its card text sync records it (noteOwnEdit). */
const ownEdits = new Map<string, Record<string, unknown>>();
beforeEach(() => { mockStorageValues.clear(); mockCloud.clear(); mockUpsertReferenceDocument.mockClear(); mockListOverride = null; ownEdits.clear(); });

const TYPED_DURING_AT = '2026-10-14T12:00:01.000Z'; // typed after the press read the cloud, before the activation ran
const duringNote = 'Rev 6 - Lot 4 pour moved to Thursday';
async function press(label: string, local: ReferenceDocument[], opts: { staleUploadPass?: boolean; passInsideActivation?: boolean; typeDuring?: 'queued' | 'pending' } = {}) {
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
      // S1e: the details this phone typed itself during the press (all typing here is inside it).
      ownEditsSince: () => new Map(ownEdits),
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
          ownEdits.set('rev6', { notes: duringNote }); // S1e: typed on THIS phone's card, recorded as the card's edit is
          if (opts.typeDuring === 'queued') await queueReferenceDocumentRecord(typed, false);
        }
        activateInCloud(documentId);
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
  const phone = referenceDocumentsCurrentRef.current.find(document => document.id === 'rev6');
  say(`${label}: press resolved ${result}; activation asked with revision "${expected}"; alerts ${JSON.stringify(alerts)}`);
  say(`${label}: THIS PHONE'S LIST after the press: rev6 notes "${phone?.notes}", current ${phone?.isCurrent}`);
  const queued = await getOfflineQueue();
  say(`${label}: queue after the press: ${JSON.stringify(queued.map(item => ({ id: item.id, notes: (item.payload as { documentData?: ReferenceDocument }).documentData?.notes, isCurrent: (item.payload as { documentData?: ReferenceDocument }).documentData?.isCurrent, updatedAt: (item.payload as { documentData?: ReferenceDocument }).documentData?.updatedAt })))}`);
  // hrv6s: the pause in typing comes after the press: the hook queues the shared copy as this list now holds it.
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

describe('S1d: a note typed on the card while Make Current is on its way reaches every device', () => {
  const everywhere = async (label: string, local: ReferenceDocument[], typeDuring: 'queued' | 'pending') => {
    const t = await press(label, local, { typeDuring });
    expect([t.result, t.alerts]).toEqual([true, []]);
    // The schedule is current everywhere, and the note typed meanwhile is on the phone's copy and in the cloud.
    expect([t.phone?.notes, t.phone?.isCurrent]).toEqual([duringNote, true]);
    expect([t.cloud?.notes, t.cloud?.isCurrent, t.master?.isCurrent]).toEqual([duringNote, true, false]);
  };
  it('D1 (caused): no stamp here; its upload queued before the press ended', async () => {
    await everywhere('D1', [MASTER(), sched('rev6', 'Rev 6 from the GC', { cloudUpdatedAt: null })], 'queued');
  });
  it('D2 (caused): no stamp here; the pause that queues it after the press', async () => {
    await everywhere('D2', [MASTER(), sched('rev6', 'Rev 6 from the GC', { cloudUpdatedAt: null })], 'pending');
  });
  it('D4 (older): the stamp held here; the pause after the press', async () => {
    await everywhere('D4', [MASTER(), sched('rev6', 'Rev 6 from the GC')], 'pending');
  });
  it('D3 (control, kept before): the stamp held here; queued before the press ended', async () => {
    await everywhere('D3', [MASTER(), sched('rev6', 'Rev 6 from the GC')], 'queued');
  });
  it('control: nothing typed during the press: made current, the note unchanged, nothing extra sent', async () => {
    const t = await press('N0', [MASTER(), sched('rev6', 'Rev 6 from the GC')]);
    expect([t.result, t.phone?.notes, t.cloud?.notes, t.cloud?.isCurrent, t.master?.isCurrent, t.upserts]).toEqual([true, 'Rev 6 from the GC', 'Rev 6 from the GC', true, false, 0]);
  });
});
