/**
 * R7 item C (the coordinator's decision on review pass 1, F1).
 *
 * The code the app uses to tell "the same report" carried what belongs to
 * the device, not to the project:
 *  - where a schedule file sits inside this install's own folder (a
 *    document's `uri`: the phone's and the iPad's differ, the web has none,
 *    and iOS moves the folder at an update or a reinstall);
 *  - the device's own note of the document's cloud row (`cloudUpdatedAt`,
 *    `cloudDetailsSeen`);
 *  - what only the web's loader adds to a document (`linkedScheduleItems`,
 *    `importedScheduleItemCount`, `lookaheadReplaced`, `cloudUpdatedAt`);
 *  - the text and page index read out of the file, whole on the device that
 *    read it and cut down in the cloud's row and at the next launch, and
 *    the rest of the file's housekeeping (seen while fixing; not in the
 *    review's list);
 *  - on the web, the time the cloud last stamped a task's row, standing in
 *    for the updatedAt of a task nobody has edited.
 * So the phone, the iPad and the desktop never had one fingerprint for one
 * project: the desktop did not know a report the phone had already sent, and
 * after iOS moved the app's folder the phone did not know its own.
 *
 * Fixed in version 2.0 of the fingerprint only, which no released build has
 * written. Version 1.0 is still what Build 230 wrote, to the byte.
 *
 * The phone's own document normalizer, the web's OWN loader over cloud rows
 * as the app uploads them (each row with the cloud's own time, in another
 * order), the one report recipe, the written report. Synthetic data.
 */
import { buildDAVEProjectTruth, daveProjectTruthAsBuilt, type DAVEProjectTruth } from '../../services/DAVEProjectTruth';
import {
  buildDAVELegacyReportSourceFingerprint, buildDAVEReportBriefing, buildDAVEReportSourceFingerprint, enhanceDAVEReportDraft,
} from '../../services/DAVEReportIntelligence';
import { buildDAVEReportProjectTruths } from '../../services/DAVEReportProjectTruths';
import {
  buildDAVEReportSnapshot, daveReportSnapshotScopeKey, markReportSnapshotDelivered, sameReportSource, type DAVEReportSnapshot,
} from '../../services/DAVEReportSnapshot';
import { buildDAVEWebReportDraft, buildDAVEWebReportTruths, formatDAVEWebReport } from '../../services/DAVEWebOperations';
import { loadDAVEWebReadOnlySnapshot, type DAVEWebReadOnlySnapshot } from '../../services/DAVEWebReadOnlyRepository';
import { daveWebReportAlreadySentElsewhereAt } from '../../services/DAVEWebReportPeriod';
import { compactECOSDocumentIndexForCloud } from '../../services/ECOSDocumentIndexPersistence';
import { normalizeScheduleImport } from '../../services/PIEScheduleIntelligence';
import { selectAuthoritativeScheduleItems } from '../../services/PIEScheduleReconciliation';
import { normalizeProjectControls } from '../../services/VitruviusProjectControls';
import type { ReferenceDocument, ScheduleItem } from '../../types';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: jest.fn(async () => null), setItem: jest.fn(async () => undefined), removeItem: jest.fn(async () => undefined), getAllKeys: jest.fn(async () => []), multiGet: jest.fn(async () => []) },
}));
const mockDevice = { folder: 'file:///var/mobile/Containers/Data/Application/AAAA-PHONE/Documents/' };
jest.mock('expo-file-system/legacy', () => ({ get documentDirectory() { return mockDevice.folder; } }));
const mockCloud: { rows: unknown } = { rows: null };
jest.mock('../../services/DAVEWebSupabaseClient', () => ({ daveWebSupabaseGateway: { loadAuthorizedRows: async () => mockCloud.rows } }));

const NOW = '2026-10-01T18:00:00.000Z';
const IMPORTED = '2026-09-20T15:00:00.000Z';
const PHONE_FOLDER = 'file:///var/mobile/Containers/Data/Application/AAAA-PHONE/Documents/';
const json = <T,>(value: T): T => JSON.parse(JSON.stringify(value));

