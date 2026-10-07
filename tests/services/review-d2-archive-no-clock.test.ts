/**
 * Second review of the archive change (independent review P5, pass 2, of the
 * fixes for D1; owner answer Q44, 6 Oct 2026: an archived compliance document
 * is hidden on every device and kept in the cloud).
 *
 * P2-M1 (medium): "the latest tap wins" was decided by each device's own
 * clock, and one clock a little wrong silently undid a later tap, with signal
 * on both devices throughout. The coordinator's decision: no device clock
 * anywhere in the decision. A waiting Archive or Restore is sent only if the
 * cloud's mark for that document is still what this device last knew when he
 * tapped; if it is not, the cloud's state stands, the waiting tap is let go,
 * and a line on that device says so, with what the document's state now is.
 *
 * The reviewer's failing cases are brought in here ("P2-M1 (a)", "(b)" and
 * his tables), on his own stand-in for the cloud (tests/fixtures/
 * shared-document-two-devices.ts), with the cases for the rule itself.
 */
jest.mock('@react-native-async-storage/async-storage', () => require('../fixtures/shared-document-two-devices').mockDeviceStorageModule());

import {
  apiTime, createCloud, deviceStorage, hiddenOn, resetDevices, runRandomTaps, start, sync,
  type Cloud, type DeviceName,
} from '../fixtures/shared-document-two-devices';

const PERMIT = 'doc-permit';
const T = (clock: string) => `2026-10-06T${clock}Z`;
const archivedInCloud = (world: Cloud, id: string) => Boolean(world.row(id)?.archived_at);
const savedRecord = (name: DeviceName, ownerId = 'owner-a') => {
  const raw = [...deviceStorage[name].values()][0];
  return (raw ? JSON.parse(raw).owners?.[ownerId] ?? {} : {}) as Record<string, unknown> & { waiting?: Array<Record<string, unknown>> };
};

let cloud: Cloud;
beforeEach(() => {
  resetDevices();
  cloud = createCloud();
  cloud.add(PERMIT);
});

describe('P2-M1: no device\'s clock decides whose tap counts', () => {
  /** The reviewer's steps: the iPad restores, and afterwards the phone archives again. The phone's Archive is his last tap, and the last to reach the cloud. */
  async function ipadRestoresThenPhoneArchives(phoneClockOffsetMinutes: number, ipadClockOffsetMinutes: number) {
    const stamp = (trueClock: string, offsetMinutes: number) => new Date(Date.parse(T(trueClock)) + offsetMinutes * 60_000).toISOString();
    const phone = await start('phone');
    const ipad = await start('ipad');
    await sync(phone, cloud, 'phone');
    await phone.requestSharedDocumentArchive(PERMIT, true, stamp('09:00:00.000', phoneClockOffsetMinutes));
    await sync(phone, cloud, 'phone');
    await sync(ipad, cloud, 'ipad');
    // 10:00 iPad: Restore (with signal).
    await ipad.requestSharedDocumentArchive(PERMIT, false, stamp('10:00:00.000', ipadClockOffsetMinutes));
    await sync(ipad, cloud, 'ipad');
    await sync(phone, cloud, 'phone');
    await phone.consumeSharedDocumentsRestoredElsewhere([PERMIT]);
    expect(archivedInCloud(cloud, PERMIT)).toBe(false);
    // 10:30 phone: Archive again (with signal). His last tap.
    await phone.requestSharedDocumentArchive(PERMIT, true, stamp('10:30:00.000', phoneClockOffsetMinutes));
    await sync(phone, cloud, 'phone');
    expect(archivedInCloud(cloud, PERMIT)).toBe(true);
    // Both devices are opened again, twice, with signal throughout.
    for (const name of ['ipad', 'phone', 'ipad', 'phone'] as const) await sync(name === 'ipad' ? ipad : phone, cloud, name);
    return {
      cloud: archivedInCloud(cloud, PERMIT), ipadHides: hiddenOn(ipad).includes(PERMIT),
      phoneToldToPutCardBack: phone.sharedDocumentArchiveView().restoredElsewhere,
      notices: [...phone.sharedDocumentArchiveView().notices, ...ipad.sharedDocumentArchiveView().notices],
      writes: cloud.writes.map(write => `${write.device}:${write.archived_at === null ? 'restore' : 'archive'}:${write.changed}`),
    };
  }
  const archivedEverywhere = {
    cloud: true, ipadHides: true, phoneToldToPutCardBack: [], notices: [],
    writes: ['phone:archive:1', 'ipad:restore:1', 'phone:archive:1'], // and nothing after his last tap: no device acts by itself
  };

  it.each([
    ['sound: both clocks right', 0, 0],
    ['P2-M1 (a): the PHONE\'s clock two hours slow, signal throughout', -120, 0],
    ['P2-M1 (b): the iPad\'s clock two hours fast, signal throughout', 0, 120],
    ['sound: the phone\'s clock two hours fast', 120, 0],
    ['the iPad\'s clock two hours slow', 0, -120],
    ['the phone\'s clock two minutes slow', -2, 0],
    ['both clocks a day out, opposite ways', -1440, 1440],
  ])('%s: the phone\'s later Archive stands, and nothing is sent after it', async (_label, phoneOffset, ipadOffset) => {
    expect(await ipadRestoresThenPhoneArchives(phoneOffset, ipadOffset)).toEqual(archivedEverywhere);
  });

  it('sound: a mark dated a day in the future (the phone\'s clock a day fast) can still be restored from the iPad, with signal and after no signal', async () => {
    const future = new Date(Date.parse(T('09:00:00.000')) + 24 * 3600_000).toISOString();
    const phone = await start('phone');
    const ipad = await start('ipad');
    await sync(phone, cloud, 'phone');
    await phone.requestSharedDocumentArchive(PERMIT, true, future);
    await sync(phone, cloud, 'phone');
    await sync(ipad, cloud, 'ipad');
    await ipad.requestSharedDocumentArchive(PERMIT, false, T('10:00:00.000'));
    await sync(ipad, cloud, 'ipad');
    expect(archivedInCloud(cloud, PERMIT)).toBe(false);
    // Again, this time the iPad taps Restore with no signal.
    await sync(phone, cloud, 'phone');
    await phone.requestSharedDocumentArchive(PERMIT, true, new Date(Date.parse(future) + 3600_000).toISOString());
    await sync(phone, cloud, 'phone');
    await sync(ipad, cloud, 'ipad');
    cloud.state.offline.ipad = true;
    await ipad.requestSharedDocumentArchive(PERMIT, false, T('11:30:00.000'));
    await sync(ipad, cloud, 'ipad');
    cloud.state.offline.ipad = false;
    await sync(ipad, cloud, 'ipad');
    expect(archivedInCloud(cloud, PERMIT)).toBe(false);
    expect(ipad.sharedDocumentArchiveView().notices).toEqual([]);
  });

  it('nothing a device saves holds the time of a Restore, and a saved copy from the clock rule is read without its times: nothing is "restored once more"', async () => {
    cloud.row(PERMIT)!.archived_at = T('09:00:00.000');
    const ipad = await start('ipad');
    await sync(ipad, cloud, 'ipad');
    cloud.state.offline.ipad = true;
    await ipad.requestSharedDocumentArchive(PERMIT, false, T('10:00:00.000'), 'Grading permit');
    await ipad.sharedDocumentArchiveSettled();
    const saved = savedRecord('ipad');
    expect(saved.waiting).toHaveLength(1);
    expect(Object.keys(saved.waiting![0]).sort()).toEqual(['archived', 'attempts', 'documentId', 'name', 'seen', 'tap']);
    expect(JSON.stringify(saved)).not.toContain('10:00:00'); // the time he tapped Restore is nowhere
    expect(saved).not.toHaveProperty('ownRestores');

    // A copy saved while the clock rule was in the code: this iPad "restored at 12:00", and nothing waits. The cloud
    // holds an Archive dated 11:00 (made on a phone whose clock is slow, after that Restore).
    resetDevices();
    cloud = createCloud();
    cloud.add(PERMIT);
    cloud.row(PERMIT)!.archived_at = T('11:00:00.000');
    deviceStorage.ipad.set('projectPhotoUpdate.sharedDocumentArchive.v1', JSON.stringify({ version: 1, owners: { 'owner-a': {
      installed: true, marks: {}, waiting: [], restoredElsewhere: [], notices: [], ownRestores: { [PERMIT]: T('12:00:00.000') },
    } } }));
    const reopened = await start('ipad');
    for (let pass = 0; pass < 3; pass += 1) await sync(reopened, cloud, 'ipad');
    expect(cloud.writes).toEqual([]);
    expect(archivedInCloud(cloud, PERMIT)).toBe(true);
    expect(hiddenOn(reopened)).toEqual([PERMIT]);
    await reopened.sharedDocumentArchiveSettled();
    expect(savedRecord('ipad')).not.toHaveProperty('ownRestores');
  });
});

