/**
 * Owner answer Q29 (David, 2 Oct 2026): "YES, he links tasks by hand. Hand
 * links follow a task to its new row when a new master moves it."
 *
 * A link ("Roofing after Framing") is made by hand on the web's Schedule
 * Builder; no import brings links today. It stayed on the exact row it was
 * made on (whole-app audit A5 pass 15, A6 pass 15): a new master moving
 * either task onto a new row lost it from the moved task or left it pointing
 * at the old hidden row (the web's Schedule read "Missing"), and Delete PDF +
 * Items moved a link only to a row shown at that moment.
 *
 * Now a link follows its task: across masters (phone approval, web upload
 * then Make Current), Set Active and Make Current back and forth (a link
 * added or removed while one master is current goes with the task), and
 * Delete PDF + Items on the phone and the web. Real CSV normalizer, the
 * phone's merge, activation carry and delete helpers, the web's task build,
 * upload plan, Make Current carry and delete plan. Synthetic data.
 */
import type { ReferenceDocument, ScheduleDependency, ScheduleItem } from '../../types';
import { planDAVEWebScheduleDocumentDelete, planDAVEWebScheduleImport } from '../../services/DAVEWebOperations';
import { buildDAVEWebScheduleItem, type DAVEWebScheduleItem } from '../../services/DAVEWebTaskEditing';
import { normalizeScheduleImport } from '../../services/PIEScheduleIntelligence';
import { scheduleDocumentIsScheduleLike, selectAuthoritativeScheduleItems } from '../../services/PIEScheduleReconciliation';
import {
  mergeApprovedScheduleImportItems,
  scheduleItemsVisibleBeforeImport,
  scheduleProgressCarriedOnActivation,
  scheduleProgressCarriedToShownTasks,
} from '../../services/ScheduleImportMerge';
import { scheduleItemsOnlyInImportBatch } from '../../services/ScheduleImportProvenance';
import { scheduleDependenciesAfterScheduleDeleted, scheduleItemsAfterScheduleDeleted } from '../../services/ScheduleLookahead';
import { scheduleTaskLinkTargets } from '../../services/ScheduleTaskRevisions';
import { scheduleDocumentsAfterActivation } from '../../services/SharedDocumentActivation';

jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() }));

type State = { items: ScheduleItem[]; documents: ReferenceDocument[] };
const EMPTY: State = { items: [], documents: [] };
const shown = (state: State) => selectAuthoritativeScheduleItems({ scheduleItems: state.items, scheduleDocuments: state.documents }) as ScheduleItem[];
const task = (state: State, name: string) => {
  const found = shown(state).filter(item => item.taskName === name);
  expect(found).toHaveLength(1);
  return found[0];
};
/** What the web's Schedule and the phone show for a task's links: the names of the tasks shown they point at, or "Missing". */
const links = (state: State, name: string) => (task(state, name).dependencies || [])
  .map(link => shown(state).find(item => item.id === link.predecessorItemId)?.taskName ?? 'Missing')
  .sort();
const missingAnywhere = (state: State) => shown(state).flatMap(item => (item.dependencies || [])
  .filter(link => !shown(state).some(other => other.id === link.predecessorItemId)));

const schedule = (id: string, importedAt: string): ReferenceDocument => ({
  id, name: id, originalFileName: `${id}.csv`, uri: '', category: 'Schedules', notes: '', isCurrent: true, importedAt,
  projectId: null, projectName: 'Alpha', projectNames: ['Alpha'], importBatchId: `batch-${id}`,
}) as ReferenceDocument;

function rows(source: ReferenceDocument, lines: string[]): ScheduleItem[] {
  return (normalizeScheduleImport({
    contents: ['Task,Project,Area,Start,Finish,Percent Complete', ...lines].join('\n'), sourceName: source.originalFileName,
    mimeType: 'text/csv', projects: ['Alpha'], projectAreas: [], now: new Date(source.importedAt),
  }).items as ScheduleItem[]).map((item, index) => ({
    ...item, id: `${source.id}-${index + 1}`, importBatchId: source.importBatchId, sourceDocumentId: source.id,
  }));
}

