/**
 * Whole-app audit A8 pass 2 #7 (30 Sep 2026): text typed on a document card
 * less than the 0.7 s pause before Make Current waited for the pause and
 * could drop out of the shared copy. The hook's flush queues it at once, and
 * the pause then queues nothing more.
 */
import { act, renderHook } from '@testing-library/react-native';
import { AppState } from 'react-native';

import { useProjectDocumentSharedRecordSync } from '../../hooks/use-project-document-shared-record-sync';

describe('useProjectDocumentSharedRecordSync flush (audit A8 pass 2 #7)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.spyOn(AppState, 'addEventListener').mockImplementation(() => ({ remove: jest.fn() }) as never);
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('queues this document\'s waiting text at once, once, and leaves other documents to their pause', async () => {
    const queue = jest.fn();
    const hook = await renderHook(() => useProjectDocumentSharedRecordSync(queue));

    act(() => {
      hook.result.current.queueAfterChange('doc-1', { note: 'Stamped' });
      hook.result.current.queueAfterChange('doc-2', { note: 'Other' });
      jest.advanceTimersByTime(300);
    });
    let flushed = false;
    act(() => { flushed = hook.result.current.flush('doc-1'); });
    expect(flushed).toBe(true);
    expect(queue.mock.calls).toEqual([['doc-1']]);
    act(() => { jest.advanceTimersByTime(700); });
    expect(queue.mock.calls).toEqual([['doc-1'], ['doc-2']]);
    act(() => { flushed = hook.result.current.flush('doc-1'); });
    expect(flushed).toBe(false);
    expect(queue).toHaveBeenCalledTimes(2);
  });
});
