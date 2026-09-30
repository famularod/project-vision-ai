import { renderHook } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  cancelPendingStoragePersistence,
  flushPendingStoragePersistence,
  useJsonStoragePersistence,
} from '../../hooks/use-async-storage-persistence';

jest.mock('@react-native-async-storage/async-storage', () => ({
  setItem: jest.fn(() => Promise.resolve()),
  removeItem: jest.fn(() => Promise.resolve()),
}));

const setItem = AsyncStorage.setItem as jest.MockedFunction<typeof AsyncStorage.setItem>;
const fs = jest.requireActual('fs') as typeof import('fs');
const path = jest.requireActual('path') as typeof import('path');
const app = fs.readFileSync(path.resolve(__dirname, '../../App.tsx'), 'utf8');

// Whole-app audit A4 pass 5 L4 and A7 pass 3 L5 (30 Sep 2026).
describe('a store found blocked by a save gets no late write', () => {
  beforeEach(() => setItem.mockReset().mockResolvedValue(undefined));

  it('a cancelled pending write never lands, not even on the background flush; other stores keep theirs', async () => {
    jest.useFakeTimers();
    try {
      renderHook(() => useJsonStoragePersistence({ enabled: true, storageKey: 'deleted-updates', value: ['u1'] }));
      renderHook(() => useJsonStoragePersistence({ enabled: true, storageKey: 'contacts', value: ['Alice'] }));
      cancelPendingStoragePersistence('deleted-updates');
      await flushPendingStoragePersistence();
      jest.advanceTimersByTime(2000);
      await Promise.resolve();
      expect(setItem).not.toHaveBeenCalledWith('deleted-updates', expect.anything());
      expect(setItem).toHaveBeenCalledWith('contacts', '["Alice"]');
    } finally {
      jest.useRealTimers();
    }
  });

  it('the App drops the field-update stores’ pending writes when a save finds them blocked', () => {
    expect(app).toMatch(/function blockFieldUpdateStores\(error: FieldUpdatePersistenceBlockedError\) \{\n\s+startupHydration\.fail\(UPDATES_STORAGE_KEY, 'field update save recovery', error\);\n\s+cancelPendingStoragePersistence\(DELETED_UPDATES_STORAGE_KEY\);\n\s+\}/);
    expect(app.match(/if \(error instanceof FieldUpdatePersistenceBlockedError\) blockFieldUpdateStores\(error\);/g)).toHaveLength(2);
  });

  it('the saved-updates timer is forgotten when its effect is cleaned up', () => {
    expect(app).toMatch(/clearTimeout\(savedUpdatesSaveTimer\.current\);\n(?:\s*\/\/.*\n)*\s+savedUpdatesSaveTimer\.current = null;\n\s+\}\n\s+\};\n\s+\}, \[savedUpdates, startupHydrationReady, updatesLoaded\]\);/);
  });

  it('after a blocked save the draft is not rewritten over the store recovery owns', () => {
    expect(app).toMatch(/if \(!\(error instanceof FieldUpdatePersistenceBlockedError\)\) \{\n\s+void persistDraftNow\(draftRef\.current\);/);
  });
});