describe('the rule: a waiting tap is sent only if the cloud\'s mark is still what this device last knew when he tapped', () => {
  it('a Restore of the Archive he was shown is sent, though the cloud writes that time another way than the device did', async () => {
    const phone = await start('phone');
    const ipad = await start('ipad');
    await sync(phone, cloud, 'phone');
    await phone.requestSharedDocumentArchive(PERMIT, true, T('18:00:00.500'));
    await sync(phone, cloud, 'phone');
    expect(apiTime(cloud.row(PERMIT)!.archived_at!)).toBe('2026-10-06T18:00:00.5+00:00'); // what the iPad is told
    await sync(ipad, cloud, 'ipad');
    await ipad.requestSharedDocumentArchive(PERMIT, false);
    await sync(ipad, cloud, 'ipad');
    expect(archivedInCloud(cloud, PERMIT)).toBe(false);
    // And on the phone itself, which knows the mark as it wrote it and is told it the cloud's way: Archive, then
    // Restore, with a read between.
    await sync(phone, cloud, 'phone');
    await phone.consumeSharedDocumentsRestoredElsewhere([PERMIT]);
    await phone.requestSharedDocumentArchive(PERMIT, true, T('19:00:00.120'));
    await sync(phone, cloud, 'phone');
    await phone.requestSharedDocumentArchive(PERMIT, false);
    await sync(phone, cloud, 'phone');
    expect(archivedInCloud(cloud, PERMIT)).toBe(false);
    expect([...phone.sharedDocumentArchiveView().notices, ...ipad.sharedDocumentArchiveView().notices]).toEqual([]);
  });

  it.each([
    ['2026-10-06T18:00:00+00:00'], ['2026-10-06T18:00:00.000000+00:00'], ['2026-10-06 18:00:00+00'], ['2026-10-06T20:00:00+02:00'],
    ['2026-10-06T12:30:00.0-05:30'], ['2026-10-06T18:00:00Z'],
  ])('a mark the cloud writes as %s is the mark the device wrote as 2026-10-06T18:00:00.000Z: a Restore is sent', async written => {
    const phone = await start('phone');
    await sync(phone, cloud, 'phone');
    await phone.requestSharedDocumentArchive(PERMIT, true, T('18:00:00.000'));
    await sync(phone, cloud, 'phone'); // the phone now knows the mark as it wrote it
    const real = cloud.clientFor('phone');
    const writtenThisWay = { auth: real.auth, from: () => {
      const chain = real.from() as Record<string, unknown>;
      const then = chain.then as (resolve: (value: { data: unknown }) => unknown) => Promise<unknown>;
      chain.then = (resolve: (value: unknown) => unknown) => then(answer => resolve(Array.isArray(answer.data)
        ? { ...answer, data: (answer.data as Array<Record<string, unknown>>).map(row => ('archived_at' in row && row.archived_at ? { ...row, archived_at: written } : row)) }
        : answer));
      return chain;
    } };
    await phone.requestSharedDocumentArchive(PERMIT, false);
    await phone.syncSharedDocumentArchiveWithCloud({ client: writtenThisWay as never, ownerId: 'owner-a', timeoutMs: 150 });
    expect(phone.sharedDocumentArchiveView().notices).toEqual([]);
    expect(archivedInCloud(cloud, PERMIT)).toBe(false);
  });

  it('a mark one thousandth of a second away is another mark: a Restore of it is not sent', async () => {
    cloud.row(PERMIT)!.archived_at = T('18:00:00.000');
    const ipad = await start('ipad');
    await sync(ipad, cloud, 'ipad');
    cloud.state.offline.ipad = true;
    await ipad.requestSharedDocumentArchive(PERMIT, false, undefined, 'Grading permit');
    cloud.row(PERMIT)!.archived_at = T('18:00:00.001'); // restored and archived again on the phone
    cloud.state.offline.ipad = false;
    await sync(ipad, cloud, 'ipad');
    expect(cloud.writes).toEqual([]);
    expect(ipad.sharedDocumentArchiveView().notices.map(notice => notice.why)).toEqual(['archived_again_on_another_device']);
  });

  it('the cloud already says what he asked for: nothing is sent and nothing is said, whichever device made it so', async () => {
    cloud.row(PERMIT)!.archived_at = T('09:00:00.000');
    const phone = await start('phone');
    const ipad = await start('ipad');
    await sync(phone, cloud, 'phone');
    await sync(ipad, cloud, 'ipad');
    cloud.state.offline.ipad = true;
    await ipad.requestSharedDocumentArchive(PERMIT, false);
    await phone.requestSharedDocumentArchive(PERMIT, false);
    await sync(phone, cloud, 'phone');
    cloud.state.offline.ipad = false;
    await sync(ipad, cloud, 'ipad');
    expect(cloud.writes.map(write => write.device)).toEqual(['phone']);
    expect(ipad.sharedDocumentArchiveView().notices).toEqual([]);
    await ipad.sharedDocumentArchiveSettled();
    expect(savedRecord('ipad').waiting ?? []).toEqual([]);
  });

  it('an Archive that waited while the document was DELETED on another device is not "restored on another device": the row is asked for, and the line says deleted', async () => {
    cloud.row(PERMIT)!.archived_at = T('09:00:00.000');
    const phone = await start('phone');
    await sync(phone, cloud, 'phone');
    cloud.state.offline.phone = true;
    await phone.requestSharedDocumentArchive(PERMIT, false);
    await phone.requestSharedDocumentArchive(PERMIT, true, T('09:30:00.000'), 'Grading permit.pdf');
    cloud.remove(PERMIT); // deleted from all devices on the web
    cloud.state.offline.phone = false;
    await sync(phone, cloud, 'phone');
    expect(cloud.writes).toEqual([]);
    expect(phone.sharedDocumentArchiveView().restoredElsewhere).toEqual([]); // no card is put back for a deleted document
    expect(phone.sharedDocumentArchiveView().notices).toEqual([
      { documentId: PERMIT, tap: 'archive', why: 'deleted_from_all_devices', name: 'Grading permit.pdf' },
    ]);
    expect([...phone.sharedDocumentArchiveView().waitingIds]).toEqual([]);
  });

  it('when the cloud cannot be asked which it was, nothing is decided: the Archive keeps waiting, and the next pass decides', async () => {
    cloud.row(PERMIT)!.archived_at = T('09:00:00.000');
    const phone = await start('phone');
    await sync(phone, cloud, 'phone');
    cloud.state.offline.phone = true;
    await phone.requestSharedDocumentArchive(PERMIT, false);
    await phone.requestSharedDocumentArchive(PERMIT, true, T('09:30:00.000'), 'Grading permit.pdf');
    cloud.row(PERMIT)!.archived_at = null; // restored on the iPad
    cloud.state.offline.phone = false;
    const real = cloud.clientFor('phone');
    let questions = 0;
    const signalLostAfterTheFirstQuestion = { auth: real.auth, from: () => {
      questions += 1;
      if (questions === 1) return real.from();
      const chain: Record<string, unknown> = {};
      for (const method of ['select', 'eq', 'not', 'is', 'update']) chain[method] = () => chain;
      chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ data: null, status: 0, error: { code: '', message: 'TypeError: Network request failed' } }).then(resolve);
      return chain;
    } };
    await phone.syncSharedDocumentArchiveWithCloud({ client: signalLostAfterTheFirstQuestion as never, ownerId: 'owner-a', timeoutMs: 150 });
    expect([...phone.sharedDocumentArchiveView().waitingIds]).toEqual([PERMIT]);
    expect(phone.sharedDocumentArchiveView().notices).toEqual([]);
    await sync(phone, cloud, 'phone');
    expect(phone.sharedDocumentArchiveView().notices.map(notice => notice.why)).toEqual(['restored_on_another_device']);
    expect(phone.sharedDocumentArchiveView().restoredElsewhere).toEqual([PERMIT]);
    expect(cloud.writes).toEqual([]);
  });

  it('his taps on one device are applied in order: Archive, Restore, Archive with no signal send one Archive; Restore, Archive, Restore send one Restore', async () => {
    const phone = await start('phone');
    await sync(phone, cloud, 'phone');
    cloud.state.offline.phone = true;
    await phone.requestSharedDocumentArchive(PERMIT, true, T('09:00:00.000'));
    await phone.requestSharedDocumentArchive(PERMIT, false);
    await phone.requestSharedDocumentArchive(PERMIT, true, T('09:02:00.000'));
    cloud.state.offline.phone = false;
    await sync(phone, cloud, 'phone');
    expect(cloud.writes.map(write => write.archived_at)).toEqual([T('09:02:00.000')]);
    cloud.state.offline.phone = true;
    await phone.requestSharedDocumentArchive(PERMIT, false);
    await phone.requestSharedDocumentArchive(PERMIT, true, T('09:04:00.000'));
    await phone.requestSharedDocumentArchive(PERMIT, false);
    cloud.state.offline.phone = false;
    await sync(phone, cloud, 'phone');
    expect(cloud.writes.map(write => write.archived_at)).toEqual([T('09:02:00.000'), null]);
    expect(phone.sharedDocumentArchiveView().notices).toEqual([]);
  });

  // The one sequence of the reviewer's 300 "signal coming and going" that the rule as first written still ended
  // different from his last tap WITH NO LINE (seed 120). The phone, with no signal, restores and archives again:
  // the cloud still holds the Archive the phone was shown, so nothing was sent. The iPad's Restore of that same
  // Archive, made with no signal, then went up and undid it. Now the phone's Archive is sent like any other and
  // writes its own mark, so the two orders of arrival both end with a line where a tap was not sent.
  describe('he restores and archives again on the phone with no signal, and the iPad, with no signal, restores the Archive it was shown', () => {
    async function bothTapWithNoSignal() {
      const phone = await start('phone');
      const ipad = await start('ipad');
      await sync(phone, cloud, 'phone');
      await phone.requestSharedDocumentArchive(PERMIT, true, T('09:00:00.000'));
      await sync(phone, cloud, 'phone');
      await sync(ipad, cloud, 'ipad');
      cloud.state.offline.phone = true;
      cloud.state.offline.ipad = true;
      await phone.requestSharedDocumentArchive(PERMIT, false);
      await ipad.requestSharedDocumentArchive(PERMIT, false, undefined, 'Grading permit');
      await phone.requestSharedDocumentArchive(PERMIT, true, T('09:30:00.000'), 'Grading permit.pdf'); // his last tap
      cloud.state.offline.phone = false;
      cloud.state.offline.ipad = false;
      return { phone, ipad };
    }

    it('the phone reaches the cloud first: its Archive is written as a new mark, and the iPad\'s Restore is not sent, with a line on the iPad', async () => {
      const { phone, ipad } = await bothTapWithNoSignal();
      await sync(phone, cloud, 'phone');
      expect(cloud.row(PERMIT)?.archived_at).toBe(T('09:30:00.000'));
      await sync(ipad, cloud, 'ipad');
      await sync(phone, cloud, 'phone');
      expect(cloud.row(PERMIT)?.archived_at).toBe(T('09:30:00.000'));
      expect(cloud.writes.filter(write => write.device === 'ipad')).toEqual([]);
      expect(hiddenOn(ipad)).toEqual([PERMIT]);
      expect(hiddenOn(phone)).toEqual([PERMIT]);
      expect(ipad.sharedDocumentArchiveView().notices).toEqual([
        { documentId: PERMIT, tap: 'restore', why: 'archived_again_on_another_device', name: 'Grading permit' },
      ]);
      expect(phone.sharedDocumentArchiveView().notices).toEqual([]);
      expect(phone.sharedDocumentArchiveView().restoredElsewhere).toEqual([]);
    });

    it('the iPad reaches the cloud first: its Restore is sent, and the phone\'s Archive is not, with a line on the phone and its card put back', async () => {
      const { phone, ipad } = await bothTapWithNoSignal();
      await sync(ipad, cloud, 'ipad');
      expect(cloud.row(PERMIT)?.archived_at).toBeNull();
      await sync(phone, cloud, 'phone');
      await sync(ipad, cloud, 'ipad');
      expect(cloud.row(PERMIT)?.archived_at).toBeNull();
      expect(cloud.writes.map(write => `${write.device}:${write.archived_at === null ? 'restore' : 'archive'}`)).toEqual(['phone:archive', 'ipad:restore']);
      expect(hiddenOn(phone)).toEqual([]);
      expect(hiddenOn(ipad)).toEqual([]);
      expect(phone.sharedDocumentArchiveView().notices).toEqual([
        { documentId: PERMIT, tap: 'archive', why: 'restored_on_another_device', name: 'Grading permit.pdf' },
      ]);
      expect(phone.sharedDocumentArchiveView().restoredElsewhere).toEqual([PERMIT]);
      expect(ipad.sharedDocumentArchiveView().notices).toEqual([]);
    });

    it('with no other device in it, the same two taps on the phone end with the document archived under the mark of his last Archive, and nothing said', async () => {
      const phone = await start('phone');
      await sync(phone, cloud, 'phone');
      await phone.requestSharedDocumentArchive(PERMIT, true, T('09:00:00.000'));
      await sync(phone, cloud, 'phone');
      cloud.state.offline.phone = true;
      await phone.requestSharedDocumentArchive(PERMIT, false);
      await phone.requestSharedDocumentArchive(PERMIT, true, T('09:30:00.000'));
      cloud.state.offline.phone = false;
      await sync(phone, cloud, 'phone');
      await sync(phone, cloud, 'phone');
      expect(cloud.row(PERMIT)?.archived_at).toBe(T('09:30:00.000'));
      expect(cloud.writes).toHaveLength(2);
      expect(phone.sharedDocumentArchiveView().notices).toEqual([]);
      expect([...phone.sharedDocumentArchiveView().waitingIds]).toEqual([]);
      expect(hiddenOn(phone)).toEqual([PERMIT]);
    });

    it('an Archive made on another device that this device had not seen is left as it is: nothing is sent, nothing said', async () => {
      const phone = await start('phone');
      await sync(phone, cloud, 'phone');
      cloud.state.offline.phone = true;
      await phone.requestSharedDocumentArchive(PERMIT, true, T('09:30:00.000'));
      cloud.row(PERMIT)!.archived_at = T('09:10:00.000'); // archived on a second phone meanwhile
      cloud.state.offline.phone = false;
      await sync(phone, cloud, 'phone');
      expect(cloud.writes).toEqual([]);
      expect(cloud.row(PERMIT)?.archived_at).toBe(T('09:10:00.000'));
      expect(phone.sharedDocumentArchiveView().notices).toEqual([]);
      expect(hiddenOn(phone)).toEqual([PERMIT]);
    });
  });

  it('this device knows its own mark even when the answer to its write was an error from something in between (the write had landed): a Restore of it is sent, not taken for another device\'s Archive', async () => {
    const phone = await start('phone');
    await sync(phone, cloud, 'phone');
    await phone.requestSharedDocumentArchive(PERMIT, true, T('18:00:00.000'), 'Grading permit.pdf');
    const real = cloud.clientFor('phone');
    const landsThenBadGateway = { auth: real.auth, from: () => {
      const chain = real.from() as Record<string, unknown>;
      const update = chain.update as (values: unknown) => unknown;
      const then = chain.then as (resolve: (value: unknown) => unknown) => Promise<unknown>;
      chain.update = (values: unknown) => {
        update(values);
        chain.then = (resolve: (value: unknown) => unknown) => then(() => resolve({ data: null, status: 502, error: { code: '', message: 'Bad Gateway' } }));
        return chain;
      };
      return chain;
    } };
    await phone.syncSharedDocumentArchiveWithCloud({ client: landsThenBadGateway as never, ownerId: 'owner-a', timeoutMs: 150 });
    expect(archivedInCloud(cloud, PERMIT)).toBe(true);
    expect([...phone.sharedDocumentArchiveView().refusedIds]).toEqual([PERMIT]); // the phone was told "refused"
    await phone.requestSharedDocumentArchive(PERMIT, false, undefined, 'Grading permit.pdf');
    await sync(phone, cloud, 'phone');
    expect(archivedInCloud(cloud, PERMIT)).toBe(false);
    expect(phone.sharedDocumentArchiveView().notices).toEqual([]);
  });

  it('a refusal the database itself gave (it has a code) did not land: the mark is not counted as this device\'s own afterwards', async () => {
    const phone = await start('phone');
    await sync(phone, cloud, 'phone');
    await phone.requestSharedDocumentArchive(PERMIT, true, T('18:00:00.000'));
    cloud.state.failWritesWith = { code: '57014', message: 'canceling statement due to statement timeout' };
    await sync(phone, cloud, 'phone');
    cloud.state.failWritesWith = null;
    await phone.sharedDocumentArchiveSettled();
    expect(savedRecord('phone').waiting?.[0]).not.toHaveProperty('sent');
  });

  it('note (a limit, said in the notes): the cloud keeps no mark for "restored", so an Archive whose answer was lost is sent again when the cloud shows no mark, even if another device restored it in between', async () => {
    const phone = await start('phone');
    const ipad = await start('ipad');
    await sync(phone, cloud, 'phone');
    cloud.state.loseNextWriteAnswer = true;
    await phone.requestSharedDocumentArchive(PERMIT, true, T('18:00:00.000'));
    await sync(phone, cloud, 'phone'); // lands; the phone gets no answer
    await sync(ipad, cloud, 'ipad');
    await ipad.requestSharedDocumentArchive(PERMIT, false);
    await sync(ipad, cloud, 'ipad');
    expect(archivedInCloud(cloud, PERMIT)).toBe(false);
    await sync(phone, cloud, 'phone'); // the phone is the last to reach the cloud, and what it last knew still holds
    expect(archivedInCloud(cloud, PERMIT)).toBe(true);
  });
});

