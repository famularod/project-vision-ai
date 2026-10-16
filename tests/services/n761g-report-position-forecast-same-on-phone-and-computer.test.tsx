/**
 * N761g (open item 7.61, the computer's half; 16 Oct 2026). Build 235's report check details (Test project, Project
 * Manager): the phone and the computer held the same records (sections 1, 2, 3, 5, 6 the same); the ONLY difference was
 * printed.positions[0][4], the Project Position's forecast finish: null on the phone, "01/22/2027" on the computer. The
 * report worked it out as the latest task finish date by reading each date with the engine's own date reader
 * (`new Date(text)`): the computer's engine reads "01/22/2027", the phone's (Hermes) does not, so the phone had no
 * forecast finish (its card: "Forecast: Not set"), the computer had one, and their fingerprints never met.
 * This file runs the phone's path on the phone's engine (tests/fixtures/phone-date-engine) and the computer's on its own
 * (the rig of N761d's test: the cloud rows the phone uploads, read by the phone and by the computer's own loader), and
 * asks for the same report check text, word for word: Test project's shapes, both formats, combined reports, every field
 * of the Project Position and every other part read from a date; and never the dangerous direction.
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
import { buildDAVEReportCheckDetails } from '../../services/DAVEReportCheckDetails';
import { buildDAVEReportSnapshot, daveReportSnapshotScopeKey, markReportSnapshotDelivered, reportSnapshotToSave, type DAVEReportSnapshot } from '../../services/DAVEReportSnapshot';
import { referenceDocumentsCitedAsListed, withoutListedPageIndexes } from '../../services/ECOSDocumentIndexPersistence';
import { scheduleSavedTasksOfProjects } from '../../services/ScheduleTaskRevisions';
import { partitionProjectUpdatesByDeletedTask } from '../../services/DAVEDeletedTaskEvidence';
import type { ScheduleItem } from '../../types';
import { onThePhonesEngine, thePhonesEngineReads } from '../fixtures/phone-date-engine';

const P1 = { id: '3e9b5c1a-7d2f-4a60-8b14-6c0e2f9a1d57', name: 'Harbor Point' };
const P2 = { id: '6a1f0c2e-9b3d-4e75-a8c6-0d4b7e2f1a93', name: 'Maple Court' };
const DAY = 86_400_000;
// The day of Build 235's diagnostic: 16 Oct 2026, morning (Pacific).
const T0 = Date.parse('2026-10-16T14:50:00.000Z');
const isoAt = (days: number) => new Date(T0 + days * DAY).toISOString();
type Format = 'project_manager' | 'executive';

type World = {
  projects: { id: string; name: string }[];
  tasks: ScheduleItem[];
  updates: ReturnType<typeof normalizeUpdate>[];
  documents: ReturnType<typeof normalizeReferenceDocuments>;
  areas: Record<string, unknown>[];
  tombstones: { entity_type: string; record_id: string; deleted_at: string }[];
};

/** Records as the phone holds them: made with App.tsx's own normalizers, on the phone's engine. */
function onThePhone(input: { projects?: World['projects']; tasks?: unknown[]; updates?: unknown[]; documents?: unknown[] }): World {
  return onThePhonesEngine(() => ({
    projects: input.projects ?? [P1],
    tasks: (input.tasks ?? []).map(item => normalizeScheduleItem(item as Partial<ScheduleItem>)),
    updates: (input.updates ?? []).map(item => normalizeUpdate(item as never)),
    documents: normalizeReferenceDocuments(input.documents ?? []),
    areas: [],
    tombstones: [],
  }));
}

