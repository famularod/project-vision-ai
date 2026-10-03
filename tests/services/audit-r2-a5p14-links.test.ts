/**
 * Audit round 2, A5 pass 14 (1 Oct 2026): which task a field report links to.
 *
 * L1 (caused by 97190fb): master F has Pour slab; master M moves it, so M's
 * row lists F's. A "Pour slab is complete" report is filed on M's row. David
 * deletes M with its items while M is current: F is retired, nothing is
 * shown, and the delete writes M's row id onto F's hidden row (fd00285).
 * He approves corrected master N straight away; N's rows come in fresh (no
 * task was shown to pair with), so none lists anything. The report stays
 * current evidence (F's hidden row lists M's), but 97190fb made a deleted row
 * a saved row lists answer only through that chain, so it linked to no task:
 * reconciliation said "0 activities matched field evidence" and "Scheduled
 * work lacks recent field evidence" for N's Pour slab. Before 97190fb it
 * linked to N's Pour slab by its unique name.
 *
 * Now the twin guard looks at the schedule of each saved row that lists the
 * deleted id (its own schedule is gone): a name unique there falls back as
 * any other; a name shared there (97190fb's phase 1 / phase 2) still links
 * to nothing.
 *
 * L2 (older, from 79f49d3): separate per-building Microsoft Project masters
 * N1 (Harbor North) and S1 (Harbor South) share the root "2400 Compliance
 * Project", which the web keeps as every row's schedule project. A report is
 * filed on North's ROOF DRAINS; a newer North master N2 drops that task. The
 * name fallback took the shared root for a project match, so the report
 * linked to South's ROOF DRAINS and evidence correlation marked South's task
 * "completion_reported". Now a task is in the report's project by its app
 * project (scheduleTaskProjectKey, as A8 pass 9 M1 keyed the merge and the
 * delete); a report filed under the root itself (the web files a task's
 * report under its schedule project) still matches by the root, unless the
 * report's own saved row names another building. Single-project Microsoft
 * Project, CSV and PDF masters and rows with no app project (old copies)
 * link as before.
 *
 * Real CSV normalizer, the web's Microsoft Project PDF upload and import
 * plan, the phone's merge, activation and delete helpers, the shown-schedule
 * pick, reconciliation and evidence correlation. Synthetic data.
 */
import type { DAVESyncTombstone, ProjectUpdate, ReferenceDocument, ScheduleItem } from '../../types';
import { partitionProjectUpdatesByDeletedTask } from '../../services/DAVEDeletedTaskEvidence';
import { buildDAVEEvidenceCorrelations } from '../../services/DAVEEvidenceCorrelation';
import { planDAVEWebScheduleImport, prepareDAVEWebDocumentUpload } from '../../services/DAVEWebOperations';
import type { DAVEWebScheduleItem } from '../../services/DAVEWebTaskEditing';
import { normalizeScheduleImport } from '../../services/PIEScheduleIntelligence';
import { buildPIEScheduleReconciliation, scheduleDocumentIsScheduleLike, selectAuthoritativeScheduleItems } from '../../services/PIEScheduleReconciliation';
import { mergeApprovedScheduleImportItems, scheduleItemsVisibleBeforeImport } from '../../services/ScheduleImportMerge';
import { scheduleItemsOnlyInImportBatch } from '../../services/ScheduleImportProvenance';
import { scheduleItemsAfterScheduleDeleted } from '../../services/ScheduleLookahead';
import { scheduleTaskLinks } from '../../services/ScheduleTaskRevisions';
import { scheduleDocumentsAfterActivation } from '../../services/SharedDocumentActivation';

jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() }));

type State = { items: ScheduleItem[]; documents: ReferenceDocument[]; tombstones?: DAVESyncTombstone[] };
const shown = (state: State) => selectAuthoritativeScheduleItems({ scheduleItems: state.items, scheduleDocuments: state.documents }) as ScheduleItem[];
const named = (items: readonly ScheduleItem[], name: string) => items.find(item => item.taskName === name)!;
const row = (state: State, id: string) => state.items.find(item => item.id === id);

/** Approving a master merges its rows (paired with the rows shown) and makes it current (App.tsx). */
function approve(state: State, source: ReferenceDocument, imported: ScheduleItem[]): State {
  const merged = mergeApprovedScheduleImportItems({
    existing: state.items, imported, completionMatch: () => null, mergeCompletion: item => item,
    isCurrent: scheduleItemsVisibleBeforeImport(state.items, [...state.documents, source], source.importBatchId || ''), approvedAt: source.importedAt,
  });
  return {
    items: [...merged.additions, ...merged.next],
    documents: scheduleDocumentsAfterActivation(source, [...state.documents, source], 'project'),
    tombstones: state.tombstones,
  };
}

