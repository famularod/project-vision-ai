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
