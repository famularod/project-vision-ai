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

/**
 * The live project's shapes: hand-made tasks in Level 2 (overdue) and with no area (made on the phone today, due in 30
 * days); schedule tasks Paint (Site, 70%, Low, next action and notes, an activity note), Trim, Fence (complete,
 * verified); a full schedule just made current from the iPad (its tasks High); field updates with and without an area,
 * photos with captions, an action request, an edited note; prior schedule files, a schedule PDF card with no tasks and
 * another PDF (shared from Documents cards: bound to the project's cloud id); a lookahead deleted with its items.
 */
function liveProject(today = true, fenceVerified = true) {
  const D2 = 'doc-d2';
  const fromD2 = { importedFrom: 'D2.xlsx', importedAt: isoAt(-0.2), importBatchId: 'batch-d2', sourceDocumentId: D2, priority: 'High' };
  return onThePhone({
    tasks: [
      task({ id: 'l2-patch', taskName: 'Patch drywall', locationName: 'Level 2', startDate: usDay(-14), finishDate: usDay(-5), status: 'In Progress', percentComplete: 20, updatedAt: isoAt(-10) }),
      task({ id: 'l2-seal', taskName: 'Seal windows', locationName: 'Level 2', startDate: usDay(-12), finishDate: usDay(-3) }),
      ...(today ? [task({ id: 'no-area', taskName: 'No-area check', locationName: '', startDate: usDay(0), finishDate: usDay(30), createdAt: isoAt(-0.1), updatedAt: isoAt(-0.1) })] : []),
      task({ id: 's-paint', taskName: 'Paint', locationName: 'Site', startDate: usDay(-10), finishDate: usDay(15), status: 'In Progress', percentComplete: 70, ...fromD2, priority: 'Low',
        nextAction: 'Dana - Please order touch-up paint', notes: 'Second coat on the north wall', updatedAt: isoAt(-1),
        activity: [{ id: 'act-1', message: 'Primer done on the north wall', author: 'Dana', createdAt: isoAt(-2) }] }),
      task({ id: 's-trim', taskName: 'Trim', locationName: 'Site', startDate: usDay(5), finishDate: usDay(21), ...fromD2 }),
      task({ id: 's-fence', taskName: 'Fence', locationName: 'Site', startDate: usDay(-25), finishDate: usDay(-7), status: 'Complete', percentComplete: 100, ...fromD2,
        progressSource: 'project_manager', progressConfirmedAt: isoAt(-6), progressConfirmedBy: 'Dana',
        ...(fenceVerified ? { completionVerification: { status: 'pm_verified', reportedAt: isoAt(-7), reportedBy: 'Dana', priorScheduleStatus: 'In Progress', priorPercentComplete: 80, verifiedAt: isoAt(-6), verifiedBy: 'Dana', verificationNote: 'verified complete', evidence: [{ id: 'ev-1', type: 'field_update', recordId: 'u-fence', label: 'Fence photo', capturedAt: isoAt(-7) }] } } : {}) }),
    ],
    updates: [
      update({ id: 'u-patch', date: isoAt(-5), notes: 'Drywall patched at the stair', selectedAreaName: 'Level 2', scheduleItemId: 'l2-patch', scheduleTaskName: 'Patch drywall', photos: [photo('p1', 'Stair drywall', 'Level 2')] }),
      update({ id: 'u-noarea', date: isoAt(-4), notes: 'Loose debris by the gate', selectedAreaName: null, photos: [photo('p2', 'Loose debris', null)] }),
      ...(fenceVerified ? [update({ id: 'u-fence', date: isoAt(-7), notes: 'Fence done', selectedAreaName: 'Site', scheduleItemId: 's-fence', scheduleTaskName: 'Fence', photos: [photo('p3', 'Fence complete', 'Site')] })] : []),
      update({ id: 'u-ask', date: isoAt(-2), notes: 'Dana - Please confirm the paint color', selectedAreaName: 'Site', scheduleItemId: 's-paint', scheduleTaskName: 'Paint',
        photos: [photo('p4', 'Paint sample', 'Site', { category: 'Open Issue', actionRequired: 'Dana - Please confirm the paint color', actionOwner: 'Dana', actionDueDate: usDay(5) })] }),
      update({ id: 'u-edited', date: isoAt(-1), notes: 'Trim delivered (note edited after the report)', selectedAreaName: 'Site', photos: [] }),
      update({ id: 'u-lookahead', date: isoAt(-3), notes: 'Lookahead work', selectedAreaName: 'Site', scheduleItemId: 'lookahead-1', scheduleTaskName: 'Lookahead task', photos: [] }),
      ...(today ? [update({ id: 'u-today', date: isoAt(-0.15), notes: 'No area, no photo', selectedAreaName: 'Unassigned / Unknown Area', photos: [] })] : []),
    ],
    documents: [
      document({ id: D2, name: 'D2', originalFileName: 'D2.xlsx', category: 'Schedules', isCurrent: true, importedAt: isoAt(-0.2), importBatchId: 'batch-d2', scheduleRole: 'master' }),
      document({ id: 'doc-d1', name: 'D1', originalFileName: 'D1.xlsx', category: 'Schedules', importedAt: isoAt(-12), importBatchId: 'batch-d1', projectId: 'project-harbor-point' }),
      document({ id: 'doc-pdf', name: 'Schedule PDF', originalFileName: 'schedule.pdf', category: 'Schedules', importedAt: isoAt(-6) }),
      document({ id: 'doc-other', name: 'Site logistics', originalFileName: 'logistics.pdf', category: 'Other', importedAt: isoAt(-5) }),
    ],
    tombstones: [
      { entity_type: 'schedule_item', record_id: 'lookahead-1', deleted_at: isoAt(-1.5) },
      { entity_type: 'reference_document', record_id: 'doc-lookahead', deleted_at: isoAt(-1.5) },
    ],
  });
}