describe('a line about a tap that was not sent stays only while it is true', () => {
  /** The iPad's Restore is let go: the phone restored and archived again while the iPad had no signal. */
  async function ipadRestoreLetGo() {
    const phone = await start('phone');
    const ipad = await start('ipad');
    await sync(phone, cloud, 'phone');
    await phone.requestSharedDocumentArchive(PERMIT, true, T('09:00:00.000'));
    await sync(phone, cloud, 'phone');
    await sync(ipad, cloud, 'ipad');
    cloud.state.offline.ipad = true;
    await ipad.requestSharedDocumentArchive(PERMIT, false, undefined, 'Grading permit');
    await phone.requestSharedDocumentArchive(PERMIT, false);
    await sync(phone, cloud, 'phone');
    await phone.requestSharedDocumentArchive(PERMIT, true, T('09:30:00.000'));
    await sync(phone, cloud, 'phone');
    cloud.state.offline.ipad = false;
    await sync(ipad, cloud, 'ipad');
    expect(ipad.sharedDocumentArchiveView().notices.map(notice => notice.why)).toEqual(['archived_again_on_another_device']);
    expect(hiddenOn(ipad)).toEqual([PERMIT]); // "It is still archived": so it is, on this device too
    return { phone, ipad };
  }

  it('it says the document is still archived: when the document is restored on another device afterwards, the line goes', async () => {
    const { phone, ipad } = await ipadRestoreLetGo();
    await phone.requestSharedDocumentArchive(PERMIT, false);
    await sync(phone, cloud, 'phone');
    await sync(ipad, cloud, 'ipad');
    expect(hiddenOn(ipad)).toEqual([]);
    expect(ipad.sharedDocumentArchiveView().notices).toEqual([]);
  });

  it('the same when the iPad is told of that Restore live, without asking', async () => {
    const { ipad } = await ipadRestoreLetGo();
    await ipad.noteSharedDocumentArchiveLiveRow({ ownerId: 'owner-a', eventType: 'UPDATE', newRow: { id: PERMIT, owner_id: 'owner-a', archived_at: null }, oldRow: null });
    expect(ipad.sharedDocumentArchiveView().notices).toEqual([]);
  });

  it('it stays through closing the app while it is true, and goes when he taps OK', async () => {
    const { ipad } = await ipadRestoreLetGo();
    await ipad.sharedDocumentArchiveSettled();
    const reopened = await start('ipad');
    expect(reopened.sharedDocumentArchiveView().notices).toHaveLength(1);
    await sync(reopened, cloud, 'ipad');
    expect(reopened.sharedDocumentArchiveView().notices).toHaveLength(1);
    await reopened.dismissSharedDocumentArchiveNotices([PERMIT]);
    expect(reopened.sharedDocumentArchiveView().notices).toEqual([]);
  });

  it('"It is in Documents again" (an Archive let go) goes when the document is archived again, on this device or another', async () => {
    cloud.row(PERMIT)!.archived_at = T('09:00:00.000');
    const phone = await start('phone');
    const ipad = await start('ipad');
    await sync(phone, cloud, 'phone');
    await sync(ipad, cloud, 'ipad');
    cloud.state.offline.phone = true;
    await phone.requestSharedDocumentArchive(PERMIT, false);
    await phone.requestSharedDocumentArchive(PERMIT, true, T('09:30:00.000'), 'Grading permit.pdf');
    await ipad.requestSharedDocumentArchive(PERMIT, false);
    await sync(ipad, cloud, 'ipad');
    cloud.state.offline.phone = false;
    await sync(phone, cloud, 'phone');
    expect(phone.sharedDocumentArchiveView().notices.map(notice => notice.why)).toEqual(['restored_on_another_device']);
    expect(hiddenOn(phone)).toEqual([]);
    cloud.row(PERMIT)!.archived_at = T('10:00:00.000'); // archived on a second phone
    await sync(phone, cloud, 'phone');
    expect(hiddenOn(phone)).toEqual([PERMIT]);
    expect(phone.sharedDocumentArchiveView().notices).toEqual([]);
  });
});

