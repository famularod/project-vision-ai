jest.mock('expo-file-system/legacy', () => ({ documentDirectory: null }));
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: jest.fn(async () => null), setItem: jest.fn(async () => undefined), getAllKeys: jest.fn(async () => []) },
}));

import fs from 'fs';
import path from 'path';
import ts from 'typescript';
import { buildFusedEvidence, fieldUpdatesNewestFirst } from '../../services/PIEEvidenceFusion';
import { buildDailyProjectUpdate, buildCombinedProjectUpdate } from '../../services/PIEReporter';
import { buildRuntime } from '../../services/PIERuntime';
import { loadDAVEWebReadOnlySnapshot } from '../../services/DAVEWebReadOnlyRepository';
import { daveWebSupabaseGateway } from '../../services/DAVEWebSupabaseClient';
import { buildDAVEReportProjectTruths } from '../../services/DAVEReportProjectTruths';
import { buildDAVELegacyReportSourceFingerprint, buildDAVEReportSourceFingerprint } from '../../services/DAVEReportIntelligence';
import { buildDAVEWebReportTruths } from '../../services/DAVEWebOperations';
import { reportTextKey } from '../../services/DAVEReportSnapshot';
jest.mock('../../services/DAVEWebSupabaseClient', () => ({ daveWebSupabaseGateway: { loadAuthorizedRows: jest.fn() } }));
import type { ProjectUpdate } from '../../types';

const NOW = '2026-10-17T23:00:00Z';
function update(id: string, date: string, sendTappedAt: string | undefined, notes: string, projectName = 'Tower'): ProjectUpdate {
  return { id, date, projectName, scheduleProjectName: projectName, selectedAreaName: 'Roof', notes,
    recipients: { contactIds: [] }, status: 'sent', photos: [],
    workflowTimestamps: { startedAt: `${date}T15:00:00Z`, ...(sendTappedAt ? { sendTappedAt } : {}) },
  } as ProjectUpdate;
}
const morning = () => update('u-morning', '2026-10-17', '2026-10-17T22:00:00Z', 'Neighbor asked about weekend hours.');
const midday = () => update('u-noon', '2026-10-17', '2026-10-17T19:00:00Z', 'Conference table arrived.');
const fusion = (updates: ProjectUpdate[]) => buildFusedEvidence({ projectName: 'Tower', projectNames: ['Tower'], updates,
  scheduleItems: [], knownScheduleItems: [], now: new Date(NOW) });
const report = (updates: ProjectUpdate[]) => {
  const f = fusion(updates);
  return buildDailyProjectUpdate({ selectedProjectNames: ['Tower'], savedUpdates: updates, scheduleItems: [],
    runtime: { fusedEvidence: f, intelligentSummary: f.intelligentSummary } } as never);
};

beforeEach(() => jest.useFakeTimers({ now: Date.parse(NOW) }));
afterEach(() => jest.useRealTimers());

it('runtime and written report name the morning draft sent in the afternoon, on either device', () => {
  const a = morning(), b = midday();
  for (const rows of [[a, b], [b, a]]) {
    const runtime = buildRuntime({ projectName: 'Tower', projectNames: ['Tower'], surface: 'reports', reportType: 'daily_project_update',
      updates: rows, scheduleItems: [], knownScheduleItems: [], currentUpdate: null, projectAreas: [], contacts: { contacts: [] }, referenceDocuments: [] } as never);
    expect(runtime.fusedEvidence.intelligentSummary.whatChanged).toContain(`Latest update: ${a.notes}`);
    expect(runtime.response.reportDraft.body).toContain(`Latest update: ${a.notes}`);
  }
  expect(report([a, b]).body).toBe(report([b, a]).body);
});

it('a draft started yesterday and sent today beats one started and sent in between', () => {
  const a = { ...morning(), date: '2026-10-16' }, b = midday();
  expect(fusion([b, a]).intelligentSummary.whatChanged).toContain(`Latest update: ${a.notes}`);
  expect(report([b, a]).body).toContain(`Latest update: ${a.notes}`);
});

it('combined reports use the same send order without changing project ownership', () => {
  const a = morning(), b = { ...midday(), projectName: 'Other', scheduleProjectName: 'Other' };
  const f = buildFusedEvidence({ projectName: 'Tower', projectNames: ['Tower', 'Other'], updates: [b, a], scheduleItems: [], knownScheduleItems: [], now: new Date(NOW) });
  const draft = buildCombinedProjectUpdate({ selectedProjectNames: ['Tower', 'Other'], savedUpdates: [b, a], scheduleItems: [],
    runtime: { fusedEvidence: f, intelligentSummary: f.intelligentSummary } } as never);
  expect(draft.body).toContain(`Latest update: ${a.notes}`);
  expect(draft.locationGroups.flatMap(g => g.workAreas).find(a => a.projectName === 'Other')?.bullets.some(line => line.text.includes('Latest update:'))).toBe(false);
});