function rng(seed: number) { let state = seed >>> 0; return () => { state = (state * 1664525 + 1013904223) >>> 0; return state / 2 ** 32; }; }
/** A random owner's records (one or two projects, areas shared between them), and the same a day earlier. */
function randomWorld(seed: number): { before: World; after: World } {
  const r = rng(seed);
  const pick = <T,>(items: readonly T[]) => items[Math.floor(r() * items.length)];
  const chance = (p: number) => r() < p;
  const AREAS = ['Level 2', 'Site', 'Level 1', 'Roof'];
  const projects = chance(0.6) ? [P1, P2] : [P1];
  const tasks: Record<string, unknown>[] = [];
  const updates: Record<string, unknown>[] = [];
  const documents: Record<string, unknown>[] = [];
  const areas: World['areas'] = [];
  for (const project of projects) {
    const key = project === P1 ? 'a' : 'b';
    const bound = () => pick([{ projectId: project.id }, { projectId: project.id }, { projectId: `project-${project.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}` }, { projectId: null }, { projectId: null, projectName: null }]);
    const owned = { projectName: project.name, projectNames: [project.name] };
    documents.push(document({ ...owned, ...bound(), id: `doc-${key}-d2`, name: `${project.name} D2`, originalFileName: 'D2.xlsx', category: 'Schedules', isCurrent: true, importedAt: isoAt(-r() * 3), importBatchId: `batch-${key}-d2`, scheduleRole: 'master' }));
    if (chance(0.6)) documents.push(document({ ...owned, ...bound(), id: `doc-${key}-d1`, name: `${project.name} D1`, originalFileName: 'D1.xlsx', category: 'Schedules', importedAt: isoAt(-10), importBatchId: `batch-${key}-d1` }));
    if (chance(0.5)) documents.push(document({ ...owned, ...bound(), id: `doc-${key}-pdf`, name: 'Schedule PDF', originalFileName: 'schedule.pdf', category: 'Schedules', importedAt: isoAt(-r() * 5) }));
    if (chance(0.5)) documents.push(document({ ...owned, ...bound(), id: `doc-${key}-other`, name: 'Site logistics', originalFileName: 'logistics.pdf', category: 'Other', importedAt: isoAt(-r() * 20) }));
    const n = 2 + Math.floor(r() * 7);
    for (let i = 0; i < n; i += 1) {
      const percent = pick([0, 0, 20, 70, 100]);
      const finish = Math.round(-20 + r() * 60);
      tasks.push(task({
        id: `t-${key}-${i}`, projectId: project.id, projectName: project.name, scheduleProjectName: chance(0.9) ? project.name : undefined,
        taskName: `${pick(['Paint', 'Trim', 'Fence', 'Patch drywall', 'Seal windows', 'No-area check'])} ${i}`, locationName: chance(0.2) ? '' : pick(AREAS),
        startDate: usDay(finish - 10), finishDate: usDay(finish), status: percent === 100 ? 'Complete' : percent > 0 ? 'In Progress' : 'Not Started', percentComplete: percent,
        priority: pick(['Low', 'Medium', 'High']), owner: pick(['', 'Dana', 'Luis']), contractor: pick(['', 'Acme']),
        notes: chance(0.3) ? 'Second coat on the north wall' : '', nextAction: chance(0.3) ? 'Dana - Please order paint' : '',
        createdAt: isoAt(-15 + r() * 14), ...(chance(0.5) ? { updatedAt: isoAt(-r() * 5) } : {}),
        ...(chance(0.5) ? { importedFrom: 'D2.xlsx', importedAt: isoAt(-1), importBatchId: `batch-${key}-d2`, sourceDocumentId: `doc-${key}-d2` } : {}),
        ...(chance(0.2) ? { activity: [{ id: `act-${key}-${i}`, message: 'Primer done', author: 'Dana', createdAt: isoAt(-2) }] } : {}),
      }));
    }
    const m = Math.floor(r() * 8);
    for (let i = 0; i < m; i += 1) {
      const linked = chance(0.5) ? pick(tasks.filter(item => item.projectName === project.name)) : null;
      const mode = pick(['named', 'null', 'empty', 'missing', 'task', 'unknown']);
      const area = mode === 'named' ? pick(AREAS) : mode === 'task' ? (linked?.locationName as string) || null : mode === 'empty' ? '' : mode === 'null' ? null : mode === 'unknown' ? 'Unassigned / Unknown Area' : undefined;
      const photos = Array.from({ length: Math.floor(r() * 3) }, (_, j) => {
        const issue = chance(0.3);
        return photo(`p-${key}-${i}-${j}`, pick(['', 'Stair drywall', 'Paint sample']), area ?? null, issue ? { category: pick(['Open Issue', 'Safety Concern']), actionRequired: 'Dana - Please confirm the paint color', actionOwner: 'Dana', actionDueDate: usDay(5) } : {});
      });
      updates.push(update({ id: `u-${key}-${i}`, projectId: project.id, projectName: project.name, scheduleProjectName: chance(0.7) ? project.name : undefined, date: isoAt(-r() * 8),
        notes: pick(['Drywall patched at the stair', 'Dana - Please confirm the paint color', 'Trim delivered', '']), ...(area !== undefined ? { selectedAreaName: area } : {}),
        ...(linked ? { scheduleItemId: linked.id, scheduleTaskName: linked.taskName } : {}), photos, ...(chance(0.1) ? { isArchived: true, archivedAt: isoAt(-1) } : {}) }));
    }
    if (chance(0.4)) areas.push({ id: `area-${key}`, name: pick(AREAS), projectName: project.name, latitude: 40.1, longitude: -74.2, radiusFeet: 150, locationCapturedAt: isoAt(-9) });
  }
  const after = onThePhone({ projects, tasks, updates, documents, areas });
  const earlier = rng(seed * 7 + 3);
  const before: World = { ...after, tasks: after.tasks.filter(() => earlier() < 0.85).map(item => (earlier() < 0.2 ? { ...item, percentComplete: 0, status: 'Not Started' } : item)), updates: after.updates.filter(() => earlier() < 0.8) };
  return { before, after };
}

