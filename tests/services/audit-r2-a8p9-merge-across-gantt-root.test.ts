/**
 * Audit round 2 (A8 pass 9 review, A5 domain, 30 Sep 2026): the import merge
 * paired tasks across projects that share one Microsoft Project root.
 *
 * A master's rows under one root summary row ("PLZ 2400 Harbor Project")
 * carry that root as their schedule project and Harbor North or Harbor South
 * as their app project. Master F has Harbor North's Pour slab, which David
 * set to 90%. Master M drops it and adds Harbor South's Pour slab. The merge
 * paired rows by the root, so on Accept South's new task took North's 90% In
 * Progress and answered to North's row (revisedFromTaskIds), and every device
 * got it; Set Active carried North's progress onto South's task the same way.
 *
 * Now the merge pairs only tasks of the same app project. A single-project
 * Microsoft Project master pairs as before. Real Microsoft Project normalizer
 * and merge. Synthetic data.
 */
import type { ReferenceDocument, ScheduleItem } from '../../types';
import { normalizeMicrosoftProjectPdfRows } from '../../services/PIEScheduleIntelligence';
import { selectAuthoritativeScheduleItems } from '../../services/PIEScheduleReconciliation';
import {
  mergeApprovedScheduleImportItems,
  scheduleItemsVisibleBeforeImport,
  scheduleProgressCarriedOnActivation,
} from '../../services/ScheduleImportMerge';
import { scheduleDocumentsAfterActivation } from '../../services/SharedDocumentActivation';

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
const shown = (state: State) => selectAuthoritativeScheduleItems({ scheduleItems: state.items, scheduleDocuments: state.documents }) as ScheduleItem[];
const pourOf = (items: readonly ScheduleItem[], project: string) => items.find(item => item.taskName === 'Pour slab' && item.projectName === project);
/** David enters a percent on the phone. */
const entered = (state: State, id: string, percentComplete: number, at: string): State => ({
  ...state,
  items: state.items.map(item => item.id === id ? {
    ...item, percentComplete, status: 'In Progress', progressSource: 'project_manager', progressConfirmedAt: at, progressConfirmedBy: 'David', updatedAt: at,
  } as ScheduleItem : item),
});

describe('A8 p9 review (A5 domain): the merge never pairs tasks of two projects under one Gantt root', () => {
  const HARBOR = ['Harbor North', 'Harbor South'];
  const f = schedule('HARBOR 0831', '2026-08-31T12:00:00.000Z', HARBOR);
  const m = schedule('HARBOR 0926', '2026-09-26T08:00:00.000Z', HARBOR);
  const fRows = mspRows(f, HARBOR, [
    ['Harbor North', 1, '09/01/2026\t10/31/2026', '10%'],
    ['Pour slab', 2, '09/28/2026\t09/30/2026', '20%'],
    ['Harbor South', 1, '09/01/2026\t10/31/2026', '10%'],
    ['Framing', 2, '10/12/2026\t10/20/2026', '0%'],
  ]);
  const mRows = mspRows(m, HARBOR, [
    ['Harbor North', 1, '09/01/2026\t10/31/2026', '10%'],
    ['Inspect', 2, '10/01/2026\t10/02/2026', '0%'],
    ['Harbor South', 1, '09/01/2026\t10/31/2026', '10%'],
    ['Framing', 2, '10/12/2026\t10/20/2026', '0%'],
    ['Pour slab', 2, '10/05/2026\t10/07/2026', '0%'],
  ]);
  const onF = approve({ items: [], documents: [] }, f, fRows);
  const north = pourOf(onF.items, 'Harbor North')!;
  const withNinety = entered(onF, north.id, 90, '2026-09-20T15:00:00.000Z');

  it('the rows share the root and differ by app project', () => {
    expect(north.scheduleProjectName).toBeTruthy();
    expect(pourOf(mRows, 'Harbor South')!.scheduleProjectName).toBe(north.scheduleProjectName);
  });

  it('on Accept, South\'s new Pour slab is a new task at its file\'s 0%, answering to no North row', () => {
    const onM = approve(withNinety, m, mRows);
    const south = pourOf(shown(onM), 'Harbor South')!;
    expect(south).toBeDefined();
    expect([south.percentComplete, south.status]).toEqual([0, 'Not Started']);
    expect(south.revisedFromTaskIds ?? []).toEqual([]);
    expect(south.progressSource ?? null).not.toBe('project_manager');
  });

  it('Set Active does not carry North\'s progress onto South\'s Pour slab either', () => {
    const onM = approve(withNinety, m, mRows);
    const mDoc = onM.documents.find(document => document.id === m.id)!;
    const fDoc = onM.documents.find(document => document.id === f.id)!;
    // Back to F, David enters 95% on North's Pour slab, then Set Active on M.
    const backOnF = { ...onM, documents: scheduleDocumentsAfterActivation(fDoc, onM.documents, 'project') };
    const ninetyFive = entered(backOnF, north.id, 95, '2026-09-28T15:00:00.000Z');
    const documentsAfter = scheduleDocumentsAfterActivation(mDoc, ninetyFive.documents, 'project');
    const carried = scheduleProgressCarriedOnActivation({
      items: ninetyFive.items, documentsBefore: ninetyFive.documents, documentsAfter, now: '2026-09-29T09:00:00.000Z',
    });
    expect(carried.filter(item => item.projectName === 'Harbor South')).toEqual([]);
  });

  it('a single-project Microsoft Project master still pairs a moved task, with David\'s progress and its earlier id', () => {
    const ONE = ['Harbor North'];
    const f1 = schedule('NORTH 0831', '2026-08-31T12:00:00.000Z', ONE);
    const m1 = schedule('NORTH 0926', '2026-09-26T08:00:00.000Z', ONE);
    const first = approve({ items: [], documents: [] }, f1, mspRows(f1, ONE, [
      ['Harbor North', 1, '09/01/2026\t10/31/2026', '10%'], ['Pour slab', 2, '09/28/2026\t09/30/2026', '20%'],
    ]));
    const pour = pourOf(first.items, 'Harbor North')!;
    const revised = approve(entered(first, pour.id, 90, '2026-09-20T15:00:00.000Z'), m1, mspRows(m1, ONE, [
      ['Harbor North', 1, '09/01/2026\t10/31/2026', '10%'], ['Pour slab', 2, '09/29/2026\t10/01/2026', '20%'],
    ]));
    const now = pourOf(shown(revised), 'Harbor North')!;
    expect(now.id).not.toBe(pour.id);
    expect([now.percentComplete, now.revisedFromTaskIds]).toEqual([90, [pour.id]]);
  });
});
