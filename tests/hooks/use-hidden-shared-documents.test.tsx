/**
 * Whole-app audit A8 pass 1 F2 (30 Sep 2026): after Delete from This Device,
 * a document already shared came back on this phone as a "Shared project
 * document" card with no Delete. Shared documents removed here are hidden
 * from this phone's Documents list; the other devices keep them.
 */
const mockStore = new Map<string, string>();
jest.mock('@react-native-async-storage/async-storage', () => ({
  // Answers on a timer, as a real read does, so the test can load it inside act.
  getItem: jest.fn((key: string) => new Promise(resolve => setTimeout(() => resolve(mockStore.get(key) ?? null), 0))),
  setItem: jest.fn(async (key: string, value: string) => { mockStore.set(key, value); }),
}));

import { act, renderHook } from '@testing-library/react-native';
import {
  HIDDEN_SHARED_DOCUMENTS_STORAGE_KEY,
  useHiddenSharedDocuments,
} from '../../hooks/use-hidden-shared-documents';
import { isOwnerSensitiveCanonicalStorageKey } from '../../services/OwnerStorageSandbox';

const fs = jest.requireActual('fs') as typeof import('fs');
const path = jest.requireActual('path') as typeof import('path');
const app = fs.readFileSync(path.resolve(__dirname, '../../App.tsx'), 'utf8');

describe('shared documents removed from this phone stay hidden here', () => {
  beforeEach(() => mockStore.clear());

  it('hides an id, keeps it across a restart, and ignores unreadable storage', async () => {
    const first = await renderHook(() => useHiddenSharedDocuments());
    await act(async () => { first.result.current.hide('doc-1'); });
    expect(first.result.current.hidden.has('doc-1')).toBe(true);
    expect(JSON.parse(mockStore.get(HIDDEN_SHARED_DOCUMENTS_STORAGE_KEY) || '[]')).toEqual(['doc-1']);
    await first.unmount();
    const again = await renderHook(() => useHiddenSharedDocuments());
    // The stored list loads inside act (the release gate fails on "not wrapped in act").
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
    expect(again.result.current.hidden.has('doc-1')).toBe(true);
    await again.unmount();
    mockStore.set(HIDDEN_SHARED_DOCUMENTS_STORAGE_KEY, '{');
    const broken = await renderHook(() => useHiddenSharedDocuments());
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
    expect(broken.result.current.hidden.size).toBe(0);
  });

  it('moves with the account on an account switch', () => {
    expect(isOwnerSensitiveCanonicalStorageKey(HIDDEN_SHARED_DOCUMENTS_STORAGE_KEY)).toBe(true);
  });

  it('is applied to the phone Documents list and set by Delete from This Device', () => {
    expect(app).toContain('referenceDocuments={referenceDocuments.filter(document => !hiddenSharedDocuments.hidden.has(document.id))}');
    expect(app).toContain('if (!sensitive && sharedRecord) hiddenSharedDocuments.hide(sharedRecord.id);');
    // All Devices on a copy another document uses says the shared copy stays (A8 L1).
    expect(app).toMatch(/if \(sharedWithAnotherDocument\) \{\n\s+Alert\.alert\('Shared copy kept'/);
  });
});
