/**
 * P1 part B item 3 (6 Oct 2026): the reason an unfinished update has no GPS
 * is kept on the phone, for that update only, and read back after a
 * relaunch. tests/app-gps-reasons-told.test.tsx shows it in the real app;
 * these cases pin the rules one at a time.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { currentDraftLocationNoticeView, draftAreaPresentation } from '../../services/DraftAreaPresentation';
import {
  DRAFT_LOCATION_NOTICE_STORAGE_KEY,
  draftLocationNoticeToKeep,
  keepDraftLocationNotice,
  parseKeptDraftLocationNotice,
  readKeptDraftLocationNotice,
  resumedDraftLocationNotice,
} from '../../services/DraftLocationNoticeStore';

import { createOwnerStorageSandbox, isOwnerSensitiveCanonicalStorageKey } from '../../services/OwnerStorageSandbox';

jest.mock('@react-native-async-storage/async-storage', () => {
  const values = new Map<string, string>();
  const api = {
    getItem: jest.fn(async (key: string) => values.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => { values.set(key, value); }),
    removeItem: jest.fn(async (key: string) => { values.delete(key); }),
    getAllKeys: async () => [...values.keys()],
    multiGet: async (keys: string[]) => keys.map(key => [key, values.get(key) ?? null]),
    multiSet: async (entries: [string, string][]) => { entries.forEach(([key, value]) => values.set(key, value)); },
    multiRemove: async (keys: string[]) => { keys.forEach(key => values.delete(key)); },
    clear: async () => values.clear(),
  };
  return { __esModule: true, default: api, ...api };
});

const noGps = { id: 'draft-1', gpsLatitude: null, gpsLongitude: null, gpsAccuracy: null };

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.mocked(AsyncStorage.getItem).mockClear();
  jest.mocked(AsyncStorage.setItem).mockClear();
});

describe('what is kept for the notice showing', () => {
  it('keeps each settled outcome for its update', () => {
    for (const kind of ['denied', 'failed', 'precise-off'] as const) {
      expect(draftLocationNoticeToKeep({ draftId: 'draft-1', generation: 4, kind })).toEqual({ draftId: 'draft-1', kind });
    }
  });

  it('keeps a capture still under way as "could not be captured": true if the app is closed before the fix arrives', () => {
    expect(draftLocationNoticeToKeep({ draftId: 'draft-1', generation: 1, kind: 'capturing' }))
      .toEqual({ draftId: 'draft-1', kind: 'failed' });
  });

  it('keeps nothing when there is no notice', () => {
    expect(draftLocationNoticeToKeep(null)).toBeNull();
  });
});

describe('what a resumed update shows', () => {
  const kept = { draftId: 'draft-1', kind: 'denied' } as const;

  it('the reason kept for this update, as the newest capture outcome', () => {
    expect(resumedDraftLocationNotice({ kept, draft: noGps, generation: 0 }))
      .toEqual({ draftId: 'draft-1', generation: 0, kind: 'denied' });
  });

  it('nothing for another update', () => {
    expect(resumedDraftLocationNotice({ kept, draft: { ...noGps, id: 'draft-2' }, generation: 0 })).toBeNull();
  });

  it('nothing once the update has GPS of its own', () => {
    expect(resumedDraftLocationNotice({
      kept, draft: { id: 'draft-1', gpsLatitude: 37.5, gpsLongitude: -122.2 }, generation: 0,
    })).toBeNull();
  });

  it('nothing when nothing was kept', () => {
    expect(resumedDraftLocationNotice({ kept: null, draft: noGps, generation: 0 })).toBeNull();
  });

  it('reads on Add Photos exactly as it did before the app was closed', () => {
    const wording = {
      denied: 'Location permission denied. Choose Project Area manually.',
      failed: 'GPS could not be captured. Choose Project Area manually.',
    } as const;
    for (const kind of ['denied', 'failed'] as const) {
      const notice = resumedDraftLocationNotice({ kept: { draftId: 'draft-1', kind }, draft: noGps, generation: 0 });
      const view = draftAreaPresentation({
        selectedArea: null,
        selectedAreaName: 'Unassigned / Unknown Area',
        areaStatus: 'unknown',
        areaSuggestion: null,
        hasScheduleRecommendation: false,
        locationNotice: currentDraftLocationNoticeView({ notice, generation: 0, draft: noGps, areas: [] }),
      });
      expect(view.locationNotice).toBe(wording[kind]);
    }
  });

  it('gives way to a later capture, as any notice does', () => {
    const notice = resumedDraftLocationNotice({ kept, draft: noGps, generation: 0 });
    // A capture has started since (generation 1): the resumed reason is no longer the newest.
    expect(currentDraftLocationNoticeView({ notice, generation: 1, draft: noGps, areas: [] })).toBeNull();
  });
});

describe('the phone\'s copy', () => {
  it('is written, read back, and removed', async () => {
    await keepDraftLocationNotice({ draftId: 'draft-1', kind: 'precise-off' });
    expect(JSON.parse((await AsyncStorage.getItem(DRAFT_LOCATION_NOTICE_STORAGE_KEY)) as string))
      .toEqual({ version: 1, draftId: 'draft-1', kind: 'precise-off' });
    expect(await readKeptDraftLocationNotice()).toEqual({ draftId: 'draft-1', kind: 'precise-off' });

    await keepDraftLocationNotice(null);
    expect(await AsyncStorage.getItem(DRAFT_LOCATION_NOTICE_STORAGE_KEY)).toBeNull();
    expect(await readKeptDraftLocationNotice()).toBeNull();
  });

  it('writes in the order asked for', async () => {
    const first = keepDraftLocationNotice({ draftId: 'draft-1', kind: 'failed' });
    const second = keepDraftLocationNotice({ draftId: 'draft-1', kind: 'denied' });
    const third = keepDraftLocationNotice(null);
    const fourth = keepDraftLocationNotice({ draftId: 'draft-2', kind: 'precise-off' });
    await Promise.all([first, second, third, fourth]);
    expect(await readKeptDraftLocationNotice()).toEqual({ draftId: 'draft-2', kind: 'precise-off' });
  });

  it('holds only the update\'s id and one of three words: no place, no project, no note', async () => {
    await keepDraftLocationNotice({ draftId: 'draft-1', kind: 'denied' });
    const stored = JSON.parse((await AsyncStorage.getItem(DRAFT_LOCATION_NOTICE_STORAGE_KEY)) as string);
    expect(Object.keys(stored).sort()).toEqual(['draftId', 'kind', 'version']);
  });

  it('a write the phone refuses loses only the reason, and does not throw', async () => {
    jest.mocked(AsyncStorage.setItem).mockRejectedValueOnce(new Error('disk full'));
    await expect(keepDraftLocationNotice({ draftId: 'draft-1', kind: 'denied' })).resolves.toBeUndefined();
    expect(await readKeptDraftLocationNotice()).toBeNull();
  });

  it('a read the phone refuses says nothing, and does not throw', async () => {
    jest.mocked(AsyncStorage.getItem).mockRejectedValueOnce(new Error('unreadable'));
    await expect(readKeptDraftLocationNotice()).resolves.toBeNull();
  });

  it('ignores anything that is not a reason this app wrote', () => {
    for (const raw of [
      null, '', 'not json', '[]', 'null', '{}',
      JSON.stringify({ version: 2, draftId: 'draft-1', kind: 'denied' }),
      JSON.stringify({ version: 1, draftId: '', kind: 'denied' }),
      JSON.stringify({ version: 1, draftId: 7, kind: 'denied' }),
      JSON.stringify({ version: 1, draftId: 'draft-1', kind: 'capturing' }),
      JSON.stringify({ version: 1, draftId: 'draft-1', kind: 'no-area' }),
    ]) {
      expect(parseKeptDraftLocationNotice(raw)).toBeNull();
    }
  });
});

describe('whose reason it is', () => {
  it('stays with the account that was signed in, like the unfinished update itself', async () => {
    expect(isOwnerSensitiveCanonicalStorageKey(DRAFT_LOCATION_NOTICE_STORAGE_KEY)).toBe(true);
    const sandbox = createOwnerStorageSandbox({
      storage: AsyncStorage as unknown as Parameters<typeof createOwnerStorageSandbox>[0]['storage'],
    });

    await sandbox.activateOwner('account-a');
    await keepDraftLocationNotice({ draftId: 'draft-of-a', kind: 'denied' });

    // Account A signs out and account B signs in on the same phone.
    await sandbox.activateOwner(null);
    expect(await readKeptDraftLocationNotice()).toBeNull();
    await sandbox.activateOwner('account-b');
    expect(await readKeptDraftLocationNotice()).toBeNull();
    await keepDraftLocationNotice({ draftId: 'draft-of-b', kind: 'precise-off' });

    // Account A comes back to its own.
    await sandbox.activateOwner(null);
    await sandbox.activateOwner('account-a');
    expect(await readKeptDraftLocationNotice()).toEqual({ draftId: 'draft-of-a', kind: 'denied' });
  });
});
