import { buildVitruviusReviewQueue } from '../../services/VitruviusReviewQueue';
import type { ScheduleItem } from '../../types';
import { emptyProjectControls } from '../../services/VitruviusProjectControls';

describe('VitruviusReviewQueue', () => {
  test('includes only open reviews assigned to the signed-in approver', () => {
    const queue = buildVitruviusReviewQueue({
      displayName: 'David Famularo',
      email: 'famularod@gmail.com',
      items: [
        item('pending', 'Pending', [' FAMULAROD@GMAIL.COM ']),
        item('changes', 'Changes Requested', ['David Famularo']),
        item('other', 'Pending', ['other@example.com']),
        { ...item('closed', 'Pending', ['David Famularo']), status: 'Complete', percentComplete: 100 },
      ],
    });

    expect(queue.items.map(value => value.id)).toEqual(['changes', 'pending']);
    expect(queue.pending).toBe(1);
    expect(queue.changesRequested).toBe(1);
  });
});

function item(
  id: string,
  approvalStatus: 'Pending' | 'Changes Requested',
  approvers: string[],
): ScheduleItem {
  return {
    id,
    projectName: '2321 Compliance Project',
    scheduleProjectName: '2321 Compliance Project',
    locationName: 'North Lot',
    taskName: id,
    startDate: '',
    finishDate: '2026-08-01',
    milestone: '',
    owner: '',
    contractor: '',
    durationDays: 1,
    percentComplete: 0,
    priority: 'Medium',
    status: 'Not Started',
    notes: '',
    nextAction: '',
    activity: [],
    projectControls: {
      ...emptyProjectControls(),
      approvalStatus,
      approvers,
    },
    createdAt: '2026-07-28T12:00:00.000Z',
    updatedAt: '2026-07-28T12:00:00.000Z',
  };
}
