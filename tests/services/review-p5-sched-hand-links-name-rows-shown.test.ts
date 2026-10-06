/*
 * Review pass 5, schedules (6 Oct 2026), P5-2, the list side (Medium; older, the same on 1fb4166).
 *
 * A hand link names its predecessor by a row's id. It was re-pointed only at the approval and at Set Active, from the
 * acting device's own copy, so a link made by a device that had not heard of a master (or approved over by one that
 * had not heard of the link) went on naming a row the master had hidden. The list now reads such a link as the row
 * shown for that task, whichever master is current; and the next change that saves links saves it so.
 *
 * (What follows the SUCCESSOR to its new row is in review-n2-sched-typed-text-carried-between-devices: the link is one
 * more thing he sets on a task.)
 */
import type { ReferenceDocument, ScheduleItem } from '../../types';
import { normalizeScheduleImport } from '../../services/PIEScheduleIntelligence';
import { selectAuthoritativeScheduleItems } from '../../services/PIEScheduleReconciliation';
import { mergeApprovedScheduleImportItems, scheduleItemsVisibleBeforeImport, scheduleProgressCarriedOnActivation } from '../../services/ScheduleImportMerge';
import { scheduleDocumentsAfterActivation } from '../../services/SharedDocumentActivation';

jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() }));
jest.mock('expo-file-system/legacy', () => ({ documentDirectory: null }));

type State = { items: ScheduleItem[]; documents: ReferenceDocument[] };
const shown = (state: State) => selectAuthoritativeScheduleItems({ scheduleItems: state.items, scheduleDocuments: state.documents }) as ScheduleItem[];
const schedule = (id: string, importedAt: string): ReferenceDocument => ({
  id, name: id, originalFileName: `${id}.csv`, uri: '', category: 'Schedules', notes: '', isCurrent: true, importedAt,
  projectId: null, projectName: 'Alpha', projectNames: ['Alpha'], importBatchId: `batch-${id}`,
}) as ReferenceDocument;
function approve(state: State, source: ReferenceDocument, lines: string[]): State {
  const imported = (normalizeScheduleImport({
    contents: ['Task,Project,Area,Start,Finish,Percent Complete', ...lines].join('\n'), sourceName: source.originalFileName,
    mimeType: 'text/csv', projects: ['Alpha'], projectAreas: [], now: new Date(source.importedAt as string),
  }).items as ScheduleItem[]).map((item, index) => ({ ...item, id: `${source.id}-${index + 1}`, importBatchId: source.importBatchId, sourceDocumentId: source.id }));
  const merged = mergeApprovedScheduleImportItems({
    existing: state.items, imported, completionMatch: () => null, mergeCompletion: item => item,
    isCurrent: scheduleItemsVisibleBeforeImport(state.items, [...state.documents, source], source.importBatchId || ''), approvedAt: source.importedAt as string,
  });
  return { items: [...merged.additions, ...merged.next], documents: scheduleDocumentsAfterActivation(source, [...state.documents, source], 'project') };
}
function setActive(state: State, id: string, at: string): State {
  const documentsAfter = scheduleDocumentsAfterActivation(state.documents.find(document => document.id === id)!, state.documents, 'project', at);
  const carried = new Map(scheduleProgressCarriedOnActivation({ items: state.items, documentsBefore: state.documents, documentsAfter, now: at }).map(item => [item.id, item]));
  return { items: state.items.map(item => carried.get(item.id) || item), documents: documentsAfter };
}
/** Framing's links: in the list, and as the row shown is saved. */
const links = (state: State) => {
  const framing = shown(state).find(item => item.taskName === 'Framing')!;
  const of = (item: ScheduleItem | undefined) => (item?.dependencies || []).map(link => link.predecessorItemId);
  return { row: framing.id, listed: of(framing), saved: of(state.items.find(item => item.id === framing.id)) };
};
/** A link saved on a row as a device that had not heard of the newer master would save it: naming the row it still saw. */
const savedLink = (state: State, onId: string, toId: string): State => ({
  ...state, items: state.items.map(item => (item.id === onId ? { ...item, dependencies: [{ predecessorItemId: toId, type: 'FS' as const, lagDays: 0 }], dependenciesUpdatedAt: '2026-09-11T09:00:00.000Z' } : item)),
});

