/**
 * Review of D1 (independent review P5, pass 1): the archived mark on a shared
 * document (owner answer Q44, 6 Oct 2026), on two devices against a stand-in
 * for the cloud's table. The reviewer's failing cases are brought in here as
 * each is fixed; a case's name starts with the finding it answers.
 *
 * CHANGED BY THE SECOND REVIEW (P2-M1, the coordinator's decision): the cases
 * below that pinned "the latest tap wins, by each device's clock" now pin the
 * rule that replaced it: a waiting tap is sent only if the cloud's mark is
 * still what this device last knew when he tapped; otherwise the cloud's
 * state stands and a line says so. Each changed case says why beside it. The
 * cases for the new rule itself are in review-d2-archive-no-clock.test.ts.
 */
jest.mock('@react-native-async-storage/async-storage', () => require('../fixtures/shared-document-two-devices').mockDeviceStorageModule());

import { createCloud, hiddenOn, resetDevices, runRandomTaps, start, sync, tick, type Archive, type Cloud } from '../fixtures/shared-document-two-devices';

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

  // CHANGED (second review, P2-L2), here and in the cases below that move time: the waits used to be read off the
  // device's clock (`now`), and a clock that had been wrong left a refused tap unsent for as long as it had been
  // ahead. They are now counted in time the app has been running (`running`), which setting the clock does not move.
  it('F-L3: thirty refusals and the Archive is still waiting, is said to be refused, and reaches the cloud once it takes it', async () => {
    let clock = 5_000; // the app has been running five seconds
    const running = () => clock;
    const phone = await start('phone');
    await sync(phone, cloud, 'phone', 'owner-a', { running });
    await phone.requestSharedDocumentArchive(PERMIT, true, '2026-10-06T18:00:00.000Z');
    cloud.state.failWritesWith = REFUSAL;
    for (let pass = 0; pass < 30; pass += 1) {
      await sync(phone, cloud, 'phone', 'owner-a', { running });
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
    await sync(phoneLater, cloud, 'phone', 'owner-a', { running });
    expect(cloud.row(PERMIT)?.archived_at).toBe('2026-10-06T18:00:00.000Z');
    expect(phoneLater.sharedDocumentArchiveView().waitingIds.size).toBe(0);
    expect(phoneLater.sharedDocumentArchiveView().refusedIds.size).toBe(0);
    expect(phoneLater.sharedDocumentArchiveNextTryInMs(running)).toBeNull();
  });

  it('a refused write is not sent again until its wait is over: half a minute, doubling, a quarter of an hour at most', async () => {
    let clock = 5_000; // how long the app has been running
    const running = () => clock;
    const phone = await start('phone');
    await sync(phone, cloud, 'phone', 'owner-a', { running });
    await phone.requestSharedDocumentArchive(PERMIT, true, '2026-10-06T18:00:00.000Z');
    expect(phone.sharedDocumentArchiveNextTryInMs(running)).toBe(0); // due now
    cloud.state.failWritesWith = REFUSAL;
    const waits: number[] = [];
    for (let refusal = 1; refusal <= 8; refusal += 1) {
      await sync(phone, cloud, 'phone', 'owner-a', { running });
      expect(cloud.writes).toHaveLength(refusal);
      const wait = phone.sharedDocumentArchiveNextTryInMs(running) as number;
      waits.push(wait / 1000);
      // Inside the wait a pass asks what is archived and sends nothing.
      clock += wait - 1;
      await sync(phone, cloud, 'phone', 'owner-a', { running });
      expect(cloud.writes).toHaveLength(refusal);
      clock += 1;
    }
    expect(waits).toEqual([30, 60, 120, 240, 480, 900, 900, 900]);
    // A new tap on the document is his word now: it is sent at once.
    cloud.state.failWritesWith = null;
    await phone.requestSharedDocumentArchive(PERMIT, false, '2026-10-06T19:00:00.000Z');
    await phone.requestSharedDocumentArchive(PERMIT, true, '2026-10-06T19:00:05.000Z');
    clock += 1000;
    await sync(phone, cloud, 'phone', 'owner-a', { running });
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
    expect(phone.sharedDocumentArchiveNextTryInMs()).toBe(0);
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
    // CHANGED (second review, P2-L1): the line no longer says which tap came first ("after you tapped Restore here"):
    // the device cannot know that, and with one clock wrong it said it of an Archive made BEFORE his tap.
    expect(ipad.sharedDocumentArchiveNoticeText(ipad.sharedDocumentArchiveView().notices[0]))
      .toBe('Grading permit: your Restore on this device was not sent, because it was archived again on another device before this device could send it. It is still archived; tap Restore again if you still want it back.');
    // He reads it and taps OK: it is not shown again, here or after the app is closed and opened.
    await ipad.dismissSharedDocumentArchiveNotices([PERMIT]);
    expect(ipad.sharedDocumentArchiveView().notices).toEqual([]);
    await ipad.sharedDocumentArchiveSettled();
    expect((await start('ipad')).sharedDocumentArchiveView().notices).toEqual([]);
  });

  // CHANGED (second review, P2-M1). This case was "the latest tap wins the other way too: a Restore tapped on the
  // iPad after the phone's newer Archive is sent, though the iPad had not heard of it". Which tap was "after" was
  // read off two devices' clocks, and one clock a little wrong silently undid a later tap. Now no clock is asked:
  // the iPad's Restore was made against an Archive it had not heard of, so it is not sent, and the iPad says so.
  it('a Restore tapped on the iPad against an Archive it had not yet heard of is not sent: the cloud\'s state stands, the iPad says so, and a second Restore works', async () => {
    const { phone, ipad } = await setUp();
    await phone.requestSharedDocumentArchive(PERMIT, true, '2026-10-06T09:00:00.000Z');
    await sync(phone, cloud, 'phone');
    await sync(ipad, cloud, 'ipad');
    cloud.state.offline.ipad = true;
    await phone.requestSharedDocumentArchive(PERMIT, false, '2026-10-06T09:20:00.000Z');
    await sync(phone, cloud, 'phone');
    await phone.requestSharedDocumentArchive(PERMIT, true, '2026-10-06T09:30:00.000Z');
    await sync(phone, cloud, 'phone');
    // The iPad, with no signal, still shows the first Archive. He taps Restore there.
    await ipad.requestSharedDocumentArchive(PERMIT, false, '2026-10-06T09:40:00.000Z', 'Grading permit');
    cloud.state.offline.ipad = false;
    await sync(ipad, cloud, 'ipad');
    await sync(phone, cloud, 'phone');
    expect(cloud.row(PERMIT)?.archived_at).toBe('2026-10-06T09:30:00.000Z');
    expect(cloud.writes.filter(write => write.device === 'ipad')).toEqual([]);
    expect(hiddenOn(ipad)).toEqual([PERMIT]);
    expect(hiddenOn(phone)).toEqual([PERMIT]);
    expect(phone.sharedDocumentArchiveView().restoredElsewhere).toEqual([]);
    expect(ipad.sharedDocumentArchiveView().notices).toEqual([
      { documentId: PERMIT, tap: 'restore', why: 'archived_again_on_another_device', name: 'Grading permit' },
    ]);
    // He still wants it back: the iPad now shows the Archive the cloud holds, so this Restore is sent, and the line goes.
    await ipad.requestSharedDocumentArchive(PERMIT, false, '2026-10-06T09:50:00.000Z', 'Grading permit');
    expect(ipad.sharedDocumentArchiveView().notices).toEqual([]);
    await sync(ipad, cloud, 'ipad');
    expect(cloud.row(PERMIT)?.archived_at).toBeNull();
    expect(hiddenOn(ipad)).toEqual([]);
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
    expect(ipad.sharedDocumentArchiveNextTryInMs()).toBeNull();
    expect(hiddenOn(ipad)).toEqual([]);
  });

  // CHANGED (second review, P2-M1). These were two cases: "an Archive that waited while the iPad restored, tapped
  // AFTER the iPad's Restore: the phone's Archive is the latest tap and stands", and "the same, tapped BEFORE the
  // iPad's Restore: the iPad knows when it restored, sees an older archive arrive, and restores once more". Both
  // turned on comparing the phone's clock with the iPad's. Now the two orders end the same way, whatever the
  // clocks say: the cloud is no longer what the phone last knew, so its waiting Archive is let go, its card is put
  // back, and the phone says so. Nothing is "restored once more" by a device nobody tapped.
  it.each([
    ['tapped AFTER the iPad\'s Restore', '2026-10-06T09:20:00.000Z', '2026-10-06T09:30:00.000Z'],
    ['tapped BEFORE the iPad\'s Restore', '2026-10-06T09:30:00.000Z', '2026-10-06T09:20:00.000Z'],
  ])('an Archive that waited on the phone while the iPad restored, %s: it is not sent, the phone says so and puts its card back', async (_order, ipadRestoreAt, phoneArchiveAt) => {
    const { phone, ipad } = await setUp();
    await phone.requestSharedDocumentArchive(PERMIT, true, '2026-10-06T09:00:00.000Z');
    await sync(phone, cloud, 'phone');
    await sync(ipad, cloud, 'ipad');
    // The phone, with no signal: Restore (never sent), then Archive again.
    cloud.state.offline.phone = true;
    await phone.requestSharedDocumentArchive(PERMIT, false, '2026-10-06T09:10:00.000Z');
    await phone.requestSharedDocumentArchive(PERMIT, true, phoneArchiveAt, 'Grading permit.pdf');
    // The iPad restores it, with signal.
    await ipad.requestSharedDocumentArchive(PERMIT, false, ipadRestoreAt);
    await sync(ipad, cloud, 'ipad');
    await ipad.sharedDocumentArchiveSettled();
    // The phone gets signal.
    cloud.state.offline.phone = false;
    await sync(phone, cloud, 'phone');
    const ipadLater = await start('ipad');
    await sync(ipadLater, cloud, 'ipad');
    await sync(phone, cloud, 'phone');
    expect(cloud.row(PERMIT)?.archived_at).toBeNull();
    expect(cloud.writes.map(write => `${write.device}:${write.archived_at === null ? 'restore' : 'archive'}`)).toEqual(['phone:archive', 'ipad:restore']);
    expect(hiddenOn(phone)).toEqual([]);
    expect(hiddenOn(ipadLater)).toEqual([]);
    expect(phone.sharedDocumentArchiveView().restoredElsewhere).toEqual([PERMIT]); // the phone's card comes back
    expect(phone.sharedDocumentArchiveView().notices).toEqual([
      { documentId: PERMIT, tap: 'archive', why: 'restored_on_another_device', name: 'Grading permit.pdf' },
    ]);
    expect(phone.sharedDocumentArchiveNoticeText(phone.sharedDocumentArchiveView().notices[0]))
      .toBe('Grading permit.pdf: your Archive on this device was not sent, because it was restored on another device before this device could send it. It is in Documents again; archive it again if you still want it hidden.');
    expect(ipadLater.sharedDocumentArchiveView().notices).toEqual([]);
    // He still wants it hidden: a new Archive on the phone is sent and stands, whatever its clock says.
    await phone.consumeSharedDocumentsRestoredElsewhere([PERMIT]);
    await phone.requestSharedDocumentArchive(PERMIT, true, '2026-10-06T09:05:00.000Z', 'Grading permit.pdf'); // a phone whose clock runs behind
    expect(phone.sharedDocumentArchiveView().notices).toEqual([]);
    await sync(phone, cloud, 'phone');
    await sync(ipadLater, cloud, 'ipad');
    await sync(phone, cloud, 'phone');
    expect(cloud.row(PERMIT)?.archived_at).toBe('2026-10-06T09:05:00.000Z');
    expect(hiddenOn(ipadLater)).toEqual([PERMIT]);
    expect(hiddenOn(phone)).toEqual([PERMIT]);
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
    await ipad.syncSharedDocumentArchiveWithCloud({ client: real as never, ownerId: 'owner-a', timeoutMs: 150, running: () => performance.now() + 60_000 });
    expect(hiddenOn(ipad)).toEqual([PERMIT]);
    expect(ipad.sharedDocumentArchiveView().notices.map(notice => notice.tap)).toEqual(['restore']);
  });
});

