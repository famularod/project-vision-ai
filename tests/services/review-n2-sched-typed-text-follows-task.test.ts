/**
 * Review N2 P1 (pass 2 of the next round, 5 Oct 2026; older, the same on
 * Build 229). A note or an owner David typed on a task did not follow the
 * task when next week's master moved it, unless he had also entered a
 * percent on it: the task he saw was the new row, and his note, owner and
 * contractor stayed behind on the hidden old row. The report then said
 * "Framing owner changed from Mike to unassigned."
 *
 * A moved task now keeps what he typed whether or not he entered a percent,
 * by the rule the import already had beside his own progress: the file's
 * value wins, his fills a blank. Every path that can move a task is walked
 * here: the phone's master approval (each branch of the merge), the web's
 * upload, a lookahead (in place), a master listing a task only lookaheads
 * listed, and Set Active / Make Current. The real CSV normalizer, the
 * phone's merge, the shown-schedule pick, the web's plan and the report.
 * Synthetic data.
 */
import { buildDAVEProjectTruth } from '../../services/DAVEProjectTruth';
import { buildDAVEReportBriefing, buildDAVEReportSourceFingerprint } from '../../services/DAVEReportIntelligence';
import { buildDAVEReportSnapshot, daveReportSnapshotScopeKey, reportBaselineSnapshot, type DAVEReportSnapshot } from '../../services/DAVEReportSnapshot';
import { reconcileDAVEScheduleRecords } from '../../services/DAVEScheduleRecovery';
import { planDAVEWebScheduleImport } from '../../services/DAVEWebOperations';
import type { DAVEWebScheduleItem } from '../../services/DAVEWebTaskEditing';
import { normalizeScheduleImport } from '../../services/PIEScheduleIntelligence';
import { selectAuthoritativeScheduleItems } from '../../services/PIEScheduleReconciliation';
import {
  mergeApprovedScheduleImportItems,
  scheduleItemsVisibleBeforeImport,
  scheduleProgressCarriedOnActivation,
  scheduleProgressCarriedToShownTasks,
} from '../../services/ScheduleImportMerge';
import { scheduleItemWithItsNewRow } from '../../services/ScheduleItemEditBase';
import { scheduleDocumentsAfterActivation } from '../../services/SharedDocumentActivation';
import type { ProjectControls, ReferenceDocument, ScheduleItem } from '../../types';
import { normalizeProjectControls, reviseProjectControls } from '../../services/VitruviusProjectControls';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async () => null),
  setItem: jest.fn(async () => undefined),
  removeItem: jest.fn(async () => undefined),
  getAllKeys: jest.fn(async () => []),
  multiGet: jest.fn(async () => []),
}));
jest.mock('expo-file-system/legacy', () => ({ documentDirectory: null }));

type State = { items: ScheduleItem[]; documents: ReferenceDocument[] };
const EMPTY: State = { items: [], documents: [] };
const shown = (state: State) => selectAuthoritativeScheduleItems({ scheduleItems: state.items, scheduleDocuments: state.documents }) as ScheduleItem[];
const one = (state: State, name: string) => {
  const found = shown(state).filter(item => item.taskName === name);
  expect(found).toHaveLength(1);
  return found[0];
};
const dates = (item: ScheduleItem) => `${item.startDate}-${item.finishDate}`;
/** What David typed on a task, and what a file may state: owner, contractor, note. */
const typed = (item: ScheduleItem) => [item.owner, item.contractor, item.notes];

const schedule = (id: string, importedAt: string, role?: 'lookahead'): ReferenceDocument => ({
  id, name: id, originalFileName: `${id}.csv`, uri: '', category: 'Schedules', notes: '', isCurrent: true, importedAt,
  projectId: null, projectName: 'Alpha', projectNames: ['Alpha'], importBatchId: `batch-${id}`, ...(role ? { scheduleRole: role } : {}),
}) as ReferenceDocument;

const PLAIN = 'Task,Project,Area,Start,Finish,Percent Complete';
/** A CSV's rows through the real normalizer, with the import's provenance. */
function rows(source: ReferenceDocument, lines: string[], header = PLAIN): ScheduleItem[] {
  return (normalizeScheduleImport({
    contents: [header, ...lines].join('\n'), sourceName: source.originalFileName,
    mimeType: 'text/csv', projects: ['Alpha'], projectAreas: [], now: new Date(source.importedAt),
  }).items as ScheduleItem[]).map((item, index) => ({
    ...item, id: `${source.id}-${index + 1}`, importBatchId: source.importBatchId, sourceDocumentId: source.id,
  }));
}

/** Approving a schedule on the phone (App.tsx): the merge, then a master is made current, a lookahead added. */
function approve(state: State, source: ReferenceDocument, lines: string[], header = PLAIN): State {
  const lookahead = source.scheduleRole === 'lookahead';
  const merged = mergeApprovedScheduleImportItems({
    existing: state.items, imported: rows(source, lines, header), completionMatch: () => null, mergeCompletion: item => item,
    isCurrent: scheduleItemsVisibleBeforeImport(state.items, [...state.documents, source], source.importBatchId || ''),
    approvedAt: source.importedAt, overlay: lookahead,
  });
  return {
    items: reconcileDAVEScheduleRecords([...merged.additions, ...merged.next]),
    documents: lookahead ? [...state.documents, source] : scheduleDocumentsAfterActivation(source, [...state.documents, source], 'project'),
  };
}

/** A task edit on the phone or the web: the fields given on the saved row, stamped. */
function patch(state: State, id: string, change: Partial<ScheduleItem>, at: string): State {
  return {
    ...state,
    items: state.items.map(item => item.id === id ? {
      ...item, ...change,
      ...(typeof change.percentComplete === 'number' ? {
        status: change.percentComplete >= 100 ? 'Complete' : 'In Progress', progressSource: 'project_manager',
        progressConfirmedAt: at, progressConfirmedBy: 'David',
      } : {}),
      updatedAt: at,
    } as ScheduleItem : item),
  };
}

