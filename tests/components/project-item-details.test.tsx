import { fireEvent, render } from '@testing-library/react-native';

import {
  ProjectItemDetailsEditor,
  ProjectItemNextAction,
  ProjectItemSummary,
  ProjectItemTypeBadge,
} from '../../components/project-item-details';
import type { ScheduleItem } from '../../types';

const ITEM: ScheduleItem = {
  id: 'issue-1',
  itemType: 'Issue',
  projectName: '2375 Compliance Project',
  locationName: 'Canopy C',
  taskName: 'Missing storefront glass',
  startDate: '',
  finishDate: '2026-07-24',
  milestone: '',
  owner: 'David',
  contractor: 'Glazing contractor',
  percentComplete: 0,
  priority: 'High',
  status: 'Waiting',
  notes: 'Material has not arrived.',
  nextAction: 'Confirm delivery date.',
  activity: [],
  createdAt: '2026-07-22T18:00:00.000Z',
};

describe('Project item details', () => {
  it('makes the item type and next action visible on the collapsed summary', () => {
    const screen = render(<ProjectItemSummary item={ITEM} />);
    expect(screen.getByText('Issue')).toBeTruthy();
    expect(screen.getByText('Confirm delivery date.')).toBeTruthy();
  });

  it('supports placing the item type inline while keeping the next action separate', () => {
    const typeBadge = render(<ProjectItemTypeBadge item={ITEM} />);
    const nextAction = render(<ProjectItemNextAction item={ITEM} />);

    expect(typeBadge.getByText('Issue')).toBeTruthy();
    expect(nextAction.getByText('Confirm delivery date.')).toBeTruthy();
  });

  it('edits classification and appends activity without replacing task notes', () => {
    const onUpdate = jest.fn();
    const screen = render(
      <ProjectItemDetailsEditor item={ITEM} activityAuthor="David" onUpdate={onUpdate} />,
    );

    fireEvent.press(screen.getByText('RFI'));
    expect(onUpdate).toHaveBeenCalledWith({ itemType: 'RFI' });

    fireEvent.changeText(
      screen.getByPlaceholderText('Add a progress note, decision, or follow-up'),
      'Sent the question to the architect.',
    );
    fireEvent.press(screen.getByRole('button', { name: 'Add activity' }));

    expect(onUpdate).toHaveBeenLastCalledWith({
      activity: [expect.objectContaining({
        message: 'Sent the question to the architect.',
        author: 'David',
      })],
    });
    expect(ITEM.notes).toBe('Material has not arrived.');
  });
});