/** The cloud rows of those records, as the phone uploads them (the rig of N761e / N761d). */
function rowsOf(world: World, rowTime = isoAt(-0.05), rewrite: (row: { item_data?: any; update_data?: any }) => void = () => undefined) {
  const json = (value: unknown) => JSON.parse(JSON.stringify(value));
  const rows = {
    projects: world.projects.map(project => ({ id: project.id, name: project.name, status: 'Active', archived: false, is_favorite: false, created_at: '2026-09-01T00:00:00.000Z', updated_at: rowTime, owner_id: 'owner-1', project_data: null })),
    scheduleItems: world.tasks.map(item => ({ id: item.id, owner_id: 'owner-1', project_id: (item as any).projectId, project_name: item.projectName, task_name: item.taskName, item_data: json(item), created_at: rowTime, updated_at: rowTime })),
    projectUpdates: world.updates.map(update => ({ id: update.id, project_id: (update as any).projectId, project_name: update.projectName || 'Unassigned Project', area_name: update.selectedAreaName || '', idempotency_key: update.id, update_data: json(update), created_at: update.date, updated_at: rowTime, owner_id: 'owner-1' })),
    referenceDocuments: world.documents.map(document => ({ id: document.id, updated_at: rowTime, document_data: json(document) })),
    syncTombstones: world.tombstones,
    projectAreas: world.areas,
  };
  [...rows.scheduleItems, ...rows.projectUpdates].forEach(rewrite);
  return rows;
}
type Rows = ReturnType<typeof rowsOf>;

/** What the phone holds once it has downloaded the rows (App.tsx's refresh). */
function downloaded(rows: Rows) {
  const deleted = (type: string) => new Set(rows.syncTombstones.filter(row => row.entity_type === type).map(row => row.record_id));
  const deletedTasks = deleted('schedule_item');
  return {
    projects: rows.projects.map(project => ({ id: project.id, name: project.name })),
    tasks: reconcileDAVEScheduleRecords(rows.scheduleItems.map(row => ({ ...row.item_data, id: row.id })).filter(isDAVESafeCloudScheduleRecord)
      .map(item => normalizeScheduleItem(item)).filter(item => item.taskName.trim() && !deletedTasks.has(item.id))),
    updates: rows.projectUpdates.map(row => normalizeUpdate(row.update_data)),
    documents: normalizeReferenceDocuments(rows.referenceDocuments.map(row => ({ ...row.document_data, id: row.id, cloudUpdatedAt: row.updated_at }))),
    areas: rows.projectAreas,
    tombstones: rows.syncTombstones.map(row => ({ entityType: row.entity_type, recordId: row.record_id, deletedAt: row.deleted_at })),
  };
}

/** The phone's Reports screen: App.tsx liveAuthorityInput (its scope for the report), then ReportsScreen.tsx reportTruths. */
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

const useClock = (ms: number) => jest.useFakeTimers({ now: ms, doNotFake: ['nextTick', 'setImmediate', 'setInterval', 'setTimeout', 'clearTimeout', 'clearInterval', 'queueMicrotask'] });
afterEach(() => jest.useRealTimers());

function sendOf(truths: ReturnType<typeof phoneTruths>, previous: DAVEReportSnapshot | null, at: string, format: Format, names: readonly string[]) {
  const fingerprint = buildDAVEReportSourceOnPeriod(truths, previous, format).fingerprint;
  const current = buildDAVEReportSnapshot({ truths, scopeKey: daveReportSnapshotScopeKey(names), sourceFingerprint: fingerprint, capturedAt: truths.map(truth => truth.generatedAt).sort().at(-1), reportFormat: format });
  return { fingerprint, sent: markReportSnapshotDelivered(reportSnapshotToSave(current, previous) ?? previous!, at, 'phone-install') };
}

const task = (over: Record<string, unknown>) => ({
  projectId: P1.id, projectName: P1.name, scheduleProjectName: P1.name, owner: '', contractor: '', milestone: '', notes: '', nextAction: '',
  priority: 'Medium', status: 'Not Started', percentComplete: 0, createdAt: isoAt(-20), ...over,
});
const update = (over: Record<string, unknown>) => ({ projectId: P1.id, projectName: P1.name, scheduleProjectName: P1.name, status: 'sent', recipients: { contactIds: [] }, photos: [], ...over });

/**
 * Test project's shapes (Build 235's diagnostic, 16 Oct; made-up names): eleven tasks, every date as the phone holds it
 * (MM/DD/YYYY): three hand-made tasks in Level 2, overdue at 0%; four with no area, due Nov 4 to Jan 12; Trim (Site),
 * due Jan 15 (moved from Feb 5 since the last report); Paint (Site), In Progress 70%, due Jan 22, the latest finish; a
 * task with no dates (3 days long); Fence (Site), complete and verified by the project manager. No baseline. `more` adds to each task.
 */
