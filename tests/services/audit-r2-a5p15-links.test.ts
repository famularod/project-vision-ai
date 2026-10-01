/**
 * Audit round 2, A5 pass 15 (1 Oct 2026): which task a field report links to
 * after "Delete PDF + Items".
 *
 * L1 (caused by d80184c): separate Microsoft Project masters for Harbor North
 * (N1) and Harbor South (S1) share the root "2400 Compliance Project". N2
 * moves North's ROOF DRAINS, so N2's row lists N1's. A report is filed on the
 * web on N2's row (the web files it under the root). David deletes N2 with its
 * items while it is current: N1 is retired, nothing of North is shown, and
 * N1's hidden row now lists N2's row, so the report stays current evidence.
 * d80184c let that deleted row reach the name fallback through the saved rows
 * that list it, but the project filter still looked at the report's own saved
 * row, which is gone, so the root matched any building: the North report
 * linked to South's ROOF DRAINS and evidence correlation marked South's task
 * "completion_reported" (the same after a corrected N3 that drops ROOF
 * DRAINS). Now, for a deleted row, the saved rows that list it stand in for
 * its saved row in the project filter too: the report links to no task, and
 * still to North's own ROOF DRAINS when a North master shows one.
 *
 * The web's Microsoft Project PDF upload and import plan, the phone's delete
 * helper, the shown-schedule pick, the deleted-task split and evidence
 * correlation. Synthetic data.
 */
import type { DAVESyncTombstone, ProjectUpdate, ReferenceDocument, ScheduleItem } from '../../types';
import { partitionProjectUpdatesByDeletedTask } from '../../services/DAVEDeletedTaskEvidence';
import { buildDAVEEvidenceCorrelations } from '../../services/DAVEEvidenceCorrelation';
import { planDAVEWebScheduleImport, prepareDAVEWebDocumentUpload } from '../../services/DAVEWebOperations';
import type { DAVEWebScheduleItem } from '../../services/DAVEWebTaskEditing';
import { scheduleDocumentIsScheduleLike, selectAuthoritativeScheduleItems } from '../../services/PIEScheduleReconciliation';
import { scheduleItemsOnlyInImportBatch } from '../../services/ScheduleImportProvenance';
import { scheduleItemsAfterScheduleDeleted } from '../../services/ScheduleLookahead';
import { scheduleTaskLinks } from '../../services/ScheduleTaskRevisions';

jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() }));

type State = { items: ScheduleItem[]; documents: ReferenceDocument[]; tombstones?: DAVESyncTombstone[] };
const shown = (state: State) => selectAuthoritativeScheduleItems({ scheduleItems: state.items, scheduleDocuments: state.documents }) as ScheduleItem[];
const row = (state: State, id: string) => state.items.find(item => item.id === id);

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