/** The phone's own normalizer for a saved document, on a device whose folder is `folder`. */
function deviceDocument(folder: string, value: Partial<ReferenceDocument>): ReferenceDocument {
  let document: ReferenceDocument | null = null;
  mockDevice.folder = folder;
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    document = require('../../services/ReferenceDocumentRepository').normalizeReferenceDocument(value);
  });
  return document as unknown as ReferenceDocument;
}
/** Three tasks of an imported master, as the phone saves an imported row. Nobody has edited them: no updatedAt. Framing is complete. */
function importedTasks(): ScheduleItem[] {
  return (normalizeScheduleImport({
    contents: ['Task,Project,Area,Start,Finish,Percent Complete', 'Paint,Alpha,Lot,10/05/2026,10/09/2026,', 'Drywall,Alpha,Lot,10/01/2026,10/04/2026,', 'Framing,Alpha,Lot,09/21/2026,09/25/2026,100'].join('\n'),
    sourceName: 'MASTER M1.csv', mimeType: 'text/csv', projects: ['Alpha'], projectAreas: [], now: new Date(IMPORTED),
  }).items as ScheduleItem[]).map((item, index) => ({
    ...item, id: `m1-${index + 1}`, importBatchId: 'batch-m1', sourceDocumentId: 'doc-m1', projectControls: normalizeProjectControls(undefined), activity: [],
  } as ScheduleItem));
}
const SAVED_DOCUMENT = {
  id: 'doc-m1', name: 'MASTER M1', originalFileName: 'MASTER M1.csv', category: 'Schedules', notes: '', isCurrent: true, importedAt: IMPORTED,
  projectName: 'Alpha', projectNames: ['Alpha'], importBatchId: 'batch-m1', storagePath: 'owner-1/doc-m1/MASTER-M1.csv', sourceProvider: 'supabase_storage',
  uri: `${PHONE_FOLDER}project-documents/doc-m1.csv`,
} as Partial<ReferenceDocument>;

/** The phone's (or the iPad's) Reports screen recipe. */
function deviceTruths(items: ScheduleItem[], document: ReferenceDocument): DAVEProjectTruth[] {
  const shown = selectAuthoritativeScheduleItems({ scheduleItems: items, scheduleDocuments: [document] }) as ScheduleItem[];
  return buildDAVEReportProjectTruths({
    projects: [{ name: 'Alpha', projectId: 'report:alpha' }], projectRecords: [{ name: 'Alpha' }] as never, updates: [], scheduleItems: shown,
    knownScheduleItems: items, knownScheduleDocuments: [document], projectAreas: [], referenceDocuments: [document], now: NOW,
  });
}
/** When the cloud stamped a task's row: a minute after the import, each row its own second. */
const UPLOADED = (item: ScheduleItem) => new Date(Date.parse(IMPORTED) + 60_000 + Number(item.id.slice(-1)) * 1000).toISOString();
/**
 * What the web has downloaded of the same saved project, through its own loader: the cloud's rows as the app
 * uploads them (the saved task and the saved document as JSON, each row with the cloud's own time), last first.
 */
async function webSnapshot(items: ScheduleItem[], document: ReferenceDocument, rowTime: (item: ScheduleItem) => string = UPLOADED, documentRowTime = '2026-09-20T15:02:00.000Z'): Promise<DAVEWebReadOnlySnapshot> {
  // As SupabaseService uploads a document: its text index cut down for the cloud, its own notes of the cloud row left out.
  const { cloudUpdatedAt: _seen, cloudDetailsSeen: _details, ...sent } = compactECOSDocumentIndexForCloud(document) as ReferenceDocument & Record<string, unknown>;
  mockCloud.rows = {
    projects: [{ id: 'project-alpha-id', name: 'Alpha', archived: false, created_at: IMPORTED, updated_at: IMPORTED, owner_id: 'owner-1', project_data: null }],
    scheduleItems: [...items].reverse().map(item => ({ id: item.id, item_data: json(item), created_at: IMPORTED, updated_at: rowTime(item) })),
    projectUpdates: [], syncTombstones: [],
    referenceDocuments: [{ id: document.id, name: document.name, category: document.category, document_data: json(sent), updated_at: documentRowTime }],
  };
  return { ...(await loadDAVEWebReadOnlySnapshot()), refreshedAt: NOW };
}
const webTruths = async (items: ScheduleItem[], document: ReferenceDocument, rowTime?: (item: ScheduleItem) => string) =>
  buildDAVEWebReportTruths(await webSnapshot(items, document, rowTime), 'Alpha');

