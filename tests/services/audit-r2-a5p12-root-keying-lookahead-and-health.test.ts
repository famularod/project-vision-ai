/**
 * Audit round 2, A5 pass 12 leftovers K1 (1 Oct 2026): two places still keyed
 * a task by its Microsoft Project root (scheduleProjectName) before its app
 * project (projectName), after the merge, the delete, the recovery and the
 * shown schedule moved to the app project (scheduleTaskProjectKey).
 *
 * On the web David uploads a combined Microsoft Project master for Harbor
 * North and Harbor South. Every row keeps the root ("2400 Compliance
 * Project") as its schedule project, with its building as its app project,
 * and both buildings have an Install HVAC on the same dates.
 *
 * - The import review on the phone (suggestScheduleImportRole) measured the
 *   master's dates per project from the rows whose ROOT named the project.
 *   No row's root is Harbor North, so a three-week lookahead was suggested
 *   as a full schedule replacing the master: "its dates could not be
 *   compared with the master for Harbor North".
 * - The web's Data health (buildDAVEWebTruthDiagnostics) grouped tasks by
 *   root, area, name and finish, so the two buildings' Install HVAC read as
 *   one duplicated task: "1 duplicate task occurrence group need review."
 *
 * Now both key a task by its app project. The review still finds a master
 * saved for the root itself. A single-building Microsoft Project master
 * keeps its root too, so the review could not measure it either; it now
 * does, and in Data health it behaves as before. CSV masters (no root) and
 * real duplicates in one building behave as before. Real web upload path
 * (Microsoft Project PDF pages, the web's row mapping), the phone's CSV
 * import. Synthetic data.
 */
import type { ReferenceDocument, ScheduleItem } from '../../types';

jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() }));
jest.mock('expo-crypto', () => ({ randomUUID: () => `uuid-${Math.random().toString(16).slice(2)}` }));

import { prepareDAVEWebDocumentUpload } from '../../services/DAVEWebOperations';
import { normalizeScheduleImport } from '../../services/PIEScheduleIntelligence';
import { suggestScheduleImportRole } from '../../services/ScheduleLookahead';

const HARBOR = ['Harbor North', 'Harbor South'];
const NORTH = ['Harbor North'];

type Row = readonly [name: string, indent: number, start: string, finish: string, percent: string];
/** A Microsoft Project PDF page as the web's extractor positions it (as audit-r2-a5p12-combined-master-per-project-current.test.ts). */
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

/** The web's upload of a schedule file (prepareDAVEWebDocumentUpload), saved current with stable ids. */
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
  const document = { ...prepared.document, id, name: id, isCurrent: true } as ReferenceDocument;
  const items = prepared.scheduleItems.map((item, index) => ({ ...item, id: `${id}-${index + 1}`, sourceDocumentId: id }) as ScheduleItem);
  return { document, items };
}

/** A building's rows under the campus root: the same three tasks in each building, on the same dates. */
const building = (name: string): Row[] => [
  [name, 1, '09/01/2026', '12/18/2026', '0%'],
  ['POUR SLAB', 2, '09/01/2026', '09/03/2026', '0%'],
  ['INSTALL HVAC', 2, '10/05/2026', '10/07/2026', '0%'],
  ['PUNCH LIST', 2, '12/14/2026', '12/18/2026', '0%'],
];
const ROOT: Row = ['PLZ 2400 HARBOR CAMPUS', 0, '09/01/2026', '12/18/2026', '0%'];
const combinedRows: Row[] = [ROOT, ...building('HARBOR NORTH'), ...building('HARBOR SOUTH')];
const northRows: Row[] = [ROOT, ...building('HARBOR NORTH')];

/** A schedule file picked on the phone, in the import review (no role yet). */
function phoneCsvReview(id: string, projects: string[], lines: string[]) {
  const document = {
    id, name: id, originalFileName: `${id}.csv`, uri: '', category: 'Schedules', notes: '', isCurrent: true,
    importedAt: '2026-09-28T12:00:00.000Z', projectId: null, projectName: projects.length === 1 ? projects[0] : null,
    projectNames: projects, importBatchId: `batch-${id}`,
  } as ReferenceDocument;
  const items = (normalizeScheduleImport({
    contents: ['Task,Project,Area,Start,Finish', ...lines].join('\n'), sourceName: document.originalFileName, mimeType: 'text/csv',
    projects, now: new Date(document.importedAt),
  }).items as ScheduleItem[]).map((row, index) => ({ ...row, id: `${id}-${index + 1}`, importBatchId: document.importBatchId }));
  return { documents: [document], items };
}
/** Two weeks of October work for each building named. */
const october = (projects: string[]) => projects.flatMap(project => [
  `Install HVAC,${project},,10/05/2026,10/07/2026`,
  `Frame walls,${project},,10/12/2026,10/16/2026`,
]);

