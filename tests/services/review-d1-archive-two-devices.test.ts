/**
 * Review of D1 (independent review P5, pass 1): the archived mark on a shared
 * document (owner answer Q44, 6 Oct 2026), on two devices against a stand-in
 * for the cloud's table. The reviewer's failing cases are brought in here as
 * each is fixed; a case's name starts with the finding it answers.
 */
jest.mock('@react-native-async-storage/async-storage', () => require('../fixtures/shared-document-two-devices').mockDeviceStorageModule());

import { createCloud, hiddenOn, resetDevices, start, sync, tick, type Archive, type Cloud, type DeviceName } from '../fixtures/shared-document-two-devices';

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

describe('L8: one phone, a slow connection, and he changes his mind before the cloud has answered', () => {
  it('F-L8: Archive, then Restore before the Archive has been answered: the document stays restored', async () => {
    const phone = await start('phone');
    await sync(phone, cloud, 'phone');

    // He taps Archive. The app records it and starts telling the cloud.
    cloud.state.holdWrites = true;
    await phone.requestSharedDocumentArchive(PERMIT, true, '2026-10-06T18:00:00.000Z');
    const firstPass = sync(phone, cloud, 'phone');
    await tick(); // the write is on its way and not answered yet

    // He sees it was the wrong document, opens "Archived (1)" and taps Restore.
    await phone.requestSharedDocumentArchive(PERMIT, false, '2026-10-06T18:00:02.000Z');
    expect(hiddenOn(phone)).toEqual([]); // back in the list at once
    const secondPass = sync(phone, cloud, 'phone');

    cloud.release();
    await firstPass;
    await secondPass;
    await sync(phone, cloud, 'phone');

    // His last word was Restore, and the taps went to the cloud in the order he made them.
    expect({ cloudMark: cloud.row(PERMIT)?.archived_at, hiddenOnPhone: hiddenOn(phone) })
      .toEqual({ cloudMark: null, hiddenOnPhone: [] });
    expect(cloud.writes.map(write => write.archived_at)).toEqual(['2026-10-06T18:00:00.000Z', null]);
    expect(phone.sharedDocumentArchiveView().notices).toEqual([]);
  });

  it('F-L8 (the mirror): Restore, then Archive before the Restore has been answered: the document stays archived, its card with it', async () => {
    cloud.row(PERMIT)!.archived_at = '2026-10-06T17:00:00.000Z';
    const phone = await start('phone');
    await sync(phone, cloud, 'phone');
    expect(hiddenOn(phone)).toEqual([PERMIT]);

    cloud.state.holdWrites = true;
    await phone.requestSharedDocumentArchive(PERMIT, false, '2026-10-06T18:00:00.000Z');
    const firstPass = sync(phone, cloud, 'phone');
    await tick();
    await phone.requestSharedDocumentArchive(PERMIT, true, '2026-10-06T18:00:02.000Z');
    const secondPass = sync(phone, cloud, 'phone');
    cloud.release();
    await firstPass;
    await secondPass;
    await sync(phone, cloud, 'phone');

    // His last word was Archive: marked in the cloud, hidden here, and the phone is not told "restored on another device".
    expect({
      cloudArchived: cloud.row(PERMIT)?.archived_at, hiddenOnPhone: hiddenOn(phone),
      cardPutBack: phone.sharedDocumentArchiveView().restoredElsewhere,
    }).toEqual({ cloudArchived: '2026-10-06T18:00:02.000Z', hiddenOnPhone: [PERMIT], cardPutBack: [] });
  });

  it('a write that landed but whose answer was lost, and then the opposite tap: the opposite tap is what the cloud ends with', async () => {
    const phone = await start('phone');
    await sync(phone, cloud, 'phone');
    await phone.requestSharedDocumentArchive(PERMIT, true, '2026-10-06T18:00:00.000Z');
    // The Archive reaches the cloud; its answer never comes back (the request times out on the phone).
    const real = cloud.clientFor('phone');
    const answerLost = {
      auth: real.auth,
      from: () => {
        const chain = real.from() as Record<string, unknown>;
        const update = chain.update as (values: unknown) => unknown;
        const then = chain.then as (resolve: (value: unknown) => unknown) => Promise<unknown>;
        chain.update = (values: unknown) => {
          update(values);
          chain.then = () => then(() => undefined).then(() => new Promise(() => undefined)); // lands, never answers
          return chain;
        };
        return chain;
      },
    };
    await phone.syncSharedDocumentArchiveWithCloud({ client: answerLost as never, ownerId: 'owner-a', timeoutMs: 50 });
    expect(cloud.row(PERMIT)?.archived_at).toBe('2026-10-06T18:00:00.000Z');
    expect([...phone.sharedDocumentArchiveView().waitingIds]).toEqual([PERMIT]); // the phone does not know it landed

    await phone.requestSharedDocumentArchive(PERMIT, false, '2026-10-06T18:00:30.000Z');
    await sync(phone, cloud, 'phone');
    expect(cloud.row(PERMIT)?.archived_at).toBeNull();
    expect(hiddenOn(phone)).toEqual([]);
    expect(phone.sharedDocumentArchiveView().restoredElsewhere).toEqual([]);
  });
});

