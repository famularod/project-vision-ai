import { renderHook, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  useJsonStoragePersistence,
  useStringStoragePersistence,
} from '../../hooks/use-async-storage-persistence';

jest.mock('@react-native-async-storage/async-storage', () => ({
  setItem: jest.fn(() => Promise.resolve()),
}));

const setItem = AsyncStorage.setItem as jest.MockedFunction<typeof AsyncStorage.setItem>;

describe('async storage persistence hooks', () => {
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
});
