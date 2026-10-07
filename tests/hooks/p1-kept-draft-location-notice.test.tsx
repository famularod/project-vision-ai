/**
 * P1 part B item 3 (6 Oct 2026): the hook that carries "why this update has
 * no GPS" across a relaunch. The order matters: what was kept is read
 * before anything is written, so the empty notice the app starts with
 * cannot erase it.
 */
import { act, renderHook, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useState } from 'react';
import { useKeptDraftLocationNotice } from '../../hooks/use-kept-draft-location-notice';
import type { DraftLocationNotice } from '../../services/DraftAreaPresentation';
import { DRAFT_LOCATION_NOTICE_STORAGE_KEY } from '../../services/DraftLocationNoticeStore';

jest.mock('@react-native-async-storage/async-storage', () => {
  const values = new Map<string, string>();
  return {
    getItem: jest.fn(async (key: string) => values.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => { values.set(key, value); }),
    removeItem: jest.fn(async (key: string) => { values.delete(key); }),
    clear: async () => values.clear(),
  };
});

type Draft = { id: string; gpsLatitude: number | null; gpsLongitude: number | null };
type Props = { ready: boolean; draft: Draft; generation: number };

const kept = async () => {
  const raw = await AsyncStorage.getItem(DRAFT_LOCATION_NOTICE_STORAGE_KEY);
  return raw ? JSON.parse(raw) : null;
};
const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });

/** The app's own wiring: the notice is state, the hook keeps and restores it. */
function mount(initial: Props) {
  return renderHook((props: Props) => {
    const [notice, setNotice] = useState<DraftLocationNotice | null>(null);
    useKeptDraftLocationNotice({
      ready: props.ready,
      draft: props.draft,
      notice,
      generation: () => props.generation,
      setNotice,
    });
    return { notice, setNotice };
  }, { initialProps: initial });
}

const draft: Draft = { id: 'draft-1', gpsLatitude: null, gpsLongitude: null };

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.mocked(AsyncStorage.getItem).mockClear();
  jest.mocked(AsyncStorage.setItem).mockClear();
  jest.mocked(AsyncStorage.removeItem).mockClear();
});

describe('the kept reason across a relaunch', () => {
  it('writes nothing, and removes nothing, before the stored update has been read', async () => {
    await AsyncStorage.setItem(DRAFT_LOCATION_NOTICE_STORAGE_KEY, JSON.stringify({ version: 1, draftId: 'draft-1', kind: 'denied' }));
    jest.mocked(AsyncStorage.setItem).mockClear();
    const hook = mount({ ready: false, draft: { id: 'blank', gpsLatitude: null, gpsLongitude: null }, generation: 0 });
    await settle();
    expect(AsyncStorage.getItem).not.toHaveBeenCalled();
    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
    expect(AsyncStorage.removeItem).not.toHaveBeenCalled();
    expect(await kept()).toEqual({ version: 1, draftId: 'draft-1', kind: 'denied' });
    expect(hook.result.current.notice).toBeNull();
    hook.unmount();
  });

  it('gives the resumed update the reason it had, and keeps it kept', async () => {
    await AsyncStorage.setItem(DRAFT_LOCATION_NOTICE_STORAGE_KEY, JSON.stringify({ version: 1, draftId: 'draft-1', kind: 'precise-off' }));
    const hook = mount({ ready: false, draft: { id: 'blank', gpsLatitude: null, gpsLongitude: null }, generation: 0 });
    // The stored update arrives in the same render that says it has been read.
    hook.rerender({ ready: true, draft, generation: 0 });
    await waitFor(() => expect(hook.result.current.notice).toEqual({ draftId: 'draft-1', generation: 0, kind: 'precise-off' }));
    await settle();
    expect(await kept()).toEqual({ version: 1, draftId: 'draft-1', kind: 'precise-off' });
    hook.unmount();
  });

  it('shows nothing for a different update, and clears what was kept for the old one', async () => {
    await AsyncStorage.setItem(DRAFT_LOCATION_NOTICE_STORAGE_KEY, JSON.stringify({ version: 1, draftId: 'older-draft', kind: 'denied' }));
    const hook = mount({ ready: true, draft, generation: 0 });
    await settle();
    expect(hook.result.current.notice).toBeNull();
    expect(await kept()).toBeNull();
    hook.unmount();
  });

  it('shows nothing once the update has its own GPS', async () => {
    await AsyncStorage.setItem(DRAFT_LOCATION_NOTICE_STORAGE_KEY, JSON.stringify({ version: 1, draftId: 'draft-1', kind: 'failed' }));
    const hook = mount({ ready: true, draft: { id: 'draft-1', gpsLatitude: 37.5, gpsLongitude: -122.2 }, generation: 0 });
    await settle();
    expect(hook.result.current.notice).toBeNull();
    hook.unmount();
  });

  it('a capture that spoke first is not overwritten by what was kept', async () => {
    await AsyncStorage.setItem(DRAFT_LOCATION_NOTICE_STORAGE_KEY, JSON.stringify({ version: 1, draftId: 'draft-1', kind: 'denied' }));
    const hook = mount({ ready: false, draft, generation: 1 });
    act(() => { hook.result.current.setNotice({ draftId: 'draft-1', generation: 1, kind: 'capturing' }); });
    hook.rerender({ ready: true, draft, generation: 1 });
    await settle();
    expect(hook.result.current.notice).toEqual({ draftId: 'draft-1', generation: 1, kind: 'capturing' });
    // What is kept now is the newer capture's (kept as "could not be captured" until it lands).
    expect(await kept()).toEqual({ version: 1, draftId: 'draft-1', kind: 'failed' });
    hook.unmount();
  });

  it('keeps each outcome as it happens, and forgets it when a fix lands', async () => {
    const hook = mount({ ready: true, draft, generation: 1 });
    await settle();
    act(() => { hook.result.current.setNotice({ draftId: 'draft-1', generation: 1, kind: 'capturing' }); });
    await waitFor(async () => expect(await kept()).toEqual({ version: 1, draftId: 'draft-1', kind: 'failed' }));
    act(() => { hook.result.current.setNotice({ draftId: 'draft-1', generation: 1, kind: 'denied' }); });
    await waitFor(async () => expect(await kept()).toEqual({ version: 1, draftId: 'draft-1', kind: 'denied' }));
    act(() => { hook.result.current.setNotice(null); });
    await waitFor(async () => expect(await kept()).toBeNull());
    hook.unmount();
  });

  it('a read that finishes after the app shell is gone changes nothing', async () => {
    await AsyncStorage.setItem(DRAFT_LOCATION_NOTICE_STORAGE_KEY, JSON.stringify({ version: 1, draftId: 'draft-1', kind: 'denied' }));
    let release: (value: string | null) => void = () => undefined;
    jest.mocked(AsyncStorage.getItem).mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    jest.mocked(AsyncStorage.setItem).mockClear();
    const hook = mount({ ready: true, draft, generation: 0 });
    hook.unmount();
    await act(async () => { release(JSON.stringify({ version: 1, draftId: 'draft-1', kind: 'denied' })); });
    await settle();
    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
    expect(AsyncStorage.removeItem).not.toHaveBeenCalled();
  });
});
