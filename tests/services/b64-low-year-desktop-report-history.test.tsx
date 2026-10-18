/**
 * N761e (open item 7.61, the computer's half; 15 Oct 2026, Build 233 on the phone, the iPad and the computer).
 *
 * The phone sent the project's report; the iPad said "Your other device already sent this report" (its fingerprint of
 * the report was the phone's), the computer did not: it counted the next report from the send and offered Approve.
 * The shared record was right, so the computer worked out the report's facts differently from the same cloud rows.
 *
 * A differential test: the same records, written as the cloud rows the phone uploads, are read (a) as the iPad reads
 * them (App.tsx's own normalizers on every download, the App's scope for the report, then the Reports screen's call)
 * and (b) as the computer reads them (its own loader, then its Reports page's truths); both work out the report on
 * the same period (the phone's send, counted from the report before). What differed:
 *  1. A DOCUMENT BOUND TO THE PROJECT'S CLOUD ID (a schedule shared from a Documents card, a file added on the
 *     computer): the phone's Reports screen knows the report's projects by name only and leaves it out; the computer
 *     knew them by their cloud ids and kept it, and printed "<Category> document added: <name>." in What changed for
 *     14 days after it was added. Every phone and iPad agree (both leave it out).
 *  2. A TASK WHOSE ROW HOLDS ITS DATES IN ANOTHER WORDING ("2026-11-05", "Nov 5, 2026": the computer's own edits,
 *     earlier imports): every phone and iPad re-word it as 11/05/2026 when they download it; the computer kept it.
 *  3. AN IMPORTED NOTE as an import wrote it: the phone cleans it when it downloads it; the computer kept it.
 * The computer now builds the report the phone's way, in the phone's two steps, from tasks as the phone holds them.
 * Nothing on the phone changes. Made-up names and records. No network.
 */
jest.mock('@react-native-async-storage/async-storage', () => {
  const values = new Map<string, string>();
  const api = {
    getItem: jest.fn(async (k: string) => values.get(k) ?? null), setItem: jest.fn(async (k: string, v: string) => { values.set(k, v); }),
    removeItem: jest.fn(async (k: string) => { values.delete(k); }), getAllKeys: jest.fn(async () => [...values.keys()]),
    multiGet: jest.fn(async (keys: string[]) => keys.map(k => [k, values.get(k) ?? null])), multiSet: jest.fn(async () => undefined), multiRemove: jest.fn(async () => undefined),
  };
  return { __esModule: true, default: api, ...api };
});
// App.tsx's own normalizers are imported: its native modules are stood in for (as tests/app-shell-smoke does).
jest.mock('expo-audio', () => ({ RecordingPresets: { HIGH_QUALITY: {} }, requestRecordingPermissionsAsync: jest.fn(), setAudioModeAsync: jest.fn(), useAudioRecorder: () => ({}), useAudioRecorderState: () => ({}), useAudioPlayer: () => ({}), useAudioPlayerStatus: () => ({}), AudioModule: {} }));
jest.mock('expo-contacts', () => ({ Fields: {} }));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn() }));
jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }));
jest.mock('expo-image-picker', () => ({ MediaTypeOptions: {} }));
jest.mock('expo-location', () => ({ Accuracy: { Balanced: 3, High: 4 } }));
jest.mock('expo-mail-composer', () => ({ MailComposerStatus: {} }));
jest.mock('expo-sharing', () => ({}));
jest.mock('expo-sms', () => ({}));
jest.mock('expo-linear-gradient', () => ({ LinearGradient: () => null }));
jest.mock('expo-file-system/legacy', () => ({ documentDirectory: 'file:///docs/', cacheDirectory: 'file:///cache/', getInfoAsync: jest.fn(async () => ({ exists: true })), makeDirectoryAsync: jest.fn() }));
const mockRows: { rows: unknown } = { rows: null };
jest.mock('../../services/DAVEWebSupabaseClient', () => ({ ...jest.requireActual('../../services/DAVEWebSupabaseClient'), daveWebSupabaseGateway: { ...jest.requireActual('../../services/DAVEWebSupabaseClient').daveWebSupabaseGateway, loadAuthorizedRows: async () => mockRows.rows } }));

