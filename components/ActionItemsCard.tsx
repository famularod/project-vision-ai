import { Ionicons } from '@expo/vector-icons';
import { Text, TextInput, TouchableOpacity, View } from 'react-native';
import {
  ACTION_STATUSES,
  colors,
  parseDueDate,
  styles,
  UpdatePhoto,
} from './ProjectDetailsCard';

export function ActionItemsCard({
  photo,
  onUpdate,
}: {
  photo: UpdatePhoto;
  onUpdate: (
    next: Partial<UpdatePhoto>,
  ) => void;
}) {
  return (
    <View style={styles.actionPanel}>
      <View style={styles.actionPanelHeader}>
        <Ionicons
          name="checkbox-outline"
          size={19}
          color={colors.primary}
        />

        <Text style={styles.actionPanelTitle}>
          Action Item
        </Text>
      </View>

      <Text style={styles.label}>
        Action required
      </Text>

      <TextInput
        style={styles.input}
        value={photo.actionRequired}
        onChangeText={actionRequired =>
          onUpdate({ actionRequired })
        }
        placeholder="Example: Obtain asphalt repair proposal."
        placeholderTextColor={colors.muted}
        multiline
      />

      <Text style={styles.label}>
        Owner
      </Text>

      <TextInput
        style={styles.input}
        value={photo.actionOwner}
        onChangeText={actionOwner =>
          onUpdate({ actionOwner })
        }
        placeholder="Example: Matt"
        placeholderTextColor={colors.muted}
        autoCapitalize="words"
      />

      <Text style={styles.label}>
        Due date
      </Text>

      <TextInput
        style={styles.input}
        value={photo.actionDueDate}
        onChangeText={actionDueDate =>
          onUpdate({ actionDueDate })
        }
        placeholder="YYYY-MM-DD"
        placeholderTextColor={colors.muted}
        keyboardType="numbers-and-punctuation"
        maxLength={10}
      />

      {photo.actionDueDate.trim() &&
      !parseDueDate(photo.actionDueDate) ? (
        <Text style={styles.dateHelpError}>
          Enter the date as YYYY-MM-DD.
        </Text>
      ) : null}

      <Text style={styles.label}>
        Status
      </Text>

      <View style={styles.statusGrid}>
        {ACTION_STATUSES.map(status => (
          <TouchableOpacity
            key={status}
            style={[
              styles.statusButton,
              photo.actionStatus === status &&
                styles.statusButtonActive,
            ]}
            onPress={() =>
              onUpdate({
                actionStatus: status,
              })
            }
          >
            <Text
              style={[
                styles.statusButtonText,
                photo.actionStatus === status &&
                  styles.statusButtonTextActive,
              ]}
            >
              {status}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}
