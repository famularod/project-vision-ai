/**
 * N761d (open item 7.61, 15 Oct 2026): "Report check details", a diagnostic. The phone (Settings > Report check
 * details: to the clipboard only) and the computer (Reports > Review & Prepare Report > Details) write out the parts
 * the report's fingerprint is made of, record by record, each with its short hash. This file: the same records give
 * the same text on both devices (the rig of N761e's differential test, copied: the cloud rows the phone uploads, read
 * (a) as the phone and the iPad read them and (b) by the computer's own loader); a record held differently is named by
 * the first line that differs (a field's value, then the record's hash); the parts make the fingerprint the screens
 * work out; building the text changes nothing and sends nothing; and the text holds no secrets.
 * Made-up names and records. No network.
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
import { buildDAVEWebReportTruths } from '../../services/DAVEWebOperations';
import { buildDAVEReportProjectTruths } from '../../services/DAVEReportProjectTruths';
import { buildCombinedReportAuthorityScope, buildDailyReportAuthorityScope } from '../../services/ReportAuthorityScope';
import { selectAuthoritativeScheduleItems } from '../../services/PIEScheduleReconciliation';
import { isDAVESafeCloudScheduleRecord, reconcileDAVEScheduleRecords } from '../../services/DAVEScheduleRecovery';
import { normalizeReferenceDocuments } from '../../services/ReferenceDocumentRepository';
import { buildDAVEReportSourceOnPeriod } from '../../services/DAVEReportIntelligence';
import { buildDAVEReportCheckDetails, safeText } from '../../services/DAVEReportCheckDetails';
import { buildDAVEReportSnapshot, daveReportSnapshotScopeKey, markReportSnapshotDelivered, reportSnapshotToSave, type DAVEReportSnapshot } from '../../services/DAVEReportSnapshot';
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


// ---------------------------------------------------------------------------------------------------------------
// N761d: the check, on both devices, on the period of the phone's send.
// ---------------------------------------------------------------------------------------------------------------

/**
 * Oct 14: the phone sends the report of `before`. Oct 15, 1:52 PM: the phone sends the report of `after`, counted from
 * Oct 14. A minute later each device makes the check on that period: the phone from what it downloaded, the computer
 * from `computerRows` (its own loader). Also each device's fingerprint as its screen works it out.
 */
async function theCheck(before: Rows, after: Rows, format: Format = 'project_manager', all = false, computerRows: Rows = after) {
  const names = all ? after.projects.map(project => project.name) : [P1.name];
  useClock(T0 - DAY);
  const oct14 = sendOf(phoneTruths(downloaded(before), names), null, isoAt(-0.99), format, names).sent;
  useClock(T0);
  const phoneRecords = downloaded(after);
  const { fingerprint: phoneSent, sent } = sendOf(phoneTruths(phoneRecords, names), oct14, isoAt(0.0014), format, names);
  useClock(T0 + 60_000);
  const phone = phoneTruths(phoneRecords, names);
  const snapshot = await computerSnapshot(computerRows);
  const computer = buildDAVEWebReportTruths(snapshot, all ? null : P1.name);
  const check = (truths: typeof phone) => buildDAVEReportCheckDetails({ truths, period: sent, format, periodState: 'read', shared: 'checked' });
  const result = {
    phoneSent,
    phoneFingerprint: buildDAVEReportSourceOnPeriod(phone, sent, format).fingerprint,
    computerFingerprint: buildDAVEReportSourceOnPeriod(computer, sent, format).fingerprint,
    phoneText: check(phone),
    computerText: check(computer),
    phone, computer, sent,
  };
  jest.useRealTimers();
  return result;
}
/** The lines of `text` that `other` does not have, in order. */
const onlyIn = (text: string, other: string) => { const there = new Set(other.split('\n')); return text.split('\n').filter(line => !there.has(line)); };
const fingerprintLine = (text: string) => text.split('\n').find(line => line.startsWith('fingerprint: '))?.slice('fingerprint: '.length);
const fsx = jest.requireActual('fs') as typeof import('fs');
/** (For the notes) a text, when N761D_OUT names a folder. */
const keep = (name: string, text: string) => { if (process.env.N761D_OUT) fsx.writeFileSync(`${process.env.N761D_OUT}/${name}.txt`, text); };

