/**
 * Whole-app audit A2 M3: a navigation waits for a focused text field to let
 * go, so a field that saves on blur (a task's Owner) saves before its screen
 * goes. With nothing focused it runs at once.
 */
import { Keyboard, TextInput } from 'react-native';
import { afterTextInputBlur, TEXT_INPUT_BLUR_SETTLE_MS } from '../../components/after-text-input-blur';

describe('afterTextInputBlur (audit A2 M3)', () => {
  const state = TextInput.State as unknown as { currentlyFocusedInput: () => unknown };
  let focused: unknown = null;
  let focusSpy: jest.SpyInstance;
  let dismissSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.useFakeTimers();
    focused = null;
    focusSpy = jest.spyOn(state, 'currentlyFocusedInput').mockImplementation(() => focused);
    dismissSpy = jest.spyOn(Keyboard, 'dismiss').mockImplementation(() => undefined);
  });
  afterEach(() => {
    focusSpy.mockRestore();
    dismissSpy.mockRestore();
    jest.useRealTimers();
  });

  it('navigates at once when nothing is being typed', () => {
    const action = jest.fn();
    afterTextInputBlur(action);
    expect(action).toHaveBeenCalledTimes(1);
    expect(dismissSpy).not.toHaveBeenCalled();
  });

  it('lets a focused field blur and save first', () => {
    focused = {};
    const action = jest.fn();
    afterTextInputBlur(action);
    expect(dismissSpy).toHaveBeenCalledTimes(1);
    expect(action).not.toHaveBeenCalled();
    jest.advanceTimersByTime(TEXT_INPUT_BLUR_SETTLE_MS);
    expect(action).toHaveBeenCalledTimes(1);
  });
});