function testProjectLike(trimFinish = '01/15/2027', more: (id: string) => Record<string, unknown> = () => ({}), project = P1) {
  const own = (over: Record<string, unknown>) => task({ projectId: project.id, projectName: project.name, scheduleProjectName: project.name, ...over, ...more(String(over.id)), id: `${project === P1 ? '' : 'b-'}${over.id}` });
  return [
    own({ id: 'l2-steel', taskName: 'Set steel', locationName: 'Level 2', startDate: '10/05/2026', finishDate: '10/09/2026' }),
    own({ id: 'l2-inspect', taskName: 'Inspection', locationName: 'Level 2', startDate: '10/10/2026', finishDate: '10/12/2026' }),
    own({ id: 'l2-pour', taskName: 'Pour slab', locationName: 'Level 2', startDate: '10/11/2026', finishDate: '10/13/2026' }),
    own({ id: 'grade', taskName: 'Grading', locationName: '', startDate: '10/28/2026', finishDate: '11/04/2026' }),
    own({ id: 'pave', taskName: 'Paving', locationName: '', startDate: '11/05/2026', finishDate: '11/06/2026' }),
    own({ id: 'no-area', taskName: 'No-area check', locationName: '', startDate: '11/10/2026', finishDate: '11/14/2026', createdAt: isoAt(-2) }),
    own({ id: 'touch', taskName: 'Touch-up', locationName: '', startDate: '01/08/2027', finishDate: '01/12/2027' }),
    own({ id: 's-trim', taskName: 'Trim', locationName: 'Site', startDate: '01/11/2027', finishDate: trimFinish, updatedAt: isoAt(-0.4) }),
    own({ id: 's-paint', taskName: 'Paint', locationName: 'Site', startDate: '01/18/2027', finishDate: '01/22/2027', status: 'In Progress', percentComplete: 70, updatedAt: isoAt(-3) }),
    own({ id: 'sitework', taskName: 'Sitework', locationName: '', startDate: '', finishDate: '', durationDays: 3 }),
    own({ id: 's-fence', taskName: 'Fence', locationName: 'Site', startDate: '10/01/2026', finishDate: '10/14/2026', status: 'Complete', percentComplete: 100,
      progressSource: 'project_manager', progressConfirmedAt: isoAt(-2), progressConfirmedBy: 'Dana', updatedAt: isoAt(-2),
      completionVerification: { status: 'pm_verified', reportedAt: isoAt(-2.1), reportedBy: 'Dana', priorScheduleStatus: 'In Progress', priorPercentComplete: 80, verifiedAt: isoAt(-2), verifiedBy: 'Dana', verificationNote: 'verified complete', evidence: [] } }),
  ];
}
const fenceUpdate = (project = P1) => update({ id: `${project === P1 ? '' : 'b-'}u-fence`, projectId: project.id, projectName: project.name, scheduleProjectName: project.name, date: isoAt(-2.1), notes: 'Fence done', selectedAreaName: 'Site', scheduleItemId: `${project === P1 ? '' : 'b-'}s-fence`, scheduleTaskName: 'Fence' });

/**
 * Oct 15: the phone sends the report of `before`. Oct 16, 7:50 AM: the phone sends the report of `after`, counted from
 * Oct 15. A minute later each device makes Build 235's check on that period: the phone (on ITS engine) from what it
 * downloaded, the computer (on its own) from `computerRows` through its own loader.
 */
