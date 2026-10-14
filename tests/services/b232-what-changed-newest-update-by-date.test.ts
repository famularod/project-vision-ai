/**
 * Build 232 item 3, part 3 (the coordinator's decision): the runtime's own "what changed" sentence takes the newest
 * field update by its date, by the rule the written report already reads them by (fieldUpdatesNewestFirst).
 *
 * services/PIEEvidenceFusion.ts wrote "Latest update: ... Latest photo: ..." from the FIRST update in the list this
 * device holds. A device that records an update holds it at the front of its list; a device that receives it by
 * sync holds it at the end: the two devices' intelligence was handed two different "latest" updates. This is the
 * sentence the runtime keeps as intelligentSummary.whatChanged (its briefings' "what changed", and what memory
 * recall, pattern matching and evidence quality are given as the new evidence). It is read on the day, not sent,
 * so its count of days stays ("Due in 4 days").
 *
 * Synthetic data. No network.
 */
import { buildFusedEvidence } from '../../services/PIEEvidenceFusion';
import type { ProjectUpdate, ScheduleItem } from '../../types';

const NOW = '2026-10-05T16:00:00.000Z';
beforeEach(() => {
  jest.useFakeTimers({ now: Date.parse(NOW), doNotFake: ['nextTick', 'setImmediate', 'setInterval', 'setTimeout', 'clearTimeout', 'clearInterval', 'queueMicrotask'] });
});
afterEach(() => jest.useRealTimers());

const pour = {
  id: 'pour', projectName: 'Tower', scheduleProjectName: 'Tower', locationName: 'Level 1', taskName: 'Pour slab',
  startDate: '09/01/2026', finishDate: '10/09/2026', milestone: '', owner: 'Dana', contractor: 'Acme',
  percentComplete: 40, priority: 'Medium', status: 'In Progress', notes: '',
  createdAt: '2026-09-01T12:00:00.000Z', updatedAt: '2026-09-20T12:00:00.000Z',
} as unknown as ScheduleItem;
const update = (id: string, date: string, notes: string, caption: string) => ({
  id, projectName: 'Tower', scheduleProjectName: 'Tower', date, recipients: { contactIds: [] }, notes, status: 'sent',
  scheduleItemId: 'pour', scheduleTaskName: 'Pour slab', selectedAreaName: 'Level 1',
  photos: caption ? [{
    id: `p-${id}`, uri: `file:///photos/${id}.jpg`, caption, category: 'Progress', actionRequired: '', actionOwner: '', actionDueDate: '',
    actionStatus: 'Open', fileName: `${id}.jpg`, mimeType: 'image/jpeg', selectedAreaName: 'Level 1',
  }] : [],
}) as unknown as ProjectUpdate;
// Recorded in this order; the last two on one day (the app saves a day, with no time of day).
const U1 = update('u1', '2026-10-01', 'Slab forms are set on the east bay.', 'East bay forms');
const U2 = update('u2', '2026-10-03', 'Primer started in the lobby.', 'Lobby primer');
const U3 = update('u3', '2026-10-03', 'West bay rebar failed inspection. Pour is on hold.', 'West bay rebar');
const whatChanged = (updates: ProjectUpdate[], currentUpdate: ProjectUpdate | null = null) =>
  buildFusedEvidence({ projectName: 'Tower', projectNames: ['Tower'], updates, currentUpdate, scheduleItems: [pour], knownScheduleItems: [pour], now: new Date(NOW) })
    .intelligentSummary.whatChanged;

describe('B232 item 3 part 3: the runtime\'s "what changed" sentence takes the newest update by its date', () => {
  it('the same sentence on the device that recorded the updates and on the one that received the newest by sync', () => {
    const onThePhone = whatChanged([U3, U2, U1]);    // each new one at the front
    const onTheIpad = whatChanged([U2, U1, U3]);     // the one received by sync at the end
    const oldestFirst = whatChanged([U1, U2, U3]);
    expect(onThePhone).toBe('Latest update: West bay rebar failed inspection. Pour is on hold. Latest photo: West bay rebar Schedule focus: Pour slab (Due in 4 days).');
    expect({ onTheIpad, oldestFirst }).toEqual({ onTheIpad: onThePhone, oldestFirst: onThePhone });
  });

  it('the photo is the newest update\'s that has one, not the first in the list', () => {
    const noPhoto = update('u4', '2026-10-04', 'Pump truck is booked for Tuesday.', '');
    for (const updates of [[noPhoto, U3, U2, U1], [U1, U2, U3, noPhoto], [U2, noPhoto, U1, U3]]) {
      expect(whatChanged(updates)).toBe('Latest update: Pump truck is booked for Tuesday. Latest photo: West bay rebar Schedule focus: Pour slab (Due in 4 days).');
    }
  });

  it('its count of days stays: it is read on the day, not sent', () => {
    expect(whatChanged([U3, U2, U1])).toContain('Schedule focus: Pour slab (Due in 4 days).');
    jest.useFakeTimers({ now: Date.parse('2026-10-11T16:00:00.000Z'), doNotFake: ['nextTick', 'setImmediate', 'setInterval', 'setTimeout', 'clearTimeout', 'clearInterval', 'queueMicrotask'] });
    expect(whatChanged([U3, U2, U1])).toContain('Schedule focus: Pour slab (2 days overdue).');
  });

  it('an update he is writing today, not saved yet, is the latest, as before', () => {
    const draft = update('u9', '2026-10-05', 'Anchor bolts are set at the north wall.', 'Anchor bolts');
    expect(whatChanged([U2, U1, U3], draft)).toBe('Latest update: Anchor bolts are set at the north wall. Latest photo: Anchor bolts Schedule focus: Pour slab (Due in 4 days).');
  });
});
