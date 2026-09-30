import { useEffect, useState } from 'react';

/**
 * A text field typed locally and committed when it is left or its sheet
 * closes (whole-app audit A3, 30 Sep 2026). Committing per keystroke trimmed
 * the text and echoed it back, so a space could not be typed ("Pad East"),
 * and an emptied field became a default name. An emptied field keeps the
 * saved value. The text resyncs only when `resetKey` changes (a different
 * record), not on each echo of the saved value.
 */
export function useCommittedText(
  savedValue: string | undefined,
  resetKey: string | undefined,
  onCommit: (value: string) => void,
) {
  const [text, setText] = useState(savedValue ?? '');

  useEffect(() => {
    setText(savedValue ?? '');
  }, [resetKey]);

  function commit() {
    if (savedValue === undefined) return;
    const trimmed = text.trim();
    if (!trimmed) {
      setText(savedValue);
      return;
    }
    if (trimmed !== savedValue) onCommit(trimmed);
  }

  return { text, setText, commit };
}