async function theCheck(before: Rows, after: Rows, format: Format = 'project_manager', all = false, computerRows: Rows = after) {
  const names = all ? after.projects.map(project => project.name) : [P1.name];
  useClock(T0 - DAY);
  const oct15 = onThePhonesEngine(() => sendOf(phoneTruths(downloaded(before), names), null, isoAt(-0.99), format, names).sent);
  useClock(T0);
  const phoneRecords = onThePhonesEngine(() => downloaded(after));
  const { fingerprint: phoneSent, sent } = onThePhonesEngine(() => sendOf(phoneTruths(phoneRecords, names), oct15, isoAt(0.0014), format, names));
  useClock(T0 + 60_000);
  const check = (truths: ReturnType<typeof phoneTruths>) => buildDAVEReportCheckDetails({ truths, period: sent, format, periodState: 'read', shared: 'checked' });
  const phone = onThePhonesEngine(() => {
    const truths = phoneTruths(phoneRecords, names);
    return { truths, fingerprint: buildDAVEReportSourceOnPeriod(truths, sent, format).fingerprint, text: check(truths) };
  });
  mockRows.rows = computerRows;
  const computer = buildDAVEWebReportTruths(await loadDAVEWebReadOnlySnapshot(), all ? null : P1.name);
  const result = {
    phoneSent, sent,
    phoneFingerprint: phone.fingerprint,
    computerFingerprint: buildDAVEReportSourceOnPeriod(computer, sent, format).fingerprint,
    phoneText: phone.text,
    computerText: check(computer),
  };
  jest.useRealTimers();
  return result;
}
/** The lines of `text` that `other` does not have, in order. */
const onlyIn = (text: string, other: string) => { const there = new Set(other.split('\n')); return text.split('\n').filter(line => !there.has(line)); };
const valueLines = (text: string, prefix: string) => text.split('\n').filter(line => line.startsWith(prefix) && line.includes(' = '));
/** The fingerprint's printed parts (section 4) as `text` holds them. */
const section4 = (text: string) => { const lines = text.split('\n'); const from = lines.findIndex(line => line.startsWith('== 4 PRINTED')); const to = lines.findIndex(line => line.startsWith('== 5 PERIOD')); return lines.slice(from, to).join('\n'); };
const fsx = jest.requireActual('fs') as typeof import('fs');
/** (For the notes) a text, when N761G_OUT names a folder. */
const keep = (name: string, text: string) => { if (process.env.N761G_OUT) fsx.writeFileSync(`${process.env.N761G_OUT}/${name}.txt`, text); };

describe('N761g: the phone\'s engine reads a date from text only in the ISO form', () => {
  it('the stand-in: "01/22/2027" is no date on the phone; ISO dates and times are read as on the computer; numbers and parts as before; the engine is put back', () => {
    const real = Date;
    onThePhonesEngine(() => {
      expect(Number.isNaN(new Date('01/22/2027').getTime())).toBe(true);
      expect(Number.isNaN(Date.parse('01/22/2027'))).toBe(true);
      expect(new Date('2027-01-22').getTime()).toBe(real.parse('2027-01-22'));
      expect(new Date('2026-10-15T20:52:57.448Z').toISOString()).toBe('2026-10-15T20:52:57.448Z');
      expect(new Date(2027, 0, 22).getTime()).toBe(new real(2027, 0, 22).getTime());
      expect(new Date(0).toISOString()).toBe('1970-01-01T00:00:00.000Z');
      expect(new real(5) instanceof Date).toBe(true);
    });
    expect(Date).toBe(real);
    expect(new Date('01/22/2027').getTime()).toBe(new real(2027, 0, 22).getTime());
    expect(['01/22/2027', '1/22/2027', 'Jan 22, 2027', '2027/01/22'].filter(thePhonesEngineReads)).toEqual([]);
  });
});