/** The paths at which two report truths differ, by what version 2.0 hashes (no summary lines, no links, no project id). */
function differingPaths(left: DAVEProjectTruth, right: DAVEProjectTruth): string[] {
  const out = new Set<string>();
  const strip = (truth: DAVEProjectTruth) => {
    const { briefing: _b, generatedAt: _g, entityLinks: _e, ...rest } = truth;
    const id = String(truth.projectId);
    return JSON.parse([encodeURIComponent(encodeURIComponent(encodeURIComponent(id))), encodeURIComponent(encodeURIComponent(id)), encodeURIComponent(id), id]
      .reduce((text, form) => text.split(form).join('<p>'), JSON.stringify(rest)));
  };
  const walk = (a: unknown, b: unknown, at: string) => {
    if (JSON.stringify(a) === JSON.stringify(b)) return;
    if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
      new Set([...Object.keys(a), ...Object.keys(b)]).forEach(key => walk((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key], `${at}.${key}`));
      return;
    }
    if (Array.isArray(a) && Array.isArray(b) && a.length === b.length) {
      const sa = a.map(value => JSON.stringify(value)).sort(); const sb = b.map(value => JSON.stringify(value)).sort();
      sa.forEach((value, index) => walk(JSON.parse(value), JSON.parse(sb[index]), `${at}[]`));
      return;
    }
    out.add(at);
  };
  walk(strip(left), strip(right), 'truth');
  return [...out].sort();
}
const STUB = { id: 'draft', title: '', subject: '', body: '', openingLine: 'OPENING', closingLine: 'CLOSING', locationGroups: [] } as never;
/** The written report, in the phone's words and in the web's. */
function written(truths: DAVEProjectTruth[], items: readonly ScheduleItem[]): string {
  const briefing = buildDAVEReportBriefing({ truths, selectedProjectNames: ['Alpha'], previousSnapshot: null, scheduleItems: items });
  return [
    String(enhanceDAVEReportDraft(STUB, briefing, 'project_manager').body),
    String(formatDAVEWebReport(briefing, 'project_manager', null)).split('\n').filter(line => !line.startsWith('Generated: ')).join('\n'),
  ].join('\n=====\n');
}

const PHONE_DOCUMENT = deviceDocument(PHONE_FOLDER, SAVED_DOCUMENT);
const ITEMS = importedTasks();

