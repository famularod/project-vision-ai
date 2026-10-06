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
import { scheduleDocumentsAfterActivation } from '../../services/SharedDocumentActivation';
import type { ReferenceDocument, ScheduleItem } from '../../types';

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
    expect(one(backOnF, 'Framing').notes).toBe('Crew short Tuesday');
    const onGAgain = setActive(backOnF, G, '2026-09-18T12:00:00.000Z');
    expect(one(onGAgain, 'Framing').id).toBe(framingG);
    expect(typed(one(onGAgain, 'Framing'))).toEqual(['Mike', 'Acme Framing', '']);
  });

  it('a value on the row now shown stands over the hidden row\'s', () => {
    const uploaded = upload(withNote, [FRAMING_G, ROOF]);
    const edited = patch(uploaded, framingF, { notes: 'Crew back Wednesday', owner: 'Ana' }, '2026-09-14T15:00:00.000Z');
    // The upload's row took "Mike" and the first note; only a blank is filled at Make Current.
    expect(typed(one(makeCurrent(edited, '2026-09-15T12:00:00.000Z'), 'Framing'))).toEqual(MIKE);
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

  it('after a master moves the task he assigned to Mike: the date change, and nothing about its owner', () => {
    const before = report(withNote, null, '2026-09-10T12:00:00.000Z');
    const after = report(approve(withNote, G, [FRAMING_G, ROOF]), before.snapshot, '2026-09-15T12:00:00.000Z');
    // (At 06e7b1c and on Build 229 the second line was "Framing owner changed from Mike to unassigned.")
    expect(after.lines).toEqual(['Framing finish changed from 10/11/2026 to 10/15/2026.']);
  });
});
