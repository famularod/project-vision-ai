/**
 * Whole-app audit A2 M4: the root crash screen is also shown for a crash
 * mid-session. It no longer says "could not finish starting" or points at
 * diagnostics it cannot reach, it asks the owner not to delete the app, and
 * Retry is a button for VoiceOver.
 */
import { fireEvent, render } from '@testing-library/react-native';
import { Text } from 'react-native';
import { StartupErrorBoundary } from '../../components/StartupErrorBoundary';

describe('root crash screen (audit A2 M4)', () => {
  it('says what to do, and Retry is a button that renders the app again', () => {
    let fail = true;
    function Screen() {
      if (fail) throw new Error('render failed');
      return <Text>Overview</Text>;
    }
    const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const tree = render(<StartupErrorBoundary><Screen /></StartupErrorBoundary>);
    spy.mockRestore();
    expect(tree.getByText('Vitruvius hit a problem.')).toBeTruthy();
    expect(tree.getByText(/do not delete the app/)).toBeTruthy();
    expect(tree.queryByText(/diagnostics/i)).toBeNull();
    fail = false;
    fireEvent.press(tree.getByRole('button', { name: 'Retry' }));
    expect(tree.getByText('Overview')).toBeTruthy();
  });
});
