/**
 * Whole-app audit A5 pass 11 M-a (30 Sep 2026): a building's task disappeared
 * on every device once David entered progress on the other building's twin.
 *
 * One Microsoft Project master files Harbor North's and Harbor South's rows
 * under one root summary row ("PLZ 2400 Harbor Project"); both keep that root
 * as their schedule project, with Harbor North or Harbor South as their app
 * project. Both buildings have "Install HVAC" on the same dates in the same
 * area (or both with no area). David enters 40% on North's. The schedule
 * reconcile (DAVEScheduleRecovery) treated two rows as one scope by the root,
 * so South's Install HVAC was dropped as superseded by North's PM-edited row:
 * at approval, at startup, in every recovery merge and in the web's read.
 *
 * Now the reconcile keys its scope by the app project (scheduleTaskProjectKey,
 * as the merge and the delete do since A8 pass 9), so each building keeps its
 * own task. A single-project Microsoft Project master still reconciles its
 * duplicates as before. Real Microsoft Project normalizer and merge.
 * Synthetic data.
 */
import type { ReferenceDocument, ScheduleItem } from '../../types';

jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() }));
jest.mock('../../services/DAVEWebSupabaseClient', () => ({
  ...jest.requireActual('../../services/DAVEWebSupabaseClient'),
  daveWebSupabaseGateway: { loadAuthorizedRows: jest.fn() },
}));

import { recoverDAVEScheduleRecords, reconcileDAVEScheduleRecords } from '../../services/DAVEScheduleRecovery';
import { loadDAVEWebReadOnlySnapshot } from '../../services/DAVEWebReadOnlyRepository';
import { daveWebSupabaseGateway } from '../../services/DAVEWebSupabaseClient';
import { normalizeMicrosoftProjectPdfRows } from '../../services/PIEScheduleIntelligence';
import { selectAuthoritativeScheduleItems } from '../../services/PIEScheduleReconciliation';
import { mergeApprovedScheduleImportItems, scheduleItemsVisibleBeforeImport } from '../../services/ScheduleImportMerge';

const HARBOR = ['Harbor North', 'Harbor South'];
const schedule = (id: string, importedAt: string, projects: string[]): ReferenceDocument => ({
  id, name: id, originalFileName: `${id}.pdf`, uri: '', category: 'Schedules', notes: '', isCurrent: true, importedAt,
  projectId: null, projectName: null, projectNames: projects, importBatchId: `batch-${id}`,
}) as ReferenceDocument;

type Line = readonly [name: string, indent: number, dates: string, percent: string];
function mspRows(source: ReferenceDocument, projects: string[], lines: readonly Line[]): ScheduleItem[] {
  const contents = [
    'ID\tTask Name\tIndent\tDuration\tStart\tFinish\tPercent Complete',
    '1\tPLZ 2400 Harbor Project\t0\t90 days\t09/01/2026\t12/01/2026\t10%',
    ...lines.map(([name, indent, dates, percent], index) => `${index + 2}\t${name}\t${indent}\t3 days\t${dates}\t${percent}`),
  ].join('\n');
  return normalizeMicrosoftProjectPdfRows({ contents, sourceName: source.originalFileName, projects, now: new Date(source.importedAt) })
    .map((row, index) => ({ ...row, id: `${source.id}-${index + 1}`, importBatchId: source.importBatchId, sourceDocumentId: source.id }));
}

type State = { items: ScheduleItem[]; documents: ReferenceDocument[] };
function approve(state: State, source: ReferenceDocument, imported: ScheduleItem[]): State {
  const documents = [...state.documents, source];
  const merged = mergeApprovedScheduleImportItems({
    existing: state.items, imported, completionMatch: () => null, mergeCompletion: item => item,
    isCurrent: scheduleItemsVisibleBeforeImport(state.items, documents, source.importBatchId || ''), approvedAt: source.importedAt,
  });
  return { items: [...merged.additions, ...merged.next], documents };
}
/** David enters a percent on the phone. */
const entered = (items: readonly ScheduleItem[], id: string, percentComplete: number, at: string): ScheduleItem[] =>
  items.map(item => item.id === id ? {
    ...item, percentComplete, status: 'In Progress', progressSource: 'project_manager', progressConfirmedAt: at, progressConfirmedBy: 'David', updatedAt: at,
  } as ScheduleItem : item);
const hvacOf = (items: readonly ScheduleItem[], project: string) =>
  items.filter(item => item.taskName === 'Install HVAC' && item.projectName === project);
const inArea = (items: readonly ScheduleItem[], project: string | null, locationName: string) =>
  items.map(item => !project || item.projectName === project ? { ...item, locationName } : item);
const projectsOf = (items: readonly ScheduleItem[]) =>
  items.filter(item => item.taskName === 'Install HVAC').map(item => [item.projectName, item.percentComplete]).sort();

const AT_40 = '2026-09-28T15:00:00.000Z';
const master = schedule('HARBOR 0915', '2026-09-15T12:00:00.000Z', HARBOR);
const masterRows = mspRows(master, HARBOR, [
  ['Harbor North', 1, '09/01/2026\t10/31/2026', '10%'],
  ['Install HVAC', 2, '10/05/2026\t10/07/2026', '0%'],
  ['Harbor South', 1, '09/01/2026\t10/31/2026', '10%'],
  ['Install HVAC', 2, '10/05/2026\t10/07/2026', '0%'],
]);