/** Set Active on the phone (App.tsx activateReferenceDocument): the document is made current, the carried rows saved. */
function setActive(state: State, target: ReferenceDocument, at: string): State {
  const documents = scheduleDocumentsAfterActivation(target, state.documents, 'project', at);
  const carried = new Map(scheduleProgressCarriedOnActivation({ items: state.items, documentsBefore: state.documents, documentsAfter: documents, now: at }).map(item => [item.id, item]));
  return { items: state.items.map(item => carried.get(item.id) || item), documents };
}

const F = schedule('MASTER F', '2026-09-07T12:00:00.000Z');
const G = schedule('MASTER G', '2026-09-14T12:00:00.000Z');
const H = schedule('MASTER H', '2026-09-21T12:00:00.000Z');
const FRAMING_F = 'Framing,Alpha,Lot,10/01/2026,10/11/2026,';
const ROOF = 'Roof,Alpha,Lot,10/13/2026,10/21/2026,';
const FRAMING_G = 'Framing,Alpha,Lot,10/05/2026,10/15/2026,';
const onF = approve(EMPTY, F, [FRAMING_F, ROOF]);
const framingF = one(onF, 'Framing').id;
/** He assigns Mike and types a note on Framing, a task he has not started: no percent of his own on it. */
const withNote = patch(patch(onF, framingF, { notes: 'Crew short Tuesday' }, '2026-09-08T09:00:00.000Z'), framingF, { owner: 'Mike', contractor: 'Acme Framing' }, '2026-09-08T09:05:00.000Z');
const MIKE = ['Mike', 'Acme Framing', 'Crew short Tuesday'];

/** A change to a task's project controls as the app's editor makes it (reviseProjectControls): each changed field with its own time. */
function setControls(state: State, id: string, change: Partial<ProjectControls>, at: string): State {
  const current = state.items.find(item => item.id === id)!;
  return patch(state, id, { projectControls: reviseProjectControls({ current: current.projectControls, patch: change, actor: 'David', now: at }) }, at);
}
const controlsOf = (item: ScheduleItem) => {
  const controls = normalizeProjectControls(item.projectControls);
  return [controls.approvalStatus, controls.estimatedScheduleImpactDays, controls.assignee];
};
/** His approval status, schedule impact and assignee on Framing, and a next step and a milestone, set while F is the master. */
const withControls = patch(setControls(setControls(onF, framingF, { approvalStatus: 'Pending' }, '2026-09-08T10:00:00.000Z'), framingF,
  { estimatedScheduleImpactDays: 5, assignee: 'Lee' }, '2026-09-08T10:05:00.000Z'), framingF, { nextAction: 'Order rebar', milestone: 'Slab pour' }, '2026-09-08T10:10:00.000Z');

/**
 * Review N3 C (pass 3, reports; MEDIUM, older, already in Build 229). What he set on a task besides its owner and
 * note stayed on the hidden old row when a master moved the task: the new row started with no approval status and no
 * schedule impact, and the report said they had changed.
 */
describe('Review N3 C: what else he sets on a task goes with it to the row a master moves it to', () => {
  it('its approval status, schedule impact and assignee (all of its project controls), its next step and its milestone', () => {
    const onG = approve(withControls, G, [FRAMING_G, ROOF]);
    const framing = one(onG, 'Framing');
    expect(framing.id).not.toBe(framingF);
    expect([dates(framing), ...controlsOf(framing), framing.nextAction, framing.milestone]).toEqual(['10/05/2026-10/15/2026', 'Pending', 5, 'Lee', 'Order rebar', 'Slab pour']);
    // The row says which task's row it replaces (review N3 R3) and what that row had of his text, a blank too (review P4 F1).
    // (And the hand links it was made with, none here: review P5-2.)
    expect(framing.textFromTask).toEqual({ taskId: framingF, owner: '', contractor: '', notes: '', nextAction: 'Order rebar', milestone: 'Slab pour', dependencies: [] });
  });

  it('with only controls to take, the row still says which row it took from; a task with none set gives none', () => {
    const onlyControls = setControls(onF, framingF, { approvalStatus: 'Approved' }, '2026-09-08T10:00:00.000Z');
    expect(one(approve(onlyControls, G, [FRAMING_G, ROOF]), 'Framing')).toMatchObject({ textFromTask: { taskId: framingF } });
    const plain = one(approve(onF, G, [FRAMING_G, ROOF]), 'Framing');
    // (Review P4 F1: the row says which row it replaces even so, and that it took nothing: it is weighed from that.)
    expect([plain.projectControls ?? null, plain.textFromTask]).toEqual([one(onF, 'Framing').projectControls ?? null,
      { taskId: framingF, owner: '', contractor: '', notes: '', nextAction: '', milestone: '', dependencies: [] }]);
  });

  it('a file states no controls: a row that arrives with the blank set every task starts with takes the task\'s as they are', () => {
    // (Controls set without each field's own time, as Build 229 and the web's first builds saved them, lose to a blank
    // set when the two are merged as two copies of his: the row from the file is not a copy of his.)
    const plain = patch(onF, framingF, { projectControls: { ...normalizeProjectControls(null), approvalStatus: 'Pending', estimatedScheduleImpactDays: 5 } }, '2026-09-08T10:00:00.000Z');
    const merged = mergeApprovedScheduleImportItems({
      existing: plain.items, imported: rows(G, [FRAMING_G, ROOF]).map(item => ({ ...item, projectControls: normalizeProjectControls(null) })),
      completionMatch: () => null, mergeCompletion: item => item, approvedAt: G.importedAt,
      isCurrent: scheduleItemsVisibleBeforeImport(plain.items, [...plain.documents, G], G.importBatchId || ''),
    });
    expect(controlsOf(merged.additions.find(item => item.taskName === 'Framing')!).slice(0, 2)).toEqual(['Pending', 5]);
  });

  it('a second master moves it again: they are on the newest row, and what he changed in between is what goes', () => {
    const onG = approve(withControls, G, [FRAMING_G, ROOF]);
    const changed = setControls(onG, one(onG, 'Framing').id, { approvalStatus: 'Approved' }, '2026-09-16T09:00:00.000Z');
    const onH = approve(changed, H, ['Framing,Alpha,Lot,10/08/2026,10/18/2026,', ROOF]);
    expect([dates(one(onH, 'Framing')), ...controlsOf(one(onH, 'Framing'))]).toEqual(['10/08/2026-10/18/2026', 'Approved', 5, 'Lee']);
  });
});