describe('P2-L1: a Restore that is not sent is told in a line that is true whichever tap came first', () => {
  it('the reviewer\'s case: the phone\'s clock a day fast; the iPad, with no signal, taps Restore AFTER the phone archived again: the line does not say which came first, and a second Restore works', async () => {
    const dayFast = (trueClock: string) => new Date(Date.parse(T(trueClock)) + 24 * 3600_000).toISOString();
    const phone = await start('phone');
    const ipad = await start('ipad');
    await sync(phone, cloud, 'phone');
    await phone.requestSharedDocumentArchive(PERMIT, true, dayFast('09:00:00.000'));
    await sync(phone, cloud, 'phone');
    await sync(ipad, cloud, 'ipad'); // the iPad sees it archived
    cloud.state.offline.ipad = true;
    // 10:00 phone: Restore, then Archive again.
    await phone.requestSharedDocumentArchive(PERMIT, false, dayFast('10:00:00.000'));
    await sync(phone, cloud, 'phone');
    await phone.requestSharedDocumentArchive(PERMIT, true, dayFast('10:00:30.000'));
    await sync(phone, cloud, 'phone');
    // 11:00 iPad, no signal: Restore. This is his last tap, made against an Archive the iPad had not heard of.
    await ipad.requestSharedDocumentArchive(PERMIT, false, T('11:00:00.000'), 'Grading permit');
    await sync(ipad, cloud, 'ipad');
    cloud.state.offline.ipad = false;
    await sync(ipad, cloud, 'ipad');
    const said = ipad.sharedDocumentArchiveView().notices.map(notice => ipad.sharedDocumentArchiveNoticeText(notice));
    // The reviewer asked for one of two things: the Restore is sent, or he is told something true. By the
    // coordinator's decision it is the second: the cloud's state stands and the line says so.
    expect(archivedInCloud(cloud, PERMIT)).toBe(true);
    expect(said).toEqual(['Grading permit: your Restore on this device was not sent, because it was archived again on another device before this device could send it. It is still archived; tap Restore again if you still want it back.']);
    expect(said[0]).not.toMatch(/after you tapped/i); // the untrue sentence of the last batch
    expect(hiddenOn(ipad)).toEqual([PERMIT]);
    // "tap Restore again": it works.
    await ipad.requestSharedDocumentArchive(PERMIT, false, T('11:05:00.000'), 'Grading permit');
    await sync(ipad, cloud, 'ipad');
    expect(archivedInCloud(cloud, PERMIT)).toBe(false);
    expect(ipad.sharedDocumentArchiveView().notices).toEqual([]);
  });

  it('the same steps with every clock right, and with the iPad\'s clock a day slow, end the same way and say the same thing', async () => {
    const outcomes: string[] = [];
    for (const [phoneOffset, ipadOffset] of [[0, 0], [0, -24 * 60], [24 * 60, 0], [-90, 45]]) {
      resetDevices();
      cloud = createCloud();
      cloud.add(PERMIT);
      const at = (trueClock: string, offsetMinutes: number) => new Date(Date.parse(T(trueClock)) + offsetMinutes * 60_000).toISOString();
      const phone = await start('phone');
      const ipad = await start('ipad');
      await sync(phone, cloud, 'phone');
      await phone.requestSharedDocumentArchive(PERMIT, true, at('09:00:00.000', phoneOffset));
      await sync(phone, cloud, 'phone');
      await sync(ipad, cloud, 'ipad');
      cloud.state.offline.ipad = true;
      await phone.requestSharedDocumentArchive(PERMIT, false, at('10:00:00.000', phoneOffset));
      await sync(phone, cloud, 'phone');
      await phone.requestSharedDocumentArchive(PERMIT, true, at('10:00:30.000', phoneOffset));
      await sync(phone, cloud, 'phone');
      await ipad.requestSharedDocumentArchive(PERMIT, false, at('11:00:00.000', ipadOffset), 'Grading permit');
      cloud.state.offline.ipad = false;
      await sync(ipad, cloud, 'ipad');
      outcomes.push(JSON.stringify({
        cloud: archivedInCloud(cloud, PERMIT), ipad: hiddenOn(ipad),
        said: ipad.sharedDocumentArchiveView().notices.map(notice => ipad.sharedDocumentArchiveNoticeText(notice)),
        writes: cloud.writes.map(write => `${write.device}:${write.archived_at === null ? 'restore' : 'archive'}:${write.changed}`),
      }));
    }
    expect(new Set(outcomes).size).toBe(1);
  });
});

