import { act, fireEvent, render } from '@testing-library/react-native';
import { Modal } from 'react-native';
import { ScheduleImportFlow } from '../../components/ScheduleImportFlow';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

function renderFlow(screenshotImportAvailable: boolean) {
  const onImportScreenshots = jest.fn(() => Promise.resolve(null));
  const view = render(
    <ScheduleImportFlow
      screenshotImportAvailable={screenshotImportAvailable}
      onImportFile={jest.fn(() => Promise.resolve(null))}
      onImportScreenshots={onImportScreenshots}
      onAddManually={jest.fn()}
      onApprove={jest.fn()}
      onCancel={jest.fn()}
    />,
  );

  fireEvent.press(view.getByText('Add Schedule or Task'));
  return { ...view, onImportScreenshots };
}

describe('ScheduleImportFlow screenshot OCR capability', () => {
  it('disables screenshot import and explains the Apple-only capability', () => {
    const { getByRole, getByText, onImportScreenshots } = renderFlow(false);
    const screenshotChoice = getByRole('button', {
      name: /Message or Email Screenshots\./,
    });

    expect(screenshotChoice.props.accessibilityState).toEqual({ disabled: true });
    expect(getByText('Available on iPhone and iPad')).toBeTruthy();
    fireEvent.press(screenshotChoice);
    expect(onImportScreenshots).not.toHaveBeenCalled();
  });

  it('preserves screenshot import selection when OCR is available', async () => {
    const view = renderFlow(true);
    const { getByRole, onImportScreenshots } = view;
    const screenshotChoice = getByRole('button', {
      name: /Message or Email Screenshots\./,
    });

    expect(screenshotChoice.props.accessibilityState).toEqual({ disabled: false });
    fireEvent.press(screenshotChoice);
    await act(async () => {
      view.UNSAFE_getAllByType(Modal)[0].props.onDismiss();
      await Promise.resolve();
    });
    expect(onImportScreenshots).toHaveBeenCalledTimes(1);
  });

  it('opens an uploaded schedule directly in review without a second file pick', async () => {
    const onIncomingBatchConsumed = jest.fn();
    const view = render(
      <ScheduleImportFlow
        screenshotImportAvailable={false}
        onImportFile={jest.fn(() => Promise.resolve(null))}
        onImportScreenshots={jest.fn(() => Promise.resolve(null))}
        onAddManually={jest.fn()}
        onApprove={jest.fn()}
        onCancel={jest.fn()}
        incomingBatch={{
          id: 'uploaded-schedule-1',
          kind: 'schedule_file',
          sourceCount: 1,
          sourceLabel: 'lookahead.pdf',
          message: 'One activity extracted.',
          documents: [],
          items: [{
            id: 'task-1', taskName: 'Install panels', projectName: 'Project A',
            locationName: 'Canopy A', startDate: '07/21/2026', finishDate: '07/22/2026',
            milestone: '', owner: 'David', contractor: '', durationDays: 1,
            percentComplete: 0, priority: 'Medium', status: 'Not Started', notes: '',
            createdAt: '2026-07-21T12:00:00.000Z',
          }],
        }}
        onIncomingBatchConsumed={onIncomingBatchConsumed}
      />,
    );

    expect(await view.findByText('Review Imported Schedule')).toBeTruthy();
    expect(view.getByText('Install panels')).toBeTruthy();
    expect(onIncomingBatchConsumed).toHaveBeenCalledTimes(1);
  });
});