/** "Delete PDF + Items" as the phone does it (App.tsx), through the shared delete helper. */
function deleteWithItems(state: State, document: ReferenceDocument, at: string): State {
  const removed = scheduleItemsOnlyInImportBatch(state.items, document, state.documents.filter(scheduleDocumentIsScheduleLike));
  const removedIds = new Set(removed.map(item => item.id));
  const documents = state.documents.filter(other => other.id !== document.id);
  const kept = state.items.filter(item => !removedIds.has(item.id));
  const saved = new Map(scheduleItemsAfterScheduleDeleted({ items: kept, removed, document, documents, updatedAt: at })
    .map(item => [item.id, item]));
  const tombstones = [...removedIds].map(recordId => ({ entityType: 'schedule_item', recordId, deletedAt: at }) as DAVESyncTombstone);
  return { items: kept.map(item => saved.get(item.id) || item), documents, tombstones: [...(state.tombstones || []), ...tombstones] };
}

describe('A5 p14 L1: a report on a deleted newer master\'s row still links by a name unique in the schedule that lists it', () => {
  const schedule = (id: string, importedAt: string): ReferenceDocument => ({
    id, name: id, originalFileName: `${id}.csv`, uri: '', category: 'Schedules', notes: '', isCurrent: true, importedAt,
    projectId: null, projectName: 'Alpha', projectNames: ['Alpha'], importBatchId: `batch-${id}`,
  }) as ReferenceDocument;
  const F = schedule('MASTER F', '2026-08-31T12:00:00.000Z');
  const M = schedule('MASTER M', '2026-09-26T08:00:00.000Z');
  const N = schedule('MASTER N', '2026-09-30T14:00:00.000Z');
  const DELETED_M_AT = '2026-09-30T12:00:00.000Z';
  const NOW = new Date('2026-10-01T15:00:00.000Z');
  function rows(source: ReferenceDocument, lines: string[]): ScheduleItem[] {
    return (normalizeScheduleImport({
      contents: ['Task,Project,Area,Start,Finish', ...lines].join('\n'), sourceName: source.originalFileName, mimeType: 'text/csv',
      projects: ['Alpha'], now: new Date(source.importedAt),
    }).items as ScheduleItem[]).map((item, index) => ({
      ...item, id: `${source.id}-${index + 1}`, importBatchId: source.importBatchId, sourceDocumentId: source.id,
    }));
  }

  const FRAMING = 'Framing,Alpha,Lot,10/10/2026,10/20/2026';
  const onF = approve({ items: [], documents: [] }, F, rows(F, ['Pour slab,Alpha,Lot,10/01/2026,10/05/2026', FRAMING]));
  const fPour = named(onF.items, 'Pour slab');
  const onM = approve(onF, M, rows(M, ['Pour slab,Alpha,Lot,10/02/2026,10/06/2026', FRAMING]));
  const mPour = named(shown(onM), 'Pour slab');
  const deleted = deleteWithItems(onM, M, DELETED_M_AT);
  const onN = approve(deleted, N, rows(N, ['Pour slab,Alpha,Lot,10/03/2026,10/07/2026', FRAMING]));
  const nPour = named(shown(onN), 'Pour slab');

  const report: ProjectUpdate = {
    id: 'u-pour-complete', projectName: 'Alpha', scheduleProjectName: 'Alpha', date: '2026-09-29T16:00:00.000Z', photos: [],
    recipients: { contactIds: [] }, notes: 'Pour slab is complete.', scheduleItemId: mPour.id, scheduleTaskName: 'Pour slab',
    selectedAreaName: 'Lot',
  } as ProjectUpdate;

  it('the scenario: M\'s row lists F\'s; after the delete nothing is shown and F\'s hidden row lists M\'s; N\'s Pour slab lists nothing', () => {
    expect(mPour.revisedFromTaskIds).toEqual([fPour.id]);
    expect(onN.tombstones!.map(entry => entry.recordId)).toEqual([mPour.id]);
    expect(shown(deleted)).toEqual([]);
    expect(row(onN, fPour.id)!.revisedFromTaskIds).toEqual([mPour.id]);
    expect(nPour.id).not.toBe(fPour.id);
    expect(nPour.revisedFromTaskIds).toBeUndefined();
    expect(shown(onN).filter(item => item.taskName === 'Pour slab')).toEqual([nPour]);
  });

  it('the report stays current evidence and links to N\'s Pour slab by its unique name (it linked to no task)', () => {
    const split = partitionProjectUpdatesByDeletedTask([report], onN.tombstones!, update => update, { scheduleItems: onN.items });
    expect(split.active.map(update => update.id)).toEqual([report.id]);
    expect(scheduleTaskLinks(shown(onN), onN.items)(report)).toEqual({ item: nPour, basis: 'stored_task_name' });
  });

  it('reconciliation matches the report to N\'s Pour slab and no longer says it lacks recent field evidence', () => {
    const reconciliation = buildPIEScheduleReconciliation({
      scheduleItems: shown(onN), knownScheduleItems: onN.items, updates: [report], projectName: 'Alpha', now: NOW,
    });
    expect(reconciliation.matches.filter(match => match.updateId === report.id).map(match => match.scheduleItemId)).toEqual([nPour.id]);
    expect(reconciliation.summary).toContain('1 activities matched field evidence');
    expect(reconciliation.warnings.filter(warning => warning.scheduleItemId === nPour.id).map(warning => warning.title))
      .not.toContain('Scheduled work lacks recent field evidence');
  });

  it('97190fb still holds: when the schedule that lists the deleted row had two tasks of that name, the report links to none', () => {
    const twinsOnF = approve({ items: [], documents: [] }, F, rows(F, [
      'Pour slab,Alpha,Lot,10/01/2026,10/05/2026', 'Pour slab,Alpha,Lot,11/01/2026,11/05/2026', FRAMING,
    ]));
    const phase1 = twinsOnF.items.find(item => item.startDate === '10/01/2026')!;
    // M moved phase 1; the report on M's row; the delete wrote M's row id onto F's hidden phase-1 row.
    const hiddenPhase1 = { ...phase1, revisedFromTaskIds: [mPour.id] } as ScheduleItem;
    const known = [...twinsOnF.items.map(item => item.id === phase1.id ? hiddenPhase1 : item), nPour];
    expect(scheduleTaskLinks([nPour], known)(report)).toBeNull();
    // Control: the same report on a row nothing lists links by its unique name.
    expect(scheduleTaskLinks([nPour], known)({ ...report, scheduleItemId: 'row-nobody-lists' })).toEqual({ item: nPour, basis: 'stored_task_name' });
  });
});

