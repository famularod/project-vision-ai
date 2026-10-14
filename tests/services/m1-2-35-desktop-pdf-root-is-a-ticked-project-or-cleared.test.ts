jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() }));

import * as web from '../../services/DAVEWebOperations';
import { resolveScheduleParentActions, scheduleParentProjectNames } from '../../services/PIEScheduleImportBatch';
import { selectAuthoritativeScheduleItems } from '../../services/PIEScheduleReconciliation';
import { narrowScheduleDocumentLabels } from '../../services/ScheduleDocumentLabels';
import { validateScheduleImportScope } from '../../services/ScheduleImportScopeGuard';
import type { ReferenceDocument, ScheduleItem } from '../../types';

// Open item 2.35 (the 2.33 fixer's R-2, "the PDF root door"; 13 Oct 2026). A schedule brought in on the computer from
// a Microsoft Project PDF kept the PDF's top line (its root) as every task's schedule parent, as written. Where that
// name is none of his projects, the next iPhone or iPad that loads made a project of that name
// (ensureScheduleParentProjects). The phone's own import keeps a parent only where it is one of the projects picked
// (guardScheduleParent) and clears it otherwise. The desktop now does the same with the projects ticked.
// The desktop's own functions; the page builder of review pass 10 (the web's positioned PDF rows). Made-up projects.

const NH = 'North Hall';
const SH = 'South Hall';
const GS = 'Garden shed';
// (A root that starts with a job number and says Campus, Project or Site is renamed by the app's reader; this one is
// read as written.)
const CAMPUS = 'Campus Works';
const ACTIVE = [NH, SH, GS];

type Row = readonly [name: string, indent: number, start: string, finish: string, percent: string];
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

const NORTH: Row[] = [['Pour deck', 2, '10/12/2026', '10/16/2026', '0%'], ['Framing', 2, '10/19/2026', '10/30/2026', '0%']];
const SOUTH: Row[] = [['Glazing', 2, '10/13/2026', '10/20/2026', '0%'], ['Paint', 2, '10/20/2026', '10/28/2026', '0%']];
/** One root over both buildings: the shape of a Microsoft Project file whose top line is the campus. */
const underRoot = (root: string): Row[] => [[root, 0, '10/12/2026', '10/30/2026', '0%'],
  [NH, 1, '10/12/2026', '10/30/2026', '0%'], ...NORTH, [SH, 1, '10/13/2026', '10/28/2026', '0%'], ...SOUTH];

const prepare = (ticked: readonly string[], rows: readonly Row[], projects: readonly string[] = ACTIVE) => {
  const page = microsoftProjectPage(rows);
  return web.prepareDAVEWebDocumentUpload({
    fileName: 'Campus plan.pdf', mimeType: 'application/pdf', sizeBytes: 50_000, contents: page.text, extractedPages: [page] as never,
    category: 'Schedules', projectNames: ticked, projects: [...projects], openProjectNames: [...projects], fingerprint: 'e'.repeat(64),
    now: '2026-10-15T21:00:00.000Z',
  });
};
const rowsOf = (prepared: ReturnType<typeof prepare>) => prepared.scheduleItems.map(item => `${item.taskName} [${item.projectName} | ${item.scheduleProjectName}]`);
/** What the next iPhone or iPad that loads would add as projects (App.tsx's ensureScheduleParentProjects, its own two functions). */
const projectsAPhoneWouldMake = (items: readonly ScheduleItem[], existing: readonly string[] = ACTIVE) => resolveScheduleParentActions({
  parentNames: scheduleParentProjectNames([...items]), existingProjects: [...existing], archivedProjects: [], reopenArchivedParents: false,
}).missingNames;