import { normalizeScheduleItem, normalizeUpdate } from '../../App';
import { loadDAVEWebReadOnlySnapshot } from '../../services/DAVEWebReadOnlyRepository';
import { buildDAVEWebReportDraft, buildDAVEWebReportTruths, daveWebScheduleItemAsThePhoneHoldsIt } from '../../services/DAVEWebOperations';
import { buildDAVEReportProjectTruths } from '../../services/DAVEReportProjectTruths';
import { buildCombinedReportAuthorityScope, buildDailyReportAuthorityScope } from '../../services/ReportAuthorityScope';
import { selectAuthoritativeScheduleItems } from '../../services/PIEScheduleReconciliation';
import { isDAVESafeCloudScheduleRecord, reconcileDAVEScheduleRecords } from '../../services/DAVEScheduleRecovery';
import { normalizeReferenceDocuments } from '../../services/ReferenceDocumentRepository';
import { buildDAVEReportBriefing, buildDAVEReportSourceOnPeriod } from '../../services/DAVEReportIntelligence';
import { buildDAVEReportSnapshot, daveReportSnapshotScopeKey, markReportSnapshotDelivered, reportBaselineSnapshot, reportSnapshotToSave, type DAVEReportSnapshot } from '../../services/DAVEReportSnapshot';
import { referenceDocumentsCitedAsListed, withoutListedPageIndexes } from '../../services/ECOSDocumentIndexPersistence';
import { scheduleSavedTasksOfProjects } from '../../services/ScheduleTaskRevisions';
import { partitionProjectUpdatesByDeletedTask } from '../../services/DAVEDeletedTaskEvidence';
import type { ScheduleItem } from '../../types';

const P1 = { id: '3e9b5c1a-7d2f-4a60-8b14-6c0e2f9a1d57', name: 'Harbor Point' };
const P2 = { id: '6a1f0c2e-9b3d-4e75-a8c6-0d4b7e2f1a93', name: 'Maple Court' };
const DAY = 86_400_000;
/** 15 Oct 2026, 1:50 PM in New York: just before the phone's send. */
const T0 = Date.parse('2026-10-15T17:50:00.000Z');
const isoAt = (days: number) => new Date(T0 + days * DAY).toISOString();
const usDay = (days: number) => { const date = new Date(T0 + days * DAY); return `${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}/${date.getFullYear()}`; };
type Format = 'project_manager' | 'executive';

type World = {
  projects: { id: string; name: string }[];
  tasks: ScheduleItem[];
  updates: ReturnType<typeof normalizeUpdate>[];
  documents: ReturnType<typeof normalizeReferenceDocuments>;
  areas: Record<string, unknown>[];
  tombstones: { entity_type: string; record_id: string; deleted_at: string }[];
};

/** Records as the phone holds them: made with App.tsx's own normalizers, as the phone saves them. */
function onThePhone(input: { projects?: World['projects']; tasks?: unknown[]; updates?: unknown[]; documents?: unknown[]; areas?: World['areas']; tombstones?: World['tombstones'] }): World {
  return {
    projects: input.projects ?? [P1],
    tasks: (input.tasks ?? []).map(item => normalizeScheduleItem(item as Partial<ScheduleItem>)),
    updates: (input.updates ?? []).map(item => normalizeUpdate(item as never)),
    documents: normalizeReferenceDocuments(input.documents ?? []),
    areas: input.areas ?? [],
    tombstones: input.tombstones ?? [],
  };
}

/** The cloud rows of those records, as the phone uploads them (SupabaseService upsertScheduleItem, saveProjectUpdate, upsertReferenceDocument). */
function rowsOf(world: World, rowTime = isoAt(-0.05), rewrite: (row: { item_data?: any; update_data?: any; document_data?: any }) => void = () => undefined) {
  const json = (value: unknown) => JSON.parse(JSON.stringify(value));
  const rows = {
    projects: world.projects.map(project => ({ id: project.id, name: project.name, status: 'Active', archived: false, is_favorite: false, created_at: '2026-09-01T00:00:00.000Z', updated_at: rowTime, owner_id: 'owner-1', project_data: null })),
    scheduleItems: world.tasks.map(item => ({ id: item.id, owner_id: 'owner-1', project_id: (item as any).projectId, project_name: item.projectName, task_name: item.taskName, item_data: json(item), created_at: rowTime, updated_at: rowTime })),
    projectUpdates: world.updates.map(update => ({ id: update.id, project_id: (update as any).projectId, project_name: update.projectName || 'Unassigned Project', area_name: update.selectedAreaName || '', idempotency_key: update.id, update_data: json(update), created_at: update.date, updated_at: rowTime, owner_id: 'owner-1' })),
    referenceDocuments: world.documents.map(document => ({ id: document.id, updated_at: rowTime, document_data: json(document) })),
    syncTombstones: world.tombstones,
    projectAreas: world.areas,
  };
  [...rows.scheduleItems, ...rows.projectUpdates, ...rows.referenceDocuments].forEach(rewrite);
  return rows;
}
type Rows = ReturnType<typeof rowsOf>;