const DOCUMENT_ADDED = /document added: /;

describe('N761e: the computer works out the report the phone sent, from the same cloud rows', () => {
  it('the live project\'s shapes: the phone sends at 1:52 PM counted from Oct 14; the computer works out THAT report (so it says "already sent"), and both print the same What changed', async () => {
    // (A guard, green before N761e too: a task the project manager marked complete, Fence, puts "Fence was verified
    // complete." in What changed on both devices, and that line keeps the document line out of it, so the shapes as
    // described agree; the desktop page's test shows the document line when nothing keeps it out.)
    for (const fenceVerified of [true, false]) {
      for (const format of ['project_manager', 'executive'] as const) {
        const sent = await theSend(rowsOf(liveProject(false, fenceVerified)), rowsOf(liveProject(true, fenceVerified)), format);
        expect({ fenceVerified, format, computer: sent.computer }).toEqual({ fenceVerified, format, computer: sent.phoneSent });
        expect(sent.computerWhatChanged).toEqual(sent.phoneWhatChanged);
      }
    }
  });

  it('smallest case 1: one task, and the current schedule made current yesterday from a Documents card (bound to the project\'s cloud id): the phone leaves it out of its report, and now so does the computer', async () => {
    const world = onThePhone({
      tasks: [task({ id: 'paint', taskName: 'Paint', locationName: 'Site', startDate: usDay(-5), finishDate: usDay(10), status: 'In Progress', percentComplete: 40 })],
      documents: [document({ id: 'doc-d2', name: 'D2', originalFileName: 'D2.pdf', category: 'Schedules', isCurrent: true, importedAt: isoAt(-1) })],
    });
    const sent = await theSend(rowsOf(world), rowsOf(world));
    // (the rig) The phone's report has no line for it.
    expect(sent.phoneWhatChanged.filter(line => DOCUMENT_ADDED.test(line))).toEqual([]);
    // Before: the computer printed "Schedules document added: D2." in What changed and had another fingerprint.
    expect(sent.computerWhatChanged.filter(line => DOCUMENT_ADDED.test(line))).toEqual([]);
    expect(sent.computer).toBe(sent.phoneSent);
  });

  it('smallest case 2: a task whose row says its finish date as "2026-11-05" (the computer\'s own edit, an earlier import): read as every phone holds it, 11/05/2026', async () => {
    const world = onThePhone({ tasks: [task({ id: 'trim', taskName: 'Trim', locationName: 'Site', startDate: usDay(5), finishDate: usDay(21) })] });
    const isoDates = (row: { item_data?: any }) => { if (row.item_data) { row.item_data.startDate = '2026-10-20'; row.item_data.finishDate = '2026-11-05'; } };
    const sent = await theSend(rowsOf(world, isoAt(-0.05), isoDates), rowsOf(world, isoAt(-0.05), isoDates));
    expect(downloaded(rowsOf(world, isoAt(-0.05), isoDates)).tasks[0].finishDate).toBe('11/05/2026');
    expect(sent.computer).toBe(sent.phoneSent);
    // The same for every wording the phone re-words, and for none it keeps (App.tsx normalizeScheduleItem, to the letter).
    for (const wording of ['2026-11-05', '11/5/2026', '11-05-2026', 'Nov 5, 2026', 'November 5 2026', ' 11/05/2026 ', '2026-02-30', '02/30/2026', 'TBD', '', '2026-11-05T00:00:00Z']) {
      const row = { ...world.tasks[0], startDate: wording, finishDate: wording };
      const phone = normalizeScheduleItem(row);
      const computer = daveWebScheduleItemAsThePhoneHoldsIt(row);
      expect({ wording, start: computer.startDate, finish: computer.finishDate }).toEqual({ wording, start: phone.startDate, finish: phone.finishDate });
    }
  });

  it('smallest case 3: a task an import wrote with its import note: cleaned as every phone cleans it', async () => {
    const note = 'Imported from a structured Microsoft Project PDF; Activity ID: A1040. Duration: 5 days. verify highlighted fields before approval. Coordinate the north gate.';
    const world = onThePhone({ tasks: [task({ id: 'fence', taskName: 'Fence', locationName: 'Site', startDate: usDay(-2), finishDate: usDay(6), importedFrom: 'schedule.pdf', importedAt: isoAt(-3) })] });
    const importNote = (row: { item_data?: any }) => { if (row.item_data) row.item_data.notes = note; };
    const sent = await theSend(rowsOf(world, isoAt(-0.05), importNote), rowsOf(world, isoAt(-0.05), importNote));
    expect(downloaded(rowsOf(world, isoAt(-0.05), importNote)).tasks[0].notes).not.toBe(note);
    expect(sent.computer).toBe(sent.phoneSent);
    expect(daveWebScheduleItemAsThePhoneHoldsIt({ ...world.tasks[0], notes: note }).notes).toBe(normalizeScheduleItem({ ...world.tasks[0], notes: note }).notes);
  });

  it('random owners (one or two projects; documents bound by cloud id, by the old key, or by name; areas shared between projects): the computer works out the phone\'s report, in both formats and for all projects', async () => {
    const differ: string[] = [];
    for (let seed = 1; seed <= 40; seed += 1) {
      const { before, after } = randomWorld(seed);
      const cases: [Format, boolean][] = [['project_manager', false], ['executive', false], ...(after.projects.length > 1 ? [['project_manager', true] as [Format, boolean]] : [])];
      for (const [format, all] of cases) {
        // Some tasks written by the computer: their dates as the computer's own editor may keep them.
        const computerDates = seed % 3 === 0 ? (row: { item_data?: any }) => { if (row.item_data && /1$/.test(row.item_data.id)) { const [m, d, y] = String(row.item_data.finishDate).split('/'); row.item_data.finishDate = `${y}-${m}-${d}`; } } : undefined;
        const sent = await theSend(rowsOf(before, isoAt(-0.05), computerDates), rowsOf(after, isoAt(-0.05), computerDates), format, all);
        if (sent.computer !== sent.phoneSent) differ.push(`seed ${seed} ${format}${all ? ' all' : ''}`);
      }
    }
    expect(differ).toEqual([]);
  });
});

