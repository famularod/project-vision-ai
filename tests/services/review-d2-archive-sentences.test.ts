/**
 * Second review of the archive change, P2-L6 and the coordinator's decision
 * on wording (owner answer Q44, 6 Oct 2026).
 *
 * Every sentence this feature shows the owner on the phone and the iPad, in
 * one place, each with the state it is shown in. (The web shows none: an
 * archived document is simply not on its Documents page.) The words are
 * "hidden from Documents", not "hidden": an archived document leaves
 * Documents, its counts and reports, and a field update it was sent with
 * still shows it. No sentence speaks of a device on an older build, which
 * the app cannot know of. No sentence says which of two taps came first,
 * which the app cannot know either.
 */
jest.mock('@react-native-async-storage/async-storage', () => require('../fixtures/shared-document-two-devices').mockDeviceStorageModule());

import { mobileArchivedDocumentScopeText } from '../../services/MobileDocumentWorkspace';
import { createCloud, resetDevices, start, sync, type Cloud } from '../fixtures/shared-document-two-devices';

const PERMIT = 'doc-permit';
const T = (clock: string) => `2026-10-06T${clock}Z`;
let cloud: Cloud;
beforeEach(() => {
  resetDevices();
  cloud = createCloud();
  cloud.add(PERMIT);
});

describe('the question before archiving', () => {
  it('before the database change is installed, or before this device has ever had an answer: the question it has always been', async () => {
    const phone = await start('phone');
    for (const installed of [false, null]) {
      expect(phone.sharedDocumentArchiveQuestion('Grading permit.pdf', 'Permit Card', installed))
        .toBe('Grading permit.pdf is categorized as Permit Card. It will be hidden from active project documents.');
    }
  });

  it('once it is installed: where it is hidden from, that it is kept, what a field update does, and where to bring it back', async () => {
    const phone = await start('phone');
    expect(phone.sharedDocumentArchiveQuestion('Grading permit.pdf', 'Permit Card', true))
      .toBe('Grading permit.pdf is categorized as Permit Card. It will be hidden from Documents on all your devices and kept in the cloud. A field update it was sent with still shows it. You can bring it back under Archived in this project\'s Documents.');
  });
});

describe('the line under each document in "Archived (n)"', () => {
  it.each([
    ['the cloud carries the mark', 'everywhere', 'Hidden from Documents on all your devices. Kept in the cloud.'],
    ['archived here, the cloud not reached yet (no signal, or on its way)', 'waiting', 'Hidden from Documents on this device. Waiting to reach the cloud: your other devices follow once it has.'],
    ['archived here, the cloud answered and did not take it', 'refused', 'Hidden from Documents on this device only, for now: the cloud has not accepted this yet. This device keeps trying.'],
    ['not installed, never had an answer, or a card archived without the mark', 'this_device', 'Hidden from Documents on this device.'],
  ] as const)('%s', (_state, scope, sentence) => {
    expect(mobileArchivedDocumentScopeText(scope)).toBe(sentence);
  });

  it('none of them says "hidden on all your devices" or "hidden on this device" without saying from where', () => {
    for (const scope of ['everywhere', 'waiting', 'refused', 'this_device'] as const) {
      expect(mobileArchivedDocumentScopeText(scope)).toMatch(/^Hidden from Documents on /);
    }
  });
});

describe('the lines above "Archived (n)"', () => {
  it('a Restore made here that has not reached the cloud, and one the cloud has not taken', async () => {
    const ipad = await start('ipad');
    expect(ipad.sharedDocumentRestoreWaitingText({ documentId: PERMIT, name: 'Grading permit', refused: false }))
      .toBe('Grading permit: back in Documents on this device. Waiting to reach the cloud: your other devices show it again once it has.');
    expect(ipad.sharedDocumentRestoreWaitingText({ documentId: PERMIT, name: 'Grading permit', refused: true }))
      .toBe('Grading permit: back in Documents on this device only, for now: the cloud has not accepted this yet. This device keeps trying.');
    expect(ipad.sharedDocumentRestoreWaitingText({ documentId: PERMIT, refused: false })).toMatch(/^A document: back in Documents on this device\./);
  });

  it('a tap that was not sent: each of the three, with what the document\'s state now is', async () => {
    const phone = await start('phone');
    const line = (tap: 'archive' | 'restore', why: 'archived_again_on_another_device' | 'restored_on_another_device' | 'deleted_from_all_devices') =>
      phone.sharedDocumentArchiveNoticeText({ documentId: PERMIT, tap, why, name: 'Grading permit' });
    expect(line('restore', 'archived_again_on_another_device'))
      .toBe('Grading permit: your Restore on this device was not sent, because it was archived again on another device before this device could send it. It is still archived; tap Restore again if you still want it back.');
    expect(line('archive', 'restored_on_another_device'))
      .toBe('Grading permit: your Archive on this device was not sent, because it was restored on another device before this device could send it. It is in Documents again; archive it again if you still want it hidden.');
    expect(line('archive', 'deleted_from_all_devices'))
      .toBe('Grading permit: your Archive on this device was not sent, because the document has been deleted.');
  });

  it('the states behind them are what the lines say: "still archived" is archived on this device; "in Documents again" is listed on this device, its card put back', async () => {
    cloud.row(PERMIT)!.archived_at = T('09:00:00.000');
    const phone = await start('phone');
    const ipad = await start('ipad');
    await sync(phone, cloud, 'phone');
    await sync(ipad, cloud, 'ipad');
    // The iPad's Restore is let go: the phone restored and archived again meanwhile.
    cloud.state.offline.ipad = true;
    await ipad.requestSharedDocumentArchive(PERMIT, false, undefined, 'Grading permit');
    await phone.requestSharedDocumentArchive(PERMIT, false);
    await sync(phone, cloud, 'phone');
    await phone.consumeSharedDocumentsRestoredElsewhere([PERMIT]);
    await phone.requestSharedDocumentArchive(PERMIT, true, T('09:30:00.000'));
    await sync(phone, cloud, 'phone');
    cloud.state.offline.ipad = false;
    await sync(ipad, cloud, 'ipad');
    expect(ipad.sharedDocumentArchiveView().notices.map(notice => notice.why)).toEqual(['archived_again_on_another_device']);
    expect(ipad.sharedDocumentArchiveView().archivedIds.has(PERMIT)).toBe(true); // "It is still archived"
    expect(Boolean(cloud.row(PERMIT)?.archived_at)).toBe(true);

    // The phone's Archive is let go: the iPad restored meanwhile.
    cloud.state.offline.phone = true;
    await phone.requestSharedDocumentArchive(PERMIT, false);
    await phone.requestSharedDocumentArchive(PERMIT, true, T('10:00:00.000'), 'Grading permit.pdf');
    await ipad.requestSharedDocumentArchive(PERMIT, false, undefined, 'Grading permit');
    await sync(ipad, cloud, 'ipad');
    cloud.state.offline.phone = false;
    await sync(phone, cloud, 'phone');
    expect(phone.sharedDocumentArchiveView().notices.map(notice => notice.why)).toEqual(['restored_on_another_device']);
    expect(phone.sharedDocumentArchiveView().archivedIds.has(PERMIT)).toBe(false); // "It is in Documents again"
    expect(phone.sharedDocumentArchiveView().restoredElsewhere).toEqual([PERMIT]); // and its card is put back
    expect(cloud.row(PERMIT)?.archived_at).toBeNull();
  });
});