describe('L4: a document deleted from the cloud while it was archived', () => {
  const archivedOnThePhone = async () => {
    const phone = await start('phone');
    await sync(phone, cloud, 'phone');
    await phone.requestSharedDocumentArchive(PERMIT, true, '2026-10-06T18:00:00.000Z', 'Grading permit.pdf');
    await sync(phone, cloud, 'phone');
    expect(cloud.row(PERMIT)?.archived_at).toBeTruthy();
    await phone.sharedDocumentArchiveSettled();
  };
  const cardAfter = (archive: Archive) => archive.withArchivedProjectDocumentsRestored(
    [{ id: PERMIT, referenceDocumentId: PERMIT, isArchived: true }], archive.sharedDocumentArchiveView().restoredElsewhere)[0];

  it('F-L4: it is not "restored on another device": the phone is not told to put its card back', async () => {
    await archivedOnThePhone();
    // The phone is closed. On a device still on Build 230 (which lists it) he deletes it from all devices.
    cloud.remove(PERMIT);

    const phoneNextDay = await start('phone');
    await sync(phoneNextDay, cloud, 'phone');
    expect(cardAfter(phoneNextDay).isArchived).toBe(true); // the archived card of a deleted document stays put away
    expect(phoneNextDay.sharedDocumentArchiveView().restoredElsewhere).toEqual([]);
    expect(hiddenOn(phoneNextDay)).toEqual([]); // the cloud's list no longer holds it
    // It asked the cloud about that one document, and was told there is no such row.
    expect(cloud.reads.filter(read => read.id === PERMIT)).toHaveLength(1);
  });

  it('sound: told live (the phone was open), the same deletion puts no card back', async () => {
    const phone = await start('phone');
    await sync(phone, cloud, 'phone');
    await phone.requestSharedDocumentArchive(PERMIT, true, '2026-10-06T18:00:00.000Z');
    await sync(phone, cloud, 'phone');
    cloud.remove(PERMIT);
    await phone.noteSharedDocumentArchiveLiveRow({ ownerId: 'owner-a', eventType: 'DELETE', newRow: null, oldRow: { id: PERMIT } });
    await sync(phone, cloud, 'phone');
    expect(phone.sharedDocumentArchiveView().restoredElsewhere).toEqual([]);
  });

  it('a Restore made on another device is still a Restore: the row is there with its mark emptied, and the card is put back', async () => {
    await archivedOnThePhone();
    cloud.row(PERMIT)!.archived_at = null; // restored on the iPad
    const phoneNextDay = await start('phone');
    await sync(phoneNextDay, cloud, 'phone');
    expect(phoneNextDay.sharedDocumentArchiveView().restoredElsewhere).toEqual([PERMIT]);
    expect(cardAfter(phoneNextDay).isArchived).toBe(false);
  });

  it('the device\'s own deletion history already holds it: nothing more is asked', async () => {
    await archivedOnThePhone();
    cloud.remove(PERMIT);
    const phoneNextDay = await start('phone');
    await sync(phoneNextDay, cloud, 'phone', 'owner-a', { deletedDocumentIds: async () => [PERMIT] });
    expect(phoneNextDay.sharedDocumentArchiveView().restoredElsewhere).toEqual([]);
    expect(hiddenOn(phoneNextDay)).toEqual([]);
    expect(cloud.reads.filter(read => read.id === PERMIT)).toEqual([]);
  });

  it('when the cloud cannot be asked which it was, nothing is decided: it stays hidden, and the next pass decides', async () => {
    await archivedOnThePhone();
    cloud.row(PERMIT)!.archived_at = null; // restored on the iPad
    const phoneNextDay = await start('phone');
    const real = cloud.clientFor('phone');
    let questions = 0;
    const signalLostAfterTheFirstQuestion = {
      auth: real.auth,
      from: () => {
        questions += 1;
        if (questions === 1) return real.from();
        const chain: Record<string, unknown> = {};
        for (const method of ['select', 'eq', 'not', 'is', 'update']) chain[method] = () => chain;
        chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ data: null, status: 0, error: { code: '', message: 'TypeError: Network request failed' } }).then(resolve);
        return chain;
      },
    };
    await phoneNextDay.syncSharedDocumentArchiveWithCloud({ client: signalLostAfterTheFirstQuestion as never, ownerId: 'owner-a', timeoutMs: 150 });
    expect(hiddenOn(phoneNextDay)).toEqual([PERMIT]);
    expect(phoneNextDay.sharedDocumentArchiveView().restoredElsewhere).toEqual([]);
    await sync(phoneNextDay, cloud, 'phone');
    expect(hiddenOn(phoneNextDay)).toEqual([]);
    expect(phoneNextDay.sharedDocumentArchiveView().restoredElsewhere).toEqual([PERMIT]);
  });

  // CHANGED (second review, P2-L4). This case waited for the phone's deletion history to learn of the deletion, and
  // until then the Archive was tried again and again ("the cloud has no such row, and the Archive waits"). A phone
  // whose history never learns of it tried for ever. Now the cloud's own answer is enough: no such row, and nothing
  // of the document waiting on this phone to go up. The line's last sentence about the card is gone too: what
  // becomes of the card later is not the line's to promise.
  it('an Archive still waiting for a document that has been deleted from all devices is let go, with a line, and not tried for ever', async () => {
    const phone = await start('phone');
    await sync(phone, cloud, 'phone');
    cloud.state.offline.phone = true;
    await phone.requestSharedDocumentArchive(PERMIT, true, '2026-10-06T18:00:00.000Z', 'Grading permit.pdf');
    cloud.remove(PERMIT); // deleted from all devices on the iPad
    cloud.state.offline.phone = false;
    // The phone has not heard of the deletion (its history does not hold it). The cloud says there is no such row.
    await sync(phone, cloud, 'phone');
    expect([...phone.sharedDocumentArchiveView().waitingIds]).toEqual([]);
    expect(phone.sharedDocumentArchiveNextTryInMs()).toBeNull();
    expect(phone.sharedDocumentArchiveView().notices).toEqual([
      { documentId: PERMIT, tap: 'archive', why: 'deleted_from_all_devices', name: 'Grading permit.pdf' },
    ]);
    expect(phone.sharedDocumentArchiveNoticeText(phone.sharedDocumentArchiveView().notices[0]))
      .toBe('Grading permit.pdf: your Archive on this device was not sent, because the document has been deleted.');
    expect(cloud.writes).toHaveLength(1); // the one try, which changed nothing
    expect(cloud.reads.filter(read => read.id === PERMIT)).toHaveLength(1); // and the one question about that row
  });

  it('the same when the phone\'s deletion history already holds it: let go before anything is sent or asked', async () => {
    const phone = await start('phone');
    await sync(phone, cloud, 'phone');
    cloud.state.offline.phone = true;
    await phone.requestSharedDocumentArchive(PERMIT, true, '2026-10-06T18:00:00.000Z', 'Grading permit.pdf');
    cloud.remove(PERMIT);
    cloud.state.offline.phone = false;
    await sync(phone, cloud, 'phone', 'owner-a', { deletedDocumentIds: () => new Set([PERMIT]) });
    expect([...phone.sharedDocumentArchiveView().waitingIds]).toEqual([]);
    expect(phone.sharedDocumentArchiveView().notices.map(notice => notice.why)).toEqual(['deleted_from_all_devices']);
    expect(cloud.writes).toEqual([]);
    expect(cloud.reads.filter(read => read.id === PERMIT)).toEqual([]);
  });
});

