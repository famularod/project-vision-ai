/**
 * S1d (14 Oct 2026; review pass 6's H6S-2): after Make Current, text typed on a card while the press was on its way is
 * sent by the card's own text sync, at once (queueNow), with any text still waiting for a pause: queued once, and a
 * pause still running for that card is settled, not sent again later. The press itself is in
 * tests/services/s1d-note-typed-while-make-current-is-on-its-way.test.ts.
 */
import { renderHook } from '@testing-library/react-native';
import { useProjectDocumentSharedRecordSync } from '../../hooks/use-project-document-shared-record-sync';

describe('S1d: the card text sync\'s queueNow', () => {
  afterEach(() => { jest.useRealTimers(); });

  it('queues the card\'s shared copy at once, once; the running pause for it is settled', () => {
    jest.useFakeTimers();
    const queued: string[] = [];
    const { result } = renderHook(() => useProjectDocumentSharedRecordSync(id => { queued.push(id); }));
    result.current.queueAfterChange('rev6', { note: 'Rev 6 - Lot 4' }); // typing: waits for a pause
    expect(queued).toEqual([]);
    result.current.queueNow('rev6');
    expect(queued).toEqual(['rev6']);
    jest.advanceTimersByTime(5000);
    expect(queued).toEqual(['rev6']);
  });

  it('with nothing waiting, queues that card alone', () => {
    const queued: string[] = [];
    const { result } = renderHook(() => useProjectDocumentSharedRecordSync(id => { queued.push(id); }));
    result.current.queueNow('rev7');
    expect(queued).toEqual(['rev7']);
  });
});
