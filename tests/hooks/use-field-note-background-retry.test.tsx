/**
 * Whole-app audit A11 pass 1 F3 (30 Sep 2026): a field note saved offline was
 * sent only while the Field Notes screen was open. The app now retries at
 * start, on return to the foreground and every two minutes while open.
 */
import { act, renderHook } from '@testing-library/react-native';
import { AppState } from 'react-native';

jest.mock('../../services/FieldNoteMobileSync', () => ({ mobileFieldNoteDataSource: {} }));

import { useFieldNoteBackgroundRetry } from '../../hooks/use-field-note-background-retry';

describe('field notes are sent from anywhere in the app', () => {
  let appStateListener: ((state: string) => void) | null = null;
  let remove: jest.Mock;
  beforeEach(() => {
    jest.useFakeTimers();
    remove = jest.fn();
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, listener) => {
      appStateListener = listener as (state: string) => void;
      return { remove } as never;
    });
    Object.defineProperty(AppState, 'currentState', { value: 'active', configurable: true });
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('retries at start, on foreground and every two minutes while active, for this owner', async () => {
    const retryPending = jest.fn(async () => []);
    const hook = await renderHook(() => useFieldNoteBackgroundRetry('owner-a', { retryPending }));
    expect(retryPending).toHaveBeenCalledWith('owner-a');
    expect(retryPending).toHaveBeenCalledTimes(1);
    act(() => appStateListener?.('active'));
    expect(retryPending).toHaveBeenCalledTimes(2);
    act(() => appStateListener?.('background'));
    expect(retryPending).toHaveBeenCalledTimes(2);
    act(() => { jest.advanceTimersByTime(120_000); });
    expect(retryPending).toHaveBeenCalledTimes(3);
    Object.defineProperty(AppState, 'currentState', { value: 'background', configurable: true });
    act(() => { jest.advanceTimersByTime(120_000); });
    expect(retryPending).toHaveBeenCalledTimes(3);
    await hook.unmount();
    expect(remove).toHaveBeenCalled();
    Object.defineProperty(AppState, 'currentState', { value: 'active', configurable: true });
    act(() => { jest.advanceTimersByTime(240_000); });
    expect(retryPending).toHaveBeenCalledTimes(3);
  });

  it('a failed retry is quiet, and nothing runs without a retry', async () => {
    const retryPending = jest.fn(async () => { throw new Error('offline'); });
    await renderHook(() => useFieldNoteBackgroundRetry('owner-a', { retryPending }));
    await act(async () => { await Promise.resolve(); });
    expect(retryPending).toHaveBeenCalledTimes(1);
    await renderHook(() => useFieldNoteBackgroundRetry('owner-a', {}));
  });

  it('is wired in App for the workspace owner', () => {
    const fs = jest.requireActual('fs') as typeof import('fs');
    const path = jest.requireActual('path') as typeof import('path');
    const app = fs.readFileSync(path.resolve(__dirname, '../../App.tsx'), 'utf8');
    expect(app).toContain("useFieldNoteBackgroundRetry(workspaceOwnerId ?? 'local-device');");
  });
});
