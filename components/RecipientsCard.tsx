import { Ionicons } from '@expo/vector-icons';
import { Text, TouchableOpacity, View } from 'react-native';
import { colors, styles } from './ProjectDetailsCard';

export function RecipientsCard({
  summary,
  onContacts,
}: {
  summary: string;
  onContacts: () => void;
}) {
  return (
    <View style={styles.contactSummary}>
      <Ionicons
        name="people-outline"
        size={18}
        color={colors.primary}
      />

      <Text style={styles.contactSummaryText}>
        {summary}
      </Text>

      <TouchableOpacity onPress={onContacts}>
        <Text
          style={styles.contactSummaryAction}
        >
          Select
        </Text>
      </TouchableOpacity>
    </View>
  );
}