const F = schedule('MASTER F', '2026-09-07T12:00:00.000Z');
const G = schedule('MASTER G', '2026-09-10T18:00:00.000Z');
const FRAMING = 'Framing,Alpha,Lot,10/15/2026,10/25/2026,';
const SURVEY = 'Survey,Alpha,Lot,10/12/2026,10/14/2026,';
const SURVEY_MOVED = 'Survey,Alpha,Lot,10/19/2026,10/21/2026,';
const onF = approve({ items: [], documents: [] }, F, [FRAMING, SURVEY]);
/** Master G moves Survey to a new row (MASTER G-2); Framing stays on its row. */
const onG = approve(onF, G, [FRAMING, SURVEY_MOVED]);

describe('Review P5-2: in the list a hand link names the row shown for its task', () => {
  it('a link saved naming the row a master has hidden is listed as naming the task\'s row shown; nothing is written for that', () => {
    expect(shown(onG).find(item => item.taskName === 'Survey')!.id).toBe('MASTER G-2');
    const linked = savedLink(onG, 'MASTER F-1', 'MASTER F-2');
    // (It was listed as saved: a link to MASTER F-2, which is not in the list.)
    expect(links(linked)).toEqual({ row: 'MASTER F-1', listed: ['MASTER G-2'], saved: ['MASTER F-2'] });
    // A link that names a row shown is the very row saved: no copy is made.
    const right = savedLink(onG, 'MASTER F-1', 'MASTER G-2');
    expect(shown(right).find(item => item.id === 'MASTER F-1')).toBe(right.items.find(item => item.id === 'MASTER F-1'));
  });

  it('whichever master is current: after Set Active back to the older master a link saved to the newer row is listed at the older one', () => {
    const linked = savedLink(onG, 'MASTER F-1', 'MASTER G-2');
    const withoutCarry: State = { ...linked, documents: setActive(linked, 'MASTER F', '2026-09-12T12:00:00.000Z').documents };
    expect(shown(withoutCarry).find(item => item.taskName === 'Survey')!.id).toBe('MASTER F-2');
    expect(links(withoutCarry)).toEqual({ row: 'MASTER F-1', listed: ['MASTER F-2'], saved: ['MASTER G-2'] });
  });

  it('the next change that saves links saves it as listed: Set Active to the other master and back', () => {
    const linked = savedLink(onG, 'MASTER F-1', 'MASTER F-2');
    const backOnF = setActive(linked, 'MASTER F', '2026-09-12T12:00:00.000Z');
    expect(links(backOnF)).toEqual({ row: 'MASTER F-1', listed: ['MASTER F-2'], saved: ['MASTER F-2'] });
    const onGAgain = setActive(backOnF, 'MASTER G', '2026-09-12T12:05:00.000Z');
    expect(links(onGAgain)).toEqual({ row: 'MASTER F-1', listed: ['MASTER G-2'], saved: ['MASTER G-2'] });
  });

  it('a link to a task no row of which is shown is left as it is, as before; and a link to the task\'s own row is not made of it', () => {
    const H = schedule('MASTER H', '2026-09-17T18:00:00.000Z');
    const dropped = approve(savedLink(onG, 'MASTER F-1', 'MASTER G-2'), H, [FRAMING]);
    expect(shown(dropped).map(item => item.taskName)).toEqual(['Framing']);
    expect(links(dropped)).toEqual({ row: 'MASTER F-1', listed: ['MASTER G-2'], saved: ['MASTER G-2'] });
  });
});
