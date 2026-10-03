/**
 * @jest-environment node
 */
import { buildDAVEReportSnapshot, type DAVEReportSnapshot } from '../../services/DAVEReportSnapshot';
import { loadDAVEReportPeriod, reportSenderId, saveDAVEReportSnapshot } from '../../services/DAVEReportSnapshotStore';
import {
  DAVE_WEB_NO_KEYCHAIN,
  daveWebReportStorage,
  forgetDAVEWebOwnReportSends,
  forgetDAVEWebReportPeriods,
  recordDAVEWebReportSend,
} from '../../services/DAVEWebReportSend';

// Review N1 (2 Oct 2026, caused by 46e3332): with this browser profile's
// storage full, a report period was written to this tab's own copy but
// never read back: every read still asked the profile. Approve then said
// the period could not be saved on this computer, and a send from here was
// not recorded. This tab's own copy is now read first.

jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() }));

/** A browser profile's storage that can be made full (every write refused, as Chrome's QuotaExceededError). */
function profileStorage() {
  const values = new Map<string, string>();
  const state = { full: false, unreachable: false };
  return {
    values,
    state,
    getItem: (key: string) => {
      if (state.unreachable) throw new Error('SecurityError');
      return values.get(key) ?? null;
    },
    setItem: (key: string, value: string) => {
      if (state.unreachable) throw new Error('SecurityError');
      if (state.full) throw new Error('QuotaExceededError');
      values.set(key, value);
    },
    removeItem: (key: string) => {
      if (state.unreachable) throw new Error('SecurityError');
      values.delete(key);
    },
    key: (index: number) => [...values.keys()][index] ?? null,
    get length() { return values.size; },
  };
}
const CLOUD_OFF = { read: async () => null, write: async () => undefined };
const approval = (fingerprint: string) => ({
  ...buildDAVEReportSnapshot({ truths: [], scopeKey: 'tower', sourceFingerprint: fingerprint, capturedAt: '2026-10-01T12:00:00.000Z', reportFormat: 'project_manager' }),
  deliveredAt: null,
}) as DAVEReportSnapshot;

afterEach(() => {
  forgetDAVEWebReportPeriods('owner-1');
  forgetDAVEWebReportPeriods('owner-2');
  forgetDAVEWebOwnReportSends();
});

describe('review N1 (Low): with the profile\'s storage full, what this tab kept instead is read back', () => {
  it('a value the full profile refused is read back from this tab; a removal removes it', async () => {
    const profile = profileStorage();
    profile.state.full = true;
    const storage = daveWebReportStorage(async () => 'owner-1', profile);
    await storage.setItem('k', 'v');
    expect(profile.values.size).toBe(0);
    await expect(storage.getItem('k')).resolves.toBe('v');
    await storage.removeItem?.('k');
    await expect(storage.getItem('k')).resolves.toBeNull();
  });

  it('the later write wins over what the profile still holds; once the profile takes a write again, the profile is read', async () => {
    const profile = profileStorage();
    const storage = daveWebReportStorage(async () => 'owner-1', profile);
    await storage.setItem('k', 'in the profile');
    profile.state.full = true;
    await storage.setItem('k', 'newer, in this tab');
    expect(profile.values.get('@vitruvius/web/owner-1/k')).toBe('in the profile');
    await expect(storage.getItem('k')).resolves.toBe('newer, in this tab');
    // Space again (site data cleared elsewhere): the next write goes to the profile, and no older tab copy is read over it.
    profile.state.full = false;
    await storage.setItem('k', 'newest, in the profile');
    await expect(storage.getItem('k')).resolves.toBe('newest, in the profile');
    expect(profile.values.get('@vitruvius/web/owner-1/k')).toBe('newest, in the profile');
  });

  it('a removal the profile could not make still reads as removed here', async () => {
    const profile = profileStorage();
    const storage = daveWebReportStorage(async () => 'owner-1', profile);
    await storage.setItem('k', 'in the profile');
    profile.state.unreachable = true;
    await storage.removeItem?.('k');
    profile.state.unreachable = false;
    await expect(storage.getItem('k')).resolves.toBeNull();
  });

  it('each account reads only its own tab copy; Sign Out of This Computer removes it', async () => {
    const profile = profileStorage();
    profile.state.full = true;
    const mine = daveWebReportStorage(async () => 'owner-1', profile);
    const theirs = daveWebReportStorage(async () => 'owner-2', profile);
    await mine.setItem('k', 'mine');
    await expect(theirs.getItem('k')).resolves.toBeNull();
    await theirs.setItem('k', 'theirs');
    forgetDAVEWebReportPeriods('owner-1');
    await expect(mine.getItem('k')).resolves.toBeNull();
    await expect(theirs.getItem('k')).resolves.toBe('theirs');
  });

  it('an approval is saved and verified, and its send recorded, for as long as the tab lasts; the sender id is one id', async () => {
    const profile = profileStorage();
    profile.state.full = true;
    const storage = daveWebReportStorage(async () => 'owner-1', profile);
    // It threw "The approved report snapshot could not be verified after saving."
    await expect(saveDAVEReportSnapshot(approval('facts'), storage, CLOUD_OFF)).resolves.toBeUndefined();
    await expect(loadDAVEReportPeriod('tower', 'project_manager', storage, CLOUD_OFF)).resolves.toMatchObject({
      snapshot: { sourceFingerprint: 'facts', deliveredAt: null },
    });
    const outcome = await recordDAVEWebReportSend({ storage, cloud: CLOUD_OFF }, { scopeKey: 'tower', reportFormat: 'project_manager' }, 'facts', '2026-10-01T13:00:00.000Z');
    expect(outcome).toMatchObject({ status: 'saved', snapshot: { deliveredAt: '2026-10-01T13:00:00.000Z' } });
    const senderId = await reportSenderId(storage, DAVE_WEB_NO_KEYCHAIN);
    expect(senderId).toEqual(expect.any(String));
    await expect(reportSenderId(storage, DAVE_WEB_NO_KEYCHAIN)).resolves.toBe(senderId);
    expect((outcome as { snapshot: DAVEReportSnapshot }).snapshot.sentBy).toBe(senderId);
    expect(profile.values.size).toBe(0);
    // The profile's sender id is not an account's: it stays past the sign-out.
    forgetDAVEWebReportPeriods('owner-1');
    await expect(reportSenderId(storage, DAVE_WEB_NO_KEYCHAIN)).resolves.toBe(senderId);
  });
});
