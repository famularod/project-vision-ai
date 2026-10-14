/**
 * High item 3 (open item 7.16; the owner's instruction of 13 Oct 2026, the three high items). Review pass 3
 * (reports), P3-3: which drawing a report cites is decided by the PAGE INDEX read out of the drawing's file, and the
 * devices did not hold the same one. The phone held it only in the app session that read the file (it saved and
 * downloaded its documents without it), the iPad never had it, and the cloud's row of a drawing stored in the app's
 * own cloud kept it, so the desktop cited the drawing and the phone, once the app had been closed, did not: the
 * piece of the drawing was gone from the phone's report, and neither device knew the report the other had sent.
 *
 * The coordinator's decision: every device holds the same page index for a drawing, and keeps it. The phone and the
 * iPad keep the part of the index a citation is read from with the document, read it back at launch, take it from
 * the cloud's row when they download the document, and send it with the row when they upload it. Nothing else of the
 * report or its fingerprint changes.
 *
 * Each device by its own code: the phone's save, launch, download (SupabaseService.listReferenceDocuments through the
 * document list function) and merge, its upload (SupabaseService.upsertReferenceDocument after the queue's merge),
 * the one report recipe and citation function; the desktop's own loader over the cloud's row and its own recipe and
 * words. Made-up project and drawing.
 */
import type * as RSTypes from '../../services/DAVEReportSnapshot';
import type { ReferenceDocument, ScheduleItem } from '../../types';

/** The cloud: one row per document, as the phone writes it and as the document list function gives it back. */
const mockCloud: {
  rows: Map<string, { id: string; name: string; category: string; document_data: Record<string, unknown>; updated_at: string }>;
  /** What the document list function returns of a row's document_data (its code is in no migration: both ways). */
  listGives: 'the row whole' | 'the row without its page index' | 'the live list';
  clock: number;
} = { rows: new Map(), listGives: 'the row whole', clock: Date.parse('2026-09-21T15:01:00.000Z') };
function mockStore(payload: Record<string, any>, id: string) {
  mockCloud.clock += 60_000;
  mockCloud.rows.set(id, {
    id, name: payload.name, category: payload.category,
    document_data: JSON.parse(JSON.stringify(payload.document_data)), updated_at: new Date(mockCloud.clock).toISOString(),
  });
}
function mockListed() {
  return [...mockCloud.rows.values()].map(row => {
    const data = JSON.parse(JSON.stringify(row.document_data));
    // The live list (document_data - 'extractedPages'), for a drawing whose row has no citation key: as every row sent
    // before option (b2) (high item 3d) was.
    if (mockCloud.listGives === 'the row without its page index') { delete data.extractedPages; delete data.citationPageIndex; }
    // The live list over rows as this build writes them: the citation key is carried (option (b2)).
    if (mockCloud.listGives === 'the live list') delete data.extractedPages;
    return { ...row, document_data: data };
  });
}
function mockReferenceDocumentsQuery() {
  const query: Record<string, any> = {};
  let pending: { values: Record<string, any> } | null = null;
  const ids: string[] = [];
  query.upsert = jest.fn(async (payload: Record<string, any>) => { mockStore(payload, payload.id); return { error: null, status: 201 }; });
  query.update = jest.fn((values: Record<string, any>) => { pending = { values }; return query; });
  query.eq = jest.fn((column: string, value: string) => { if (column === 'id') ids.push(value); return query; });
  query.select = jest.fn(async () => {
    if (pending && ids[0]) mockStore(pending.values, ids[0]);
    return { data: ids.map(id => ({ id })), error: null, status: 200 };
  });
  return query;
}
const mockSupabaseClient = {
  auth: {
    getSession: jest.fn(async () => ({ data: { session: { access_token: 'session-token', user: { id: 'owner-1' } } }, error: null })),
    getUser: jest.fn(async () => ({ data: { user: { id: 'owner-1' } }, error: null })),
    onAuthStateChange: jest.fn(), startAutoRefresh: jest.fn(), stopAutoRefresh: jest.fn(),
  },
  from: jest.fn((table: string) => {
    if (table !== 'reference_documents') throw new Error(`Unexpected table ${table}`);
    return mockReferenceDocumentsQuery();
  }),
  rpc: jest.fn(async (name: string) => (name === 'dave_list_reference_document_metadata'
    ? { data: mockListed(), error: null, status: 200 }
    : { data: [], error: null, status: 200 })),
};
jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn(() => mockSupabaseClient) }));
jest.mock('react-native-url-polyfill/auto', () => ({}));
jest.mock('expo-file-system/legacy', () => ({ documentDirectory: null, getInfoAsync: jest.fn(), readAsStringAsync: jest.fn(), EncodingType: { Base64: 'base64' } }));
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: jest.fn(async () => null), setItem: jest.fn(async () => undefined), removeItem: jest.fn(async () => undefined), getAllKeys: jest.fn(async () => []), multiGet: jest.fn(async () => []) },
}));
jest.mock('../../services/SupabaseAuthStorage', () => ({
  isAuthStorageSecure: jest.fn(async () => true),
  supabaseSecureAuthStorage: { getItem: jest.fn(async () => null), setItem: jest.fn(async () => undefined), removeItem: jest.fn(async () => undefined) },
}));
/** The desktop reads the cloud's rows through the same document list function. */
jest.mock('../../services/DAVEWebSupabaseClient', () => ({ daveWebSupabaseGateway: { loadAuthorizedRows: async () => mockDesktopRows() } }));

