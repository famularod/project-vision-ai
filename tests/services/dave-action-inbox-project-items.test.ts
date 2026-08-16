import { buildDAVEActionInbox } from '../../services/DAVEActionInbox';
import type { ScheduleItem } from '../../types';

function scheduleItem(overrides: Partial<ScheduleItem> = {}): ScheduleItem {
  return {
    id: 'issue-1',
    itemType: 'Issue',
    projectName: '2375 Compliance Project',
    scheduleProjectName: '2375 Compliance Project',
    locationName: 'Canopy C',
    taskName: 'Missing storefront glass',
    startDate: '2026-07-20',
    finishDate: '2026-07-23',
    milestone: '',
    owner: 'Project manager',
    contractor: 'Glazing contractor',
    percentComplete: 0,
    priority: 'High',
    status: 'Waiting',
    notes: '',
    nextAction: 'Confirm the delivery date with the glazing contractor.',
    activity: [],
    createdAt: '2026-07-20T16:00:00.000Z',
    ...overrides,
  };
}

describe('DAVE action inbox project items', () => {
  it('surfaces the PM-authored next action for urgent project items', () => {
    const inbox = buildDAVEActionInbox({
      scheduleItems: [scheduleItem()],
      now: new Date('2026-07-22T12:00:00.000Z'),
    });

    expect(inbox.items).toHaveLength(1);
    expect(inbox.items[0]).toMatchObject({
      scheduleItemId: 'issue-1',
      requestedAction: 'Confirm the delivery date with the glazing contractor.',
      owner: 'Project manager',
    });
  });
});