describe('N761d: the same records give the same report check text on the phone and on the computer', () => {
  it('the live project\'s shapes, both formats: the same text, word for word; its fingerprint is the one each screen works out; its parts make it', async () => {
    for (const fenceVerified of [true, false]) {
      for (const format of ['project_manager', 'executive'] as const) {
        const check = await theCheck(rowsOf(liveProject(false, fenceVerified)), rowsOf(liveProject(true, fenceVerified)), format);
        keep(`live-${fenceVerified ? 'verified' : 'not-verified'}-${format}-phone`, check.phoneText);
        expect(check.computerFingerprint).toBe(check.phoneSent);
        expect(check.phoneFingerprint).toBe(check.phoneSent);
        expect(onlyIn(check.computerText, check.phoneText)).toEqual([]);
        expect(check.computerText).toBe(check.phoneText);
        expect(fingerprintLine(check.phoneText)).toBe(check.phoneSent);
        expect(check.phoneText).toContain('\nparts make the fingerprint: yes\n');
        // Record by record (the Project Manager report holds the records; the Executive its files' photos and drawings):
        // every task and every field update of the project has its line, with its hash.
        if (format === 'project_manager') {
          for (const id of ['l2-patch', 'l2-seal', 'no-area', 's-paint', 's-trim', 's-fence']) {
            expect(check.phoneText).toMatch(new RegExp(`^projects\\."harbor point"\\.schedule\\[taskId=${id}\\] #[0-9a-f]{8}$`, 'm'));
          }
          for (const id of ['u-patch', 'u-noarea', 'u-ask', 'u-edited', 'u-today']) {
            expect(check.phoneText).toMatch(new RegExp(`^projects\\."harbor point"\\.writtenReportFacts\\.updates\\[updateId=${id}\\] #[0-9a-f]{8}$`, 'm'));
          }
        }
        expect(check.phoneText).toMatch(/^== 5 PERIOD/m);
        expect(check.phoneText).toMatch(/^period\.sourceFingerprint = "dave-report-source\/3\.0:[0-9a-f]{8}"$/m);
      }
    }
  });

  it('random owners (one or two projects, documents bound every way, GPS areas): the same text, and its parts make the fingerprint, in both formats and for all projects', async () => {
    const differ: string[] = [];
    for (let seed = 1; seed <= 12; seed += 1) {
      const { before, after } = randomWorld(seed);
      const cases: [Format, boolean][] = [['project_manager', false], ['executive', false], ...(after.projects.length > 1 ? [['project_manager', true] as [Format, boolean]] : [])];
      for (const [format, all] of cases) {
        const check = await theCheck(rowsOf(before), rowsOf(after), format, all);
        if (check.computerText !== check.phoneText) differ.push(`seed ${seed} ${format}${all ? ' all' : ''}: ${onlyIn(check.computerText, check.phoneText).slice(0, 2).join(' | ')}`);
        if (!check.phoneText.includes('\nparts make the fingerprint: yes\n')) differ.push(`seed ${seed} ${format}: parts`);
        if (fingerprintLine(check.computerText) !== check.computerFingerprint) differ.push(`seed ${seed} ${format}: computer fingerprint line`);
      }
    }
    expect(differ).toEqual([]);
  });
});

