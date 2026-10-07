/**
 * Owner answer Q44 (6 Oct 2026): "Archive" for a compliance document means
 * hidden on every device, kept in the cloud. The mark is one column the
 * owner adds to the cloud's shared-document table by pasting a database
 * change. These tests run the device's side of it (the real
 * services/SharedDocumentArchive.ts) against a stand-in for that table, in
 * the three states the app must be right in:
 *   BEFORE the paste, AFTER it, and MIXED (a device on an older build saves
 *   the record again).
 * No network, no account, no real document.
 */
import { createSharedDocumentCloud, type SharedDocumentCloud } from '../fixtures/shared-document-cloud';

// Each device keeps its own storage. A device's copy of the app is bound to
// its storage when that copy is started (device() below).
const mockDeviceStorage: Record<'phone' | 'ipad', Map<string, string>> = { phone: new Map(), ipad: new Map() };
let mockStartingDevice: 'phone' | 'ipad' = 'phone';
jest.mock('@react-native-async-storage/async-storage', () => {
  const storage = mockDeviceStorage[mockStartingDevice];
  return {
    __esModule: true,
    default: {
      getItem: jest.fn(async (key: string) => storage.get(key) ?? null),
      setItem: jest.fn(async (key: string, value: string) => { storage.set(key, value); }),
      removeItem: jest.fn(async (key: string) => { storage.delete(key); }),
    },
  };
});
jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///test/',
  getInfoAsync: jest.fn(async () => ({ exists: false })),
  makeDirectoryAsync: jest.fn(async () => undefined),
  deleteAsync: jest.fn(async () => undefined),
  EncodingType: { UTF8: 'utf8', Base64: 'base64' },
}));
jest.mock('../../services/SupabaseService', () => ({ uploadPhoto: jest.fn() }));

type Archive = typeof import('../../services/SharedDocumentArchive');
const PERMIT = 'doc-permit';
const ARCHIVED_AT = '2026-10-06T18:00:00.000Z';

/** A device as it is when the app starts: what it saved is still there, nothing is in memory. */
async function device(name: 'phone' | 'ipad' = 'phone', ownerId = 'owner-a'): Promise<Archive> {
  let archive!: Archive;
  mockStartingDevice = name;
  jest.isolateModules(() => { archive = require('../../services/SharedDocumentArchive'); });
  await archive.openSharedDocumentArchive(ownerId);
  return archive;
}
const sync = (archive: Archive, cloud: SharedDocumentCloud, ownerId = 'owner-a') =>
  archive.syncSharedDocumentArchiveWithCloud({ client: cloud.client, ownerId, timeoutMs: 200 });
const listed = (archive: Archive) => [...archive.sharedDocumentArchiveView().archivedIds].sort();
const marksWritten = (cloud: SharedDocumentCloud) => cloud.requests.filter(request => request.kind === 'write_mark');

let cloud: SharedDocumentCloud;
beforeEach(() => {
  mockDeviceStorage.phone.clear();
  mockDeviceStorage.ipad.clear();
  cloud = createSharedDocumentCloud();
  cloud.add(PERMIT, 'owner-a', { name: 'Grading permit', category: 'Permit Card' });
});

