import { useEffect, useRef, type ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

export function KeyboardAvoidingModalCard({
  containerStyle,
  frameStyle,
  contentContainerStyle,
  children,
  scrollTarget,
}: {
  containerStyle?: StyleProp<ViewStyle>;
  frameStyle: StyleProp<ViewStyle>;
  contentContainerStyle?: StyleProp<ViewStyle>;
  children: ReactNode;
  /** A measured content position to reveal after a new actionable message. */
  scrollTarget?: Readonly<{ key: string; y: number }> | null;
}) {
  const scroll = useRef<ScrollView>(null);
  const targetKey = scrollTarget?.key;
  const targetY = scrollTarget?.y;
  useEffect(() => {
    if (targetKey && typeof targetY === 'number' && Number.isFinite(targetY)) {
      scroll.current?.scrollTo({ y: Math.max(0, targetY), animated: false });
    }
  }, [targetKey, targetY]);
  return (
    <KeyboardAvoidingView
      style={containerStyle}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        ref={scroll}
        style={frameStyle}
        contentContainerStyle={contentContainerStyle}
        contentInsetAdjustmentBehavior="automatic"
        automaticallyAdjustKeyboardInsets
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {children}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
