import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, radius, spacing } from '../theme';
import {
  pickPhoneContact,
  type PhoneContactPick,
  type PhoneContactRead,
  type ReportContactsApi,
} from '../services/ReportRecipients';

/**
 * Open item 4.92 (the coordinator's order, 13 Oct 2026): Field Updates' "Choose Contact" on expo-contacts 57. The
 * screen called presentContactPickerAsync, which version 57 turned into a function that only throws "deprecated", and
 * read that as "Rebuild needed": the picker never opened. It now reads the contact the way Reports' Add from Contacts
 * does (services/ReportRecipients pickPhoneContact): expo-contacts is loaded and contacts access is asked for only when
 * he taps, and each failure says its own reason.
 */
type Shown = Readonly<{ status: 'idle' | 'loading' }> | Exclude<PhoneContactPick, Readonly<{ status: 'picked' | 'cancelled' }>>;

/** The title and the words for each failure (null: none to show). */
export function phoneContactPickNotice(shown: Shown): Readonly<{ title: string; text: string }> | null {
  switch (shown.status) {
    case 'denied':
      return { title: 'Contacts access needed', text: 'Allow contacts access in Settings, then come back here to choose recipients.' };
    case 'no_address':
      return { title: 'No email or phone', text: `${shown.name} has no email address or phone number saved. Choose a contact with one.` };
    case 'unreadable':
      return {
        title: 'Contact could not be read',
        text: 'Vitruvius could not read that contact. If your phone shares only some contacts with Vitruvius, add this one in Settings, or choose another.',
      };
    case 'unavailable':
      return { title: 'Contacts unavailable', text: 'Phone contacts could not be opened right now. Try again.' };
    case 'missing_module':
      return { title: 'Rebuild needed', text: 'The installed app does not include the native contacts picker yet. Rebuild the app, then try again.' };
    default:
      return null;
  }
}

export function PhoneContactPicker({
  onPicked,
  contactsApi,
}: {
  /** The contact he chose, with every email address and phone number. */
  onPicked: (contact: PhoneContactRead) => void;
  /** A stand-in for expo-contacts (tests); the app's own otherwise. */
  contactsApi?: ReportContactsApi;
}) {
  const [shown, setShown] = useState<Shown>({ status: 'idle' });
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  const choose = () => {
    if (shown.status === 'loading') return;
    setShown({ status: 'loading' });
    void pickPhoneContact(contactsApi).then(pick => {
      if (!mounted.current) return;
      if (pick.status === 'picked') onPicked(pick.contact);
      setShown(pick.status === 'picked' || pick.status === 'cancelled' ? { status: 'idle' } : pick);
    });
  };
  const notice = phoneContactPickNotice(shown);

  return (
    <View style={styles.section}>
      <Pressable
        onPress={choose}
        disabled={shown.status === 'loading'}
        accessibilityRole="button"
        accessibilityLabel="Choose Contact"
        accessibilityState={{ disabled: shown.status === 'loading' }}
        style={[styles.button, shown.status === 'loading' && styles.buttonDisabled]}
      >
        <Ionicons name="person-add-outline" size={18} color={colors.primary} />
        <Text style={styles.buttonText}>Choose Contact</Text>
      </Pressable>
      {shown.status === 'idle' ? (
        <Text style={styles.note}>Use the phone contact picker to search and choose one recipient at a time.</Text>
      ) : null}
      {shown.status === 'loading' ? <Text style={styles.note}>Opening contacts...</Text> : null}
      {notice ? (
        <View style={styles.notice}>
          <Text style={styles.noticeTitle}>{notice.title}</Text>
          <Text style={styles.note}>{notice.text}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: spacing.xs,
  },
  button: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.primary,
    paddingHorizontal: spacing.sm,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonText: {
    color: colors.primary,
    fontSize: 16,
    fontWeight: '600',
  },
  note: {
    color: colors.mutedText,
    fontSize: 15,
    lineHeight: 21,
    fontWeight: '600',
  },
  notice: {
    gap: spacing.xxs,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceMuted,
    padding: spacing.sm,
  },
  noticeTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '600',
  },
});
