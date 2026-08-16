import { useEffect, useRef, useState } from 'react';
import {
  Keyboard,
  Text,
  TextInput,
  type StyleProp,
  type TextStyle,
} from 'react-native';

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

  useEffect(() => {
    if (!focusedRef.current) {
      committedValueRef.current = value;
      setDraftValue(value);
    }
  }, [value]);

  function commitDraft() {
    focusedRef.current = false;
    const committed = draftValue.trim();
    if (committed === committedValueRef.current) return;
    committedValueRef.current = committed;
    onCommit(committed);
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
    if (!focusedRef.current) {
      committedValueRef.current = value;
      setDraftValue(String(value));
    }
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
