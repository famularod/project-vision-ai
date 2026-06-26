import * as Contacts from 'expo-contacts';
import { useMemo, useState } from 'react';
import { Alert, Platform, Text, View } from 'react-native';
import { RecipientRow } from '../components/RecipientRow';
import {
  EmptyState,
  ScreenTitle,
  SecondaryButton,
  styles,
} from '../components/ProjectDetailsCard';
import type {
  ContactBook,
  ProjectContact,
  RecipientSelection,
} from '../types';
import { phoneContactToProjectContact } from '../utils/contacts';

export function ContactsScreen({
  contactBook,
  selectedRecipients,
  doneLabel,
  onDone,
  onToggleContact,
  onTogglePhoneContact,
  onUpdateContactDeliveryChoice,
}: {
  contactBook: ContactBook;
  selectedRecipients: RecipientSelection;
  doneLabel: string;
  onDone: () => void;
  onToggleContact: (contactId: string) => void;
  onTogglePhoneContact: (contact: ProjectContact) => void;
  onUpdateContactDeliveryChoice: (
    contactId: string,
    next: Partial<ProjectContact>,
  ) => void;
}) {
  const [status, setStatus] = useState<
    'idle' | 'loading' | 'denied' | 'error' | 'unavailable'
  >('idle');

  async function choosePhoneContact() {
    setStatus('loading');

    try {
      if (Platform.OS !== 'ios') {
        const permission = await Contacts.requestPermissionsAsync();

        if (!permission.granted) {
          setStatus('denied');
          return;
        }
      }

      const contact = await Contacts.presentContactPickerAsync();

      if (!contact) {
        setStatus('idle');
        return;
      }

      const projectContact = phoneContactToProjectContact(contact);

      if (!projectContact.email && !projectContact.phone) {
        Alert.alert(
          'No email or phone',
          'Choose a contact with an email address or phone number.',
        );
        setStatus('idle');
        return;
      }

      onTogglePhoneContact(projectContact);
      setStatus('idle');
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes('presentContactPickerAsync')
      ) {
        setStatus('unavailable');
        return;
      }

      setStatus('error');
    }
  }

  const selectedContactIds = useMemo(
    () => new Set(selectedRecipients.contactIds),
    [selectedRecipients.contactIds],
  );

  const selectedContacts = contactBook.contacts.filter(contact =>
    selectedContactIds.has(contact.id),
  );

  return (
    <View>
      <ScreenTitle
        title="Recipients"
        subtitle={`${selectedContacts.length} selected for this update`}
      />

      <Text style={styles.sectionLabel}>
        Selected
      </Text>

      {selectedContacts.length === 0 ? (
        <Text style={styles.mutedNote}>
          Choose people from your phone contacts below.
        </Text>
      ) : (
        selectedContacts.map(contact => (
          <RecipientRow
            key={contact.id}
            contact={contact}
            selected
            onPress={() => onToggleContact(contact.id)}
            onUpdate={next =>
              onUpdateContactDeliveryChoice(contact.id, next)
            }
          />
        ))
      )}

      <Text style={styles.sectionLabel}>
        Phone Contacts
      </Text>

      <SecondaryButton
        label="Choose Contact"
        icon="person-add-outline"
        onPress={() => {
          void choosePhoneContact();
        }}
      />

      {status === 'idle' ? (
        <Text style={styles.mutedNote}>
          Use the phone contact picker to search and choose one recipient at a time.
        </Text>
      ) : null}

      {status === 'loading' ? (
        <Text style={styles.mutedNote}>
          Opening contacts...
        </Text>
      ) : null}

      {status === 'denied' ? (
        <EmptyState
          title="Contacts access needed"
          text="Allow contacts access in Settings, then come back here to choose recipients."
        />
      ) : null}

      {status === 'error' ? (
        <EmptyState
          title="Contacts unavailable"
          text="Phone contacts could not be opened right now."
        />
      ) : null}

      {status === 'unavailable' ? (
        <EmptyState
          title="Rebuild needed"
          text="The installed app does not include the native contacts picker yet. Rebuild the app, then try again."
        />
      ) : null}

      <SecondaryButton
        label={doneLabel}
        icon="arrow-back-outline"
        onPress={onDone}
      />
    </View>
  );
}
