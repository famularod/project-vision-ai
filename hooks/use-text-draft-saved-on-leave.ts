import { useEffect, useRef, useState } from 'react';

import { cloudOwnerUnchanged, currentCloudOwner } from '../services/CloudOwnerBinding';

/**
 * A text field typed locally and saved when it is left (blur, Return, Done)
 * or removed while being typed in. React Native gives a removed field no
 * blur, so text typed there was dropped when its task row, sheet or section
 * closed (whole-app audit A2 pass 2 M2: a task's Owner and Contractor; pass 3
 * M1, 30 Sep 2026: the task's Project controls fields). Shared so both save
 * alike:
 * - the text is saved trimmed, once: a blur then the removal saves once, and
 *   leaving without a change saves nothing;
 * - it is never saved into another account: an account change while typing
 *   drops it;
 * - while not being typed in, the field follows the saved value as it
 *   changes (a live update from another device);
 * - a saved value that changed while the field was being typed in is shown
 *   when the field is left unchanged, so a later edit starts from it; text
 *   that was changed is saved as before (whole-app audit A3 pass 6 L2,
 *   30 Sep 2026: the old text stayed, and the next edit put it back over the
 *   other device's value).
 */
export function useTextDraftSavedOnLeave(
  value: string,
  onCommit: (value: string) => void,
) {
  const [draftValue, setDraftValue] = useState(value);
  const focusedRef = useRef(false);
  const committedValueRef = useRef(value);
  // A saved value that arrived while the field was being typed in.
  const arrivedWhileFocusedRef = useRef<{ value: string } | null>(null);
  const focusOwnerRef = useRef(currentCloudOwner());
  const latestRef = useRef({ draftValue, onCommit, commitDraft });
  latestRef.current = { draftValue, onCommit, commitDraft };

  useEffect(() => {
    if (!focusedRef.current) {
      committedValueRef.current = value;
      setDraftValue(value);
    } else {
      arrivedWhileFocusedRef.current = { value };
    }
  }, [value]);

  useEffect(() => () => {
    if (focusedRef.current && cloudOwnerUnchanged(focusOwnerRef.current)) {
      latestRef.current.commitDraft();
    }
  }, []);

  function onFocus() {
    focusedRef.current = true;
    focusOwnerRef.current = currentCloudOwner();
  }

  function commitDraft() {
    focusedRef.current = false;
    const arrived = arrivedWhileFocusedRef.current;
    arrivedWhileFocusedRef.current = null;
    const committed = latestRef.current.draftValue.trim();
    if (committed === committedValueRef.current) {
      if (!arrived) return;
      // Left unchanged: show the newer saved value. A second leave event
      // (End Editing then Blur) reads it before the next render.
      committedValueRef.current = arrived.value;
      latestRef.current.draftValue = arrived.value;
      setDraftValue(arrived.value);
      return;
    }
    committedValueRef.current = committed;
    latestRef.current.onCommit(committed);
  }

  return { draftValue, setDraftValue, onFocus, commitDraft };
}