// The phone's cloud client reads its settings when its module loads: before any of the app's modules.
process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
/* eslint-disable @typescript-eslint/no-var-requires */
const RI: typeof import('../../services/DAVEReportIntelligence') = require('../../services/DAVEReportIntelligence');
const RS: typeof import('../../services/DAVEReportSnapshot') = require('../../services/DAVEReportSnapshot');
const { compactECOSDocumentIndexForCloud, compactECOSReferenceDocumentsForOperationalRead }: typeof import('../../services/ECOSDocumentIndexPersistence') = require('../../services/ECOSDocumentIndexPersistence');
/** ReportsScreen's own call (absent on the base: the documents are then handed as they are). */
const withoutKeptPageIndexes: (documents: ReferenceDocument[]) => ReferenceDocument[] =
  require('../../services/ECOSDocumentIndexPersistence').withoutKeptPageIndexes ?? ((documents: ReferenceDocument[]) => documents);
const { normalizeScheduleImport }: typeof import('../../services/PIEScheduleIntelligence') = require('../../services/PIEScheduleIntelligence');
const { selectAuthoritativeScheduleItems }: typeof import('../../services/PIEScheduleReconciliation') = require('../../services/PIEScheduleReconciliation');
const { buildAutomaticReportDrawingReferences }: typeof import('../../services/ReportDrawingReferences') = require('../../services/ReportDrawingReferences');
const { normalizeProjectControls }: typeof import('../../services/VitruviusProjectControls') = require('../../services/VitruviusProjectControls');
const { buildDAVEReportProjectTruths }: typeof import('../../services/DAVEReportProjectTruths') = require('../../services/DAVEReportProjectTruths');
const { mergeDAVEReferenceDocumentRecoveryRecords }: typeof import('../../services/DAVECloudRecovery') = require('../../services/DAVECloudRecovery');
const WebOps = require('../../services/DAVEWebOperations');
const WebPeriod = require('../../services/DAVEWebReportPeriod');
const { loadDAVEWebReadOnlySnapshot }: typeof import('../../services/DAVEWebReadOnlyRepository') = require('../../services/DAVEWebReadOnlyRepository');
const { normalizeReferenceDocument, normalizeReferenceDocuments } = require('../../services/ReferenceDocumentRepository');
const SupabaseService: typeof import('../../services/SupabaseService') = require('../../services/SupabaseService');
const { normalizeDAVEOperationalRealtimeRecord } = require('../../services/SupabaseService');
const Persistence = require('../../services/ECOSDocumentIndexPersistence');
/** (c): the phone's Reports screen cites only from the list's copy (absent on 54c3265f: the documents as they are). */
const citedAsListed: (documents: ReferenceDocument[]) => ReferenceDocument[] = Persistence.referenceDocumentsCitedAsListed ?? ((documents: ReferenceDocument[]) => documents);
const heldAsBefore: (documents: ReferenceDocument[]) => ReferenceDocument[] = Persistence.withoutListedPageIndexes ?? Persistence.withoutKeptPageIndexes;
/** (c): the desktop folds a live-change row into what it holds keeping the list's copy of the index (absent on 54c3265f: the row whole). */
const desktopLiveRow: (candidate: any, held: any) => any = Persistence.liveDocumentRowWithTheListedIndex ?? ((candidate: any) => candidate);
/* eslint-enable @typescript-eslint/no-var-requires */

