jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() }));

import * as web from '../../services/DAVEWebOperations';

// Review pass H4, H4S-3 (Low, caused by M1's 4.88; 14 Oct 2026). A spreadsheet that lists one task twice, once with its
// project and once with the Project cell blank (same task, same finish, same area): before 4.88 the blank row took the
// first ticked project and the duplicate check made the two one task; since 4.88 the blank row waits, so the two stayed
// apart, he was asked for a project for the copy, and both were saved (the task listed twice after Make Current). Now a
// row that names no project is the same task as the ONE row of the file that names a ticked project and is the same by
// the duplicate check in all else, and is listed once, under that project. Where two such rows name different projects
// it cannot be told which, so it still waits. (The phone's own import keeps two here; said, not changed.) Made-up
// projects.

const QUAY = '6101 Quay Works';
const MILL = '6102 Mill Yard';
const SHED = 'Garden shed';
const ALL = [QUAY, MILL, SHED];
type Line = readonly [task: string, project: string, start: string, finish: string];
const csv = (rows: readonly Line[]) => ['Task,Project,Area,Start,Finish,Percent Complete', ...rows.map(([name, project, start, finish]) => `${name},${project},Lot,${start},${finish},`)].join('\n');
const prepare = (ticked: readonly string[], rows: readonly Line[]) => {
  const contents = csv(rows);
  return web.prepareDAVEWebDocumentUpload({
    fileName: 'Field plan.csv', mimeType: 'text/csv', sizeBytes: contents.length, contents, category: 'Schedules', projectNames: ticked,
    projects: ALL, openProjectNames: ALL, fingerprint: 'b'.repeat(64), now: '2026-10-14T09:00:00.000Z',
  });
};
type Prepared = ReturnType<typeof prepare>;
const listed = (prepared: Prepared) => prepared.scheduleItems.map(item => `${item.taskName} | ${web.daveWebScheduleUploadRowProject(prepared, item)}`);

describe('one task listed twice in a file, once with its Project cell blank, is one task (review pass H4, H4S-3)', () => {
  it('Quay ticked, "Pour footings" for Quay and again with no project: listed once, under Quay, nothing waits, and one row is uploaded', () => {
    for (const rows of [
      [['Pour footings', QUAY, '10/26/2026', '10/30/2026'], ['Pour footings', '', '10/26/2026', '10/30/2026'], ['Set steel', QUAY, '11/02/2026', '11/06/2026']],
      [['Pour footings', '', '10/26/2026', '10/30/2026'], ['Pour footings', QUAY, '10/26/2026', '10/30/2026'], ['Set steel', QUAY, '11/02/2026', '11/06/2026']],
    ] as Line[][]) {
      const prepared = prepare([QUAY], rows);
      expect(listed(prepared)).toEqual(['Pour footings | 6101 Quay Works', 'Set steel | 6101 Quay Works']);
      expect(prepared.reviewMessage.split('. ')[0]).toBe('2 schedule activities extracted for 1 selected project');
      expect(web.daveWebScheduleUploadProjectReview(prepared)).toEqual({ heldLine: null, useForAll: null, savedUnderLine: null });
      expect(web.planDAVEWebScheduleImport({ snapshot: { scheduleItems: [] }, importedScheduleItems: prepared.scheduleItems }).additions.map(item => item.taskName)).toEqual(['Pour footings', 'Set steel']);
    }
  });

  it('unchanged: the same task under two projects and once with no project still waits (it cannot be told which); another finish date is another task', () => {
    const two = prepare([QUAY, MILL], [['Pour footings', QUAY, '10/26/2026', '10/30/2026'], ['Pour footings', MILL, '10/26/2026', '10/30/2026'], ['Pour footings', '', '10/26/2026', '10/30/2026']]);
    expect(listed(two)).toEqual(['Pour footings | 6101 Quay Works', 'Pour footings | 6102 Mill Yard', 'Pour footings | Needs Project (the file names no project)']);
    const other = prepare([QUAY], [['Pour footings', QUAY, '10/26/2026', '10/30/2026'], ['Pour footings', '', '10/26/2026', '11/02/2026']]);
    expect(listed(other)).toEqual(['Pour footings | 6101 Quay Works', 'Pour footings | Needs Project (the file names no project)']);
  });
});
