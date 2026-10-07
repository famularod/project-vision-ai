/**
 * Review of D1 (independent review P5, pass 1): the archived mark on a shared
 * document (owner answer Q44, 6 Oct 2026), on two devices against a stand-in
 * for the cloud's table. The reviewer's failing cases are brought in here as
 * each is fixed; a case's name starts with the finding it answers.
 */
jest.mock('@react-native-async-storage/async-storage', () => require('../fixtures/shared-document-two-devices').mockDeviceStorageModule());

import { createCloud, hiddenOn, resetDevices, start, sync, type Cloud } from '../fixtures/shared-document-two-devices';

const PERMIT = 'doc-permit';
let cloud: Cloud;
beforeEach(() => {
  resetDevices();
  cloud = createCloud();
  cloud.add(PERMIT);
});

describe('L9: before the database change is installed the app does what the last build did', () => {
  it('an Archive is not put on the waiting list, so pasting the database change hides nothing anywhere', async () => {
    cloud.state.installed = false;
    const phone = await start('phone');
    await expect(sync(phone, cloud, 'phone')).resolves.toBe('not_installed');

    await phone.requestSharedDocumentArchive(PERMIT, true, '2026-10-06T18:00:00.000Z');
    // Nothing waits, and nothing is hidden by the mark: the phone's own card carries the archive, as in the last build.
    expect([...phone.sharedDocumentArchiveView().waitingIds]).toEqual([]);
    expect(hiddenOn(phone)).toEqual([]);
    await phone.sharedDocumentArchiveSettled();

    // The owner pastes the database change. The phone is closed and opened, and reaches the cloud.
    cloud.state.installed = true;
    const phoneAfter = await start('phone');
    await expect(sync(phoneAfter, cloud, 'phone')).resolves.toBe('installed');
    await sync(phoneAfter, cloud, 'phone');
    expect(cloud.writes).toEqual([]);
    expect(cloud.row(PERMIT)?.archived_at).toBeNull();
    const ipad = await start('ipad');
    await sync(ipad, cloud, 'ipad');
    expect(hiddenOn(ipad)).toEqual([]);
  });

  it('a device that has never had an answer (no signal since it was installed) treats the mark as not installed', async () => {
    cloud.state.offline.phone = true;
    const phone = await start('phone');
    await expect(sync(phone, cloud, 'phone')).resolves.toBe('unknown');
    expect(phone.sharedDocumentArchiveView().installed).toBeNull();
    expect(phone.sharedDocumentArchiveQuestion('Grading permit.pdf', 'Permit Card', phone.sharedDocumentArchiveView().installed))
      .toBe('Grading permit.pdf is categorized as Permit Card. It will be hidden from active project documents.');

    await phone.requestSharedDocumentArchive(PERMIT, true, '2026-10-06T18:00:00.000Z');
    expect([...phone.sharedDocumentArchiveView().waitingIds]).toEqual([]);

    cloud.state.offline.phone = false;
    await sync(phone, cloud, 'phone');
    await sync(phone, cloud, 'phone');
    expect(cloud.writes).toEqual([]);
    expect(cloud.row(PERMIT)?.archived_at).toBeNull();
  });

  it('a Restore before the database change leaves nothing waiting either', async () => {
    cloud.state.offline.ipad = true;
    const ipad = await start('ipad');
    await ipad.requestSharedDocumentArchive(PERMIT, false, '2026-10-06T18:00:00.000Z');
    await ipad.sharedDocumentArchiveSettled();
    cloud.state.offline.ipad = false;
    await sync(ipad, cloud, 'ipad');
    expect(cloud.writes).toEqual([]);
  });

  it('the waiting list is for a tap made when the device knows the mark is installed and cannot reach the cloud', async () => {
    const phone = await start('phone');
    await expect(sync(phone, cloud, 'phone')).resolves.toBe('installed');
    cloud.state.offline.phone = true;
    await phone.requestSharedDocumentArchive(PERMIT, true, '2026-10-06T18:00:00.000Z');
    expect([...phone.sharedDocumentArchiveView().waitingIds]).toEqual([PERMIT]);
    expect(hiddenOn(phone)).toEqual([PERMIT]);
    cloud.state.offline.phone = false;
    await sync(phone, cloud, 'phone');
    expect(cloud.row(PERMIT)?.archived_at).toBe('2026-10-06T18:00:00.000Z');
  });

  it('the database change undone while an Archive waits: it stops waiting, so pasting the change a second time hides nothing either', async () => {
    const phone = await start('phone');
    await sync(phone, cloud, 'phone');
    cloud.state.offline.phone = true;
    await phone.requestSharedDocumentArchive(PERMIT, true, '2026-10-06T18:00:00.000Z');
    expect([...phone.sharedDocumentArchiveView().waitingIds]).toEqual([PERMIT]);

    // The owner undoes the database change; the phone gets signal and learns of it.
    cloud.state.installed = false;
    cloud.state.offline.phone = false;
    await expect(sync(phone, cloud, 'phone')).resolves.toBe('not_installed');
    expect([...phone.sharedDocumentArchiveView().waitingIds]).toEqual([]);
    expect(hiddenOn(phone)).toEqual([]); // the phone's own card keeps it put away, on this phone only
    await phone.sharedDocumentArchiveSettled();

    // He pastes it again.
    cloud.state.installed = true;
    const phoneAfter = await start('phone');
    await sync(phoneAfter, cloud, 'phone');
    await sync(phoneAfter, cloud, 'phone');
    expect(cloud.writes).toEqual([]);
    expect(cloud.row(PERMIT)?.archived_at).toBeNull();
  });
});

