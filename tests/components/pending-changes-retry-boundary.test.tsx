import { act, cleanup, render } from '@testing-library/react-native';
import { AppState, Text } from 'react-native';

const mockStart = jest.fn();
const mockStop = jest.fn();
const mockRequest = jest.fn();

jest.mock('../../services/SyncService', () => ({
  startPendingChangesRetryController: () => mockStart(),
  stopPendingChangesRetryController: () => mockStop(),
  requestPendingChangesUpload: (trigger: string) => mockRequest(trigger),
}));

import { PendingChangesRetryBoundary } from '../../components/pending-changes-retry-boundary';

describe('PendingChangesRetryBoundary', () => {
  let appStateListener: ((state: string) => void) | null = null;
  const remove = jest.fn();

  beforeEach(() => {
    appStateListener = null;
    remove.mockReset();
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, listener) => {
      appStateListener = listener as (state: string) => void;
      return { remove };
    });
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  it('starts once, retries on foreground, and stops cleanly', () => {
    const screen = render(
      <PendingChangesRetryBoundary>
        <Text>Application</Text>
      </PendingChangesRetryBoundary>,
    );

    expect(mockStart).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Application')).toBeTruthy();

    act(() => {
      appStateListener?.('background');
      appStateListener?.('active');
    });
    expect(mockRequest).toHaveBeenCalledTimes(1);
    expect(mockRequest).toHaveBeenCalledWith('app_foreground');

    screen.unmount();
    expect(remove).toHaveBeenCalledTimes(1);
    expect(mockStop).toHaveBeenCalledTimes(1);
  });
});
