/**
 * Owner answer Q25 (David, 2 Oct 2026): "YES, the newest lookahead for a
 * project replaces older ones." Until now every lookahead stayed in effect
 * until he deleted it (owner answer Q22), so with a weekly three-week
 * lookahead the detail tasks that finished and dropped off the next one piled
 * up as overdue on Home and in his reports, old lookahead dates stayed on
 * master tasks, and the web listed every old lookahead as protected.
 *
 * Now, when a newer lookahead for the same project is approved:
 * - a master task an older one moved, that the newer one does not list, goes
 *   back to the master's dates (dates David moved by hand stay), keeping its
 *   percent: David's own is never lowered (Q22 floor);
 * - tasks only older lookaheads added leave the task list (their field notes
 *   and photos are untouched: nothing is deleted);
 * - the older file stays under Schedule Sources, "Replaced by the lookahead
 *   of <date>", and on the web it is a prior version, not protected;
 * - a lookahead's detail tasks are listed but leave % Complete to the
 *   master's scope (A10 pass 3 L1): adding detail never makes the project
 *   look less done;
 * - the iPad and the web, with the same tasks and schedules (a refresh or
 *   Full Sync), show the same.
 * Deleting the newest lookahead puts the one before it back in effect.
 *
 * Real CSV normalizer, the phone's merge, the shown-schedule pick, the delete
 * helpers, the web snapshot and document groups, the Home rollup and the
 * report condition. Synthetic data.
 */
import type { ReferenceDocument, ScheduleItem } from '../../types';
import { buildDAVEProjectScheduleRollup } from '../../services/dave-project-schedule-rollup';
import { buildDAVEProjectTruth } from '../../services/DAVEProjectTruth';
import { buildDAVEReportBriefing } from '../../services/DAVEReportIntelligence';
import { reconcileDAVEScheduleRecords } from '../../services/DAVEScheduleRecovery';
import { daveWebDocumentDeletionIsProtected, groupDAVEWebDocuments } from '../../services/DAVEWebDocumentManagement';
import { planDAVEWebScheduleImport } from '../../services/DAVEWebOperations';
import { buildDAVEWebScheduleItem, type DAVEWebScheduleItem } from '../../services/DAVEWebTaskEditing';
import { loadDAVEWebReadOnlySnapshot } from '../../services/DAVEWebReadOnlyRepository';
import { daveWebSupabaseGateway } from '../../services/DAVEWebSupabaseClient';
import { normalizeScheduleImport } from '../../services/PIEScheduleIntelligence';
import {
  scheduleDocumentCurrentLabel,
  scheduleDocumentIsScheduleLike,
  scheduleLookaheadInEffect,
  selectAuthoritativeScheduleItems,
} from '../../services/PIEScheduleReconciliation';
import { mergeApprovedScheduleImportItems, scheduleItemsVisibleBeforeImport } from '../../services/ScheduleImportMerge';
import { scheduleItemsOnlyInImportBatch, scheduleTasksSettingProjectScope } from '../../services/ScheduleImportProvenance';
import { scheduleItemsAfterScheduleDeleted, scheduleLookaheadDeleteNote } from '../../services/ScheduleLookahead';
import { scheduleDocumentsAfterActivation } from '../../services/SharedDocumentActivation';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async () => null),
  setItem: jest.fn(async () => undefined),
  removeItem: jest.fn(async () => undefined),
  getAllKeys: jest.fn(async () => []),
  multiGet: jest.fn(async () => []),
}));
jest.mock('expo-file-system/legacy', () => ({ documentDirectory: null }));
jest.mock('../../services/DAVEWebSupabaseClient', () => ({
  daveWebSupabaseGateway: { loadAuthorizedRows: jest.fn() },
}));

type State = { items: ScheduleItem[]; documents: ReferenceDocument[] };
const EMPTY: State = { items: [], documents: [] };
const shown = (state: State) => selectAuthoritativeScheduleItems({ scheduleItems: state.items, scheduleDocuments: state.documents }) as ScheduleItem[];
const named = (state: State, name: string) => shown(state).filter(item => item.taskName === name);
const one = (state: State, name: string) => {
  const found = named(state, name);
  expect(found).toHaveLength(1);
  return found[0];
};
const dates = (item: ScheduleItem) => `${item.startDate}-${item.finishDate}`;

const schedule = (id: string, importedAt: string, role?: 'lookahead', project = 'Alpha'): ReferenceDocument => ({
  id, name: id, originalFileName: `${id}.csv`, uri: '', category: 'Schedules', notes: '', isCurrent: true, importedAt,
  projectId: null, projectName: project, projectNames: [project], importBatchId: `batch-${id}`, ...(role ? { scheduleRole: role } : {}),
}) as ReferenceDocument;

/** A CSV's rows through the real normalizer, with the import's provenance. */
function rows(source: ReferenceDocument, lines: string[], project = 'Alpha'): ScheduleItem[] {
  return (normalizeScheduleImport({
    contents: ['Task,Project,Area,Start,Finish,Percent Complete', ...lines].join('\n'), sourceName: source.originalFileName,
    mimeType: 'text/csv', projects: [project], projectAreas: [], now: new Date(source.importedAt),
  }).items as ScheduleItem[]).map((item, index) => ({
    ...item, id: `${source.id}-${index + 1}`, importBatchId: source.importBatchId, sourceDocumentId: source.id,
  }));
}