/** Approving a master on the phone (App.tsx): the merge, then it is made current. */
function approve(state: State, source: ReferenceDocument, lines: string[]): State {
  const merged = mergeApprovedScheduleImportItems({
    existing: state.items, imported: rows(source, lines), completionMatch: () => null, mergeCompletion: item => item,
    isCurrent: scheduleItemsVisibleBeforeImport(state.items, [...state.documents, source], source.importBatchId || ''),
    approvedAt: source.importedAt,
  });
  return {
    items: [...merged.additions, ...merged.next],
    documents: scheduleDocumentsAfterActivation(source, [...state.documents, source], 'project'),
  };
}

/** The web's upload (not current until Make Current) and its Make Current (desktop-auth-provider). */
function upload(state: State, source: ReferenceDocument, lines: string[]): State {
  const plan = planDAVEWebScheduleImport({
    snapshot: { scheduleItems: shown(state).map(item => ({ ...item, cloudUpdatedAt: null })) as DAVEWebScheduleItem[] },
    importedScheduleItems: rows(source, lines),
  });
  const revised = new Map(plan.revisions.map(revision => [revision.item.id, revision.item as ScheduleItem]));
  return {
    items: [...state.items.map(item => revised.get(item.id) || item), ...plan.additions],
    documents: [...state.documents, { ...source, isCurrent: false }],
  };
}
function makeCurrent(state: State, source: ReferenceDocument, at: string): State {
  const documentsAfter = scheduleDocumentsAfterActivation(state.documents.find(document => document.id === source.id)!, state.documents, 'project', at);
  const carried = new Map(scheduleProgressCarriedToShownTasks({
    before: shown(state), after: shown({ ...state, documents: documentsAfter }), documentsBefore: state.documents, documentsAfter, now: at,
  }).map(item => [item.id, item]));
  return { items: state.items.map(item => carried.get(item.id) || item), documents: documentsAfter };
}
/** Set Active on the phone (App.tsx activateReferenceDocument). */
function setActive(state: State, source: ReferenceDocument, at: string): State {
  const documentsAfter = scheduleDocumentsAfterActivation(state.documents.find(document => document.id === source.id)!, state.documents, 'project', at);
  const carried = new Map(scheduleProgressCarriedOnActivation({ items: state.items, documentsBefore: state.documents, documentsAfter, now: at })
    .map(item => [item.id, item]));
  return { items: state.items.map(item => carried.get(item.id) || item), documents: documentsAfter };
}

/** David links a task on the web's Schedule Builder (buildDAVEWebScheduleItem). */
function link(state: State, name: string, predecessors: string[], at: string): State {
  const current = { ...task(state, name), cloudUpdatedAt: null } as DAVEWebScheduleItem;
  const dependencies: ScheduleDependency[] = predecessors.map(predecessor => ({ predecessorItemId: task(state, predecessor).id, type: 'FS' }));
  const built = buildDAVEWebScheduleItem({
    draft: {
      projectId: 'alpha', itemType: 'Task', taskName: current.taskName, projectName: current.projectName, locationName: current.locationName,
      startDate: current.startDate, finishDate: current.finishDate, milestone: current.milestone, owner: current.owner,
      contractor: current.contractor, percentComplete: String(current.percentComplete), priority: current.priority, status: current.status,
      notes: current.notes, nextAction: '', activityMessage: '', dependencies,
    },
    current: { ...current, projectId: 'alpha' }, id: current.id, now: at, actor: 'David',
  });
  const { cloudUpdatedAt: _cloud, ...saved } = built;
  return { ...state, items: state.items.map(item => item.id === current.id ? saved as ScheduleItem : item) };
}

