import { Ionicons } from '@expo/vector-icons';
import type { ReactElement, ReactNode } from 'react';
import {
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { colors, radius, spacing } from '../theme';

type DocumentWorkspaceItem = {
  id: string;
  name: string;
  category: string;
  status: string;
  mimeType?: string | null;
  note?: string | null;
};

export function DocumentsWideWorkspace<T extends DocumentWorkspaceItem>({
  documents,
  selectedDocumentId,
  onSelectDocument,
  masterHeader,
  inspectorActions,
  inspector,
  emptyState,
}: {
  documents: T[];
  selectedDocumentId: string | null;
  onSelectDocument: (documentId: string) => void;
  masterHeader: ReactElement;
  inspectorActions?: ReactNode;
  inspector: ReactNode;
  emptyState: ReactElement;
}) {
  return (
    <View style={styles.workspace} testID="documents-wide-workspace">
      <View style={styles.masterColumn}>
        <FlatList
          data={documents}
          keyExtractor={document => document.id}
          renderItem={({ item }) => (
            <DocumentMasterRow
              document={item}
              selected={item.id === selectedDocumentId}
              onPress={() => onSelectDocument(item.id)}
            />
          )}
          ListHeaderComponent={masterHeader}
          ListEmptyComponent={emptyState}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          contentContainerStyle={styles.masterContent}
          contentInsetAdjustmentBehavior="automatic"
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        />
      </View>

      <ScrollView
        style={styles.inspectorColumn}
        contentContainerStyle={styles.inspectorContent}
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.inspectorToolbar}>
          <Text accessibilityRole="header" style={styles.inspectorEyebrow}>DOCUMENT INSPECTOR</Text>
          {inspectorActions}
        </View>
        {inspector}
      </ScrollView>
    </View>
  );
}

function DocumentMasterRow<T extends DocumentWorkspaceItem>({
  document,
  selected,
  onPress,
}: {
  document: T;
  selected: boolean;
  onPress: () => void;
}) {
  const isImage = document.mimeType?.includes('image');

  return (
    <Pressable
      style={({ pressed }) => [
        styles.documentRow,
        selected && styles.documentRowSelected,
        pressed && styles.documentRowPressed,
      ]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Open document ${document.name}`}
      accessibilityState={{ selected }}
    >
      <View style={styles.documentIcon}>
        <Ionicons
          name={isImage ? 'image-outline' : 'document-text-outline'}
          size={20}
          color={colors.primary}
        />
      </View>
      <View style={styles.documentCopy}>
        <Text style={styles.documentTitle} numberOfLines={2}>{document.name}</Text>
        <Text style={styles.documentMeta} numberOfLines={1}>
          {document.category} • {document.status.replace(/_/g, ' ')}
        </Text>
        {document.note ? (
          <Text style={styles.documentNote} numberOfLines={2}>{document.note}</Text>
        ) : null}
      </View>
      <Ionicons name="chevron-forward" size={17} color={colors.tertiaryText} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  workspace: {
    flex: 1,
    minHeight: 0,
    flexDirection: 'row',
    backgroundColor: colors.background,
  },
  masterColumn: {
    width: 390,
    maxWidth: '40%',
    minWidth: 330,
    borderRightWidth: 1,
    borderRightColor: colors.border,
    backgroundColor: colors.surface,
  },
  masterContent: {
    flexGrow: 1,
    padding: spacing.xl,
    paddingBottom: spacing.xxxl,
  },
  separator: {
    height: spacing.sm,
  },
  documentRow: {
    minHeight: 92,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    padding: spacing.md,
  },
  documentRowSelected: {
    borderColor: colors.primary,
    borderLeftWidth: 5,
    backgroundColor: colors.primarySoft,
  },
  documentRowPressed: {
    opacity: 0.72,
  },
  documentIcon: {
    width: 38,
    height: 38,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primarySoft,
  },
  documentCopy: {
    flex: 1,
    minWidth: 0,
    gap: spacing.xxs,
  },
  documentTitle: {
    color: colors.text,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '900',
  },
  documentMeta: {
    color: colors.mutedText,
    fontSize: 12,
    lineHeight: 17,
    textTransform: 'capitalize',
  },
  documentNote: {
    color: colors.tertiaryText,
    fontSize: 12,
    lineHeight: 16,
  },
  inspectorColumn: {
    flex: 1,
    minWidth: 0,
  },
  inspectorContent: {
    flexGrow: 1,
    gap: spacing.md,
    padding: spacing.xl,
    paddingBottom: spacing.xxxl,
  },
  inspectorEyebrow: {
    color: colors.tertiaryText,
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1.2,
  },
  inspectorToolbar: {
    minHeight: 48,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.lg,
  },
});