describe('N761g: Test project\'s records give the computer the phone\'s report (Build 235\'s diagnostic, reproduced)', () => {
  const before = () => rowsOf(onThePhone({ tasks: testProjectLike('02/05/2027'), updates: [fenceUpdate()] }), isoAt(-1.05));
  const after = () => rowsOf(onThePhone({ tasks: testProjectLike(), updates: [fenceUpdate()] }));

  it('Project Manager: the same section 4 and the same fingerprint on both devices; the Project Position\'s forecast finish is none on both (Build 235: phone null, computer "01/22/2027")', async () => {
    const check = await theCheck(before(), after(), 'project_manager');
    keep('test-project-pm-phone', check.phoneText);
    keep('test-project-pm-computer', check.computerText);
    // The phone's own text, as on the owner's phone (16 Oct): the Project Position of eleven tasks, Paint due 01/22/2027.
    expect(valueLines(check.phoneText, 'printed.positions[0]')).toEqual([
      'printed.positions[0][0] = "Harbor Point"',
      'printed.positions[0][1] = 13',
      'printed.positions[0][2] = "1 of 11 tasks complete; 1 in progress; 9 not started."',
      'printed.positions[0][3] = "3 tasks overdue."',
      'printed.positions[0][4] = null',
      'printed.positions[0][5] = null',
      'printed.positions[0][6] = null',
    ]);
    expect(check.phoneText).toContain('printed.currentWork[8] = "Paint (Site): In Progress; 70% complete; due 01/22/2027."');
    expect(check.phoneText).toContain('printed.since.lines[0] = "Harbor Point: Trim finish changed from 02/05/2027 to 01/15/2027."');
    expect(onlyIn(section4(check.computerText), section4(check.phoneText))).toEqual([]);
    expect(check.computerText).toBe(check.phoneText);
    expect(check.computerFingerprint).toBe(check.phoneSent);
    expect(check.phoneFingerprint).toBe(check.phoneSent);
    expect(check.computerText).toContain('\nthe period\'s own report: yes\n');
  });

  it('Executive: the same', async () => {
    const check = await theCheck(before(), after(), 'executive');
    expect(valueLines(check.phoneText, 'printed.positions[0][4]')).toEqual(['printed.positions[0][4] = null']);
    expect(onlyIn(section4(check.computerText), section4(check.phoneText))).toEqual([]);
    expect(check.computerText).toBe(check.phoneText);
    expect(check.computerFingerprint).toBe(check.phoneSent);
  });

  it('a combined report (Harbor Point and Maple Court, both of Test project\'s shapes), both formats: the same', async () => {
    const world = (trim: string) => rowsOf(onThePhone({ projects: [P1, P2], tasks: [...testProjectLike(trim), ...testProjectLike(trim, () => ({}), P2)], updates: [fenceUpdate(), fenceUpdate(P2)] }));
    for (const format of ['project_manager', 'executive'] as const) {
      const check = await theCheck(world('02/05/2027'), world('01/15/2027'), format, true);
      expect(valueLines(check.phoneText, 'printed.positions[').filter(line => /\]\[4\] = /.test(line))).toEqual(['printed.positions[0][4] = null', 'printed.positions[1][4] = null']);
      expect(check.computerText).toBe(check.phoneText);
      expect(check.computerFingerprint).toBe(check.phoneSent);
    }
  });
});

