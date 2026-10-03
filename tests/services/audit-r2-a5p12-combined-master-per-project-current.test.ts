/**
 * Whole-app audit A5 pass 12 M (1 Oct 2026): with Make Current per project
 * (owner answer Q15), a task a combined Microsoft Project master shared with
 * a newer one-project master showed twice.
 *
 * On the web David uploads a combined Microsoft Project PDF master C for
 * Harbor North and Harbor South. The web keeps the Gantt root as each row's
 * schedule project ("2400 Compliance Project"), with Harbor North or Harbor
 * South as its app project. He enters 40% on North's Install HVAC. A newer
 * North-only master N2 moves the task; he makes N2 current, and the cloud
 * retires C for Harbor North only. The shown schedule picked a task's current
 * schedule by its schedule project, the root, which is none of the
 * schedules' projects, so it fell back to "any current schedule contains it":
 * C, still current for Harbor South, kept North's old row on show. North
 * showed Install HVAC twice (N2's 10/12 at 40%, and C's 10/05), on the web
 * and the phone.
 *
 * Now the shown schedule keys a task by its app project (as the merge, the
 * delete and the recovery do: scheduleTaskProjectKey), so C's North rows give
 * way to N2 while C stays Harbor South's schedule. Real web upload path
 * (Microsoft Project PDF pages, the web's row mapping), the web's import plan
 * and the web's read. Synthetic data.
 */
import type { ReferenceDocument, ScheduleItem } from '../../types';

jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() }));
jest.mock('../../services/DAVEWebSupabaseClient', () => ({
  ...jest.requireActual('../../services/DAVEWebSupabaseClient'),
  daveWebSupabaseGateway: { loadAuthorizedRows: jest.fn() },
}));

import { planDAVEWebScheduleImport, prepareDAVEWebDocumentUpload } from '../../services/DAVEWebOperations';
import { loadDAVEWebReadOnlySnapshot } from '../../services/DAVEWebReadOnlyRepository';
import { daveWebSupabaseGateway } from '../../services/DAVEWebSupabaseClient';
import type { DAVEWebScheduleItem } from '../../services/DAVEWebTaskEditing';
import { selectAuthoritativeScheduleItems } from '../../services/PIEScheduleReconciliation';
import { mergeApprovedScheduleImportItems, scheduleItemsVisibleBeforeImport } from '../../services/ScheduleImportMerge';

const HARBOR = ['Harbor North', 'Harbor South'];
const NORTH = ['Harbor North'];
const AT_40 = '2026-09-20T15:00:00.000Z';

type Row = readonly [name: string, indent: number, start: string, finish: string, percent: string];
/** A Microsoft Project PDF page as the web's extractor positions it (as dave-web-operations.test.ts). */
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

/** The web's upload of a schedule file (prepareDAVEWebDocumentUpload), approved and given stable ids. */
function webUpload(id: string, projects: string[], importedAt: string, file: { rows?: readonly Row[]; csv?: string[] }) {
  const prepared = prepareDAVEWebDocumentUpload({
    fileName: file.rows ? `${id}.pdf` : `${id}.csv`,
    mimeType: file.rows ? 'application/pdf' : 'text/csv',
    sizeBytes: 50_000,
    contents: file.rows ? 'ID Task Name\nDuration Start\nFinish' : file.csv!.join('\n'),
    extractedPages: file.rows ? [microsoftProjectPage(file.rows)] as never : [],
    category: 'Schedules',
    projectNames: projects,
    projects: HARBOR,
    fingerprint: id.replace(/[^a-f0-9]/gi, '').padEnd(64, 'a').slice(0, 64).toLowerCase(),
    now: importedAt,
  });
  expect(prepared.extractionStatus).toBe('ready');
  const document = { ...prepared.document, id, name: id } as ReferenceDocument;
  const items = prepared.scheduleItems.map((item, index) => ({ ...item, id: `${id}-${index + 1}`, sourceDocumentId: id }) as ScheduleItem);
  return { document, items };
}

type State = { items: ScheduleItem[]; documents: ReferenceDocument[] };
const shown = (state: State) =>
  selectAuthoritativeScheduleItems({ scheduleItems: state.items, scheduleDocuments: state.documents }) as ScheduleItem[];