describe('L2: a tap made with no signal and a newer tap made on another device', () => {
  const setUp = async () => {
    const phone = await start('phone');
    const ipad = await start('ipad');
    await sync(phone, cloud, 'phone');
    await sync(ipad, cloud, 'ipad');
    return { phone, ipad };
  };

  it('F-L2 (the reviewer\'s shortest, seed 48): the iPad\'s old Restore does not undo the phone\'s newer Archive, and the iPad says so', async () => {
    const { phone, ipad } = await setUp();
    // 1. Phone: Archive. The iPad sees it under Archived.
    await phone.requestSharedDocumentArchive(PERMIT, true, '2026-10-06T09:00:00.000Z');
    await sync(phone, cloud, 'phone');
    await sync(ipad, cloud, 'ipad');
    expect(hiddenOn(ipad)).toEqual([PERMIT]);
    // 2. The iPad loses signal. iPad: Restore (it waits).
    cloud.state.offline.ipad = true;
    await ipad.requestSharedDocumentArchive(PERMIT, false, '2026-10-06T09:10:00.000Z', 'Grading permit');
    await sync(ipad, cloud, 'ipad');
    // 3. Phone: Restore, then later Archive again. This is his last word.
    await phone.requestSharedDocumentArchive(PERMIT, false, '2026-10-06T09:20:00.000Z');
    await sync(phone, cloud, 'phone');
    await phone.requestSharedDocumentArchive(PERMIT, true, '2026-10-06T09:30:00.000Z');
    await sync(phone, cloud, 'phone');
    // 4. The iPad gets signal.
    cloud.state.offline.ipad = false;
    await sync(ipad, cloud, 'ipad');
    await sync(phone, cloud, 'phone');

    expect(cloud.row(PERMIT)?.archived_at).toBe('2026-10-06T09:30:00.000Z');
    expect(cloud.writes.filter(write => write.device === 'ipad')).toEqual([]); // the old Restore was never sent
    expect(hiddenOn(ipad)).toEqual([PERMIT]);
    expect(hiddenOn(phone)).toEqual([PERMIT]);
    expect(phone.sharedDocumentArchiveView().restoredElsewhere).toEqual([]);
    // Dropped, with a line saying so.
    expect(ipad.sharedDocumentArchiveView().notices).toEqual([
      { documentId: PERMIT, tap: 'restore', why: 'archived_again_on_another_device', name: 'Grading permit' },
    ]);
    expect(ipad.sharedDocumentArchiveNoticeText(ipad.sharedDocumentArchiveView().notices[0]))
      .toBe('Grading permit: your Restore on this device was not sent. It was archived again on another device after you tapped Restore here, so it stays archived.');
    // He reads it and taps OK: it is not shown again, here or after the app is closed and opened.
    await ipad.dismissSharedDocumentArchiveNotices([PERMIT]);
    expect(ipad.sharedDocumentArchiveView().notices).toEqual([]);
    await ipad.sharedDocumentArchiveSettled();
    expect((await start('ipad')).sharedDocumentArchiveView().notices).toEqual([]);
  });

  it('the latest tap wins the other way too: a Restore tapped on the iPad after the phone\'s newer Archive is sent, though the iPad had not heard of it', async () => {
    const { phone, ipad } = await setUp();
    await phone.requestSharedDocumentArchive(PERMIT, true, '2026-10-06T09:00:00.000Z');
    await sync(phone, cloud, 'phone');
    await sync(ipad, cloud, 'ipad');
    cloud.state.offline.ipad = true;
    await phone.requestSharedDocumentArchive(PERMIT, false, '2026-10-06T09:20:00.000Z');
    await sync(phone, cloud, 'phone');
    await phone.requestSharedDocumentArchive(PERMIT, true, '2026-10-06T09:30:00.000Z');
    await sync(phone, cloud, 'phone');
    // The iPad, with no signal, still shows the first Archive. He taps Restore there: his last word.
    await ipad.requestSharedDocumentArchive(PERMIT, false, '2026-10-06T09:40:00.000Z', 'Grading permit');
    cloud.state.offline.ipad = false;
    await sync(ipad, cloud, 'ipad');
    await sync(phone, cloud, 'phone');
    expect(cloud.row(PERMIT)?.archived_at).toBeNull();
    expect(hiddenOn(ipad)).toEqual([]);
    expect(hiddenOn(phone)).toEqual([]);
    expect(phone.sharedDocumentArchiveView().restoredElsewhere).toEqual([PERMIT]); // the phone puts its card back
    expect(ipad.sharedDocumentArchiveView().notices).toEqual([]);
  });

  it('the cloud already says what the waiting tap asked for: nothing is sent and nothing needs saying', async () => {
    const { phone, ipad } = await setUp();
    await phone.requestSharedDocumentArchive(PERMIT, true, '2026-10-06T09:00:00.000Z');
    await sync(phone, cloud, 'phone');
    await sync(ipad, cloud, 'ipad');
    cloud.state.offline.ipad = true;
    await ipad.requestSharedDocumentArchive(PERMIT, false, '2026-10-06T09:10:00.000Z');
    await phone.requestSharedDocumentArchive(PERMIT, false, '2026-10-06T09:20:00.000Z');
    await sync(phone, cloud, 'phone');
    cloud.state.offline.ipad = false;
    await sync(ipad, cloud, 'ipad');
    expect(cloud.writes.filter(write => write.device === 'ipad')).toEqual([]);
    expect(ipad.sharedDocumentArchiveView().notices).toEqual([]);
    expect(ipad.sharedDocumentArchiveView().nextTryAt).toBeNull();
    expect(hiddenOn(ipad)).toEqual([]);
  });

  it('an Archive that waited while the iPad restored, tapped AFTER the iPad\'s Restore: the phone\'s Archive is the latest tap and stands', async () => {
    const { phone, ipad } = await setUp();
    await phone.requestSharedDocumentArchive(PERMIT, true, '2026-10-06T09:00:00.000Z');
    await sync(phone, cloud, 'phone');
    await sync(ipad, cloud, 'ipad');
    // The phone, with no signal: Restore (never sent).
    cloud.state.offline.phone = true;
    await phone.requestSharedDocumentArchive(PERMIT, false, '2026-10-06T09:10:00.000Z');
    // The iPad restores it.
    await ipad.requestSharedDocumentArchive(PERMIT, false, '2026-10-06T09:20:00.000Z');
    await sync(ipad, cloud, 'ipad');
    // The phone, still with no signal: Archive. His last word.
    await phone.requestSharedDocumentArchive(PERMIT, true, '2026-10-06T09:30:00.000Z');
    cloud.state.offline.phone = false;
    await sync(phone, cloud, 'phone');
    await sync(ipad, cloud, 'ipad');
    await sync(phone, cloud, 'phone');
    expect(cloud.row(PERMIT)?.archived_at).toBe('2026-10-06T09:30:00.000Z'); // the time he tapped, not the time it arrived
    expect(hiddenOn(phone)).toEqual([PERMIT]);
    expect(hiddenOn(ipad)).toEqual([PERMIT]);
    expect(phone.sharedDocumentArchiveView().restoredElsewhere).toEqual([]);
  });

  it('the same, tapped BEFORE the iPad\'s Restore: the iPad knows when it restored, sees an older archive arrive, and restores once more', async () => {
    const { phone, ipad } = await setUp();
    await phone.requestSharedDocumentArchive(PERMIT, true, '2026-10-06T09:00:00.000Z');
    await sync(phone, cloud, 'phone');
    await sync(ipad, cloud, 'ipad');
    // The phone, with no signal: Restore, then Archive again (neither is sent yet).
    cloud.state.offline.phone = true;
    await phone.requestSharedDocumentArchive(PERMIT, false, '2026-10-06T09:10:00.000Z');
    await phone.requestSharedDocumentArchive(PERMIT, true, '2026-10-06T09:20:00.000Z');
    // The iPad restores it, later than both. His last word.
    await ipad.requestSharedDocumentArchive(PERMIT, false, '2026-10-06T09:30:00.000Z');
    await sync(ipad, cloud, 'ipad');
    await ipad.sharedDocumentArchiveSettled();
    // The phone gets signal: its Archive of 09:20 reaches the cloud, late.
    cloud.state.offline.phone = false;
    await sync(phone, cloud, 'phone');
    expect(cloud.row(PERMIT)?.archived_at).toBe('2026-10-06T09:20:00.000Z');
    // The iPad is opened again: the archive it reads is older than its own Restore, so it restores once more.
    const ipadLater = await start('ipad');
    await sync(ipadLater, cloud, 'ipad');
    expect(cloud.row(PERMIT)?.archived_at).toBeNull();
    expect(hiddenOn(ipadLater)).toEqual([]);
    await sync(phone, cloud, 'phone');
    expect(hiddenOn(phone)).toEqual([]);
    expect(phone.sharedDocumentArchiveView().restoredElsewhere).toEqual([PERMIT]); // the phone's card comes back
    // Once only: a new Archive made after that stands.
    await phone.consumeSharedDocumentsRestoredElsewhere([PERMIT]);
    await phone.requestSharedDocumentArchive(PERMIT, true, '2026-10-06T09:25:00.000Z'); // a phone whose clock runs behind
    await sync(phone, cloud, 'phone');
    await sync(ipadLater, cloud, 'ipad');
    expect(cloud.row(PERMIT)?.archived_at).toBe('2026-10-06T09:25:00.000Z');
    expect(hiddenOn(ipadLater)).toEqual([PERMIT]);
  });

  it('the write itself is guarded: a mark that changes between the question and the write is not written over', async () => {
    const { phone, ipad } = await setUp();
    await phone.requestSharedDocumentArchive(PERMIT, true, '2026-10-06T09:00:00.000Z');
    await sync(phone, cloud, 'phone');
    await sync(ipad, cloud, 'ipad');
    await ipad.requestSharedDocumentArchive(PERMIT, false, '2026-10-06T09:10:00.000Z', 'Grading permit');
    // Between the iPad's question and its write, the phone restores and archives again.
    const real = cloud.clientFor('ipad');
    const overtaken = {
      auth: real.auth,
      from: () => {
        const chain = real.from() as Record<string, unknown>;
        const update = chain.update as (values: unknown) => unknown;
        chain.update = (values: unknown) => { cloud.row(PERMIT)!.archived_at = '2026-10-06T09:30:00.000Z'; return update(values); };
        return chain;
      },
    };
    await ipad.syncSharedDocumentArchiveWithCloud({ client: overtaken as never, ownerId: 'owner-a', timeoutMs: 150 });
    expect(cloud.row(PERMIT)?.archived_at).toBe('2026-10-06T09:30:00.000Z'); // not emptied
    expect(cloud.writes.filter(write => write.device === 'ipad').map(write => write.changed)).toEqual([0]);
    // At its next pass the iPad sees the newer Archive and lets its Restore go, with the line.
    await ipad.syncSharedDocumentArchiveWithCloud({ client: real as never, ownerId: 'owner-a', timeoutMs: 150, now: () => Date.now() + 60_000 });
    expect(hiddenOn(ipad)).toEqual([PERMIT]);
    expect(ipad.sharedDocumentArchiveView().notices.map(notice => notice.tap)).toEqual(['restore']);
  });
});