describe('N761g: every field of the Project Position, and every other part read from a date, is the same on both devices', () => {
  /** Test project's shapes with `more` on each task (baselines, milestones, dates the phone keeps as written). */
  const variants: [string, (id: string) => Record<string, unknown>][] = [
    ['baselines as an import writes them (MM/DD/YYYY)', id => (id === 's-paint' ? { baselineStartDate: '01/04/2027', baselineFinishDate: '01/08/2027' } : id === 's-trim' ? { baselineFinishDate: '01/05/2027' } : {})],
    ['baselines in ISO', id => (id === 's-paint' ? { baselineStartDate: '2027-01-04', baselineFinishDate: '2027-01-08' } : id === 'grade' ? { baselineFinishDate: '2026-10-30' } : {})],
    ['baselines in another wording ("Jan 8, 2027")', id => (id === 's-paint' ? { baselineFinishDate: 'Jan 8, 2027' } : {})],
    ['milestones (Paving, Touch-up, Trim, Sitework) at several dates', id => (['pave', 'touch', 's-trim', 'sitework'].includes(id) ? { isMilestone: true, milestone: 'M' } : {})],
    ['three tasks complete, two with no saved time (Completed Work\'s order)', id => (id === 'l2-steel' || id === 'grade' ? { status: 'Complete', percentComplete: 100, updatedAt: undefined } : id === 'touch' ? { status: 'Complete', percentComplete: 100, updatedAt: isoAt(-5) } : {})],
    ['a finish date the phone keeps as written ("TBD", "Jan 30")', id => (id === 'touch' ? { finishDate: 'TBD' } : id === 'pave' ? { finishDate: 'Jan 30' } : {})],
  ];
  for (const [name, more] of variants) {
    it(`${name}: both formats, one project and combined`, async () => {
      const world = (trim: string, projects = [P1]) => rowsOf(onThePhone({ projects, tasks: projects.flatMap(project => testProjectLike(trim, more, project)), updates: projects.map(fenceUpdate) }));
      const differ: string[] = [];
      for (const [format, all] of [['project_manager', false], ['executive', false], ['project_manager', true], ['executive', true]] as [Format, boolean][]) {
        const projects = all ? [P1, P2] : [P1];
        const check = await theCheck(world('02/05/2027', projects), world('01/15/2027', projects), format, all);
        if (check.computerText !== check.phoneText) differ.push(`${format}${all ? ' combined' : ''}: ${onlyIn(check.computerText, check.phoneText).filter(line => line.includes(' = ')).slice(0, 3).join(' | ')}`);
        if (check.computerFingerprint !== check.phoneSent) differ.push(`${format}${all ? ' combined' : ''}: fingerprint`);
      }
      expect(differ).toEqual([]);
    });
  }

  it('random owners (one or two projects; dates, baselines and milestones in every wording the records hold): the same text, both formats and all projects', async () => {
    const differ: string[] = [];
    for (let seed = 1; seed <= 10; seed += 1) {
      let state = seed * 2654435761 >>> 0;
      const r = () => { state = (state * 1664525 + 1013904223) >>> 0; return state / 2 ** 32; };
      const pick = <T,>(items: readonly T[]) => items[Math.floor(r() * items.length)];
      const day = (offset: number) => { const date = new Date(T0 + offset * DAY); const mm = String(date.getMonth() + 1).padStart(2, '0'); const dd = String(date.getDate()).padStart(2, '0'); return pick([`${mm}/${dd}/${date.getFullYear()}`, `${mm}/${dd}/${date.getFullYear()}`, `${date.getFullYear()}-${mm}-${dd}`, `${date.toLocaleDateString('en-US', { month: 'short' })} ${date.getDate()}, ${date.getFullYear()}`]); };
      const projects = r() < 0.5 ? [P1, P2] : [P1];
      const tasks = projects.flatMap(project => Array.from({ length: 3 + Math.floor(r() * 8) }, (_, i) => {
        const finish = Math.round(-20 + r() * 120);
        const percent = pick([0, 0, 30, 70, 100]);
        return task({
          id: `${project === P1 ? 'a' : 'b'}-${i}`, projectId: project.id, projectName: project.name, scheduleProjectName: project.name,
          taskName: `${pick(['Paint', 'Trim', 'Fence', 'Paving', 'Grading', 'Set steel'])} ${i}`, locationName: pick(['', 'Site', 'Level 2']),
          startDate: day(finish - 5), finishDate: r() < 0.1 ? '' : day(finish), percentComplete: percent, status: percent === 100 ? 'Complete' : percent ? 'In Progress' : 'Not Started',
          ...(r() < 0.4 ? { baselineFinishDate: day(finish - Math.round(r() * 10)) } : {}),
          ...(r() < 0.25 ? { isMilestone: true } : {}),
          ...(r() < 0.5 ? { updatedAt: isoAt(-r() * 6) } : {}),
        });
      }));
      const world = (shift: number) => rowsOf(onThePhone({ projects, tasks: tasks.map((item, index) => (index === 0 && shift ? { ...item, percentComplete: 0, status: 'Not Started' } : item)) }));
      for (const [format, all] of [['project_manager', false], ['executive', false], ...(projects.length > 1 ? [['project_manager', true], ['executive', true]] : [])] as [Format, boolean][]) {
        const check = await theCheck(world(1), world(0), format, all);
        if (check.computerText !== check.phoneText) differ.push(`seed ${seed} ${format}${all ? ' all' : ''}: ${onlyIn(check.computerText, check.phoneText).filter(line => line.includes(' = ')).slice(0, 2).join(' | ')}`);
      }
    }
    expect(differ).toEqual([]);
  });
});

