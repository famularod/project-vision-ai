import {
  createScheduleItemTextSyncLifecycle,
  flushPendingScheduleItemTextSync,
  markScheduleItemTextSyncPending,
  scheduleItemChangeUsesDebouncedSync,
  scheduleScheduleItemTextSync,
  settleScheduleItemTextSync,
} from '../../services/ScheduleItemTextSyncLifecycle';

describe('schedule item text sync lifecycle', () => {
  it('debounces project-controls edits without delaying structural task changes', () => {
    expect(scheduleItemChangeUsesDebouncedSync({
      projectControls: { assignee: 'David Famularo' },
    })).toBe(true);
    expect(scheduleItemChangeUsesDebouncedSync({
      notes: 'Ready',
      projectControls: { trade: 'Electrical' },
    })).toBe(true);
    expect(scheduleItemChangeUsesDebouncedSync({
      status: 'Complete',
      projectControls: { assignee: 'David Famularo' },
    })).toBe(false);
    expect(scheduleItemChangeUsesDebouncedSync({})).toBe(false);
  });

  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('keeps a debounced note pending until cloud confirmation', () => {
    const lifecycle = createScheduleItemTextSyncLifecycle();
    const onReady = jest.fn();
    let generation = 1;

    markScheduleItemTextSyncPending(lifecycle, 'task-1');
    scheduleScheduleItemTextSync({
      lifecycle,
      itemId: 'task-1',
      generation,
      currentGeneration: () => generation,
      onReady,
    });

    jest.advanceTimersByTime(700);

    expect(onReady).toHaveBeenCalledWith('task-1', 1);
    expect(lifecycle.pendingIds.has('task-1')).toBe(true);
    expect(lifecycle.timers.has('task-1')).toBe(false);

    settleScheduleItemTextSync(lifecycle, 'task-1');
    expect(lifecycle.pendingIds.has('task-1')).toBe(false);
  });

  it('flushes a note again when the app backgrounds during its sync', () => {
    const lifecycle = createScheduleItemTextSyncLifecycle();
    const onDebounceReady = jest.fn();
    const onBackgroundReady = jest.fn();
    const generation = 3;

    scheduleScheduleItemTextSync({
      lifecycle,
      itemId: 'task-1',
      generation,
      currentGeneration: () => generation,
      onReady: onDebounceReady,
    });
    jest.advanceTimersByTime(700);
    expect(onDebounceReady).toHaveBeenCalledTimes(1);

    expect(flushPendingScheduleItemTextSync({
      lifecycle,
      currentGeneration: () => generation,
      onReady: onBackgroundReady,
    })).toEqual(['task-1']);

    expect(onBackgroundReady).toHaveBeenCalledWith('task-1', generation);
    expect(lifecycle.pendingIds.has('task-1')).toBe(true);
  });

  it('ignores an obsolete debounce generation after a newer note edit', () => {
    const lifecycle = createScheduleItemTextSyncLifecycle();
    const onReady = jest.fn();
    let generation = 1;

    scheduleScheduleItemTextSync({
      lifecycle,
      itemId: 'task-1',
      generation,
      currentGeneration: () => generation,
      onReady,
    });
    generation = 2;
    scheduleScheduleItemTextSync({
      lifecycle,
      itemId: 'task-1',
      generation,
      currentGeneration: () => generation,
      onReady,
    });

    jest.advanceTimersByTime(700);

    expect(onReady).toHaveBeenCalledTimes(1);
    expect(onReady).toHaveBeenCalledWith('task-1', 2);
    expect(lifecycle.pendingIds.has('task-1')).toBe(true);
  });
});