describe('A5 p15 L1: a web-filed North report on a deleted North row never links by name to South\'s task', () => {
  const HARBOR = ['Harbor North', 'Harbor South'];
  const ROOT = '2400 Compliance Project';
  type Row = readonly [name: string, indent: number, start: string, finish: string, percent: string];
  /** A Microsoft Project PDF page as the web's extractor positions it (as audit-r2-a5p14-links). */
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
    return {
      ...state,
      items: [...state.items.map(item => revised.get(item.id) || item), ...plan.additions],
      documents: [...state.documents, { ...upload.document, isCurrent: false }],
    };
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
  const ROOF_DRAINS_MOVED: Row = ['ROOF DRAINS', 2, '10/09/2026', '10/13/2026', '0%'];
  const HVAC: Row = ['INSTALL HVAC', 2, '10/12/2026', '10/14/2026', '0%'];
  const DELETED_N2_AT = '2026-09-27T12:00:00.000Z';
  const CORRELATED_AT = '2026-09-30T12:00:00.000Z';

  const N1 = webUpload('NORTH N1', 'Harbor North', '2026-09-10T12:00:00.000Z', building('HARBOR NORTH', [ROOF_DRAINS, HVAC]));
  const S1 = webUpload('SOUTH S1', 'Harbor South', '2026-09-11T12:00:00.000Z', building('HARBOR SOUTH', [ROOF_DRAINS, HVAC]));
  const onBoth = makeCurrent(uploadOnWeb(makeCurrent(uploadOnWeb({ items: [], documents: [] }, N1), N1.document.id), S1), S1.document.id);
  const drainsOf = (items: readonly ScheduleItem[], project: string) =>
    items.find(item => item.taskName === 'ROOF DRAINS' && item.projectName === project);
  const n1Drains = drainsOf(shown(onBoth), 'Harbor North')!;
  const southDrains = drainsOf(shown(onBoth), 'Harbor South')!;
  // N2 moves North's ROOF DRAINS: its row lists N1's.
  const N2 = webUpload('NORTH N2', 'Harbor North', '2026-09-25T12:00:00.000Z', building('HARBOR NORTH', [ROOF_DRAINS_MOVED, HVAC]));
  const onN2 = makeCurrent(uploadOnWeb(onBoth, N2), N2.document.id);
  const n2Drains = drainsOf(shown(onN2), 'Harbor North')!;
  // "Delete PDF + Items" on N2 while it is current.
  const deleted = deleteWithItems(onN2, N2.document, DELETED_N2_AT);
  // A corrected N3 that drops ROOF DRAINS.
  const N3 = webUpload('NORTH N3', 'Harbor North', '2026-09-28T12:00:00.000Z', building('HARBOR NORTH', [HVAC]));
  const onN3 = makeCurrent(uploadOnWeb(deleted, N3), N3.document.id);

  // Filed on the web on N2's task (DAVEWebSupabaseClient): under the task's schedule project, the root.
  const webReport = {
    id: 'u-north-drains-web', projectName: ROOT, scheduleProjectName: ROOT, date: '2026-09-26T16:00:00.000Z', photos: [],
    recipients: { contactIds: [] }, notes: 'Roof drains are complete.', scheduleItemId: n2Drains.id, scheduleTaskName: 'ROOF DRAINS',
    selectedAreaName: 'Unassigned / Unknown Area',
  } as ProjectUpdate;
  // Filed on the phone from the same task (App.tsx createNewUpdateForScheduleTask): its app project, and its root.
  const phoneReport = { ...webReport, id: 'u-north-drains-phone', projectName: 'Harbor North' } as ProjectUpdate;

  it('the scenario: N2\'s row lists N1\'s; after the delete N1\'s hidden row lists N2\'s, North shows no ROOF DRAINS, South still does', () => {
    expect([n1Drains, southDrains, n2Drains].map(item => [item.projectName, item.scheduleProjectName]))
      .toEqual([['Harbor North', ROOT], ['Harbor South', ROOT], ['Harbor North', ROOT]]);
    expect(n2Drains.id).not.toBe(n1Drains.id);
    expect(n2Drains.revisedFromTaskIds).toEqual([n1Drains.id]);
    expect(deleted.tombstones!.map(entry => entry.recordId)).toEqual([n2Drains.id]);
    expect(row(deleted, n1Drains.id)!.revisedFromTaskIds).toEqual([n2Drains.id]);
    for (const state of [deleted, onN3]) {
      expect(drainsOf(shown(state), 'Harbor North')).toBeUndefined();
      expect(drainsOf(shown(state), 'Harbor South')).toBe(southDrains);
    }
  });

  it('the report stays current evidence (N1\'s hidden row lists N2\'s row)', () => {
    for (const state of [deleted, onN3]) {
      const split = partitionProjectUpdatesByDeletedTask([webReport, phoneReport], state.tombstones!, update => update, { scheduleItems: state.items });
      expect(split.active.map(update => update.id)).toEqual([webReport.id, phoneReport.id]);
    }
  });

  it('the web-filed report links to no task, not to South\'s ROOF DRAINS, after the delete and after N3 (as the phone-filed one)', () => {
    for (const state of [deleted, onN3]) {
      const links = scheduleTaskLinks(shown(state), state.items);
      expect(links(webReport)).toBeNull();
      expect(links(phoneReport)).toBeNull();
    }
  });

  it('evidence correlation no longer marks South\'s ROOF DRAINS "completion_reported"', () => {
    for (const state of [deleted, onN3]) {
      const correlation = buildDAVEEvidenceCorrelations({
        scheduleItems: shown(state), knownScheduleItems: state.items, updates: [webReport, phoneReport], now: CORRELATED_AT,
      });
      expect(correlation.tasks.find(task => task.taskId === southDrains.id)).toMatchObject({ conclusion: 'schedule_only' });
    }
  });

  it('a corrected North master that brings ROOF DRAINS back takes the report by its unique name (A5 p14 L1; it was a tie with South, so none)', () => {
    const N4 = webUpload('NORTH N4', 'Harbor North', '2026-09-28T12:00:00.000Z', building('HARBOR NORTH', [ROOF_DRAINS_MOVED, HVAC]));
    const onN4 = makeCurrent(uploadOnWeb(deleted, N4), N4.document.id);
    const n4Drains = drainsOf(shown(onN4), 'Harbor North')!;
    expect(n4Drains.id).not.toBe(n2Drains.id);
    const links = scheduleTaskLinks(shown(onN4), onN4.items);
    expect(links(webReport)).toEqual({ item: n4Drains, basis: 'stored_task_name' });
    expect(links(phoneReport)).toEqual({ item: n4Drains, basis: 'stored_task_name' });
  });

  it('unchanged: a web report under the root on a row nothing records never guesses between the buildings', () => {
    const links = scheduleTaskLinks(shown(onBoth), onBoth.items);
    expect(links({ ...webReport, scheduleItemId: 'row-nobody-lists' })).toBeNull();
    // Filed on the phone, its app project names the building.
    expect(links({ ...phoneReport, scheduleItemId: 'row-nobody-lists' })).toEqual({ item: n1Drains, basis: 'stored_task_name' });
  });
});
