import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, radius, spacing } from '../theme';
import type { ReportRecipient } from '../services/ReportRecipients';

/**
 * Open item 7.21, part two: who Email Report and Text Report open with. He adds people from his contacts (contacts
 * access is asked for only when he taps Add from Contacts); with no one added, Mail and Messages open as before and
 * he types the addresses there.
 */
export function ReportRecipientsPanel({
  recipients,
  picking,
  message,
  disabled,
  onAdd,
  onRemove,
}: {
  recipients: readonly ReportRecipient[];
  /** The contact list is open, or the contact chosen is being read. */
  picking: boolean;
  /** What happened at the last tap that added no one (access off, no address), or ''. */
  message: string;
  /** A share is open. */
  disabled: boolean;
  onAdd: () => void;
  onRemove: (key: string) => void;
}) {
  return (
    <View style={styles.panel}>
      <Text style={styles.title}>Send To</Text>
      {recipients.length === 0 ? (
        <Text style={styles.detail}>
          No one added. Email Report and Text Report open with no one filled in; you can type the addresses there, or
          add people from your contacts here.
        </Text>
      ) : (
        <>
          {recipients.map(recipient => (
            <View key={recipient.key} style={styles.row}>
              <Text style={styles.name} numberOfLines={2}>
                {[recipient.name, recipient.email, recipient.phone].filter(Boolean).filter((value, index, all) => all.indexOf(value) === index).join(' · ')}
              </Text>
              <Pressable
                onPress={() => onRemove(recipient.key)}
                disabled={disabled}
                accessibilityRole="button"
                accessibilityLabel={`Remove ${recipient.name}`}
                style={styles.remove}
              >
                <Ionicons name="close-circle-outline" size={20} color={colors.mutedText} />
              </Pressable>
            </View>
          ))}
          <Text style={styles.detail}>Email Report fills in their email addresses; Text Report fills in their phone numbers.</Text>
        </>
      )}
      <Pressable
        onPress={onAdd}
        disabled={disabled || picking}
        accessibilityRole="button"
        accessibilityLabel="Add from Contacts"
        accessibilityState={{ disabled: disabled || picking }}
        style={[styles.add, (disabled || picking) && styles.addDisabled]}
      >
        <Ionicons name="person-add-outline" size={18} color={colors.primary} />
        <Text style={styles.addText}>{picking ? 'Opening Contacts…' : 'Add from Contacts'}</Text>
      </Pressable>
      {message ? <Text style={styles.message}>{message}</Text> : null}
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
  title: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '600',
  },
  detail: {
    color: colors.mutedText,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '600',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  name: {
    flex: 1,
    color: colors.text,
    fontSize: 15,
    fontWeight: '600',
  },
  remove: {
    minHeight: 44,
    minWidth: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  add: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  addDisabled: {
    opacity: 0.5,
  },
  addText: {
    color: colors.primary,
    fontSize: 16,
    fontWeight: '600',
  },
  message: {
    color: colors.text,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '600',
  },
});
