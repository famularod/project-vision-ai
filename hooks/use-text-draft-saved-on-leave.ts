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
 *   changes (a live update from another device).
 */
export function useTextDraftSavedOnLeave(
  value: string,
  onCommit: (value: string) => void,
) {
  const [draftValue, setDraftValue] = useState(value);
  const focusedRef = useRef(false);
  const committedValueRef = useRef(value);
  const focusOwnerRef = useRef(currentCloudOwner());
  const latestRef = useRef({ draftValue, onCommit, commitDraft });
  latestRef.current = { draftValue, onCommit, commitDraft };

  useEffect(() => {
    if (!focusedRef.current) {
      committedValueRef.current = value;
      setDraftValue(value);
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
    const committed = latestRef.current.draftValue.trim();
    if (committed === committedValueRef.current) return;
    committedValueRef.current = committed;
    latestRef.current.onCommit(committed);
  }

  return { draftValue, setDraftValue, onFocus, commitDraft };
}