describe('P2-L2: a refused tap is tried again after its wait, whatever is done to the device\'s clock', () => {
  const REFUSAL = { code: '57014', message: 'canceling statement due to statement timeout' };
  const MINUTE = 60_000;
  afterEach(() => { jest.restoreAllMocks(); });

  it('the reviewer\'s case: refused while the clock was a day fast; the clock is put right; sixteen minutes later the cloud is fine: it is sent', async () => {
    const right = Date.parse(T('18:00:00.000'));
    const deviceClock = jest.spyOn(Date, 'now').mockReturnValue(right + 24 * 3600_000); // a day fast
    let appHasRun = 40_000;
    const running = () => appHasRun;
    const phone = await start('phone');
    await sync(phone, cloud, 'phone', 'owner-a', { running });
    await phone.requestSharedDocumentArchive(PERMIT, true, new Date(right + 24 * 3600_000).toISOString());
    cloud.state.failWritesWith = REFUSAL;
    await sync(phone, cloud, 'phone', 'owner-a', { running });
    expect([...phone.sharedDocumentArchiveView().refusedIds]).toEqual([PERMIT]);
    cloud.state.failWritesWith = null;
    deviceClock.mockReturnValue(right + 16 * MINUTE); // he corrects the clock; sixteen minutes pass
    appHasRun += 16 * MINUTE;
    await sync(phone, cloud, 'phone', 'owner-a', { running });
    expect(archivedInCloud(cloud, PERMIT)).toBe(true);
    expect(phone.sharedDocumentArchiveView().refusedIds.size).toBe(0);
  });

  it('half a minute after the refusal is enough, with the clock put back a day or forward a year in between; a second less is not', async () => {
    const right = Date.parse(T('18:00:00.000'));
    const deviceClock = jest.spyOn(Date, 'now').mockReturnValue(right);
    let appHasRun = 1_000;
    const running = () => appHasRun;
    const phone = await start('phone');
    await sync(phone, cloud, 'phone', 'owner-a', { running });
    await phone.requestSharedDocumentArchive(PERMIT, true, T('18:00:00.000'));
    cloud.state.failWritesWith = REFUSAL;
    await sync(phone, cloud, 'phone', 'owner-a', { running });
    expect(cloud.writes).toHaveLength(1);
    expect(phone.sharedDocumentArchiveNextTryInMs(running)).toBe(30_000);
    cloud.state.failWritesWith = null;
    deviceClock.mockReturnValue(right + 365 * 24 * 3600_000); // set forward a year: the wait is not cut short
    appHasRun += 29_000;
    await sync(phone, cloud, 'phone', 'owner-a', { running });
    expect(cloud.writes).toHaveLength(1);
    expect(phone.sharedDocumentArchiveNextTryInMs(running)).toBe(1_000);
    deviceClock.mockReturnValue(right - 24 * 3600_000); // set back a day: the wait is not stretched
    appHasRun += 1_000;
    await sync(phone, cloud, 'phone', 'owner-a', { running });
    expect(cloud.writes).toHaveLength(2);
    expect(archivedInCloud(cloud, PERMIT)).toBe(true);
  });

  it('a pass to the cloud never reads the device\'s clock: not to ask, not to send, not after a refusal, not to say when the next try is', async () => {
    const phone = await start('phone');
    await sync(phone, cloud, 'phone');
    await phone.requestSharedDocumentArchive(PERMIT, true, T('18:00:00.000'));
    cloud.add('doc-contract');
    cloud.row('doc-contract')!.archived_at = T('12:00:00.000');
    const deviceClock = jest.spyOn(Date, 'now');
    cloud.state.failWritesWith = REFUSAL;
    await sync(phone, cloud, 'phone');
    expect(phone.sharedDocumentArchiveNextTryInMs()).toBeGreaterThan(29_000);
    cloud.state.failWritesWith = null;
    await sync(phone, cloud, 'phone', 'owner-a', { running: () => performance.now() + MINUTE });
    await phone.requestSharedDocumentArchive('doc-contract', false);
    await sync(phone, cloud, 'phone');
    expect(cloud.writes.map(write => write.changed)).toEqual([0, 1, 1]);
    expect(deviceClock).not.toHaveBeenCalled();
  });

  it('after the app has been closed and opened, a tap that was refused a moment before is tried at once', async () => {
    const phone = await start('phone');
    await sync(phone, cloud, 'phone');
    await phone.requestSharedDocumentArchive(PERMIT, true, T('18:00:00.000'));
    cloud.state.failWritesWith = REFUSAL;
    let appHasRun = 2_000;
    const running = () => appHasRun;
    for (let pass = 0; pass < 6; pass += 1) {
      await sync(phone, cloud, 'phone', 'owner-a', { running });
      if (pass < 5) appHasRun += 20 * MINUTE;
    }
    expect(cloud.writes).toHaveLength(6);
    expect(phone.sharedDocumentArchiveNextTryInMs(running)).toBe(15 * MINUTE); // its sixth wait is a quarter of an hour
    await phone.sharedDocumentArchiveSettled();
    cloud.state.failWritesWith = null;
    const reopened = await start('phone');
    expect([...reopened.sharedDocumentArchiveView().refusedIds]).toEqual([PERMIT]); // it still says the cloud has not accepted it
    expect(reopened.sharedDocumentArchiveNextTryInMs(running)).toBe(0);
    await sync(reopened, cloud, 'phone', 'owner-a', { running });
    expect(archivedInCloud(cloud, PERMIT)).toBe(true);
  });

  it('a wait is never longer than a quarter of an hour, whatever the count of running time does; and a device with no such count keeps no wait at all', async () => {
    let appHasRun: number | null = 1_000_000_000;
    const running = () => appHasRun;
    const phone = await start('phone');
    await sync(phone, cloud, 'phone', 'owner-a', { running });
    await phone.requestSharedDocumentArchive(PERMIT, true, T('18:00:00.000'));
    cloud.state.failWritesWith = REFUSAL;
    await sync(phone, cloud, 'phone', 'owner-a', { running });
    appHasRun = 5; // the count began again
    expect(phone.sharedDocumentArchiveNextTryInMs(running)).toBe(0);
    await sync(phone, cloud, 'phone', 'owner-a', { running });
    expect(cloud.writes).toHaveLength(2);
    appHasRun = null; // no count on this device
    await sync(phone, cloud, 'phone', 'owner-a', { running });
    await sync(phone, cloud, 'phone', 'owner-a', { running });
    expect(cloud.writes).toHaveLength(4);
    expect(phone.sharedDocumentArchiveNextTryInMs(running)).toBe(0);
  });
});