/** What the iPad holds once it has downloaded the rows (App.tsx's refresh: safe tasks only, its normalizers, deletions). */
function downloaded(rows: Rows) {
  const deleted = (type: string) => new Set(rows.syncTombstones.filter(row => row.entity_type === type).map(row => row.record_id));
  const deletedTasks = deleted('schedule_item');
  const deletedDocuments = deleted('reference_document');
  return {
    projects: rows.projects.map(project => ({ id: project.id, name: project.name })),
    tasks: reconcileDAVEScheduleRecords(rows.scheduleItems.map(row => ({ ...row.item_data, id: row.id })).filter(isDAVESafeCloudScheduleRecord)
      .map(item => normalizeScheduleItem(item)).filter(item => item.taskName.trim() && !deletedTasks.has(item.id))),
    updates: rows.projectUpdates.map(row => normalizeUpdate(row.update_data)),
    documents: normalizeReferenceDocuments(rows.referenceDocuments.map(row => ({ ...row.document_data, id: row.id, cloudUpdatedAt: row.updated_at })).filter(document => !deletedDocuments.has(document.id))),
    areas: rows.projectAreas,
    tombstones: rows.syncTombstones.map(row => ({ entityType: row.entity_type, recordId: row.record_id, deletedAt: row.deleted_at })),
  };
}

/** (a) The phone's Reports screen: App.tsx liveAuthorityInput (its scope for the report), then ReportsScreen.tsx reportTruths. */
function phoneTruths(records: ReturnType<typeof downloaded>, names: readonly string[] = [P1.name]) {
  const authoritative = selectAuthoritativeScheduleItems({ scheduleItems: records.tasks, scheduleDocuments: records.documents } as never) as unknown as ScheduleItem[];
  const active = partitionProjectUpdatesByDeletedTask(records.updates, records.tombstones as never, update => update, { scheduleItems: records.tasks } as never).active.filter(update => !update.isArchived);
  const input = { selectedProjectNames: names, projectRecords: records.projects, updates: active, scheduleItems: authoritative, currentUpdate: null, projectAreas: records.areas as never, knownScheduleItems: records.tasks, referenceDocuments: records.documents, projectDocuments: [], captureMemories: [], contacts: { contacts: [] } as never };
  const scope = names.length === 1 ? buildDailyReportAuthorityScope({ ...input, selectedProjectName: names[0] }) : buildCombinedReportAuthorityScope(input);
  return buildDAVEReportProjectTruths({
    projects: names.map(name => ({ name, projectId: `report:${name.toLowerCase()}` })),
    projectRecords: names.map(name => ({ name })),
    updates: scope.updates,
    scheduleItems: scope.scheduleItems,
    knownScheduleItems: scheduleSavedTasksOfProjects(records.tasks, scope.scheduleItems, scope.projectNames),
    knownScheduleDocuments: records.documents,
    projectAreas: scope.projectAreas,
    referenceDocuments: withoutListedPageIndexes([...scope.referenceDocuments]),
    drawingDocuments: referenceDocumentsCitedAsListed([...scope.referenceDocuments]),
  });
}

/** (b) The computer's Reports page: its own loader over the rows, then its truths. */
async function computerSnapshot(rows: Rows) {
  mockRows.rows = rows;
  return loadDAVEWebReadOnlySnapshot();
}

const useClock = (ms: number) => jest.useFakeTimers({ now: ms, doNotFake: ['nextTick', 'setImmediate', 'setInterval', 'setTimeout', 'clearTimeout', 'clearInterval', 'queueMicrotask'] });
afterEach(() => jest.useRealTimers());

function sendOf(truths: ReturnType<typeof phoneTruths>, previous: DAVEReportSnapshot | null, at: string, format: Format, names: readonly string[]) {
  const fingerprint = buildDAVEReportSourceOnPeriod(truths, previous, format).fingerprint;
  const current = buildDAVEReportSnapshot({ truths, scopeKey: daveReportSnapshotScopeKey(names), sourceFingerprint: fingerprint, capturedAt: truths.map(truth => truth.generatedAt).sort().at(-1), reportFormat: format });
  return { fingerprint, sent: markReportSnapshotDelivered(reportSnapshotToSave(current, previous) ?? previous!, at, 'phone-install') };
}

/**
 * Oct 14: the phone sends the report of `before`. Oct 15, 1:52 PM: the phone (as every device that downloaded the
 * rows) sends the report of `after`, counted from Oct 14. The computer reads `after`'s rows (or `computerRows`).
 */
