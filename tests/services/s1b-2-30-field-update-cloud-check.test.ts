/**
 * Open item 2.30 (S1b, 14 Oct 2026; the coordinator's decision on S1's report). Builds 210 to 228 marked every saved
 * field update "Cloud Synced" before it uploaded; one whose upload never reached the cloud still reads so on that
 * iPhone or iPad, and nothing finds it. Settings now has "Check field updates against the cloud": read only. It names
 * each field update on this device that reads "Cloud Synced", is not archived, is not in the cloud's list, has no
 * upload waiting here, and is named by no deletion record. It sends nothing and changes nothing. Here: the rule, the
 * check with its readers given (the cloud's two lists and this device's queue), and the words. The Settings row is in
 * tests/components/s1b-2-30-settings-field-update-check.test.tsx. Synthetic data.
 */
import { noteSignedInOwner } from '../../services/CloudOwnerBinding';
import {
  checkFieldUpdatesAgainstCloud,
  fieldUpdateCloudCheckText,
  fieldUpdatesMarkedSyncedMissingFromCloud,
} from '../../services/FieldUpdateCloudCheck';
import type { SyncQueueItem } from '../../services/SyncService';
import type { ProjectUpdate } from '../../types';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async () => null), setItem: jest.fn(async () => undefined), removeItem: jest.fn(async () => undefined),
  getAllKeys: jest.fn(async () => []), multiGet: jest.fn(async () => []),
}));

type Update = ProjectUpdate & { isArchived?: boolean; stableSendId?: string | null };
const update = (id: string, status: ProjectUpdate['status'], extra: Partial<Update> = {}): Update => ({
  id, projectName: 'Alpha', date: '2026-09-22T15:30:00.000Z', photos: [], notes: `Poured the footings at the north wall for ${id} today`,
  recipients: { contactIds: [] }, status, ...extra,
}) as Update;
const ok = <T,>(data: T) => ({ ok: true, configured: true, data, status: 200 });
const failed = (error: string, configured = true) => ({ ok: false, configured, data: null, error });
const queued = (id: string) => ({ id: `project-update-${id}`, entity: 'project_update', operation: 'update', payload: { id }, createdAt: '', changedAt: '', retryCount: 0 }) as unknown as SyncQueueItem;

// On this phone: A and G in the cloud (G under the send id it was written with), B not (the fault), C waiting to
// sync (not "Cloud Synced"), D deleted on another device (a deletion record), E's upload still waiting here, F
// archived, H a draft.
const device = [
  update('A', 'sent'), update('B', 'sent'), update('C', 'queued'), update('D', 'sent'), update('E', 'sent'),
  update('F', 'sent', { isArchived: true }), update('G', 'sent', { stableSendId: 'send-G' }), update('H', 'draft'),
];
const cloudRows = [{ id: 'A' }, { id: 'row-G', idempotencyKey: 'send-G' }, { id: 'Z' }];

describe('2.30: which field updates the check names', () => {
  it('only one that reads "Cloud Synced", is not archived, is not in the cloud, waits for nothing here and no deletion record names', () => {
    expect(fieldUpdatesMarkedSyncedMissingFromCloud({ local: device, cloud: cloudRows, deletedIds: ['d'], waitingIds: ['E'] }).map(item => item.id)).toEqual(['B']);
  });
});