describe('A5 p12 K1: the import review measures a Microsoft Project master by its buildings, not its root', () => {
  const C = webUpload('MASTER C', HARBOR, '2026-09-15T12:00:00.000Z', { rows: combinedRows });

  it('the scenario: both buildings\' rows keep the root as their schedule project', () => {
    expect(C.items.map(item => [item.projectName, item.scheduleProjectName, item.taskName, item.finishDate])).toEqual([
      ['Harbor North', '2400 Compliance Project', 'POUR SLAB', '09/03/2026'],
      ['Harbor North', '2400 Compliance Project', 'INSTALL HVAC', '10/07/2026'],
      ['Harbor North', '2400 Compliance Project', 'PUNCH LIST', '12/18/2026'],
      ['Harbor South', '2400 Compliance Project', 'POUR SLAB', '09/03/2026'],
      ['Harbor South', '2400 Compliance Project', 'INSTALL HVAC', '10/07/2026'],
      ['Harbor South', '2400 Compliance Project', 'PUNCH LIST', '12/18/2026'],
    ]);
  });

  it('a two-week file for both buildings is suggested as a lookahead, against the master\'s dates', () => {
    const review = phoneCsvReview('HARBOR OCTOBER', HARBOR, october(HARBOR));
    expect(suggestScheduleImportRole({ batch: review, documents: [C.document], scheduleItems: C.items })).toEqual({
      role: 'lookahead',
      reason: 'its dates cover 12 days and the master for Harbor North covers 16 weeks',
    });
  });

  it('so is one for one building, and a lookahead that is itself a Microsoft Project file under the root', () => {
    const north = phoneCsvReview('NORTH OCTOBER', NORTH, october(NORTH));
    expect(suggestScheduleImportRole({ batch: north, documents: [C.document], scheduleItems: C.items }).role).toBe('lookahead');
    const pdf = webUpload('HARBOR OCTOBER PDF', HARBOR, '2026-09-28T12:00:00.000Z', {
      rows: [ROOT, ['HARBOR NORTH', 1, '10/05/2026', '10/16/2026', '0%'], ['INSTALL HVAC', 2, '10/05/2026', '10/07/2026', '0%'],
        ['FRAME WALLS', 2, '10/12/2026', '10/16/2026', '0%']],
    });
    expect(pdf.items[0]).toMatchObject({ projectName: 'Harbor North', scheduleProjectName: '2400 Compliance Project' });
    expect(suggestScheduleImportRole({
      batch: { documents: [{ ...pdf.document, isCurrent: false }], items: pdf.items }, documents: [C.document], scheduleItems: C.items,
    })).toEqual({ role: 'lookahead', reason: 'its dates cover 12 days and the master for Harbor North covers 16 weeks' });
  });

  it('a single-building Microsoft Project master is measured the same way', () => {
    const N1 = webUpload('MASTER N1', NORTH, '2026-09-15T12:00:00.000Z', { rows: northRows });
    expect(N1.items[0]).toMatchObject({ projectName: 'Harbor North', scheduleProjectName: '2400 Compliance Project' });
    const north = phoneCsvReview('NORTH OCTOBER', NORTH, october(NORTH));
    expect(suggestScheduleImportRole({ batch: north, documents: [N1.document], scheduleItems: N1.items })).toEqual({
      role: 'lookahead', reason: 'its dates cover 12 days and the master for Harbor North covers 16 weeks',
    });
  });

  it('a file as long as the master stays a full schedule, and with no master there is none to compare', () => {
    const long = phoneCsvReview('HARBOR REV 2', HARBOR, [...october(HARBOR), 'Punch list,Harbor North,,12/14/2026,12/18/2026']);
    expect(suggestScheduleImportRole({ batch: long, documents: [C.document], scheduleItems: C.items }).role).toBe('master');
    const review = phoneCsvReview('HARBOR OCTOBER', HARBOR, october(HARBOR));
    expect(suggestScheduleImportRole({ batch: review, documents: [], scheduleItems: [] })).toEqual({
      role: 'master', reason: 'there is no master schedule for Harbor North, Harbor South yet',
    });
  });

  it('a CSV master (no root) behaves as before', () => {
    const csv = webUpload('MASTER CSV', HARBOR, '2026-09-15T12:00:00.000Z', {
      csv: ['Task,Project,Area,Start,Finish', ...HARBOR.flatMap(project => [
        `Pour slab,${project},,09/01/2026,09/03/2026`, `Install HVAC,${project},,10/05/2026,10/07/2026`, `Punch list,${project},,12/14/2026,12/18/2026`,
      ])],
    });
    expect(csv.items[0]).toMatchObject({ projectName: 'Harbor North', scheduleProjectName: 'Harbor North' });
    const review = phoneCsvReview('HARBOR OCTOBER', HARBOR, october(HARBOR));
    expect(suggestScheduleImportRole({ batch: review, documents: [csv.document], scheduleItems: csv.items })).toEqual({
      role: 'lookahead', reason: 'its dates cover 12 days and the master for Harbor North covers 16 weeks',
    });
  });

  it('a master saved for the root itself (an app project made from it) is still found by the root', () => {
    // The phone makes a schedule's root an app project (ensureScheduleParentProjects); a master saved for it.
    const rootMaster = { ...C.document, id: 'ROOT MASTER', projectName: '2400 Compliance Project', projectNames: ['2400 Compliance Project'] };
    const rows = C.items.map(item => ({ ...item, sourceDocumentId: rootMaster.id }));
    const pdf = webUpload('ROOT OCTOBER PDF', ['2400 Compliance Project'], '2026-09-28T12:00:00.000Z', {
      rows: [ROOT, ['HARBOR NORTH', 1, '10/05/2026', '10/16/2026', '0%'], ['INSTALL HVAC', 2, '10/05/2026', '10/07/2026', '0%'],
        ['FRAME WALLS', 2, '10/12/2026', '10/16/2026', '0%']],
    });
    expect(suggestScheduleImportRole({
      batch: { documents: [{ ...pdf.document, isCurrent: false }], items: pdf.items }, documents: [rootMaster], scheduleItems: rows,
    })).toEqual({ role: 'lookahead', reason: 'its dates cover 12 days and the master for 2400 Compliance Project covers 16 weeks' });
  });
});