describe('N761e: the dangerous direction - a report whose facts changed never reads as the one sent', () => {
  /** The phone sends the report of `sentWorld`; then `change` reaches the cloud. Is the computer's report another one, and is it the phone's? */
  const changed = async (change: (world: World) => World, sentWorld = liveProject(), before = liveProject(false)) => {
    const sent = await theSend(rowsOf(before), rowsOf(sentWorld), 'project_manager', false, rowsOf(change(sentWorld)));
    return { computerMoved: sent.computer !== sent.phoneSent, sameAsThePhone: sent.computer === sent.phoneOnTheComputersRows };
  };
  const MOVED = { computerMoved: true, sameAsThePhone: true };
  it('after the send: a note reworded, a task\'s percent, a task\'s finish date, a new field update, a task added, a photo\'s caption: each is another report on the computer (the phone\'s)', async () => {
    expect(await changed(world => ({ ...world, updates: world.updates.map(item => (item.id === 'u-patch' ? { ...item, notes: 'Drywall patch FAILED inspection' } : item)) }))).toEqual(MOVED);
    expect(await changed(world => ({ ...world, tasks: world.tasks.map(item => (item.id === 's-paint' ? { ...item, percentComplete: 80 } : item)) }))).toEqual(MOVED);
    expect(await changed(world => ({ ...world, tasks: world.tasks.map(item => (item.id === 's-trim' ? { ...item, finishDate: usDay(22) } : item)) }))).toEqual(MOVED);
    expect(await changed(world => ({ ...world, updates: [...world.updates, normalizeUpdate(update({ id: 'u-new', date: isoAt(0.01), notes: 'Water ponding at the north drain', selectedAreaName: 'Site', photos: [photo('p9', 'Ponding', 'Site')] }) as never)] }))).toEqual(MOVED);
    expect(await changed(world => ({ ...world, tasks: [...world.tasks, normalizeScheduleItem(task({ id: 'new-task', taskName: 'Gutters', locationName: 'Roof', startDate: usDay(1), finishDate: usDay(9) }) as never)] }))).toEqual(MOVED);
    expect(await changed(world => ({ ...world, updates: world.updates.map(item => (item.id === 'u-fence' ? { ...item, photos: item.photos.map(entry => ({ ...entry, caption: 'Fence gate missing' })) } : item)) }))).toEqual(MOVED);
  });
  it('a current schedule the phone prints ("Schedules document added": bound by the project\'s name or its old key) made current after the send: another report on the computer, the phone\'s', async () => {
    const quiet = onThePhone({ tasks: [task({ id: 'paint', taskName: 'Paint', locationName: 'Site', startDate: usDay(-5), finishDate: usDay(10), status: 'In Progress', percentComplete: 40 })] });
    const added = (projectId: string | null) => changed(world => ({ ...world, documents: normalizeReferenceDocuments([document({ id: `doc-new-${projectId}`, name: 'D3', originalFileName: 'D3.pdf', category: 'Schedules', isCurrent: true, importedAt: isoAt(-0.01), projectId })]) }), quiet, quiet);
    expect(await added(null)).toEqual(MOVED);
    expect(await added('project-harbor-point')).toEqual(MOVED);
    // Bound to the project's cloud id: no device prints it, so it is the same report on both (the phone's rule).
    expect(await added(P1.id)).toEqual({ computerMoved: false, sameAsThePhone: true });
  });
  it('nothing changed after the send: the same report (control)', async () => {
    expect(await changed(world => world)).toEqual({ computerMoved: false, sameAsThePhone: true });
  });
});
