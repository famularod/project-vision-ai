import { act, fireEvent, render, renderHook } from '@testing-library/react-native';
import { ScheduleImportFlow } from '../../components/ScheduleImportFlow';
import {
  clearScheduleProgressDraftsForTests,
  useScheduleProgressDraft,
} from '../../hooks/use-schedule-progress-draft';
import {
  ScheduleImportReviewError,
  scheduleImportApprovalBlocker,
  validateScheduleImportScope,
} from '../../services/ScheduleImportScopeGuard';
import {
  bindStableScheduleImportItemIds,
  buildScheduleImportSourceIdentity,
  resolveScheduleImportSourceIdentity,
} from '../../services/ScheduleImportSourceIdentity';
import { buildVitruviusGanttModel } from '../../services/VitruviusGanttModel';
import { buildVitruviusLookahead } from '../../services/VitruviusLookahead';
import { dependencyChangesForDeletedTask } from '../../services/VitruviusScheduleEngine';
import type { CanonicalScheduleProgress } from '../../services/ScheduleProgressInvariant';
import type { ScheduleItem } from '../../types';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

const fs = jest.requireActual('fs') as typeof import('fs');
const path = jest.requireActual('path') as typeof import('path');
const app = fs.readFileSync(path.resolve(__dirname, '../../App.tsx'), 'utf8');

function task(overrides: Partial<ScheduleItem> = {}): ScheduleItem {
  return {
    id: 'task-1', taskName: 'Pour footings', projectName: 'Project A', locationName: '',
    startDate: '09/28/2026', finishDate: '09/30/2026', milestone: '', owner: 'David', contractor: '',
    durationDays: 3, percentComplete: 40, priority: 'Medium', status: 'In Progress', notes: '',
    createdAt: '2026-09-01T12:00:00.000Z',
    ...overrides,
  } as ScheduleItem;
}

// Whole-app audit A5 (schedule and schedule import), pass 1 mediums and lows (30 Sep 2026).
describe('the lookahead and Gantt read "today" in the project zone', () => {
  // 7 pm in California on 30 Sep is already 1 Oct in UTC.
  const californiaEvening = new Date('2026-10-01T02:00:00.000Z');

  it('a task due today is still due today in the evening, and the window starts today', () => {
    const lookahead = buildVitruviusLookahead({ items: [task()], weeks: 3, today: californiaEvening });
    expect(lookahead.rangeStart).toBe('2026-09-30');
    expect(lookahead.rows[0].status).toBe('in_progress');
    expect(lookahead.rows[0].daysUntilFinish).toBe(0);
    expect(lookahead.overdueCount).toBe(0);
  });

  it('east of UTC a task that finished yesterday reads overdue in the morning', () => {
    // 08:30 on 1 Oct in Tokyo is still 30 Sep in UTC.
    const tokyoMorning = new Date('2026-09-30T23:30:00.000Z');
    const tokyoTask = task({ finishDate: '09/30/2026', projectTimeZone: 'Asia/Tokyo' } as Partial<ScheduleItem>);
    const lookahead = buildVitruviusLookahead({ items: [tokyoTask], weeks: 3, today: tokyoMorning });
    expect(lookahead.rangeStart).toBe('2026-10-01');
    expect(lookahead.rows[0].status).toBe('overdue');
    // Each task's own zone decides its overdue state in a mixed list.
    const mixed = buildVitruviusLookahead({
      items: [task({ id: 'la', finishDate: '09/30/2026' }), { ...tokyoTask, id: 'tokyo' }],
      weeks: 3, today: tokyoMorning, projectTimeZone: 'America/Los_Angeles',
    });
    expect(mixed.rangeStart).toBe('2026-09-30');
    expect(mixed.rows.find(row => row.item.id === 'tokyo')?.status).toBe('overdue');
    expect(mixed.rows.find(row => row.item.id === 'la')?.status).toBe('in_progress');
  });

  it('the Gantt marks the project’s today, not tomorrow', () => {
    const model = buildVitruviusGanttModel({ items: [task()], zoom: 'day', today: californiaEvening });
    const todayColumn = model.columns.find(column => column.startDate === '2026-09-30');
    expect(todayColumn).toBeTruthy();
    expect(model.todayLeft).not.toBeNull();
    expect(model.todayLeft!).toBeGreaterThanOrEqual(todayColumn!.left);
    expect(model.todayLeft!).toBeLessThan(todayColumn!.left + todayColumn!.width);
  });
});

