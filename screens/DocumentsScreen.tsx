import { useState } from 'react';
import {
  FlatList,
  StyleProp,
  Text,
  TouchableOpacity,
  View,
  ViewStyle,
} from 'react-native';
import { ReferenceDocumentCard } from '../components/ReferenceDocumentCard';
import {
  EmptyState,
  PrimaryButton,
  ScreenTitle,
  SecondaryButton,
  styles,
} from '../components/ProjectDetailsCard';
import {
  REFERENCE_DOCUMENT_CATEGORIES,
  ReferenceDocument,
} from '../types';

export function DocumentsScreen({
  contentStyle,
  documents,
  onBack,
  onImport,
  onUpdate,
  onToggleCurrent,
  onOpen,
  onDelete,
}: {
  contentStyle: StyleProp<ViewStyle>;
  documents: ReferenceDocument[];
  onBack: () => void;
  onImport: () => void;
  onUpdate: (documentId: string, next: Partial<ReferenceDocument>) => void;
  onToggleCurrent: (documentId: string) => void;
  onOpen: (document: ReferenceDocument) => void;
  onDelete: (documentId: string) => void;
}) {
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);

  const filteredDocuments = categoryFilter
    ? documents.filter(document => document.category === categoryFilter)
    : documents;

  const renderDocument = ({ item: document }: { item: ReferenceDocument }) => (
    <ReferenceDocumentCard
      document={document}
      onUpdate={next => onUpdate(document.id, next)}
      onToggleCurrent={() => onToggleCurrent(document.id)}
      onOpen={() => onOpen(document)}
      onDelete={() => onDelete(document.id)}
    />
  );

  return (
    <FlatList
      style={styles.appFrame}
      contentContainerStyle={contentStyle}
      keyboardShouldPersistTaps="handled"
      data={filteredDocuments}
      keyExtractor={document => document.id}
      renderItem={renderDocument}
      ListHeaderComponent={
        <>
          <ScreenTitle
            title="Reference Documents"
            subtitle="Import drawings, PDFs, site plans, and reference files for local use on this phone."
          />

          <SecondaryButton
            label="Back to Projects"
            icon="arrow-back-outline"
            onPress={onBack}
          />

          <PrimaryButton
            label="Import PDF or Image"
            icon="document-attach-outline"
            onPress={onImport}
          />

          <View style={styles.panel}>
            <Text style={styles.panelTitle}>Local Storage</Text>
            <Text style={styles.bodyText}>
              Reference documents are copied into this app on this phone. Backup exports include document metadata only; large PDF and image files remain stored locally on the device.
            </Text>
          </View>

          <Text style={styles.sectionLabel}>Filter by Category</Text>

          <View style={styles.areaChipWrap}>
            <TouchableOpacity
              style={[
                styles.areaChip,
                !categoryFilter && styles.areaChipSelected,
              ]}
              onPress={() => setCategoryFilter(null)}
            >
              <Text
                style={[
                  styles.areaChipText,
                  !categoryFilter && styles.areaChipTextSelected,
                ]}
              >
                All Documents
              </Text>
            </TouchableOpacity>

            {REFERENCE_DOCUMENT_CATEGORIES.map(category => {
              const selected = categoryFilter === category;

              return (
                <TouchableOpacity
                  key={category}
                  style={[
                    styles.areaChip,
                    selected && styles.areaChipSelected,
                  ]}
                  onPress={() => setCategoryFilter(category)}
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
        </>
      }
      ListEmptyComponent={
        documents.length === 0 ? (
          <EmptyState
            title="No reference documents"
            text="Import PDFs, drawings, site plans, or images to keep local project references available in the app."
          />
        ) : (
          <EmptyState
            title="No documents in this category"
            text="Choose All Documents or import a file for this category."
          />
        )
      }
    />
  );
}