describe('2.30: the check (its readers given)', () => {
  const readers = (over: Partial<Parameters<typeof checkFieldUpdatesAgainstCloud>[1]> = {}) => ({
    listCloudUpdates: jest.fn(async () => ok(cloudRows)),
    listDeletionRecords: jest.fn(async (_ids: readonly string[]) => ok([{ entityType: 'project_update' as const, recordId: 'D', deletedAt: '2026-10-01T00:00:00.000Z' }])),
    readWaitingUploads: jest.fn(async () => [queued('E')]),
    ...over,
  });

  it('finds B; reads the cloud\'s list once, and asks about deletion records only for those missing from it', async () => {
    const r = readers();
    const outcome = await checkFieldUpdatesAgainstCloud(device, r);
    expect(outcome.kind).toBe('found');
    expect(outcome.kind === 'found' && outcome.updates.map(item => item.id)).toEqual(['B']);
    expect(outcome.kind === 'found' && outcome.checked).toBe(5);
    expect(r.listCloudUpdates).toHaveBeenCalledTimes(1);
    expect(r.listDeletionRecords).toHaveBeenCalledTimes(1);
    expect(r.listDeletionRecords).toHaveBeenCalledWith(['B', 'D']);
  });

  it('every one in the cloud: none found, and no deletion records asked for', async () => {
    const r = readers({ listCloudUpdates: jest.fn(async () => ok([{ id: 'A' }, { id: 'B' }, { id: 'D' }, { id: 'E' }, { id: 'G' }])) });
    await expect(checkFieldUpdatesAgainstCloud(device, r)).resolves.toEqual({ kind: 'none_found', checked: 5 });
    expect(r.listDeletionRecords).not.toHaveBeenCalled();
  });

  it('nothing on this device reads "Cloud Synced": nothing to check, and the cloud is not read at all', async () => {
    const r = readers();
    await expect(checkFieldUpdatesAgainstCloud([update('C', 'queued'), update('H', 'draft')], r)).resolves.toEqual({ kind: 'nothing_to_check' });
    expect([r.listCloudUpdates, r.listDeletionRecords, r.readWaitingUploads].map(fn => (fn as jest.Mock).mock.calls.length)).toEqual([0, 0, 0]);
  });

  it('could not run, with the true reason: not signed in, no signal, not set up, the cloud\'s list not read, a deletion list not read', async () => {
    const reason = async (over: Partial<Parameters<typeof checkFieldUpdatesAgainstCloud>[1]>) => {
      const outcome = await checkFieldUpdatesAgainstCloud(device, readers(over));
      return outcome.kind === 'could_not_run' ? outcome.reason : outcome.kind;
    };
    expect(await reason({ listCloudUpdates: async () => failed('Sign in is required.') })).toBe('not_signed_in');
    expect(await reason({ listCloudUpdates: async () => failed('TypeError: Network request failed') })).toBe('no_signal');
    expect(await reason({ listCloudUpdates: async () => { throw new TypeError('Network request failed'); } })).toBe('no_signal');
    expect(await reason({ listCloudUpdates: async () => failed('Supabase is not configured.', false) })).toBe('not_set_up');
    expect(await reason({ listCloudUpdates: async () => ({ ...ok([]), stubbed: true }) })).toBe('unreadable');
    expect(await reason({ listCloudUpdates: async () => failed('relation does not exist') })).toBe('unreadable');
    expect(await reason({ listDeletionRecords: async () => failed('Failed to fetch') })).toBe('no_signal');
  });

  it('another account signed in while it ran: could not run', async () => {
    noteSignedInOwner('owner-1');
    const r = readers({ listCloudUpdates: jest.fn(async () => { noteSignedInOwner('owner-2'); return ok(cloudRows); }) });
    await expect(checkFieldUpdatesAgainstCloud(device, r)).resolves.toEqual({ kind: 'could_not_run', reason: 'account_changed' });
    noteSignedInOwner(null);
  });
});

describe('2.30: the words he reads', () => {
  const say = (outcome: Parameters<typeof fieldUpdateCloudCheckText>[0]) => fieldUpdateCloudCheckText(outcome);
  it('none found; nothing to check', () => {
    expect(say({ kind: 'none_found', checked: 42 })).toEqual({ summary: 'All 42 field updates on this device that read “Cloud Synced” are in the cloud. Nothing was sent or changed.', items: [] });
    expect(say({ kind: 'none_found', checked: 1 }).summary).toBe('The 1 field update on this device that reads “Cloud Synced” is in the cloud. Nothing was sent or changed.');
    expect(say({ kind: 'nothing_to_check' }).summary).toBe('No field update on this device reads “Cloud Synced”, so there was nothing to check. Nothing was sent or changed.');
  });

  it('found: how many, that nothing was sent, and each with its date, project and first words of its note', () => {
    const one = update('B', 'sent', { date: '2026-09-22T15:30:00.000Z', projectName: 'Alpha', notes: 'Poured the footings at the north wall, rebar inspected and passed' });
    const two = update('K', 'sent', { date: 'not a date', projectName: '', notes: '' });
    const text = say({ kind: 'found', checked: 9, updates: [one, two] });
    expect(text.summary).toBe('These 2 field updates read “Cloud Synced” on this device but are not in the cloud, and no deletion record names them. Nothing was sent or changed. Sync Now would send them; if one is an update you deleted on another device, delete it here first.');
    const day = new Date('2026-09-22T15:30:00.000Z');
    expect(text.items).toEqual([`${day.getDate()} Sep 2026 · Alpha · Poured the footings at the north wall, rebar…`, 'not a date · No project · (no note)']);
    expect(say({ kind: 'found', checked: 1, updates: [one] }).summary).toBe('This field update reads “Cloud Synced” on this device but is not in the cloud, and no deletion record names it. Nothing was sent or changed. Sync Now would send it; if it is an update you deleted on another device, delete it here first.');
  });

  it('could not run, each reason in plain words', () => {
    expect(['not_signed_in', 'no_signal', 'not_set_up', 'account_changed', 'unreadable'].map(reason => say({ kind: 'could_not_run', reason } as never).summary)).toEqual([
      'The check could not run: this device is not signed in to the cloud. Sign in, then check again. Nothing was sent or changed.',
      'The check could not run: the cloud could not be reached. This device may have no signal; try again when it has. Nothing was sent or changed.',
      'The check could not run: this copy of the app is not set up to reach the cloud. Nothing was sent or changed.',
      'The check could not run: the account signed in changed while it ran. Check again. Nothing was sent or changed.',
      'The check could not run: the cloud’s list could not be read just now. Try again shortly. Nothing was sent or changed.',
    ]);
  });
});