/** The web's import plan over what the web shows (planDAVEWebScheduleImport), saved with the schedule not yet current. */
function uploadOnWeb(state: State, upload: { document: ReferenceDocument; items: ScheduleItem[] }): State {
  const plan = planDAVEWebScheduleImport({ snapshot: { scheduleItems: shown(state) as DAVEWebScheduleItem[] }, importedScheduleItems: upload.items });
  const revised = new Map(plan.revisions.map(revision => [revision.item.id, revision.item]));
  return {
    items: [...state.items.map(item => revised.get(item.id) || item), ...plan.additions],
    documents: [...state.documents, { ...upload.document, isCurrent: false }],
  };
}
/** Make Current for the schedule's projects (owner answer Q15): the cloud retires another schedule only for those. */
function makeCurrent(state: State, id: string): State {
  const target = state.documents.find(document => document.id === id)!;
  const projects = (target.projectNames || []).map(name => name.toLowerCase());
  return {
    ...state,
    documents: state.documents.map(document => {
      if (document.id === id) return { ...document, isCurrent: true, retiredForProjectNames: [] };
      const own = document.projectNames || [];
      const retired = own.filter(name => projects.includes(name.toLowerCase()));
      if (!document.isCurrent || retired.length === 0) return document;
      if (retired.length === own.length) return { ...document, isCurrent: false, retiredForProjectNames: [] };
      return { ...document, retiredForProjectNames: [...new Set([...(document.retiredForProjectNames || []), ...retired])] };
    }),
  };
}
/** David enters a percent. */
const entered = (state: State, id: string, percentComplete: number, at: string): State => ({
  ...state,
  items: state.items.map(item => item.id === id ? {
    ...item, percentComplete, status: 'In Progress', progressSource: 'project_manager', progressConfirmedBy: 'David',
    progressConfirmedAt: at, updatedAt: at,
  } as ScheduleItem : item),
});
const hvac = (items: readonly ScheduleItem[]) => items
  .filter(item => item.taskName.toLowerCase() === 'install hvac')
  .map(item => [item.projectName, item.startDate, item.percentComplete])
  .sort((left, right) => String(left).localeCompare(String(right)));
const northHvac = (items: readonly ScheduleItem[]) =>
  items.find(item => item.taskName.toLowerCase() === 'install hvac' && item.projectName === 'Harbor North')!;

/** The web's read of the same cloud rows (loadDAVEWebReadOnlySnapshot). */
async function webShows(state: State): Promise<ScheduleItem[]> {
  jest.mocked(daveWebSupabaseGateway.loadAuthorizedRows).mockResolvedValue({
    projects: HARBOR.map(name => ({ id: name, name, archived: false })),
    scheduleItems: state.items.map(item => ({ id: item.id, updated_at: item.updatedAt || AT_40, item_data: item })),
    projectUpdates: [],
    referenceDocuments: state.documents.map(document => ({
      id: document.id, name: document.name, category: 'Schedules', updated_at: AT_40, document_data: document,
    })),
    syncTombstones: [],
  } as never);
  return [...(await loadDAVEWebReadOnlySnapshot()).scheduleItems] as ScheduleItem[];
}

const combinedRows = (date: [string, string] = ['10/05/2026', '10/07/2026']): Row[] => [
  ['PLZ 2400 HARBOR CAMPUS', 0, '09/01/2026', '12/01/2026', '0%'],
  ['HARBOR NORTH', 1, '09/01/2026', '11/01/2026', '0%'],
  ['INSTALL HVAC', 2, ...date, '0%'],
  ['HARBOR SOUTH', 1, '09/01/2026', '11/01/2026', '0%'],
  ['INSTALL HVAC', 2, ...date, '0%'],
];
const northRows = (date: [string, string]): Row[] => [
  ['PLZ 2400 HARBOR CAMPUS', 0, '09/01/2026', '12/01/2026', '0%'],
  ['HARBOR NORTH', 1, '09/01/2026', '11/01/2026', '0%'],
  ['INSTALL HVAC', 2, ...date, '0%'],
];