describe('N761g: never the dangerous direction (a fact the phone counts changed since its send: the computer offers the report again)', () => {
  const rows = (more: (id: string) => Record<string, unknown> = () => ({}), updates: unknown[] = [fenceUpdate()], extra: unknown[] = []) =>
    rowsOf(onThePhone({ tasks: [...testProjectLike('01/15/2027', more), ...extra], updates }));
  const changes: [string, () => Rows, boolean][] = [
    ['Paint\'s finish a day later (the latest finish)', () => rows(id => (id === 's-paint' ? { finishDate: '01/23/2027' } : {})), true],
    ['Paint\'s finish a day earlier', () => rows(id => (id === 's-paint' ? { finishDate: '01/21/2027' } : {})), true],
    ['Trim\'s finish moved past Paint\'s', () => rows(id => (id === 's-trim' ? { finishDate: '02/01/2027' } : {})), true],
    ['Paint\'s percent', () => rows(id => (id === 's-paint' ? { percentComplete: 75 } : {})), true],
    ['Sitework given dates', () => rows(id => (id === 'sitework' ? { startDate: '02/01/2027', finishDate: '02/10/2027' } : {})), true],
    ['a task added, due after Paint', () => rows(undefined, undefined, [task({ id: 'late', taskName: 'Punch list', locationName: 'Site', startDate: '02/01/2027', finishDate: '02/12/2027', createdAt: isoAt(0.01) })]), true],
    ['a new field update on Paint', () => rows(undefined, [fenceUpdate(), update({ id: 'u-paint', date: isoAt(0.01), notes: 'Second coat started', selectedAreaName: 'Site', scheduleItemId: 's-paint', scheduleTaskName: 'Paint' })]), true],
    ['an ISO baseline given to Paint', () => rows(id => (id === 's-paint' ? { baselineFinishDate: '2027-01-08' } : {})), true],
    ['Paint made a milestone', () => rows(id => (id === 's-paint' ? { isMilestone: true } : {})), true],
    ['nothing (control)', () => rows(), false],
  ];
  it('each change after the phone\'s send: the phone\'s fingerprint and the computer\'s move together; the computer never says "already sent" for a changed report', async () => {
    const seen: string[] = [];
    const wrong: string[] = [];
    for (const format of ['project_manager', 'executive'] as const) {
      for (const [name, changed, moves] of changes) {
        const check = await theCheck(rowsOf(onThePhone({ tasks: testProjectLike('02/05/2027'), updates: [fenceUpdate()] })), rows(), format, false, changed());
        // The phone's own fingerprint of the changed rows, on the same period.
        useClock(T0 + 60_000);
        const phoneChanged = onThePhonesEngine(() => buildDAVEReportSourceOnPeriod(phoneTruths(downloaded(changed())), check.sent, format).fingerprint);
        jest.useRealTimers();
        const phoneMoved = phoneChanged !== check.phoneSent;
        const computerMoved = check.computerFingerprint !== check.phoneSent;
        seen.push(`${format} | ${name} | phone ${phoneMoved ? 'moved' : 'same'} | computer ${computerMoved ? 'moved (offers the report again)' : 'same ("already sent")'}`);
        if (check.computerFingerprint !== phoneChanged) wrong.push(`${format} ${name}: the computer's fingerprint is not the phone's`);
        if (phoneMoved && !computerMoved) wrong.push(`${format} ${name}: DANGEROUS (the computer says "already sent")`);
        // Every change is a fact the Project Manager report prints; the control is none.
        if (format === 'project_manager' && moves !== computerMoved) wrong.push(`${format} ${name}: ${computerMoved ? 'moved' : 'did not move'}`);
      }
    }
    keep('dangerous-direction', seen.join('\n'));
    expect(wrong).toEqual([]);
    expect(seen.filter(line => line.includes('nothing (control)'))).toEqual([
      'project_manager | nothing (control) | phone same | computer same ("already sent")',
      'executive | nothing (control) | phone same | computer same ("already sent")',
    ]);
  });
});
