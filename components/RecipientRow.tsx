import { Ionicons } from '@expo/vector-icons';
import { Text, TouchableOpacity, View } from 'react-native';
import type { ProjectContact } from '../types';
import {
  normalizeContact,
  selectedContactEmail,
  selectedContactPhone,
} from '../utils/contacts';
import { colors, styles } from './ProjectDetailsCard';

export function RecipientRow({
  contact,
  selected,
  onPress,
  onUpdate,
}: {
  contact: ProjectContact;
  selected: boolean;
  onPress: () => void;
  onUpdate: (next: Partial<ProjectContact>) => void;
}) {
  const normalized = normalizeContact(contact);
  const emails = normalized.emails || [];
  const phones = normalized.phones || [];

  return (
    <View style={styles.contactRow}>
      <TouchableOpacity
        style={styles.contactRowHeader}
        onPress={onPress}
      >
        <View style={styles.rowIconBubble}>
          <Ionicons
            name={selected ? 'checkmark-circle' : 'person-outline'}
            size={20}
            color={colors.primary}
          />
        </View>

        <View style={styles.rowMain}>
          <Text style={styles.projectName}>
            {normalized.name || 'Unnamed Contact'}
          </Text>

          <Text style={styles.rowSub}>
            {emails.length} email{emails.length === 1 ? '' : 's'} | {phones.length} phone{phones.length === 1 ? '' : 's'}
          </Text>
        </View>

        <Text
          style={[
            styles.contactSelectText,
            selected && styles.contactSelectTextSelected,
          ]}
        >
          {selected ? 'Remove' : 'Add'}
        </Text>
      </TouchableOpacity>

      {emails.length > 0 ? (
        <View style={styles.deliveryChoiceBlock}>
          <Text style={styles.label}>Email to use</Text>

          <View style={styles.choiceChipWrap}>
            {emails.map(email => {
              const active = selectedContactEmail(normalized) === email;

              return (
                <TouchableOpacity
                  key={email}
                  style={[
                    styles.deliveryChoiceChip,
                    active && styles.deliveryChoiceChipActive,
                  ]}
                  onPress={() =>
                    onUpdate({
                      selectedEmail: email,
                      email,
                    })
                  }
                >
                  <Text
                    style={[
                      styles.deliveryChoiceText,
                      active && styles.deliveryChoiceTextActive,
                    ]}
                    numberOfLines={1}
                  >
                    {email}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      ) : null}

      {phones.length > 0 ? (
        <View style={styles.deliveryChoiceBlock}>
          <Text style={styles.label}>Phone to use for text</Text>

          <View style={styles.choiceChipWrap}>
            {phones.map(phone => {
              const active = selectedContactPhone(normalized) === phone;

              return (
                <TouchableOpacity
                  key={phone}
                  style={[
                    styles.deliveryChoiceChip,
                    active && styles.deliveryChoiceChipActive,
                  ]}
                  onPress={() =>
                    onUpdate({
                      selectedPhone: phone,
                      phone,
                    })
                  }
                >
                  <Text
                    style={[
                      styles.deliveryChoiceText,
                      active && styles.deliveryChoiceTextActive,
                    ]}
                    numberOfLines={1}
                  >
                    {phone}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      ) : null}
    </View>
  );
}
