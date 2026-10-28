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
import { displayFontFamily } from '../theme/typography';

// Atelier brand mark: a cream serif V on deep green.
export const VITRUVIUS_BRAND_MARK_INK = '#FBFAF8';
export const VITRUVIUS_BRAND_MARK_FILL = '#1F3A2E';
export const VITRUVIUS_BRAND_BORDER = '#E7E4DE';

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
    borderRadius: 10,
    borderCurve: 'continuous',
    backgroundColor: VITRUVIUS_BRAND_MARK_FILL,
    alignItems: 'center',
    justifyContent: 'center',
  },
  markCompact: {
    width: 44,
    height: 44,
    borderRadius: 9,
  },
  markLarge: {
    width: 56,
    height: 56,
    borderRadius: 8,
  },
  markText: {
    color: VITRUVIUS_BRAND_MARK_INK,
    fontSize: 34,
    fontFamily: displayFontFamily,
    lineHeight: 40,
    fontWeight: '400',
  },
  markTextCompact: {
    fontSize: 31,
    fontFamily: displayFontFamily,
    lineHeight: 37,
  },
  markTextLarge: {
    fontSize: 39,
    fontFamily: displayFontFamily,
    lineHeight: 46,
  },
  copy: {
    flexShrink: 1,
    minWidth: 0,
  },
  name: {
    color: '#1A1A18',
    fontSize: 24,
    fontFamily: displayFontFamily,
    lineHeight: 28,
    fontWeight: '400',
  },
  nameCompact: {
    fontSize: 22,
    lineHeight: 26,
  },
  subtitle: {
    color: '#66645E',
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(26, 26, 24, 0.4)',
    padding: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalCard: {
    width: '100%',
    maxWidth: 520,
    borderRadius: 12,
    borderCurve: 'continuous',
    borderWidth: 1,
    borderColor: VITRUVIUS_BRAND_BORDER,
    backgroundColor: '#FFFFFF',
    padding: spacing.xl,
    gap: spacing.md,
    shadowColor: '#1A1A18',
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
    color: '#1F3A2E',
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
    letterSpacing: 1.1,
  },
  modalTitle: {
    color: '#1A1A18',
    fontSize: 26,
    fontFamily: displayFontFamily,
    lineHeight: 33,
    fontWeight: '400',
  },
  modalBody: {
    color: '#3A3935',
    fontSize: 17,
    lineHeight: 26,
    fontWeight: '500',
  },
  closeButton: {
    minHeight: 48,
    borderRadius: 10,
    borderCurve: 'continuous',
    backgroundColor: '#1F3A2E',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.xs,
  },
  closeButtonPressed: {
    backgroundColor: '#1F3A2E',
  },
  closeButtonText: {
    color: '#FFFFFF',
    fontSize: 17,
    lineHeight: 21,
    fontWeight: '600',
  },
});