const NOW = '2026-10-01T18:00:00.000Z';
const IMPORTED = '2026-09-20T15:00:00.000Z';
const SHA_C = 'c'.repeat(64);
const SHA_D = 'd'.repeat(64);
const json = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const ITEMS: ScheduleItem[] = (normalizeScheduleImport({
  contents: ['Task,Project,Area,Start,Finish,Percent Complete', 'Paint,Alpha,Lot,10/05/2026,10/09/2026,', 'Drywall,Alpha,Lot,10/01/2026,10/04/2026,'].join('\n'),
  sourceName: 'MASTER M1.csv', mimeType: 'text/csv', projects: ['Alpha'], projectAreas: [], now: new Date(IMPORTED),
} as any).items as ScheduleItem[]).map((item, index) => ({ ...item, id: `m1-${index + 1}`, importBatchId: 'batch-m1', sourceDocumentId: 'doc-m1', projectControls: normalizeProjectControls((item as any).projectControls), activity: [] } as unknown as ScheduleItem));
const SCHEDULE: ReferenceDocument = normalizeReferenceDocument({
  id: 'doc-m1', name: 'MASTER M1', originalFileName: 'MASTER M1.csv', category: 'Schedules', notes: '', isCurrent: true, importedAt: IMPORTED,
  projectName: 'Alpha', projectNames: ['Alpha'], importBatchId: 'batch-m1', uri: '',
} as any);
const SCHEDULE_ROW = { id: SCHEDULE.id, name: SCHEDULE.name, category: SCHEDULE.category, document_data: json(SCHEDULE), updated_at: IMPORTED };
const mockDesktopHeld = new Map<string, any>();
function mockDesktopRows() {
  return {
    projects: [{ id: 'project-alpha-id', name: 'Alpha', archived: false, created_at: IMPORTED, updated_at: IMPORTED, owner_id: 'owner-1', project_data: null }],
    scheduleItems: ITEMS.map(item => ({ id: item.id, item_data: json(item), created_at: IMPORTED, updated_at: '2026-09-20T15:01:00.000Z' })),
    projectUpdates: [], syncTombstones: [],
    referenceDocuments: [SCHEDULE_ROW, ...mockDesktopHeld.values()],
  };
}
/** The page of the drawing that shows the Lot, with lines of the sheet that name no work area. */
const PAGE_C = {
  pageNumber: 1, sheetNumber: 'A-201', text: 'SITE PLAN - LOT',
  regions: [
    { id: 'region-lot', label: 'Lot', text: 'LOT 7 - NEW PAVING', areaNames: ['Lot'], confidence: 0.95, x: 0.1, y: 0.1, width: 0.4, height: 0.3 },
    { id: 'region-note-1', label: 'GENERAL NOTE 1', text: 'GENERAL NOTE 1', areaNames: [], confidence: 0.99, x: 0.6, y: 0.7, width: 0.3, height: 0.05 },
    { id: 'region-note-2', label: 'GENERAL NOTE 2', text: 'GENERAL NOTE 2', areaNames: [], confidence: 0.99, x: 0.6, y: 0.76, width: 0.3, height: 0.05 },
  ],
};
/** The drawing in the phone's memory in the session that read its file (Rev C). */
const DRAWING_AS_READ: ReferenceDocument = normalizeReferenceDocument({
  id: 'doc-a201', name: 'A-201 Site plan', originalFileName: 'A-201 Site plan.pdf', category: 'Plans', notes: '', isCurrent: true, importedAt: '2026-09-21T15:00:00.000Z',
  updatedAt: '2026-09-21T15:00:00.000Z',
  projectName: 'Alpha', projectNames: ['Alpha'], uri: 'file:///phone/Documents/project-documents/doc-a201.pdf', mimeType: 'application/pdf',
  storagePath: 'owner-1/doc-a201/A-201-Site-plan.pdf', sourceProvider: 'supabase_storage', sizeBytes: 1000, contentSha256: SHA_C, indexedContentSha256: SHA_C,
  drawingNumber: 'A-201', drawingRevision: 'C', drawingDiscipline: 'Architectural', drawingStatus: 'For Construction', drawingIssuedAt: '2026-09-18',
  extractionStatus: 'complete', extractionMethod: 'embedded_text', extractedText: 'SITE PLAN - LOT', extractedPages: [PAGE_C],
} as any);
const CITES_REV_C = ['Lot: A-201 Site plan · Rev C · Page 1'];


