import { useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import {
  PrimaryButton,
  colors,
  styles,
} from './ProjectDetailsCard';

export function AddProjectCard({
  buttonLabel,
  placeholder,
  onAdd,
}: {
  buttonLabel: string;
  placeholder: string;
  onAdd: (projectName: string) => boolean;
}) {
  const [projectName, setProjectName] =
    useState('');

  function submit() {
    const added = onAdd(projectName);

    if (added) setProjectName('');
  }

  return (
    <View style={styles.addProjectCard}>
      <Text style={styles.panelTitle}>
        Add project manually
      </Text>

      <TextInput
        style={styles.input}
        value={projectName}
        onChangeText={setProjectName}
        placeholder={placeholder}
        placeholderTextColor={colors.muted}
      />

      <PrimaryButton
        label={buttonLabel}
        icon="checkmark-circle-outline"
        onPress={submit}
        disabled={!projectName.trim()}
      />
    </View>
  );
}