describe('L3: the cloud refuses the write for a reason that is not "no such column"', () => {
  const REFUSAL = { code: '', message: 'upstream connect error or disconnect/reset before headers' };
  const MINUTE = 60_000;

  it('F-L3: thirty refusals and the Archive is still waiting, is said to be refused, and reaches the cloud once it takes it', async () => {
    let clock = Date.parse('2026-10-06T18:00:00.000Z');
    const now = () => clock;
    const phone = await start('phone');
    await sync(phone, cloud, 'phone', 'owner-a', { now });
    await phone.requestSharedDocumentArchive(PERMIT, true, '2026-10-06T18:00:00.000Z');
    cloud.state.failWritesWith = REFUSAL;
    for (let pass = 0; pass < 30; pass += 1) {
      await sync(phone, cloud, 'phone', 'owner-a', { now });
      clock += 20 * MINUTE; // longer than the longest wait between tries
    }
    expect(cloud.writes).toHaveLength(30);
    // Never given up without a word: it still waits, and the device knows the cloud refused it.
    expect([...phone.sharedDocumentArchiveView().waitingIds]).toEqual([PERMIT]);
    expect([...phone.sharedDocumentArchiveView().refusedIds]).toEqual([PERMIT]);
    expect(hiddenOn(phone)).toEqual([PERMIT]);
    await phone.sharedDocumentArchiveSettled();

    // Kept through closing the app. The service is back: the archive he made reaches the cloud.
    const phoneLater = await start('phone');
    expect([...phoneLater.sharedDocumentArchiveView().refusedIds]).toEqual([PERMIT]);
    cloud.state.failWritesWith = null;
    await sync(phoneLater, cloud, 'phone', 'owner-a', { now });
    expect(cloud.row(PERMIT)?.archived_at).toBe('2026-10-06T18:00:00.000Z');
    expect(phoneLater.sharedDocumentArchiveView().waitingIds.size).toBe(0);
    expect(phoneLater.sharedDocumentArchiveView().refusedIds.size).toBe(0);
    expect(phoneLater.sharedDocumentArchiveView().nextTryAt).toBeNull();
  });

  it('a refused write is not sent again until its wait is over: half a minute, doubling, a quarter of an hour at most', async () => {
    let clock = Date.parse('2026-10-06T18:00:00.000Z');
    const now = () => clock;
    const phone = await start('phone');
    await sync(phone, cloud, 'phone', 'owner-a', { now });
    await phone.requestSharedDocumentArchive(PERMIT, true, '2026-10-06T18:00:00.000Z');
    expect(phone.sharedDocumentArchiveView().nextTryAt).toBe(0); // due now
    cloud.state.failWritesWith = REFUSAL;
    const waits: number[] = [];
    for (let refusal = 1; refusal <= 8; refusal += 1) {
      await sync(phone, cloud, 'phone', 'owner-a', { now });
      expect(cloud.writes).toHaveLength(refusal);
      const next = phone.sharedDocumentArchiveView().nextTryAt as number;
      waits.push((next - clock) / 1000);
      // Inside the wait a pass asks what is archived and sends nothing.
      clock = next - 1;
      await sync(phone, cloud, 'phone', 'owner-a', { now });
      expect(cloud.writes).toHaveLength(refusal);
      clock = next;
    }
    expect(waits).toEqual([30, 60, 120, 240, 480, 900, 900, 900]);
    // A new tap on the document is his word now: it is sent at once.
    cloud.state.failWritesWith = null;
    await phone.requestSharedDocumentArchive(PERMIT, false, '2026-10-06T19:00:00.000Z');
    await phone.requestSharedDocumentArchive(PERMIT, true, '2026-10-06T19:00:05.000Z');
    clock += 1000;
    await sync(phone, cloud, 'phone', 'owner-a', { now });
    expect(cloud.row(PERMIT)?.archived_at).toBe('2026-10-06T19:00:05.000Z');
  });

  it('no signal between the question and the write is not a refusal: it is tried at the very next pass and nothing says "refused"', async () => {
    const phone = await start('phone');
    await sync(phone, cloud, 'phone');
    await phone.requestSharedDocumentArchive(PERMIT, true, '2026-10-06T18:00:00.000Z');
    const real = cloud.clientFor('phone');
    const signalLostBeforeTheWrite = {
      auth: real.auth,
      from: () => {
        const chain = real.from() as Record<string, unknown>;
        chain.update = () => {
          chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve({
            data: null, status: 0, error: { code: '', message: 'TypeError: Network request failed' },
          }).then(resolve);
          return chain;
        };
        return chain;
      },
    };
    await phone.syncSharedDocumentArchiveWithCloud({ client: signalLostBeforeTheWrite as never, ownerId: 'owner-a', timeoutMs: 150 });
    expect([...phone.sharedDocumentArchiveView().waitingIds]).toEqual([PERMIT]);
    expect(phone.sharedDocumentArchiveView().refusedIds.size).toBe(0);
    expect(phone.sharedDocumentArchiveView().nextTryAt).toBe(0);
    await sync(phone, cloud, 'phone');
    expect(cloud.row(PERMIT)?.archived_at).toBe('2026-10-06T18:00:00.000Z');
  });
});