describe('before the owner pastes the database change', () => {
  it('asking the cloud is answered "no such column": taken as not installed, nothing thrown, nothing archived', async () => {
    const phone = await device();
    await expect(sync(phone, cloud)).resolves.toBe('not_installed');
    expect(phone.sharedDocumentArchiveView().installed).toBe(false);
    expect(listed(phone)).toEqual([]);
  });

  it('an archive is this device\'s own, as in the last build: nothing waits, nothing is written to the cloud, the row is as it was', async () => {
    const before = JSON.stringify(cloud.row(PERMIT));
    const phone = await device();
    await sync(phone, cloud);
    await phone.requestSharedDocumentArchive(PERMIT, true, ARCHIVED_AT);
    // The phone's own card carries the archive; the mark's list and its waiting list hold nothing (review of D1, L9).
    expect(listed(phone)).toEqual([]);
    expect([...phone.sharedDocumentArchiveView().waitingIds]).toEqual([]);
    await sync(phone, cloud);
    await sync(phone, cloud);
    expect(marksWritten(cloud)).toEqual([]);
    expect(JSON.stringify(cloud.row(PERMIT))).toBe(before);
    // Another device learns nothing of it: there it stays listed, as today.
    const ipad = await device('ipad');
    await sync(ipad, cloud);
    expect(listed(ipad)).toEqual([]);
  });

  it('a restore before the paste leaves nothing waiting at all', async () => {
    const phone = await device();
    await sync(phone, cloud);
    await phone.requestSharedDocumentArchive(PERMIT, true, ARCHIVED_AT);
    await phone.requestSharedDocumentArchive(PERMIT, false);
    expect(listed(phone)).toEqual([]);
    cloud.paste();
    await sync(phone, cloud);
    expect(marksWritten(cloud)).toEqual([]);
    expect(cloud.row(PERMIT)?.archived_at).toBeNull();
  });

  it('a live change to a document, as the cloud sends it before the paste, says nothing about archiving', async () => {
    const phone = await device();
    await phone.noteSharedDocumentArchiveLiveRow({ ownerId: 'owner-a', eventType: 'UPDATE', newRow: { id: PERMIT, owner_id: 'owner-a', document_data: {} }, oldRow: null });
    expect(phone.sharedDocumentArchiveView().installed).toBeNull();
    expect(listed(phone)).toEqual([]);
  });
});