describe('an area typed during review is kept unless it belongs to another selected project', () => {
  const selectedProjects = [{ id: 'project-a', name: 'Project A' }, { id: 'project-b', name: 'Project B' }];
  const selectedProjectAreas = [
    { projectId: 'project-a', areas: [{ id: 'north-lot', name: 'North Lot' }] },
    { projectId: 'project-b', areas: [{ id: 'canopy-c', name: 'Canopy C' }] },
  ];
  const validate = (locationName: string, projectAreas = selectedProjectAreas) => validateScheduleImportScope({
    items: [task({ locationName })], selectedProjects, selectedProjectAreas: projectAreas,
  });

  it('keeps a new area name with a note, canonicalises a known one, clears another project’s', () => {
    const typed = validate('Building B ');
    expect(typed.items[0].locationName).toBe('Building B');
    expect(typed.warnings).toEqual([expect.objectContaining({ code: 'area_unregistered', field: 'area' })]);
    expect(validate('north lot').items[0].locationName).toBe('North Lot');
    const crossProject = validate('Canopy C');
    expect(crossProject.items[0].locationName).toBe('');
    expect(crossProject.warnings).toEqual([expect.objectContaining({
      code: 'area_not_in_selected_project',
      message: 'Area "Canopy C" belongs to Project B, not Project A. Enter an area of Project A during review.',
    })]);
    // A project with no saved areas keeps what was typed.
    expect(validate('Gate 3', [{ projectId: 'project-a', areas: [] }, selectedProjectAreas[1]]).items[0].locationName).toBe('Gate 3');
  });

  it('approval waits, with the task named, instead of clearing the area silently', () => {
    expect(scheduleImportApprovalBlocker(validate('Building B'), [task()])).toBeNull();
    expect(scheduleImportApprovalBlocker(validate('Canopy C'), [task()])).toBe(
      'Pour footings: Area "Canopy C" belongs to Project B, not Project A. Enter an area of Project A during review.',
    );
    const noProject = validateScheduleImportScope({ items: [task({ projectName: 'Project Z' })], selectedProjects });
    expect(scheduleImportApprovalBlocker(noProject, [task()])).toBe(
      'Choose an active project for every highlighted schedule item before saving.',
    );
    expect(app).toMatch(/const approvalBlocker = scheduleImportApprovalBlocker\(scopeValidation, batch\.items\);\n\s+if \(approvalBlocker\) throw new ScheduleImportReviewError\(approvalBlocker\);/);
  });
});

describe('the review shows why a save was refused', () => {
  const renderReview = (onApprove: jest.Mock) => render(
    <ScheduleImportFlow
      screenshotImportAvailable={false}
      onImportFile={jest.fn(() => Promise.resolve(null))}
      onImportScreenshots={jest.fn(() => Promise.resolve(null))}
      onAddManually={jest.fn()}
      onApprove={onApprove}
      onCancel={jest.fn()}
      incomingBatch={{
        id: 'batch-1', kind: 'schedule_file', sourceCount: 1, sourceLabel: 'schedule.csv',
        message: 'One activity.', documents: [], items: [task({ locationName: 'Canopy C' })],
      }}
      onIncomingBatchConsumed={jest.fn()}
    />,
  );

  it('a reason the manager can fix is shown as is; anything else keeps the generic message', async () => {
    const refused = renderReview(jest.fn(() => Promise.reject(new ScheduleImportReviewError('Pour footings: Area "Canopy C" belongs to Project B, not Project A.'))));
    await refused.findByText('Review Imported Schedule');
    await act(async () => {
      fireEvent.press(refused.getByText('Accept All (1)'));
    });
    expect(refused.getByText('Pour footings: Area "Canopy C" belongs to Project B, not Project A. Your review is still open.')).toBeTruthy();

    const failed = renderReview(jest.fn(() => Promise.reject(new Error('storage write failed: EIO'))));
    await failed.findByText('Review Imported Schedule');
    await act(async () => {
      fireEvent.press(failed.getByText('Accept All (1)'));
    });
    expect(failed.getByText('Vitruvius could not finish saving this schedule. Your review is still open and unchanged. Try again.')).toBeTruthy();
    expect(failed.queryByText(/EIO/)).toBeNull();
  });
});