/** Approving a schedule on the phone (App.tsx): the merge, then a master is made current, a lookahead added. */
function approve(state: State, source: ReferenceDocument, lines: string[], project = 'Alpha'): State {
  const lookahead = source.scheduleRole === 'lookahead';
  const merged = mergeApprovedScheduleImportItems({
    existing: state.items, imported: rows(source, lines, project), completionMatch: () => null, mergeCompletion: item => item,
    isCurrent: scheduleItemsVisibleBeforeImport(state.items, [...state.documents, source], source.importBatchId || ''),
    approvedAt: source.importedAt, overlay: lookahead,
  });
  return {
    items: reconcileDAVEScheduleRecords([...merged.additions, ...merged.next]),
    documents: lookahead ? [...state.documents, source] : scheduleDocumentsAfterActivation(source, [...state.documents, source], 'project'),
  };
}

/** David's own entry on the phone. */
function edit(state: State, id: string, change: Partial<ScheduleItem>, at: string): State {
  return {
    ...state,
    items: state.items.map(item => item.id === id ? {
      ...item, ...change,
      ...(typeof change.percentComplete === 'number' ? {
        status: change.percentComplete >= 100 ? 'Complete' : 'In Progress', progressSource: 'project_manager',
        progressConfirmedAt: at, progressConfirmedBy: 'David', progressJudgment: undefined,
      } : {}),
      updatedAt: at,
    } as ScheduleItem : item),
  };
}

/** "Delete PDF + Items" as the phone does it (App.tsx), through the shared delete helper. */
function deleteWithItems(state: State, document: ReferenceDocument, at: string): State {
  const removed = scheduleItemsOnlyInImportBatch(state.items, document, state.documents.filter(scheduleDocumentIsScheduleLike));
  const removedIds = new Set(removed.map(item => item.id));
  const documents = state.documents.filter(other => other.id !== document.id);
  const kept = state.items.filter(item => !removedIds.has(item.id));
  const saved = new Map(scheduleItemsAfterScheduleDeleted({ items: kept, removed, document, documents, updatedAt: at }).map(item => [item.id, item]));
  return { items: kept.map(item => saved.get(item.id) || item), documents };
}

const F = schedule('MASTER F', '2026-09-20T12:00:00.000Z');
const L1 = schedule('Alpha lookahead wk 40', '2026-09-28T12:00:00.000Z', 'lookahead');
const L2 = schedule('Alpha lookahead wk 41', '2026-10-05T12:00:00.000Z', 'lookahead');
const L3 = schedule('Alpha lookahead wk 42', '2026-10-12T12:00:00.000Z', 'lookahead');
const L4 = schedule('Alpha lookahead wk 43', '2026-10-19T12:00:00.000Z', 'lookahead');
const NOW = new Date('2026-10-21T15:00:00.000Z');

const onF = approve(EMPTY, F, [
  'Framing,Alpha,Lot,10/01/2026,10/30/2026,0',
  'Roof,Alpha,Lot,10/05/2026,10/16/2026,0',
  'Drywall,Alpha,Lot,11/02/2026,11/20/2026,0',
]);
// Week 40: Framing and Roof move, and two detail tasks are added.
const onL1 = approve(onF, L1, [
  'Framing,Alpha,Lot,10/03/2026,11/02/2026,20',
  'Roof,Alpha,Lot,10/06/2026,10/17/2026,',
  'Install sleeves,Alpha,Lot,09/29/2026,10/02/2026,50',
]);
// Week 41 lists Framing again (David's 45% after it), drops Roof and the finished sleeves, adds anchors.
const onL2 = approve(onL1, L2, [
  'Framing,Alpha,Lot,10/03/2026,11/02/2026,40',
  'Set anchors,Alpha,Lot,10/06/2026,10/09/2026,0',
]);
const framingId = one(onF, 'Framing').id;
const roofId = one(onF, 'Roof').id;
const onL2David = edit(onL2, framingId, { percentComplete: 45 }, '2026-10-06T15:00:00.000Z');
// Week 42 moves Framing on and states 60%; Roof is back with 10%; trusses are added.
const onL3 = approve(onL2David, L3, [
  'Framing,Alpha,Lot,10/03/2026,11/04/2026,60',
  'Roof,Alpha,Lot,10/14/2026,10/25/2026,10',
  'Hang trusses,Alpha,Lot,10/13/2026,10/16/2026,0',
]);
// Week 43 drops Framing (it rolls off the window) and lists Roof and one new detail task.
const onL4 = approve(onL3, L4, [
  'Roof,Alpha,Lot,10/14/2026,10/27/2026,30',
  'Flash vents,Alpha,Lot,10/20/2026,10/23/2026,0',
]);