describe('A5 p12 M: a combined master retired for one project no longer shows that project\'s tasks', () => {
  const C = webUpload('MASTER C', HARBOR, '2026-09-15T12:00:00.000Z', { rows: combinedRows() });
  const atC = makeCurrent(uploadOnWeb({ items: [], documents: [] }, C), C.document.id);
  const with40 = entered(atC, northHvac(shown(atC)).id, 40, AT_40);
  const N2 = webUpload('NORTH N2', NORTH, '2026-09-25T12:00:00.000Z', { rows: northRows(['10/12/2026', '10/14/2026']) });
  const uploaded = uploadOnWeb(with40, N2);
  const atN2 = makeCurrent(uploaded, N2.document.id);

  it('the scenario: the web keeps the root as both buildings\' schedule project, and Make Current retires C for North only', () => {
    expect(C.items.map(item => [item.projectName, item.scheduleProjectName])).toEqual([
      ['Harbor North', '2400 Compliance Project'],
      ['Harbor South', '2400 Compliance Project'],
    ]);
    expect(atN2.documents.find(document => document.id === C.document.id))
      .toMatchObject({ isCurrent: true, retiredForProjectNames: ['Harbor North'] });
    // The web's plan carried David's 40% to N2's moved row.
    expect(atN2.items.find(item => item.sourceDocumentId === N2.document.id)).toMatchObject({ startDate: '10/12/2026', percentComplete: 40 });
  });

  it('North shows Install HVAC once, from N2 at 40%; South keeps C\'s', () => {
    expect(hvac(shown(atN2))).toEqual([
      ['Harbor North', '10/12/2026', 40],
      ['Harbor South', '10/05/2026', 0],
    ]);
  });

  it('the web\'s read agrees with the phone', async () => {
    expect(hvac(await webShows(atN2))).toEqual([
      ['Harbor North', '10/12/2026', 40],
      ['Harbor South', '10/05/2026', 0],
    ]);
  });

  it('making C current again brings North back to C\'s row, and N2 leaves', async () => {
    const back = makeCurrent(atN2, C.document.id);
    expect(back.documents.find(document => document.id === N2.document.id)).toMatchObject({ isCurrent: false });
    const expected = [['Harbor North', '10/05/2026', 40], ['Harbor South', '10/05/2026', 0]];
    expect(hvac(shown(back))).toEqual(expected);
    expect(hvac(await webShows(back))).toEqual(expected);
  });

  it('retired the other way, for South, North keeps C\'s rows and South shows its own schedule', async () => {
    const S2 = webUpload('SOUTH S2', ['Harbor South'], '2026-09-25T12:00:00.000Z', {
      rows: [
        ['PLZ 2400 HARBOR CAMPUS', 0, '09/01/2026', '12/01/2026', '0%'],
        ['HARBOR SOUTH', 1, '09/01/2026', '11/01/2026', '0%'],
        ['INSTALL HVAC', 2, '10/19/2026', '10/21/2026', '0%'],
      ],
    });
    const atS2 = makeCurrent(uploadOnWeb(with40, S2), S2.document.id);
    const expected = [['Harbor North', '10/05/2026', 40], ['Harbor South', '10/19/2026', 0]];
    expect(hvac(shown(atS2))).toEqual(expected);
    expect(hvac(await webShows(atS2))).toEqual(expected);
  });

  it('a combined CSV master (no root) behaves the same', async () => {
    const csv = (dates: string) => ['Task,Project,Area,Start,Finish', `Install HVAC,Harbor North,,${dates}`, `Install HVAC,Harbor South,,${dates}`];
    const CSV = webUpload('MASTER CSV', HARBOR, '2026-09-15T12:00:00.000Z', { csv: csv('10/05/2026,10/07/2026') });
    const atCsv = makeCurrent(uploadOnWeb({ items: [], documents: [] }, CSV), CSV.document.id);
    const csv40 = entered(atCsv, northHvac(shown(atCsv)).id, 40, AT_40);
    const NCSV = webUpload('NORTH CSV', NORTH, '2026-09-25T12:00:00.000Z', {
      csv: ['Task,Project,Area,Start,Finish', 'Install HVAC,Harbor North,,10/12/2026,10/14/2026'],
    });
    const atNcsv = makeCurrent(uploadOnWeb(csv40, NCSV), NCSV.document.id);
    const expected = [['Harbor North', '10/12/2026', 40], ['Harbor South', '10/05/2026', 0]];
    expect(hvac(shown(atNcsv))).toEqual(expected);
    expect(hvac(await webShows(atNcsv))).toEqual(expected);
  });

  describe('a single-project Microsoft Project master shows what it showed', () => {
    const N1 = webUpload('NORTH N1', NORTH, '2026-09-15T12:00:00.000Z', { rows: northRows(['10/05/2026', '10/07/2026']) });
    const atN1 = makeCurrent(uploadOnWeb({ items: [], documents: [] }, N1), N1.document.id);

    it('its rows show while it is current, on the phone and the web', async () => {
      expect(N1.items[0]).toMatchObject({ projectName: 'Harbor North', scheduleProjectName: '2400 Compliance Project' });
      expect(hvac(shown(atN1))).toEqual([['Harbor North', '10/05/2026', 0]]);
      expect(hvac(await webShows(atN1))).toEqual([['Harbor North', '10/05/2026', 0]]);
    });

    it('a newer master for the project replaces it, and making it current again brings it back', () => {
      const atN2only = makeCurrent(uploadOnWeb(entered(atN1, N1.items[0].id, 40, AT_40), N2), N2.document.id);
      expect(hvac(shown(atN2only))).toEqual([['Harbor North', '10/12/2026', 40]]);
      expect(hvac(shown(makeCurrent(atN2only, N1.document.id)))).toEqual([['Harbor North', '10/05/2026', 40]]);
    });

    it('a row saved without a project still falls back to any current schedule containing it', () => {
      const unassigned = atN1.items.map(item => ({ ...item, projectName: '' }) as ScheduleItem);
      expect(shown({ items: unassigned, documents: atN1.documents }).map(item => item.id)).toEqual(unassigned.map(item => item.id));
    });
  });
});