describe('A5 p11 M-a: the schedule reconcile never takes one building\'s task for the other\'s under one Gantt root', () => {
  const approved = approve({ items: [], documents: [] }, master, masterRows);
  const north = hvacOf(approved.items, 'Harbor North')[0];
  const withForty = entered(approved.items, north.id, 40, AT_40);

  it('the scenario: both buildings\' Install HVAC share the root, the dates and no area, and the approval keeps both', () => {
    const [south] = hvacOf(approved.items, 'Harbor South');
    expect(north.scheduleProjectName).toBeTruthy();
    expect(south.scheduleProjectName).toBe(north.scheduleProjectName);
    expect([south.startDate, south.finishDate, south.locationName || '']).toEqual([north.startDate, north.finishDate, north.locationName || '']);
    expect(south.id).not.toBe(north.id);
  });

  it('after David enters 40% on North\'s, the reconcile keeps South\'s task at 0%', () => {
    expect(projectsOf(reconcileDAVEScheduleRecords(withForty))).toEqual([['Harbor North', 40], ['Harbor South', 0]]);
    expect(projectsOf(selectAuthoritativeScheduleItems({ scheduleItems: withForty, scheduleDocuments: approved.documents }) as ScheduleItem[]))
      .toEqual([['Harbor North', 40], ['Harbor South', 0]]);
  });

  it('in the same area too', () => {
    const sameArea = inArea(withForty, null, 'Level 2');
    expect(projectsOf(reconcileDAVEScheduleRecords(sameArea))).toEqual([['Harbor North', 40], ['Harbor South', 0]]);
  });

  it('startup recovery and every Full Sync recovery merge keep both buildings\' tasks', () => {
    expect(projectsOf(recoverDAVEScheduleRecords({ local: withForty, cloud: [], allowCloudOnly: false })))
      .toEqual([['Harbor North', 40], ['Harbor South', 0]]);
    // Another phone still holds the approval's 0% for both; the cloud has David's 40%.
    expect(projectsOf(recoverDAVEScheduleRecords({ local: approved.items, cloud: withForty, allowCloudOnly: true })))
      .toEqual([['Harbor North', 40], ['Harbor South', 0]]);
    expect(projectsOf(recoverDAVEScheduleRecords({ local: withForty, cloud: approved.items, allowCloudOnly: true })))
      .toEqual([['Harbor North', 40], ['Harbor South', 0]]);
  });

  it('the web\'s read keeps both buildings\' tasks', async () => {
    jest.mocked(daveWebSupabaseGateway.loadAuthorizedRows).mockResolvedValue({
      projects: HARBOR.map(name => ({ id: name, name, archived: false })),
      scheduleItems: withForty.map(item => ({ id: item.id, updated_at: AT_40, item_data: item })),
      projectUpdates: [],
      referenceDocuments: [],
      syncTombstones: [],
    } as never);
    const snapshot = await loadDAVEWebReadOnlySnapshot();
    expect(projectsOf(snapshot.scheduleItems)).toEqual([['Harbor North', 40], ['Harbor South', 0]]);
  });

  it('a building\'s task with no area is not taken as an older copy of the other building\'s with one', () => {
    // North's Install HVAC has no area; South's is on Level 2 (legacy alias check).
    const southInArea = inArea(approved.items, 'Harbor South', 'Level 2');
    expect(projectsOf(reconcileDAVEScheduleRecords(southInArea))).toEqual([['Harbor North', 0], ['Harbor South', 0]]);
  });

  it('rows saved before import provenance keep both buildings\' tasks (legacy duplicate check)', () => {
    const legacy = approved.items.map(({ importBatchId: _batch, sourceDocumentId: _document, ...item }) =>
      (item.projectName === 'Harbor North' ? { ...item, notes: 'Ducts on site.', updatedAt: AT_40 } : item) as ScheduleItem);
    expect(projectsOf(reconcileDAVEScheduleRecords(legacy))).toEqual([['Harbor North', 0], ['Harbor South', 0]]);
  });

  describe('a single-project Microsoft Project master still reconciles normally', () => {
    const ONE = ['Harbor North'];
    const single = schedule('NORTH 0915', '2026-09-15T12:00:00.000Z', ONE);
    const singleRows = mspRows(single, ONE, [
      ['Harbor North', 1, '09/01/2026\t10/31/2026', '10%'],
      ['Install HVAC', 2, '10/05/2026\t10/07/2026', '0%'],
    ]);
    const [row] = hvacOf(approve({ items: [], documents: [] }, single, singleRows).items, 'Harbor North');

    it('David\'s 40% supersedes the same import\'s duplicate of the task', () => {
      const replayed = { ...row, id: `${row.id}-replayed` };
      const items = [...entered([row], row.id, 40, AT_40), replayed];
      expect(reconcileDAVEScheduleRecords(items)).toEqual([expect.objectContaining({ id: row.id, percentComplete: 40 })]);
    });

    it('an area-less copy of the task gives way to the one with its area', () => {
      const withArea = { ...row, id: `${row.id}-area`, locationName: 'Level 2' };
      expect(reconcileDAVEScheduleRecords([row, withArea])).toEqual([expect.objectContaining({ id: withArea.id })]);
    });

    it('a copy saved without the root still reconciles with the copy that has it', () => {
      const withoutRoot = { ...row, id: `${row.id}-no-root`, scheduleProjectName: null };
      const items = [...entered([row], row.id, 40, AT_40), withoutRoot];
      expect(reconcileDAVEScheduleRecords(items)).toEqual([expect.objectContaining({ id: row.id, percentComplete: 40 })]);
    });
  });
});
