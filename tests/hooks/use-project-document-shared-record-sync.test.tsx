/**
 * Whole-app audit A8 pass 1 F1 (30 Sep 2026): a phone document card's typed
 * text is queued once typing pauses, a chip tap at once, and waiting text is
 * sent when the app goes to the background.
 */
import { act, renderHook } from '@testing-library/react-native';
import { AppState } from 'react-native';

import { useProjectDocumentSharedRecordSync } from '../../hooks/use-project-document-shared-record-sync';

describe('useProjectDocumentSharedRecordSync', () => {
  let appStateListener: ((state: string) => void) | null = null;
  let remove: jest.Mock;
  beforeEach(() => {
    jest.useFakeTimers();
    remove = jest.fn();
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, listener) => {
      appStateListener = listener as (state: string) => void;
      return { remove } as never;
    });
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('queues typed text after a pause and a chip tap at once, with the latest callback', async () => {
    const first = jest.fn();
    const latest = jest.fn();
    const hook = await renderHook(
      ({ queue }: { queue: (documentId: string) => void }) => useProjectDocumentSharedRecordSync(queue),
      { initialProps: { queue: first } },
    );

    act(() => {
      hook.result.current.queueAfterChange('doc-1', { note: '1' });
      hook.result.current.queueAfterChange('doc-1', { note: '12' });
    });
    await hook.rerender({ queue: latest });
    act(() => { jest.advanceTimersByTime(699); });
    expect(latest).not.toHaveBeenCalled();
    act(() => { jest.advanceTimersByTime(1); });
    expect(latest.mock.calls).toEqual([['doc-1']]);

    act(() => {
      hook.result.current.queueAfterChange('doc-1', { note: '123' });
      hook.result.current.queueAfterChange('doc-1', { category: 'Drawing' });
    });
    expect(latest.mock.calls).toEqual([['doc-1'], ['doc-1']]);
    act(() => { jest.advanceTimersByTime(700); });
    expect(latest).toHaveBeenCalledTimes(2);
    expect(first).not.toHaveBeenCalled();
  });

  it('sends waiting text when the app goes to the background, not when it returns', async () => {
    const queue = jest.fn();
    const hook = await renderHook(() => useProjectDocumentSharedRecordSync(queue));

    act(() => { hook.result.current.queueAfterChange('doc-1', { drawingNumber: 'A-20' }); });
    act(() => appStateListener?.('active'));
    expect(queue).not.toHaveBeenCalled();
    act(() => appStateListener?.('background'));
    expect(queue.mock.calls).toEqual([['doc-1']]);
    act(() => { jest.advanceTimersByTime(700); });
    expect(queue).toHaveBeenCalledTimes(1);

    act(() => { hook.result.current.queueAfterChange('doc-2', { name: 'Spec' }); });
    act(() => { hook.result.current.cancel('doc-2'); });
    act(() => appStateListener?.('inactive'));
    act(() => { jest.advanceTimersByTime(700); });
    expect(queue).toHaveBeenCalledTimes(1);

    act(() => { hook.result.current.queueAfterChange('doc-3', { note: 'x' }); });
    await hook.unmount();
    expect(remove).toHaveBeenCalled();
    act(() => { jest.advanceTimersByTime(700); });
    expect(queue).toHaveBeenCalledTimes(1);
  });
});
