import { Text, TextInput, View } from 'react-native';
import {
  colors,
  ProjectUpdate,
  styles,
} from './ProjectDetailsCard';

export function UpdateNotesCard({
  update,
  hasPhotos,
  onNotesChange,
}: {
  update: ProjectUpdate;
  hasPhotos: boolean;
  onNotesChange: (notes: string) => void;
}) {
  return (
    <View style={styles.panel}>
      <Text style={styles.label}>
        {hasPhotos ? 'Extra notes' : 'Update notes'}
      </Text>

      <TextInput
        style={[
          styles.input,
          styles.notesInput,
        ]}
        value={update.notes}
        onChangeText={onNotesChange}
        placeholder={
          hasPhotos
            ? 'Optional blockers, next steps, or decisions needed.'
            : 'Summary, status, blockers, next steps, or decisions needed.'
        }
        placeholderTextColor={colors.muted}
        multiline
      />
    </View>
  );
}
