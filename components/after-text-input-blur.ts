import { Keyboard, TextInput } from 'react-native';

/** The wait the task Save button already gives a field's blur to save. */
export const TEXT_INPUT_BLUR_SETTLE_MS = 80;

/**
 * Runs a navigation once the focused text field has let go (whole-app audit
 * A2 M3, 30 Sep 2026). Fields that save when they lose focus (a task's Owner
 * and Contractor) were removed with the screen before their blur could save,
 * so a tab or rail tap, or another task picked while typing, dropped the
 * text. With nothing focused the navigation runs at once.
 */
export function afterTextInputBlur(action: () => void) {
  if (!TextInput.State?.currentlyFocusedInput?.()) {
    action();
    return;
  }
  Keyboard.dismiss();
  setTimeout(action, TEXT_INPUT_BLUR_SETTLE_MS);
}