/** Delete PDF + Items on the phone: the shared helper, then dropDeletedPredecessors (App.tsx). */
function phoneDelete(state: State, document: ReferenceDocument, at: string): State {
  const removed = scheduleItemsOnlyInImportBatch(state.items, document, state.documents.filter(scheduleDocumentIsScheduleLike));
  const removedIds = new Set(removed.map(item => item.id));
  const documents = state.documents.filter(other => other.id !== document.id);
  const kept = state.items.filter(item => !removedIds.has(item.id));
  const changed = new Map(scheduleItemsAfterScheduleDeleted({ items: kept, removed, document, documents, updatedAt: at }).map(item => [item.id, item]));
  let items = kept.map(item => changed.get(item.id) || item);
  const dropped = new Map(scheduleDependenciesAfterScheduleDeleted(items, [...removedIds], documents).map(change => [change.id, change.dependencies]));
  items = items.map(item => dropped.has(item.id) ? { ...item, dependencies: dropped.get(item.id) } : item);
  return { items, documents };
}
/** Delete Document + N Tasks on the web (planDAVEWebScheduleDocumentDelete, then the deletion records). */
function webDelete(state: State, document: ReferenceDocument, at: string): State {
  const removed = scheduleItemsOnlyInImportBatch(state.items, document, state.documents.filter(scheduleDocumentIsScheduleLike));
  const removedIds = new Set(removed.map(item => item.id));
  const revisions = planDAVEWebScheduleDocumentDelete({
    snapshot: { scheduleItems: shown(state) as DAVEWebScheduleItem[], knownScheduleItems: state.items, referenceDocuments: state.documents as never },
    document: { ...document, linkedScheduleItems: removed.map(item => ({ id: item.id, cloudUpdatedAt: null })), importedScheduleItemCount: removed.length } as never,
    updatedAt: at,
  });
  const revised = new Map(revisions.map(revision => [revision.item.id, revision.item as ScheduleItem]));
  return {
    items: state.items.filter(item => !removedIds.has(item.id)).map(item => revised.get(item.id) || item),
    documents: state.documents.filter(other => other.id !== document.id),
  };
}

const F = schedule('MASTER F', '2026-09-10T12:00:00.000Z');
const G = schedule('MASTER G', '2026-09-20T12:00:00.000Z');
const H = schedule('MASTER H', '2026-09-28T12:00:00.000Z');
const F_LINES = [
  'Excavate,Alpha,Lot,10/01/2026,10/05/2026,0',
  'Framing,Alpha,Lot,10/06/2026,10/16/2026,0',
  'Roofing,Alpha,Lot,10/19/2026,10/30/2026,0',
];
/** G moves Framing (a new row) and leaves Excavate and Roofing. */
const G_LINES = [
  'Excavate,Alpha,Lot,10/01/2026,10/05/2026,0',
  'Framing,Alpha,Lot,10/08/2026,10/18/2026,0',
  'Roofing,Alpha,Lot,10/19/2026,10/30/2026,0',
];
/** H moves all three. */
const H_LINES = [
  'Excavate,Alpha,Lot,10/02/2026,10/06/2026,0',
  'Framing,Alpha,Lot,10/09/2026,10/19/2026,0',
  'Roofing,Alpha,Lot,10/20/2026,10/31/2026,0',
];
const onF = approve(EMPTY, F, F_LINES);
const linkedOnF = link(link(onF, 'Framing', ['Excavate'], '2026-09-12T15:00:00.000Z'), 'Roofing', ['Framing'], '2026-09-12T15:05:00.000Z');