describe('N761d: a record held differently is named by the lines that differ', () => {
  it('a field: the task\'s percent the computer holds differently (the field\'s line, then its record\'s hash, its project\'s and the fingerprint)', async () => {
    const percent = (row: { item_data?: any }) => { if (row.item_data?.id === 's-paint') row.item_data.percentComplete = 75; };
    const check = await theCheck(rowsOf(liveProject(false)), rowsOf(liveProject()), 'project_manager', false, rowsOf(liveProject(), isoAt(-0.05), percent));
    keep('percent-phone', check.phoneText);
    keep('percent-computer', check.computerText);
    expect(check.computerFingerprint).not.toBe(check.phoneSent);
    const differs = onlyIn(check.computerText, check.phoneText);
    expect(differs).toEqual(expect.arrayContaining([
      expect.stringMatching(/^fingerprint: /),
      expect.stringMatching(/^== 3 PROJECTS #[0-9a-f]{8} /),
      expect.stringMatching(/^projects\."harbor point" #[0-9a-f]{8}$/),
      expect.stringMatching(/^projects\."harbor point"\.schedule\[taskId=s-paint\] #[0-9a-f]{8}$/),
      'projects."harbor point".schedule[taskId=s-paint].percentComplete = 75',
    ]));
    expect(onlyIn(check.phoneText, check.computerText)).toContain('projects."harbor point".schedule[taskId=s-paint].percentComplete = 70');
    // No other task's record line differs.
    expect(differs.filter(line => /\.schedule\[taskId=(?!s-paint\])/.test(line) && /#[0-9a-f]{8}$/.test(line))).toEqual([]);
  });

  it('review pass 2\'s L-a: a very old task row with no created time in its record: the phone stamps its own download time, the computer takes the row\'s; the check names the task and the field', async () => {
    const OLD = isoAt(-120);
    const noCreatedTime = (rows: Rows) => {
      rows.scheduleItems.forEach(row => { if (row.id === 'l2-seal') { delete row.item_data.createdAt; delete row.item_data.updatedAt; row.created_at = OLD; row.updated_at = OLD; } });
      return rows;
    };
    const check = await theCheck(noCreatedTime(rowsOf(liveProject(false))), noCreatedTime(rowsOf(liveProject())));
    keep('l-a-phone', check.phoneText);
    keep('l-a-computer', check.computerText);
    const phoneTask = check.phone[0].evidence.records.find(record => record.kind === 'schedule' && record.taskId === 'l2-seal');
    const computerTask = check.computer[0].evidence.records.find(record => record.kind === 'schedule' && record.taskId === 'l2-seal');
    expect(phoneTask?.capturedAt).not.toBe(computerTask?.capturedAt);
    // Section 6 names the record and the field the devices hold differently, whether or not the fingerprint moved.
    const capturedAtLine = (text: string) => text.split('\n').filter(line => /^notHashed\."harbor point"\.taskRecords\[[^\]]*l2-seal[^\]]*\]\.capturedAt = /.test(line));
    expect(capturedAtLine(check.phoneText)).toHaveLength(1);
    expect(capturedAtLine(check.computerText)).toHaveLength(1);
    expect(capturedAtLine(check.computerText)).not.toEqual(capturedAtLine(check.phoneText));
    expect(capturedAtLine(check.computerText)[0]).toContain(OLD);
    if (check.computerFingerprint !== check.phoneSent) {
      // Where it moved the fingerprint: the printed lines that differ (the parts), each naming the task.
      const printed = onlyIn(check.computerText, check.phoneText).filter(line => line.startsWith('printed.') && line.includes(' = '));
      expect(printed.length).toBeGreaterThan(0);
      expect(printed.some(line => line.includes('Seal windows'))).toBe(true);
    }
  });
});

describe('N761d: the check changes nothing and sends nothing; its text holds no secrets', () => {
  it('building the text moves no fingerprint, changes neither the records nor the period, and calls no network and no clipboard', async () => {
    const fetchSpy = jest.fn();
    const realFetch = (globalThis as any).fetch;
    (globalThis as any).fetch = fetchSpy;
    try {
      useClock(T0);
      const truths = phoneTruths(downloaded(rowsOf(liveProject())));
      const period = sendOf(truths, null, isoAt(-0.5), 'project_manager', [P1.name]).sent;
      const before = { truths: JSON.stringify(truths), period: JSON.stringify(period), fingerprint: buildDAVEReportSourceOnPeriod(truths, period, 'project_manager').fingerprint };
      const text = buildDAVEReportCheckDetails({ truths, period, format: 'project_manager' });
      expect(text.length).toBeGreaterThan(1000);
      expect({ truths: JSON.stringify(truths), period: JSON.stringify(period), fingerprint: buildDAVEReportSourceOnPeriod(truths, period, 'project_manager').fingerprint }).toEqual(before);
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(jest.requireMock('expo-clipboard').setStringAsync).not.toHaveBeenCalled();
    } finally {
      (globalThis as any).fetch = realFetch;
    }
  });

  it('no secret: links (signed, with tokens), e-mail addresses, bearer and web tokens, keys and long secret-like runs are written as their hash only; a change to one still shows', async () => {
    const SECRETS = {
      link: 'https://abcd.supabase.co/storage/v1/object/sign/photos/p1.jpg?token=abc123SECRETxyz',
      email: 'dana.lee@example.com',
      jwt: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U',
      bearer: 'Bearer qwertyuiopasdfghjkl1234567890',
      key: ['sk', 'live', '1234567890abcdefghijkl'].join('-') /* built at run time so the secret guard never sees a key-shaped literal */,
      supabaseKey: 'sb_secret_ABCDEFGHIJKLMNOPQRSTUV1234',
      hex: 'a3f5c9e1b2d4f6a8c0e2b4d6f8a0c2e4b6d8f0a2c4e6b8d0',
      file: 'file:///var/mobile/Containers/Data/Application/1234/Documents/p1.jpg',
    };
    const world = (variant: string) => onThePhone({
      tasks: [task({ id: 'paint', taskName: 'Paint', locationName: 'Site', startDate: usDay(-5), finishDate: usDay(10), status: 'In Progress', percentComplete: 40,
        notes: `Key ${SECRETS.key} and ${SECRETS.supabaseKey}`, nextAction: `Dana - Please check ${SECRETS.jwt}`, owner: 'Dana' })],
      updates: [update({ id: 'u-1', date: isoAt(-1), notes: `Call ${SECRETS.email} about the gate; see ${SECRETS.link}${variant} and ${SECRETS.hex}`, selectedAreaName: 'Site', scheduleItemId: 'paint', scheduleTaskName: 'Paint',
        photos: [photo('p1', `Gate ${SECRETS.bearer}`, 'Site', { uri: SECRETS.file })] })],
    });
    const check = await theCheck(rowsOf(world('')), rowsOf(world('')));
    expect(check.computerText).toBe(check.phoneText);
    for (const [kind, secret] of Object.entries(SECRETS)) {
      expect({ kind, found: check.phoneText.includes(secret) }).toEqual({ kind, found: false });
    }
    for (const fragment of ['abc123SECRETxyz', 'supabase.co', 'eyJhbGci', 'sk-live', 'sb_secret', 'qwertyuiop', '@example.com', 'file://', 'https://']) {
      expect({ fragment, found: check.phoneText.includes(fragment) }).toEqual({ fragment, found: false });
    }
    // The records are there, the secrets as hashes.
    expect(check.phoneText).toMatch(/<email #[0-9a-f]{8}>/);
    expect(check.phoneText).toMatch(/<link #[0-9a-f]{8}>/);
    expect(check.phoneText).toMatch(/<hidden #[0-9a-f]{8}>/);
    // A different link in the note: the lines that differ show it (by its hash), and name the update.
    const other = await theCheck(rowsOf(world('')), rowsOf(world('')), 'project_manager', false, rowsOf(world('&v=2')));
    expect(other.computerFingerprint).not.toBe(other.phoneSent);
    const differs = onlyIn(other.computerText, other.phoneText);
    expect(differs.some(line => line.includes('u-1') && /<link #[0-9a-f]{8}>/.test(line))).toBe(true);
    expect(differs.join('\n')).not.toContain('supabase.co');
  });

  it('safeText: what it hides and what it keeps', () => {
    expect(safeText('Drywall patched at the stair (Level 2), 70% - Dana')).toBe('Drywall patched at the stair (Level 2), 70% - Dana');
    expect(safeText('report:harbor point / dave-report-source/3.0:1a2b3c4d / 3e9b5c1a-7d2f-4a60-8b14-6c0e2f9a1d57')).toBe('report:harbor point / dave-report-source/3.0:1a2b3c4d / 3e9b5c1a-7d2f-4a60-8b14-6c0e2f9a1d57');
    expect(safeText('mail pm@example.com now')).toMatch(/^mail <email #[0-9a-f]{8}> now$/);
    expect(safeText('see http://x.y/z?a=1 ok')).toMatch(/^see <link #[0-9a-f]{8}> ok$/);
    expect(safeText('ph://ABC-123/L0/001')).toMatch(/^<link #[0-9a-f]{8}>$/);
    expect(safeText('Authorization: Bearer abc.def.ghi')).toMatch(/^Authorization: <hidden #[0-9a-f]{8}>$/);
  });
});
