import { useEffect, useState } from 'react';

/**
 * A text field typed locally and committed when it is left or its sheet
 * closes (whole-app audit A3, 30 Sep 2026). Committing per keystroke trimmed
 * the text and echoed it back, so a space could not be typed ("Pad East"),
 * and an emptied field became a default name. An emptied field keeps the
 * saved value. Until the user types, the field shows the saved value as it
 * changes and a commit writes nothing, so closing the sheet cannot write
 * back a name another device has since changed (audit A3 pass 2). Typing
 * starts over when `resetKey` changes (a different record).
 */
export function useCommittedText(
  savedValue: string | undefined,
  resetKey: string | undefined,
  onCommit: (value: string) => void,
) {
  const [typed, setTyped] = useState<string | null>(null);

  useEffect(() => {
    setTyped(null);
  }, [resetKey]);

  function setText(value: string) {
    setTyped(value);
  }

  function commit() {
    if (savedValue === undefined || typed === null) return;
    const trimmed = typed.trim();
    setTyped(null);
    if (trimmed && trimmed !== savedValue) onCommit(trimmed);
  }

  return { text: typed ?? savedValue ?? '', setText, commit };
}
