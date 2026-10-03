import { act, fireEvent, render, screen } from '@testing-library/react-native';

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

// Whole-app audit A3 pass 6 L2 (30 Sep 2026): a task's Owner and Contractor
// use the same draft as Project controls; left unchanged after another device
// changed it, the field showed the old text and a later edit started from it.
describe('ScheduleCommittedTextField left unchanged (audit A3 pass 6 L2)', () => {
  const textProps = {
    label: 'Owner', placeholder: 'PLZ owner / internal owner', labelStyle: {}, inputStyle: {}, mutedColor: '#777777',
  };
  beforeEach(() => noteSignedInOwner('owner-a'));

  it('shows the other device\'s value after End Editing and Blur, saving nothing; a later edit starts from it', () => {
    const onCommit = jest.fn();
    const view = render(<ScheduleCommittedTextField value="ABC Electric" onCommit={onCommit} {...textProps} />);
    const field = () => screen.getByPlaceholderText('PLZ owner / internal owner');
    fireEvent(field(), 'focus');
    view.rerender(<ScheduleCommittedTextField value="XYZ Electric" onCommit={onCommit} {...textProps} />);
    expect(field().props.value).toBe('ABC Electric');
    // iOS sends both as the keyboard goes.
    fireEvent(field(), 'endEditing');
    fireEvent(field(), 'blur');
    expect(onCommit).not.toHaveBeenCalled();
    expect(field().props.value).toBe('XYZ Electric');

    fireEvent(field(), 'focus');
    fireEvent.changeText(field(), 'XYZ Electric Co');
    fireEvent(field(), 'submitEditing');
    fireEvent(field(), 'blur');
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith('XYZ Electric Co');
  });

  it('saves nothing when End Editing and Blur arrive before the next render', () => {
    const onCommit = jest.fn();
    const view = render(<ScheduleCommittedTextField value="ABC Electric" onCommit={onCommit} {...textProps} />);
    const field = () => screen.getByPlaceholderText('PLZ owner / internal owner');
    fireEvent(field(), 'focus');
    view.rerender(<ScheduleCommittedTextField value="XYZ Electric" onCommit={onCommit} {...textProps} />);
    const { onEndEditing, onBlur } = field().props;
    act(() => {
      onEndEditing();
      onBlur();
    });
    expect(onCommit).not.toHaveBeenCalled();
    expect(field().props.value).toBe('XYZ Electric');
  });

  it('still saves text typed after the other device\'s change, once', () => {
    const onCommit = jest.fn();
    const view = render(<ScheduleCommittedTextField value="ABC Electric" onCommit={onCommit} {...textProps} />);
    const field = () => screen.getByPlaceholderText('PLZ owner / internal owner');
    fireEvent(field(), 'focus');
    view.rerender(<ScheduleCommittedTextField value="XYZ Electric" onCommit={onCommit} {...textProps} />);
    fireEvent.changeText(field(), 'ABC Electric Inc');
    fireEvent(field(), 'endEditing');
    fireEvent(field(), 'blur');
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith('ABC Electric Inc');
    expect(field().props.value).toBe('ABC Electric Inc');
  });
});