describe('L5: a Restore made with no signal', () => {
  it('F-L5: it is waiting to be sent, the device says so, and it is due to be tried again like an Archive', async () => {
    cloud.row(PERMIT)!.archived_at = '2026-10-06T17:00:00.000Z';
    const ipad = await start('ipad');
    await sync(ipad, cloud, 'ipad');
    cloud.state.offline.ipad = true;
    await ipad.requestSharedDocumentArchive(PERMIT, false, '2026-10-06T18:00:00.000Z', 'Grading permit');
    await sync(ipad, cloud, 'ipad');
    expect(hiddenOn(ipad)).toEqual([]); // shown on the iPad
    expect(cloud.row(PERMIT)?.archived_at).toBeTruthy(); // still hidden everywhere else
    // The device knows it, and says it: what the screen shows and what the half-minute timer follows.
    expect(ipad.sharedDocumentArchiveView().waitingRestores).toEqual([{ documentId: PERMIT, name: 'Grading permit', refused: false }]);
    expect(ipad.sharedDocumentArchiveNextTryInMs()).toBe(0);
    await ipad.sharedDocumentArchiveSettled();

    // Kept through closing the app; sent when the iPad has signal; then nothing waits.
    const ipadLater = await start('ipad');
    expect(ipadLater.sharedDocumentArchiveView().waitingRestores.map(waiting => waiting.documentId)).toEqual([PERMIT]);
    cloud.state.offline.ipad = false;
    await sync(ipadLater, cloud, 'ipad');
    expect(cloud.row(PERMIT)?.archived_at).toBeNull();
    expect(ipadLater.sharedDocumentArchiveView().waitingRestores).toEqual([]);
    expect(ipadLater.sharedDocumentArchiveNextTryInMs()).toBeNull();
  });

  it('tapped with signal it is sent at once and is never said to be waiting', async () => {
    cloud.row(PERMIT)!.archived_at = '2026-10-06T17:00:00.000Z';
    const ipad = await start('ipad');
    await sync(ipad, cloud, 'ipad');
    const said: number[] = [];
    const stop = ipad.subscribeSharedDocumentArchive(() => { said.push(ipad.sharedDocumentArchiveView().waitingRestores.length); });
    await ipad.requestSharedDocumentArchive(PERMIT, false, '2026-10-06T18:00:00.000Z', 'Grading permit');
    await sync(ipad, cloud, 'ipad');
    stop();
    expect(cloud.row(PERMIT)?.archived_at).toBeNull();
    expect(said.every(count => count === 0)).toBe(true);
  });

  it('a Restore the cloud has refused says so too', async () => {
    cloud.row(PERMIT)!.archived_at = '2026-10-06T17:00:00.000Z';
    const ipad = await start('ipad');
    await sync(ipad, cloud, 'ipad');
    cloud.state.failWritesWith = { code: '', message: 'upstream connect error or disconnect/reset before headers' };
    await ipad.requestSharedDocumentArchive(PERMIT, false, '2026-10-06T18:00:00.000Z', 'Grading permit');
    await sync(ipad, cloud, 'ipad');
    expect(ipad.sharedDocumentArchiveView().waitingRestores).toEqual([{ documentId: PERMIT, name: 'Grading permit', refused: true }]);
    expect(ipad.sharedDocumentRestoreWaitingText({ documentId: PERMIT, name: 'Grading permit', refused: false }))
      // CHANGED (second review, P2-L6 and P2-M1): it says where the document is back ("in Documents on this device") and
      // no longer promises the other devices will show it: a Restore can now be let go if it was archived again elsewhere.
      .toBe('Grading permit: back in Documents on this device. Waiting to reach the cloud: your other devices show it again once it has.');
    expect(ipad.sharedDocumentRestoreWaitingText({ documentId: PERMIT, name: 'Grading permit', refused: true }))
      .toBe('Grading permit: back in Documents on this device only, for now: the cloud has not accepted this yet. This device keeps trying.');
  });
});

