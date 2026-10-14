/**
 * High item 3, option (b2) (the coordinator's decision on Q52 B, 13 Oct 2026: app only, no database change). The live
 * document list leaves document_data.extractedPages out and keeps every other key. Every updated device and the
 * desktop now write the citation slice of a drawing's index under ONE new key, document_data.citationPageIndex, when
 * they send its row; the one reader of the list's copy reads that key on the phone, the iPad and the desktop. There is
 * no backfill (high item 3e: a write of a row nobody touched can start the cloud's paid preparation): a drawing already
 * in the cloud gets its key when it is read again on an updated iPhone or iPad. Everything else of (c) stands: a
 * report cites only the list's copy, never a live row's own, never a device's own reading.
 * Each device by its own code, over a cloud whose list is the live one. Made-up project and drawing.
 */
import type * as RSTypes from '../../services/DAVEReportSnapshot';
import type { ReferenceDocument, ScheduleItem } from '../../types';

/** The cloud: one row per document, as the phone writes it and as the document list function gives it back. */
const mockCloud: {
  rows: Map<string, { id: string; name: string; category: string; document_data: Record<string, unknown>; updated_at: string }>;
  /** What the document list function returns of a row's document_data (its code is in no migration: both ways). */
  listGives: 'the row whole' | 'the row without its page index' | 'a citation slice';
  clock: number;
} = { rows: new Map(), listGives: 'the row whole', clock: Date.parse('2026-09-21T15:01:00.000Z') };
function mockStore(payload: Record<string, any>, id: string) {
  mockCloud.clock += 60_000;
  mockCloud.rows.set(id, {
    id, name: payload.name, category: payload.category,
    document_data: JSON.parse(JSON.stringify(payload.document_data)), updated_at: new Date(mockCloud.clock).toISOString(),
  });
}
/** Option (b) as described to the owner, made here independently of the app's own code: per page its number and sheet,
 * only regions that name a work area or carry a label of their own, with a size and a confidence. */