describe('Q25: the newest lookahead for a project replaces older ones', () => {
  it('detail tasks of older lookaheads leave the task list; the newest one\'s stay; nothing is deleted', () => {
    expect(named(onL1, 'Install sleeves')).toHaveLength(1);
    expect(named(onL2, 'Install sleeves')).toEqual([]);
    expect(named(onL2, 'Set anchors')).toHaveLength(1);
    expect(shown(onL4).map(item => item.taskName).sort()).toEqual(['Drywall', 'Flash vents', 'Framing', 'Roof']);
    // Nothing deleted: every row is still saved, so field notes and photos keep their task.
    expect(['Install sleeves', 'Set anchors', 'Hang trusses'].every(name => onL4.items.some(item => item.taskName === name))).toBe(true);
  });

  it('no overdue phantoms on Home: only tasks still in effect count', () => {
    const rollup = buildDAVEProjectScheduleRollup({ projectName: 'Alpha', items: shown(onL4), now: NOW });
    // Every past-finish task shown is a real one: none of the dropped detail tasks.
    expect(rollup.tasks.map(item => item.taskName).sort()).toEqual(['Drywall', 'Flash vents', 'Framing', 'Roof']);
    expect(rollup.tasks.filter(item => ['Install sleeves', 'Set anchors', 'Hang trusses'].includes(item.taskName))).toEqual([]);
  });

  it('a master task an older lookahead moved goes back to the master\'s dates unless the newer one lists it', () => {
    // L2 does not list Roof: back to F's 10/05-10/16.
    expect(dates(one(onL1, 'Roof'))).toBe('10/06/2026-10/17/2026');
    expect(dates(one(onL2, 'Roof'))).toBe('10/05/2026-10/16/2026');
    // L2 lists Framing: it keeps L2's dates.
    expect(dates(one(onL2, 'Framing'))).toBe('10/03/2026-11/02/2026');
    // L4 drops Framing: back to F's 10/01-10/30; L4 lists Roof: L4's dates.
    expect(dates(one(onL4, 'Framing'))).toBe('10/01/2026-10/30/2026');
    expect(dates(one(onL4, 'Roof'))).toBe('10/14/2026-10/27/2026');
    // Same task record throughout (restated in place).
    expect(one(onL4, 'Framing').id).toBe(framingId);
    expect(one(onL4, 'Roof').id).toBe(roofId);
  });

  it('dates David moved by hand are kept', () => {
    const moved = edit(onL3, framingId, { startDate: '10/05/2026', finishDate: '11/06/2026' }, '2026-10-13T15:00:00.000Z');
    const after = approve(moved, L4, ['Roof,Alpha,Lot,10/14/2026,10/27/2026,30']);
    expect(dates(one(after, 'Framing'))).toBe('10/05/2026-11/06/2026');
  });

  it('David\'s own percent is never lowered; a lookahead\'s percent stays when its task rolls off', () => {
    expect(one(onL2David, 'Framing').percentComplete).toBe(45);
    expect(one(onL3, 'Framing').percentComplete).toBe(60);
    expect(one(onL4, 'Framing').percentComplete).toBe(60);
    // David at 70% on Roof; a newer lookahead stating 30% and another dropping it leave 70%.
    const davidRoof = edit(onL3, roofId, { percentComplete: 70 }, '2026-10-13T15:00:00.000Z');
    const withL4 = approve(davidRoof, L4, ['Roof,Alpha,Lot,10/14/2026,10/27/2026,30']);
    expect(one(withL4, 'Roof').percentComplete).toBe(70);
    const L5 = schedule('Alpha lookahead wk 44', '2026-10-26T12:00:00.000Z', 'lookahead');
    expect(one(approve(withL4, L5, ['Drywall,Alpha,Lot,11/02/2026,11/21/2026,']), 'Roof').percentComplete).toBe(70);
  });

  it('a lookahead\'s detail tasks leave % Complete to the master\'s scope, on Home and in the report', () => {
    const percentOf = (state: State) => buildDAVEProjectScheduleRollup({ projectName: 'Alpha', items: shown(state), now: NOW }).percentComplete;
    const masterOnly = (state: State) => buildDAVEProjectScheduleRollup({
      projectName: 'Alpha', items: shown(state).filter(item => ['Framing', 'Roof', 'Drywall'].includes(item.taskName)), now: NOW,
    }).percentComplete;
    for (const state of [onL1, onL2, onL3, onL4]) expect(percentOf(state)).toBe(masterOnly(state));
    expect(scheduleTasksSettingProjectScope(shown(onL4)).map(item => item.taskName).sort()).toEqual(['Drywall', 'Framing', 'Roof']);
    // A project with lookahead tasks only still measures them.
    const lonely = shown(onL4).filter(item => item.taskName === 'Flash vents');
    expect(scheduleTasksSettingProjectScope(lonely)).toEqual(lonely);
    // Adding detail never makes the project look less done.
    const L5 = schedule('Alpha lookahead wk 44', '2026-10-26T12:00:00.000Z', 'lookahead');
    const withDetail = approve(onL4, L5, ['Roof,Alpha,Lot,10/14/2026,10/27/2026,30', 'Punch walk,Alpha,Lot,10/27/2026,10/30/2026,0']);
    expect(percentOf(withDetail)).toBe(percentOf(onL4));
    // The report's project condition reads the same scope.
    const truth = buildDAVEProjectTruth({
      projectId: 'alpha', projectName: 'Alpha', updates: [], scheduleItems: shown(onL4), referenceDocuments: onL4.documents,
      now: NOW.toISOString(),
    });
    expect(truth.schedule.filter(task => task.lookaheadDetail).map(task => task.taskName)).toEqual(['Flash vents']);
    const briefing = buildDAVEReportBriefing({ truths: [truth], selectedProjectNames: ['Alpha'], scheduleItems: onL4.items });
    expect(briefing.projectConditions[0].percentComplete).toBe(percentOf(onL4));
  });

  it('Schedule Sources marks the older files "Replaced by the lookahead of <date>"', () => {
    const label = (document: ReferenceDocument) => scheduleDocumentCurrentLabel(document, 'Active schedule', onL4.documents);
    expect(label(L1)).toBe('Replaced by the lookahead of Oct 19, 2026');
    expect(label(L3)).toBe('Replaced by the lookahead of Oct 19, 2026');
    expect(label(L4)).toBe('Lookahead: adds to the master schedule for Alpha');
    expect(onL4.documents.filter(document => scheduleLookaheadInEffect(document, onL4.documents)).map(document => document.id)).toEqual([L4.id]);
    // Every file stays saved.
    expect(onL4.documents.map(document => document.id)).toEqual([F.id, L1.id, L2.id, L3.id, L4.id]);
  });

  it('a lookahead for another project replaces none of Alpha\'s', () => {
    const BETA = schedule('BETA MASTER', '2026-09-21T12:00:00.000Z', undefined, 'Beta');
    const BL = schedule('Beta lookahead wk 44', '2026-10-26T12:00:00.000Z', 'lookahead', 'Beta');
    const withBeta = approve(approve(onL4, BETA, ['Excavate,Beta,Pad,10/01/2026,10/20/2026,0'], 'Beta'), BL,
      ['Excavate,Beta,Pad,10/02/2026,10/22/2026,10', 'Shore,Beta,Pad,10/27/2026,10/29/2026,0'], 'Beta');
    expect(named(withBeta, 'Flash vents')).toHaveLength(1);
    expect(dates(one(withBeta, 'Roof'))).toBe('10/14/2026-10/27/2026');
    expect(scheduleDocumentCurrentLabel(L4, 'Active schedule', withBeta.documents)).toBe('Lookahead: adds to the master schedule for Alpha');
  });

  it('the iPad and the web show the same after a refresh or Full Sync; the web lists old lookaheads as prior versions', async () => {
    // The iPad's copy: the same records through JSON, its schedules in another order.
    const ipad: State = { items: JSON.parse(JSON.stringify(onL4.items)), documents: [...onL4.documents].reverse() };
    const line = (item: ScheduleItem) => `${item.id} ${dates(item)} ${item.percentComplete}%`;
    expect(shown(ipad).map(line).sort()).toEqual(shown(onL4).map(line).sort());

    jest.mocked(daveWebSupabaseGateway.loadAuthorizedRows).mockResolvedValue({
      projects: [{ id: 'alpha', name: 'Alpha', archived: false }],
      scheduleItems: onL4.items.map(item => ({ id: item.id, updated_at: '2026-10-19T12:00:00.000Z', item_data: { ...item, projectId: 'alpha' } })),
      projectUpdates: [],
      // The cloud keeps each lookahead's flag as its approval left it, or cleared by a master's activation.
      referenceDocuments: onL4.documents.map((document, index) => ({ id: document.id, name: document.name, category: 'Schedules',
        updated_at: '2026-10-19T12:00:00.000Z', document_data: { ...document, isCurrent: index % 2 === 0 } })),
      syncTombstones: [],
    } as never);
    const snapshot = await loadDAVEWebReadOnlySnapshot();
    expect(snapshot.scheduleItems.map(item => line(item as ScheduleItem)).sort()).toEqual(shown(onL4).map(line).sort());
    const web = (document: ReferenceDocument) => snapshot.referenceDocuments.find(candidate => candidate.id === document.id)!;
    const groups = groupDAVEWebDocuments(snapshot.referenceDocuments);
    expect(groups.currentSchedule.map(document => document.id).sort()).toEqual([F.id, L4.id].sort());
    expect(groups.priorScheduleVersions.map(document => document.id).sort()).toEqual([L1.id, L2.id, L3.id].sort());
    expect(web(L2).lookaheadReplaced).toBe('Replaced by the lookahead of Oct 19, 2026');
    expect(web(L4).lookaheadReplaced).toBeNull();
    expect(daveWebDocumentDeletionIsProtected(web(L2))).toBe(false);
    expect(daveWebDocumentDeletionIsProtected(web(L4))).toBe(true);
  });

  it('deleting the newest lookahead puts the one before it back in effect, and the delete question says so', () => {
    const note = scheduleLookaheadDeleteNote(onL4.items, L4, [], onL4.documents);
    expect(note).toContain('The lookahead of Oct 12, 2026 applies again.');
    const back = deleteWithItems(onL4, L4, '2026-10-20T12:00:00.000Z');
    expect(named(back, 'Flash vents')).toEqual([]);
    expect(named(back, 'Hang trusses')).toHaveLength(1);
    // Framing takes L3's dates again; Roof falls back to L3's.
    expect(dates(one(back, 'Framing'))).toBe('10/03/2026-11/04/2026');
    expect(dates(one(back, 'Roof'))).toBe('10/14/2026-10/25/2026');
    expect(one(back, 'Framing').percentComplete).toBe(60);
  });

  it('a web save of a task shown on the master\'s dates keeps its saved dates unless David changed them', () => {
    const shownFraming = one(onL4, 'Framing') as DAVEWebScheduleItem;
    expect(dates(shownFraming)).toBe('10/01/2026-10/30/2026');
    const save = (startDate: string, finishDate: string) => {
      const built = buildDAVEWebScheduleItem({
        draft: {
          projectId: 'alpha', itemType: 'Task', taskName: 'Framing', projectName: 'Alpha', locationName: 'Lot', startDate, finishDate,
          milestone: '', owner: '', contractor: '', percentComplete: '65', priority: 'Medium', status: 'In Progress', notes: '',
          nextAction: '', activityMessage: '',
        },
        current: { ...shownFraming, projectId: 'alpha', cloudUpdatedAt: null }, id: framingId, now: '2026-10-20T15:00:00.000Z', actor: 'David',
      });
      const { cloudUpdatedAt: _cloud, ...saved } = built;
      expect('savedLookaheadDates' in saved).toBe(false);
      return { ...onL4, items: onL4.items.map(item => item.id === framingId ? saved as ScheduleItem : item) };
    };
    // Percent only: L3's dates stay saved, the master's are shown; deleting L4 shows L3's again.
    const percentOnly = save('10/01/2026', '10/30/2026');
    expect(dates(percentOnly.items.find(item => item.id === framingId)!)).toBe('10/03/2026-11/04/2026');
    expect(`${dates(one(percentOnly, 'Framing'))} ${one(percentOnly, 'Framing').percentComplete}%`).toBe('10/01/2026-10/30/2026 65%');
    expect(dates(one(deleteWithItems(percentOnly, L4, '2026-10-21T12:00:00.000Z'), 'Framing'))).toBe('10/03/2026-11/04/2026');
    // Dates he changed are saved as he typed them.
    const moved = save('10/02/2026', '10/31/2026');
    expect(dates(moved.items.find(item => item.id === framingId)!)).toBe('10/02/2026-10/31/2026');
  });

  it('an approval given the tasks as shown saves their saved dates, never the dates shown', () => {
    const G4 = schedule('MASTER G4', '2026-10-20T12:00:00.000Z');
    const merged = mergeApprovedScheduleImportItems({
      existing: shown(onL4), imported: rows(G4, ['Framing,Alpha,Lot,10/01/2026,10/30/2026,50']), completionMatch: () => null,
      mergeCompletion: item => item, isCurrent: () => true, approvedAt: G4.importedAt,
    });
    const framing = merged.next.find(item => item.id === framingId)!;
    expect('savedLookaheadDates' in framing).toBe(false);
    expect(dates(framing)).toBe('10/03/2026-11/04/2026');
  });

  it('a web upload restating the task as shown writes its saved dates, never the copy shown', () => {
    const G2 = schedule('MASTER G2', '2026-10-20T12:00:00.000Z');
    const plan = planDAVEWebScheduleImport({
      snapshot: { scheduleItems: shown(onL4).map(item => ({ ...item, cloudUpdatedAt: null })) as DAVEWebScheduleItem[] },
      importedScheduleItems: rows(G2, ['Framing,Alpha,Lot,10/01/2026,10/30/2026,', 'Roof,Alpha,Lot,10/14/2026,10/27/2026,']),
    });
    const framing = plan.revisions.find(revision => revision.item.id === framingId)!.item;
    expect('savedLookaheadDates' in framing).toBe(false);
    expect(dates(framing)).toBe('10/03/2026-11/04/2026');
  });

  it('a web upload pairs the file\'s rows with the saved tasks as the phone\'s approval does, not with the dates shown', () => {
    // Framing is saved on L3's dates and shown on the master's; a file stating L3's dates restates that task on both.
    const G3 = schedule('MASTER G3', '2026-10-20T12:00:00.000Z');
    const lines = ['Framing,Alpha,Lot,10/03/2026,11/04/2026,'];
    const plan = planDAVEWebScheduleImport({
      snapshot: { scheduleItems: shown(onL4).map(item => ({ ...item, cloudUpdatedAt: null })) as DAVEWebScheduleItem[] },
      importedScheduleItems: rows(G3, lines),
    });
    expect(plan.additions.map(item => item.taskName)).toEqual([]);
    expect(plan.revisions.map(revision => revision.item.id)).toContain(framingId);
    const phone = approve(onL4, G3, lines);
    expect(phone.items.filter(item => item.taskName === 'Framing' && item.importBatchId === G3.importBatchId)).toEqual([]);
  });

  it('deleting an older file alone ("Delete PDF Only") does not bring its detail tasks back', () => {
    const withoutL1File: State = { items: onL4.items, documents: onL4.documents.filter(document => document.id !== L1.id) };
    expect(named(withoutL1File, 'Install sleeves')).toEqual([]);
    expect(shown(withoutL1File).map(item => item.taskName).sort()).toEqual(['Drywall', 'Flash vents', 'Framing', 'Roof']);
  });

  it('deleting a replaced lookahead with its items changes no date shown', () => {
    for (const old of [L2, L3]) {
      const cleaned = deleteWithItems(onL4, old, '2026-10-20T12:00:00.000Z');
      expect(shown(cleaned).map(item => `${item.taskName} ${dates(item)}`).sort())
        .toEqual(shown(onL4).map(item => `${item.taskName} ${dates(item)}`).sort());
    }
    // L3 last moved Framing: its delete saves L2's dates back, as before owner answer Q25, and the master's are shown
    // (L2 is replaced too). Changed deliberately (gen26 follow-up, 2 Oct): saving the master's dates read from this
    // device's note made two devices that had heard of different schedules save different dates.
    const withoutL3 = deleteWithItems(onL4, L3, '2026-10-20T12:00:00.000Z');
    expect(dates(withoutL3.items.find(item => item.id === framingId)!)).toBe('10/03/2026-11/02/2026');
    expect(dates(one(withoutL3, 'Framing'))).toBe('10/01/2026-10/30/2026');
  });
});

