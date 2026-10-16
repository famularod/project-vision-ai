/**
 * N761d (open item 7.61, a diagnostic): Reports > Review & Prepare Report > Details. Shows, as text, the parts the
 * report's fingerprint on this page is made of (services/DAVEReportCheckDetails.ts), from the same truths, period and
 * format the page works its fingerprint out from: the phone's Settings > Report check details copies the same text
 * for the same records, so the two can be compared line by line. Shown only; nothing is sent, saved or changed.
 */
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { buildDAVEReportCheckDetails, type DAVEReportCheckInput } from '../../services/DAVEReportCheckDetails';
import { colors, spacing } from '../../theme';
import { desktopSurfaces } from './desktop-surface-palette';

export function DesktopReportCheckDetails(input: DAVEReportCheckInput) {
  const [open, setOpen] = useState(false);
  const { truths, period, format, periodState, shared } = input;
  const text = useMemo(
    () => (open ? buildDAVEReportCheckDetails({ truths, period, format, periodState, shared }) : ''),
    [format, open, period, periodState, shared, truths],
  );
  return (
    <View style={styles.card}>
      <View style={styles.heading}>
        <View style={styles.grow}>
          <Text style={styles.title}>Report check details</Text>
          <Text style={styles.meta}>What this report&apos;s fingerprint is worked out from, to compare with the phone&apos;s Settings &gt; Report check details. Nothing is sent.</Text>
        </View>
        <Pressable
          style={({ pressed }) => [styles.button, pressed && styles.pressed]}
          onPress={() => setOpen(current => !current)}
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
        >
          <Text style={styles.buttonText}>{open ? 'Hide Details' : 'Details'}</Text>
        </Pressable>
      </View>
      {open ? (
        <Text style={styles.text} selectable testID="report-check-details-text" nativeID="report-check-details-text">{text}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 14, borderWidth: 1, borderColor: desktopSurfaces.border, backgroundColor: desktopSurfaces.card, padding: spacing.lg, gap: spacing.md },
  heading: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.md },
  grow: { flexGrow: 1, flexShrink: 1, flexBasis: 240 },
  title: { color: colors.text, fontSize: 15, lineHeight: 21, fontWeight: '900' },
  meta: { color: colors.mutedText, fontSize: 13, lineHeight: 19 },
  button: { minHeight: 42, borderRadius: 12, borderWidth: 1, borderColor: desktopSurfaces.borderStrong, backgroundColor: desktopSurfaces.card, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.md },
  buttonText: { color: desktopSurfaces.accent, fontSize: 14, lineHeight: 20, fontWeight: '900' },
  pressed: { opacity: 0.72 },
  text: { color: colors.text, fontSize: 12, lineHeight: 17, fontFamily: 'monospace' },
});