describe('A5 p12 M: the shown schedule\'s other project keys are the app project too', () => {
  const C = webUpload('MASTER C', HARBOR, '2026-09-15T12:00:00.000Z', { rows: combinedRows() });
  const atC = makeCurrent(uploadOnWeb({ items: [], documents: [] }, C), C.document.id);

  it('a lookahead\'s copy left behind gives way to a newer combined master\'s, under one root', () => {
    // A three-week lookahead for Harbor North, approved on the phone, restates C's North Install HVAC in place (owner answer Q22).
    const lookahead = { ...C.document, id: 'NORTH LOOKAHEAD', name: 'NORTH LOOKAHEAD', originalFileName: 'NORTH LOOKAHEAD.csv',
      importBatchId: 'batch-north-lookahead', projectNames: NORTH, projectName: 'Harbor North', scheduleRole: 'lookahead',
      isCurrent: true, importedAt: '2026-09-18T12:00:00.000Z' } as ReferenceDocument;
    const restated = { ...northHvac(C.items), id: 'lookahead-1', importBatchId: lookahead.importBatchId, sourceDocumentId: lookahead.id, scheduleProjectName: null };
    const documents = [...atC.documents, lookahead];
    const merged = mergeApprovedScheduleImportItems({
      existing: atC.items, imported: [restated], completionMatch: () => null, mergeCompletion: item => item,
      isCurrent: scheduleItemsVisibleBeforeImport(atC.items, documents, lookahead.importBatchId!), overlay: true, approvedAt: lookahead.importedAt,
    });
    const withLookahead: State = { items: [...merged.additions, ...merged.next], documents };
    expect(hvac(shown(withLookahead))).toEqual([['Harbor North', '10/05/2026', 0], ['Harbor South', '10/05/2026', 0]]);
    // A newer combined master C2 moves both buildings' Install HVAC; the lookahead's copy stays behind.
    const C2 = webUpload('MASTER C2', HARBOR, '2026-09-25T12:00:00.000Z', { rows: combinedRows(['10/12/2026', '10/14/2026']) });
    const atC2 = makeCurrent(uploadOnWeb(withLookahead, C2), C2.document.id);
    expect(hvac(shown(atC2))).toEqual([['Harbor North', '10/12/2026', 0], ['Harbor South', '10/12/2026', 0]]);
  });

  it('one building\'s orphaned copy never hides the other building\'s twin under one root', () => {
    // North's Install HVAC kept at David's 40% from a schedule since deleted, same dates and area as C's rows.
    const orphan = {
      ...northHvac(C.items), id: 'orphan-north', importBatchId: 'batch-deleted', sourceDocumentId: 'DELETED', percentComplete: 40,
      status: 'In Progress', progressSource: 'project_manager', progressConfirmedBy: 'David', progressConfirmedAt: AT_40,
    } as ScheduleItem;
    expect(hvac(shown({ items: [...atC.items, orphan], documents: atC.documents }))).toEqual([
      ['Harbor North', '10/05/2026', 40],
      ['Harbor South', '10/05/2026', 0],
    ]);
  });
});
