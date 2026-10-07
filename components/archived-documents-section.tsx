import { useState } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { mobileArchivedDocumentScopeText, type MobileArchivedDocument } from '../services/MobileDocumentWorkspace';
import { styles } from './app-shell-theme';

/**
 * "Archived (2)" under a project's Documents header (owner answer Q44, 6 Oct
 * 2026): the project's archived compliance documents, closed until tapped,
 * each with Restore. Nothing is shown when the project has none. An archived
 * document is hidden, not deleted, so this is where it is brought back from.
 */
export function ArchivedDocumentsSection({ documents, onRestore }: {
  documents: readonly MobileArchivedDocument[];
  onRestore: (document: MobileArchivedDocument) => void;
}) {
  const [open, setOpen] = useState(false);
  if (documents.length === 0) return null;
  return (
    <View testID="archived-documents-section">
      <TouchableOpacity
        style={styles.photoControlButton}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`Archived documents, ${documents.length}. ${open ? 'Hide' : 'Show'}`}
        onPress={() => setOpen(value => !value)}
      >
        <Text style={styles.photoControlText}>{`Archived (${documents.length})`}</Text>
      </TouchableOpacity>
      {open ? documents.map(document => (
        <View key={document.key} style={styles.photoCard} testID="archived-document-row">
          <Text selectable style={styles.photoTitle}>{document.name}</Text>
          <Text selectable style={styles.rowSub}>{`${document.category} · Archived`}</Text>
          <Text selectable style={styles.locationDetailText}>{mobileArchivedDocumentScopeText(document.scope)}</Text>
          <TouchableOpacity
            style={styles.photoControlButton}
            accessibilityRole="button"
            accessibilityLabel={`Restore ${document.name}`}
            onPress={() => onRestore(document)}
          >
            <Text style={styles.photoControlText}>Restore</Text>
          </TouchableOpacity>
        </View>
      )) : null}
    </View>
  );
}
