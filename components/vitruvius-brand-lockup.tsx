import { useState } from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { PRODUCT_BRAND } from '../product-brand';
import { spacing } from '../theme';

export const VITRUVIUS_BRAND_DARK_BLUE = '#194A91';
export const VITRUVIUS_BRAND_SOFT_BLUE = '#E8F3FF';
export const VITRUVIUS_BRAND_BORDER = '#B8CDE3';

export function VitruviusBrandLockup({
  compact = false,
  large = false,
  showSubtitle = true,
  showText = true,
  testID,
}: {
  compact?: boolean;
  large?: boolean;
  showSubtitle?: boolean;
  showText?: boolean;
  testID?: string;
}) {
  const [aboutVisible, setAboutVisible] = useState(false);

  return (
    <>
      <Pressable
        accessibilityHint="Shows a brief history of Marcus Vitruvius Pollio"
        accessibilityLabel={`About ${PRODUCT_BRAND.name}, ${PRODUCT_BRAND.subtitle}`}
        accessibilityRole="button"
        onPress={() => setAboutVisible(true)}
        style={({ pressed }) => [
          styles.lockup,
          compact && styles.lockupCompact,
          large && styles.lockupLarge,
          pressed && styles.lockupPressed,
        ]}
        testID={testID}
      >
        <View
          style={[
            styles.mark,
            compact && styles.markCompact,
            large && styles.markLarge,
          ]}
          testID={testID ? `${testID}-mark` : undefined}
        >
          <Text
            style={[
              styles.markText,
              compact && styles.markTextCompact,
              large && styles.markTextLarge,
            ]}
          >
            {PRODUCT_BRAND.monogram}
          </Text>
        </View>

        {showText ? (
          <View style={styles.copy}>
            <Text style={[styles.name, compact && styles.nameCompact]}>
              {PRODUCT_BRAND.name}
            </Text>
            {showSubtitle ? (
              <Text style={styles.subtitle}>{PRODUCT_BRAND.subtitle}</Text>
            ) : null}
          </View>
        ) : null}
      </Pressable>

      <Modal
        animationType="fade"
        onRequestClose={() => setAboutVisible(false)}
        transparent
        visible={aboutVisible}
      >
        <View style={styles.modalBackdrop}>
          <Pressable
            accessibilityLabel="Close Vitruvius history"
            onPress={() => setAboutVisible(false)}
            style={StyleSheet.absoluteFill}
          />
          <View
            accessibilityViewIsModal
            style={styles.modalCard}
            testID={testID ? `${testID}-about-modal` : undefined}
          >
            <View style={styles.modalBrandRow}>
              <View style={[styles.mark, styles.modalMark]}>
                <Text style={styles.markText}>{PRODUCT_BRAND.monogram}</Text>
              </View>
              <View style={styles.copy}>
                <Text style={styles.modalEyebrow}>THE NAME BEHIND VITRUVIUS</Text>
                <Text style={styles.modalTitle}>Marcus Vitruvius Pollio</Text>
              </View>
            </View>

            <Text style={styles.modalBody}>
              Marcus Vitruvius Pollio was a Roman architect, engineer, and writer
              active in the first century BCE. His work, De architectura,
              connected durable construction, practical use, and thoughtful
              design.
            </Text>
            <Text style={styles.modalBody}>
              Vitruvius Project Intelligence carries that idea forward by
              helping project teams connect plans, field conditions, and
              accountable decisions.
            </Text>

            <Pressable
              accessibilityRole="button"
              onPress={() => setAboutVisible(false)}
              style={({ pressed }) => [
                styles.closeButton,
                pressed && styles.closeButtonPressed,
              ]}
            >
              <Text style={styles.closeButtonText}>Close</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </>
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
  lockupLarge: {
    gap: spacing.sm,
  },
  lockupPressed: {
    opacity: 0.72,
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
  markLarge: {
    width: 56,
    height: 56,
    borderRadius: 17,
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
  markTextLarge: {
    fontSize: 40,
    lineHeight: 46,
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
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 30, 52, 0.46)',
    padding: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalCard: {
    width: '100%',
    maxWidth: 520,
    borderRadius: 24,
    borderCurve: 'continuous',
    borderWidth: 1,
    borderColor: VITRUVIUS_BRAND_BORDER,
    backgroundColor: '#FFFFFF',
    padding: spacing.xl,
    gap: spacing.md,
    shadowColor: '#10233F',
    shadowOpacity: 0.18,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 12 },
    elevation: 8,
  },
  modalBrandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  modalMark: {
    flexShrink: 0,
  },
  modalEyebrow: {
    color: '#3C72B7',
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '900',
    letterSpacing: 1.1,
  },
  modalTitle: {
    color: '#172033',
    fontSize: 23,
    lineHeight: 29,
    fontWeight: '900',
  },
  modalBody: {
    color: '#3F4A5B',
    fontSize: 16,
    lineHeight: 24,
    fontWeight: '500',
  },
  closeButton: {
    minHeight: 48,
    borderRadius: 14,
    borderCurve: 'continuous',
    backgroundColor: '#147CE5',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.xs,
  },
  closeButtonPressed: {
    backgroundColor: '#0F68C6',
  },
  closeButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    lineHeight: 20,
    fontWeight: '900',
  },
});