describe('R7 item C: one project has one fingerprint on the phone, the iPad and the web', () => {
  it('(the rig) the phone\'s document keeps the file\'s path inside this install\'s own folder, and an unedited task has no updatedAt', () => {
    expect(PHONE_DOCUMENT.uri).toBe(`${PHONE_FOLDER}project-documents/doc-m1.csv`);
    expect(ITEMS.map(item => item.updatedAt)).toEqual([undefined, undefined, undefined]);
  });

  it('the same phone after iOS has moved the app\'s folder (an update or a reinstall): a report approved or sent before is still that report', () => {
    const afterUpdate = deviceDocument('file:///var/mobile/Containers/Data/Application/BBBB-AFTER-UPDATE/Documents/', json(PHONE_DOCUMENT));
    expect(afterUpdate.uri).toBe('file:///var/mobile/Containers/Data/Application/BBBB-AFTER-UPDATE/Documents/project-documents/doc-m1.csv');
    expect(differingPaths(deviceTruths(ITEMS, PHONE_DOCUMENT)[0], deviceTruths(ITEMS, afterUpdate)[0])).toEqual([]);
    expect(buildDAVEReportSourceFingerprint(deviceTruths(ITEMS, afterUpdate))).toBe(buildDAVEReportSourceFingerprint(deviceTruths(ITEMS, PHONE_DOCUMENT)));
  });

  it('the phone and the iPad, the same saved project: the same fingerprint', () => {
    const ipad = deviceDocument('file:///var/mobile/Containers/Data/Application/CCCC-IPAD/Documents/', json(PHONE_DOCUMENT));
    expect(differingPaths(deviceTruths(ITEMS, PHONE_DOCUMENT)[0], deviceTruths(ITEMS, ipad)[0])).toEqual([]);
    expect(buildDAVEReportSourceFingerprint(deviceTruths(ITEMS, ipad))).toBe(buildDAVEReportSourceFingerprint(deviceTruths(ITEMS, PHONE_DOCUMENT)));
  });

  it('each device\'s own note of the document\'s cloud row changes nothing', () => {
    const noted = { ...PHONE_DOCUMENT, cloudUpdatedAt: '2026-09-30T09:00:00.000Z', cloudDetailsSeen: '2026-09-30T09:00:00.000Z' } as ReferenceDocument;
    expect(differingPaths(deviceTruths(ITEMS, PHONE_DOCUMENT)[0], deviceTruths(ITEMS, noted)[0])).toEqual([]);
    expect(buildDAVEReportSourceFingerprint(deviceTruths(ITEMS, noted))).toBe(buildDAVEReportSourceFingerprint(deviceTruths(ITEMS, PHONE_DOCUMENT)));
  });

  it('the phone and the web, through the web\'s own loader, the rows as the cloud keeps them: the same facts and the same fingerprint', async () => {
    const snapshot = await webSnapshot(ITEMS, PHONE_DOCUMENT);
    // (the rig) The web holds what its loader makes of the rows: the cloud's time on each unedited task, its own fields on the document.
    expect(snapshot.scheduleItems.map(item => [item.id, item.updatedAt]).sort()).toEqual(ITEMS.map(item => [item.id, UPLOADED(item)]));
    expect(snapshot.referenceDocuments[0]).toMatchObject({ uri: '', cloudUpdatedAt: '2026-09-20T15:02:00.000Z', importedScheduleItemCount: 3 });
    const web = buildDAVEWebReportTruths(snapshot, 'Alpha');
    const phone = deviceTruths(ITEMS, PHONE_DOCUMENT);
    expect(differingPaths(phone[0], web[0])).toEqual([]);
    expect(buildDAVEReportSourceFingerprint(web)).toBe(buildDAVEReportSourceFingerprint(phone));
    // And the written report is the same.
    expect(written(web, snapshot.scheduleItems)).toBe(written(phone, ITEMS));
  });

  it('whenever any device uploads the rows again (the cloud stamps them anew), the web\'s fingerprint stays', async () => {
    const first = buildDAVEReportSourceFingerprint(await webTruths(ITEMS, PHONE_DOCUMENT));
    const again = buildDAVEReportSourceFingerprint(buildDAVEWebReportTruths(
      await webSnapshot(ITEMS, PHONE_DOCUMENT, item => new Date(Date.parse(UPLOADED(item)) + 86_400_000).toISOString(), '2026-09-25T08:00:00.000Z'), 'Alpha'));
    expect(again).toBe(first);
  });

  it('what he sees: the phone sends a report, nothing changes, and the web\'s Reports page knows it as the report the other device already sent', async () => {
    const truths = deviceTruths(ITEMS, PHONE_DOCUMENT);
    const phoneFingerprint = buildDAVEReportSourceFingerprint(truths);
    const sentByPhone = markReportSnapshotDelivered(
      { ...buildDAVEReportSnapshot({ truths, scopeKey: daveReportSnapshotScopeKey(['Alpha']), sourceFingerprint: phoneFingerprint, capturedAt: NOW, reportFormat: 'project_manager' }), deliveredAt: null } as DAVEReportSnapshot,
      '2026-10-01T18:05:00.000Z', 'phone-install');
    const webFingerprint = buildDAVEReportSourceFingerprint(await webTruths(ITEMS, PHONE_DOCUMENT));
    expect(daveWebReportAlreadySentElsewhereAt(sentByPhone, webFingerprint, new Set())).toBe('2026-10-01T18:05:00.000Z');
  });
});