function citationSlice(pages: unknown): unknown[] {
  return (Array.isArray(pages) ? pages : []).flatMap((page: any) => {
    const regions = (page.regions ?? []).filter((region: any) => ((region.areaNames ?? []).length > 0 || Boolean(region.label)) &&
      region.width > 0 && region.height > 0 && (region.confidence ?? 0) > 0);
    return regions.length ? [{ pageNumber: page.pageNumber, sheetNumber: page.sheetNumber ?? null, sheetMappingStatus: page.sheetMappingStatus ?? null, regions }] : [];
  });
}
function mockListed() {
  return [...mockCloud.rows.values()].map(row => {
    const data = JSON.parse(JSON.stringify(row.document_data));
    if (mockCloud.listGives === 'the row without its page index') delete data.extractedPages; // the live list: document_data - 'extractedPages'
    if (mockCloud.listGives === 'a citation slice') data.extractedPages = citationSlice(data.extractedPages);
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
const rowCitableRegions = () => ((mockCloud.rows.get('doc-a201')?.document_data.extractedPages as any[]) ?? [])
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
    cites: buildAutomaticReportDrawingReferences({ documents: citedAsListed([...snapshot.referenceDocuments] as ReferenceDocument[]), scheduleItems: [...snapshot.scheduleItems] as ScheduleItem[], selectedProjectNames: ['Alpha'] }).map(reference => `${reference.areaName}: ${reference.citation.label}`),
    sent: RS.markReportSnapshotDelivered({ ...report, deliveredAt: null } as RSTypes.DAVEReportSnapshot, '2026-10-01T18:07:00.000Z', 'desktop-browser'),
  };
}
const desktopSaysAlreadySent = (sentByPhone: RSTypes.DAVEReportSnapshot, desktopFingerprint: string) =>
  (WebPeriod as any).daveWebReportAlreadySentElsewhereAt(sentByPhone, desktopFingerprint, new Set()) !== null;


const KEY = 'citationPageIndex';
const keyOf = (id = 'doc-a201') => (mockCloud.rows.get(id)?.document_data as any)?.[KEY];
/** A drawing as a Build 231 phone sent it: its own reading in extractedPages, no key. */
function sentByBuild231(document: ReferenceDocument) {
  const { [KEY]: _none, listedPageIndex: _l, ...data } = json(compactECOSDocumentIndexForCloud(document)) as any;
  const { cloudUpdatedAt: _c, cloudDetailsSeen: _d, ...documentData } = data;
  mockStore({ name: document.name, category: document.category, document_data: documentData }, document.id);
}
async function allThree(onPhone: readonly ReferenceDocument[], onIPad: readonly ReferenceDocument[]) {
  const p = phone(onPhone); const i = phone(onIPad); const d = await desktop();
  return { phone: p.cites, iPad: i.cites, desktop: d.cites, oneReport: p.fingerprint === d.fingerprint && i.fingerprint === d.fingerprint, p, d };
}

beforeEach(() => {
  mockCloud.rows = new Map();
  mockCloud.listGives = 'the row without its page index';
  mockDesktopHeld.clear();
});

describe('(b2) the writers: a drawing\'s row is sent with the citation slice under document_data.citationPageIndex', () => {
  it('the first upload from the phone\'s own reading: after their next full list the phone, the iPad and the desktop show the same piece, kept across closing and opening; a live change does not bring it sooner', async () => {
    await upload(DRAWING_AS_READ);
    expect(keyOf()?.pages?.flatMap((page: any) => page.regions.map((region: any) => region.id))).toEqual(['region-lot']);
    let onPhone = echo([SCHEDULE, DRAWING_AS_READ], 'doc-a201'); let onIPad = echo([SCHEDULE], 'doc-a201'); desktopEcho('doc-a201');
    expect(await allThree(onPhone, onIPad)).toMatchObject({ phone: [], iPad: [], desktop: [], oneReport: true });
    onPhone = await download(onPhone); onIPad = await download(onIPad); desktopReload();
    expect(await allThree(onPhone, onIPad)).toMatchObject({ phone: CITES_REV_C, iPad: CITES_REV_C, desktop: CITES_REV_C, oneReport: true });
    expect(await allThree(relaunch(onPhone), relaunch(onIPad))).toMatchObject({ phone: CITES_REV_C, iPad: CITES_REV_C, desktop: CITES_REV_C, oneReport: true });
    const both = await allThree(onPhone, onIPad);
    expect(desktopSaysAlreadySent(both.p.sent, both.d.fingerprint)).toBe(true);
    expect(RS.sameReportSource(both.d.sent.sourceFingerprint, both.p.fingerprint)).toBe(true);
  });

  it('an edit of the drawing\'s details on the phone (or iPad) and on the desktop keeps the key, and the piece', async () => {
    await upload(DRAWING_AS_READ);
    let onPhone = await download([SCHEDULE]); desktopReload();
    await upload({ ...drawingOf(relaunch(onPhone)), notes: 'Checked on site', updatedAt: '2026-10-03T09:00:00.000Z' } as ReferenceDocument);
    expect(keyOf()?.pages).toHaveLength(1);
    desktopReload();
    await desktopEdits('Field verified');
    expect(keyOf()?.pages).toHaveLength(1);
    expect(mockCloud.rows.get('doc-a201')!.document_data).not.toHaveProperty('listedPageIndex');
    onPhone = await download(onPhone); desktopReload();
    expect(await allThree(onPhone, await download([SCHEDULE]))).toMatchObject({ phone: CITES_REV_C, iPad: CITES_REV_C, desktop: CITES_REV_C, oneReport: true });
  });

  it('a new revision sent without its own reading: the old file\'s slice is not sent, and no device cites Rev C', async () => {
    await upload(DRAWING_AS_READ);
    const iPad = await download([SCHEDULE]);
    await upload({ ...drawingOf(iPad), drawingRevision: 'D', contentSha256: SHA_D, sizeBytes: 2000, updatedAt: '2026-10-01T12:00:00.000Z' } as ReferenceDocument);
    expect(keyOf()).toBeUndefined();
    desktopReload();
    const seen = await allThree(await download(iPad), await download([SCHEDULE]));
    expect([...seen.phone, ...seen.iPad, ...seen.desktop].filter(cite => cite.includes('Rev C'))).toEqual([]);
    expect(seen.oneReport).toBe(true);
  });

  it('a new revision read on the phone into the same document: the new file\'s slice is sent; every device cites the new page', async () => {
    await upload(DRAWING_AS_READ);
    const onPhone = await download([SCHEDULE, DRAWING_AS_READ]);
    const revD = { ...DRAWING_AS_READ, drawingRevision: 'D', contentSha256: SHA_D, indexedContentSha256: SHA_D, sizeBytes: 2000, updatedAt: '2026-10-01T12:00:00.000Z', extractedPages: [{ ...PAGE_C, pageNumber: 2 }] } as ReferenceDocument;
    await upload(revD);
    expect(keyOf()?.sourceSha256).toBe(SHA_D);
    desktopReload();
    expect(await allThree(await download(onPhone), await download([SCHEDULE]))).toMatchObject({
      phone: ['Lot: A-201 Site plan · Rev D · Page 2'], iPad: ['Lot: A-201 Site plan · Rev D · Page 2'], desktop: ['Lot: A-201 Site plan · Rev D · Page 2'], oneReport: true,
    });
  });

  it('the key is small: only what a citation and the piece read (page, sheet; region id, label, areas, confidence, box)', async () => {
    await upload(DRAWING_AS_READ);
    const key = keyOf();
    expect(Object.keys(key).sort()).toEqual(['pages', 'sourceSha256']);
    expect(Object.keys(key.pages[0]).sort()).toEqual(['pageNumber', 'regions', 'sheetNumber']);
    expect(Object.keys(key.pages[0].regions[0]).sort()).toEqual(['areaNames', 'confidence', 'height', 'id', 'label', 'width', 'x', 'y']);
    expect(JSON.stringify(key).length).toBeLessThan(400);
  });
});

describe('(b2) with no backfill (high item 3e): drawings already in the cloud', () => {
  it('a drawing an earlier build sent (its record holds its index, no key) shows no piece anywhere, and nothing writes its record', async () => {
    sentByBuild231(DRAWING_AS_READ);
    const before = json(mockCloud.rows.get('doc-a201')!);
    desktopReload();
    expect(await allThree(await download([SCHEDULE]), await download([SCHEDULE]))).toMatchObject({ phone: [], iPad: [], desktop: [], oneReport: true });
    expect(mockCloud.rows.get('doc-a201')).toEqual(before);
  });

  it('read again on an updated iPhone (added again into the same record): its key goes up with that send, and every device shows its piece after its next list', async () => {
    sentByBuild231(DRAWING_AS_READ);
    await upload({ ...DRAWING_AS_READ, updatedAt: '2026-10-02T09:00:00.000Z' } as ReferenceDocument);
    expect(keyOf()?.pages).toHaveLength(1);
    desktopReload();
    expect(await allThree(await download([SCHEDULE]), await download([SCHEDULE]))).toMatchObject({ phone: CITES_REV_C, iPad: CITES_REV_C, desktop: CITES_REV_C, oneReport: true });
  });

  it('the wiring: the desktop sends a Google Drive drawing\'s record with the key rule, and its Word report cites as listed', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const client: string = require('fs').readFileSync(require('path').resolve(__dirname, '../../services/DAVEWebSupabaseClient.ts'), 'utf8');
    expect(client).toContain('? withCitationPageIndexForTheCloudRow(compactECOSDocumentMetadataForCloud(document), document)');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const shell: string = require('fs').readFileSync(require('path').resolve(__dirname, '../../components/web-shell/desktop-read-only-shell.tsx'), 'utf8');
    expect(shell).toContain('documents: referenceDocumentsCitedAsListed([...snapshot.referenceDocuments] as ReferenceDocument[]),');
  });
});

