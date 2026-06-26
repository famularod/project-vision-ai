import { Ionicons } from '@expo/vector-icons';
import { Text, TextInput, TouchableOpacity, View } from 'react-native';
import {
  REFERENCE_DOCUMENT_CATEGORIES,
  ReferenceDocument,
} from '../types';
import { formatSavedTime } from '../utils/date';
import {
  PrimaryButton,
  SecondaryButton,
  colors,
  styles,
} from './ProjectDetailsCard';

export function ReferenceDocumentCard({
  document,
  onUpdate,
  onToggleCurrent,
  onOpen,
  onDelete,
}: {
  document: ReferenceDocument;
  onUpdate: (next: Partial<ReferenceDocument>) => void;
  onToggleCurrent: () => void;
  onOpen: () => void;
  onDelete: () => void;
}) {
  return (
    <View style={styles.photoCard}>
      <View style={styles.photoHeader}>
        <View style={styles.rowIconBubble}>
          <Ionicons
            name={document.mimeType?.includes('image') ? 'image-outline' : 'document-text-outline'}
            size={20}
            color={colors.primary}
          />
        </View>

        <View style={styles.rowMain}>
          <Text style={styles.photoTitle}>{document.name}</Text>
          <Text style={styles.rowSub}>
            {document.category} | Imported {formatSavedTime(document.importedAt)}
          </Text>
          {document.isCurrent ? (
            <Text style={styles.locationDetailText}>Current reference</Text>
          ) : null}
        </View>
      </View>

      <Text style={styles.label}>Document Name</Text>
      <TextInput
        style={styles.input}
        value={document.name}
        onChangeText={name => onUpdate({ name })}
        placeholder="Document name"
        placeholderTextColor={colors.muted}
      />

      <Text style={styles.label}>Category</Text>
      <View style={styles.areaChipWrap}>
        {REFERENCE_DOCUMENT_CATEGORIES.map(category => {
          const selected = document.category === category;

          return (
            <TouchableOpacity
              key={category}
              style={[
                styles.areaChip,
                selected && styles.areaChipSelected,
              ]}
              onPress={() => onUpdate({ category })}
            >
              <Text
                style={[
                  styles.areaChipText,
                  selected && styles.areaChipTextSelected,
                ]}
              >
                {category}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <Text style={styles.label}>Notes</Text>
      <TextInput
        style={[styles.input, styles.notesInput]}
        value={document.notes}
        onChangeText={notes => onUpdate({ notes })}
        placeholder="Revision, drawing purpose, area covered, or important notes."
        placeholderTextColor={colors.muted}
        multiline
      />

      <Text style={styles.locationDetailText}>
        Original file: {document.originalFileName}
      </Text>

      <View style={styles.sendRow}>
        <PrimaryButton
          label="Open"
          icon="open-outline"
          onPress={onOpen}
          compact
        />

        <SecondaryButton
          label={document.isCurrent ? 'Unmark Current' : 'Mark Current'}
          icon={document.isCurrent ? 'star' : 'star-outline'}
          onPress={onToggleCurrent}
          compact
        />
      </View>

      <SecondaryButton
        label="Delete Document"
        icon="trash-outline"
        onPress={onDelete}
      />
    </View>
  );
}
