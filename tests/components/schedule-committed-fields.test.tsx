import { fireEvent, render, screen } from '@testing-library/react-native';

import {
  ScheduleCommittedPercentField,
  ScheduleCommittedTextField,
} from '../../components/ScheduleCommittedFields';
import { noteSignedInOwner } from '../../services/CloudOwnerBinding';

const sharedProps = {
  maximum: 100,
  disabled: false,
  onCommit: jest.fn(),
  labelStyle: {},
  inputStyle: {},
  mutedColor: '#777777',
};

describe('ScheduleCommittedPercentField', () => {
  beforeEach(() => {
    sharedProps.onCommit.mockClear();
  });

  it('shows a newer authoritative percentage even when the field was focused', () => {
    const { rerender } = render(
      <ScheduleCommittedPercentField value={80} {...sharedProps} />,
    );
    const input = screen.getByLabelText('Percent Complete');

    fireEvent(input, 'focus');
    rerender(<ScheduleCommittedPercentField value={95} {...sharedProps} />);

    expect(screen.getByLabelText('Percent Complete').props.value).toBe('95');
  });

  it('continues to stage sanitized percentage edits immediately', () => {
    render(<ScheduleCommittedPercentField value={80} {...sharedProps} />);

    fireEvent.changeText(screen.getByLabelText('Percent Complete'), '95%');

    expect(sharedProps.onCommit).toHaveBeenCalledWith(95);
    expect(screen.getByLabelText('Percent Complete').props.value).toBe('95');
  });
});

describe('ScheduleCommittedTextField removed while typing (audit A2 pass 2 M2)', () => {
  const textProps = {
    label: 'Owner', placeholder: 'PLZ owner / internal owner', labelStyle: {}, inputStyle: {}, mutedColor: '#777777',
  };
  beforeEach(() => noteSignedInOwner('owner-a'));

  it('saves what was typed when the field goes without a blur (another task, a tab, the rail list)', () => {
    const onCommit = jest.fn();
    const view = render(<ScheduleCommittedTextField value="" onCommit={onCommit} {...textProps} />);
    const field = screen.getByPlaceholderText('PLZ owner / internal owner');
    fireEvent(field, 'focus');
    fireEvent.changeText(field, '  ABC Electric ');
    view.unmount();
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith('ABC Electric');
  });

  it('saves once when the blur came first, and not at all when nothing changed', () => {
    const onCommit = jest.fn();
    const first = render(<ScheduleCommittedTextField value="" onCommit={onCommit} {...textProps} />);
    const field = screen.getByPlaceholderText('PLZ owner / internal owner');
    fireEvent(field, 'focus');
    fireEvent.changeText(field, 'ABC Electric');
    fireEvent(field, 'blur');
    first.unmount();
    expect(onCommit).toHaveBeenCalledTimes(1);

    onCommit.mockClear();
    const second = render(<ScheduleCommittedTextField value="Kept" onCommit={onCommit} {...textProps} />);
    fireEvent(screen.getByPlaceholderText('PLZ owner / internal owner'), 'focus');
    second.unmount();
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('never saves into another account: an account change while typing drops the text', () => {
    const onCommit = jest.fn();
    const view = render(<ScheduleCommittedTextField value="" onCommit={onCommit} {...textProps} />);
    const field = screen.getByPlaceholderText('PLZ owner / internal owner');
    fireEvent(field, 'focus');
    fireEvent.changeText(field, 'ABC Electric');
    noteSignedInOwner(null);
    view.unmount();
    expect(onCommit).not.toHaveBeenCalled();
  });
});