/** The phone (and the iPad): the app is closed and opened again: what it saved is read back at launch. */
function relaunch(documents: readonly ReferenceDocument[]): ReferenceDocument[] {
  return normalizeReferenceDocuments(json(compactECOSReferenceDocumentsForOperationalRead(documents)));
}
/** The phone (and the iPad): a full list, merged with its own documents (App.tsx's document refresh). */
async function download(local: readonly ReferenceDocument[]): Promise<ReferenceDocument[]> {
  const result = await SupabaseService.listReferenceDocuments();
  if (!result.ok || !Array.isArray(result.data)) throw new Error('list failed');
  return mergeDAVEReferenceDocumentRecoveryRecords({ local, cloud: normalizeReferenceDocuments(result.data) });
}
/** The phone (and the iPad) sends a document: the queue's payload, merged with the listed copy, then the upload. */
async function upload(document: ReferenceDocument) {
  const payload = compactECOSDocumentIndexForCloud(document);
  const listed = await SupabaseService.listReferenceDocuments();
  const remote = (listed.data ?? []).find(candidate => candidate.id === document.id);
  const authoritative = remote
    ? mergeDAVEReferenceDocumentRecoveryRecords({ local: [payload], cloud: [remote] }).find(candidate => candidate.id === document.id)!
    : payload;
  const result = await SupabaseService.upsertReferenceDocument(authoritative, { existing: Boolean(remote) });
  if (!result.ok) throw new Error(`upload failed: ${result.error}`);
}
const rowOf = (id: string) => json(mockCloud.rows.get(id));
/** The phone (and the iPad) applies a live-change row: the realtime normalizer and the one merge. */
function echo(local: readonly ReferenceDocument[], id: string): ReferenceDocument[] {
  return mergeDAVEReferenceDocumentRecoveryRecords({ local, cloud: normalizeReferenceDocuments([normalizeDAVEOperationalRealtimeRecord('reference_document', rowOf(id))]) });
}
/** The desktop: a live-change row folded into the row it holds; a page load or 30-minute refresh reads the list. */
const desktopEcho = (id: string) => mockDesktopHeld.set(id, desktopLiveRow(rowOf(id), mockDesktopHeld.get(id)));
const desktopReload = () => { mockDesktopHeld.clear(); mockListed().forEach(row => mockDesktopHeld.set(row.id, row)); };
/** The desktop edits the drawing's details: DAVEWebSupabaseClient.referenceDocumentRow of the document it holds. */
async function desktopEdits(notes: string) {
  const snapshot = await loadDAVEWebReadOnlySnapshot();
  const held = snapshot.referenceDocuments.find(document => document.id === 'doc-a201') as any;
  const { cloudUpdatedAt: _a, cloudDetailsSeen: _b, linkedScheduleItems: _c, importedScheduleItemCount: _d, ...data } =
    compactECOSDocumentIndexForCloud({ ...held, notes, updatedAt: '2026-10-02T09:00:00.000Z' }) as any;
  mockStore({ name: held.name, category: held.category, document_data: data }, 'doc-a201');
}
const drawingOf = (documents: readonly ReferenceDocument[]) => documents.find(document => document.id === 'doc-a201')!;
// The row's citation key (high item 3d, option (b2)): what the list carries.
const rowCitableRegions = () => (((mockCloud.rows.get('doc-a201')?.document_data as any)?.citationPageIndex?.pages as any[]) ?? [])
  .flatMap(page => page.regions ?? []).filter((region: any) => (region.areaNames ?? []).length > 0).length;