async function theSend(before: Rows, after: Rows, format: Format = 'project_manager', all = false, computerRows: Rows = after) {
  const names = all ? after.projects.map(project => project.name) : [P1.name];
  useClock(T0 - DAY);
  const oct14 = sendOf(phoneTruths(downloaded(before), names), null, isoAt(-0.99), format, names).sent;
  useClock(T0);
  const phone = phoneTruths(downloaded(after), names);
  const { fingerprint, sent } = sendOf(phone, oct14, isoAt(0.0014), format, names);
  const snapshot = await computerSnapshot(computerRows);
  const computer = buildDAVEWebReportTruths(snapshot, all ? null : P1.name);
  const computerFingerprint = buildDAVEReportSourceOnPeriod(computer, sent, format).fingerprint;
  const countedFrom = reportBaselineSnapshot(sent, sent.sourceFingerprint);
  const result = {
    phoneSent: fingerprint,
    computer: computerFingerprint,
    /** The phone (or the iPad) holding the computer's rows, on the same period. */
    phoneOnTheComputersRows: buildDAVEReportSourceOnPeriod(phoneTruths(downloaded(computerRows), names), sent, format).fingerprint,
    phoneWhatChanged: buildDAVEReportBriefing({ truths: phone, previousSnapshot: countedFrom }).whatChanged,
    computerWhatChanged: buildDAVEWebReportDraft(snapshot, all ? null : P1.name, { previousSnapshot: countedFrom, waitingForOtherDevice: false }).whatChanged,
  };
  jest.useRealTimers();
  return result;
}

// ---------------------------------------------------------------------------------------------------------------
// The records: the live project's shapes (made-up names), and random ones.
// ---------------------------------------------------------------------------------------------------------------
const task = (over: Record<string, unknown>) => ({
  projectId: P1.id, projectName: P1.name, scheduleProjectName: P1.name, owner: '', contractor: '', milestone: '', notes: '', nextAction: '',
  priority: 'Medium', status: 'Not Started', percentComplete: 0, createdAt: isoAt(-14), ...over,
});
const photo = (id: string, caption: string, area: string | null, over: Record<string, unknown> = {}) => ({
  id, uri: `file:///docs/photos/${id}.jpg`, caption, category: 'Update', actionRequired: '', actionOwner: '', actionDueDate: '', actionStatus: 'Open',
  fileName: `${id}.jpg`, mimeType: 'image/jpeg', cloudStoragePath: `owner-1/${id}.jpg`, selectedAreaName: area, ...over,
});
const update = (over: Record<string, unknown>) => ({ projectId: P1.id, projectName: P1.name, scheduleProjectName: P1.name, status: 'sent', recipients: { contactIds: [] }, photos: [], ...over });
const document = (over: Record<string, unknown>) => ({ projectId: P1.id, projectName: P1.name, projectNames: [P1.name], mimeType: 'application/pdf', notes: '', isCurrent: false, ...over });


const webGoldens:Record<string,string>=require('../fixtures/b64-desktop-low-year-legacy.json');
import {buildDAVELegacyReportSourceFingerprint} from '../../services/DAVEReportIntelligence';
it.each(['0100','0202','0999','2000','2100','26','202','iso-0100','iso-0202','iso-0999','canonical-0202'])('B64 actual desktop authorized-row raw history for %s',async year=>{
 useClock(T0);const start=year==='canonical-0202'?'05/01/0202':year.startsWith('iso-')?year.slice(4)+'-05-01':`5/1/${year}`;const finish=year==='canonical-0202'?'05/04/0202':year.startsWith('iso-')?year.slice(4)+'-05-04':`5/4/${year}`;
 const rows=rowsOf(onThePhone({tasks:[task({id:'year-task',taskName:'Inspect canopy',locationName:'Court',startDate:'05/01/2026',finishDate:'05/04/2026',updatedAt:isoAt(-1)})]}),isoAt(-1),row=>{if(row.item_data){row.item_data.startDate=start;row.item_data.finishDate=finish;}});
 const snapshot=await computerSnapshot(rows);const truths=buildDAVEWebReportTruths(snapshot,P1.name);console.log('B64_WEB_RAW_HISTORY '+JSON.stringify({year,fingerprint:buildDAVELegacyReportSourceFingerprint(truths),shown:truths[0].schedule.map(t=>[t.startDate,t.finishDate])}));expect(buildDAVELegacyReportSourceFingerprint(truths)).toBe(webGoldens[year]);
});