describe('(b2) fingerprints', () => {
  it('a report with no piece: the key in the row moves no fingerprint (3.0, 2.0, 1.0) on the phone or the desktop', async () => {
    const elsewhere = { ...DRAWING_AS_READ, extractedPages: [{ ...PAGE_C, regions: [{ ...PAGE_C.regions[0], areaNames: ['Roof'], label: 'Roof' }] }] } as unknown as ReferenceDocument;
    const versions = async (onPhone: ReferenceDocument[]) => {
      desktopReload();
      const shown = SHOWN();
      const truths = buildDAVEReportProjectTruths({ projects: [{ name: 'Alpha', projectId: 'report:alpha' }], projectRecords: [{ name: 'Alpha' }] as never, updates: [], scheduleItems: shown,
        knownScheduleItems: ITEMS, knownScheduleDocuments: [SCHEDULE], projectAreas: [], now: NOW, referenceDocuments: heldAsBefore(onPhone), drawingDocuments: citedAsListed(onPhone) });
      const snapshot = { ...(await loadDAVEWebReadOnlySnapshot()), refreshedAt: NOW };
      const web = (WebOps as any).buildDAVEWebReportTruths(snapshot, 'Alpha');
      return [truths, web].map(t => [RI.buildDAVEReportSourceFingerprint(t), (RI as any).buildDAVEVersion2ReportSourceFingerprint(t), RI.buildDAVELegacyReportSourceFingerprint(t)]);
    };
    await upload(elsewhere);
    expect(keyOf()?.pages).toHaveLength(1);
    const withKey = await versions(await download([SCHEDULE]));
    const { [KEY]: _k, ...withoutKeyData } = mockCloud.rows.get('doc-a201')!.document_data as any;
    mockCloud.rows.set('doc-a201', { ...mockCloud.rows.get('doc-a201')!, document_data: withoutKeyData });
    const withoutKey = await versions(await download([SCHEDULE]));
    expect(withKey).toEqual(withoutKey);
  });

  it('a report sent before the update without a piece is known as before; the first report after a drawing gets its piece (read again on an updated iPhone) reads as changed once, then is known everywhere', async () => {
    sentByBuild231(DRAWING_AS_READ);
    desktopReload();
    const beforeTheReading = await allThree(await download([SCHEDULE]), await download([SCHEDULE]));
    expect(beforeTheReading.oneReport).toBe(true);
    // No backfill (3e): the drawing gets its piece when it is read again on an updated iPhone and sent.
    await upload({ ...DRAWING_AS_READ, updatedAt: '2026-10-02T09:00:00.000Z' } as ReferenceDocument);
    desktopReload();
    const after = await allThree(await download([SCHEDULE]), await download([SCHEDULE]));
    expect(RS.sameReportSource(beforeTheReading.p.sent.sourceFingerprint, after.p.fingerprint)).toBe(false);
    expect(desktopSaysAlreadySent(after.p.sent, after.d.fingerprint)).toBe(true);
  });
});
