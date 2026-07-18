import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

const HOLD_DURATION_MS = 3000;
const HOLD_TICK_MS = 50;
const DANGER = '#FF3B30';

export function HoldToDeleteButton({
  label,
  holdingLabel,
  deletingLabel,
  isDeleting,
  onConfirm,
}: Readonly<{
  label: string;
  holdingLabel: string;
  deletingLabel: string;
  isDeleting: boolean;
  onConfirm: () => void;
}>) {
  const [progress, setProgress] = useState(0);
  const [holding, setHolding] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  function clearTimer() {
    if (!timer.current) return;
    clearInterval(timer.current);
    timer.current = null;
  }

  function cancelHold() {
    clearTimer();
    setHolding(false);
    setProgress(0);
  }

  function startHold() {
    if (isDeleting) return;
    setHolding(true);
    setProgress(0);
    const startedAt = Date.now();
    timer.current = setInterval(() => {
      const next = Math.min(100, ((Date.now() - startedAt) / HOLD_DURATION_MS) * 100);
      setProgress(next);
      if (next < 100) return;
      clearTimer();
      setHolding(false);
      setProgress(0);
      onConfirm();
    }, HOLD_TICK_MS);
  }

  useEffect(() => clearTimer, []);

  return (
    <TouchableOpacity
      style={styles.button}
      activeOpacity={0.85}
      disabled={isDeleting}
      onPressIn={startHold}
      onPressOut={cancelHold}
    >
      <View style={[styles.fill, { width: `${progress}%` }]} />
      <Ionicons name="trash-outline" size={19} color={DANGER} />
      <Text style={styles.text}>
        {isDeleting ? deletingLabel : holding ? holdingLabel : label}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: '#FFECEC', borderRadius: 10, borderWidth: 1,
    borderColor: DANGER, paddingVertical: 14, paddingHorizontal: 14,
    minHeight: 54, marginBottom: 10, overflow: 'hidden',
  },
  fill: {
    position: 'absolute', left: 0, top: 0, bottom: 0,
    backgroundColor: DANGER, opacity: 0.25,
  },
  text: { color: DANGER, fontSize: 16, fontWeight: '700' },
});
