import * as Clipboard from 'expo-clipboard';
import { useRef, useState } from 'react';
import { Alert } from 'react-native';

type KeptMemory = { id: string; transcript?: string | null };

/**
 * Whole-app audit A11 pass 1 F8 (30 Sep 2026): a panel that failed to render
 * closed every sheet and also threw away an unconfirmed Talk memory. The
 * memory is now kept with only its sheet closed, and the next tap on Talk
 * brings it back. A new memory (a new id) shows as usual.
 *
 * A11 pass 3: the sheet's edits lived only inside the closed sheet, so a
 * memory moved from 2321 to 2375 came back as 2321 "Confirmed" and saved
 * there. The sheet now reports its working copy (`track`) and the memory
 * comes back with it. A memory whose sheet fails a second time is not
 * reopened again (every Talk tap reopened the failing sheet, so Talk could
 * not record); the next Talk tap says so once and offers to copy the words.
 */
export function useKeptTalkCapture<T extends KeptMemory>(draft: T | null) {
  const [keptId, setKeptId] = useState<string | null>(null);
  const [restored, setRestored] = useState<T | null>(null);
  const [droppedId, setDroppedId] = useState<string | null>(null);
  const workingRef = useRef<T | null>(null);
  const failuresRef = useRef<{ id: string; count: number } | null>(null);
  const noticeRef = useRef<T | null>(null);
  const hidden = !draft || draft.id === keptId || draft.id === droppedId;
  const sheetDraft = hidden ? null : restored?.id === draft.id ? restored : draft;
  return {
    /** The memory the Confirm Memory sheet shows, or null while it is kept closed. */
    sheetDraft,
    /** The sheet's current working copy, with the owner's corrections. */
    track: (working: T) => { workingRef.current = working; },
    /** Closes the sheet and keeps the memory; its second failure gives it up. */
    keep: () => {
      if (!sheetDraft) return;
      const working = workingRef.current?.id === sheetDraft.id ? workingRef.current : sheetDraft;
      const previous = failuresRef.current;
      const count = previous?.id === sheetDraft.id ? previous.count + 1 : 1;
      failuresRef.current = { id: sheetDraft.id, count };
      setRestored(working);
      if (count < 2) {
        setKeptId(sheetDraft.id);
        return;
      }
      noticeRef.current = working;
      setDroppedId(sheetDraft.id);
    },
    /** Reopens a kept memory, or reports one given up; false when there is none. */
    reopen: () => {
      const given = noticeRef.current;
      if (given) {
        noticeRef.current = null;
        const words = (given.transcript || '').trim();
        Alert.alert(
          'That memory could not reopen',
          `Confirm Memory failed twice, so this memory was not saved.${words ? ` Your words: “${words}”` : ''} Tap Talk to record it again.`,
          words
            ? [{ text: 'Copy Words', onPress: () => { void Clipboard.setStringAsync(words).catch(() => undefined); } }, { text: 'OK' }]
            : [{ text: 'OK' }],
        );
        return true;
      }
      if (!draft || draft.id !== keptId) return false;
      setKeptId(null);
      return true;
    },
  };
}