describe('P2-L4: an Archive waiting for a document that is gone from the cloud', () => {
  const MINUTE = 60_000;
  async function archivedWithNoSignal(id = PERMIT) {
    const phone = await start('phone');
    await sync(phone, cloud, 'phone');
    cloud.state.offline.phone = true;
    await phone.requestSharedDocumentArchive(id, true, T('18:00:00.000'), 'Grading permit');
    await sync(phone, cloud, 'phone');
    return phone;
  }

  it('the reviewer\'s case: no deletion history on this phone: it is not tried for ever; it is let go at the first answer, and the phone says the document was deleted', async () => {
    const phone = await archivedWithNoSignal();
    cloud.remove(PERMIT); // deleted with its project on another device: no deletion record for the document itself
    cloud.state.offline.phone = false;
    let appHasRun = 60 * MINUTE;
    const running = () => appHasRun;
    await sync(phone, cloud, 'phone', 'owner-a', { running });
    const afterOnePass = phone.sharedDocumentArchiveView();
    expect({ stillWaiting: [...afterOnePass.waitingIds], saidRefused: [...afterOnePass.refusedIds] }).toEqual({ stillWaiting: [], saidRefused: [] });
    expect(afterOnePass.notices).toEqual([{ documentId: PERMIT, tap: 'archive', why: 'deleted_from_all_devices', name: 'Grading permit' }]);
    expect(phone.sharedDocumentArchiveNoticeText(afterOnePass.notices[0])).toBe('Grading permit: your Archive on this device was not sent, because the document has been deleted.');
    expect(afterOnePass.restoredElsewhere).toEqual([]); // no card is put back for a deleted document
    expect(phone.sharedDocumentArchiveNextTryInMs(running)).toBeNull();
    for (let pass = 0; pass < 40; pass += 1) { // more than eight hours of the app being open
      appHasRun += 15 * MINUTE;
      await sync(phone, cloud, 'phone', 'owner-a', { running });
    }
    expect(cloud.writes).toHaveLength(1); // the one try that changed nothing; never again
    expect(cloud.reads.filter(read => read.id === PERMIT)).toHaveLength(1); // and the one question about that row
    await phone.sharedDocumentArchiveSettled();
    expect(savedRecord('phone').waiting).toEqual([]);
  });

  it('a document made and archived with no signal, whose own record is still waiting on this phone to go up, is NOT taken for deleted: it waits, says the cloud has not accepted it yet, and lands once the record is there', async () => {
    const waitingToUpload = new Set(['doc-new']);
    const recordWaitingToUpload = (documentId: string) => waitingToUpload.has(documentId);
    const phone = await archivedWithNoSignal('doc-new');
    cloud.state.offline.phone = false;
    let appHasRun = 1_000;
    const running = () => appHasRun;
    for (let pass = 0; pass < 3; pass += 1) {
      await sync(phone, cloud, 'phone', 'owner-a', { running, recordWaitingToUpload });
      appHasRun += 20 * MINUTE;
    }
    expect(cloud.writes).toHaveLength(3);
    expect([...phone.sharedDocumentArchiveView().waitingIds]).toEqual(['doc-new']);
    expect([...phone.sharedDocumentArchiveView().refusedIds]).toEqual(['doc-new']);
    expect(phone.sharedDocumentArchiveView().notices).toEqual([]);
    // The record goes up.
    cloud.add('doc-new');
    waitingToUpload.clear();
    await sync(phone, cloud, 'phone', 'owner-a', { running, recordWaitingToUpload });
    expect(archivedInCloud(cloud, 'doc-new')).toBe(true);
    expect(phone.sharedDocumentArchiveView().waitingIds.size).toBe(0);
  });

  it('when it cannot be told whether the record is still waiting to go up, nothing is decided: the Archive keeps waiting', async () => {
    const phone = await archivedWithNoSignal('doc-new');
    cloud.state.offline.phone = false;
    await sync(phone, cloud, 'phone', 'owner-a', { recordWaitingToUpload: async () => { throw new Error('the upload list could not be read'); } });
    expect([...phone.sharedDocumentArchiveView().waitingIds]).toEqual(['doc-new']);
    expect(phone.sharedDocumentArchiveView().notices).toEqual([]);
  });

  it('when the cloud does not answer the question about that row, nothing is decided: the Archive keeps waiting and is tried again', async () => {
    const phone = await archivedWithNoSignal();
    cloud.remove(PERMIT);
    cloud.state.offline.phone = false;
    const real = cloud.clientFor('phone');
    let requests = 0;
    const signalLostAfterTheWrite = { auth: real.auth, from: () => {
      requests += 1;
      if (requests <= 2) return real.from(); // the question "which are archived?", and the write
      const chain: Record<string, unknown> = {};
      for (const method of ['select', 'eq', 'not', 'is', 'update']) chain[method] = () => chain;
      chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ data: null, status: 0, error: { code: '', message: 'TypeError: Network request failed' } }).then(resolve);
      return chain;
    } };
    await phone.syncSharedDocumentArchiveWithCloud({ client: signalLostAfterTheWrite as never, ownerId: 'owner-a', timeoutMs: 150 });
    expect([...phone.sharedDocumentArchiveView().waitingIds]).toEqual([PERMIT]);
    expect(phone.sharedDocumentArchiveView().notices).toEqual([]);
    await sync(phone, cloud, 'phone', 'owner-a', { running: () => performance.now() + MINUTE });
    expect(phone.sharedDocumentArchiveView().notices.map(notice => notice.why)).toEqual(['deleted_from_all_devices']);
  });

  it('another account signed in between the write and the question about the row: nothing of the first account\'s is decided by an answer that was not its own', async () => {
    const phone = await archivedWithNoSignal();
    cloud.remove(PERMIT);
    cloud.state.offline.phone = false;
    const real = cloud.clientFor('phone');
    const accountChangesAfterTheWrite = { auth: real.auth, from: () => {
      const chain = real.from() as Record<string, unknown>;
      const update = chain.update as (values: unknown) => unknown;
      const then = chain.then as (resolve: (value: unknown) => unknown) => Promise<unknown>;
      chain.update = (values: unknown) => {
        update(values);
        chain.then = (resolve: (value: unknown) => unknown) => then(answer => { cloud.state.signedIn.phone = 'owner-b'; return resolve(answer); });
        return chain;
      };
      return chain;
    } };
    await expect(phone.syncSharedDocumentArchiveWithCloud({ client: accountChangesAfterTheWrite as never, ownerId: 'owner-a', timeoutMs: 150 })).resolves.toBe('unknown');
    await phone.sharedDocumentArchiveSettled();
    expect(savedRecord('phone').waiting).toHaveLength(1); // owner-a's Archive still waits, for owner-a
    expect(savedRecord('phone').notices).toEqual([]);
  });

  it('the row is there and the write changed nothing all the same: that is a refusal, not a deletion: it keeps waiting', async () => {
    const phone = await archivedWithNoSignal();
    cloud.state.offline.phone = false;
    const real = cloud.clientFor('phone');
    const writeChangesNothing = { auth: real.auth, from: () => {
      const chain = real.from() as Record<string, unknown>;
      chain.update = () => { chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ data: [], error: null, status: 200 }).then(resolve); return chain; };
      return chain;
    } };
    await phone.syncSharedDocumentArchiveWithCloud({ client: writeChangesNothing as never, ownerId: 'owner-a', timeoutMs: 150 });
    expect([...phone.sharedDocumentArchiveView().waitingIds]).toEqual([PERMIT]);
    expect([...phone.sharedDocumentArchiveView().refusedIds]).toEqual([PERMIT]);
    expect(phone.sharedDocumentArchiveView().notices).toEqual([]);
  });

  it('a RESTORE waiting for a document that is gone from the cloud has nothing left to do: nothing is sent, nothing waits, nothing is said', async () => {
    cloud.row(PERMIT)!.archived_at = T('09:00:00.000');
    const ipad = await start('ipad');
    await sync(ipad, cloud, 'ipad');
    cloud.state.offline.ipad = true;
    await ipad.requestSharedDocumentArchive(PERMIT, false, undefined, 'Grading permit');
    cloud.remove(PERMIT);
    cloud.state.offline.ipad = false;
    await sync(ipad, cloud, 'ipad');
    expect(cloud.writes).toEqual([]);
    expect(ipad.sharedDocumentArchiveView().waitingRestores).toEqual([]);
    expect(ipad.sharedDocumentArchiveNextTryInMs()).toBeNull();
    expect(ipad.sharedDocumentArchiveView().notices).toEqual([]);
  });
});

