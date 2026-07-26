import { Ionicons } from '@expo/vector-icons';
import { Text, TouchableOpacity, View } from 'react-native';
import { colors } from '../theme';

export function UpdateDeleteControl({ onDelete }: { onDelete: () => void }) {
  return (
    <View style={{
      backgroundColor: colors.dangerSoft,
      borderColor: colors.danger,
      borderWidth: 1,
      borderRadius: 12,
      padding: 14,
      marginBottom: 14,
    }}>
      <TouchableOpacity
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          minHeight: 48,
        }}
        onPress={onDelete}
        accessibilityRole="button"
        accessibilityLabel="Permanently delete this saved update"
      >
        <Ionicons name="trash-outline" size={19} color={colors.danger} />
        <Text style={{ color: colors.danger, fontSize: 16, fontWeight: '800' }}>
          Delete This Update
        </Text>
      </TouchableOpacity>
      <Text style={{ color: colors.mutedText, fontSize: 14, lineHeight: 20 }}>
        Use this when an update was saved by mistake. Deleting the source update stops it from affecting project status and related warnings.
      </Text>
    </View>
  );
}