const SHOWN = () => selectAuthoritativeScheduleItems({ scheduleItems: ITEMS, scheduleDocuments: [SCHEDULE] }) as ScheduleItem[];
/** The phone's (and iPad's) Reports screen, as ReportsScreen hands the one recipe its documents. */
function phone(documents: readonly ReferenceDocument[]) {
  const all = [SCHEDULE, ...documents.filter(document => document.id !== SCHEDULE.id)];
  const cited = citedAsListed(all);
  const shown = SHOWN();
  const truths = buildDAVEReportProjectTruths({
    projects: [{ name: 'Alpha', projectId: 'report:alpha' }], projectRecords: [{ name: 'Alpha' }] as never, updates: [], scheduleItems: shown,
    knownScheduleItems: ITEMS, knownScheduleDocuments: [SCHEDULE], projectAreas: [], now: NOW,
    referenceDocuments: heldAsBefore(all), drawingDocuments: cited,
  });
  const fingerprint = RI.buildDAVEReportSourceFingerprint(truths);
  const cites = buildAutomaticReportDrawingReferences({ documents: cited, scheduleItems: shown, selectedProjectNames: ['Alpha'] }).map(reference => `${reference.areaName}: ${reference.citation.label}`);
  const snapshot = RS.buildDAVEReportSnapshot({ truths, scopeKey: RS.daveReportSnapshotScopeKey(['Alpha']), sourceFingerprint: fingerprint, capturedAt: NOW, reportFormat: 'project_manager' });
  return {
    fingerprint, earlierVersion: RI.buildDAVELegacyReportSourceFingerprint(truths), cites,
    sent: RS.markReportSnapshotDelivered({ ...snapshot, deliveredAt: null } as RSTypes.DAVEReportSnapshot, '2026-10-01T18:05:00.000Z', 'phone-install'),
  };
}
/** The desktop's Reports page: its own loader over the rows it holds, its own recipe. */
async function desktop() {
  const snapshot = { ...(await loadDAVEWebReadOnlySnapshot()), refreshedAt: NOW };
  const truths = (WebOps as any).buildDAVEWebReportTruths(snapshot, 'Alpha');
  const fingerprint = RI.buildDAVEReportSourceFingerprint(truths);
  const report = RS.buildDAVEReportSnapshot({ truths, scopeKey: RS.daveReportSnapshotScopeKey(['Alpha']), sourceFingerprint: fingerprint, capturedAt: NOW, reportFormat: 'project_manager' });
  return {
    fingerprint,
    // The desktop's Word report and Reports page cite as listed (high item 3).
    cites: buildAutomaticReportDrawingReferences({ documents: citedAsListed([...snapshot.referenceDocuments] as ReferenceDocument[]), scheduleItems: [...snapshot.scheduleItems] as ScheduleItem[], selectedProjectNames: ['Alpha'] }).map(reference => `${reference.areaName}: ${reference.citation.label}`),
    sent: RS.markReportSnapshotDelivered({ ...report, deliveredAt: null } as RSTypes.DAVEReportSnapshot, '2026-10-01T18:07:00.000Z', 'desktop-browser'),
  };
}
const desktopSaysAlreadySent = (sentByPhone: RSTypes.DAVEReportSnapshot, desktopFingerprint: string) =>
  (WebPeriod as any).daveWebReportAlreadySentElsewhereAt(sentByPhone, desktopFingerprint, new Set()) !== null;

