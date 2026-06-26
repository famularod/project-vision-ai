import type { ReactNode } from 'react';
import { ScrollView, StyleProp, ViewStyle } from 'react-native';
import { styles } from './ProjectDetailsCard';

export function ScreenScroll({
  children,
  contentStyle,
}: {
  children: ReactNode;
  contentStyle: StyleProp<ViewStyle>;
}) {
  return (
    <ScrollView
      style={styles.appFrame}
      contentContainerStyle={contentStyle}
      keyboardShouldPersistTaps="handled"
    >
      {children}
    </ScrollView>
  );
}