describe('R7 item C: a real edit time still counts, on the phone and on the web alike', () => {
  const EDITED = '2026-09-28T17:00:00.000Z';
  const edited = (at: string) => ITEMS.map(item => (item.id === 'm1-3' ? { ...item, updatedAt: at } as ScheduleItem : item));
  /** The edit was uploaded twenty seconds after it was made. */
  const uploadedAfterEdit = (item: ScheduleItem) => (item.updatedAt ? new Date(Date.parse(item.updatedAt) + 20_000).toISOString() : UPLOADED(item));

  it('a task he edited is read by its own edit time on both, and the two agree', async () => {
    const phone = deviceTruths(edited(EDITED), PHONE_DOCUMENT);
    const web = await webTruths(edited(EDITED), PHONE_DOCUMENT, uploadedAfterEdit);
    expect(phone[0].schedule.find(task => task.taskId === 'm1-3')?.updatedAt).toBe(EDITED);
    expect(web[0].schedule.find(task => task.taskId === 'm1-3')?.updatedAt).toBe(EDITED);
    expect(differingPaths(phone[0], web[0])).toEqual([]);
    expect(buildDAVEReportSourceFingerprint(web)).toBe(buildDAVEReportSourceFingerprint(phone));
  });

  it('also when the cloud\'s row carries the very same time as the edit: it is the task\'s own time, not the cloud\'s standing in', async () => {
    const atTheSameInstant = (item: ScheduleItem) => item.updatedAt ?? UPLOADED(item);
    const snapshot = await webSnapshot(edited(EDITED), PHONE_DOCUMENT, atTheSameInstant);
    // (the rig) For the edited task the web holds one and the same time twice: the task's own and the row's.
    expect(snapshot.scheduleItems.filter(item => item.id === 'm1-3').map(item => [item.updatedAt, item.cloudUpdatedAt])).toEqual([[EDITED, EDITED]]);
    const web = buildDAVEWebReportTruths(snapshot, 'Alpha');
    expect(web[0].schedule.find(task => task.taskId === 'm1-3')?.updatedAt).toBe(EDITED);
    expect(buildDAVEReportSourceFingerprint(web)).toBe(buildDAVEReportSourceFingerprint(deviceTruths(edited(EDITED), PHONE_DOCUMENT)));
  });

  it('a task edited in this browser tab since its row was read is read by that edit, though its row had no time of its own', async () => {
    const snapshot = await webSnapshot(ITEMS, PHONE_DOCUMENT);
    const editedHere = <T extends { id: string }>(items: readonly T[]) => items.map(item => (item.id === 'm1-3' ? { ...item, updatedAt: EDITED } : item));
    const afterTheEdit = { ...snapshot, scheduleItems: editedHere(snapshot.scheduleItems), knownScheduleItems: editedHere(snapshot.knownScheduleItems ?? []) } as DAVEWebReadOnlySnapshot;
    expect(buildDAVEWebReportTruths(afterTheEdit, 'Alpha')[0].schedule.find(task => task.taskId === 'm1-3')?.updatedAt).toBe(EDITED);
  });

  it('guard: another edit time is another fact: the fingerprint moves on both', async () => {
    const later = '2026-09-29T17:00:00.000Z';
    expect(buildDAVEReportSourceFingerprint(deviceTruths(edited(later), PHONE_DOCUMENT))).not.toBe(buildDAVEReportSourceFingerprint(deviceTruths(edited(EDITED), PHONE_DOCUMENT)));
    expect(buildDAVEReportSourceFingerprint(await webTruths(edited(later), PHONE_DOCUMENT, uploadedAfterEdit)))
      .not.toBe(buildDAVEReportSourceFingerprint(await webTruths(edited(EDITED), PHONE_DOCUMENT, uploadedAfterEdit)));
  });

  it('"Last updated" under Completed Work: the edit\'s day on both; for a task nobody edited, the day it was saved, never the day of an upload', async () => {
    const lastUpdated = (truths: DAVEProjectTruth[]) => [...buildDAVEReportBriefing({ truths, selectedProjectNames: ['Alpha'], previousSnapshot: null }).completedWork];
    const day = (moment: string) => new Date(moment).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    expect(lastUpdated(deviceTruths(edited(EDITED), PHONE_DOCUMENT))).toEqual([`Framing (Lot): Complete; 100% complete. Last updated ${day(EDITED)}.`]);
    expect(lastUpdated(await webTruths(edited(EDITED), PHONE_DOCUMENT, uploadedAfterEdit))).toEqual([`Framing (Lot): Complete; 100% complete. Last updated ${day(EDITED)}.`]);
    // Nobody edited it, and a device uploaded its row again nine days after the import.
    const uploadedLate = () => '2026-09-29T20:00:00.000Z';
    expect(lastUpdated(deviceTruths(ITEMS, PHONE_DOCUMENT))).toEqual([`Framing (Lot): Complete; 100% complete. Last updated ${day(IMPORTED)}.`]);
    expect(lastUpdated(await webTruths(ITEMS, PHONE_DOCUMENT, uploadedLate))).toEqual([`Framing (Lot): Complete; 100% complete. Last updated ${day(IMPORTED)}.`]);
    // (It read on the web: "Last updated Sep 29, 2026.")
  });
});

