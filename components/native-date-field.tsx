import { Ionicons } from '@expo/vector-icons';
import DateTimePicker, {
  type DateTimePickerEvent,
} from '@react-native-community/datetimepicker';
import { useEffect, useState } from 'react';
import {
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { colors, radius, spacing } from '../theme';
import {
  formatAppDate,
  formatCalendarDate,
  parseFlexibleDate,
} from '../utils/date';

export function NativeDateField({
  label,
  value,
  onChange,
  testID = 'native-date-field',
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  testID?: string;
}) {
  const selectedDate = parseFlexibleDate(value);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [draftDate, setDraftDate] = useState(() => selectedDate || today());

  useEffect(() => {
    if (selectedDate) setDraftDate(selectedDate);
  }, [selectedDate?.getTime()]);

  function openPicker() {
    setDraftDate(selectedDate || today());
    setPickerOpen(true);
  }

  function handleAndroidChange(event: DateTimePickerEvent, date?: Date) {
    setPickerOpen(false);
    if (event.type === 'set' && date) onChange(formatCalendarDate(date));
  }

  return (
    <View>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.fieldRow}>
        <Pressable
          style={({ pressed }) => [styles.field, pressed && styles.pressed]}
          onPress={openPicker}
          accessibilityRole="button"
          accessibilityLabel={`Select ${label.toLowerCase()}`}
          accessibilityValue={{ text: selectedDate ? formatAppDate(value) : 'No date selected' }}
          testID={testID}
        >
          <Ionicons name="calendar-outline" size={21} color={colors.primary} />
          <Text style={[styles.value, !selectedDate && styles.placeholder]}>
            {selectedDate ? formatAppDate(value) : 'Select a date'}
          </Text>
          <Ionicons name="chevron-forward-outline" size={18} color={colors.mutedText} />
        </Pressable>
        {selectedDate ? (
          <Pressable
            style={({ pressed }) => [styles.clearButton, pressed && styles.pressed]}
            onPress={() => onChange('')}
            accessibilityRole="button"
            accessibilityLabel={`Clear ${label.toLowerCase()}`}
          >
            <Ionicons name="close-outline" size={21} color={colors.mutedText} />
          </Pressable>
        ) : null}
      </View>

      {Platform.OS === 'android' && pickerOpen ? (
        <DateTimePicker
          value={draftDate}
          mode="date"
          display="calendar"
          onChange={handleAndroidChange}
          testID={`${testID}-picker`}
        />
      ) : null}

      {Platform.OS === 'ios' ? (
        <Modal
          visible={pickerOpen}
          transparent
          animationType="fade"
          onRequestClose={() => setPickerOpen(false)}
        >
          <View style={styles.backdrop}>
            <View style={styles.calendarCard}>
              <Text style={styles.calendarTitle}>{label}</Text>
              <DateTimePicker
                value={draftDate}
                mode="date"
                display="inline"
                onChange={(_event, date) => date && setDraftDate(date)}
                testID={`${testID}-picker`}
              />
              <View style={styles.actions}>
                <Pressable
                  style={({ pressed }) => [styles.actionButton, pressed && styles.pressed]}
                  onPress={() => setPickerOpen(false)}
                  accessibilityRole="button"
                >
                  <Text style={styles.cancelText}>Cancel</Text>
                </Pressable>
                <Pressable
                  style={({ pressed }) => [styles.actionButton, styles.applyButton, pressed && styles.pressed]}
                  onPress={() => {
                    onChange(formatCalendarDate(draftDate));
                    setPickerOpen(false);
                  }}
                  accessibilityRole="button"
                >
                  <Text style={styles.applyText}>Use Date</Text>
                </Pressable>
              </View>
            </View>
          </View>
        </Modal>
      ) : null}
    </View>
  );
}

function today() {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  return date;
}

const styles = StyleSheet.create({
  label: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '700',
    marginBottom: spacing.xs,
    marginTop: spacing.md,
  },
  fieldRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  field: {
    minHeight: 50,
    flex: 1,
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceMuted,
    paddingHorizontal: spacing.md,
  },
  value: {
    flex: 1,
    color: colors.text,
    fontSize: 16,
    fontWeight: '700',
  },
  placeholder: {
    color: colors.mutedText,
    fontWeight: '500',
  },
  clearButton: {
    width: 50,
    minHeight: 50,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceMuted,
  },
  pressed: {
    opacity: 0.7,
  },
  backdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.42)',
    padding: spacing.lg,
  },
  calendarCard: {
    width: '100%',
    maxWidth: 430,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    padding: spacing.lg,
  },
  calendarTitle: {
    color: colors.text,
    fontSize: 19,
    fontWeight: '900',
    marginBottom: spacing.sm,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  actionButton: {
    minHeight: 46,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
  },
  applyButton: {
    backgroundColor: colors.primary,
  },
  cancelText: {
    color: colors.primary,
    fontSize: 15,
    fontWeight: '800',
  },
  applyText: {
    color: colors.surface,
    fontSize: 15,
    fontWeight: '900',
  },
});