describe('Review N2 P1: the phone\'s master approval moves a task, and what David typed on it goes with it', () => {
  it('the task on its new dates shows his owner, contractor and note, with no percent of his on it', () => {
    const onG = approve(withNote, G, [FRAMING_G, ROOF]);
    const framing = one(onG, 'Framing');
    expect(framing.id).not.toBe(framingF);
    expect(dates(framing)).toBe('10/05/2026-10/15/2026');
    expect(framing.percentComplete).toBe(0);
    expect(framing.progressSource ?? null).not.toBe('project_manager');
    expect(typed(framing)).toEqual(MIKE);
    // The hidden old row keeps its own copy, as beside a percent: Set Active on F shows the task as he left it there.
    expect(typed(onG.items.find(item => item.id === framingF)!)).toEqual(MIKE);
  });

  it('a master that states a percent for the moved task: the file\'s percent, his owner and note', () => {
    const onG = approve(withNote, G, ['Framing,Alpha,Lot,10/05/2026,10/15/2026,30', ROOF]);
    const framing = one(onG, 'Framing');
    expect([dates(framing), framing.percentComplete]).toEqual(['10/05/2026-10/15/2026', 30]);
    expect(typed(framing)).toEqual(MIKE);
  });

  it('a master that says "In Progress" with no percent: the task starts at 1% with his owner and note', () => {
    const header = 'Task,Project,Area,Start,Finish,Status,% Complete';
    const onG = approve(withNote, G, ['Framing,Alpha,Lot,10/05/2026,10/15/2026,In Progress,', 'Roof,Alpha,Lot,10/13/2026,10/21/2026,,'], header);
    const framing = one(onG, 'Framing');
    expect([dates(framing), framing.percentComplete, framing.status]).toEqual(['10/05/2026-10/15/2026', 1, 'In Progress']);
    expect(typed(framing)).toEqual(MIKE);
  });

  it('beside his own percent, as before', () => {
    const withPercent = patch(withNote, framingF, { percentComplete: 20 }, '2026-09-09T09:00:00.000Z');
    const framing = one(approve(withPercent, G, [FRAMING_G, ROOF]), 'Framing');
    expect([dates(framing), framing.percentComplete, framing.progressSource]).toEqual(['10/05/2026-10/15/2026', 20, 'project_manager']);
    expect(typed(framing)).toEqual(MIKE);
  });

  it('the file\'s value wins; his fills only what the file leaves blank', () => {
    const header = 'Task,Project,Area,Start,Finish,Owner,Percent Complete,Notes';
    const onG = approve(withNote, G, ['Framing,Alpha,Lot,10/05/2026,10/15/2026,Dana,,', 'Roof,Alpha,Lot,10/13/2026,10/21/2026,,,'], header);
    // (The normalizer reads an Owner column as the row's owner and contractor.)
    expect(rows(G, ['Framing,Alpha,Lot,10/05/2026,10/15/2026,Dana,,'], header).map(typed)).toEqual([['Dana', 'Dana', '']]);
    expect(typed(one(onG, 'Framing'))).toEqual(['Dana', 'Dana', 'Crew short Tuesday']);
    const noted = approve(withNote, G, ['Framing,Alpha,Lot,10/05/2026,10/15/2026,,,Per scheduler: inspection first', 'Roof,Alpha,Lot,10/13/2026,10/21/2026,,,'], header);
    expect(typed(one(noted, 'Framing'))).toEqual(['Mike', 'Acme Framing', 'Per scheduler: inspection first']);
  });

  it('moved again by the next master, it still has them', () => {
    const onH = approve(approve(withNote, G, [FRAMING_G, ROOF]), H, ['Framing,Alpha,Lot,10/07/2026,10/17/2026,', ROOF]);
    const framing = one(onH, 'Framing');
    expect(dates(framing)).toBe('10/07/2026-10/17/2026');
    expect(typed(framing)).toEqual(MIKE);
  });

  it('a task the master leaves on its dates is the same row, as before; a task with nothing typed gains nothing', () => {
    const onG = approve(withNote, G, [FRAMING_F, 'Roof,Alpha,Lot,10/15/2026,10/23/2026,']);
    expect(one(onG, 'Framing').id).toBe(framingF);
    expect(typed(one(onG, 'Framing'))).toEqual(MIKE);
    expect(typed(one(onG, 'Roof'))).toEqual(['', '', '']);
  });

  it('a second row of the same file approved later is another task: it takes nothing from the first', () => {
    // One file lists Pour slab twice; Accept Selected saves the first, he types a note on it, then the second is approved.
    const twice = ['Pour slab,Alpha,Lot,10/05/2026,10/06/2026,', 'Pour slab,Alpha,Lot,10/19/2026,10/20/2026,'];
    const [first, second] = rows(F, twice);
    const approveRows = (state: State, imported: ScheduleItem[]): State => {
      const merged = mergeApprovedScheduleImportItems({
        existing: state.items, imported, completionMatch: () => null, mergeCompletion: item => item,
        isCurrent: scheduleItemsVisibleBeforeImport(state.items, [...state.documents, F], F.importBatchId || ''), approvedAt: F.importedAt,
      });
      return { items: reconcileDAVEScheduleRecords([...merged.additions, ...merged.next]), documents: scheduleDocumentsAfterActivation(F, [...state.documents, F], 'project') };
    };
    const firstSaved = patch(approveRows(EMPTY, [first]), first.id, { notes: 'North bay only' }, '2026-09-07T13:00:00.000Z');
    const both = approveRows(firstSaved, [second]);
    expect(both.items.find(item => item.id === first.id)!.notes).toBe('North bay only');
    expect(both.items.find(item => item.id === second.id)!.notes).toBe('');
  });
});

