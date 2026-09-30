import { useEffect, useRef, useState } from 'react';
import {
  Keyboard,
  Text,
  TextInput,
  type StyleProp,
  type TextStyle,
} from 'react-native';

import { cloudOwnerUnchanged, currentCloudOwner } from '../services/CloudOwnerBinding';

type SharedFieldStyleProps = {
  labelStyle: StyleProp<TextStyle>;
  inputStyle: StyleProp<TextStyle>;
  mutedColor: string;
};

export function ScheduleCommittedTextField({
  label,
  value,
  placeholder,
  onCommit,
  labelStyle,
  inputStyle,
  mutedColor,
}: {
  label: string;
  value: string;
  placeholder: string;
  onCommit: (value: string) => void;
} & SharedFieldStyleProps) {
  const [draftValue, setDraftValue] = useState(value);
  const focusedRef = useRef(false);
  const committedValueRef = useRef(value);
  // Whole-app audit A2 pass 2 M2: a field removed while being typed in (the
  // iPad rail's project list, a view tab or filter switching the inspector's
  // task) gets no blur from React Native, so the typed text was dropped. It
  // is committed as the field goes, unless the account changed meanwhile.
  const latestRef = useRef({ draftValue, onCommit, commitDraft });
  const focusOwnerRef = useRef(currentCloudOwner());
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

  function commitDraft() {
    focusedRef.current = false;
    const committed = latestRef.current.draftValue.trim();
    if (committed === committedValueRef.current) return;
    committedValueRef.current = committed;
    latestRef.current.onCommit(committed);
  }

  return (
    <>
      <Text style={labelStyle}>{label}</Text>
      <TextInput
        style={inputStyle}
        value={draftValue}
        onChangeText={setDraftValue}
        onFocus={() => {
          focusedRef.current = true;
          focusOwnerRef.current = currentCloudOwner();
        }}
        onBlur={commitDraft}
        onEndEditing={commitDraft}
        onSubmitEditing={() => {
          commitDraft();
          Keyboard.dismiss();
        }}
        placeholder={placeholder}
        placeholderTextColor={mutedColor}
        inputAccessoryViewID="vitruvius-keyboard-done"
        returnKeyType="done"
      />
    </>
  );
}

export function ScheduleCommittedPercentField({
  value,
  maximum,
  disabled,
  onCommit,
  labelStyle,
  inputStyle,
  mutedColor,
}: {
  value: number;
  maximum: number;
  disabled: boolean;
  onCommit: (value: number) => void;
} & SharedFieldStyleProps) {
  const [draftValue, setDraftValue] = useState(String(value));
  const focusedRef = useRef(false);
  const committedValueRef = useRef(value);

  useEffect(() => {
    // Percentage changes are staged immediately on every non-empty edit, so
    // the parent value is the current authority even while the input remains
    // focused. Keeping an older focused draft here made the task card show a
    // newly received value (for example 95%) while the inspector still showed
    // the previous value (for example 80%).
    committedValueRef.current = value;
    setDraftValue(String(value));
  }, [value]);

  function commitDraft() {
    focusedRef.current = false;
    const requested = Number(draftValue || '0');
    const committed = Math.max(0, Math.min(maximum, requested));
    setDraftValue(String(committed));
    if (committed === committedValueRef.current) return;
    committedValueRef.current = committed;
    onCommit(committed);
  }

  return (
    <>
      <Text style={labelStyle}>Percent Complete</Text>
      <TextInput
        style={[
          inputStyle,
          disabled && { opacity: 0.55 },
        ]}
        value={draftValue}
        onChangeText={nextValue => {
          const sanitized = nextValue.replace(/[^0-9]/g, '').slice(0, 3);
          setDraftValue(sanitized);
          if (sanitized) {
            onCommit(Math.max(0, Math.min(maximum, Number(sanitized))));
          }
        }}
        onFocus={() => {
          focusedRef.current = true;
        }}
        onBlur={commitDraft}
        onEndEditing={commitDraft}
        onSubmitEditing={() => {
          commitDraft();
          Keyboard.dismiss();
        }}
        placeholder="0"
        placeholderTextColor={mutedColor}
        keyboardType="number-pad"
        inputAccessoryViewID="vitruvius-keyboard-done"
        maxLength={3}
        editable={!disabled}
        selectTextOnFocus
        accessibilityLabel="Percent Complete"
      />
    </>
  );
}
