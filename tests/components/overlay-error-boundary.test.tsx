import { act, render } from '@testing-library/react-native';
import { useState } from 'react';
import { Alert, Text } from 'react-native';

import { OverlayErrorBoundary } from '../../components/overlay-error-boundary';
import { getStartupDiagnostics } from '../../services/StartupDiagnostics';
import type { AppScreen } from '../../types/app-navigation';

// Audit A2 pass 2 (30 Sep 2026): a sheet's render error closes every sheet and
// retries once; a second error with everything closed stays empty until the
// screen changes.
const originalError = console.error;
beforeAll(() => { console.error = () => undefined; });
afterAll(() => { console.error = originalError; });

const overlayCatches = () => getStartupDiagnostics()
  .filter(event => event.stage === 'error_boundary_caught' && event.context?.scope === 'overlay').length;

function Sheet({ open, throwsWhen }: { open: boolean; throwsWhen: 'open' | 'always' | 'never' }) {
  if (throwsWhen === 'always' || (throwsWhen === 'open' && open)) throw new Error('bad sheet');
  return <Text>{open ? 'sheet open' : 'sheet closed'}</Text>;
}

let control: { open: (value: boolean) => void; screen: (value: AppScreen) => void } | null = null;
function Harness({ throwsWhen, onError }: { throwsWhen: 'open' | 'always' | 'never'; onError: jest.Mock }) {
  const [open, setOpen] = useState(false);
  const [screen, setScreen] = useState<AppScreen>('Home');
  control = { open: setOpen, screen: setScreen };
  return (
    <OverlayErrorBoundary screen={screen} onError={() => { onError(); setOpen(false); }}>
      <Sheet open={open} throwsWhen={throwsWhen} />
    </OverlayErrorBoundary>
  );
}

describe('OverlayErrorBoundary', () => {
  it('closes the sheets, tells the owner, and renders again; a later fault gets the same recovery', () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const onError = jest.fn();
    const tree = render(<Harness throwsWhen="open" onError={onError} />);
    const before = overlayCatches();
    act(() => control!.open(true));
    expect(onError).toHaveBeenCalledTimes(1);
    expect(alert).toHaveBeenCalledTimes(1);
    expect(tree.getByText('sheet closed')).toBeTruthy();
    expect(overlayCatches()).toBe(before + 1);
    act(() => control!.open(true));
    expect(onError).toHaveBeenCalledTimes(2);
    expect(tree.getByText('sheet closed')).toBeTruthy();
    alert.mockRestore();
  });

  it('stays empty after a second error with everything closed, until the screen changes', () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const onError = jest.fn();
    const before = overlayCatches();
    const tree = render(<Harness throwsWhen="always" onError={onError} />);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(overlayCatches()).toBe(before + 2);
    expect(tree.toJSON()).toBeNull();
    act(() => control!.open(false));
    expect(overlayCatches()).toBe(before + 2);
    act(() => control!.screen('Admin'));
    expect(onError).toHaveBeenCalledTimes(2);
    expect(overlayCatches()).toBe(before + 4);
    alert.mockRestore();
  });
});