describe('Q25 with two devices: a master\'s task stays the master\'s whatever the copies say', () => {
  const ROOF = 'Roof,Alpha,Lot,11/02/2026,11/06/2026,0';
  const FRAMING_F = 'Framing,Alpha,Lot,10/15/2026,10/25/2026,0';
  const G = schedule('MASTER G', '2026-10-20T12:00:00.000Z');
  const LA = schedule('Alpha lookahead wk 44', '2026-10-26T12:00:00.000Z', 'lookahead');
  const LB = schedule('Alpha lookahead wk 45', '2026-11-02T12:00:00.000Z', 'lookahead');

  it('a master task only a replaced lookahead still holds (its master deleted) stays listed, on the master\'s dates', () => {
    const onLA = approve(approve(EMPTY, F, [FRAMING_F, ROOF]), LA, ['Roof,Alpha,Lot,11/04/2026,11/09/2026,40']);
    const withoutF = deleteWithItems(onLA, F, '2026-10-27T12:00:00.000Z');
    expect(one(withoutF, 'Roof').startDate).toBe('11/04/2026');
    const onLB = approve(withoutF, LB, ['Drywall,Alpha,Lot,11/09/2026,11/13/2026,0']);
    expect(dates(one(onLB, 'Roof'))).toBe('11/02/2026-11/06/2026');
    expect(one(onLB, 'Roof').percentComplete).toBe(40);
  });

  it('a stale device\'s lookahead restated the older row: once replaced, the task shows the current master\'s dates', () => {
    const onF = approve(EMPTY, F, [FRAMING_F, ROOF]);
    // The phone approves G moving Roof; the iPad, not having heard, approves LA on F's Roof.
    const onG = approve(onF, G, [FRAMING_F, 'Roof,Alpha,Lot,11/05/2026,11/09/2026,0']);
    const ipad = approve(onF, LA, ['Roof,Alpha,Lot,11/07/2026,11/11/2026,70']);
    const fRoofId = onF.items.find(item => item.taskName === 'Roof')!.id;
    // After Full Sync: G's records, the iPad's restated F row, and every schedule.
    const merged: State = {
      items: onG.items.map(item => item.id === fRoofId ? ipad.items.find(other => other.id === fRoofId)! : item),
      documents: [...onG.documents, LA],
    };
    expect(`${dates(one(merged, 'Roof'))} ${one(merged, 'Roof').percentComplete}%`).toBe('11/07/2026-11/11/2026 70%');
    const onLB = approve(merged, LB, ['Drywall,Alpha,Lot,11/09/2026,11/13/2026,0']);
    expect(`${dates(one(onLB, 'Roof'))} ${one(onLB, 'Roof').percentComplete}%`).toBe('11/05/2026-11/09/2026 70%');
  });

  const P = schedule('MASTER P', '2026-10-10T12:00:00.000Z');
  /** The phone approves P; the iPad, not having heard of P, approves G (current); the phone, not having heard of G,
   * approves LA on P's Roof. P's and G's Roof are both revisions of F's. After Full Sync: */
  function staleDeviceMerged(): State {
    const onF = approve(EMPTY, F, [FRAMING_F, ROOF]);
    const phone = approve(approve(onF, P, [FRAMING_F, 'Roof,Alpha,Lot,11/03/2026,11/07/2026,0']), LA, ['Roof,Alpha,Lot,11/07/2026,11/11/2026,70']);
    const ipad = approve(onF, G, [FRAMING_F, 'Roof,Alpha,Lot,11/05/2026,11/09/2026,0']);
    const ids = new Set(phone.items.map(item => item.id));
    return {
      items: [...phone.items, ...ipad.items.filter(item => !ids.has(item.id))],
      documents: [...ipad.documents, { ...P, isCurrent: false }, LA],
    };
  }

  it('a device that had not heard of the current master moved the older master\'s row: once replaced, the current master\'s dates', () => {
    const merged = staleDeviceMerged();
    expect(`${dates(one(merged, 'Roof'))} ${one(merged, 'Roof').percentComplete}%`).toBe('11/07/2026-11/11/2026 70%');
    const onLB = approve(merged, LB, ['Drywall,Alpha,Lot,11/09/2026,11/13/2026,0']);
    expect(`${dates(one(onLB, 'Roof'))} ${one(onLB, 'Roof').percentComplete}%`).toBe('11/05/2026-11/09/2026 70%');
  });

  it('...unless a master uploaded after the current one restated the note\'s dates: those stay the master\'s word', () => {
    const W = schedule('MASTER W', '2026-10-22T12:00:00.000Z');
    const merged = staleDeviceMerged();
    // A web upload of W, not made current, restated P's Roof on the dates LA gave it.
    const restated: State = {
      items: merged.items.map(item => item.taskName === 'Roof' && item.lookaheadOverlay ? {
        ...item,
        alsoImportedInBatchIds: [...(item.alsoImportedInBatchIds || []), W.importBatchId!],
        lookaheadOverlay: {
          ...item.lookaheadOverlay, masterStartDate: '11/07/2026', masterFinishDate: '11/11/2026',
          lookaheads: item.lookaheadOverlay.lookaheads.map(entry => ({ ...entry, datesReplacedByMaster: W.importBatchId! })),
        },
      } : item),
      documents: [...merged.documents, { ...W, isCurrent: false }],
    };
    const onLB = approve(restated, LB, ['Drywall,Alpha,Lot,11/09/2026,11/13/2026,0']);
    expect(dates(one(onLB, 'Roof'))).toBe('11/07/2026-11/11/2026');
  });

  it('a copy whose note missed the newest lookahead\'s restatement keeps that lookahead\'s dates while it holds the task', () => {
    const onLA = approve(approve(EMPTY, F, [FRAMING_F, ROOF]), LA, ['Roof,Alpha,Lot,11/04/2026,11/09/2026,40']);
    // LB lists Roof on LA's dates again.
    const onLB = approve(onLA, LB, ['Roof,Alpha,Lot,11/04/2026,11/09/2026,']);
    // A copy merged on another device before LB's note entry arrived: LB's import is kept, its note entry is not.
    const lost: State = {
      ...onLB,
      items: onLB.items.map(item => item.taskName === 'Roof' && item.lookaheadOverlay ? {
        ...item, lookaheadOverlay: { ...item.lookaheadOverlay, lookaheads: item.lookaheadOverlay.lookaheads.filter(entry => entry.batchId !== LB.importBatchId) },
      } : item),
    };
    expect(dates(one(lost, 'Roof'))).toBe('11/04/2026-11/09/2026');
  });
});