describe('R7 item C: what version 2.0 leaves out, and that no written report can differ for it', () => {
  const PAGE = { pageNumber: 1, text: 'MASTER SCHEDULE page 1: Paint, Drywall, Framing.', regions: [] };
  const LEFT_OUT: Array<[string, Record<string, unknown>]> = [
    ['uri (where the file sits on this device)', { uri: 'file:///somewhere/else/doc-m1.csv' }],
    ['cloudUpdatedAt (the device\'s note of the cloud row)', { cloudUpdatedAt: '2026-09-30T09:00:00.000Z' }],
    ['cloudDetailsSeen (the same)', { cloudDetailsSeen: '2026-09-30T09:00:00.000Z' }],
    ['linkedScheduleItems (the web\'s list for a delete)', { linkedScheduleItems: [{ id: 'm1-1', cloudUpdatedAt: '2026-09-30T09:00:00.000Z' }] }],
    ['importedScheduleItemCount (the web\'s count for Make Current)', { importedScheduleItemCount: 7 }],
    ['lookaheadReplaced (the web\'s label)', { lookaheadReplaced: 'Replaced by the lookahead of Oct 1, 2026' }],
    ['extractedText (the text read out of the file)', { extractedText: 'MASTER SCHEDULE. Paint. Drywall. Framing.' }],
    ['extractedPages (its page index)', { extractedPages: [PAGE] }],
    ['extractionStatus (how the reading went)', { extractionStatus: 'complete' }],
    ['storagePath (where the cloud keeps the file)', { storagePath: 'owner-1/doc-m1/another-path.csv' }],
    ['sizeBytes', { sizeBytes: 20480 }],
    ['contentSha256', { contentSha256: 'a'.repeat(64) }],
    ['mimeType', { mimeType: 'application/pdf' }],
    ['updatedAt (when the document\'s own record was last saved)', { updatedAt: '2026-09-30T09:00:00.000Z' }],
    ['webVersionGroupId (the web\'s version mark)', { webVersionGroupId: 'group-7' }],
  ];
  it.each(LEFT_OUT)('%s: the fingerprint and the written report are the same with it changed; the truth a report is written from does not hold it', (_what, change) => {
    const plain = deviceTruths(ITEMS, PHONE_DOCUMENT);
    const changed = deviceTruths(ITEMS, { ...PHONE_DOCUMENT, ...change } as ReferenceDocument);
    expect(buildDAVEReportSourceFingerprint(changed)).toBe(buildDAVEReportSourceFingerprint(plain));
    expect(written(changed, ITEMS)).toBe(written(plain, ITEMS));
    const held = changed[0].intelligence.referenceDocuments[0] as ReferenceDocument & Record<string, unknown>;
    const field = Object.keys(change)[0];
    expect(field === 'uri' ? held.uri : field in held).toBe(field === 'uri' ? '' : false);
    // Version 1.0 is untouched: Build 230 had it in, and it still moves the 1.0 fingerprint.
    expect(buildDAVELegacyReportSourceFingerprint(changed)).not.toBe(buildDAVELegacyReportSourceFingerprint(plain));
  });

  it('all a report\'s truth holds of a schedule document: which one it is, its names, category, notes, import time and whose schedule it is', () => {
    const [truth] = deviceTruths(ITEMS, PHONE_DOCUMENT);
    expect(truth.intelligence.referenceDocuments).toEqual([{
      id: 'doc-m1', name: 'MASTER M1', originalFileName: 'MASTER M1.csv', category: 'Schedules', notes: '', importedAt: IMPORTED, isCurrent: true,
      projectId: 'report:alpha', projectName: 'Alpha', projectNames: ['Alpha'], importBatchId: 'batch-m1', uri: '',
    }]);
    // The truth as Build 230 built it keeps the document whole.
    expect(daveProjectTruthAsBuilt(truth).intelligence.referenceDocuments[0]).toMatchObject({ uri: PHONE_DOCUMENT.uri, storagePath: 'owner-1/doc-m1/MASTER-M1.csv' });
  });

  it('a field saved as "none" by one device and left out by another is one and the same', () => {
    const { mimeType: _m, sizeBytes: _s, contentSha256: _c, ...without } = PHONE_DOCUMENT as ReferenceDocument & Record<string, unknown>;
    expect(PHONE_DOCUMENT.mimeType).toBeNull();
    expect(buildDAVEReportSourceFingerprint(deviceTruths(ITEMS, without as unknown as ReferenceDocument))).toBe(buildDAVEReportSourceFingerprint(deviceTruths(ITEMS, PHONE_DOCUMENT)));
  });

  it('and so are an empty list and no list, a role of none and no role, on a fact the truth does hold', () => {
    const plain = buildDAVEReportSourceFingerprint(deviceTruths(ITEMS, PHONE_DOCUMENT));
    expect('retiredForProjectNames' in PHONE_DOCUMENT || 'scheduleRole' in PHONE_DOCUMENT).toBe(false);
    expect(buildDAVEReportSourceFingerprint(deviceTruths(ITEMS, { ...PHONE_DOCUMENT, retiredForProjectNames: [] } as ReferenceDocument))).toBe(plain);
    expect(buildDAVEReportSourceFingerprint(deviceTruths(ITEMS, { ...PHONE_DOCUMENT, scheduleRole: null } as unknown as ReferenceDocument))).toBe(plain);
  });

  it('one phone, the session that read the file and the next launch (the text index is whole, then emptied): one fingerprint; and the web, from the row as the upload cut it down', async () => {
    const justRead = { ...PHONE_DOCUMENT, extractedText: 'MASTER SCHEDULE. Paint. Drywall. Framing.', extractedPages: [PAGE], extractionStatus: 'complete' } as unknown as ReferenceDocument;
    const nextLaunch = { ...justRead, extractedText: null, extractedPages: [] } as unknown as ReferenceDocument;
    const read = buildDAVEReportSourceFingerprint(deviceTruths(ITEMS, justRead));
    expect(buildDAVEReportSourceFingerprint(deviceTruths(ITEMS, nextLaunch))).toBe(read);
    expect(read).toBe(buildDAVEReportSourceFingerprint(deviceTruths(ITEMS, PHONE_DOCUMENT)));
    const snapshot = await webSnapshot(ITEMS, justRead);
    // (the rig) The cloud's row is not the phone's copy: the upload emptied the document's text.
    expect((snapshot.referenceDocuments[0] as ReferenceDocument).extractedText ?? null).toBeNull();
    expect(buildDAVEReportSourceFingerprint(buildDAVEWebReportTruths(snapshot, 'Alpha'))).toBe(read);
  });

  it('the cloud row\'s time on a task nobody edited (the web): the same, and the truth as Build 230 built it still has it', async () => {
    const snapshot = await webSnapshot(ITEMS, PHONE_DOCUMENT);
    const later = await webSnapshot(ITEMS, PHONE_DOCUMENT, item => new Date(Date.parse(UPLOADED(item)) + 86_400_000).toISOString());
    const [first, second] = [buildDAVEWebReportTruths(snapshot, 'Alpha'), buildDAVEWebReportTruths(later, 'Alpha')];
    expect(buildDAVEReportSourceFingerprint(second)).toBe(buildDAVEReportSourceFingerprint(first));
    expect(written(second, later.scheduleItems)).toBe(written(first, snapshot.scheduleItems));
    expect(buildDAVEWebReportDraft(later, 'Alpha', { previousSnapshot: null, waitingForOtherDevice: false }).completedWork)
      .toEqual(buildDAVEWebReportDraft(snapshot, 'Alpha', { previousSnapshot: null, waitingForOtherDevice: false }).completedWork);
    expect(daveProjectTruthAsBuilt(first[0]).schedule.map(task => task.updatedAt).sort()).toEqual(ITEMS.map(UPLOADED).sort());
    expect(buildDAVELegacyReportSourceFingerprint(second)).not.toBe(buildDAVELegacyReportSourceFingerprint(first));
  });

  it.each([
    ['its name', { name: 'MASTER M1 rev B' }],
    ['its file\'s name', { originalFileName: 'MASTER M1 rev B.csv' }],
    ['its notes', { notes: 'Issued for construction.' }],
    ['when it was imported', { importedAt: '2026-09-21T15:00:00.000Z' }],
    ['its category', { category: 'Specifications' }],
    ['that it is a lookahead', { scheduleRole: 'lookahead' }],
  ])('guard: a fact of the document still moves the fingerprint: %s', (_what, change) => {
    expect(buildDAVEReportSourceFingerprint(deviceTruths(ITEMS, { ...PHONE_DOCUMENT, ...change } as ReferenceDocument)))
      .not.toBe(buildDAVEReportSourceFingerprint(deviceTruths(ITEMS, PHONE_DOCUMENT)));
  });

  it('guard: and every fact of a task: its percent, a date, a note typed on it', () => {
    const plain = buildDAVEReportSourceFingerprint(deviceTruths(ITEMS, PHONE_DOCUMENT));
    const withTask = (change: Partial<ScheduleItem>) => buildDAVEReportSourceFingerprint(deviceTruths(ITEMS.map(item => (item.id === 'm1-1' ? { ...item, ...change } as ScheduleItem : item)), PHONE_DOCUMENT));
    expect(withTask({ percentComplete: 40, status: 'In Progress' })).not.toBe(plain);
    expect(withTask({ finishDate: '10/12/2026' })).not.toBe(plain);
    expect(withTask({ activity: [{ id: 'note-1', message: 'Primer on site.', author: 'David', createdAt: '2026-09-30T16:00:00.000Z' }] } as Partial<ScheduleItem>)).not.toBe(plain);
  });
});