type Step = { step: string; phone: string[]; iPad: string[]; desktop: string[]; oneReport: boolean; phoneAndDesktopKnowEachOthersReport: boolean };
async function look(step: string, onPhone: readonly ReferenceDocument[], onIPad: readonly ReferenceDocument[]): Promise<Step> {
  const p = phone(onPhone); const i = phone(onIPad); const d = await desktop();
  return {
    step, phone: p.cites, iPad: i.cites, desktop: d.cites,
    oneReport: p.fingerprint === d.fingerprint && i.fingerprint === d.fingerprint,
    phoneAndDesktopKnowEachOthersReport: desktopSaysAlreadySent(p.sent, d.fingerprint) && RS.sameReportSource(d.sent.sourceFingerprint, p.fingerprint),
  };
}
/** The steps of the follow-up's timeline (NOTES-H3-followup.txt), for the phone, the iPad and the desktop. */
async function timeline(): Promise<Step[]> {
  mockDesktopHeld.clear();
  const steps: Step[] = [];
  let onPhone: ReferenceDocument[] = [SCHEDULE, DRAWING_AS_READ];
  let onIPad: ReferenceDocument[] = [SCHEDULE];
  // Before the drawing has gone up, the iPad and the desktop do not have it at all: the phone's report is compared
  // with the one it would write with no page index (the drawing's details are in a report as any document's are).
  const noIndex = [SCHEDULE, { ...DRAWING_AS_READ, extractedPages: [], extractedText: null } as ReferenceDocument];
  const alone = (step: string) => ({ step, phone: phone(onPhone).cites, iPad: [], desktop: [], oneReport: phone(onPhone).fingerprint === phone(noIndex).fingerprint, phoneAndDesktopKnowEachOthersReport: true });
  steps.push(alone('1 read on the phone, not yet sent'));
  await upload(DRAWING_AS_READ);
  steps.push(alone('2 sent up; no live change seen yet'));
  onPhone = echo(onPhone, 'doc-a201'); onIPad = echo(onIPad, 'doc-a201'); desktopEcho('doc-a201');
  steps.push(await look('3 its own live-change echo, on all three', onPhone, onIPad));
  const afterEcho = onPhone;
  onPhone = await download(onPhone); onIPad = await download(onIPad); desktopReload();
  steps.push(await look('4 the next full list on all three', onPhone, onIPad));
  steps.push(await look('5a phone and iPad closed after that list, opened, before their first list', relaunch(onPhone), relaunch(onIPad)));
  steps.push(await look('5b phone closed right after the echo, opened, before its first list', relaunch(afterEcho), onIPad));
  onPhone = await download(relaunch(afterEcho));
  steps.push(await look('5c ... and after its first list', onPhone, onIPad));
  await desktopEdits('Field verified');
  onPhone = echo(onPhone, 'doc-a201'); onIPad = echo(onIPad, 'doc-a201'); desktopEcho('doc-a201');
  steps.push(await look('6 the desktop edits the drawing\'s details; the echo on all three', onPhone, onIPad));
  onPhone = await download(onPhone); onIPad = await download(onIPad); desktopReload();
  steps.push(await look('7 the next full list on all three', onPhone, onIPad));
  const phoneEdit = { ...drawingOf(relaunch(onPhone)), notes: 'Checked on site', updatedAt: '2026-10-03T09:00:00.000Z' } as ReferenceDocument;
  await upload(phoneEdit);
  onPhone = echo(onPhone.map(document => document.id === 'doc-a201' ? phoneEdit : document), 'doc-a201'); onIPad = echo(onIPad, 'doc-a201'); desktopEcho('doc-a201');
  steps.push(await look('8 the phone edits the drawing\'s details; the echo on all three', onPhone, onIPad));
  onPhone = await download(onPhone); onIPad = await download(onIPad); desktopReload();
  steps.push(await look('9 the next full list on all three', onPhone, onIPad));
  // eslint-disable-next-line no-console
  console.log(`TIMELINE (${mockCloud.listGives})\n` + steps.map(step => JSON.stringify(step)).join('\n'));
  return steps;
}

beforeEach(() => {
  mockCloud.rows = new Map();
  mockDesktopHeld.clear();
});

describe('(c) on the live list, a drawing whose row carries no citation key (every row sent before option (b2)); a live-change echo carries the row whole', () => {
  it('at every step, the phone, the iPad and the desktop write the same report, and none shows a drawing piece', async () => {
    mockCloud.listGives = 'the row without its page index';
    const steps = await timeline();
    for (const step of steps) {
      expect({ step: step.step, phone: step.phone, iPad: step.iPad, desktop: step.desktop }).toEqual({ step: step.step, phone: [], iPad: [], desktop: [] });
      expect({ step: step.step, oneReport: step.oneReport, known: step.phoneAndDesktopKnowEachOthersReport }).toEqual({ step: step.step, oneReport: true, known: true });
    }
  });
});

describe('(b2): the live list carries the row\'s citation key, written by this build\'s writers', () => {
  it('no piece until the list has carried it; then the same piece on all three, kept across closing and opening and across an edit on either side', async () => {
    mockCloud.listGives = 'the live list';
    const steps = await timeline();
    const pieceFromTheList = new Set(['4', '5a', '5c', '6', '7', '8', '9']);
    for (const step of steps) {
      const expected = pieceFromTheList.has(step.step.split(' ')[0]) ? CITES_REV_C : [];
      const iPadExpected = step.step.startsWith('1') || step.step.startsWith('2') || step.step.startsWith('3') ? [] : CITES_REV_C;
      expect({ step: step.step, phone: step.phone, iPad: step.iPad, desktop: step.desktop })
        .toEqual({ step: step.step, phone: expected, iPad: iPadExpected, desktop: step.step.startsWith('1') || step.step.startsWith('2') ? [] : (step.step.startsWith('3') ? [] : CITES_REV_C) });
      expect({ step: step.step, oneReport: step.oneReport || step.step.startsWith('5b'), known: step.phoneAndDesktopKnowEachOthersReport || step.step.startsWith('5b') })
        .toEqual({ step: step.step, oneReport: true, known: true });
    }
    // The edits on either side left the slice in the cloud's row.
    expect(rowCitableRegions()).toBe(1);
  });
});