describe('L6: the data API has not yet reloaded after the paste (a write is answered "column not in the schema cache", a read is answered)', () => {
  it('F-L6: what the cloud just said is archived is not forgotten, the mark stays "installed", and the waiting Archive is tried again', async () => {
    cloud.add('doc-contract');
    cloud.row('doc-contract')!.archived_at = '2026-10-06T12:00:00.000Z'; // archived from the iPad
    const phone = await start('phone');
    await sync(phone, cloud, 'phone');
    cloud.state.offline.phone = true;
    await phone.requestSharedDocumentArchive(PERMIT, true, '2026-10-06T18:00:00.000Z');
    cloud.state.offline.phone = false;
    // The read is answered (the column exists); the write is answered PGRST204 (the API's cache is old).
    const realClient = cloud.clientFor('phone');
    const staleCacheClient = {
      auth: realClient.auth,
      from: () => {
        const chain = realClient.from() as Record<string, unknown>;
        const update = chain.update as (values: unknown) => unknown;
        chain.update = (values: unknown) => {
          update(values);
          chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve({
            data: null, status: 400,
            error: { code: 'PGRST204', message: "Could not find the 'archived_at' column of 'reference_documents' in the schema cache" },
          }).then(resolve);
          return chain;
        };
        return chain;
      },
    };
    let clock = 10_000; // how long the app has been running
    await expect(phone.syncSharedDocumentArchiveWithCloud({ client: staleCacheClient as never, ownerId: 'owner-a', timeoutMs: 150, running: () => clock }))
      .resolves.toBe('installed');
    expect(hiddenOn(phone)).toEqual(['doc-contract', PERMIT]); // the iPad's archived document stays hidden here
    expect(phone.sharedDocumentArchiveView().installed).toBe(true);
    expect([...phone.sharedDocumentArchiveView().waitingIds]).toEqual([PERMIT]);
    expect(cloud.row(PERMIT)?.archived_at).toBeNull();

    // Half a minute later the API has caught up: the Archive goes up.
    clock += 31_000;
    await phone.syncSharedDocumentArchiveWithCloud({ client: realClient as never, ownerId: 'owner-a', timeoutMs: 150, running: () => clock });
    expect(cloud.row(PERMIT)?.archived_at).toBe('2026-10-06T18:00:00.000Z');
    expect(hiddenOn(phone)).toEqual(['doc-contract', PERMIT]);
    expect(phone.sharedDocumentArchiveView().waitingIds.size).toBe(0);
  });

  it('the question itself answered "no such column" is still what says the mark is not installed', async () => {
    cloud.row(PERMIT)!.archived_at = '2026-10-06T12:00:00.000Z';
    const ipad = await start('ipad');
    await sync(ipad, cloud, 'ipad');
    expect(hiddenOn(ipad)).toEqual([PERMIT]);
    cloud.state.installed = false; // the database change undone
    await expect(sync(ipad, cloud, 'ipad')).resolves.toBe('not_installed');
    expect(ipad.sharedDocumentArchiveView().installed).toBe(false);
    expect(hiddenOn(ipad)).toEqual([]);
  });
});

