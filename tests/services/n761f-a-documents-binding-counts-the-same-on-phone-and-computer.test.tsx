/**
 * N761f (15 Oct 2026, the Build 234 candidate): after N761e the computer leaves a document bound to the project's
 * cloud id out of its report, saying the phone does too. Does the phone? And for a document that carries the
 * project's cloud id AND its name, or the name only, or neither, archived or not?
 *
 * The app's road, both ways, from the same cloud rows:
 *  (a) THE PHONE / iPAD: the document row as SupabaseService listReferenceDocuments hands it (document_data with the
 *      row's id and time), normalizeReferenceDocuments (App.tsx's refresh), the recovery merge and the current-
 *      schedule reconciliation (App.tsx's refresh), the App's scope for the report (App.tsx liveAuthorityInput, over
 *      the owner's projects WITH their cloud ids), the Reports screen's list (useListedSharedDocuments: the archived
 *      marks) and its truths (ReportsScreen.tsx reportTruths: the projects by NAME);
 *  (b) THE COMPUTER: its own loader over the same rows (archived marks on the rows, as the gateway hands them), then
 *      its Reports page's truths;
 * and both on the same period (the phone's send of Oct 14, then its send of Oct 15).
 *
 * FOUND: the phone keeps the row's projectId as it is (a cloud id stays a cloud id), and its Reports screen leaves out
 * every document whose projectId is not the project's name or its old key ("project-<name>"), WHATEVER name it also
 * carries; a document with no projectId is counted by its name. The computer (since N761e) does the same, in every
 * combination below. So the review of D1's test (L10) modelled the phone's copy of a cloud-id-bound row as one with
 * no projectId: no phone holds such a copy.
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

import { normalizeScheduleItem } from '../../App';
import { loadDAVEWebReadOnlySnapshot } from '../../services/DAVEWebReadOnlyRepository';
import { buildDAVEWebReportDraft, buildDAVEWebReportTruths } from '../../services/DAVEWebOperations';
import { buildDAVEReportProjectTruths } from '../../services/DAVEReportProjectTruths';
import { buildCombinedReportAuthorityScope, buildDailyReportAuthorityScope } from '../../services/ReportAuthorityScope';
import { reconcileCurrentScheduleDocuments, selectAuthoritativeScheduleItems } from '../../services/PIEScheduleReconciliation';
import { isDAVESafeCloudScheduleRecord, reconcileDAVEScheduleRecords } from '../../services/DAVEScheduleRecovery';
import { bindDAVECloudDatabaseIdentity, mergeDAVEReferenceDocumentRecoveryRecords } from '../../services/DAVECloudRecovery';
import { normalizeReferenceDocuments } from '../../services/ReferenceDocumentRepository';
import { buildDAVEReportBriefing, buildDAVEReportSourceOnPeriod } from '../../services/DAVEReportIntelligence';
import { buildDAVEReportSnapshot, daveReportSnapshotScopeKey, markReportSnapshotDelivered, reportBaselineSnapshot, reportSnapshotToSave, type DAVEReportSnapshot } from '../../services/DAVEReportSnapshot';
import { referenceDocumentsCitedAsListed, withoutListedPageIndexes } from '../../services/ECOSDocumentIndexPersistence';
import { scheduleSavedTasksOfProjects } from '../../services/ScheduleTaskRevisions';
import { sharedDocumentsListed } from '../../services/SharedDocumentArchiveView';
import type { ScheduleItem } from '../../types';

const P1 = { id: '3e9b5c1a-7d2f-4a60-8b14-6c0e2f9a1d57', name: 'Harbor Point' };
const P2 = { id: '6a1f0c2e-9b3d-4e75-a8c6-0d4b7e2f1a93', name: 'Maple Court' };
const DAY = 86_400_000;
const T0 = Date.parse('2026-10-15T17:50:00.000Z');
const isoAt = (days: number) => new Date(T0 + days * DAY).toISOString();
const usDay = (days: number) => { const date = new Date(T0 + days * DAY); return `${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}/${date.getFullYear()}`; };
type Format = 'project_manager' | 'executive';
const json = (value: unknown) => JSON.parse(JSON.stringify(value));

const task = (project: typeof P1, over: Record<string, unknown>) => normalizeScheduleItem({
  projectId: project.id, projectName: project.name, scheduleProjectName: project.name, owner: '', contractor: '', milestone: '', notes: '', nextAction: '',
  priority: 'Medium', status: 'In Progress', percentComplete: 40, createdAt: isoAt(-14), locationName: 'Site', startDate: usDay(-5), finishDate: usDay(10), ...over,
} as Partial<ScheduleItem>);

type Binding = { projectId?: string | null; projectName?: string | null; projectNames?: string[] };
/** Every way a document's row can say whose it is. */
const BINDINGS: Record<string, Binding> = {
  'cloud id only': { projectId: P1.id, projectName: null, projectNames: [] },
  'name only': { projectId: null, projectName: P1.name, projectNames: [P1.name] },
  'names list only': { projectId: null, projectName: null, projectNames: [P1.name] },
  'cloud id AND name (the review of D1\'s rows)': { projectId: P1.id, projectName: P1.name, projectNames: [P1.name] },
  'old key AND name': { projectId: 'project-harbor-point', projectName: P1.name, projectNames: [P1.name] },
  'old key only': { projectId: 'project-harbor-point', projectName: null, projectNames: [] },
  'the name as its projectId': { projectId: P1.name, projectName: null, projectNames: [] },
  'another project\'s cloud id, this name': { projectId: P2.id, projectName: P1.name, projectNames: [P1.name] },
  'this cloud id, another project\'s name': { projectId: P1.id, projectName: P2.name, projectNames: [P2.name] },
  'nothing (no task from it)': { projectId: null, projectName: null, projectNames: [] },
};