describe('Q29: hand links follow the task across masters', () => {
  it('a new master moving the task: the moved task keeps its link, and a link to it points at its new row', () => {
    const onG = approve(linkedOnF, G, G_LINES);
    expect(task(onG, 'Framing').id).not.toBe(task(onF, 'Framing').id);
    expect(links(onG, 'Framing')).toEqual(['Excavate']);
    expect(links(onG, 'Roofing')).toEqual(['Framing']);
    expect(missingAnywhere(onG)).toEqual([]);
    // Moving all three: still linked task to task.
    const onH = approve(onG, H, H_LINES);
    expect([links(onH, 'Framing'), links(onH, 'Roofing')]).toEqual([['Excavate'], ['Framing']]);
    expect(missingAnywhere(onH)).toEqual([]);
  });

  it('the web upload carries the links to its new rows; Make Current points every link at the rows shown', () => {
    const uploaded = upload(linkedOnF, G, G_LINES);
    // Not current yet: what David sees is unchanged.
    expect([links(uploaded, 'Framing'), links(uploaded, 'Roofing')]).toEqual([['Excavate'], ['Framing']]);
    const current = makeCurrent(uploaded, G, '2026-09-21T12:00:00.000Z');
    expect([links(current, 'Framing'), links(current, 'Roofing')]).toEqual([['Excavate'], ['Framing']]);
    expect(missingAnywhere(current)).toEqual([]);
  });

  it('Set Active and Make Current back and forth: links follow, and a link added or removed meanwhile goes with the task', () => {
    const onG = approve(linkedOnF, G, G_LINES);
    // Back to F on the phone: F's rows shown, linked as on G.
    const backToF = setActive(onG, F, '2026-09-22T12:00:00.000Z');
    expect(task(backToF, 'Framing').id).toBe(task(onF, 'Framing').id);
    expect([links(backToF, 'Framing'), links(backToF, 'Roofing')]).toEqual([['Excavate'], ['Framing']]);
    expect(missingAnywhere(backToF)).toEqual([]);
    // While F is current David also links Roofing after Excavate, then Make Current G on the web.
    const added = link(backToF, 'Roofing', ['Framing', 'Excavate'], '2026-09-23T12:00:00.000Z');
    const forwardToG = makeCurrent(added, G, '2026-09-24T12:00:00.000Z');
    expect(links(forwardToG, 'Roofing')).toEqual(['Excavate', 'Framing']);
    expect(missingAnywhere(forwardToG)).toEqual([]);
    // On G he removes Framing's link; back to F, F's Framing has none either.
    const removed = link(forwardToG, 'Framing', [], '2026-09-25T12:00:00.000Z');
    const againF = setActive(removed, F, '2026-09-26T12:00:00.000Z');
    expect(links(againF, 'Framing')).toEqual([]);
    expect(links(againF, 'Roofing')).toEqual(['Excavate', 'Framing']);
  });

  it('a link David removed stays removed when a newer master moves the task and he goes back to an older one', () => {
    const onG = approve(linkedOnF, G, G_LINES);
    const removed = link(onG, 'Framing', [], '2026-09-25T12:00:00.000Z');
    // H moves Framing again: its new row has no links, and David's removal goes with it.
    const onH = approve(removed, H, H_LINES);
    expect(links(onH, 'Framing')).toEqual([]);
    const backToF = setActive(onH, F, '2026-09-29T12:00:00.000Z');
    expect(task(backToF, 'Framing').id).toBe(task(onF, 'Framing').id);
    expect(links(backToF, 'Framing')).toEqual([]);
    expect(links(backToF, 'Roofing')).toEqual(['Framing']);
  });

  it('Delete PDF + Items of the old master: links on the tasks shown point at the rows shown (phone and web)', () => {
    const onG = approve(linkedOnF, G, G_LINES);
    for (const deleted of [phoneDelete(onG, F, '2026-09-27T12:00:00.000Z'), webDelete(onG, F, '2026-09-27T12:00:00.000Z')]) {
      expect([links(deleted, 'Framing'), links(deleted, 'Roofing')]).toEqual([['Excavate'], ['Framing']]);
      expect(missingAnywhere(deleted)).toEqual([]);
    }
  });

  it('Delete PDF + Items of the newer master while the older is current: the links stay with F\'s rows', () => {
    const onG = approve(linkedOnF, G, G_LINES);
    const backToF = link(setActive(onG, F, '2026-09-22T12:00:00.000Z'), 'Roofing', ['Framing', 'Excavate'], '2026-09-23T12:00:00.000Z');
    for (const deleted of [phoneDelete(backToF, G, '2026-09-27T12:00:00.000Z'), webDelete(backToF, G, '2026-09-27T12:00:00.000Z')]) {
      expect([links(deleted, 'Framing'), links(deleted, 'Roofing')]).toEqual([['Excavate'], ['Excavate', 'Framing']]);
      expect(missingAnywhere(deleted)).toEqual([]);
    }
  });

  it('a link to a deleted row follows its task even when the newer master is not current at that moment', () => {
    // F, then G moves Framing; the link was made while F was current (pointing at F's Framing) and never moved
    // (a build before this answer). David makes F current again and deletes F's file with its items: F's Framing is
    // removed, and the row that answers to it is G's, not shown now.
    const oldLink = approve(link(onF, 'Roofing', ['Framing'], '2026-09-12T15:00:00.000Z'), G, G_LINES);
    const fFraming = onF.items.find(item => item.taskName === 'Framing')!;
    const gFraming = task(oldLink, 'Framing');
    const stale = { ...oldLink, items: oldLink.items.map(item => item.taskName === 'Roofing'
      ? { ...item, dependencies: [{ predecessorItemId: fFraming.id, type: 'FS' as const }] } : item) };
    const fCurrent = { ...stale, documents: stale.documents.map(document => ({ ...document, isCurrent: document.id === F.id })) };
    const deleted = phoneDelete(fCurrent, F, '2026-09-27T12:00:00.000Z');
    const roofing = deleted.items.find(item => item.taskName === 'Roofing')!;
    expect(roofing.dependencies).toEqual([{ predecessorItemId: gFraming.id, type: 'FS' }]);
    // The web's Delete Document + N Tasks does the same (it left links pointing at nothing).
    const onWeb = webDelete(fCurrent, F, '2026-09-27T12:00:00.000Z');
    expect(onWeb.items.find(item => item.taskName === 'Roofing')!.dependencies).toEqual([{ predecessorItemId: gFraming.id, type: 'FS' }]);
    // Make Current G: Roofing after G's Framing, shown.
    const onG = makeCurrent({ ...deleted, documents: [...deleted.documents.map(document => ({ ...document, isCurrent: false }))] }, G, '2026-09-28T12:00:00.000Z');
    expect(links(onG, 'Roofing')).toEqual(['Framing']);
  });

  it('a link saved before this answer that points at a hidden row reads as the row shown, never "Missing"', () => {
    const fFraming = onF.items.find(item => item.taskName === 'Framing')!;
    const onG = approve(onF, G, G_LINES);
    const target = scheduleTaskLinkTargets(shown(onG), onG.items)(fFraming.id);
    expect(target?.id).toBe(task(onG, 'Framing').id);
    expect(target?.id).not.toBe(fFraming.id);
  });

  it('never links a task to itself or twice, and keeps a link\'s lag', () => {
    const lagged = { ...linkedOnF, items: linkedOnF.items.map(item => item.taskName === 'Roofing'
      ? { ...item, dependencies: [{ predecessorItemId: task(linkedOnF, 'Framing').id, type: 'FS' as const, lagDays: 2 }] } : item) };
    const onG = approve(lagged, G, G_LINES);
    expect(task(onG, 'Roofing').dependencies).toEqual([{ predecessorItemId: task(onG, 'Framing').id, type: 'FS', lagDays: 2 }]);
    // Framing linked after itself on F's row (a hand slip) is not carried as a self-link.
    const selfLinked = { ...linkedOnF, items: linkedOnF.items.map(item => item.taskName === 'Framing'
      ? { ...item, dependencies: [...(item.dependencies || []), { predecessorItemId: item.id, type: 'FS' as const }] } : item) };
    expect(links(approve(selfLinked, G, G_LINES), 'Framing')).toEqual(['Excavate']);
  });

  it('tasks with no links are left exactly as before', () => {
    const plainG = approve(onF, G, G_LINES);
    expect(plainG.items.every(item => item.dependencies === undefined || item.dependencies.length === 0)).toBe(true);
    expect(plainG.items.some(item => 'dependenciesUpdatedAt' in item)).toBe(false);
  });
});
