import { fireEvent, render } from '@testing-library/react-native';

import { ProjectControlsEditor } from '../../components/project-controls-editor';
import { noteSignedInOwner } from '../../services/CloudOwnerBinding';
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

  // Whole-app audit A2 pass 3 M1: the fields saved only on blur, and closing
  // the section, the task row or its sheet removed them with no blur.
  describe('removed while being typed in (audit A2 pass 3 M1)', () => {
    beforeEach(() => noteSignedInOwner('owner-a'));
    const openAndType = (placeholder: string, text: string) => {
      const onUpdate = jest.fn<void, [ProjectControls]>();
      const view = render(<ProjectControlsEditor item={ITEM} actor="David" onUpdate={onUpdate} />);
      fireEvent.press(view.getByRole('button', { name: /Project controls/i }));
      const field = view.getByPlaceholderText(placeholder);
      fireEvent(field, 'focus');
      fireEvent.changeText(field, text);
      return { view, onUpdate, field };
    };

    it.each([
      ['Person responsible', '  Maria Lopez ', { assignee: 'Maria Lopez' }],
      ['Trade or responsible company', 'XYZ Concrete', { trade: 'XYZ Concrete' }],
      ['Names or emails, separated by commas', 'Ann, Bob,Ann', { watchers: ['Ann', 'Bob'] }],
      ['Required reviewers, separated by commas', 'Owner rep', { approvers: ['Owner rep'] }],
      ['RFI, submittal, inspection, or decision number', 'RFI-042', { referenceNumber: 'RFI-042' }],
      ['0', '2.5', { estimatedScheduleImpactDays: 2.5 }],
      ['Assumptions, exposure, or mitigation', 'Crane late', { impactNotes: 'Crane late' }],
    ])('saves "%s" when the section closes with Hide', (placeholder, text, saved) => {
      const { view, onUpdate } = openAndType(placeholder, text);
      fireEvent.press(view.getByRole('button', { name: /Project controls/i }));
      expect(view.queryByPlaceholderText(placeholder)).toBeNull();
      expect(onUpdate).toHaveBeenCalledTimes(1);
      expect(onUpdate).toHaveBeenLastCalledWith(expect.objectContaining({ ...saved, updatedBy: 'David' }));
    });

    it('saves when the whole editor goes (task row collapsed, sheet closed, task deselected)', () => {
      const { view, onUpdate } = openAndType('Person responsible', 'Maria Lopez');
      view.unmount();
      expect(onUpdate).toHaveBeenCalledTimes(1);
      expect(onUpdate).toHaveBeenLastCalledWith(expect.objectContaining({ assignee: 'Maria Lopez' }));
    });

    it('saves once when the blur came first, and not at all when nothing changed', () => {
      const { view, onUpdate, field } = openAndType('Person responsible', 'Maria Lopez');
      fireEvent(field, 'blur');
      view.unmount();
      expect(onUpdate).toHaveBeenCalledTimes(1);

      const untouched = jest.fn<void, [ProjectControls]>();
      const second = render(<ProjectControlsEditor item={ITEM} actor="David" onUpdate={untouched} />);
      fireEvent.press(second.getByRole('button', { name: /Project controls/i }));
      const assignee = second.getByPlaceholderText('Person responsible');
      fireEvent(assignee, 'focus');
      fireEvent(assignee, 'blur');
      second.unmount();
      expect(untouched).not.toHaveBeenCalled();
    });

    it('never saves into another account: an account change while typing drops the text', () => {
      const { view, onUpdate } = openAndType('Person responsible', 'Maria Lopez');
      noteSignedInOwner(null);
      view.unmount();
      expect(onUpdate).not.toHaveBeenCalled();
    });

    it('keeps the text being typed when a live update changes another field', () => {
      const onUpdate = jest.fn<void, [ProjectControls]>();
      const view = render(<ProjectControlsEditor item={ITEM} actor="David" onUpdate={onUpdate} />);
      fireEvent.press(view.getByRole('button', { name: /Project controls/i }));
      const trade = view.getByPlaceholderText('Trade or responsible company');
      fireEvent(trade, 'focus');
      fireEvent.changeText(trade, 'XYZ Concr');
      view.rerender(<ProjectControlsEditor
        item={{ ...ITEM, projectControls: { ...(ITEM.projectControls || {}), impactNotes: 'From iPad' } as ProjectControls }}
        actor="David"
        onUpdate={onUpdate}
      />);
      expect(view.getByPlaceholderText('Trade or responsible company').props.value).toBe('XYZ Concr');
      expect(view.getByPlaceholderText('Assumptions, exposure, or mitigation').props.value).toBe('From iPad');
    });
  });
});