/** The cloud rows (as the phone uploads them), with the archived mark on the row as the computer's gateway hands it. */
function rowsOf(input: { documents?: Record<string, unknown>[]; archived?: readonly string[] } = {}) {
  const tasks = [task(P1, { id: 'paint', taskName: 'Paint' }), task(P2, { id: 'frame', taskName: 'Frame' })];
  const documents = normalizeReferenceDocuments(input.documents ?? []);
  return {
    projects: [P1, P2].map(project => ({ id: project.id, name: project.name, status: 'Active', archived: false, is_favorite: false, created_at: '2026-09-01T00:00:00.000Z', updated_at: isoAt(-0.05), owner_id: 'owner-1', project_data: null })),
    scheduleItems: tasks.map(item => ({ id: item.id, owner_id: 'owner-1', project_id: (item as any).projectId, project_name: item.projectName, task_name: item.taskName, item_data: json(item), created_at: isoAt(-0.05), updated_at: isoAt(-0.05) })),
    projectUpdates: [] as Record<string, unknown>[],
    referenceDocuments: documents.map(document => ({
      id: document.id, updated_at: isoAt(-0.05), document_data: json(document),
      ...(input.archived?.includes(document.id) ? { archived_at: isoAt(-0.5) } : {}),
    })),
    syncTombstones: [] as Record<string, unknown>[],
    projectAreas: [] as Record<string, unknown>[],
  };
}
type Rows = ReturnType<typeof rowsOf>;

/** (a) What the phone holds once it has downloaded the rows: SupabaseService listReferenceDocuments, then App.tsx's refresh. */
function downloaded(rows: Rows) {
  const listed = rows.referenceDocuments.map(row => ({ ...bindDAVECloudDatabaseIdentity(row.document_data, row.id), cloudUpdatedAt: row.updated_at }));
  return {
    projects: rows.projects.map(project => ({ id: project.id, name: project.name })),
    tasks: reconcileDAVEScheduleRecords(rows.scheduleItems.map(row => ({ ...row.item_data, id: row.id })).filter(isDAVESafeCloudScheduleRecord)
      .map(item => normalizeScheduleItem(item))),
    documents: reconcileCurrentScheduleDocuments(mergeDAVEReferenceDocumentRecoveryRecords({ local: [], cloud: normalizeReferenceDocuments(listed) })),
    // The phone's own copy of the marks (SharedDocumentArchive: reference_documents.archived_at).
    archivedIds: new Set(rows.referenceDocuments.filter(row => 'archived_at' in row).map(row => row.id)),
  };
}

