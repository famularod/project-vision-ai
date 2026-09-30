/**
 * Whole-app audit A8 pass 1 F1 (30 Sep 2026): every keystroke on a phone
 * document card queued its shared record and started an upload. Typed text
 * is now queued once typing pauses; a chip tap sends waiting text, then the
 * record, at once.
 */
import {
  cancelProjectDocumentSharedRecordSync,
  createProjectDocumentSharedRecordSyncLifecycle,
  disposeProjectDocumentSharedRecordSyncLifecycle,
  flushPendingProjectDocumentSharedRecordSync,
  projectDocumentChangeUsesDebouncedSync,
  queueProjectDocumentSharedRecordNow,
  scheduleProjectDocumentSharedRecordSync,
} from '../../services/ProjectDocumentSharedRecordSyncLifecycle';

describe('project document shared record sync lifecycle', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('debounces typed text but not chip taps', () => {
    expect(projectDocumentChangeUsesDebouncedSync({ note: '12' })).toBe(true);
    expect(projectDocumentChangeUsesDebouncedSync({ name: 'Spec' })).toBe(true);
    expect(projectDocumentChangeUsesDebouncedSync({ drawingNumber: 'A-201' })).toBe(true);
    expect(projectDocumentChangeUsesDebouncedSync({ drawingIssuedAt: '2026-09-30' })).toBe(true);
    expect(projectDocumentChangeUsesDebouncedSync({ category: 'Drawing' })).toBe(false);
    expect(projectDocumentChangeUsesDebouncedSync({ drawingStatus: 'As-Built' })).toBe(false);
    expect(projectDocumentChangeUsesDebouncedSync({ areaId: null })).toBe(false);
    expect(projectDocumentChangeUsesDebouncedSync({ note: '1', updateId: 'u-1' })).toBe(false);
    expect(projectDocumentChangeUsesDebouncedSync({})).toBe(false);
  });

  it('queues a document once, about 700 ms after the last keystroke', () => {
    const lifecycle = createProjectDocumentSharedRecordSyncLifecycle();
    const onReady = jest.fn();

    scheduleProjectDocumentSharedRecordSync({ lifecycle, documentId: 'doc-1', onReady });
    jest.advanceTimersByTime(400);
    scheduleProjectDocumentSharedRecordSync({ lifecycle, documentId: 'doc-1', onReady });
    jest.advanceTimersByTime(699);
    expect(onReady).not.toHaveBeenCalled();
    expect(lifecycle.pendingIds.has('doc-1')).toBe(true);

    jest.advanceTimersByTime(1);
    expect(onReady).toHaveBeenCalledTimes(1);
    expect(onReady).toHaveBeenCalledWith('doc-1');
    expect(lifecycle.pendingIds.size).toBe(0);
    expect(lifecycle.timers.size).toBe(0);
  });

  it('keeps each document on its own timer', () => {
    const lifecycle = createProjectDocumentSharedRecordSyncLifecycle();
    const onReady = jest.fn();

    scheduleProjectDocumentSharedRecordSync({ lifecycle, documentId: 'doc-1', onReady });
    jest.advanceTimersByTime(500);
    scheduleProjectDocumentSharedRecordSync({ lifecycle, documentId: 'doc-2', onReady });
    jest.advanceTimersByTime(200);
    expect(onReady.mock.calls).toEqual([['doc-1']]);
    jest.advanceTimersByTime(500);
    expect(onReady.mock.calls).toEqual([['doc-1'], ['doc-2']]);
  });

  it('flushes waiting text when the app goes to the background', () => {
    const lifecycle = createProjectDocumentSharedRecordSyncLifecycle();
    const onReady = jest.fn();

    scheduleProjectDocumentSharedRecordSync({ lifecycle, documentId: 'doc-1', onReady });
    scheduleProjectDocumentSharedRecordSync({ lifecycle, documentId: 'doc-2', onReady });

    expect(flushPendingProjectDocumentSharedRecordSync({ lifecycle, onReady }))
      .toEqual(['doc-1', 'doc-2']);
    expect(onReady.mock.calls).toEqual([['doc-1'], ['doc-2']]);

    // The flushed timers do not fire a second time.
    jest.advanceTimersByTime(700);
    expect(onReady).toHaveBeenCalledTimes(2);
  });

  it('a chip tap sends waiting text, then its own record, once each and at once', () => {
    const lifecycle = createProjectDocumentSharedRecordSyncLifecycle();
    const onReady = jest.fn();

    scheduleProjectDocumentSharedRecordSync({ lifecycle, documentId: 'doc-1', onReady });
    scheduleProjectDocumentSharedRecordSync({ lifecycle, documentId: 'doc-2', onReady });
    queueProjectDocumentSharedRecordNow({ lifecycle, documentId: 'doc-1', onReady });
    expect(onReady.mock.calls).toEqual([['doc-1'], ['doc-2']]);

    queueProjectDocumentSharedRecordNow({ lifecycle, documentId: 'doc-3', onReady });
    expect(onReady.mock.calls).toEqual([['doc-1'], ['doc-2'], ['doc-3']]);

    jest.advanceTimersByTime(700);
    expect(onReady).toHaveBeenCalledTimes(3);
  });

  it('a cancelled or disposed document is not queued', () => {
    const lifecycle = createProjectDocumentSharedRecordSyncLifecycle();
    const onReady = jest.fn();

    scheduleProjectDocumentSharedRecordSync({ lifecycle, documentId: 'doc-1', onReady });
    scheduleProjectDocumentSharedRecordSync({ lifecycle, documentId: 'doc-2', onReady });
    cancelProjectDocumentSharedRecordSync(lifecycle, 'doc-1');
    expect(lifecycle.pendingIds.has('doc-1')).toBe(false);
    disposeProjectDocumentSharedRecordSyncLifecycle(lifecycle);

    jest.advanceTimersByTime(700);
    expect(onReady).not.toHaveBeenCalled();
    expect(flushPendingProjectDocumentSharedRecordSync({ lifecycle, onReady })).toEqual([]);
  });
});
