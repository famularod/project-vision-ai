import {
  buildDAVEWebTaskRenderPage,
  DAVE_WEB_TASK_PAGE_SIZE,
} from '../../services/DAVEWebTaskPagination';
import type { ScheduleItem } from '../../types';

function taskFixture(index: number): ScheduleItem {
  return {
    id: `task-${index}`,
    projectName: 'Project A',
    locationName: 'Canopy A',
    taskName: `Task ${index}`,
    startDate: '',
    finishDate: '07/30/2026',
    milestone: '',
    owner: '',
    contractor: '',
    percentComplete: 0,
    priority: 'Medium',
    status: 'Not Started',
    notes: '',
    createdAt: '2026-07-22T12:00:00.000Z',
  };
}

describe('DAVE web bounded task rendering', () => {
  it.each([100, 500, 1000])(
    'preserves exact counts while initially mounting only the first page of %i tasks',
    taskCount => {
      const tasks = Array.from({ length: taskCount }, (_, index) => taskFixture(index));
      const page = buildDAVEWebTaskRenderPage(tasks);

      expect(page.totalTaskCount).toBe(taskCount);
      expect(page.renderedTaskCount).toBe(DAVE_WEB_TASK_PAGE_SIZE);
      expect(page.pageIndex).toBe(0);
      expect(page.pageCount).toBe(Math.ceil(taskCount / DAVE_WEB_TASK_PAGE_SIZE));
      expect(page.firstRenderedTaskNumber).toBe(1);
      expect(page.lastRenderedTaskNumber).toBe(DAVE_WEB_TASK_PAGE_SIZE);
      expect(page.hasPreviousPage).toBe(false);
      expect(page.hasNextPage).toBe(true);
      expect(page.groups).toHaveLength(1);
      expect(page.groups[0]).toMatchObject({
        projectTaskCount: taskCount,
        areaTaskCount: taskCount,
      });
      expect(page.groups[0].data).toHaveLength(DAVE_WEB_TASK_PAGE_SIZE);
    },
  );

  it('moves through fixed-size pages without mounting the complete list', () => {
    const tasks = Array.from({ length: 100 }, (_, index) => taskFixture(index));

    const secondPage = buildDAVEWebTaskRenderPage(tasks, 1);
    expect(secondPage.renderedTaskCount).toBe(40);
    expect(secondPage.firstRenderedTaskNumber).toBe(41);
    expect(secondPage.lastRenderedTaskNumber).toBe(80);
    expect(secondPage.hasPreviousPage).toBe(true);
    expect(secondPage.hasNextPage).toBe(true);

    const lastPage = buildDAVEWebTaskRenderPage(tasks, 2);
    expect(lastPage.renderedTaskCount).toBe(20);
    expect(lastPage.firstRenderedTaskNumber).toBe(81);
    expect(lastPage.lastRenderedTaskNumber).toBe(100);
    expect(lastPage.hasPreviousPage).toBe(true);
    expect(lastPage.hasNextPage).toBe(false);
    expect(lastPage.totalTaskCount).toBe(100);
  });

  it('keeps full project and area counts when a page ends inside a later group', () => {
    const tasks = [
      ...Array.from({ length: 30 }, (_, index) => taskFixture(index)),
      ...Array.from({ length: 30 }, (_, index) => ({
        ...taskFixture(index + 30),
        locationName: 'Canopy B',
      })),
    ];
    const page = buildDAVEWebTaskRenderPage(tasks, 0);

    expect(page.groups).toHaveLength(2);
    expect(page.groups[0].areaTaskCount).toBe(30);
    expect(page.groups[0].data).toHaveLength(30);
    expect(page.groups[1].areaTaskCount).toBe(30);
    expect(page.groups[1].data).toHaveLength(10);
    expect(page.groups[1].projectTaskCount).toBe(60);
  });

  it('clamps a now-invalid page after the task collection shrinks', () => {
    const tasks = Array.from({ length: 20 }, (_, index) => taskFixture(index));
    const page = buildDAVEWebTaskRenderPage(tasks, 10);

    expect(page.pageIndex).toBe(0);
    expect(page.pageCount).toBe(1);
    expect(page.renderedTaskCount).toBe(20);
  });
});
