/**
 * Audit round 2, A5 pass 14 L3 (1 Oct 2026, cosmetic, phone only): the
 * phone's Timeline labelled every task of a CSV master imported on the phone
 * "Unassigned Project". The phone's CSV import names each row's app project
 * (projectName) and no schedule root (scheduleProjectName), and the Gantt
 * model's default grouping (the schedule root) had no fall-back, unlike the
 * Lookahead's default.
 *
 * Now the default falls back to the task's project when it names no root, as
 * the Lookahead does. A Microsoft Project master on the phone keeps its root
 * label (10808db); the web passes groupBy 'appProject'. Real CSV and
 * Microsoft Project normalizers. Synthetic data.
 */
import type { ScheduleItem } from '../../types';
import { normalizeMicrosoftProjectPdfRows, normalizeScheduleImport } from '../../services/PIEScheduleIntelligence';
import { buildVitruviusGanttModel } from '../../services/VitruviusGanttModel';
import { buildVitruviusLookahead } from '../../services/VitruviusLookahead';

const TODAY = new Date('2026-10-01T18:00:00.000Z');
const importedAt = new Date('2026-09-20T12:00:00.000Z');
const csvMaster = (normalizeScheduleImport({
  contents: [
    'Task,Project,Area,Start,Finish',
    'Pour slab,Alpha,Lot,10/01/2026,10/05/2026',
    'Framing,Alpha,Lot,10/10/2026,10/20/2026',
    'Roofing,Beta,Roof,10/06/2026,10/09/2026',
  ].join('\n'),
  sourceName: 'MASTER.csv', mimeType: 'text/csv', projects: ['Alpha', 'Beta'], now: importedAt,
}).items as ScheduleItem[]).map((item, index) => ({ ...item, id: `csv-${index + 1}` }));
const labels = (items: readonly ScheduleItem[]) =>
  buildVitruviusGanttModel({ items, zoom: 'week', today: TODAY }).rows.map(row => [row.item.taskName, row.projectName]);

describe('A5 p14 L3: the phone Timeline labels a phone-imported CSV master by its projects', () => {
  it('the scenario: the phone\'s CSV import names each row\'s project and no schedule root', () => {
    expect(csvMaster.map(item => [item.projectName, item.scheduleProjectName ?? null]))
      .toEqual([['Alpha', null], ['Alpha', null], ['Beta', null]]);
  });

  it('the Timeline\'s model labels Alpha\'s and Beta\'s tasks by project (was "Unassigned Project" for all)', () => {
    expect(labels(csvMaster)).toEqual([['Pour slab', 'Alpha'], ['Framing', 'Alpha'], ['Roofing', 'Beta']]);
  });

  it('the same labels as the phone\'s Lookahead and the web\'s grouping', () => {
    const lookahead = buildVitruviusLookahead({ items: csvMaster, weeks: 6, today: TODAY });
    expect(new Set(lookahead.rows.map(row => row.projectName))).toEqual(new Set(['Alpha', 'Beta']));
    expect(buildVitruviusGanttModel({ items: csvMaster, zoom: 'week', today: TODAY, groupBy: 'appProject' }))
      .toEqual(buildVitruviusGanttModel({ items: csvMaster, zoom: 'week', today: TODAY }));
  });

  it('unchanged: a Microsoft Project master on the phone keeps its root label; a task naming nothing is "Unassigned Project"', () => {
    const contents = [
      'ID\tTask Name\tIndent\tDuration\tStart\tFinish\tPercent Complete',
      '1\tPLZ 2375 Campus Project\t0\t60 days\t09/01/2026\t12/01/2026\t10%',
      '2\t2375A\t1\t30 days\t09/01/2026\t10/31/2026\t10%',
      '3\tPour slab\t2\t3 days\t10/01/2026\t10/05/2026\t0%',
      '4\t2375B\t1\t30 days\t09/01/2026\t10/31/2026\t10%',
      '5\tPour slab\t2\t3 days\t10/06/2026\t10/08/2026\t0%',
    ].join('\n');
    const msp = normalizeMicrosoftProjectPdfRows({ contents, sourceName: 'CAMPUS.pdf', projects: ['2375A', '2375B'], now: importedAt })
      .map((item, index) => ({ ...item, id: `msp-${index + 1}` }));
    expect(msp.map(item => item.projectName)).toEqual(['2375A', '2375B']);
    expect(new Set(labels(msp).map(([, project]) => project))).toEqual(new Set(['2375 Compliance Project']));
    const nothing = { ...csvMaster[0], id: 'blank', projectName: '', scheduleProjectName: null } as ScheduleItem;
    expect(labels([nothing])).toEqual([['Pour slab', 'Unassigned Project']]);
  });
});