/** (a) The phone's Reports screen: App.tsx liveAuthorityInput, then ReportsScreen.tsx (its list of documents, its truths). */
function phoneTruths(records: ReturnType<typeof downloaded>, names: readonly string[]) {
  const authoritative = selectAuthoritativeScheduleItems({ scheduleItems: records.tasks, scheduleDocuments: records.documents } as never) as unknown as ScheduleItem[];
  const input = { selectedProjectNames: names, projectRecords: records.projects, updates: [], scheduleItems: authoritative, currentUpdate: null, projectAreas: [], knownScheduleItems: records.tasks, referenceDocuments: records.documents, projectDocuments: [], captureMemories: [], contacts: { contacts: [] } as never };
  const scope = names.length === 1 ? buildDailyReportAuthorityScope({ ...input, selectedProjectName: names[0] }) : buildCombinedReportAuthorityScope(input);
  const listed = sharedDocumentsListed(scope.referenceDocuments, records.archivedIds); // useListedSharedDocuments
  return buildDAVEReportProjectTruths({
    projects: names.map(name => ({ name, projectId: `report:${name.toLowerCase()}` })),
    projectRecords: names.map(name => ({ name })) as never,
    updates: scope.updates,
    scheduleItems: scope.scheduleItems,
    knownScheduleItems: scheduleSavedTasksOfProjects(records.tasks, scope.scheduleItems, scope.projectNames),
    knownScheduleDocuments: records.documents,
    projectAreas: scope.projectAreas,
    referenceDocuments: withoutListedPageIndexes([...listed]),
    drawingDocuments: referenceDocumentsCitedAsListed([...listed]),
  });
}

const useClock = (ms: number) => jest.useFakeTimers({ now: ms, doNotFake: ['nextTick', 'setImmediate', 'setInterval', 'setTimeout', 'clearTimeout', 'clearInterval', 'queueMicrotask'] });
afterEach(() => jest.useRealTimers());

function sendOf(truths: ReturnType<typeof phoneTruths>, previous: DAVEReportSnapshot | null, at: string, format: Format, names: readonly string[]) {
  const fingerprint = buildDAVEReportSourceOnPeriod(truths, previous, format).fingerprint;
  const current = buildDAVEReportSnapshot({ truths, scopeKey: daveReportSnapshotScopeKey(names), sourceFingerprint: fingerprint, capturedAt: truths.map(truth => truth.generatedAt).sort().at(-1), reportFormat: format });
  return { fingerprint, sent: markReportSnapshotDelivered(reportSnapshotToSave(current, previous) ?? previous!, at, 'phone-install') };
}

const DOCUMENT_IDS = /"(doc-[a-z0-9-]+)"/g;
const idsIn = (truths: unknown) => [...new Set(JSON.stringify(truths).match(DOCUMENT_IDS) ?? [])].sort();

/** Oct 14: the phone sends the report with no documents; Oct 15: the documents are there; both devices on that period. */
async function bothDevices(after: Rows, format: Format, all: boolean) {
  const names = all ? [P1.name, P2.name] : [P1.name];
  useClock(T0 - DAY);
  const oct14 = sendOf(phoneTruths(downloaded(rowsOf()), names), null, isoAt(-0.99), format, names).sent;
  useClock(T0);
  const phone = phoneTruths(downloaded(after), names);
  const { fingerprint, sent } = sendOf(phone, oct14, isoAt(0.0014), format, names);
  mockRows.rows = after;
  const snapshot = await loadDAVEWebReadOnlySnapshot();
  const computer = buildDAVEWebReportTruths(snapshot, all ? null : P1.name);
  const countedFrom = reportBaselineSnapshot(sent, sent.sourceFingerprint);
  const result = {
    phone: { fingerprint, documents: idsIn(phone), whatChanged: buildDAVEReportBriefing({ truths: phone, previousSnapshot: countedFrom }).whatChanged },
    computer: {
      fingerprint: buildDAVEReportSourceOnPeriod(computer, sent, format).fingerprint,
      documents: idsIn(computer),
      whatChanged: buildDAVEWebReportDraft(snapshot, all ? null : P1.name, { previousSnapshot: countedFrom, waitingForOtherDevice: false }).whatChanged,
    },
  };
  jest.useRealTimers();
  return result;
}