/**
 * The reviewer's random sequences on two devices, compared with one device
 * doing the same taps in order. The owner's taps are numbered in the order he
 * made them; the document's right final state is his last tap on it. Each
 * device only offers the tap its own screen would offer (Archive on the
 * phone, which holds the card, when it lists the document; Restore where
 * "Archived (n)" lists it).
 *
 * The generator is his, step for step and seed for seed. One thing is added,
 * which the coordinator's decision on L9 requires: each device reaches the
 * cloud once before the first tap (a tap made by a device that has never had
 * an answer is, by that decision, that device's own and is not sent).
 */
function random(seed: number) {
  let state = seed >>> 0;
  return () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 0x100000000; };
}

async function runSequence(seed: number, { signalDrops }: { signalDrops: boolean }) {
  resetDevices();
  const world = createCloud();
  const docs = ['doc-1', 'doc-2'];
  docs.forEach(id => world.add(id));
  const next = random(seed);
  const devices: Record<DeviceName, Archive> = { phone: await start('phone'), ipad: await start('ipad') };
  /** The phone's own cards (the iPad has none). */
  const card: Record<string, boolean> = { 'doc-1': false, 'doc-2': false }; // isArchived
  const lastTap: Record<string, 'archive' | 'restore' | null> = { 'doc-1': null, 'doc-2': null };
  const log: string[] = [];
  let clock = Date.parse('2026-10-06T08:00:00.000Z');
  const at = () => new Date(clock += 60_000).toISOString();

  const heard = async (name: DeviceName) => {
    // The hook's effect: a document restored elsewhere has its card put back on the phone.
    const ids = devices[name].sharedDocumentArchiveView().restoredElsewhere;
    if (ids.length === 0) return;
    if (name === 'phone') ids.forEach(id => { if (id in card) card[id] = false; });
    await devices[name].consumeSharedDocumentsRestoredElsewhere(ids);
  };
  const reach = async (name: DeviceName) => {
    if (world.state.offline[name]) return;
    await sync(devices[name], world, name, 'owner-a', { now: () => clock });
    await heard(name);
  };
  const archivedOn = (name: DeviceName, id: string) =>
    devices[name].sharedDocumentArchiveView().archivedIds.has(id) || (name === 'phone' && card[id]);

  await reach('phone'); // each device has been opened with signal once (see above)
  await reach('ipad');
  for (let step = 0; step < 14; step += 1) {
    const name: DeviceName = next() < 0.5 ? 'phone' : 'ipad';
    const id = docs[Math.floor(next() * docs.length)];
    const roll = next();
    if (signalDrops && roll < 0.25) {
      world.state.offline[name] = !world.state.offline[name];
      log.push(`${name} ${world.state.offline[name] ? 'loses signal' : 'has signal again'}`);
      await reach(name);
    } else if (roll < 0.4) {
      await devices[name].sharedDocumentArchiveSettled();
      devices[name] = await start(name);
      log.push(`${name} is closed and opened`);
      await reach(name);
    } else if (archivedOn(name, id)) {
      if (name === 'phone') card[id] = false;
      await devices[name].requestSharedDocumentArchive(id, false, at());
      lastTap[id] = 'restore';
      log.push(`${name} Restore ${id}`);
      await reach(name);
    } else if (name === 'phone') {
      card[id] = true;
      await devices[name].requestSharedDocumentArchive(id, true, at());
      lastTap[id] = 'archive';
      log.push(`phone Archive ${id}`);
      await reach(name);
    } else {
      log.push(`ipad opens Documents`);
      await reach(name);
    }
  }
  // Everything has signal again and each device is opened twice.
  world.state.offline.phone = false;
  world.state.offline.ipad = false;
  clock += 60 * 60_000;
  for (const name of ['phone', 'ipad', 'phone', 'ipad'] as const) await reach(name);
  const dropped = (devices.phone.sharedDocumentArchiveView().notices ?? []).length + (devices.ipad.sharedDocumentArchiveView().notices ?? []).length;

  const wrong = docs.flatMap(id => {
    if (lastTap[id] === null) return [];
    const want = lastTap[id] === 'archive';
    const got = { cloud: Boolean(world.row(id)?.archived_at), phone: archivedOn('phone', id), ipad: archivedOn('ipad', id) };
    return got.cloud === want && got.phone === want && got.ipad === want
      ? [] : [`${id}: his last tap was ${lastTap[id]}; cloud archived=${got.cloud}, phone hides it=${got.phone}, iPad hides it=${got.ipad}`];
  });
  return { wrong, log, dropped };
}