it('a late failed or background resolution cannot outrank the authored save/send', () => {
  const a = morning(), b = { ...midday(), workflowTimestamps: { ...midday().workflowTimestamps, sendResolvedAt: '2026-10-18T03:00:00Z' } };
  expect(fusion([b, a]).intelligentSummary.whatChanged).toContain(`Latest update: ${a.notes}`);
  expect(fieldUpdatesNewestFirst([b, a]).map(u => u.id)).toEqual([a.id, b.id]);
});

it('uses legacy date/id order with missing or malformed send taps and stays deterministic on equal send times', () => {
  const a = update('a', '2026-10-15', undefined, 'One.'), b = update('b', '2026-10-16', 'not-a-timestamp', 'Two.');
  expect(fieldUpdatesNewestFirst([a, b]).map(u => u.id)).toEqual(['b', 'a']);
  const c = { ...a, workflowTimestamps: { sendTappedAt: NOW } }, d = { ...b, workflowTimestamps: { sendTappedAt: NOW } };
  expect(fieldUpdatesNewestFirst([c, d]).map(u => u.id)).toEqual(['b', 'a']);
  expect(fieldUpdatesNewestFirst([d, c]).map(u => u.id)).toEqual(['b', 'a']);
});

it('report latest-photo selection follows the newest sent update rather than the later-started draft', () => {
  const a = morning(), b = midday();
  for (const row of [a, b]) row.photos = [{ id: `photo-${row.id}`, uri: `file:///synthetic-${row.id}.jpg`, caption: row.id === a.id ? 'Morning draft photo' : 'Midday draft photo',
    category: 'Update', actionRequired: '', actionOwner: '', actionDueDate: '', actionStatus: 'Open', selectedAreaName: 'Roof' }] as ProjectUpdate['photos'];
  expect(fusion([b, a]).intelligentSummary.whatChanged).toContain('Latest photo: Morning draft photo');
});