describe('Review N2 P1: the lookahead note and the master\'s dates of a moved task are as before', () => {
  const L1 = schedule('LOOKAHEAD L1', '2026-09-09T12:00:00.000Z', 'lookahead');
  const L2 = schedule('LOOKAHEAD L2', '2026-09-11T12:00:00.000Z', 'lookahead');

  it('a lookahead restates the task in place: his note never leaves it', () => {
    const onL1 = approve(withNote, L1, ['Framing,Alpha,Lot,10/03/2026,10/13/2026,']);
    expect(one(onL1, 'Framing').id).toBe(framingF);
    expect([dates(one(onL1, 'Framing')), ...typed(one(onL1, 'Framing'))]).toEqual(['10/03/2026-10/13/2026', ...MIKE]);
  });

  it('a note typed on a task a lookahead moved, the lookahead replaced, then a master moves the task: the master\'s dates, his note', () => {
    const onL1 = approve(onF, L1, ['Framing,Alpha,Lot,10/03/2026,10/13/2026,']);
    const noted = patch(onL1, framingF, { notes: 'Crew short Tuesday' }, '2026-09-10T09:00:00.000Z');
    const onL2 = approve(noted, L2, ['Roof,Alpha,Lot,10/14/2026,10/22/2026,']);
    expect(dates(one(onL2, 'Framing'))).toBe('10/01/2026-10/11/2026');
    const onG = approve(onL2, G, [FRAMING_G, ROOF]);
    const framing = one(onG, 'Framing');
    // The new master's dates: the replaced lookahead's entry comes along marked replaced, and brings no old date back.
    expect(dates(framing)).toBe('10/05/2026-10/15/2026');
    expect(framing.savedLookaheadDates).toBeUndefined();
    expect(framing.lookaheadOverlay?.lookaheads.map(entry => [entry.batchId, entry.datesReplacedByMaster])).toEqual([[L1.importBatchId, G.importBatchId]]);
    expect(framing.notes).toBe('Crew short Tuesday');
  });

  it('a detail task only a lookahead listed, left out by the next one, comes back under a master with his note', () => {
    const onL1 = approve(onF, L1, ['Inspect rebar,Alpha,Lot,10/05/2026,10/07/2026,']);
    const rebar = one(onL1, 'Inspect rebar').id;
    const noted = patch(onL1, rebar, { notes: 'Rebar ok', owner: 'Ana' }, '2026-09-10T09:00:00.000Z');
    const onL2 = approve(noted, L2, ['Roof,Alpha,Lot,10/14/2026,10/22/2026,']);
    expect(shown(onL2).filter(item => item.taskName === 'Inspect rebar')).toEqual([]);
    const onG = approve(onL2, G, [FRAMING_F, ROOF, 'Inspect rebar,Alpha,Lot,10/09/2026,10/11/2026,']);
    expect([dates(one(onG, 'Inspect rebar')), ...typed(one(onG, 'Inspect rebar'))]).toEqual(['10/09/2026-10/11/2026', 'Ana', '', 'Rebar ok']);
  });
});