describe('A5 p14 L2: a North report never links by name to South\'s task through a shared Microsoft Project root', () => {
  const HARBOR = ['Harbor North', 'Harbor South'];
  const ROOT = '2400 Compliance Project';
  type Row = readonly [name: string, indent: number, start: string, finish: string, percent: string];
  /** A Microsoft Project PDF page as the web's extractor positions it (as audit-r2-a5p12-combined-master-per-project-current). */
  function microsoftProjectPage(rows: readonly Row[]) {
    const regions: unknown[] = [];
    const addRegion = (text: string, x: number, y: number, width = 0.04) => {
      regions.push({ id: `region-${regions.length + 1}`, text, label: text, x, y, width, height: 0.01, source: 'embedded_text', confidence: 1 });
    };
    ([['ID', 0.03], ['Task Name', 0.05], ['Duration', 0.31], ['Start', 0.36], ['Finish', 0.41], ['%', 0.46]] as const)
      .forEach(([text, x]) => addRegion(text, x, 0.02));
    rows.forEach(([taskName, indent, start, finish, percent], index) => {
      const id = String(index + 1);
      const y = 0.05 + index * 0.02;
      const taskX = 0.05 + indent * 0.007;
      regions.push({
        id: `activity-${id}`, text: `${id} ${taskName}`, label: `${id} ${taskName}`, x: 0.03, y, width: 0.26, height: 0.01,
        source: 'embedded_text', confidence: 1,
        constituentEvidence: [
          { id: `activity-${id}-id`, text: id, source: 'embedded_text', confidence: 1, bounds: { x: 0.03, y, width: 0.012, height: 0.01 } },
          { id: `activity-${id}-task`, text: taskName, source: 'embedded_text', confidence: 1, bounds: { x: taskX, y, width: 0.29 - taskX, height: 0.01 } },
        ],
      });
      addRegion('3 days', 0.31, y);
      addRegion(start, 0.36, y);
      addRegion(finish, 0.41, y);
      addRegion(percent, 0.46, y, 0.025);
    });
    return { pageNumber: 1, text: (regions as { text: string }[]).map(region => region.text).join('\n'), regions };
  }
  /** The web's upload of a one-building Microsoft Project PDF master (prepareDAVEWebDocumentUpload), with stable ids. */
  function webUpload(id: string, project: string, importedAt: string, rows: readonly Row[]) {
    const prepared = prepareDAVEWebDocumentUpload({
      fileName: `${id}.pdf`, mimeType: 'application/pdf', sizeBytes: 50_000, contents: 'ID Task Name\nDuration Start\nFinish',
      extractedPages: [microsoftProjectPage(rows)] as never, category: 'Schedules', projectNames: [project], projects: HARBOR,
      fingerprint: id.replace(/[^a-f0-9]/gi, '').padEnd(64, 'a').slice(0, 64).toLowerCase(), now: importedAt,
    });
    expect(prepared.extractionStatus).toBe('ready');
    const document = { ...prepared.document, id, name: id } as ReferenceDocument;
    return { document, items: prepared.scheduleItems.map((item, index) => ({ ...item, id: `${id}-${index + 1}`, sourceDocumentId: id }) as ScheduleItem) };
  }
  /** The web's import plan over what is shown, saved with the schedule not yet current. */
  function uploadOnWeb(state: State, upload: { document: ReferenceDocument; items: ScheduleItem[] }): State {
    const plan = planDAVEWebScheduleImport({ snapshot: { scheduleItems: shown(state) as DAVEWebScheduleItem[] }, importedScheduleItems: upload.items });
    const revised = new Map(plan.revisions.map(revision => [revision.item.id, revision.item]));
    return { items: [...state.items.map(item => revised.get(item.id) || item), ...plan.additions], documents: [...state.documents, { ...upload.document, isCurrent: false }] };
  }
  /** Make Current for the schedule's projects (owner answer Q15): another schedule is retired only for those. */
  function makeCurrent(state: State, id: string): State {
    const projects = (state.documents.find(document => document.id === id)!.projectNames || []).map(name => name.toLowerCase());
    return {
      ...state,
      documents: state.documents.map(document => {
        if (document.id === id) return { ...document, isCurrent: true, retiredForProjectNames: [] };
        const own = document.projectNames || [];
        const retired = own.filter(name => projects.includes(name.toLowerCase()));
        if (!document.isCurrent || retired.length === 0) return document;
        return retired.length === own.length
          ? { ...document, isCurrent: false, retiredForProjectNames: [] }
          : { ...document, retiredForProjectNames: [...new Set([...(document.retiredForProjectNames || []), ...retired])] };
      }),
    };
  }
  const building = (name: string, tasks: readonly Row[]): Row[] => [
    ['PLZ 2400 HARBOR CAMPUS', 0, '09/01/2026', '12/01/2026', '0%'],
    [name, 1, '09/01/2026', '11/01/2026', '0%'],
    ...tasks,
  ];
  const ROOF_DRAINS: Row = ['ROOF DRAINS', 2, '10/02/2026', '10/06/2026', '0%'];
  const HVAC: Row = ['INSTALL HVAC', 2, '10/12/2026', '10/14/2026', '0%'];

  const N1 = webUpload('NORTH N1', 'Harbor North', '2026-09-10T12:00:00.000Z', building('HARBOR NORTH', [ROOF_DRAINS, HVAC]));
  const S1 = webUpload('SOUTH S1', 'Harbor South', '2026-09-11T12:00:00.000Z', building('HARBOR SOUTH', [ROOF_DRAINS, HVAC]));
  const onBoth = makeCurrent(uploadOnWeb(makeCurrent(uploadOnWeb({ items: [], documents: [] }, N1), N1.document.id), S1), S1.document.id);
  const drainsOf = (items: readonly ScheduleItem[], project: string) =>
    items.find(item => item.taskName === 'ROOF DRAINS' && item.projectName === project);
  const northDrains = drainsOf(shown(onBoth), 'Harbor North')!;
  const southDrains = drainsOf(shown(onBoth), 'Harbor South')!;
  // N2 drops ROOF DRAINS for North.
  const N2 = webUpload('NORTH N2', 'Harbor North', '2026-09-25T12:00:00.000Z', building('HARBOR NORTH', [HVAC]));
  const onN2 = makeCurrent(uploadOnWeb(onBoth, N2), N2.document.id);

  // Filed on the phone from North's task (App.tsx createNewUpdateForScheduleTask): its app project, and its root.
  const phoneReport = {
    id: 'u-north-drains', projectName: 'Harbor North', scheduleProjectName: ROOT, date: '2026-09-24T16:00:00.000Z', photos: [],
    recipients: { contactIds: [] }, notes: 'Roof drains are complete.', scheduleItemId: northDrains.id, scheduleTaskName: 'ROOF DRAINS',
    selectedAreaName: 'Unassigned / Unknown Area',
  } as ProjectUpdate;
  // Filed on the web from the same task (DAVEWebSupabaseClient): under the task's schedule project, the root.
  const webReport = { ...phoneReport, id: 'u-north-drains-web', projectName: ROOT, scheduleProjectName: ROOT } as ProjectUpdate;

  it('the scenario: both buildings\' masters keep the root as schedule project; after N2 North shows no ROOF DRAINS, South still does', () => {
    expect([northDrains, southDrains].map(item => [item.projectName, item.scheduleProjectName]))
      .toEqual([['Harbor North', ROOT], ['Harbor South', ROOT]]);
    expect(drainsOf(shown(onN2), 'Harbor North')).toBeUndefined();
    expect(drainsOf(shown(onN2), 'Harbor South')).toBe(southDrains);
    expect(onN2.items).toContain(northDrains); // N1's row is hidden, still saved
  });

  it('the North report links to no task, not to South\'s ROOF DRAINS (filed on the phone or on the web)', () => {
    const links = scheduleTaskLinks(shown(onN2), onN2.items);
    expect(links(phoneReport)).toBeNull();
    expect(links(webReport)).toBeNull();
  });

  it('evidence correlation no longer marks South\'s ROOF DRAINS "completion_reported"', () => {
    const correlation = buildDAVEEvidenceCorrelations({
      scheduleItems: shown(onN2), knownScheduleItems: onN2.items, updates: [phoneReport, webReport], now: '2026-09-26T12:00:00.000Z',
    });
    expect(correlation.tasks.find(task => task.taskId === southDrains.id)).toMatchObject({ conclusion: 'schedule_only' });
  });

  it('a North report still links by name to North\'s own task when North shows it', () => {
    // A report on a North row nothing records (a row saved before 79f49d3, say), while N1 is still current.
    const links = scheduleTaskLinks(shown(onBoth), onBoth.items);
    expect(links({ ...phoneReport, scheduleItemId: 'row-nobody-lists' })).toEqual({ item: northDrains, basis: 'stored_task_name' });
    expect(links({ ...phoneReport, scheduleItemId: northDrains.id })).toEqual({ item: northDrains, basis: 'task_id' });
  });

  it('unchanged: a single-project Microsoft Project master, filed on the phone or on the web', () => {
    const northOnly = makeCurrent(uploadOnWeb({ items: [], documents: [] }, N1), N1.document.id);
    const drains = drainsOf(shown(northOnly), 'Harbor North')!;
    const links = scheduleTaskLinks(shown(northOnly), northOnly.items);
    expect(links({ ...phoneReport, scheduleItemId: 'row-nobody-lists' })).toEqual({ item: drains, basis: 'stored_task_name' });
    expect(links({ ...webReport, scheduleItemId: 'row-nobody-lists' })).toEqual({ item: drains, basis: 'stored_task_name' });
  });

  it('unchanged: CSV and PDF masters, and an old copy that names no app project', () => {
    const task = (id: string, projectName: string, scheduleProjectName: string | null) => ({
      id, projectName, scheduleProjectName, locationName: 'Lot', taskName: 'Pour slab', startDate: '10/01/2026', finishDate: '10/05/2026',
      percentComplete: 0, status: 'Not Started', importBatchId: `batch-${id}`, sourceDocumentId: id,
    }) as ScheduleItem;
    const alphaReport = { ...phoneReport, projectName: 'Alpha', scheduleProjectName: 'Alpha', scheduleItemId: 'row-nobody-lists', scheduleTaskName: 'Pour slab', selectedAreaName: 'Lot' } as ProjectUpdate;
    const csv = task('csv-1', 'Alpha', 'Alpha');
    const pdf = task('pdf-1', 'Alpha', null);
    expect(scheduleTaskLinks([csv], [csv])(alphaReport)).toEqual({ item: csv, basis: 'stored_task_name' });
    expect(scheduleTaskLinks([pdf], [pdf])(alphaReport)).toEqual({ item: pdf, basis: 'stored_task_name' });
    expect(scheduleTaskLinks([csv], [csv])({ ...alphaReport, projectName: 'Beta', scheduleProjectName: 'Beta' })).toBeNull();
    // An old copy of a Microsoft Project row with a blank app project matches by its root, as before.
    const oldCopy = { ...task('old-1', '', ROOT), taskName: 'ROOF DRAINS', locationName: '' } as ScheduleItem;
    expect(scheduleTaskLinks([oldCopy], [oldCopy])({ ...phoneReport, scheduleItemId: 'row-nobody-lists' })).toEqual({ item: oldCopy, basis: 'stored_task_name' });
    expect(scheduleTaskLinks([oldCopy], [oldCopy])({ ...webReport, scheduleItemId: 'row-nobody-lists' })).toEqual({ item: oldCopy, basis: 'stored_task_name' });
  });
});
