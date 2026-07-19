import { renderHook, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Alert } from 'react-native';
import {
  persistStorageItem,
  reportStoragePersistenceFailure,
  useJsonStoragePersistence,
  useStringStoragePersistence,
} from '../../hooks/use-async-storage-persistence';
import { runExclusiveLocalStorageMutation } from '../../services/LocalStorageMutationCoordinator';

jest.mock('@react-native-async-storage/async-storage', () => ({
  setItem: jest.fn(() => Promise.resolve()),
  removeItem: jest.fn(() => Promise.resolve()),
}));

const setItem = AsyncStorage.setItem as jest.MockedFunction<typeof AsyncStorage.setItem>;

describe('async storage persistence hooks', () => {
  beforeEach(() => setItem.mockReset().mockResolvedValue(undefined));

  it('does not overwrite storage before hydration completes', async () => {
    type Props = { enabled: boolean };
    const { rerender } = await renderHook(
      ({ enabled }: Props) => useJsonStoragePersistence({
        enabled,
        storageKey: 'projects',
        value: ['2321'],
      }),
      { initialProps: { enabled: false } },
    );

    expect(setItem).not.toHaveBeenCalled();
    rerender({ enabled: true });

    await waitFor(() => expect(setItem).toHaveBeenCalledWith('projects', '["2321"]'));
  });

  it('persists string settings without JSON quoting them', async () => {
    await renderHook(() => useStringStoragePersistence({
      enabled: true,
      storageKey: 'display-name',
      value: 'David',
    }));

    await waitFor(() => expect(setItem).toHaveBeenCalledWith('display-name', 'David'));
  });

  it('serializes same-key writes so an older slow write cannot overwrite a newer value', async () => {
    let finishFirst: () => void = () => undefined;
    setItem
      .mockImplementationOnce(() => new Promise<void>(resolve => { finishFirst = resolve; }))
      .mockResolvedValueOnce(undefined);

    const first = persistStorageItem('projects', '["old"]');
    const second = persistStorageItem('projects', '["new"]');
    await waitFor(() => expect(setItem).toHaveBeenCalledTimes(1));
    finishFirst();
    await Promise.all([first, second]);

    expect(setItem.mock.calls).toEqual([
      ['projects', '["old"]'],
      ['projects', '["new"]'],
    ]);
  });

  it('orders a delayed hook write before a newer transaction writer for the same key', async () => {
    let finishOlderWrite: () => void = () => undefined;
    setItem
      .mockImplementationOnce(() => new Promise<void>(resolve => {
        finishOlderWrite = resolve;
      }))
      .mockResolvedValueOnce(undefined);

    const olderHookWrite = persistStorageItem('updates', '["older"]');
    const newerTransaction = runExclusiveLocalStorageMutation(
      ['transaction-journal', 'updates'],
      () => AsyncStorage.setItem('updates', '["newer"]'),
    );

    await waitFor(() => expect(setItem).toHaveBeenCalledTimes(1));
    finishOlderWrite();
    await Promise.all([olderHookWrite, newerTransaction]);

    expect(setItem.mock.calls).toEqual([
      ['updates', '["older"]'],
      ['updates', '["newer"]'],
    ]);
  });

  it('retries a transient storage failure before reporting failure', async () => {
    setItem.mockRejectedValueOnce(new Error('disk busy')).mockResolvedValueOnce(undefined);
    const onError = jest.fn();

    await renderHook(() => useJsonStoragePersistence({
      enabled: true,
      storageKey: 'contacts',
      value: { contacts: [] },
      label: 'contacts',
      onError,
    }));

    await waitFor(() => expect(setItem).toHaveBeenCalledTimes(2));
    expect(onError).not.toHaveBeenCalled();
  });

  it('reports a persistent write failure after bounded retries', async () => {
    setItem.mockRejectedValue(new Error('disk full'));
    const onError = jest.fn();

    await renderHook(() => useStringStoragePersistence({
      enabled: true,
      storageKey: 'display-name',
      value: 'David',
      label: 'profile setting',
      onError,
    }));

    await waitFor(() => expect(onError).toHaveBeenCalledWith(expect.objectContaining({
      storageKey: 'display-name',
      label: 'profile setting',
      error: expect.any(Error),
    })), { timeout: 2000 });
    expect(setItem).toHaveBeenCalledTimes(3);
  });

  it('reports serialization failure without attempting a storage write', async () => {
    const onError = jest.fn();
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    await renderHook(() => useJsonStoragePersistence({
      enabled: true,
      storageKey: 'invalid-json',
      value: circular,
      label: 'invalid data',
      onError,
    }));

    await waitFor(() => expect(onError).toHaveBeenCalledWith(expect.objectContaining({
      storageKey: 'invalid-json',
      label: 'invalid data',
      error: expect.any(TypeError),
    })));
    expect(setItem).not.toHaveBeenCalled();
  });

  it('allows a later persistence warning after Android dismisses the alert', () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    reportStoragePersistenceFailure({
      storageKey: 'first',
      label: 'first value',
      error: new Error('disk full'),
    });

    const options = alert.mock.calls[0]?.[3];
    expect(options).toEqual(expect.objectContaining({ cancelable: true }));
    options?.onDismiss?.();

    reportStoragePersistenceFailure({
      storageKey: 'second',
      label: 'second value',
      error: new Error('disk full'),
    });
    expect(alert).toHaveBeenCalledTimes(2);

    const buttons = alert.mock.calls[1]?.[2];
    buttons?.[0]?.onPress?.();
    alert.mockRestore();
  });
});