describe('Review N2 P1: the web\'s upload and Make Current, and the phone\'s Set Active', () => {
  const W = { ...schedule('WEB W', '2026-09-14T12:00:00.000Z'), isCurrent: false, webFileFingerprint: 'w'.repeat(64) } as ReferenceDocument;
  const webItems = (state: State) => shown(state).map(item => ({ ...item, cloudUpdatedAt: item.updatedAt ?? null })) as DAVEWebScheduleItem[];
  /** The web's upload: its plan's new rows and revised tasks saved, the file saved and not current. */
  function upload(state: State, lines: string[]): State {
    const plan = planDAVEWebScheduleImport({ snapshot: { scheduleItems: webItems(state) }, importedScheduleItems: rows(W, lines) });
    const revised = new Map(plan.revisions.map(revision => [revision.item.id, revision.item]));
    return { items: [...plan.additions, ...state.items.map(item => revised.get(item.id) || item)], documents: [...state.documents, W] };
  }
  /** Make Current on the web (desktop-auth-provider setCurrentSchedule): the tasks shown before and after, the carried rows saved. */
  function makeCurrent(state: State, at: string): State {
    const documents = scheduleDocumentsAfterActivation(W, state.documents, 'project', at);
    const after: State = { items: state.items, documents };
    const carried = new Map(scheduleProgressCarriedToShownTasks({ before: shown(state), after: shown(after), documentsBefore: state.documents, documentsAfter: documents, now: at })
      .map(item => [item.id, item]));
    return { items: state.items.map(item => carried.get(item.id) || item), documents };
  }

  it('the web\'s upload saves the moved task\'s new row with his owner and note', () => {
    const plan = planDAVEWebScheduleImport({ snapshot: { scheduleItems: webItems(withNote) }, importedScheduleItems: rows(W, [FRAMING_G, ROOF]) });
    const framing = plan.additions.filter(item => item.taskName === 'Framing');
    expect(framing.map(dates)).toEqual(['10/05/2026-10/15/2026']);
    expect(typed(framing[0])).toEqual(MIKE);
    const current = makeCurrent(upload(withNote, [FRAMING_G, ROOF]), '2026-09-15T12:00:00.000Z');
    expect([dates(one(current, 'Framing')), ...typed(one(current, 'Framing'))]).toEqual(['10/05/2026-10/15/2026', ...MIKE]);
  });

  it('review N3 C: the web\'s upload saves the new row with his approval status and schedule impact; set after the upload, they come at Make Current', () => {
    const plan = planDAVEWebScheduleImport({ snapshot: { scheduleItems: webItems(withControls) }, importedScheduleItems: rows(W, [FRAMING_G, ROOF]) });
    expect(controlsOf(plan.additions.find(item => item.taskName === 'Framing')!)).toEqual(['Pending', 5, 'Lee']);
    const uploaded = upload(onF, [FRAMING_G, ROOF]);
    const setAfter = setControls(uploaded, framingF, { approvalStatus: 'Changes Requested', estimatedScheduleImpactDays: 2 }, '2026-09-14T15:00:00.000Z');
    const current = makeCurrent(setAfter, '2026-09-15T12:00:00.000Z');
    expect([dates(one(current, 'Framing')), ...controlsOf(one(current, 'Framing'))]).toEqual(['10/05/2026-10/15/2026', 'Changes Requested', 2, '']);
  });

  it('review N3 C: Set Active back to the older master and forward again: the later entry of each field stands on the row shown', () => {
    const onG = approve(withControls, G, [FRAMING_G, ROOF]);
    const onNew = setControls(onG, one(onG, 'Framing').id, { approvalStatus: 'Approved' }, '2026-09-16T09:00:00.000Z');
    const backOnF = setActive(onNew, F, '2026-09-17T09:00:00.000Z');
    expect([one(backOnF, 'Framing').id, ...controlsOf(one(backOnF, 'Framing'))]).toEqual([framingF, 'Approved', 5, 'Lee']);
    const onOld = setControls(backOnF, framingF, { estimatedScheduleImpactDays: 1 }, '2026-09-18T09:00:00.000Z');
    expect(controlsOf(one(setActive(onOld, G, '2026-09-19T09:00:00.000Z'), 'Framing'))).toEqual(['Approved', 1, 'Lee']);
  });

  it('a note and an owner typed after the upload, before Make Current, follow the task to the row Make Current shows', () => {
    const uploaded = upload(onF, [FRAMING_G, ROOF]);
    // Not current yet: he still sees F's row, and types on it.
    expect(one(uploaded, 'Framing').id).toBe(framingF);
    const noted = patch(uploaded, framingF, { notes: 'Crew short Tuesday', owner: 'Mike', contractor: 'Acme Framing' }, '2026-09-14T15:00:00.000Z');
    const current = makeCurrent(noted, '2026-09-15T12:00:00.000Z');
    const framing = one(current, 'Framing');
    expect(framing.id).not.toBe(framingF);
    expect([dates(framing), ...typed(framing)]).toEqual(['10/05/2026-10/15/2026', ...MIKE]);
    expect(framing.updatedAt).toBe('2026-09-15T12:00:00.000Z');
  });

  it('Set Active back to the older master: the note he typed since shows on its row too', () => {
    const onG = approve(onF, G, [FRAMING_G, ROOF]);
    const framingG = one(onG, 'Framing').id;
    const noted = patch(onG, framingG, { notes: 'Crew short Tuesday', owner: 'Mike', contractor: 'Acme Framing' }, '2026-09-16T09:00:00.000Z');
    const backOnF = setActive(noted, F, '2026-09-17T12:00:00.000Z');
    expect(one(backOnF, 'Framing').id).toBe(framingF);
    expect([dates(one(backOnF, 'Framing')), ...typed(one(backOnF, 'Framing'))]).toEqual(['10/01/2026-10/11/2026', ...MIKE]);
  });

  it('a note he cleared on the newer row does not come back when he switches masters back and forth', () => {
    const onG = approve(withNote, G, [FRAMING_G, ROOF]);
    const framingG = one(onG, 'Framing').id;
    // He clears the note on the task he sees (G's row); F's hidden row still holds the old one.
    const cleared = patch(onG, framingG, { notes: '' }, '2026-09-16T09:00:00.000Z');
    const backOnF = setActive(cleared, F, '2026-09-17T12:00:00.000Z');
    // Changed deliberately (review P4 L1). This line pinned "the older row shows what it had": 'Crew short Tuesday'
    // again while master F was in use. Set Active to another master now shows what he last set on the task, and he
    // cleared this note; the owner and contractor he left alone are as they were.
    expect(typed(one(backOnF, 'Framing'))).toEqual(['Mike', 'Acme Framing', '']);
    const onGAgain = setActive(backOnF, G, '2026-09-18T12:00:00.000Z');
    expect(one(onGAgain, 'Framing').id).toBe(framingG);
    expect(typed(one(onGAgain, 'Framing'))).toEqual(['Mike', 'Acme Framing', '']);
  });

  it('review N3 R3: nor when the older row is changed in between (a percent he records there): the newer row took that very note, and its blank is his clear', () => {
    const onG = approve(withNote, G, [FRAMING_G, ROOF]);
    const framingG = one(onG, 'Framing').id;
    const cleared = patch(onG, framingG, { notes: '' }, '2026-09-16T09:00:00.000Z');
    const backOnF = setActive(cleared, F, '2026-09-17T12:00:00.000Z');
    // F's row, with the old note, is now the row changed last.
    const percentOnF = patch(backOnF, framingF, { percentComplete: 20, status: 'In Progress' }, '2026-09-17T15:00:00.000Z');
    const onGAgain = setActive(percentOnF, G, '2026-09-18T12:00:00.000Z');
    expect(one(onGAgain, 'Framing').id).toBe(framingG);
    // (It was: the old note again, filled from the row changed later.)
    expect(typed(one(onGAgain, 'Framing'))).toEqual(['Mike', 'Acme Framing', '']);
    // A note typed on the older row in between is another matter: it is new text, and fills the blank as before.
    const noteOnF = patch(backOnF, framingF, { notes: 'Crew back Wednesday' }, '2026-09-17T15:00:00.000Z');
    expect(typed(one(setActive(noteOnF, G, '2026-09-18T12:00:00.000Z'), 'Framing'))).toEqual(['Mike', 'Acme Framing', 'Crew back Wednesday']);
  });

  it('and a note typed only later, on the older row while that was shown: it reaches the newer row at Set Active; cleared there after, the newer row keeps its blank', () => {
    // G's row is saved before any note exists: it says it took a blank.
    const onG = approve(onF, G, [FRAMING_G, ROOF]);
    const framingG = one(onG, 'Framing').id;
    expect(one(onG, 'Framing').textFromTask).toMatchObject({ taskId: framingF, notes: '' });
    const backOnF = setActive(onG, F, '2026-09-15T12:00:00.000Z');
    const noteOnF = patch(backOnF, framingF, { notes: 'Crew short Tuesday' }, '2026-09-15T15:00:00.000Z');
    const onGWithNote = setActive(noteOnF, G, '2026-09-16T12:00:00.000Z');
    expect([one(onGWithNote, 'Framing').id, one(onGWithNote, 'Framing').notes]).toEqual([framingG, 'Crew short Tuesday']);
    const cleared = patch(onGWithNote, framingG, { notes: '' }, '2026-09-17T09:00:00.000Z');
    const onGAgain = setActive(setActive(cleared, F, '2026-09-18T12:00:00.000Z'), G, '2026-09-19T12:00:00.000Z');
    expect([one(onGAgain, 'Framing').id, one(onGAgain, 'Framing').notes]).toEqual([framingG, '']);
  });

  it('a row never changed since its import holds no clear of his: its blank is filled at Set Active even where the row says it took that text', () => {
    const onG = approve(withNote, G, [FRAMING_G, ROOF]);
    const framingG = one(onG, 'Framing').id;
    expect(one(onG, 'Framing').textFromTask).toMatchObject({ taskId: framingF, notes: 'Crew short Tuesday' });
    // As the schedule reviewer strands a row of this build (his N23): its owner and note blanked, with no stamp of its own.
    const stranded: State = { ...onG, items: onG.items.map(item => {
      if (item.id !== framingG) return item;
      const { updatedAt: _updatedAt, ...rest } = item;
      return { ...rest, notes: '', owner: '', contractor: '' } as ScheduleItem;
    }) };
    const back = setActive(setActive(stranded, F, '2026-09-17T12:00:00.000Z'), G, '2026-09-18T12:00:00.000Z');
    expect([one(back, 'Framing').id, ...typed(one(back, 'Framing'))]).toEqual([framingG, ...MIKE]);
  });

  describe('review P4 L1: Set Active to an older master shows what he last set on the task', () => {
    // Master G moves Framing; its new row takes Mike, Acme Framing and the note from F's row, and says so.
    const onG = approve(withNote, G, [FRAMING_G, ROOF]);
    const framingG = one(onG, 'Framing').id;

    it('an owner he changed on the task since (Mike to Sam) shows on the older row, on that master\'s dates; the rest as he left it', () => {
      const sam = patch(onG, framingG, { owner: 'Sam' }, '2026-09-16T09:00:00.000Z');
      const backOnF = setActive(sam, F, '2026-09-17T12:00:00.000Z');
      // (It was: Mike again, and the next report said the owner had changed from Sam to Mike.)
      expect([one(backOnF, 'Framing').id, dates(one(backOnF, 'Framing')), ...typed(one(backOnF, 'Framing'))]).toEqual([framingF, '10/01/2026-10/11/2026', 'Sam', 'Acme Framing', 'Crew short Tuesday']);
      // And forward again: still Sam, on the newer row.
      const onGAgain = setActive(backOnF, G, '2026-09-18T12:00:00.000Z');
      expect([one(onGAgain, 'Framing').id, ...typed(one(onGAgain, 'Framing'))]).toEqual([framingG, 'Sam', 'Acme Framing', 'Crew short Tuesday']);
    });

    it('his next step and milestone too', () => {
      const more = patch(onG, framingG, { nextAction: 'Order rebar', milestone: 'Slab pour' }, '2026-09-16T09:00:00.000Z');
      const back = one(setActive(more, F, '2026-09-17T12:00:00.000Z'), 'Framing');
      expect([back.id, back.nextAction, back.milestone]).toEqual([framingF, 'Order rebar', 'Slab pour']);
    });

    it('changed on both rows: the one changed later stands; changed only on the older row, that stays', () => {
      const sam = patch(onG, framingG, { owner: 'Sam' }, '2026-09-16T09:00:00.000Z');
      // The older row's owner and note are changed after that (a device that still showed it): the later of the two owners.
      const leeLater = patch(sam, framingF, { owner: 'Lee', notes: 'Typed on the older row' }, '2026-09-16T15:00:00.000Z');
      expect(typed(one(setActive(leeLater, F, '2026-09-17T12:00:00.000Z'), 'Framing'))).toEqual(['Lee', 'Acme Framing', 'Typed on the older row']);
      // Changed on the older row first, and on the newer row after it: the newer row's owner; the note, changed only there, stays.
      const leeFirst = patch(patch(onG, framingF, { owner: 'Lee', notes: 'Typed on the older row' }, '2026-09-16T09:00:00.000Z'), framingG, { owner: 'Sam' }, '2026-09-16T15:00:00.000Z');
      expect(typed(one(setActive(leeFirst, F, '2026-09-17T12:00:00.000Z'), 'Framing'))).toEqual(['Sam', 'Acme Framing', 'Typed on the older row']);
    });

    it('a blank on the older row that he cleared there is not filled again from the newer row, though that row was changed later (a percent)', () => {
      const clearedOnF = patch(onG, framingF, { notes: '' }, '2026-09-16T09:00:00.000Z');
      const percentOnG = patch(clearedOnF, framingG, { percentComplete: 20 }, '2026-09-16T15:00:00.000Z');
      // (It was: 'Crew short Tuesday' again, lent by the row changed later.)
      expect(typed(one(setActive(percentOnG, F, '2026-09-17T12:00:00.000Z'), 'Framing'))).toEqual(['Mike', 'Acme Framing', '']);
    });

    describe('two masters apart (the newest row\'s record is of the row in between)', () => {
      const FRAMING_H = 'Framing,Alpha,Lot,10/07/2026,10/17/2026,';
      const idOnH = (state: State) => one(state, 'Framing').id;

      it('back two masters in one step: the owner he changed on the way, and the note he cleared on the newest row, show so on the oldest row', () => {
        const sam = patch(onG, framingG, { owner: 'Sam' }, '2026-09-16T09:00:00.000Z');
        const onH = approve(sam, H, [FRAMING_H, ROOF]);
        const cleared = patch(onH, idOnH(onH), { notes: '' }, '2026-09-22T09:00:00.000Z');
        const backOnF = setActive(cleared, F, '2026-09-23T12:00:00.000Z');
        // (It was: Mike and the old note, as master F's row had them. The reports reviewer's seeds "plain 390" and "plain 506".)
        expect([one(backOnF, 'Framing').id, ...typed(one(backOnF, 'Framing'))]).toEqual([framingF, 'Sam', 'Acme Framing', '']);
      });

      it('an owner he cleared on the row in between, which the newest row then took as a blank: cleared on the oldest row too, and not given back to the newest', () => {
        const cleared = patch(onG, framingG, { owner: '' }, '2026-09-16T09:00:00.000Z');
        const onH = approve(cleared, H, [FRAMING_H, ROOF]);
        const newest = idOnH(onH);
        // The newest row has never been edited: its blank is the clear, passed on.
        expect([one(onH, 'Framing').owner, one(onH, 'Framing').updatedAt ?? null]).toEqual(['', null]);
        const backOnF = setActive(onH, F, '2026-09-23T12:00:00.000Z');
        // (It was: Mike. The reports reviewer's seed "plain 506".)
        expect([one(backOnF, 'Framing').id, ...typed(one(backOnF, 'Framing'))]).toEqual([framingF, '', 'Acme Framing', 'Crew short Tuesday']);
        // Forward again from a state where the oldest row still has Mike (as a build before this one left it): the
        // newest row keeps its blank.
        const mikeStillOnF: State = { ...onH, documents: setActive(onH, F, '2026-09-23T12:00:00.000Z').documents };
        const forward = setActive(mikeStillOnF, H, '2026-09-24T12:00:00.000Z');
        expect([one(forward, 'Framing').id, ...typed(one(forward, 'Framing'))]).toEqual([newest, '', 'Acme Framing', 'Crew short Tuesday']);
      });

      it('forward two masters in one step: what he typed on the oldest row while it was shown is on the newest row; changed on both, the later', () => {
        const onH = approve(onG, H, [FRAMING_H, ROOF]);
        const newest = idOnH(onH);
        const backOnF = setActive(onH, F, '2026-09-23T12:00:00.000Z');
        const lee = patch(backOnF, framingF, { owner: 'Lee' }, '2026-09-23T15:00:00.000Z');
        const forward = setActive(lee, H, '2026-09-24T12:00:00.000Z');
        // (It was: Mike, the copy the newest row still held.)
        expect([one(forward, 'Framing').id, ...typed(one(forward, 'Framing'))]).toEqual([newest, 'Lee', 'Acme Framing', 'Crew short Tuesday']);
        // The newest row's own record is still of the row in between.
        expect(one(forward, 'Framing').textFromTask).toMatchObject({ taskId: framingG });
        // An owner set on the newest row after that one stands over it.
        const samLater = patch(lee, newest, { owner: 'Sam' }, '2026-09-23T18:00:00.000Z');
        expect(typed(one(setActive(samLater, H, '2026-09-24T12:00:00.000Z'), 'Framing'))).toEqual(['Sam', 'Acme Framing', 'Crew short Tuesday']);
      });

      it('an owner the newest master\'s file states is the file\'s: it does not go back to the oldest row', () => {
        const header = 'Task,Project,Area,Start,Finish,Owner,Percent Complete,Notes';
        const onH = approve(onG, H, ['Framing,Alpha,Lot,10/07/2026,10/17/2026,Dana,,', 'Roof,Alpha,Lot,10/13/2026,10/21/2026,,,'], header);
        expect(typed(one(onH, 'Framing'))).toEqual(['Dana', 'Dana', 'Crew short Tuesday']);
        expect(typed(one(setActive(onH, F, '2026-09-23T12:00:00.000Z'), 'Framing'))).toEqual(MIKE);
      });
    });

    it('the rule on the two rows alone: only from a row that says it took its text from this very row, and never a value that row merely copied', () => {
      const older = one(onF, 'Framing');
      const newer = { ...one(onG, 'Framing'), owner: 'Sam' };
      expect(scheduleItemWithItsNewRow({ ...older, owner: 'Mike' }, newer, false)).toMatchObject({ id: framingF, owner: 'Sam' });
      // A row that took its text from another row says nothing about this one.
      const tookElsewhere = { ...newer, textFromTask: { ...newer.textFromTask!, taskId: 'another row' } };
      const mike = { ...older, owner: 'Mike' };
      expect(scheduleItemWithItsNewRow(mike, tookElsewhere, true)).toBe(mike);
      // The contractor and the note the newer row still holds as taken are copies: this row's own stand, whichever was changed later.
      const changedHere = { ...older, owner: 'Mike', contractor: 'Other Framing', notes: '' };
      expect(scheduleItemWithItsNewRow(changedHere, newer, true)).toMatchObject({ owner: 'Sam', contractor: 'Other Framing', notes: '' });
    });

    it('a newer row saved before rows said what they took (Build 229): as before, its text only fills a blank on the older row when it was changed later', () => {
      const asBuild229 = (state: State): State => ({ ...state, items: state.items.map(item => {
        if (item.id !== framingG) return item;
        const { textFromTask: _record, ...rest } = item;
        return rest as ScheduleItem;
      }) });
      const sam = asBuild229(patch(onG, framingG, { owner: 'Sam', nextAction: 'Order rebar' }, '2026-09-16T09:00:00.000Z'));
      const back = one(setActive(sam, F, '2026-09-17T12:00:00.000Z'), 'Framing');
      expect([...typed(back), back.nextAction]).toEqual(['Mike', 'Acme Framing', 'Crew short Tuesday', 'Order rebar']);
    });
  });

  it('review N3 R3: what he typed over them on the task after the upload, before Make Current, is what the row then shown has', () => {
    const uploaded = upload(withNote, [FRAMING_G, ROOF]);
    const edited = patch(uploaded, framingF, { notes: 'Crew back Wednesday', owner: 'Ana' }, '2026-09-14T15:00:00.000Z');
    // Changed deliberately (review N3 R3). This test pinned a limit of review N2 P1 ("a value on the row now shown
    // stands over the hidden row's": only a blank was filled at Make Current, so the upload's copy, "Mike" and the first
    // note, stayed). The upload's row says what it took from the task; a field it still holds so is the task's, and
    // takes what he has typed there since.
    expect(typed(one(makeCurrent(edited, '2026-09-15T12:00:00.000Z'), 'Framing'))).toEqual(['Ana', 'Acme Framing', 'Crew back Wednesday']);
    // A note he cleared there since is cleared.
    const cleared = patch(uploaded, framingF, { notes: '' }, '2026-09-14T15:00:00.000Z');
    expect(typed(one(makeCurrent(cleared, '2026-09-15T12:00:00.000Z'), 'Framing'))).toEqual(['Mike', 'Acme Framing', '']);
  });
});