// Execute the actual App consumer from its committed source, keeping unrelated app boot/I/O out of this test.
function appFunction(name: string, dependencies: Record<string, unknown>) {
  const text = fs.readFileSync(path.resolve(__dirname, '../../App.tsx'), 'utf8');
  const tree = ts.createSourceFile('App.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const node = tree.statements.find((n): n is ts.FunctionDeclaration => ts.isFunctionDeclaration(n) && n.name?.text === name);
  if (!node) throw new Error(`Missing production function ${name}`);
  const code = ts.transpileModule(`const extracted = ${node.getText(tree)};`, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
  return new Function(...Object.keys(dependencies), `${code}; return extracted;`)(...Object.values(dependencies));
}

it('Home project-card chooses and dates the last authored send, preserving draft and failure precedence', () => {
  const chronology = jest.requireActual('../../services/PIEEvidenceFusion');
  const shared = jest.requireActual('../../services/FieldUpdateChronology');
  const updateDateValue = appFunction('updateDateValue', { parsePlainDate: jest.requireActual('../../services/ProjectDateTime').parsePlainDate });
  const relativeUpdateDateLabel = appFunction('relativeUpdateDateLabel', { updateDateValue, formatDisplayDate: (v: string) => v });
  const card = appFunction('buildProjectCardPIEStatus', { ...chronology, ...shared,
    projectMatchesScope: (u: ProjectUpdate, p: string) => u.projectName === p,
    findCurrentDAVEConfirmedBlocker: () => null, updateHasSafetyConcern: () => false,
    lifecycleStatusForUpdate: (u: ProjectUpdate) => u.status || 'draft', queuedStatusCopyForUpdate: () => 'Failure requires retry',
    PIE_STATUS_COPY: { unavailableRetry: 'Retry analysis' }, relativeUpdateDateLabel,
  });
  const late = { ...morning(), date: '2026-10-15' }, yesterday = { ...midday(), date: '2026-10-16', workflowTimestamps: { sendTappedAt: '2026-10-16T19:00:00Z' } };
  expect(card(['Tower'], [yesterday, late])).toBe('Last update cloud synced today');
  expect(card(['Other'], [yesterday, late])).toBe('No recent updates');
  expect(card(['Tower'], [late, { ...yesterday, status: 'failed' }])).toBe('Failure requires retry');
  expect(card(['Tower'], [{ ...late, status: 'ready_to_send' }])).toBe('Draft ready to sync');
});

it.each(['draft', 'queued', 'failed', 'ready_to_send'] as const)('an unsent %s record cannot use a leftover send timestamp as acknowledged chronology', status => {
  const a = morning(), b = { ...midday(), date: '2026-10-15', status, workflowTimestamps: { sendTappedAt: '2026-10-18T23:00:00Z' } };
  expect(fusion([b, a]).intelligentSummary.whatChanged).toContain(`Latest update: ${a.notes}`);
  expect(fieldUpdatesNewestFirst([b, a]).map(u => u.id)).toEqual([a.id, b.id]);
});

it('the actual desktop receiver treats a loaded queued-verbatim cloud row as the same acknowledged send', async () => {
  const a = morning(), b = midday();
  const rows = [b, a].map(u => ({ id: u.id, project_name: 'Tower', update_data: { ...u, status: 'queued' }, created_at: NOW, updated_at: NOW }));
  jest.mocked(daveWebSupabaseGateway.loadAuthorizedRows).mockResolvedValue({ projects: [{ id: 'tower', name: 'Tower', archived: false }],
    scheduleItems: [], projectUpdates: rows, referenceDocuments: [], syncTombstones: [] } as never);
  const before = JSON.stringify(rows);
  const snapshot = await loadDAVEWebReadOnlySnapshot();
  const received = snapshot.projectUpdates.map(row => row.updateData);
  // These are actual downloaded cloud rows; local queued records elsewhere remain ineligible.
  expect(received.every(u => u.status === 'queued')).toBe(true);
  const native = buildDAVEReportProjectTruths({ projects: [{ name: 'Tower', projectId: 'tower' }], projectRecords: [{ name: 'Tower' }], updates: [a, b],
    scheduleItems: [], knownScheduleItems: [], knownScheduleDocuments: [], projectAreas: [], referenceDocuments: [], now: snapshot.refreshedAt } as never);
  expect(buildDAVEReportSourceFingerprint(buildDAVEWebReportTruths(snapshot, null))).toBe(buildDAVEReportSourceFingerprint(native));
  expect(JSON.stringify(rows)).toBe(before);
});

it('changed authored-send ordering changes app text while preserving the actual raw fingerprint contract', () => {
  const a = { ...morning(), notes: 'Roof membrane was installed.' }, b = { ...midday(), notes: 'Roof flashing was installed.' };
  const original = [a, b], switched = [{ ...a, workflowTimestamps: { sendTappedAt: '2026-10-17T17:00:00Z' } }, b];
  const truths = (updates: ProjectUpdate[]) => buildDAVEReportProjectTruths({ projects: [{ name: 'Tower', projectId: 'report:tower' }], projectRecords: [{ name: 'Tower' }],
    updates, scheduleItems: [], knownScheduleItems: [], knownScheduleDocuments: [], projectAreas: [], referenceDocuments: [], now: NOW } as never);
  const before = report(original), after = report(switched);
  expect(before.body).toContain(`Latest update: ${a.notes}`);
  expect(after.body).toContain(`Latest update: ${b.notes}`);
  expect(reportTextKey(before)).not.toBe(reportTextKey(after));
  expect(buildDAVEReportSourceFingerprint(truths(original))).toBe(buildDAVEReportSourceFingerprint(truths(switched)));
  // Literal raw 1.0 golden values captured before the receiver/approval repair.
  expect(buildDAVELegacyReportSourceFingerprint(truths(original))).toBe('dave-report-source/1.0:bc0fcab8');
  expect(buildDAVELegacyReportSourceFingerprint(truths(switched))).toBe('dave-report-source/1.0:6d0c9e01');
});

it('App relative send labels use local midnight for Z and offset timestamps and preserve legacy day-only fallback', () => {
  jest.setSystemTime(new Date('2026-10-18T07:30:00Z'));
  class PacificDate extends Date {
    toDateString(): string { return new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(this); }
  }
  const updateDateValue = appFunction('updateDateValue', { Date: PacificDate, parsePlainDate: jest.requireActual('../../services/ProjectDateTime').parsePlainDate });
  const label = appFunction('relativeUpdateDateLabel', { Date: PacificDate, updateDateValue, formatDisplayDate: (v: string) => v });
  expect(label('2026-10-18T07:01:00Z')).toBe('today');
  expect(label('2026-10-18T00:01:00-07:00')).toBe('today');
  expect(label('2026-10-18T06:59:00Z')).toBe('yesterday');
  expect(label('2026-10-17T23:59:00-07:00')).toBe('yesterday');
  // 7.66: a calendar-only update names this local day. Explicit timestamp expectations above stay unchanged.
  expect(label('2026-10-18')).toBe('today');
  expect(label('not-a-date')).toBe('not-a-date');
});

it.each(['2026-10-18', '0', 'not-a-timestamp'])('a malformed tap %j retains the valid legacy day', sendTappedAt => {
 const a=morning(), b={...midday(),date:'2026-10-15',workflowTimestamps:{sendTappedAt}};
 expect(fieldUpdatesNewestFirst([b,a]).map(u=>u.id)).toEqual([a.id,b.id]);
});