describe('after the paste', () => {
  beforeEach(() => { cloud.paste(); });

  it('an archive sets the mark in the cloud and changes nothing else on the row', async () => {
    const before = { ...cloud.row(PERMIT) };
    const phone = await device();
    await sync(phone, cloud);
    await phone.requestSharedDocumentArchive(PERMIT, true, ARCHIVED_AT);
    await expect(sync(phone, cloud)).resolves.toBe('installed');
    expect(cloud.row(PERMIT)).toEqual({ ...before, archived_at: ARCHIVED_AT });
    expect(marksWritten(cloud)).toEqual([{ kind: 'write_mark', detail: { archived_at: ARCHIVED_AT } }]);
    expect(phone.sharedDocumentArchiveView().waitingIds.size).toBe(0);
    // It is sent once: a second pass has nothing left to send.
    await sync(phone, cloud);
    expect(marksWritten(cloud)).toHaveLength(1);
  });

  it('an archive made before the paste does not travel: the paste itself hides nothing on any device (review of D1, L9)', async () => {
    cloud.state.installed = false;
    const phone = await device();
    await sync(phone, cloud);
    await phone.requestSharedDocumentArchive(PERMIT, true, ARCHIVED_AT);
    await sync(phone, cloud);
    expect(cloud.row(PERMIT)?.archived_at ?? null).toBeNull();
    cloud.paste();
    await sync(phone, cloud);
    await sync(phone, cloud);
    expect(marksWritten(cloud)).toEqual([]);
    expect(cloud.row(PERMIT)?.archived_at ?? null).toBeNull();
  });

  it('every other device then leaves it out, and still does at its next launch with no signal', async () => {
    cloud.row(PERMIT)!.archived_at = ARCHIVED_AT;
    const ipad = await device('ipad');
    await expect(sync(ipad, cloud)).resolves.toBe('installed');
    expect(listed(ipad)).toEqual([PERMIT]);
    await ipad.sharedDocumentArchiveSettled();
    cloud.state.offline = true;
    const ipadNextLaunch = await device('ipad');
    expect(listed(ipadNextLaunch)).toEqual([PERMIT]);
    await expect(sync(ipadNextLaunch, cloud)).resolves.toBe('unknown');
    expect(listed(ipadNextLaunch)).toEqual([PERMIT]);
  });

  it('archived with no signal: hidden here at once, kept through closing the app, and it arrives later', async () => {
    const phone = await device();
    await sync(phone, cloud);
    cloud.state.offline = true;
    await phone.requestSharedDocumentArchive(PERMIT, true, ARCHIVED_AT);
    await expect(sync(phone, cloud)).resolves.toBe('unknown');
    expect(listed(phone)).toEqual([PERMIT]);
    expect([...phone.sharedDocumentArchiveView().waitingIds]).toEqual([PERMIT]);
    expect(cloud.row(PERMIT)?.archived_at).toBeNull();
    await phone.sharedDocumentArchiveSettled();

    const phoneNextLaunch = await device();
    expect(listed(phoneNextLaunch)).toEqual([PERMIT]);
    cloud.state.offline = false;
    await sync(phoneNextLaunch, cloud);
    expect(cloud.row(PERMIT)?.archived_at).toBe(ARCHIVED_AT);
    expect(phoneNextLaunch.sharedDocumentArchiveView().waitingIds.size).toBe(0);
  });

  it('Restore on another device empties the mark; the phone that archived it is told to put its card back, once', async () => {
    const phone = await device();
    await sync(phone, cloud);
    await phone.requestSharedDocumentArchive(PERMIT, true, ARCHIVED_AT);
    await sync(phone, cloud);
    await phone.sharedDocumentArchiveSettled();

    const ipad = await device('ipad');
    await sync(ipad, cloud);
    await ipad.requestSharedDocumentArchive(PERMIT, false);
    expect(listed(ipad)).toEqual([]); // shown again there at once
    await sync(ipad, cloud);
    expect(cloud.row(PERMIT)?.archived_at).toBeNull();
    expect(ipad.sharedDocumentArchiveView().restoredElsewhere).toEqual([]); // its own restore is not "elsewhere"
    await ipad.sharedDocumentArchiveSettled();

    const phoneAgain = await device();
    expect(listed(phoneAgain)).toEqual([PERMIT]); // what it last knew
    await sync(phoneAgain, cloud);
    expect(listed(phoneAgain)).toEqual([]);
    expect(phoneAgain.sharedDocumentArchiveView().restoredElsewhere).toEqual([PERMIT]);
    await phoneAgain.consumeSharedDocumentsRestoredElsewhere([PERMIT]);
    expect(phoneAgain.sharedDocumentArchiveView().restoredElsewhere).toEqual([]);
    await sync(phoneAgain, cloud);
    expect(phoneAgain.sharedDocumentArchiveView().restoredElsewhere).toEqual([]);
  });

  it('a live change from the cloud is followed without asking again: archived elsewhere, then restored elsewhere', async () => {
    const phone = await device();
    await sync(phone, cloud);
    const reads = cloud.requests.length;
    await phone.noteSharedDocumentArchiveLiveRow({ ownerId: 'owner-a', eventType: 'UPDATE', newRow: { id: PERMIT, owner_id: 'owner-a', archived_at: ARCHIVED_AT }, oldRow: null });
    expect(listed(phone)).toEqual([PERMIT]);
    await phone.noteSharedDocumentArchiveLiveRow({ ownerId: 'owner-a', eventType: 'UPDATE', newRow: { id: PERMIT, owner_id: 'owner-a', archived_at: null }, oldRow: null });
    expect(listed(phone)).toEqual([]);
    expect(phone.sharedDocumentArchiveView().restoredElsewhere).toEqual([PERMIT]);
    expect(cloud.requests.length).toBe(reads);
    // Another account's row is not this account's business.
    await phone.noteSharedDocumentArchiveLiveRow({ ownerId: 'owner-a', eventType: 'UPDATE', newRow: { id: 'doc-b', owner_id: 'owner-b', archived_at: ARCHIVED_AT }, oldRow: null });
    expect(listed(phone)).toEqual([]);
  });

  it('a document whose record has not reached the cloud yet: the mark waits, and lands once the record is there', async () => {
    const phone = await device();
    await sync(phone, cloud);
    await phone.requestSharedDocumentArchive('doc-new', true, ARCHIVED_AT);
    await sync(phone, cloud);
    expect([...phone.sharedDocumentArchiveView().waitingIds]).toEqual(['doc-new']);
    cloud.add('doc-new');
    cloud.paste();
    // It is tried again half a minute after the cloud had no such row (review of D1, L3: kept, with a growing wait).
    // CHANGED (second review, P2-L2): the half minute is counted in time the app has been running, not read off the clock.
    await phone.syncSharedDocumentArchiveWithCloud({ client: cloud.client, ownerId: 'owner-a', timeoutMs: 200, running: () => performance.now() + 31_000 });
    expect(cloud.row('doc-new')?.archived_at).toBe(ARCHIVED_AT);
    expect(phone.sharedDocumentArchiveView().waitingIds.size).toBe(0);
  });

  it('a mark waiting for one account is never sent by another, and the other account sees none of it', async () => {
    cloud.add('doc-b', 'owner-b');
    cloud.paste();
    const phone = await device('phone', 'owner-a');
    await sync(phone, cloud, 'owner-a'); // A's phone knows the mark is installed (only then does a tap wait: review of D1, L9)
    cloud.state.offline = true;
    await phone.requestSharedDocumentArchive(PERMIT, true, ARCHIVED_AT);
    await phone.sharedDocumentArchiveSettled();

    // Account B signs in on the same phone.
    cloud.state.offline = false;
    cloud.state.signedInOwnerId = 'owner-b';
    const asB = await device('phone', 'owner-b');
    expect(listed(asB)).toEqual([]);
    await expect(sync(asB, cloud, 'owner-b')).resolves.toBe('installed');
    expect(marksWritten(cloud)).toEqual([]);
    // A pass still running for A after the switch sends nothing either: the sign-in is no longer A's.
    await expect(sync(asB, cloud, 'owner-a')).resolves.toBe('unknown');
    expect(marksWritten(cloud)).toEqual([]);
    expect(cloud.row(PERMIT)?.archived_at).toBeNull();
    expect(cloud.row('doc-b')?.archived_at).toBeNull();
    await asB.sharedDocumentArchiveSettled();

    // A signs in again: its mark goes up then.
    cloud.state.signedInOwnerId = 'owner-a';
    const asA = await device('phone', 'owner-a');
    expect(listed(asA)).toEqual([PERMIT]);
    await sync(asA, cloud, 'owner-a');
    expect(cloud.row(PERMIT)?.archived_at).toBe(ARCHIVED_AT);
  });

  it('the cloud not answering in time holds nothing up and loses nothing', async () => {
    cloud.row(PERMIT)!.archived_at = ARCHIVED_AT;
    const phone = await device();
    await sync(phone, cloud);
    cloud.hold();
    await expect(sync(phone, cloud)).resolves.toBe('unknown');
    expect(listed(phone)).toEqual([PERMIT]);
    cloud.release();
  });

  it('undone (the column removed again): every document is listed again and the app is back to "not installed"', async () => {
    cloud.row(PERMIT)!.archived_at = ARCHIVED_AT;
    const ipad = await device('ipad');
    await sync(ipad, cloud);
    expect(listed(ipad)).toEqual([PERMIT]);
    cloud.state.installed = false;
    await expect(sync(ipad, cloud)).resolves.toBe('not_installed');
    expect(listed(ipad)).toEqual([]);
    expect(ipad.sharedDocumentArchiveView().restoredElsewhere).toEqual([]);
  });
});

