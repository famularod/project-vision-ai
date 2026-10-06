import Ionicons from '@expo/vector-icons/Ionicons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useState } from 'react';
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { colors, radius, spacing } from '../theme';
import type { DAVEReportSnapshot } from '../services/DAVEReportSnapshot';
import {
  describeSendWindowTime,
  manualReportSendWindow,
} from '../services/ReportManualSend';

/**
 * Everyday item 1 (2 Oct 2026): "Mark as Sent" for the approved report this
 * device saved and has not recorded as sent. The owner says when it went out
 * (just now, or a time he picks); nothing is sent from here and nothing is
 * recorded until he confirms.
 */
export function ReportMarkSentPanel({
  approval,
  disabled,
  recording,
  message,
  onRecord,
}: {
  /** The approval waiting to be recorded as sent. */
  approval: DAVEReportSnapshot;
  /** A share from the app is open. */
  disabled: boolean;
  /** The mark is being recorded. */
  recording: boolean;
  /** Why the last mark was not recorded, or what was recorded. */
  message: string;
  onRecord: (choice: 'now' | Date) => void;
}) {
  const [open, setOpen] = useState(false);
  const [when, setWhen] = useState<'now' | 'earlier'>('now');
  const [picked, setPicked] = useState<Date>(() => new Date());
  const sendWindow = manualReportSendWindow(approval);
  const factsAsOf = describeSendWindowTime(approval.capturedAt);

  if (!open) {
    return (
      <View style={styles.panel}>
        <View style={styles.copy}>
          <Text style={styles.title}>Sent it another way?</Text>
          <Text style={styles.detail}>
            {`This approved report (project facts as of ${factsAsOf}) isn't recorded as sent. ` +
              'If you sent it from a saved Mail draft, from Outlook, or as the Word file, mark it sent so the next report runs from it.'}
          </Text>
          {message ? <Text style={styles.message}>{message}</Text> : null}
        </View>
        <Pressable
          style={({ pressed }) => [styles.secondaryButton, disabled && styles.disabled, pressed && styles.pressed]}
          onPress={() => {
            setWhen('now');
            setPicked(new Date());
            setOpen(true);
          }}
          disabled={disabled}
          accessibilityRole="button"
          accessibilityState={{ disabled }}
          accessibilityLabel="Mark as Sent"
        >
          <Ionicons name="checkmark-done-outline" size={18} color={colors.primary} />
          <Text style={styles.secondaryText}>Mark as Sent</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.panel}>
      <Text style={styles.title}>When was it sent?</Text>
      <View style={styles.choices} accessibilityRole="radiogroup">
        {/* The date-and-time wheel is iOS's; elsewhere only "Just now" is offered. */}
        {(Platform.OS === 'ios' ? ['now', 'earlier'] as const : ['now'] as const).map(choice => (
          <Pressable
            key={choice}
            style={({ pressed }) => [styles.choice, when === choice && styles.choiceActive, pressed && styles.pressed]}
            onPress={() => setWhen(choice)}
            accessibilityRole="radio"
            accessibilityState={{ selected: when === choice }}
            accessibilityLabel={choice === 'now' ? 'Sent just now' : 'Sent earlier'}
          >
            <Text style={[styles.choiceText, when === choice && styles.choiceTextActive]}>
              {choice === 'now' ? 'Just now' : 'Earlier'}
            </Text>
          </Pressable>
        ))}
      </View>
      {when === 'earlier' ? (
        <>
          <DateTimePicker
            value={picked}
            mode="datetime"
            display="spinner"
            minimumDate={sendWindow ? new Date(sendWindow.earliest) : undefined}
            maximumDate={new Date()}
            onChange={(_event, date) => date && setPicked(date)}
            testID="report-mark-sent-picker"
          />
          <Text style={styles.detail}>
            {`Any time from ${factsAsOf}, when this report's project facts were current.`}
          </Text>
        </>
      ) : null}
      {message ? <Text style={styles.message}>{message}</Text> : null}
      <View style={styles.actions}>
        <Pressable
          style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}
          onPress={() => setOpen(false)}
          accessibilityRole="button"
          accessibilityLabel="Cancel marking as sent"
        >
          <Text style={styles.secondaryText}>Cancel</Text>
        </Pressable>
        <Pressable
          style={({ pressed }) => [styles.primaryButton, (disabled || recording) && styles.disabled, pressed && styles.pressed]}
          onPress={() => onRecord(when === 'now' ? 'now' : picked)}
          disabled={disabled || recording}
          accessibilityRole="button"
          accessibilityState={{ disabled: disabled || recording }}
          accessibilityLabel="Record as Sent"
        >
          <Text style={styles.primaryText}>Record as Sent</Text>
        </Pressable>
      </View>
      <Text style={styles.footnote}>
        Nothing is sent from here: this only records that the approved report went out.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    gap: spacing.xs,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceMuted,
    padding: spacing.sm,
  },
  copy: {
    gap: spacing.xxs,
  },
  title: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '800',
  },
  detail: {
    color: colors.mutedText,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '600',
  },
  message: {
    color: colors.text,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '800',
  },
  footnote: {
    color: colors.mutedText,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '600',
  },
  choices: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  choice: {
    flex: 1,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
  },
  choiceActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primarySoft,
  },
  choiceText: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '700',
  },
  choiceTextActive: {
    color: colors.primary,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  secondaryButton: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xxs,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.sm,
  },
  secondaryText: {
    color: colors.primary,
    fontSize: 14,
    fontWeight: '800',
  },
  primaryButton: {
    flex: 1,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.sm,
  },
  primaryText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
  },
  disabled: {
    opacity: 0.5,
  },
  pressed: {
    opacity: 0.7,
  },
});
