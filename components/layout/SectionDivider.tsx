import { StyleSheet, View } from 'react-native';
import {
  colors,
  spacing,
} from '../../theme';

export function SectionDivider() {
  return <View style={styles.divider} />;
}

const styles = StyleSheet.create({
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
    marginVertical: spacing.md,
  },
});
