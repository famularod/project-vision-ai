import { fireEvent, render, screen } from '@testing-library/react-native';

import { ScheduleCommittedPercentField } from '../../components/ScheduleCommittedFields';

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