describe('the desktop keeps a Microsoft Project PDF\'s root only where it is a ticked project, as the phone does (open item 2.35)', () => {
  it('a root that is none of his projects ("Campus Works") is cleared: each task keeps its building, and a phone that loads makes no project', () => {
    const prepared = prepare([NH, SH], underRoot('Campus Works'));
    expect(rowsOf(prepared)).toEqual([
      `Pour deck [${NH} | ${NH}]`, `Framing [${NH} | ${NH}]`, `Glazing [${SH} | ${SH}]`, `Paint [${SH} | ${SH}]`,
    ]);
    expect(projectsAPhoneWouldMake(prepared.scheduleItems)).toEqual([]);
    // The same rows uploaded: every saved row's schedule parent is one of his projects.
    const reviewed = web.withDAVEWebScheduleUploadRole(prepared, 'master');
    expect(reviewed.scheduleItems.some(item => /campus/i.test(`${item.scheduleProjectName} ${item.projectName}`))).toBe(false);
  });

  it('with every project ticked, the full schedule is saved for the two buildings its tasks are under, and the phone\'s tidying then finds nothing to do', () => {
    const prepared = prepare(ACTIVE, underRoot('Campus Works'));
    const reviewed = web.withDAVEWebScheduleUploadRole(prepared, 'master');
    expect(reviewed.document.projectNames).toEqual([NH, SH]);
    const uploaded = { ...reviewed.document, id: 'CAMPUS-2', isCurrent: false } as ReferenceDocument;
    const rows = reviewed.scheduleItems.map(item => ({ ...item, sourceDocumentId: 'CAMPUS-2' }));
    expect(narrowScheduleDocumentLabels([uploaded], rows, '2026-10-15T22:00:00.000Z').changed).toEqual([]);
    expect(projectsAPhoneWouldMake(selectAuthoritativeScheduleItems({ scheduleItems: rows, scheduleDocuments: [uploaded] }) as ScheduleItem[])).toEqual([]);
  });

  it('a root that IS a ticked project is kept, under the project\'s own name (other capitals or a hyphen), as the phone keeps it', () => {
    for (const root of [NH, 'north hall', 'North-Hall']) {
      const prepared = prepare([NH, SH], [[root, 0, '10/12/2026', '10/30/2026', '0%'], ...NORTH.map(([name, , start, finish, percent]) => [name, 1, start, finish, percent] as Row)]);
      expect([root, rowsOf(prepared)]).toEqual([root, [`Pour deck [${NH} | ${NH}]`, `Framing [${NH} | ${NH}]`]]);
    }
  });

  it('a root that is a project of his but NOT ticked is cleared too, as the phone clears a parent it was not given', () => {
    const projects = [...ACTIVE, CAMPUS];
    const prepared = prepare([NH, SH], underRoot(CAMPUS), projects);
    expect(rowsOf(prepared)).toEqual([
      `Pour deck [${NH} | ${NH}]`, `Framing [${NH} | ${NH}]`, `Glazing [${SH} | ${SH}]`, `Paint [${SH} | ${SH}]`,
    ]);
    // Ticked as well, the root is kept, as the phone keeps a parent it was given.
    const kept = prepare([NH, SH, CAMPUS], underRoot(CAMPUS), projects);
    expect(kept.scheduleItems.map(item => item.scheduleProjectName)).toEqual([CAMPUS, CAMPUS, CAMPUS, CAMPUS]);
    // The phone's own function, handed those rows with only the two buildings picked, clears it.
    const phone = validateScheduleImportScope({ items: kept.scheduleItems, selectedProjects: [NH, SH].map(name => ({ id: name, name })) });
    expect(phone.items.map(item => item.scheduleProjectName)).toEqual([null, null, null, null]);
  });

  it('the "Full schedule or Lookahead" suggestion still reads the PDF\'s root as written (Build 231\'s suggestion, unchanged)', () => {
    // An account where a master was saved for the root itself (a project made from it): the suggestion compares with it.
    const master = { id: 'CAMPUS-1', name: 'CAMPUS-1', originalFileName: 'CAMPUS-1.pdf', uri: '', category: 'Schedules', notes: '', isCurrent: true,
      importedAt: '2026-09-01T12:00:00.000Z', projectId: null, projectName: 'Campus Works', projectNames: ['Campus Works'], importBatchId: 'batch-CAMPUS-1' } as ReferenceDocument;
    const old = (id: string, name: string, project: string, startDate: string, finishDate: string) => ({
      id, itemType: 'Task', taskName: name, projectId: null, projectName: project, scheduleProjectName: 'Campus Works', locationName: '', startDate, finishDate,
      milestone: '', owner: '', contractor: '', percentComplete: 0, priority: 'Medium', status: 'Not Started', notes: '', nextAction: '',
      importedFrom: 'CAMPUS-1.pdf', importBatchId: 'batch-CAMPUS-1', importedAt: '2026-09-01T12:00:00.000Z', updatedAt: '2026-09-01T12:00:00.000Z',
    }) as unknown as ScheduleItem;
    const items = [old('c1', 'Pour deck', NH, '10/12/2026', '10/16/2026'), old('c2', 'Fit out', NH, '06/01/2027', '08/27/2027'), old('c3', 'Glazing', SH, '10/13/2026', '10/20/2026')];
    const snapshot = { referenceDocuments: [master], scheduleItems: items, knownScheduleItems: items };
    const suggestion = web.daveWebScheduleUploadRoleSuggestion({ snapshot: snapshot as never, prepared: prepare([NH, SH], underRoot('Campus Works')) });
    expect(suggestion).toEqual({ role: 'lookahead', reason: 'its dates cover 3 weeks and the master for Campus Works covers about 11 months' });
  });

  it('a spreadsheet (no root) is prepared exactly as before', () => {
    const contents = ['Task,Project,Area,Start,Finish,Percent Complete', `Pour deck,${NH},Lot,10/12/2026,10/16/2026,0`, `Glazing,${SH},Lot,10/13/2026,10/20/2026,0`].join('\n');
    const prepared = web.prepareDAVEWebDocumentUpload({
      fileName: 'Campus plan.csv', mimeType: 'text/csv', sizeBytes: contents.length, contents, category: 'Schedules', projectNames: [NH, SH],
      projects: ACTIVE, openProjectNames: ACTIVE, fingerprint: 'f'.repeat(64), now: '2026-10-15T21:00:00.000Z',
    });
    expect(prepared.scheduleItems.map(item => [item.projectName, item.scheduleProjectName])).toEqual([[NH, NH], [SH, SH]]);
    expect(Object.keys(prepared).sort()).toEqual(['document', 'everyRowNamedAProject', 'extractionStatus', 'reviewMessage', 'scheduleItems']);
  });
});