/** A current schedule made current yesterday (its "Schedules document added" line shows), a contract and a permit card. */
const documentsBound = (binding: Binding) => [
  { id: 'doc-schedule', name: 'D2', originalFileName: 'D2.pdf', category: 'Schedules', isCurrent: true, importedAt: isoAt(-1) },
  { id: 'doc-contract', name: 'Site contract', originalFileName: 'contract.pdf', category: 'Contract', isCurrent: true, importedAt: isoAt(-2) },
  { id: 'doc-permit', name: 'Grading permit', originalFileName: 'permit.pdf', category: 'Permit Card', isCurrent: false, importedAt: isoAt(-3) },
].map(document => ({ mimeType: 'application/pdf', notes: '', uri: '', storagePath: `owner-1/${document.id}.pdf`, ...document, ...binding }));

describe('N761f: what the phone holds for a document the cloud binds to the project', () => {
  it('the phone keeps the row\'s projectId as it is (a cloud id stays the cloud id), beside its name', () => {
    const held = downloaded(rowsOf({ documents: documentsBound(BINDINGS['cloud id AND name (the review of D1\'s rows)']) })).documents;
    expect(held.map(document => [document.id, document.projectId, document.projectName, document.projectNames])).toEqual([
      ['doc-schedule', P1.id, P1.name, [P1.name]],
      ['doc-contract', P1.id, P1.name, [P1.name]],
      ['doc-permit', P1.id, P1.name, [P1.name]],
    ]);
  });
});

describe('N761f: every binding, archived or not: the phone and the computer count the same documents and work out the same report', () => {
  const expectedOnThePhone: Record<string, boolean> = {
    'cloud id only': false,
    'name only': true,
    'names list only': true,
    'cloud id AND name (the review of D1\'s rows)': false,
    'old key AND name': true,
    'old key only': true,
    'the name as its projectId': true,
    'another project\'s cloud id, this name': false,
    'this cloud id, another project\'s name': false,
    'nothing (no task from it)': false,
  };
  for (const [label, binding] of Object.entries(BINDINGS)) {
    it(`${label}: the same documents, the same What changed, the same fingerprint (one project and all projects; PM and Executive; nothing, the contract, or the schedule archived)`, async () => {
      for (const archived of [[], ['doc-contract'], ['doc-schedule']] as string[][]) {
        for (const all of [false, true]) {
          for (const format of ['project_manager', 'executive'] as const) {
            const both = await bothDevices(rowsOf({ documents: documentsBound(binding), archived }), format, all);
            const counted = expectedOnThePhone[label]
              ? ['doc-contract', 'doc-schedule'].filter(id => !archived.includes(id)).map(id => `"${id}"`) // (a document not current, the permit card, is in no truth)
              : [];
            const at = { label, archived, all, format };
            // The phone (the rig's model of it, pinned here so the claim is explicit).
            expect({ ...at, documents: both.phone.documents }).toEqual({ ...at, documents: counted });
            // The computer agrees: the same documents, never an archived one, the same What changed and fingerprint.
            expect({ ...at, documents: both.computer.documents }).toEqual({ ...at, documents: both.phone.documents });
            expect({ ...at, whatChanged: both.computer.whatChanged }).toEqual({ ...at, whatChanged: both.phone.whatChanged });
            expect({ ...at, fingerprint: both.computer.fingerprint }).toEqual({ ...at, fingerprint: both.phone.fingerprint });
          }
        }
      }
    });
  }

  it('a counted document archived after the send: another report on both devices, the same one (L10: never counted once archived)', async () => {
    const binding = BINDINGS['name only'];
    const names = [P1.name];
    useClock(T0);
    const before = phoneTruths(downloaded(rowsOf({ documents: documentsBound(binding) })), names);
    const sent = sendOf(before, null, isoAt(0.0014), 'project_manager', names).sent;
    // (control) nothing changed: the report sent.
    expect(buildDAVEReportSourceOnPeriod(phoneTruths(downloaded(rowsOf({ documents: documentsBound(binding) })), names), sent, 'project_manager').fingerprint).toBe(sent.sourceFingerprint);
    const afterRows = rowsOf({ documents: documentsBound(binding), archived: ['doc-contract'] });
    const phone = buildDAVEReportSourceOnPeriod(phoneTruths(downloaded(afterRows), names), sent, 'project_manager').fingerprint;
    mockRows.rows = afterRows;
    const computer = buildDAVEReportSourceOnPeriod(buildDAVEWebReportTruths(await loadDAVEWebReadOnlySnapshot(), P1.name), sent, 'project_manager').fingerprint;
    expect(phone).not.toBe(sent.sourceFingerprint);
    expect(computer).toBe(phone);
  });
});