describe('mixed: one device updated, one still on Build 230 or older', () => {
  it('the older build saving the record again, rebuilt from its fixed list of fields, does not un-archive it', async () => {
    cloud.paste();
    const phone = await device();
    await sync(phone, cloud);
    await phone.requestSharedDocumentArchive(PERMIT, true, ARCHIVED_AT);
    await sync(phone, cloud);
    expect(cloud.row(PERMIT)?.archived_at).toBe(ARCHIVED_AT);

    // The older build: it reads the record, keeps the fields it knows, and
    // writes the columns every build writes. (Its list of fields is the app's
    // normalizeReferenceDocument; it has never heard of the mark.)
    const { normalizeReferenceDocument } = require('../../services/ReferenceDocumentRepository');
    const rebuilt = normalizeReferenceDocument({ ...(cloud.row(PERMIT)!.document_data as object), notes: 'Checked on site' });
    expect(Object.keys(rebuilt).filter(key => /archiv/i.test(key))).toEqual([]);
    const { cloudUpdatedAt: _version, ...documentData } = rebuilt;
    cloud.olderBuildSaves({
      id: PERMIT, owner_id: 'owner-a', name: rebuilt.name, category: rebuilt.category,
      document_data: documentData, updated_at: '2026-10-06T19:00:00.000Z',
    });

    // Its edit is saved, and the mark is where it was.
    expect((cloud.row(PERMIT)!.document_data as { notes: string }).notes).toBe('Checked on site');
    expect(cloud.row(PERMIT)?.archived_at).toBe(ARCHIVED_AT);
    const ipad = await device('ipad');
    await sync(ipad, cloud);
    expect(listed(ipad)).toEqual([PERMIT]);
    // And the updated phone is not told it was restored.
    await sync(phone, cloud);
    expect(phone.sharedDocumentArchiveView().restoredElsewhere).toEqual([]);
  });

  it('why the mark is a column and not a field of the record: the same save drops a field it does not know', () => {
    const { normalizeReferenceDocument } = require('../../services/ReferenceDocumentRepository');
    const recordWithAMarkInside = { id: PERMIT, name: 'Grading permit', originalFileName: 'Grading permit.pdf', category: 'Permit Card', archivedAt: ARCHIVED_AT, isArchived: true };
    const rebuilt = normalizeReferenceDocument(recordWithAMarkInside);
    expect(Object.keys(rebuilt).filter(key => /archiv/i.test(key))).toEqual([]);
  });
});

