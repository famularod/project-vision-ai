/**
 * Whole-app audit A2 M5 (30 Sep 2026): the missing-key cloud bootstrap ran
 * once per launch, and the refresh skips a collection that never loaded, so
 * one failed first download on a new device left Tasks, areas and documents
 * empty all session. It now retries until the download lands or the
 * collection is edited on this device.
 */
import { act, renderHook } from '@testing-library/react-native';
import { AppState } from 'react-native';
import { useStartupLocalFirstRecovery } from '../../hooks/use-startup-local-first-recovery';

type CloudResult = { ok: boolean; data: string[] | null };
const failed: CloudResult = { ok: false, data: null };
const landed: CloudResult = { ok: true, data: ['cloud-task'] };

async function mountMissingCollection(loadCloud: jest.Mock<Promise<CloudResult>, []>) {
  const edited = { current: false };
  const applyCloud = jest.fn();
  const onCloudApplied = jest.fn();
  const onCloudDeferred = jest.fn();
  const hook = await renderHook(
    ({ localLoaded }: { localLoaded: boolean }) => useStartupLocalFirstRecovery<string, string, string>({
      retryAttempt: 0,
      startupReady: true,
      localLoaded,
      localAuthorityReady: false,
      localAuthorityRef: edited,
      resetLocalLoaded: () => undefined,
      readLocal: async () => ({ state: 'missing', value: [], error: null, found: false }) as never,
      acceptLocal: () => true,
      normalizeLocal: value => value,
      applyLocal: () => undefined,
      onLocalError: () => undefined,
      loadCloud,
      synchronizeTombstones: async () => ({ cloudAuthoritative: true, tombstones: [] }),
      normalizeCloud: value => value,
      applyCloud,
      onCloudApplied,
      onCloudDeferred,
    }),
    { initialProps: { localLoaded: false } },
  );
  await act(async () => { await jest.advanceTimersByTimeAsync(0); });
  await hook.rerender({ localLoaded: true });
  await act(async () => { await jest.advanceTimersByTimeAsync(0); });
  return { ...hook, edited, applyCloud, onCloudApplied, onCloudDeferred };
}

const advance = (ms: number) => act(async () => { await jest.advanceTimersByTimeAsync(ms); });

describe('first cloud download of a missing collection (audit A2 M5)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.mocked(AppState.addEventListener).mockClear();
  });
  afterEach(() => jest.useRealTimers());

  it('retries a failed download on a backoff until it lands, then stops', async () => {
    const loadCloud = jest.fn<Promise<CloudResult>, []>()
      .mockResolvedValueOnce(failed)
      .mockResolvedValueOnce(failed)
      .mockResolvedValue(landed);
    const hook = await mountMissingCollection(loadCloud);
    expect(loadCloud).toHaveBeenCalledTimes(1);
    expect(hook.result.current).toBe(true);
    expect(hook.onCloudDeferred).toHaveBeenCalledTimes(1);

    await advance(29_999);
    expect(loadCloud).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(loadCloud).toHaveBeenCalledTimes(2);
    await advance(120_000);
    expect(loadCloud).toHaveBeenCalledTimes(3);
    expect(hook.applyCloud).toHaveBeenCalledWith(['cloud-task'], []);
    expect(hook.onCloudApplied).toHaveBeenCalledTimes(1);
    expect(hook.result.current).toBe(false);
    expect(hook.onCloudDeferred).toHaveBeenCalledTimes(1);

    await advance(60 * 60_000);
    expect(loadCloud).toHaveBeenCalledTimes(3);
    await hook.unmount();
  });

  it('retries when the app returns to the foreground', async () => {
    const loadCloud = jest.fn<Promise<CloudResult>, []>()
      .mockResolvedValueOnce(failed)
      .mockResolvedValue(landed);
    const hook = await mountMissingCollection(loadCloud);
    const listeners = jest.mocked(AppState.addEventListener).mock.calls
      .filter(([type]) => type === 'change')
      .map(([, listener]) => listener as (state: string) => void);
    await act(async () => { listeners.forEach(listener => listener('active')); });
    await advance(0);
    expect(loadCloud).toHaveBeenCalledTimes(2);
    expect(hook.applyCloud).toHaveBeenCalledTimes(1);
    await hook.unmount();
  });

  it('stops retrying once the collection is edited here, without applying the download', async () => {
    const loadCloud = jest.fn<Promise<CloudResult>, []>()
      .mockResolvedValueOnce(failed)
      .mockResolvedValue(landed);
    const hook = await mountMissingCollection(loadCloud);
    hook.edited.current = true;
    await advance(30_000);
    expect(loadCloud).toHaveBeenCalledTimes(2);
    expect(hook.applyCloud).not.toHaveBeenCalled();
    expect(hook.result.current).toBe(false);
    await advance(60 * 60_000);
    expect(loadCloud).toHaveBeenCalledTimes(2);
    await hook.unmount();
  });

  it('stops its retries when unmounted', async () => {
    const loadCloud = jest.fn<Promise<CloudResult>, []>().mockResolvedValue(failed);
    const hook = await mountMissingCollection(loadCloud);
    expect(jest.getTimerCount()).toBe(1);
    await hook.unmount();
    expect(jest.getTimerCount()).toBe(0);
    await advance(60 * 60_000);
    expect(loadCloud).toHaveBeenCalledTimes(1);
  });
});