describe('importing a schedule again after deleting it', () => {
  const bytes = new TextEncoder().encode('Task,Finish\nPour footings,09/30/2026\n');
  const projects = [{ id: 'project-a', name: 'Project A' }];

  it('takes the next identity for each deleted generation, the same on every device', () => {
    const first = buildScheduleImportSourceIdentity({ bytes, projects });
    expect(resolveScheduleImportSourceIdentity({ bytes, projects, documentIdIsDeleted: () => false })).toEqual(first);

    const deleted = new Set([first.documentId]);
    const second = resolveScheduleImportSourceIdentity({ bytes, projects, documentIdIsDeleted: id => deleted.has(id) });
    expect(second.contentSha256).toBe(first.contentSha256);
    expect(second.documentId).not.toBe(first.documentId);
    expect(second.batchId).not.toBe(first.batchId);
    expect(second.idempotencyKey).not.toBe(first.idempotencyKey);
    expect(resolveScheduleImportSourceIdentity({ bytes, projects, documentIdIsDeleted: id => deleted.has(id) })).toEqual(second);
    // Task ids move with it, so the deleted tasks' markers do not drop the new rows.
    const [oldTask] = bindStableScheduleImportItemIds([task()], first);
    const [newTask] = bindStableScheduleImportItemIds([task()], second);
    expect(newTask.id).not.toBe(oldTask.id);

    deleted.add(second.documentId);
    const third = resolveScheduleImportSourceIdentity({ bytes, projects, documentIdIsDeleted: id => deleted.has(id) });
    expect([first.documentId, second.documentId]).not.toContain(third.documentId);
  });

  it('is wired to the synced deletion records of schedule documents', () => {
    expect(app).toMatch(/const sourceIdentity = resolveScheduleImportSourceIdentity\(\{[^\n]*\n\s+bytes: sourcePayload\.data,\n\s+projects: scopedProjectRecords,\n\s+documentIdIsDeleted: id => deletedDAVERecordIds\(operationalSyncTombstonesRef\.current, 'reference_document'\)\.includes\(id\),/);
  });
});

describe('a staged progress edit is kept until Save', () => {
  afterEach(() => clearScheduleProgressDraftsForTests());
  const saved = { status: 'In Progress' as const, percentComplete: 40 };

  it('survives the row going away and coming back, per task', () => {
    const first = renderHook(
      (props: { id: string }) => useScheduleProgressDraft(props.id, saved),
      { initialProps: { id: 'task-1' } },
    );
    act(() => first.result.current[1](() => ({ status: 'In Progress', percentComplete: 60 })));
    expect(first.result.current[0]).toEqual({ status: 'In Progress', percentComplete: 60 });
    // Another task in the same inspector shows its own saved value.
    first.rerender({ id: 'task-2' });
    expect(first.result.current[0]).toEqual(saved);
    first.unmount();

    const again = renderHook(() => useScheduleProgressDraft('task-1', saved));
    expect(again.result.current[0]).toEqual({ status: 'In Progress', percentComplete: 60 });
  });

  it('clears once saved, or when set back to the saved value; a saved value that moves underneath wins (A5 pass 2)', () => {
    const row = renderHook(
      (props: { committed: CanonicalScheduleProgress }) => useScheduleProgressDraft('task-1', props.committed),
      { initialProps: { committed: saved } },
    );
    // Save commits the staged value: the draft is gone.
    act(() => row.result.current[1](() => ({ status: 'In Progress', percentComplete: 60 })));
    row.rerender({ committed: { status: 'In Progress', percentComplete: 60 } });
    expect(row.result.current[0]).toEqual({ status: 'In Progress', percentComplete: 60 });
    // This device's Confirm Completed (or a teammate) moves the saved value: it wins over the staged 80%.
    act(() => row.result.current[1](() => ({ status: 'In Progress', percentComplete: 80 })));
    expect(row.result.current[0]).toEqual({ status: 'In Progress', percentComplete: 80 });
    row.rerender({ committed: { status: 'Complete', percentComplete: 100 } });
    expect(row.result.current[0]).toEqual({ status: 'Complete', percentComplete: 100 });
    row.rerender({ committed: { status: 'Complete', percentComplete: 100 } });
    expect(row.result.current[0]).toEqual({ status: 'Complete', percentComplete: 100 });
    // Set back to the saved value by hand: nothing staged.
    act(() => row.result.current[1](() => ({ status: 'In Progress', percentComplete: 90 })));
    act(() => row.result.current[1](() => ({ status: 'Complete', percentComplete: 100 })));
    row.unmount();
    expect(renderHook(() => useScheduleProgressDraft('task-1', { status: 'Complete', percentComplete: 100 })).result.current[0])
      .toEqual({ status: 'Complete', percentComplete: 100 });
  });

  it('no frame shows a staged value over a saved value that moved underneath (A5 pass 2)', () => {
    const shown: number[] = [];
    const row = renderHook(
      (props: { committed: CanonicalScheduleProgress }) => {
        const result = useScheduleProgressDraft('task-frames', props.committed);
        shown.push(result[0].percentComplete);
        return result;
      },
      { initialProps: { committed: saved } },
    );
    act(() => row.result.current[1](() => ({ status: 'In Progress', percentComplete: 80 })));
    shown.length = 0;
    row.rerender({ committed: { status: 'Complete', percentComplete: 100 } });
    expect(shown.length).toBeGreaterThan(0);
    expect(shown.every(percent => percent === 100)).toBe(true);
  });

  it('the task row uses it and says Unsaved while a value is staged', () => {
    const row = app.slice(app.indexOf('\nfunction ScheduleItemRow('), app.indexOf('\n  async function saveTaskChanges()', app.indexOf('\nfunction ScheduleItemRow(')));
    expect(row).toContain('const [progressDraft, setProgressDraft] = useScheduleProgressDraft(item.id, reconcileScheduleProgress(item.status, item.percentComplete));');
    expect(row).not.toContain('setProgressDraft(reconcileScheduleProgress(item.status, item.percentComplete));');
    expect(app).toContain("{displayedItem.percentComplete}%{progressDraftDirty ? ' · Unsaved' : ''}");
  });
});

describe('deleting a task', () => {
  it('drops it from its successors’ dependencies and leaves everything else as stored', () => {
    const changes = dependencyChangesForDeletedTask([
      task({ id: 'gone' }),
      task({ id: 'next', dependencies: [{ predecessorItemId: 'gone', type: 'FS', lagDays: 2 }, { predecessorItemId: 'other', type: 'FS', lagDays: 0 }] }),
      task({ id: 'other', dependencies: [{ predecessorItemId: 'first', type: 'FS', lagDays: 0 }] }),
      task({ id: 'plain' }),
    ], 'gone');
    expect(changes).toEqual([{ id: 'next', dependencies: [{ predecessorItemId: 'other', type: 'FS', lagDays: 0 }] }]);
    expect(dependencyChangesForDeletedTask([task({ id: 'a', dependencies: [{ predecessorItemId: 'b', type: 'FS', lagDays: 0 }] })], ' ')).toEqual([]);
  });

  it('is wired after the task leaves the list, through the normal task update', () => {
    expect(app).toMatch(/setScheduleItems\(prev => prev\.filter\(scheduleItem => scheduleItem\.id !== itemId\)\);\n\s+dependencyChangesForDeletedTask\(scheduleItemsCurrentRef\.current, itemId\)[^\n]*\n\s+\.forEach\(change => updateScheduleItem\(change\.id, \{ dependencies: change\.dependencies \}\)\);/);
  });
});