describe('two accounts on one phone, on this batch\'s code', () => {
  // The reviewer's case, as he wrote it, with the one name this batch changed: when the next try is due is asked of
  // sharedDocumentArchiveNextTryInMs() (running time), where it was read from the view's "nextTryAt" (the clock).
  it('sound: B never sends A\'s waiting tap, never sees A\'s list, lines or waiting Restore; A\'s tap goes up when A is back', async () => {
    cloud.add('doc-b', 'owner-b');
    cloud.add('doc-a2');
    cloud.row('doc-a2')!.archived_at = T('08:00:00.000');
    const asA = await start('phone', 'owner-a');
    await sync(asA, cloud, 'phone');
    cloud.state.offline.phone = true;
    await asA.requestSharedDocumentArchive(PERMIT, true, T('18:00:00.000'), 'Grading permit');
    await asA.requestSharedDocumentArchive('doc-a2', false, T('18:00:10.000'), 'Site contract');
    await sync(asA, cloud, 'phone');
    expect(asA.sharedDocumentArchiveView().waitingRestores).toHaveLength(1);
    await asA.sharedDocumentArchiveSettled();
    cloud.state.offline.phone = false;

    // B signs in. Worst case: the saved copy was NOT swapped for B's.
    cloud.state.signedIn.phone = 'owner-b';
    const asB = await start('phone', 'owner-b');
    const viewB = asB.sharedDocumentArchiveView();
    expect({ hidden: hiddenOn(asB), waiting: [...viewB.waitingIds], restores: viewB.waitingRestores, notices: viewB.notices, next: asB.sharedDocumentArchiveNextTryInMs() })
      .toEqual({ hidden: [], waiting: [], restores: [], notices: [], next: null });
    await sync(asB, cloud, 'phone', 'owner-b');
    await sync(asB, cloud, 'phone', 'owner-a'); // a pass left running for A, with B signed in
    await asB.requestSharedDocumentArchive('doc-b', true, T('19:00:00.000'));
    await sync(asB, cloud, 'phone', 'owner-b');
    expect(cloud.writes.filter(write => write.id !== 'doc-b')).toEqual([]);
    expect({ permit: archivedInCloud(cloud, PERMIT), a2: archivedInCloud(cloud, 'doc-a2'), b: archivedInCloud(cloud, 'doc-b') })
      .toEqual({ permit: false, a2: true, b: true });
    expect(hiddenOn(asB)).toEqual(['doc-b']);
    await asB.sharedDocumentArchiveSettled();

    cloud.state.signedIn.phone = 'owner-a';
    const asAAgain = await start('phone', 'owner-a');
    expect(hiddenOn(asAAgain)).toEqual([PERMIT]);
    await sync(asAAgain, cloud, 'phone', 'owner-a');
    expect({ permit: archivedInCloud(cloud, PERMIT), a2: archivedInCloud(cloud, 'doc-a2'), b: archivedInCloud(cloud, 'doc-b') })
      .toEqual({ permit: true, a2: false, b: true });
    expect(hiddenOn(asAAgain)).toEqual([PERMIT]);
  });

  it('what this batch added is per account too: A\'s line about a tap that was not sent, the card it asks to be put back, and A\'s wait after a refusal are never B\'s', async () => {
    // The same document id in both accounts, on purpose: nothing may be shared by the id alone.
    cloud.add(PERMIT, 'owner-b');
    cloud.rows.filter(row => row.id === PERMIT && row.owner_id === 'owner-a')[0].archived_at = T('09:00:00.000');
    const asA = await start('phone', 'owner-a');
    await sync(asA, cloud, 'phone');
    // A, with no signal: Restore, then Archive. Meanwhile it is restored on A's iPad: A's Archive will be let go.
    cloud.state.offline.phone = true;
    await asA.requestSharedDocumentArchive(PERMIT, false);
    await asA.requestSharedDocumentArchive(PERMIT, true, T('09:30:00.000'), 'Grading permit');
    cloud.rows.filter(row => row.id === PERMIT && row.owner_id === 'owner-a')[0].archived_at = null;
    cloud.state.offline.phone = false;
    await sync(asA, cloud, 'phone');
    expect(asA.sharedDocumentArchiveView().notices.map(notice => notice.why)).toEqual(['restored_on_another_device']);
    expect(asA.sharedDocumentArchiveView().restoredElsewhere).toEqual([PERMIT]);
    // A second document of A's is refused: it waits half a minute.
    cloud.add('doc-a2');
    let appHasRun = 10_000;
    const running = () => appHasRun;
    await asA.requestSharedDocumentArchive('doc-a2', true, T('09:40:00.000'));
    cloud.state.failWritesWith = { code: '57014', message: 'canceling statement due to statement timeout' };
    await sync(asA, cloud, 'phone', 'owner-a', { running });
    expect(asA.sharedDocumentArchiveNextTryInMs(running)).toBe(30_000);
    cloud.state.failWritesWith = null;

    // B signs in on the same phone, in the same run of the app (the same copy of the service).
    cloud.state.signedIn.phone = 'owner-b';
    await asA.openSharedDocumentArchive('owner-b');
    const viewB = asA.sharedDocumentArchiveView();
    expect({ notices: viewB.notices, cardsToPutBack: viewB.restoredElsewhere, waiting: [...viewB.waitingIds], hidden: [...viewB.archivedIds], next: asA.sharedDocumentArchiveNextTryInMs(running) })
      .toEqual({ notices: [], cardsToPutBack: [], waiting: [], hidden: [], next: null });
    // B archives B's own document of the same id: it is sent at once (A's wait is not B's), and only B's row changes.
    await sync(asA, cloud, 'phone', 'owner-b', { running }); // B's first answer from the cloud on this phone
    const writesBefore = cloud.writes.length;
    await asA.requestSharedDocumentArchive(PERMIT, true, T('10:00:00.000'));
    await sync(asA, cloud, 'phone', 'owner-b', { running });
    expect(cloud.writes.slice(writesBefore).map(write => write.changed)).toEqual([1]);
    expect(cloud.rows.filter(row => row.id === PERMIT).map(row => [row.owner_id, Boolean(row.archived_at)])).toEqual([['owner-a', false], ['owner-b', true]]);
    expect(asA.sharedDocumentArchiveView().notices).toEqual([]);
    await asA.sharedDocumentArchiveSettled();
    // What is saved keeps the two apart.
    const raw = JSON.parse([...deviceStorage.phone.values()][0]).owners as Record<string, { notices: unknown[]; waiting: Array<{ documentId: string }>; marks: Record<string, string> }>;
    expect(raw['owner-a'].notices).toHaveLength(1);
    expect(raw['owner-a'].waiting.map(item => item.documentId)).toEqual(['doc-a2']);
    expect(raw['owner-b'].notices).toEqual([]);
    expect(raw['owner-b'].waiting).toEqual([]);
    expect(Object.keys(raw['owner-b'].marks)).toEqual([PERMIT]);
    // A is back: A's line is still there for A, and A's refused Archive goes up once its own wait is over.
    cloud.state.signedIn.phone = 'owner-a';
    await asA.openSharedDocumentArchive('owner-a');
    expect(asA.sharedDocumentArchiveView().notices.map(notice => notice.why)).toEqual(['restored_on_another_device']);
    await sync(asA, cloud, 'phone', 'owner-a', { running });
    expect(archivedInCloud(cloud, 'doc-a2')).toBe(false); // its half minute is not over
    appHasRun += 31_000;
    await sync(asA, cloud, 'phone', 'owner-a', { running });
    expect(archivedInCloud(cloud, 'doc-a2')).toBe(true);
  });
});