describe('once after the update', () => {
  it('a report sent with a drawing piece on Build 231 (in the minutes after the drawing was read) reads as changed once, then is known everywhere', async () => {
    mockCloud.listGives = 'the row without its page index';
    // Build 231's phone in the session that read the file: the recipe handed the documents as they were.
    const shown = SHOWN();
    const asOnBuild231 = buildAutomaticReportDrawingReferences({ documents: [SCHEDULE, DRAWING_AS_READ], scheduleItems: shown, selectedProjectNames: ['Alpha'] });
    expect(asOnBuild231.map(reference => reference.citation.label)).toEqual(['A-201 Site plan · Rev C · Page 1']);
    const sentOnBuild231 = buildDAVEReportProjectTruths({
      projects: [{ name: 'Alpha', projectId: 'report:alpha' }], projectRecords: [{ name: 'Alpha' }] as never, updates: [], scheduleItems: shown,
      knownScheduleItems: ITEMS, knownScheduleDocuments: [SCHEDULE], projectAreas: [], now: NOW, referenceDocuments: [SCHEDULE, DRAWING_AS_READ],
    });
    const afterUpdate = phone([SCHEDULE, DRAWING_AS_READ]);
    expect(afterUpdate.cites).toEqual([]);
    expect(RS.sameReportSource(RI.buildDAVEReportSourceFingerprint(sentOnBuild231), afterUpdate.fingerprint)).toBe(false);
    // The next report, sent after the update, is the same on the desktop: known there.
    await upload(DRAWING_AS_READ); desktopReload();
    const onPhone = phone(await download([SCHEDULE, DRAWING_AS_READ]));
    expect(desktopSaysAlreadySent(onPhone.sent, (await desktop()).fingerprint)).toBe(true);
  });

  it('a phone that ran the earlier high-3 commit: the page index it kept from its own reading is dropped at launch, never cited and never sent', async () => {
    mockCloud.listGives = 'the row without its page index';
    const earlier = { ...json(compactECOSDocumentIndexForCloud(DRAWING_AS_READ)), extractedPages: [], extractedText: null,
      keptPageIndex: { sourceSha256: SHA_C, pages: json(compactECOSDocumentIndexForCloud(DRAWING_AS_READ).extractedPages) } };
    const [launched] = normalizeReferenceDocuments([earlier]) as Array<ReferenceDocument & Record<string, unknown>>;
    expect(launched).not.toHaveProperty('keptPageIndex');
    expect(phone([SCHEDULE, launched]).cites).toEqual([]);
    await upload(earlier as unknown as ReferenceDocument);
    expect(mockCloud.rows.get('doc-a201')!.document_data).not.toHaveProperty('keptPageIndex');
    expect(mockCloud.rows.get('doc-a201')!.document_data.extractedPages).toEqual([]);
  });
});