describe('L2: the reviewer\'s random sequences on two devices, compared with his taps in order', () => {
  it('sound: both devices with signal throughout, 300 sequences: every one ends as his last tap left it', async () => {
    const failures: string[] = [];
    for (let seed = 1; seed <= 300; seed += 1) {
      const { wrong, log } = await runSequence(seed, { signalDrops: false });
      if (wrong.length) failures.push(`seed ${seed}: ${wrong.join('; ')}\n    ${log.join(' | ')}`);
    }
    expect(failures.slice(0, 3)).toEqual([]);
  }, 120_000);

  it('F-L2: with signal coming and going, 300 sequences: every one ends as his last tap left it', async () => {
    const failures: string[] = [];
    for (let seed = 1; seed <= 300; seed += 1) {
      const { wrong, log } = await runSequence(seed, { signalDrops: true });
      if (wrong.length) failures.push(`seed ${seed}: ${wrong.join('; ')}\n    ${log.join(' | ')}`);
    }
    // eslint-disable-next-line no-console
    if (failures.length) console.log(`F-L2: ${failures.length} of 300 sequences end wrong. The shortest:\n` +
      [...failures].sort((a, b) => a.length - b.length).slice(0, 4).join('\n'));
    expect(failures.length).toBe(0);
  }, 120_000);
});