describe('the phone\'s own card and the question it asks', () => {
  it('Restore puts back the card of that document and no other', async () => {
    const { withArchivedProjectDocumentsRestored } = await device();
    const cards = [
      { id: 'doc-permit', referenceDocumentId: 'doc-permit', isArchived: true, archivedAt: ARCHIVED_AT, updatedAt: ARCHIVED_AT },
      { id: 'card-2', referenceDocumentId: 'shared-2', isArchived: true, archivedAt: ARCHIVED_AT, updatedAt: ARCHIVED_AT },
      { id: 'card-3', referenceDocumentId: null, isArchived: false, archivedAt: null, updatedAt: ARCHIVED_AT },
    ];
    const restored = withArchivedProjectDocumentsRestored(cards, ['doc-permit'], '2026-10-07T08:00:00.000Z');
    expect(restored).toEqual([{ ...cards[0], isArchived: false, archivedAt: null, updatedAt: '2026-10-07T08:00:00.000Z' }, cards[1], cards[2]]);
    // By the shared copy's id too (a restore made on another device names that).
    expect(withArchivedProjectDocumentsRestored(cards, ['shared-2'])[1].isArchived).toBe(false);
    // Nothing to restore: the very same list, so nothing is saved again.
    expect(withArchivedProjectDocumentsRestored(cards, ['card-3'])).toBe(cards);
  });

  it('the Archive question is the one it has always been until the mark is installed, and then says what will happen', async () => {
    const { sharedDocumentArchiveQuestion } = await device();
    const asToday = 'Grading permit.pdf is categorized as Permit Card. It will be hidden from active project documents.';
    expect(sharedDocumentArchiveQuestion('Grading permit.pdf', 'Permit Card', null)).toBe(asToday);
    expect(sharedDocumentArchiveQuestion('Grading permit.pdf', 'Permit Card', false)).toBe(asToday);
    expect(sharedDocumentArchiveQuestion('Grading permit.pdf', 'Permit Card', true)).toBe(
      'Grading permit.pdf is categorized as Permit Card. It will be hidden on all your devices and kept in the cloud. You can bring it back under Archived in this project\'s Documents.');
  });
});