/**
 * The reviewer's tables, in small. He ran 300 sequences in each cell; here 25
 * in each, because a long random run in one process crashes the test runner
 * on a busy machine. The whole tables (300 a cell, in parts of 100) are in
 * the fixer's notes, before and after.
 *
 * Two things are held for every seed under every clock setting:
 * - no sequence ends different from his last tap without a line on the
 *   device whose tap was not sent, and every device ends showing what the
 *   cloud holds;
 * - the end state is THE SAME whatever the clocks say: the same steps, the
 *   same writes in the same order, the same lines, the same lists.
 */
describe('P2-M1 (how often): the reviewer\'s random sequences under wrong clocks', () => {
  const CLOCKS: Array<[string, Partial<Record<DeviceName, number>>]> = [
    ['the phone two hours slow', { phone: -120 }],
    ['the phone two minutes slow (taps in these sequences are a minute apart)', { phone: -2 }],
    ['the phone two hours fast', { phone: 120 }],
    ['the iPad two hours slow', { ipad: -120 }],
    ['the iPad two minutes slow', { ipad: -2 }],
    ['the iPad two hours fast', { ipad: 120 }],
  ];
  const SEEDS = 25;
  const rightClocks: Record<string, string[]> = {};
  async function endStates(signalDrops: boolean, clockOffsetMinutes: Partial<Record<DeviceName, number>>) {
    const states: string[] = [];
    const silent: string[] = [];
    const unsettled: number[] = [];
    for (let seed = 1; seed <= SEEDS; seed += 1) {
      const { differs, endState, settled, log } = await runRandomTaps(seed, { signalDrops, clockOffsetMinutes });
      states.push(endState);
      if (!settled) unsettled.push(seed);
      const untold = differs.filter(item => !item.toldWhereHeTapped);
      if (untold.length) silent.push(`seed ${seed}: ${untold.map(item => item.text).join('; ')} || ${log.join(' | ')}`);
    }
    return { states, silent, unsettled };
  }

  describe.each([['signal throughout', false], ['signal coming and going', true]])('%s', (_mode, signalDrops) => {
    it('both clocks right: none ends different from his last tap with no line', async () => {
      const { states, silent, unsettled } = await endStates(signalDrops, {});
      rightClocks[String(signalDrops)] = states;
      expect({ silent, unsettled }).toEqual({ silent: [], unsettled: [] });
    }, 120_000);

    it.each(CLOCKS)('%s: none ends different from his last tap with no line, and every sequence ends exactly as it does with both clocks right', async (_label, clockOffsetMinutes) => {
      const { states, silent, unsettled } = await endStates(signalDrops, clockOffsetMinutes);
      expect({ silent, unsettled }).toEqual({ silent: [], unsettled: [] });
      const right = rightClocks[String(signalDrops)];
      expect(right).toHaveLength(SEEDS);
      const differentSeeds = states.flatMap((state, index) => (state === right[index] ? [] : [index + 1]));
      expect(differentSeeds).toEqual([]);
    }, 120_000);
  });
});
