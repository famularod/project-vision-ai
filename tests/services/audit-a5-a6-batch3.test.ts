import { resolveReportProjectSelection } from '../../hooks/use-report-selection';
import { normalizeScheduleImport } from '../../services/PIEScheduleIntelligence';
import { mergeApprovedScheduleImportItems } from '../../services/ScheduleImportMerge';
import type { ScheduleItem } from '../../types';

const fs = jest.requireActual('fs') as typeof import('fs');
const path = jest.requireActual('path') as typeof import('path');
const app = fs.readFileSync(path.resolve(__dirname, '../../App.tsx'), 'utf8');

const task = (extra: Partial<ScheduleItem>): ScheduleItem => ({
  id: 't', projectName: 'Alpha', taskName: 'Pour footings', locationName: '', owner: '', startDate: '09/28/2026',
  finishDate: '10/05/2026', milestone: '', status: 'Not Started', percentComplete: 0, notes: '', createdAt: '2026-09-01T00:00:00.000Z',
  ...extra,
} as ScheduleItem);

// Whole-app audit A5 pass 2 and A6 pass 5 (30 Sep 2026).
describe('a revised import of a schedule saved before the area rule changed (A5 pass 2 H1)', () => {
  const merge = (existing: ScheduleItem[], imported: ScheduleItem[]) => mergeApprovedScheduleImportItems({
    existing,
    imported,
    completionMatch: () => null,
    mergeCompletion: item => item,
  });

  it('moves an unchanged task saved with no area to the new import and takes the area the file names', () => {
    const saved = task({ id: 'old-1', importBatchId: 'v1', sourceDocumentId: 'doc-v1', locationName: '', percentComplete: 60, status: 'In Progress', progressSource: 'project_manager' });
    const revised = task({ id: 'new-1', importBatchId: 'v2', sourceDocumentId: 'doc-v2', locationName: 'Building B' });
    const result = merge([saved], [revised]);
    expect(result.additions).toEqual([]);
    expect(result.rehomedIds).toEqual(['old-1']);
    expect(result.next[0]).toMatchObject({ id: 'old-1', importBatchId: 'v2', locationName: 'Building B', percentComplete: 60 });
  });

  it('carries the manager’s progress to a changed task saved with no area; a different saved area still does not match', () => {
    const saved = task({ id: 'old-2', importBatchId: 'v1', locationName: '', percentComplete: 60, status: 'In Progress', progressSource: 'project_manager' });
    const rescheduled = task({ id: 'new-2', importBatchId: 'v2', locationName: 'Building B', finishDate: '10/12/2026' });
    expect(merge([saved], [rescheduled]).additions[0]).toMatchObject({ id: 'new-2', percentComplete: 60 });
    const elsewhere = task({ id: 'old-3', importBatchId: 'v1', locationName: 'Building A', percentComplete: 60, status: 'In Progress', progressSource: 'project_manager' });
    expect(merge([elsewhere], [rescheduled]).additions[0]).toMatchObject({ id: 'new-2', percentComplete: 0 });
  });
});

describe('a CSV with a header row never guesses a named column by position (A5 pass 2 M1)', () => {
  const importCsv = (contents: string) => normalizeScheduleImport({
    contents, sourceName: 'schedule.csv', mimeType: 'text/csv', projects: ['Alpha'], projectAreas: [],
  }).items;

  it('no Area column leaves the area empty instead of taking the Start date or the owner', () => {
    const withStart = importCsv('Task,Project,Start,Finish,Owner\nPour footings,Alpha,09/28/2026,10/05/2026,David\n');
    expect(withStart[0]).toMatchObject({ taskName: 'Pour footings', locationName: '', owner: 'David' });
    const withOwner = importCsv('Task,Project,Owner,Finish\nPour footings,Alpha,David,10/05/2026\n');
    expect(withOwner[0]).toMatchObject({ taskName: 'Pour footings', locationName: '' });
  });

  it('a file with no header row still reads columns by position', () => {
    const headerless = importCsv('Pour footings,Alpha,Building B,09/28/2026,10/05/2026\n');
    expect(headerless[0]).toMatchObject({ taskName: 'Pour footings', locationName: 'Building B' });
  });
});

describe('Reports with no active project left (A6 pass 5 M2)', () => {
  it('the selection is empty rather than an unavailable name', () => {
    const select = (selectedWorkspaceProject: string, availableProjectNames: string[]) => resolveReportProjectSelection({
      availableProjectNames, selectedProjectNames: [], selectedWorkspaceProject, reportType: 'daily_project_update',
    });
    expect(select('', [])).toEqual([]);
    expect(select('Archived Tower', [])).toEqual([]);
    expect(select('Archived Tower', ['Alpha'])).toEqual(['Alpha']);
  });

  it('App builds no report for an empty selection and shows an empty state instead of the screen', () => {
    expect(app).toContain('const reportHasProjects = selectedReportProjectNames.length > 0;');
    expect(app).toMatch(/authorityMode !== 'reports' \|\| !reportHasProjects\n\s+\? undefined/);
    expect(app).toContain("const combinedReportScope = authorityMode === 'reports' && reportHasProjects && reportType === 'combined_project_update'");
    expect(app).toContain("const dailyReportScope = authorityMode === 'reports' && reportHasProjects && reportType === 'daily_project_update'");
    expect(app).toContain("{screen === 'Reports' && projectStatusReady && selectedReportProjectNames.length === 0 && (");
    expect(app).toContain("{screen === 'Reports' && projectStatusReady && selectedReportProjectNames.length > 0 && (");
  });
});