describe('nothing else changes', () => {
  it('a report with no drawing piece has the same 3.0, 2.0 and 1.0 fingerprints as before (c), on the live list', async () => {
    mockCloud.listGives = 'the row without its page index';
    await upload(DRAWING_AS_READ);
    const unread = { ...DRAWING_AS_READ, id: 'doc-a202', name: 'A-202 Floor plan', extractedPages: [], extractedText: null } as ReferenceDocument;
    const listed = await download([SCHEDULE, unread]);
    const shown = SHOWN();
    const versions = (truths: ReturnType<typeof buildDAVEReportProjectTruths>) =>
      [RI.buildDAVEReportSourceFingerprint(truths), (RI as any).buildDAVEVersion2ReportSourceFingerprint(truths), RI.buildDAVELegacyReportSourceFingerprint(truths)];
    const truthsFrom = (documents: ReferenceDocument[], screen: 'as before (c)' | '(c)') => buildDAVEReportProjectTruths({
      projects: [{ name: 'Alpha', projectId: 'report:alpha' }], projectRecords: [{ name: 'Alpha' }] as never, updates: [], scheduleItems: shown,
      knownScheduleItems: ITEMS, knownScheduleDocuments: [SCHEDULE], projectAreas: [], now: NOW,
      ...(screen === '(c)' ? { referenceDocuments: heldAsBefore(documents), drawingDocuments: citedAsListed(documents) } : { referenceDocuments: documents }),
    });
    for (const documents of [[SCHEDULE], [SCHEDULE, unread], listed.map(document => {
      // The same documents as a build before (c) held them: no field of this item's.
      const { listedPageIndex: _l, ...rest } = document as ReferenceDocument & Record<string, unknown>;
      return rest as ReferenceDocument;
    })]) {
      expect(versions(truthsFrom(documents, '(c)'))).toEqual(versions(truthsFrom(documents, 'as before (c)')));
    }
    // And the phone that holds the list's verdict (none) writes the same three as a build before (c).
    const withVerdict = listed;
    expect(withVerdict.some(document => (document as any).listedPageIndex === null)).toBe(true);
    expect(versions(truthsFrom(withVerdict, '(c)'))).toEqual(versions(truthsFrom(heldAsBefore(withVerdict), 'as before (c)')));
  });

  it('the earlier (1.0) fingerprint is the build before\'s, with the list\'s copy held or not', async () => {
    mockCloud.listGives = 'the live list';
    await upload(DRAWING_AS_READ);
    const listed = await download([SCHEDULE]);
    const asBefore = listed.map(document => {
      const { listedPageIndex: _l, keptPageIndex: _k, ...rest } = document as ReferenceDocument & Record<string, unknown>;
      return rest as ReferenceDocument;
    });
    expect(phone(listed).earlierVersion).toBe(phone(asBefore).earlierVersion);
  });

  it('what the phone takes from the list is only the part a citation is read from, and it says so when the list carries none', async () => {
    mockCloud.listGives = 'the row whole';
    await upload(DRAWING_AS_READ);
    const [fromWholeRow] = (await SupabaseService.listReferenceDocuments()).data as Array<ReferenceDocument & Record<string, any>>;
    expect(fromWholeRow.extractedPages).toEqual([]);
    expect(fromWholeRow.listedPageIndex?.pages?.flatMap((page: any) => page.regions.map((region: any) => region.id))).toEqual(['region-lot']);
    mockCloud.listGives = 'the row without its page index';
    const [fromLiveList] = (await SupabaseService.listReferenceDocuments()).data as Array<ReferenceDocument & Record<string, any>>;
    expect(fromLiveList.listedPageIndex).toBeNull();
  });

  it('the desktop: a live change keeps the list\'s copy of the index for the same file only, never the live row\'s own', () => {
    const listedRow = { id: 'doc-a201', updated_at: 't1', document_data: { id: 'doc-a201', contentSha256: SHA_C, extractedPages: [{ pageNumber: 1, regions: [] }] } };
    const live = (sha: string) => ({ id: 'doc-a201', updated_at: 't2', document_data: { id: 'doc-a201', contentSha256: sha, notes: 'n', extractedPages: [{ pageNumber: 9, regions: [] }] } });
    expect(desktopLiveRow(live(SHA_C), listedRow).document_data).toEqual({ id: 'doc-a201', contentSha256: SHA_C, notes: 'n', extractedPages: [{ pageNumber: 1, regions: [] }] });
    expect(desktopLiveRow(live(SHA_D), listedRow).document_data).toEqual({ id: 'doc-a201', contentSha256: SHA_D, notes: 'n' });
    expect(desktopLiveRow(live(SHA_C), undefined).document_data).toEqual({ id: 'doc-a201', contentSha256: SHA_C, notes: 'n' });
  });

  it('the wiring: the Reports screen, the desktop\'s live changes and the phone\'s list read the list\'s copy', () => {
    /* eslint-disable @typescript-eslint/no-var-requires */
    const read = (file: string): string => require('fs').readFileSync(require('path').resolve(__dirname, '../..', file), 'utf8');
    /* eslint-enable @typescript-eslint/no-var-requires */
    const screen = read('screens/ReportsScreen.tsx');
    expect(screen).toContain('const citedDocuments = useMemo(() => referenceDocumentsCitedAsListed(referenceDocuments || []), [referenceDocuments]);');
    expect(screen).toContain('referenceDocuments: referenceDocuments && withoutListedPageIndexes(referenceDocuments),');
    expect(screen).toContain('drawingDocuments: citedDocuments,');
    expect(screen).toContain('documents: citedDocuments,');
    expect(read('services/DAVEWebSupabaseClient.ts')).toContain('liveDocumentRowWithTheListedIndex(documentRow, rows.referenceDocuments.find(row => readRawString(row, \'id\') === id))');
    expect(read('services/SupabaseService.ts')).toContain('const compactDocuments = compactECOSReferenceDocumentsFromTheDocumentList(documents);');
  });
});