/**
 * Q25 with two devices, the gen26 follow-up (2 Oct 2026): a task a replaced lookahead still holds is shown on the
 * dates the newest master file gave it, worked out the same way whichever of the task's rows a device that had not
 * heard of a schedule moved, and whichever master a device made current last (an approval made offline is made
 * current when that device reconnects). Built by hand: the records two devices leave in the cloud.
 */
describe('Q25 with two devices: the reset reads the same whatever each device had heard', () => {
  const at = (day: number) => `2026-10-${String(day).padStart(2, '0')}T12:00:00.000Z`;
  const doc = (id: string, day: number, extra: Partial<ReferenceDocument> = {}) =>
    ({ ...schedule(id, at(day), id.startsWith('LOOK') ? 'lookahead' : undefined), ...extra }) as ReferenceDocument;
  const row = (id: string, source: ReferenceDocument, start: string, finish: string, extra: Partial<ScheduleItem> = {}) => ({
    id, taskName: 'Roof', projectName: 'Alpha', locationName: 'Lot', startDate: start, finishDate: finish, percentComplete: 0,
    status: 'Not Started', priority: 'Medium', owner: '', contractor: '', milestone: '', notes: '', createdAt: source.importedAt,
    importedAt: source.importedAt, importBatchId: source.importBatchId, sourceDocumentId: source.id, ...extra,
  }) as ScheduleItem;
  const moved = (lookahead: ReferenceDocument, masterStart: string, masterFinish: string, start: string, finish: string,
    extra: Partial<NonNullable<ScheduleItem['lookaheadOverlay']>['lookaheads'][number]> = {}) => ({
    alsoImportedInBatchIds: [lookahead.importBatchId!],
    lookaheadOverlay: {
      masterStartDate: masterStart, masterFinishDate: masterFinish, masterPercentComplete: 0,
      lookaheads: [{ batchId: lookahead.importBatchId!, startDate: start, finishDate: finish, percentComplete: null, ...extra }],
    },
  }) as Partial<ScheduleItem>;
  const roofDates = (items: ScheduleItem[], documents: ReferenceDocument[]) => dates(one({ items, documents }, 'Roof'));
  const F = doc('MASTER F', 1);
  const G = doc('MASTER G', 5);
  const LA = doc('LOOKAHEAD A', 8);
  const LB = doc('LOOKAHEAD B', 15);
  const fRoof = row('F-2', F, '11/02/2026', '11/06/2026');
  const gRoof = row('G-2', G, '11/05/2026', '11/09/2026', { revisedFromTaskIds: ['F-2'] });

  it('whichever master a device made current last, the task shows the newest master\'s dates', () => {
    // LA moved G's Roof; LB (Drywall only) replaced LA. The cloud made G current, or F (a Set Active the iPad's
    // reconnect did not see): the same dates either way.
    const items = [fRoof, row('G-2', G, '11/07/2026', '11/11/2026', { revisedFromTaskIds: ['F-2'], ...moved(LA, '11/05/2026', '11/09/2026', '11/07/2026', '11/11/2026') })];
    expect(roofDates(items, [{ ...F, isCurrent: false }, G, LA, LB])).toBe('11/05/2026-11/09/2026');
    expect(roofDates(items, [F, { ...G, isCurrent: false }, LA, LB])).toBe('11/05/2026-11/09/2026');
  });

  it('a stale device moved the older master\'s row: the newest master\'s row of that task speaks for it', () => {
    const items = [row('F-2', F, '11/07/2026', '11/11/2026', moved(LA, '11/02/2026', '11/06/2026', '11/07/2026', '11/11/2026')), gRoof];
    expect(roofDates(items, [{ ...F, isCurrent: false }, G, LA, LB])).toBe('11/05/2026-11/09/2026');
    // The same when the newest master saved its row without the ids it answers to (a device that had two Roofs shown).
    const unlinked = [items[0], { ...gRoof, revisedFromTaskIds: [] }];
    expect(roofDates(unlinked, [{ ...F, isCurrent: false }, G, LA, LB])).toBe('11/05/2026-11/09/2026');
    // Not a master with two tasks of that name in the area: no telling which is this one.
    const twins = [...unlinked, row('G-9', G, '11/20/2026', '11/24/2026')];
    expect(dates(shown({ items: twins, documents: [{ ...F, isCurrent: false }, G, LA, LB] }).find(item => item.id === 'F-2')!))
      .toBe('11/02/2026-11/06/2026');
  });

  it('a master saved after the lookahead, by a device or the web that had not seen it, on the very dates it gave: kept', () => {
    const W = doc('MASTER W', 10, { isCurrent: false, webFileFingerprint: 'w'.repeat(64) });
    const items = [
      row('F-2', F, '11/07/2026', '11/11/2026', moved(LA, '11/02/2026', '11/06/2026', '11/07/2026', '11/11/2026')),
      row('W-2', W, '11/07/2026', '11/11/2026', { revisedFromTaskIds: ['F-2'] }),
    ];
    expect(roofDates(items, [F, W, LA, LB])).toBe('11/07/2026-11/11/2026');
  });

  it('a web upload not made current is not the master\'s word, unless the task\'s note took it as the master\'s', () => {
    const W = doc('MASTER W', 10, { isCurrent: false, webFileFingerprint: 'w'.repeat(64) });
    const items = [
      row('F-2', F, '11/07/2026', '11/11/2026', moved(LA, '11/02/2026', '11/06/2026', '11/07/2026', '11/11/2026')),
      row('W-2', W, '11/09/2026', '11/13/2026', { revisedFromTaskIds: ['F-2'] }),
    ];
    expect(roofDates(items, [F, W, LA, LB])).toBe('11/02/2026-11/06/2026');
    // W restated F's Roof in place: its note's master dates are W's, newer than G's row of the task.
    const restated = [{ ...items[0], ...moved(LA, '11/09/2026', '11/13/2026', '11/07/2026', '11/11/2026', { datesReplacedByMaster: W.importBatchId! }),
      alsoImportedInBatchIds: [LA.importBatchId!, W.importBatchId!] }, gRoof];
    expect(roofDates(restated, [{ ...F, isCurrent: false }, G, W, LA, LB])).toBe('11/09/2026-11/13/2026');
  });

  it('same-named tasks in the area (owner answer Q30): only the current master\'s own revision speaks, as before', () => {
    const pour = (id: string, source: ReferenceDocument, start: string, finish: string, extra: Partial<ScheduleItem> = {}) =>
      ({ ...row(id, source, start, finish, extra), taskName: 'Pour slab' }) as ScheduleItem;
    // F lists two Pour slabs; G (newer, not current: F was made current again) lists one, a revision of F's first; LA
    // moved F's first, LB replaced LA.
    const items = [
      pour('F-1', F, '10/07/2026', '10/09/2026', moved(LA, '10/05/2026', '10/07/2026', '10/07/2026', '10/09/2026')),
      pour('F-2', F, '10/12/2026', '10/14/2026'),
      pour('G-1', G, '10/06/2026', '10/08/2026', { revisedFromTaskIds: ['F-1'] }),
    ];
    const shownPour = shown({ items, documents: [F, { ...G, isCurrent: false }, LA, LB] }).filter(item => item.taskName === 'Pour slab');
    expect(shownPour.map(dates).sort()).toEqual(['10/05/2026-10/07/2026', '10/12/2026-10/14/2026']);
  });

  it('two rows of the newest master answer to the task (a split): no telling which is it, so its note\'s dates', () => {
    const items = [
      row('F-2', F, '11/07/2026', '11/11/2026', moved(LA, '11/02/2026', '11/06/2026', '11/07/2026', '11/11/2026')),
      row('G-2', G, '11/05/2026', '11/09/2026', { revisedFromTaskIds: ['F-2'], taskName: 'Roof deck' }),
      row('G-3', G, '11/12/2026', '11/16/2026', { revisedFromTaskIds: ['F-2'], taskName: 'Roof flashing' }),
    ];
    expect(dates(shown({ items, documents: [F, G, LA, LB] }).find(item => item.id === 'F-2')!)).toBe('11/02/2026-11/06/2026');
  });

  it('a lookahead deleted and imported again keeps the note\'s entry: the newest saved lookahead holding the task speaks', () => {
    const LA2 = doc('LOOKAHEAD A2', 9);
    // The note still names LA (deleted); the task belongs to LA2, its file imported again, which LB replaced.
    const items = [row('F-2', F, '11/07/2026', '11/11/2026', { ...moved(LA, '11/02/2026', '11/06/2026', '11/07/2026', '11/11/2026'),
      alsoImportedInBatchIds: [LA.importBatchId!, LA2.importBatchId!] })];
    expect(roofDates(items, [F, LA2, LB])).toBe('11/02/2026-11/06/2026');
  });
});
