import { StyleSheet, Text, View } from 'react-native';

import { PRODUCT_BRAND } from '../product-brand';
import { spacing } from '../theme';

export const VITRUVIUS_BRAND_DARK_BLUE = '#194A91';
export const VITRUVIUS_BRAND_SOFT_BLUE = '#E8F3FF';
export const VITRUVIUS_BRAND_BORDER = '#B8CDE3';

export function VitruviusBrandLockup({
  compact = false,
  showText = true,
  testID,
}: {
  compact?: boolean;
  showText?: boolean;
  testID?: string;
}) {
  return (
    <View
      accessible
      accessibilityLabel={`${PRODUCT_BRAND.name}, ${PRODUCT_BRAND.subtitle}`}
      style={[styles.lockup, compact && styles.lockupCompact]}
      testID={testID}
    >
      <View
        style={[styles.mark, compact && styles.markCompact]}
        testID={testID ? `${testID}-mark` : undefined}
      >
        <Text style={[styles.markText, compact && styles.markTextCompact]}>
          {PRODUCT_BRAND.monogram}
        </Text>
      </View>

      {showText ? (
        <View style={styles.copy}>
          <Text style={[styles.name, compact && styles.nameCompact]}>
            {PRODUCT_BRAND.name}
          </Text>
          <Text style={styles.subtitle}>{PRODUCT_BRAND.subtitle}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  lockup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minWidth: 0,
  },
  lockupCompact: {
    gap: spacing.xs,
  },
  mark: {
    width: 48,
    height: 48,
    borderRadius: 15,
    borderCurve: 'continuous',
    borderWidth: 1,
    borderColor: VITRUVIUS_BRAND_BORDER,
    backgroundColor: VITRUVIUS_BRAND_SOFT_BLUE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  markCompact: {
    width: 44,
    height: 44,
    borderRadius: 14,
  },
  markText: {
    color: VITRUVIUS_BRAND_DARK_BLUE,
    fontSize: 32,
    lineHeight: 37,
    fontWeight: '900',
  },
  markTextCompact: {
    fontSize: 29,
    lineHeight: 34,
  },
  copy: {
    flexShrink: 1,
    minWidth: 0,
  },
  name: {
    color: '#172033',
    fontSize: 18,
    lineHeight: 22,
    fontWeight: '900',
    letterSpacing: 0.2,
  },
  nameCompact: {
    fontSize: 17,
    lineHeight: 21,
  },
  subtitle: {
    color: '#5E6A7D',
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '700',
  },
});