/**
 * The reviewer's random sequences on two devices, compared with his taps in
 * order (the generator is his, step for step and seed for seed; it is in the
 * fixture since his second pass).
 *
 * CHANGED (second review, P2-M1). These two cases used to require that every
 * sequence "ends as his last tap left it". That was the promise of the clock
 * rule, and it only held while both clocks were right. The rule now is: the
 * cloud ends as the last tap to REACH it asked, and a tap that did not take
 * effect leaves a line on the device it was made on. So a sequence may end
 * different from his last tap, but never without that line, and every device
 * always ends showing what the cloud holds.
 */
describe('L2: the reviewer\'s random sequences on two devices, compared with his taps in order', () => {
  it.each([
    ['both devices with signal throughout', false],
    ['with signal coming and going (F-L2)', true],
  ])('%s, 300 sequences: none ends different from his last tap without a line on the device whose tap was not sent', async (_label, signalDrops) => {
    const silent: string[] = [];
    const unsettled: number[] = [];
    let differ = 0;
    for (let seed = 1; seed <= 300; seed += 1) {
      const { differs, settled, log } = await runRandomTaps(seed, { signalDrops });
      if (!settled) unsettled.push(seed);
      if (differs.length) differ += 1;
      const untold = differs.filter(item => !item.toldWhereHeTapped);
      if (untold.length) silent.push(`seed ${seed}: ${untold.map(item => item.text).join('; ')}\n    ${log.join(' | ')}`);
    }
    // eslint-disable-next-line no-console
    if (silent.length) console.log(`${silent.length} of 300 sequences end different from his last tap with no line where he tapped. The shortest:\n` +
      [...silent].sort((a, b) => a.length - b.length).slice(0, 4).join('\n'));
    expect({ silent: silent.length, unsettled }).toEqual({ silent: 0, unsettled: [] });
    expect(differ).toBeLessThan(40); // told each time; it is not the common case
  }, 120_000);
});
