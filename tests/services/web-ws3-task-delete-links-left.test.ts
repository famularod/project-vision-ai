import { daveWebTaskDeletedNotice } from '../../services/DAVEWebOperations';

// Review pass 1, web L6 (6 Oct 2026; caused by WS1 item 8). After Delete Task on the web, when the links other tasks
// had to the deleted task could not all be taken away, he was told "N other tasks still list it as a predecessor,
// because they were being changed on another device at that moment." for ANY failure, a dropped connection or an
// ended sign-in included; and N counted saved rows he cannot open. Each kind of failure now has its own, true,
// sentence, and the count is of tasks the schedule shows.

jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() }));

const DELETED = 'Task deleted and protected from returning on another device.';
const none = { changedElsewhere: 0, notSaved: 0, signedOut: 0 };

describe('what he is told after Delete Task about links that could not be taken (review pass 1, web L6)', () => {
  it('nothing left: the delete alone', () => {
    expect(daveWebTaskDeletedNotice(null)).toBe(DELETED);
    expect(daveWebTaskDeletedNotice(none)).toBe(DELETED);
  });

  it('another device was changing the task: said so, one task or several', () => {
    expect(daveWebTaskDeletedNotice({ ...none, changedElsewhere: 1 })).toBe(`${DELETED} 1 other task still lists it as a predecessor, because it was being changed on another device at that moment. Open that task in Schedule and untick the deleted task.`);
    expect(daveWebTaskDeletedNotice({ ...none, changedElsewhere: 3 })).toBe(`${DELETED} 3 other tasks still list it as a predecessor, because they were being changed on another device at that moment. Open those tasks in Schedule and untick the deleted task.`);
  });

  it('the change could not be saved: no other device is blamed', () => {
    expect(daveWebTaskDeletedNotice({ ...none, notSaved: 1 })).toBe(`${DELETED} 1 other task still lists it as a predecessor, because the change to it could not be saved just then (the connection may have dropped). Open that task in Schedule and untick the deleted task.`);
    expect(daveWebTaskDeletedNotice({ ...none, notSaved: 2 })).toBe(`${DELETED} 2 other tasks still list it as a predecessor, because the change to them could not be saved just then (the connection may have dropped). Open those tasks in Schedule and untick the deleted task.`);
    expect(daveWebTaskDeletedNotice({ ...none, notSaved: 2 })).not.toMatch(/another device at that moment/);
  });

  it('the sign-in was no longer accepted: said so, with what to do first', () => {
    expect(daveWebTaskDeletedNotice({ ...none, signedOut: 1 })).toBe(`${DELETED} 1 other task still lists it as a predecessor, because this browser's sign-in was no longer accepted when its link was to be removed. Sign in again, then open that task in Schedule and untick the deleted task.`);
    expect(daveWebTaskDeletedNotice({ ...none, signedOut: 2 })).toBe(`${DELETED} 2 other tasks still list it as a predecessor, because this browser's sign-in was no longer accepted when their links were to be removed. Sign in again, then open those tasks in Schedule and untick the deleted task.`);
  });

  it('two kinds at once: each count with its own reason', () => {
    expect(daveWebTaskDeletedNotice({ changedElsewhere: 1, notSaved: 2, signedOut: 0 })).toBe(`${DELETED} 1 other task still lists it as a predecessor, because it was being changed on another device at that moment; 2 more still list it, because the change to them could not be saved just then (the connection may have dropped). Open those tasks in Schedule and untick the deleted task.`);
    expect(daveWebTaskDeletedNotice({ changedElsewhere: 2, notSaved: 0, signedOut: 1 })).toBe(`${DELETED} 2 other tasks still list it as a predecessor, because they were being changed on another device at that moment; 1 more still lists it, because this browser's sign-in was no longer accepted when its link was to be removed. Sign in again, then open those tasks in Schedule and untick the deleted task.`);
  });

  it('cut short, and the cloud could not be read again: "up to", since some of the links may have been taken', () => {
    expect(daveWebTaskDeletedNotice({ ...none, notSaved: 3, unsure: true })).toBe(`${DELETED} Up to 3 other tasks may still list it as a predecessor: removing those links was interrupted, and the schedule could not then be read from the cloud to finish (the connection may have dropped). Open those tasks in Schedule and untick the deleted task where it is still listed.`);
    // One task shown among several rows whose save was cut short: "may", and one task.
    expect(daveWebTaskDeletedNotice({ ...none, notSaved: 1, unsure: true })).toBe(`${DELETED} 1 other task may still list it as a predecessor: removing the links was interrupted, and the schedule could not then be read from the cloud to finish (the connection may have dropped). Open that task in Schedule and untick the deleted task if it is still listed.`);
    expect(daveWebTaskDeletedNotice({ ...none, signedOut: 1, unsure: true })).toBe(`${DELETED} 1 other task may still list it as a predecessor, because this browser's sign-in was no longer accepted before every link was removed. Sign in again, then open that task in Schedule and untick the deleted task if it is still listed.`);
    expect(daveWebTaskDeletedNotice({ ...none, signedOut: 2, unsure: true })).toBe(`${DELETED} Up to 2 other tasks may still list it as a predecessor, because this browser's sign-in was no longer accepted before every link was removed. Sign in again, then open those tasks in Schedule and untick the deleted task where it is still listed.`);
  });
});