describe('Review N2 P1: the report no longer says the owner changed to unassigned', () => {
  const truthOf = (state: State, now: string) => buildDAVEProjectTruth({
    projectId: 'report:alpha', projectName: 'Alpha', updates: [], scheduleItems: shown(state), projectAreas: [], referenceDocuments: state.documents, now,
    knownScheduleItems: state.items, knownScheduleDocuments: state.documents, reportLookaheadReplacement: true,
  });
  function report(state: State, known: DAVEReportSnapshot | null, now: string) {
    const truth = truthOf(state, now);
    const fingerprint = buildDAVEReportSourceFingerprint([truth]);
    const briefing = buildDAVEReportBriefing({ truths: [truth], selectedProjectNames: ['Alpha'], previousSnapshot: reportBaselineSnapshot(known, fingerprint), scheduleItems: shown(state) });
    return {
      lines: briefing.reportingPeriod.changes.map(change => change.summary).sort(),
      snapshot: buildDAVEReportSnapshot({ truths: [truth], scopeKey: daveReportSnapshotScopeKey(['Alpha']), sourceFingerprint: fingerprint, capturedAt: now, reportFormat: 'project_manager' }),
    };
  }

  it('review N3 C: after a master moves a task with an approval status and a schedule impact: the date change, and nothing about either', () => {
    const before = report(withControls, null, '2026-09-10T12:00:00.000Z');
    const onG = approve(withControls, G, [FRAMING_G, ROOF]);
    const after = report(onG, before.snapshot, '2026-09-15T12:00:00.000Z');
    // (It was, since Build 229: also "Framing approval changed from Pending to Not Required." and "Framing schedule
    // impact changed from 5 days to not set.")
    expect(after.lines).toEqual(['Framing finish changed from 10/11/2026 to 10/15/2026.']);
    // One he does change afterwards is still reported.
    const approved = setControls(onG, one(onG, 'Framing').id, { approvalStatus: 'Approved' }, '2026-09-16T09:00:00.000Z');
    expect(report(approved, after.snapshot, '2026-09-17T12:00:00.000Z').lines).toEqual(['Framing approval changed from Pending to Approved.']);
  });

  it('review P4 L1: after Set Active back to the older master, nothing about an owner he changed on the task before (the reports reviewer\'s seed "plain 46")', () => {
    const onG = approve(withNote, G, [FRAMING_G, ROOF]);
    const sam = patch(onG, one(onG, 'Framing').id, { owner: 'Sam' }, '2026-09-16T09:00:00.000Z');
    const sent = report(sam, null, '2026-09-16T12:00:00.000Z');
    const backOnF = setActive(sam, F, '2026-09-17T12:00:00.000Z');
    // (It was, since Build 229: also "Framing owner changed from Sam to Mike.")
    expect(report(backOnF, sent.snapshot, '2026-09-18T12:00:00.000Z').lines).toEqual(['Framing finish changed from 10/15/2026 to 10/11/2026.']);
  });

  it('after a master moves the task he assigned to Mike: the date change, and nothing about its owner', () => {
    const before = report(withNote, null, '2026-09-10T12:00:00.000Z');
    const after = report(approve(withNote, G, [FRAMING_G, ROOF]), before.snapshot, '2026-09-15T12:00:00.000Z');
    // (At 06e7b1c and on Build 229 the second line was "Framing owner changed from Mike to unassigned.")
    expect(after.lines).toEqual(['Framing finish changed from 10/11/2026 to 10/15/2026.']);
  });
});