describe('R7 item C: version 1.0 is still what Build 230 wrote, to the byte', () => {
  /** Build 230's own lines for a report's truth (screens/ReportsScreen.tsx and the web's, before the one recipe), from the tasks and documents each device holds. */
  const asBuild230Built = (shown: readonly ScheduleItem[], known: readonly ScheduleItem[], documents: readonly ReferenceDocument[], projectId: string, listed = documents) => buildDAVEProjectTruth({
    projectId, projectName: 'Alpha', updates: [], scheduleItems: [...shown], knownScheduleItems: [...known], knownScheduleDocuments: [...documents],
    reportLookaheadReplacement: true, projectAreas: [], referenceDocuments: listed.map(document => ({ ...document, projectId, projectName: 'Alpha' })), now: NOW,
  });

  it('on the phone: the 1.0 fingerprint is of the truth with the document whole, as Build 230 hashed it', () => {
    const truths = deviceTruths(ITEMS, PHONE_DOCUMENT);
    const shown = selectAuthoritativeScheduleItems({ scheduleItems: ITEMS, scheduleDocuments: [PHONE_DOCUMENT] }) as ScheduleItem[];
    expect(buildDAVELegacyReportSourceFingerprint(truths)).toBe(buildDAVELegacyReportSourceFingerprint([asBuild230Built(shown, ITEMS, [PHONE_DOCUMENT], 'report:alpha')]));
    expect(buildDAVELegacyReportSourceFingerprint(truths)).toBe(BUILD_230.phone);
    // R10 (the coordinator's decision on review pass 3, P3-2): worked out to the byte still, and no longer a name of
    // today's facts. This line said the Build 230 report was known by it.
    expect(sameReportSource(BUILD_230.phone, buildDAVEReportSourceFingerprint(truths))).toBe(false);
  });

  it('on the web: of the truth from the loader\'s own tasks and documents, the cloud\'s row times and the web\'s fields in it', async () => {
    const snapshot = await webSnapshot(ITEMS, PHONE_DOCUMENT);
    const truths = buildDAVEWebReportTruths(snapshot, 'Alpha');
    expect(buildDAVELegacyReportSourceFingerprint(truths)).toBe(buildDAVELegacyReportSourceFingerprint([
      asBuild230Built(snapshot.scheduleItems, snapshot.knownScheduleItems ?? [], snapshot.referenceDocuments, 'project-alpha-id'),
    ]));
    expect(buildDAVELegacyReportSourceFingerprint(truths)).toBe(BUILD_230.web);
    // R10: to the byte still, and no longer a name of today's facts (as on the phone, above).
    expect(sameReportSource(BUILD_230.web, buildDAVEReportSourceFingerprint(truths))).toBe(false);
    // The phone's and the web's 1.0 fingerprints never agreed, and still do not: a phone's 1.0 report is not known on the web (R4's own limit).
    expect(BUILD_230.web).not.toBe(BUILD_230.phone);
  });
});

/** What the code before this change works out as the 1.0 fingerprint of this file's saved project, on the phone and on the web: printed there by this same rig. */
const BUILD_230 = { phone: 'dave-report-source/1.0:84bd564e', web: 'dave-report-source/1.0:a6b4c866' };
