import { fireEvent, render } from '@testing-library/react-native';

import { ProjectControlsEditor } from '../../components/project-controls-editor';
import type { ProjectControls, ScheduleItem } from '../../types';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

const ITEM: ScheduleItem = {
  id: 'task-1',
  itemType: 'Daily Log',
  scheduleProjectName: '2321 Compliance Project',
  projectName: '2321 Compliance Project',
  locationName: 'North Lot',
  taskName: 'Daily field coordination',
  startDate: '2026-07-27',
  finishDate: '2026-07-27',
  milestone: '',
  owner: 'David',
  contractor: 'General Contractor',
  percentComplete: 0,
  priority: 'Medium',
  status: 'Not Started',
  notes: '',
  createdAt: '2026-07-26T12:00:00.000Z',
};

describe('ProjectControlsEditor', () => {
  it('preserves spaces while a PM types accountability and impact text', () => {
    const onUpdate = jest.fn<void, [ProjectControls]>();
    const screen = render(
      <ProjectControlsEditor
        item={ITEM}
        actor="David"
        onUpdate={onUpdate}
      />,
    );

    fireEvent.press(screen.getByRole('button', { name: /Project controls/i }));
    const assigneeInput = screen.getByPlaceholderText('Person responsible');
    fireEvent.changeText(assigneeInput, 'David Field Lead');
    fireEvent(assigneeInput, 'blur');
    expect(onUpdate).toHaveBeenLastCalledWith(expect.objectContaining({
      assignee: 'David Field Lead',
      updatedBy: 'David',
    }));

    const impactNotesInput = screen.getByPlaceholderText(
      'Assumptions, exposure, or mitigation',
    );
    fireEvent.changeText(impactNotesInput, 'Night shift adds two days');
    fireEvent(impactNotesInput, 'blur');
    expect(onUpdate).toHaveBeenLastCalledWith(expect.objectContaining({
      impactNotes: 'Night shift adds two days',
      updatedBy: 'David',
    }));
  });

  it('offers typed project-control record and resource classifications', () => {
    const onUpdate = jest.fn<void, [ProjectControls]>();
    const screen = render(
      <ProjectControlsEditor
        item={ITEM}
        actor="David"
        onUpdate={onUpdate}
      />,
    );

    fireEvent.press(screen.getByRole('button', { name: /Project controls/i }));

    for (const label of ['Drawing', 'Document', 'Photo', 'Schedule']) {
      expect(screen.getByRole('radio', { name: label })).toBeTruthy();
    }
    for (const label of ['Person', 'Crew', 'Company', 'Equipment']) {
      expect(screen.getByRole('radio', { name: label })).toBeTruthy();
    }

    fireEvent.press(screen.getByRole('radio', { name: 'Document' }));
    fireEvent.changeText(
      screen.getByPlaceholderText('Drawing, document, photo, or schedule reference'),
      'Approved RFI 042',
    );
    fireEvent.press(screen.getByRole('button', { name: 'Link Record' }));

    expect(onUpdate).toHaveBeenLastCalledWith(expect.objectContaining({
      linkedRecords: [
        expect.objectContaining({
          kind: 'Document',
          label: 'Approved RFI 042',
        }),
      ],
    }));
  });

  it('retains an in-progress decimal until the PM leaves the schedule-impact field', () => {
    const onUpdate = jest.fn<void, [ProjectControls]>();
    const screen = render(
      <ProjectControlsEditor
        item={ITEM}
        actor="David"
        onUpdate={onUpdate}
      />,
    );

    fireEvent.press(screen.getByRole('button', { name: /Project controls/i }));
    const scheduleImpactInput = screen.getByPlaceholderText('0');
    fireEvent.changeText(scheduleImpactInput, '1.');

    expect(screen.getByPlaceholderText('0').props.value).toBe('1.');
    expect(onUpdate).not.toHaveBeenCalled();

    fireEvent(screen.getByPlaceholderText('0'), 'blur');
    expect(onUpdate).toHaveBeenLastCalledWith(expect.objectContaining({
      estimatedScheduleImpactDays: 1,
      updatedBy: 'David',
    }));
  });
});
